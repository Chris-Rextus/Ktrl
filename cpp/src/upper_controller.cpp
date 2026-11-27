#include "upper_controller.hpp"

namespace vs {

const UpperController::Outputs& UpperController::update(const Inputs& in) {
    Outputs o;
    o.e_v = in.v_set - in.v;

    // (b) follow law (static)
    bool follow_possible = in.target;
    if (follow_possible) {
        o.d_ref = c_.d_ref(in.v);
        o.e_s   = in.d - o.d_ref;                                  // > 0: too far
        o.a_sv  = ((in.v_lead - in.v) + c_.lambda * o.e_s) / c_.h;
    }

    // (a) cruise PID, backward Euler: I[k] = I[k-1] + k_i*Ts*e_v[k]
    //     D[k] = (tau_f*D[k-1] - k_d*(v[k] - v[k-1])) / (tau_f + Ts)   (on the measurement)
    const double I_try = I_ + c_.k_i * Ts_ * o.e_v;
    if (c_.k_d > 0.0 && has_v_) {
        const double tf = c_.tau_f();
        D_ = (tf * D_ - c_.k_d * (in.v - v_prev_)) / (tf + Ts_);
    } else {
        D_ = 0.0;
    }
    v_prev_ = in.v; has_v_ = true;
    auto select = [&](double I) {
        o.a_cr = c_.k_p * o.e_v + I + D_;
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
        // follow mode: track so that returning to cruise is bumpless.
        // Not bounded to [a_min, a_max] (unlike §12.2 d): with e_v = 10 m/s,
        // bumpless transfer needs I = a_des - 7.5, which that bound would clip,
        // giving a jump of up to 2.5 m/s2 at the switch (criterion C5).
        constexpr double I_LIM = 50.0;   // safety bound only
        const double I_track = o.a_des - c_.k_p * o.e_v - D_;
        I_ = I_track < -I_LIM ? -I_LIM : (I_track > I_LIM ? I_LIM : I_track);
    }

    o.I = I_;
    o.D = D_;
    out_ = o;
    return out_;
}

} // namespace vs
