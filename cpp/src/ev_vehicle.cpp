#include "ev_vehicle.hpp"

#include <boost/numeric/odeint.hpp>

#include <cmath>
#include <stdexcept>
#include <string>

namespace vs {

namespace odeint = boost::numeric::odeint;

EvVehicle::EvVehicle(const Params& p)
    : p_(p), m_(p.ev), dt_(p.sim.dt_ev), use_rk4_(p.sim.integrator == "rk4") {
    // §12.3: backward Euler, q0 = Kp + Ki*h, q1 = Kp
    q0_ = m_.Kp_i + m_.Ki_i * dt_;
    q1_ = m_.Kp_i;
    brake_delay_.reset(p.disc.n_th_b_ev, 0.0);
}

// ------------------------------------------------------------------ trim §4.8
void EvVehicle::trim(double v0, double x0) {
    if (v0 < 0.0) throw std::runtime_error("EV trim: v0 must be >= 0");

    const double F  = p_.F_res(v0);
        const double i0 = F >= 0.0 ? F / m_.F_per_A_trac : F / m_.F_per_A_regen;
    const double Vc = m_.R_a * i0 + m_.k_e * m_.G * v0;

    if (std::fabs(i0) > m_.i_lim(v0, p_.lim.P_max))
        throw std::runtime_error("EV trim: current limit exceeded at v0 = " + std::to_string(v0));
    if (Vc < 0.0 || Vc > m_.V_bat)
        throw std::runtime_error("EV trim: V_c = " + std::to_string(Vc) +
                                 " V outside [0, V_bat] at v0 = " + std::to_string(v0) +
                                 " m/s (top speed is limited by V_bat)");

    x_ = state_t{};
    x_[IA] = i0;
    x_[V]  = v0;
    x_[X]  = x0;
    t_ = 0.0;
    i_a0_ = i0;
    u_i_ = m_.R_a * i0;      // integrator = R_a*i_a(0) (§4.8)
    e_prev_ = 0.0;
    brake_delay_.reset(p_.disc.n_th_b_ev, 0.0);

    out_ = Outputs{};
    out_.ll    = lower_level(0.0);
    out_.V_c   = Vc;
    out_.D     = Vc / m_.V_bat;
    out_.T_e   = m_.k_t * i0;
    out_.F_t   = traction_force(i0);
    out_.P_bat = Vc * i0;
    out_.rpm   = rads_to_rpm(m_.G * v0);
}

double EvVehicle::energy_residual() const {
    const double E_ind = 0.5 * m_.L_a * (x_[IA] * x_[IA] - i_a0_ * i_a0_);
    return x_[EBAT] - x_[EJ] - x_[EM] - E_ind;
}

// ------------------------------------------------------------------ §4.4
double EvVehicle::traction_force(double i_a) const {
    return i_a >= 0.0 ? m_.F_per_A_trac * i_a      // traction
                      : m_.F_per_A_regen * i_a;    // regeneration
}

// ------------------------------------------------------------------ §4.7
EvVehicle::LowLevel EvVehicle::lower_level(double a_des) const {
    LowLevel ll;
    const double v     = std::max(x_[V], 0.0);
    const double F_des = m_.m_eff * a_des + p_.F_load_est(v);

    ll.i_ref   = F_des >= 0.0 ? F_des / m_.F_per_A_trac : F_des / m_.F_per_A_regen;
    ll.i_lim   = m_.i_lim(v, p_.lim.P_max);
    ll.i_ref_s = std::clamp(ll.i_ref, -ll.i_lim, ll.i_lim);
    ll.sat_hi  = ll.i_ref > ll.i_lim;

    // regeneration first, friction brakes take the rest
    const double Fb = traction_force(ll.i_ref_s) - F_des;
    ll.Fb_cmd = std::clamp(Fb, 0.0, p_.brk.Fb_max);
    ll.sat_lo = Fb >= p_.brk.Fb_max;
    return ll;
}

// ------------------------------------------------------------------ §4.5
void EvVehicle::rhs(const state_t& x, state_t& dx, double V_c, double Fb_cmd_del) const {
    const double i_a = x[IA];
    const double v   = x[V];
    const double emf = m_.k_e * m_.G * v;

    dx[IA] = (V_c - m_.R_a * i_a - emf) / m_.L_a;

    const double F_net = traction_force(i_a) - x[FB] - p_.F_res(v);
    dx[V] = (v <= 0.0 && F_net < 0.0) ? 0.0 : F_net / m_.m_eff;   // standstill
    dx[X] = v;

    dx[FB] = (Fb_cmd_del - x[FB]) / p_.brk.tau_b;

    // energy accumulators (§6.6)
    dx[EBAT] = V_c * i_a;
    dx[EJ]   = m_.R_a * i_a * i_a;
    dx[EM]   = emf * i_a;
}

// ------------------------------------------------------------------ one step
void EvVehicle::step(double a_des) {
    // 1) lower level: current reference and brake command
    LowLevel ll = lower_level(a_des);

    // 2) discrete current PI + back-EMF decoupling (§12.3)
    const double emf = m_.k_e * m_.G * x_[V];
    const double e   = ll.i_ref_s - x_[IA];
    u_i_ += q0_ * e - q1_ * e_prev_;
    e_prev_ = e;
    double V_c = emf + u_i_;
    const double D = std::clamp(V_c / m_.V_bat, 0.0, 1.0);
    if (V_c > m_.V_bat || V_c < 0.0) {
        V_c  = D * m_.V_bat;
        u_i_ = V_c - emf;                    // anti-windup (back-calculation)
    }
    if (D >= 1.0) ll.sat_hi = true;

    // 3) brake delay
    const double Fb_del = brake_delay_.push(ll.Fb_cmd);

    // 4) integrate the plant over dt with V_c held
    const double v_old = x_[V];
    auto sys = [&](const state_t& x, state_t& dx, double /*t*/) { rhs(x, dx, V_c, Fb_del); };
    if (use_rk4_) {
        odeint::runge_kutta4<state_t> rk4;
        rk4.do_step(sys, x_, t_, dt_);
    } else {
        odeint::euler<state_t> eul;
        eul.do_step(sys, x_, t_, dt_);
    }
    t_ += dt_;

    // 5) constraints (§12.9)
    if (x_[V] < 0.0) x_[V] = 0.0;
    x_[FB] = std::clamp(x_[FB], 0.0, p_.brk.Fb_max);

    // 6) outputs
    out_.ll    = ll;
    out_.a_des = a_des;
    out_.a     = (x_[V] - v_old) / dt_;
    out_.V_c   = V_c;
    out_.D     = D;
    out_.T_e   = m_.k_t * x_[IA];
    out_.F_t   = traction_force(x_[IA]);
    out_.P_bat = V_c * x_[IA];
    out_.rpm   = rads_to_rpm(m_.G * x_[V]);
}

} // namespace vs