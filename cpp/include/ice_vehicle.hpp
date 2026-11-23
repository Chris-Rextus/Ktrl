#pragma once
// Gasoline engine + vehicle (document §3) with its lower-level controller
// (§3.7), friction brakes (§2), torque delay and clutch logic (§3.6, §12.4).
//
// The continuous plant (p_m, v, x, F_b) is integrated by odeint over one step
// dt with all inputs held constant (theta_th, delayed torque, delayed brake
// command). The lower level, the delay lines and the clutch run between steps.

#include "delay_line.hpp"
#include "params.hpp"

#include <array>

namespace vs {

class IceVehicle {
public:
    using state_t = std::array<double, 4>;
    enum : int { PM = 0, V = 1, X = 2, FB = 3 };

    // Lower-level controller output (§3.7 + flags of §12.3)
    struct LowLevel {
        double theta_th = 0.0;  // rad
        double Fb_cmd   = 0.0;  // N
        double p_des    = 0.0;  // Pa
        bool   sat_hi   = false;
        bool   sat_lo   = false;
    };

    // Everything worth logging after a step
    struct Outputs {
        LowLevel ll;
        double a_des   = 0.0;   // m/s2 (input held during the step)
        double a       = 0.0;   // m/s2 actual acceleration over the last step
        double T_e     = 0.0;   // N.m  net torque now
        double T_e_eff = 0.0;   // N.m  delayed torque applied during the step
        double F_t     = 0.0;   // N    traction force at the wheels
        double rpm     = 0.0;
        bool   clutch_closed = true;
    };

    explicit IceVehicle(const Params& p);

    // Put the car at equilibrium at speed v0 on the current road (§3.8).
    // Throws if no equilibrium exists. Below v_min the clutch starts open.
    void trim(double v0, double x0 = 0.0);

    // Advance one integration step dt with a_des held constant.
    void step(double a_des);

    double t() const                { return t_; }
    double dt() const               { return dt_; }
    const state_t& state() const    { return x_; }
    double v() const                { return x_[V]; }
    double pos() const              { return x_[X]; }
    const Outputs& out() const      { return out_; }
    double m_eff() const;           // depends on clutch state
    bool   engaged() const          { return clutch_closed_; }

    // Lower level as a pure function of the current state (public for tests).
    LowLevel lower_level(double a_des) const;

private:
    double net_torque() const;                  // T_e now (incl. fuel cut)
    double traction_force(double T_eff) const;  // F_t from delayed torque
    void   rhs(const state_t& x, state_t& dx, double theta, double T_eff,
               double Fb_cmd_del) const;

    const Params& p_;
    const IceParams& e_;
    double dt_;
    bool   use_rk4_;

    state_t x_{};
    double  t_ = 0.0;
    bool    clutch_closed_ = true;

    DelayLine<double> torque_delay_;  // th_e
    DelayLine<double> brake_delay_;   // th_b
    Outputs out_;
};

} // namespace vs