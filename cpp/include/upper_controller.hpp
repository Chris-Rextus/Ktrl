#pragma once
// Upper-level controller, discrete at Ts_ctrl (§12.2), ideal sensors:
//   cruise : PI on speed error (backward Euler)
//   follow : headway law, d_ref = d0 + h*v (time gap) or d_set (fixed);
//            a_sv = ((v_lead - v) + lambda*(d - d_ref)) / h
//   a_des  = sat( min(a_cr, a_sv) ), conditional integration + tracking.

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
        double I = 0.0;
        int    mode = CRUISE;
        bool   integrating = false;
    };

    UpperController(const CtrlParams& c, const LimitParams& lim, double Ts)
        : c_(c), lim_(lim), Ts_(Ts) {}

    void reset(double I0 = 0.0) { I_ = I0; out_ = Outputs{}; out_.I = I0; }

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
    Outputs out_;
};

} // namespace vs