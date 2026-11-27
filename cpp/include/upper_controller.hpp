#pragma once
// Upper-level controller (§12.2), discrete at Ts_ctrl.
//   cruise : a_cr = PID: k_p*e_v + k_i*int(e_v) - k_d*dv/dt (filtered, on the
//            measured speed: no kick on v_set steps), backward Euler
//   follow : a_sv = ((v_lead - v) + lambda*(d - d_ref)) / h
//   a_des  = sat( min(a_cr, a_sv) )  -> lower level §3.7 / §4.7

#include "params.hpp"

namespace vs {

class UpperController {
public:
    enum Mode : int { CRUISE = 0, FOLLOW = 1 };

    struct Inputs {
        double v       = 0.0;   // ego speed
        double d       = 0.0;   // gap to leader
        double v_lead  = 0.0;   // leader speed
        bool   target  = false; // valid target (radar)
        double v_set   = 0.0;   // driver set speed
        // lower-level feedback (anti-windup, §12.2 d / §12.3)
        bool   ll_sat_hi = false;
        bool   ll_sat_lo = false;
        bool   engaged   = true; // ICE clutch closed
    };

    struct Outputs {
        double a_des = 0.0, a_cr = 0.0, a_sv = 0.0;
        double e_v = 0.0, e_s = 0.0, d_ref = 0.0;
        double I = 0.0;          // integral [m/s2]
        double D = 0.0;          // derivative term [m/s2]
        int    mode = CRUISE;
        bool   integrating = false;
    };

    UpperController(const CtrlParams& c, const LimitParams& lim, double Ts)
        : c_(c), lim_(lim), Ts_(Ts) {}

    void reset(double I0 = 0.0) {
        I_ = I0;
        D_ = 0.0; has_v_ = false;
        out_ = Outputs{}; out_.I = I0;
    }

    // Gains may be changed at run time (live reconfiguration).
    CtrlParams& gains() { return c_; }

    const Outputs& update(const Inputs& in);
    const Outputs& out() const { return out_; }

private:
    double sat(double a) const { return a < lim_.a_min ? lim_.a_min : (a > lim_.a_max ? lim_.a_max : a); }

    CtrlParams  c_;
    LimitParams lim_;
    double Ts_;
    double I_ = 0.0;
    double D_ = 0.0;             // filtered derivative state
    double v_prev_ = 0.0;
    bool   has_v_ = false;
    Outputs out_;
};

} // namespace vs
