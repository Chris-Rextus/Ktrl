#include "params.hpp"
#include "config.hpp"

#include <iomanip>
#include <ostream>
#include <stdexcept>

namespace vs {

namespace {

void require(bool ok, const std::string& msg) {
    if (!ok) throw std::runtime_error("invalid parameter: " + msg);
}

// Returns round(T/dt) and checks that T is a whole multiple of dt.
int whole_steps(double T, double dt, const std::string& what) {
    const double n = T / dt;
    const double r = std::round(n);
    require(r >= 1.0 && std::fabs(n - r) < 1e-6,
            what + " (" + std::to_string(T) + " s) must be a whole multiple of " +
            std::to_string(dt) + " s");
    return static_cast<int>(r);
}

} // namespace

Params Params::from_config(const Config& c) {
    Params p{};

    // ---- simulation / output
    p.sim.vehicle         = c.get_string("simulation.vehicle");
    p.sim.duration        = c.get_double("simulation.duration");
    p.sim.Ts_ctrl         = c.get_double("simulation.Ts_ctrl");
    p.sim.dt_ice          = c.get_double("simulation.dt_ice");
    p.sim.dt_ev           = c.get_double("simulation.dt_ev");
    p.sim.integrator      = c.get_string("simulation.integrator");
    p.sim.realtime_factor = c.get_double("simulation.realtime_factor");
    p.sim.on_finish       = c.get_string("simulation.on_finish", "exit");

    p.out.file            = c.get_string("output.file");
    p.out.period          = c.get_double("output.period");
    p.out.flush_each_line = c.get_bool("output.flush_each_line");

    // ---- environment / body / brakes / limits
    p.env.rho  = c.get_double("environment.rho");
    p.env.g    = c.get_double("environment.g");
    p.env.beta = c.get_double("environment.beta");

    p.body.m   = c.get_double("body.m");
    p.body.r_w = c.get_double("body.r_w");
    p.body.A_d = c.get_double("body.A_d");
    p.body.Cx  = c.get_double("body.Cx");
    p.body.Cr  = c.get_double("body.Cr");

    p.brk.th_b   = c.get_double("brakes.th_b");
    p.brk.tau_b  = c.get_double("brakes.tau_b");
    p.brk.mu_max = c.get_double("brakes.mu_max");

    p.lim.P_max = c.get_double("limits.P_max");
    p.lim.a_min = c.get_double("limits.a_min_g") * p.env.g;
    p.lim.a_max = c.get_double("limits.a_max_g") * p.env.g;

    // ---- ICE
    auto& e = p.ice;
    e.p_atm         = c.get_double("ice.p_atm");
    e.T_atm         = c.get_double("ice.T_atm");
    e.R_air         = c.get_double("ice.R_air");
    e.gamma         = c.get_double("ice.gamma");
    e.D_th          = c.get_double("ice.D_th");
    e.Cd_th         = c.get_double("ice.Cd_th");
    e.Vm_factor     = c.get_double("ice.Vm_factor");
    e.T_m           = c.get_double("ice.T_m");
    e.V_d           = c.get_double("ice.V_d");
    e.eta_v         = c.get_double("ice.eta_v");
    e.BMEP_max      = c.get_double("ice.BMEP_max");
    e.T0            = c.get_double("ice.T0");
    e.cw            = c.get_double("ice.cw");
    e.omega_ref_rpm = c.get_double("ice.omega_ref_rpm");
    e.rpm_min       = c.get_double("ice.rpm_min");
    e.rpm_max       = c.get_double("ice.rpm_max");
    e.th_e          = c.get_double("ice.th_e");
    e.i_gear        = c.get_double("ice.i_gear");
    e.eta_t         = c.get_double("ice.eta_t");
    e.I_engine      = c.get_double("ice.I_engine");
    e.I_wheels      = c.get_double("ice.I_wheels");

    // ---- EV
    auto& m = p.ev;
    m.V_bat  = c.get_double("ev.V_bat");
    m.R_a    = c.get_double("ev.R_a");
    m.L_a    = c.get_double("ev.L_a");
    m.k_e    = c.get_double("ev.k_e");
    m.k_t    = c.get_double("ev.k_t");
    m.J_m    = c.get_double("ev.J_m");
    m.i_gear = c.get_double("ev.i_gear");
    m.eta_t  = c.get_double("ev.eta_t");
    m.i_max  = c.get_double("ev.i_max");
    m.w_ci   = c.get_double("ev.w_ci");

    // ---- controller / leader
    p.ctrl.k_p          = c.get_double("controller.k_p");
    p.ctrl.k_i          = c.get_double("controller.k_i");
    p.ctrl.h            = c.get_double("controller.h");
    p.ctrl.lambda       = c.get_double("controller.lambda");
    p.ctrl.d0           = c.get_double("controller.d0");
    p.ctrl.d_det        = c.get_double("controller.d_det");

    p.lead.L_veh = c.get_double("leader.L_veh");

    // ---- scenario (presets applied later, in scenario.cpp)
    auto& s = p.scn;
    s.preset             = c.get_string("scenario.preset");
    s.v0                 = c.get_double("scenario.v0");
    s.v_set              = c.get_double("scenario.v_set");
    s.v_set_step_time    = c.get_double("scenario.v_set_step_time");
    s.v_set_step_value   = c.get_double("scenario.v_set_step_value");
    s.leader_present     = c.get_bool("scenario.leader_present");
    s.v_lead0            = c.get_double("scenario.v_lead0");
    s.d_init             = c.get_double("scenario.d_init");
    s.lead_accel         = c.get_double("scenario.lead_accel");
    s.lead_accel_start   = c.get_double("scenario.lead_accel_start");
    s.lead_v_target      = c.get_double("scenario.lead_v_target");
    s.target_appear_time = c.get_double("scenario.target_appear_time");
    s.cutin_distance     = c.get_double("scenario.cutin_distance");
    s.target_lost_time   = c.get_double("scenario.target_lost_time");

    // ================= validation =================
    require(p.sim.vehicle == "ice" || p.sim.vehicle == "ev" || p.sim.vehicle == "both",
            "simulation.vehicle must be ice | ev | both");
    require(p.sim.integrator == "rk4" || p.sim.integrator == "euler",
            "simulation.integrator must be rk4 | euler");
    require(p.sim.duration >= 0, "simulation.duration >= 0 (0 = run forever)");
    require(p.sim.on_finish == "exit" || p.sim.on_finish == "wait",
            "simulation.on_finish must be exit | wait");
    require(p.sim.dt_ice > 0 && p.sim.dt_ev > 0 && p.sim.Ts_ctrl > 0, "time steps > 0");
    require(p.sim.realtime_factor >= 0, "simulation.realtime_factor >= 0");
    require(p.out.period > 0, "output.period > 0");
    require(p.env.g > 0 && p.env.rho > 0, "environment.g, rho > 0");
    require(p.body.m > 0 && p.body.r_w > 0 && p.body.A_d > 0, "body m, r_w, A_d > 0");
    require(p.brk.tau_b > 0 && p.brk.th_b >= 0, "brakes tau_b > 0, th_b >= 0");
    require(p.lim.a_min < 0 && p.lim.a_max > 0, "limits a_min_g < 0 < a_max_g");
    require(e.eta_t > 0 && e.eta_t <= 1 && m.eta_t > 0 && m.eta_t <= 1, "eta_t in (0,1]");
    require(e.gamma > 1, "ice.gamma > 1");
    require(e.rpm_min > 0 && e.rpm_max > e.rpm_min, "0 < ice.rpm_min < ice.rpm_max");
    require(m.L_a > 0 && m.R_a > 0 && m.k_t > 0 && m.k_e > 0, "ev L_a, R_a, k_t, k_e > 0");
    require(p.ctrl.h > 0, "controller.h > 0");

    // ================= derived constants =================
    p.body.ca = 0.5 * p.env.rho * p.body.Cx * p.body.A_d;
    p.body.Rx = p.body.Cr * p.body.m * p.env.g;
    p.brk.Fb_max = p.brk.mu_max * p.body.m * p.env.g;

    // ICE (§3.2, §3.3)
    e.A_max   = PI * std::pow(0.5 * e.D_th, 2);
    e.V_m     = e.Vm_factor * e.V_d;
    e.r_c     = std::pow(2.0 / (e.gamma + 1.0), e.gamma / (e.gamma - 1.0));
    e.Phi_max = std::sqrt(e.gamma) *
                std::pow(2.0 / (e.gamma + 1.0), (e.gamma + 1.0) / (2.0 * (e.gamma - 1.0)));
    e.G         = e.i_gear / p.body.r_w;
    e.K1        = e.R_air * e.T_m / e.V_m;
    e.K2        = e.Cd_th * e.A_max * e.p_atm / std::sqrt(e.R_air * e.T_atm);
    e.K3        = e.eta_v * e.V_d * e.G / (4.0 * PI * e.R_air * e.T_m);
    e.omega_ref = rpm_to_rads(e.omega_ref_rpm);
    e.omega_min = rpm_to_rads(e.rpm_min);
    e.omega_max = rpm_to_rads(e.rpm_max);
    e.kT        = (e.BMEP_max * e.V_d / (4.0 * PI) + e.T_loss(e.omega_ref)) / e.p_atm;
    e.m_eff     = p.body.m + e.I_engine * e.G * e.G + e.I_wheels / (p.body.r_w * p.body.r_w);
    e.v_min     = e.omega_min / e.G;
    e.v_max     = e.omega_max / e.G;

    // EV (§4.2, §4.3)
    m.G             = m.i_gear / p.body.r_w;
    m.m_eff         = p.body.m + m.J_m * m.G * m.G;
    m.Kp_i          = m.L_a * m.w_ci;
    m.Ki_i          = m.R_a * m.w_ci;
    m.F_per_A_trac  = m.eta_t * m.G * m.k_t;
    m.F_per_A_regen = m.G * m.k_t / m.eta_t;

    // Discretization (§12.5)
    auto& d = p.disc;
    d.n_ctrl_ice = whole_steps(p.sim.Ts_ctrl, p.sim.dt_ice, "simulation.Ts_ctrl vs dt_ice");
    d.n_ctrl_ev  = whole_steps(p.sim.Ts_ctrl, p.sim.dt_ev,  "simulation.Ts_ctrl vs dt_ev");
    d.n_th_e     = whole_steps(e.th_e,       p.sim.dt_ice, "ice.th_e");
    d.n_th_b_ice = whole_steps(p.brk.th_b,   p.sim.dt_ice, "brakes.th_b (ICE step)");
    d.n_th_b_ev  = whole_steps(p.brk.th_b,   p.sim.dt_ev,  "brakes.th_b (EV step)");
    d.n_out_ice  = whole_steps(p.out.period, p.sim.dt_ice, "output.period vs dt_ice");
    d.n_out_ev   = whole_steps(p.out.period, p.sim.dt_ev,  "output.period vs dt_ev");

    return p;
}

// ------------------------------------------------------------------ printing

void print_params(const Params& p, std::ostream& os) {
    const auto& e = p.ice;
    const auto& m = p.ev;
    const auto& d = p.disc;
    os << std::setprecision(6);
    os << "== simulation\n"
       << "  vehicle=" << p.sim.vehicle << "  duration=" << p.sim.duration << " s"
       << "  Ts_ctrl=" << p.sim.Ts_ctrl << "  dt_ice=" << p.sim.dt_ice
       << "  dt_ev=" << p.sim.dt_ev << "  integrator=" << p.sim.integrator
       << "  realtime_factor=" << p.sim.realtime_factor << "\n"
       << "  output=" << p.out.file << " every " << p.out.period << " s\n"
       << "== body\n"
       << "  ca=" << p.body.ca << " kg/m  Rx=" << p.body.Rx << " N  Fb_max=" << p.brk.Fb_max
       << " N  a_des in [" << p.lim.a_min << ", " << p.lim.a_max << "] m/s2\n"
       << "== ICE\n"
       << "  K1=" << e.K1 << "  K2=" << e.K2 << "  K3=" << e.K3 << "  kT=" << e.kT << "\n"
       << "  G=" << e.G << "  m_eff=" << e.m_eff << "  r_c=" << e.r_c
       << "  Phi_max=" << e.Phi_max << "\n"
       << "  v_min=" << e.v_min << "  v_max=" << e.v_max << " m/s\n"
       << "== EV\n"
       << "  G=" << m.G << "  m_eff=" << m.m_eff << "  Kp_i=" << m.Kp_i << "  Ki_i=" << m.Ki_i
       << "  F/A trac=" << m.F_per_A_trac << "  regen=" << m.F_per_A_regen << "\n"
       << "== steps\n"
       << "  ctrl: ICE " << d.n_ctrl_ice << ", EV " << d.n_ctrl_ev
       << " | th_e " << d.n_th_e << " | th_b ICE " << d.n_th_b_ice << ", EV " << d.n_th_b_ev << "\n"
       << "== scenario: preset=" << p.scn.preset << "\n";
}

// ------------------------------------------------------------------ self-test

namespace {

struct Checker {
    std::ostream& os;
    int fails = 0;
    void operator()(const std::string& name, double got, double ref, double rtol = 2e-3) {
        const double err = std::fabs(got - ref) / std::max(std::fabs(ref), 1e-12);
        const bool ok = err <= rtol;
        if (!ok) ++fails;
        os << "  " << (ok ? "OK  " : "FAIL") << "  " << std::left << std::setw(30) << name
           << std::right << std::setw(14) << std::setprecision(6) << got
           << "   doc " << std::setw(12) << ref << "   rel.err " << std::setprecision(2)
           << std::scientific << err << std::defaultfloat << "\n";
    }
};

} // namespace

int selftest_params(const Params& p, std::ostream& os) {
    Checker ck{os};
    const auto& e = p.ice;
    const auto& m = p.ev;

    os << "-- body (§1, §2)\n";
    ck("ca [kg/m]",             p.body.ca,            0.735);
    ck("Rx [N]",                p.body.Rx,            294.99);
    ck("F_res(30) [N]",         p.F_load_est(30.0),   956.5);
    ck("wheel power 30 m/s [W]",p.F_load_est(30.0)*30,28690, 3e-3);
    ck("Fb_max [N]",            p.brk.Fb_max,         15225);

    os << "-- ICE (§3.3, §6.1)\n";
    ck("Phi_max",               e.Phi_max,            0.68473);
    ck("r_c",                   e.r_c,                0.528);
    ck("Phi(r_c) continuity",   e.Phi(e.r_c + 1e-9),  e.Phi_max, 1e-6);
    ck("A_max [m2]",            e.A_max,              1.9635e-3);
    ck("K1 [Pa/kg]",            e.K1,                 2.2053e7);
    ck("K2 [kg/s]",             e.K2,                 0.55346);
    ck("K3 [kg/(Pa.m)]",        e.K3,                 2.7946e-8);
    ck("kT [N.m/Pa]",           e.kT,                 2.2603e-3);
    ck("G [1/m]",               e.G,                  13.6667);
    ck("m_eff [kg]",            e.m_eff,              2021.8);
    ck("v_min [m/s]",           e.v_min,              7.662);
    ck("v_max [m/s]",           e.v_max,              49.806);
    const double wr = e.omega_ref;
    ck("T_full(3000rpm) [N.m]", e.kT * e.p_atm - e.T_loss(wr), 198.94);
    ck("T_min(3000rpm) [N.m]",  -e.T_loss(wr),        -30.08);
    ck("T_full(6500rpm) [N.m]", e.kT * e.p_atm - e.T_loss(e.omega_max), 181.4);
    ck("tau_m(10) [s]",         e.tau_m(10.0),        0.162, 5e-3);
    ck("tau_m(30) [s]",         e.tau_m(30.0),        0.054, 5e-3);
    {
        const double air = e.eta_v * e.p_atm * e.V_d / (e.R_air * e.T_m);
        const double fuel_J = air / 14.7 * 44e6;
        const double work_J = e.kT * e.p_atm * 4.0 * PI;
        ck("air per cycle [kg]",    air,              2.604e-3);
        ck("gross indicated eff.",  work_J / fuel_J,  0.369, 3e-3);
    }

    os << "-- EV (§4.3, §4.8, §6.3)\n";
    ck("G [1/m]",               m.G,                  33.3333);
    ck("m_eff [kg]",            m.m_eff,              2162.2);
    ck("Kp_i [V/A]",            m.Kp_i,               0.6);
    ck("Ki_i [V/(A.s)]",        m.Ki_i,               30.0);
    ck("F/A traction [N/A]",    m.F_per_A_trac,       7.9167);
    ck("F/A regen [N/A]",       m.F_per_A_regen,      8.7719);
    {
        const double i0 = p.F_load_est(30.0) / m.F_per_A_trac;
        const double D0 = (m.R_a * i0 + m.k_e * m.G * 30.0) / m.V_bat;
        ck("trim i_a(30) [A]",  i0,                   120.82);
        ck("trim D(30)",        D0,                   0.6401);
    }
    ck("regen max force [N]",   m.F_per_A_regen * m.i_max, 3508.8);
    ck("i_lim(37.9) [A]",       m.i_lim(37.9, p.lim.P_max), 380.0, 5e-3);
    {
        // top speed: V_bat = R_a*i(v) + k_e*G*v with i(v) = F_res(v)/F_per_A_trac
        double lo = 0.0, hi = 100.0;
        for (int k = 0; k < 100; ++k) {
            const double v = 0.5 * (lo + hi);
            const double V = m.R_a * p.F_load_est(v) / m.F_per_A_trac + m.k_e * m.G * v;
            (V > m.V_bat ? hi : lo) = v;
        }
        ck("top speed [m/s]",   lo,                   46.6, 3e-3);
    }

    os << (ck.fails == 0 ? "== self-test: all OK\n"
                         : "== self-test: " + std::to_string(ck.fails) + " FAILURE(S)\n");
    return ck.fails;
}

} // namespace vs