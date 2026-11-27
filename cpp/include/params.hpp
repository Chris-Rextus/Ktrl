#pragma once
// All simulation parameters, read from the config file, plus derived
// constants (document §1-§4, §12). Units SI.

#include <algorithm>
#include <cmath>
#include <iosfwd>
#include <string>

class Config;

namespace vs {

constexpr double PI = 3.14159265358979323846;
inline double rpm_to_rads(double rpm) { return rpm * 2.0 * PI / 60.0; }
inline double rads_to_rpm(double w)   { return w * 60.0 / (2.0 * PI); }
inline double sgn(double x)           { return (x > 0.0) - (x < 0.0); }

struct SimParams {
    std::string vehicle;        // ice | ev | both
    double duration;            // s
    double Ts_ctrl;             // s
    double dt_ice, dt_ev;       // s
    std::string integrator;     // rk4 | euler
    double realtime_factor;     // 0 = max speed
    std::string on_finish;      // exit | wait
    bool endless;               // run until stopped (duration forced to 0)
    bool stop_on_collision;     // on_collision = stop_lane: a lane that collides freezes
};

struct OutputParams {
    std::string file;
    double period;              // s
    bool flush_each_line;
};

struct EnvParams {
    double rho, g, beta;
};

struct BodyParams {
    double m, r_w, A_d, Cx, Cr;
    // derived
    double ca;                  // 0.5*rho*Cx*A_d        [kg/m]
    double Rx;                  // Cr*m*g                [N]
};

struct BrakeParams {
    double th_b, tau_b, mu_max;
    // derived
    double Fb_max;              // mu_max*m*g            [N]
};

struct LimitParams {
    double P_max;               // W
    double a_min, a_max;        // m/s2 (converted from g)
};

struct IceParams {
    // inputs (§3.2)
    double p_atm, T_atm, R_air, gamma;
    double D_th, Cd_th, Vm_factor, T_m;
    double V_d, eta_v, BMEP_max, T0, cw;
    double omega_ref_rpm, rpm_min, rpm_max, th_e;
    double i_gear, eta_t, I_engine, I_wheels;
    // derived (§3.2, §3.3)
    double A_max;               // pi*(D_th/2)^2         [m2]
    double V_m;                 // Vm_factor*V_d         [m3]
    double r_c;                 // critical pressure ratio
    double Phi_max;             // choked flow function
    double K1;                  // R_air*T_m/V_m         [Pa/kg]
    double K2;                  // Cd*A_max*p_atm/sqrt(R*T_atm) [kg/s]
    double K3;                  // eta_v*V_d*G/(4pi*R*T_m)      [kg/(Pa.m)]
    double kT;                  // torque per Pa         [N.m/Pa]
    double G;                   // i_gear/r_w            [1/m]
    double m_eff;               // [kg]
    double omega_ref, omega_min, omega_max;  // rad/s
    double v_min, v_max;        // m/s (clutch closed range)

    double T_loss(double omega) const { return T0 + cw * omega; }
    double tau_m(double v) const { return 1.0 / (K1 * K3 * v); }
    // Isentropic flow function through the throttle (§3.4 eq. 3)
    double Phi(double r) const {
        r = std::clamp(r, 0.0, 1.0);
        if (r <= r_c) return Phi_max;
        const double a = 2.0 / gamma, b = (gamma + 1.0) / gamma;
        const double arg = 2.0 * gamma / (gamma - 1.0) * (std::pow(r, a) - std::pow(r, b));
        return std::sqrt(std::max(arg, 0.0));
    }
};

struct EvParams {
    // inputs (§4.2)
    double V_bat, R_a, L_a, k_e, k_t, J_m;
    double i_gear, eta_t, i_max, w_ci;
    // derived (§4.2, §4.3)
    double G;                   // i_gear/r_w            [1/m]
    double m_eff;               // m + J_m*G^2           [kg]
    double Kp_i, Ki_i;          // current PI            [V/A], [V/(A.s)]
    double F_per_A_trac;        // eta_t*G*k_t           [N/A]
    double F_per_A_regen;       // G*k_t/eta_t           [N/A]

    // Current limit on the reference (§4.6, K8: finite at v -> 0)
    double i_lim(double v, double P_max) const {
        const double w = G * std::fabs(v);
        if (w < 1e-9) return i_max;
        return std::min(i_max, P_max / (k_t * w));
    }
};

struct CtrlParams {
    double k_p, k_i, h, lambda, d0, d_det;   // sensors are ideal (no delay)
    double k_d = 0.0;           // -   cruise PID: derivative gain on the measured speed (0 = PI)
    double N_d = 10.0;          // -   derivative filter: tau_f = T_D / N_d, T_D = k_d / k_p
    double tau_f() const { return (k_p > 0.0 && N_d > 0.0) ? k_d / k_p / N_d : 0.0; }
    bool   fixed_spacing;       // false: d_ref = d0 + h*v (time gap); true: d_ref = d_set
    double d_set;               // m   target distance when fixed_spacing

    double d_ref(double v) const { return fixed_spacing ? d_set : d0 + h * v; }
};

struct LeaderParams {
    double L_veh;
};

struct ScenarioParams {
    std::string preset;         // T0, S1..S6, custom
    double v0, v_set;
    double v_set_step_time, v_set_step_value;
    bool   leader_present;
    double v_lead0, d_init;
    double lead_accel, lead_accel_start, lead_v_target;
    double target_appear_time, cutin_distance, target_lost_time;
};

// Integer step counts (every delay / period must be a whole number of steps)
struct Discretization {
    int n_ctrl_ice;             // Ts_ctrl / dt_ice
    int n_ctrl_ev;              // Ts_ctrl / dt_ev
    int n_th_e;                 // th_e / dt_ice      (torque delay buffer)
    int n_th_b_ice;             // th_b / dt_ice      (brake delay buffer)
    int n_th_b_ev;              // th_b / dt_ev
    int n_out_ice;              // output.period / dt_ice
    int n_out_ev;               // output.period / dt_ev
};

struct Params {
    SimParams      sim;
    OutputParams   out;
    EnvParams      env;
    BodyParams     body;
    BrakeParams    brk;
    LimitParams    lim;
    IceParams      ice;
    EvParams       ev;
    CtrlParams     ctrl;
    LeaderParams   lead;
    ScenarioParams scn;
    Discretization disc;

    static Params from_config(const Config& cfg);

    // True road load (§1), includes grade. Opposes motion.
    double F_res(double v) const {
        return body.ca * v * std::fabs(v)
             + body.Rx * std::cos(env.beta) * sgn(v)
             + body.m * env.g * std::sin(env.beta);
    }
    // Load estimate used by the lower levels (§3.7, §4.7): flat road, v >= 0.
    double F_load_est(double v) const { return body.ca * v * v + body.Rx; }
};

void print_params(const Params& p, std::ostream& os);

// Compares derived constants with the document values (§6.1-§6.3, §4.8).
// Only meaningful with the default config. Returns the number of failures.
int selftest_params(const Params& p, std::ostream& os);

} // namespace vs
