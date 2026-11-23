#pragma once
// Electric vehicle: DC motor + half-bridge converter + vehicle (document §4),
// discrete current loop and regen/friction blending (§4.7, §12.3), friction
// brakes (§2).
//
// Continuous plant integrated by odeint over one step dt with V_c held
// (zero-order hold of the PWM average) and the delayed brake command held.
// The plant also integrates three energy accumulators for the §6.6 balance.

#include "delay_line.hpp"
#include "params.hpp"

#include <array>

namespace vs {

class EvVehicle {
public:
    // i_a, v, x, F_b, E_bat, E_joule, E_mech
    using state_t = std::array<double, 7>;
    enum : int { IA = 0, V = 1, X = 2, FB = 3, EBAT = 4, EJ = 5, EM = 6 };

    struct LowLevel {
        double i_ref   = 0.0;   // A  unsaturated reference
        double i_ref_s = 0.0;   // A  saturated reference
        double i_lim   = 0.0;   // A
        double Fb_cmd  = 0.0;   // N
        bool   sat_hi  = false;
        bool   sat_lo  = false;
    };

    struct Outputs {
        LowLevel ll;
        double a_des  = 0.0;    // m/s2
        double a      = 0.0;    // m/s2 actual acceleration over the last step
        double V_c    = 0.0;    // V   armature voltage applied during the step
        double D      = 0.0;    // -   duty cycle
        double T_e    = 0.0;    // N.m electromagnetic torque (end of step)
        double F_t    = 0.0;    // N   traction force at the wheels
        double P_bat  = 0.0;    // W   V_c * i_a (>0 traction, <0 regen)
        double rpm    = 0.0;
    };

    explicit EvVehicle(const Params& p);

    // Equilibrium at speed v0 on the current road (§4.8). v0 = 0 is allowed.
    void trim(double v0, double x0 = 0.0);

    // Advance one integration step dt with a_des held constant.
    void step(double a_des);

    double t() const                { return t_; }
    double dt() const               { return dt_; }
    const state_t& state() const    { return x_; }
    double v() const                { return x_[V]; }
    double pos() const              { return x_[X]; }
    const Outputs& out() const      { return out_; }
    double m_eff() const            { return m_.m_eff; }
    double i_a0() const             { return i_a0_; }
    bool   engaged() const          { return true; }   // no clutch

    // E_bat - E_joule - E_mech - E_inductance (should be ~0), §6.6
    double energy_residual() const;

    LowLevel lower_level(double a_des) const;   // §4.7 force/current part

private:
    double traction_force(double i_a) const;
    void   rhs(const state_t& x, state_t& dx, double V_c, double Fb_cmd_del) const;

    const Params& p_;
    const EvParams& m_;
    double dt_;
    bool   use_rk4_;
    double q0_, q1_;                 // discrete current PI (backward Euler)

    state_t x_{};
    double  t_ = 0.0;
    double  i_a0_ = 0.0;             // initial current (for E_inductance)
    double  u_i_ = 0.0;              // PI output (without back-EMF feedforward)
    double  e_prev_ = 0.0;           // previous current error

    DelayLine<double> brake_delay_;
    Outputs out_;
};

} // namespace vs