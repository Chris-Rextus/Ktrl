#include "upper_controller.hpp"

namespace vs {

const UpperController::Outputs& UpperController::update(const Inputs& in) {
    Outputs o;
    o.e_v = in.v_set - in.v;

    // (b) follow law (static)
    bool follow_possible = in.target;
    if (follow_possible) {
        o.d_ref = c_.d0 + c_.h * in.v;
        o.e_s   = in.d - o.d_ref;                                  // > 0: too far
        o.a_sv  = ((in.v_lead - in.v) + c_.lambda * o.e_s) / c_.h;
    }

    // (a) cruise PI, backward Euler: I[k] = I[k-1] + k_i*Ts*e_v[k]
    const double I_try = I_ + c_.k_i * Ts_ * o.e_v;
    auto select = [&](double I) {
        o.a_cr = c_.k_p * o.e_v + I;
        o.mode = (follow_possible && o.a_sv < o.a_cr) ? FOLLOW : CRUISE;
        const double a_brut = o.mode == FOLLOW ? o.a_sv : o.a_cr;
        o.a_des = sat(a_brut);
    };
    select(I_try);

    // (d) conditional integration
    const bool up   = o.e_v > 0.0;
    const bool down = o.e_v < 0.0;
    const bool a_sat_dir  = (o.a_des >= lim_.a_max && up) || (o.a_des <= lim_.a_min && down);
    const bool ll_sat_dir = (in.ll_sat_hi && up) || (in.ll_sat_lo && down);

    if (!in.engaged) {
        select(I_);                          // ICE clutch open: integrator frozen
    } else if (o.mode == CRUISE) {
        if (!a_sat_dir && !ll_sat_dir) {
            I_ = I_try;
            o.integrating = true;
        } else {
            select(I_);                      // keep the old integral
        }
    } else {
        // follow mode: track so that returning to cruise is bumpless
        I_ = sat(o.a_des - c_.k_p * o.e_v);
    }

    o.I = I_;
    out_ = o;
    return out_;
}

} // namespace vs