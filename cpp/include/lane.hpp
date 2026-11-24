#pragma once
// One closed loop: ego vehicle (IceVehicle or EvVehicle) + leader + upper
// controller + scenario (§12.9). Sensors are ideal (no delay, unit gain).
//
// step() advances one plant step dt. Every N = Ts_ctrl/dt steps the upper
// controller runs first and its a_des is held (ZOH) until the next tick.

#include "leader.hpp"
#include "params.hpp"
#include "scenario.hpp"
#include "upper_controller.hpp"

#include <cmath>
#include <limits>
#include <string>

namespace vs {

template <class Car>
class Lane {
public:
    Lane(const Params& p, std::string name)
        : p_(p), name_(std::move(name)), car_(p),
          ctrl_(p.ctrl, p.lim, p.sim.Ts_ctrl), scn_(p.scn) {}

    // Initial conditions from the scenario (§12.9).
    void reset() {
        const auto& s = p_.scn;
        scn_.reset();
        car_.trim(s.v0, 0.0);
        const double d0 = s.d_init >= 0.0 ? s.d_init : p_.ctrl.d_ref(s.v0);
        lead_.reset(d0 + p_.lead.L_veh, s.v_lead0);
        ctrl_.reset(0.0);
        n_ = 0;
        N_ = static_cast<long>(std::llround(p_.sim.Ts_ctrl / car_.dt()));
        a_des_ = 0.0;
        collided_ = false;
        d_min_ = std::numeric_limits<double>::infinity();
        update_target();
    }

    void step() {
        const double t = car_.t();

        if (scn_.cut_in_now(t))                           // S6: leader appears
            lead_.reset(car_.pos() + p_.lead.L_veh + scn_.params().cutin_distance,
                        scn_.params().v_lead0);

        if (n_ % N_ == 0) {                               // controller tick
            update_target();
            UpperController::Inputs in;
            in.v         = car_.v();
            in.d         = d();
            in.v_lead    = lead_.v;
            in.target    = target_;
            in.v_set     = scn_.v_set(t);
            in.ll_sat_hi = car_.out().ll.sat_hi;
            in.ll_sat_lo = car_.out().ll.sat_lo;
            in.engaged   = car_.engaged();
            a_des_ = ctrl_.update(in).a_des;
        }

        lead_.step(scn_.a_lead(t, lead_.v), car_.dt());
        car_.step(a_des_);
        ++n_;

        if (scn_.leader_on_lane(car_.t())) {
            const double dd = d();
            d_min_ = std::min(d_min_, dd);
            if (dd <= 0.0) collided_ = true;
        }
    }

    // ---- accessors
    double t() const                     { return car_.t(); }
    const std::string& name() const      { return name_; }
    const Car& car() const               { return car_; }
    const Leader& leader() const         { return lead_; }
    const UpperController& ctrl() const  { return ctrl_; }
    UpperController& ctrl()              { return ctrl_; }
    const Scenario& scenario() const     { return scn_; }
    Scenario& scenario()                 { return scn_; }
    double a_des() const                 { return a_des_; }
    bool target() const                  { return target_; }
    bool leader_on_lane() const          { return scn_.leader_on_lane(car_.t()); }
    bool collided() const                { return collided_; }
    double d_min() const                 { return d_min_; }
    bool is_tick() const                 { return n_ % N_ == 0; }   // next step is a tick

    // Gap between ego front bumper and leader rear bumper.
    double d() const { return lead_.x - car_.pos() - p_.lead.L_veh; }

private:
    void update_target() {
        const double t = car_.t();
        const double dd = d();
        target_ = scn_.leader_on_lane(t) && scn_.target_kept(t) && dd > 0.0 &&
                  dd < p_.ctrl.d_det;
    }

    const Params& p_;
    std::string name_;
    Car car_;
    Leader lead_;
    UpperController ctrl_;
    Scenario scn_;

    long   n_ = 0, N_ = 1;
    double a_des_ = 0.0;
    bool   target_ = false;
    bool   collided_ = false;
    double d_min_ = 0.0;
};

} // namespace vs