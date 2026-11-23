#include "ice_vehicle.hpp"

#include <boost/numeric/odeint.hpp>

#include <cmath>
#include <stdexcept>
#include <string>

namespace vs {

namespace odeint = boost::numeric::odeint;

IceVehicle::IceVehicle(const Params& p)
    : p_(p), e_(p.ice), dt_(p.sim.dt_ice), use_rk4_(p.sim.integrator == "rk4") {
    torque_delay_.reset(p.disc.n_th_e, 0.0);
    brake_delay_.reset(p.disc.n_th_b_ice, 0.0);
}

double IceVehicle::m_eff() const {
    // Clutch open: engine + gearbox inertia no longer reflected to the wheels.
    if (clutch_closed_) return e_.m_eff;
    return p_.body.m + e_.I_wheels / (p_.body.r_w * p_.body.r_w);
}

// ------------------------------------------------------------------ trim §3.8
void IceVehicle::trim(double v0, double x0) {
    if (v0 < 0.0) throw std::runtime_error("ICE trim: v0 must be >= 0");

    t_ = 0.0;
    x_[V] = v0;
    x_[X] = x0;
    x_[FB] = 0.0;
    brake_delay_.reset(p_.disc.n_th_b_ice, 0.0);

    if (v0 < e_.v_min) {
        // Clutch open from the start (redemarrage non modelise, D5).
        clutch_closed_ = false;
        x_[PM] = 0.3 * e_.p_atm;            // idle value, not used
        torque_delay_.reset(p_.disc.n_th_e, 0.0);
    } else {
        if (v0 > e_.v_max)
            throw std::runtime_error("ICE trim: v0 = " + std::to_string(v0) +
                                     " m/s above v_max = " + std::to_string(e_.v_max));
        clutch_closed_ = true;
        const double F   = p_.F_res(v0);
        const double T   = F >= 0.0 ? F / (e_.G * e_.eta_t) : F * e_.eta_t / e_.G;
        const double pm0 = (T + e_.T_loss(e_.G * v0)) / e_.kT;
        if (pm0 <= 0.0 || pm0 >= e_.p_atm)
            throw std::runtime_error("ICE trim: no equilibrium at v0 = " + std::to_string(v0) +
                                     " m/s (p_m = " + std::to_string(pm0) + " Pa)");
        x_[PM] = pm0;
        torque_delay_.reset(p_.disc.n_th_e, net_torque());
    }

    // Fill the outputs so that a log at t = 0 is meaningful.
    out_ = Outputs{};
    out_.ll = lower_level(0.0);
    out_.T_e = out_.T_e_eff = net_torque();
    out_.F_t = traction_force(out_.T_e_eff);
    out_.rpm = rads_to_rpm(e_.G * v0);
    out_.clutch_closed = clutch_closed_;
}

// ------------------------------------------------------------------ §3.4
double IceVehicle::net_torque() const {
    if (!clutch_closed_) return 0.0;
    const double w = e_.G * x_[V];
    if (w > e_.omega_max) return -e_.T_loss(w);          // fuel cut (§3.6)
    return e_.kT * x_[PM] - e_.T_loss(w);
}

double IceVehicle::traction_force(double T_eff) const {
    if (!clutch_closed_) return 0.0;
    return T_eff >= 0.0 ? e_.eta_t * e_.G * T_eff         // traction
                        : e_.G * T_eff / e_.eta_t;        // engine braking
}

// ------------------------------------------------------------------ §3.7
IceVehicle::LowLevel IceVehicle::lower_level(double a_des) const {
    LowLevel ll;
    const double v     = std::max(x_[V], 0.0);
    const double F_des = m_eff() * a_des + p_.F_load_est(v);

    if (!clutch_closed_) {                                // §12.4: brakes only
        const double Fb = -F_des;
        ll.theta_th = 0.0;
        ll.Fb_cmd   = std::clamp(Fb, 0.0, p_.brk.Fb_max);
        ll.sat_hi   = true;
        ll.sat_lo   = Fb >= p_.brk.Fb_max;
        return ll;
    }

    const double w     = e_.G * v;
    const double Tloss = e_.T_loss(w);
    const double F_min = -e_.G * Tloss / e_.eta_t;        // throttle closed

    if (F_des >= F_min) {                                 // engine only
        const double T_des = F_des >= 0.0 ? F_des / (e_.G * e_.eta_t)
                                          : F_des * e_.eta_t / e_.G;
        const double p_raw = (T_des + Tloss) / e_.kT;
        ll.p_des  = std::clamp(p_raw, 0.0, e_.p_atm);
        ll.sat_hi = p_raw > e_.p_atm;

        const double m_des = e_.K3 * ll.p_des * v;
        const double Phi   = e_.Phi(x_[PM] / e_.p_atm);
        const double arg   = Phi < 1e-9 ? 1.0 : m_des / (e_.K2 * Phi);
        if (arg >= 1.0) ll.sat_hi = true;
        ll.theta_th = std::acos(1.0 - std::clamp(arg, 0.0, 1.0));
        ll.Fb_cmd   = 0.0;
    } else {                                              // engine brake + brakes
        const double Fb = F_min - F_des;
        ll.theta_th = 0.0;
        ll.Fb_cmd   = std::min(Fb, p_.brk.Fb_max);
        ll.sat_lo   = Fb >= p_.brk.Fb_max;
    }
    return ll;
}

// ------------------------------------------------------------------ §3.5
void IceVehicle::rhs(const state_t& x, state_t& dx, double theta, double T_eff,
                     double Fb_cmd_del) const {
    const double v = x[V];

    // Manifold (frozen when the clutch is open: engine at idle, not used)
    if (clutch_closed_) {
        const double r     = x[PM] / e_.p_atm;
        const double m_th  = e_.K2 * (1.0 - std::cos(theta)) * e_.Phi(r);
        const double m_cyl = e_.K3 * x[PM] * std::max(v, 0.0);
        dx[PM] = e_.K1 * (m_th - m_cyl);
    } else {
        dx[PM] = 0.0;
    }

    // Vehicle
    const double F_net = traction_force(T_eff) - x[FB] - p_.F_res(v);
    dx[V] = (v <= 0.0 && F_net < 0.0) ? 0.0 : F_net / m_eff();   // standstill
    dx[X] = v;

    // Brakes (delayed command, first order)
    dx[FB] = (Fb_cmd_del - x[FB]) / p_.brk.tau_b;
}

// ------------------------------------------------------------------ one step
void IceVehicle::step(double a_des) {
    // 1) lower level on the current state
    const LowLevel ll = lower_level(a_des);

    // 2) pure delays (torque th_e, brake command th_b)
    const double T_now = net_torque();
    const double T_eff = torque_delay_.push(T_now);
    const double Fb_del = brake_delay_.push(ll.Fb_cmd);

    // 3) integrate the plant over dt with held inputs
    const double v_old = x_[V];
    auto sys = [&](const state_t& x, state_t& dx, double /*t*/) {
        rhs(x, dx, ll.theta_th, T_eff, Fb_del);
    };
    if (use_rk4_) {
        odeint::runge_kutta4<state_t> rk4;
        rk4.do_step(sys, x_, t_, dt_);
    } else {
        odeint::euler<state_t> eul;
        eul.do_step(sys, x_, t_, dt_);
    }
    t_ += dt_;

    // 4) constraints (§12.9)
    if (x_[V] < 0.0) x_[V] = 0.0;
    x_[FB] = std::clamp(x_[FB], 0.0, p_.brk.Fb_max);
    if (clutch_closed_ && x_[V] < e_.v_min) clutch_closed_ = false;   // latched (§12.4)

    // 5) outputs
    out_.ll            = ll;
    out_.a_des         = a_des;
    out_.a             = (x_[V] - v_old) / dt_;
    out_.T_e           = T_now;
    out_.T_e_eff       = T_eff;
    out_.F_t           = traction_force(T_eff);
    out_.rpm           = clutch_closed_ ? rads_to_rpm(e_.G * x_[V]) : 0.0;
    out_.clutch_closed = clutch_closed_;
}

} // namespace vs