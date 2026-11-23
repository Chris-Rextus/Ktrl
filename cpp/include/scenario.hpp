#pragma once
// Scenario driver (§12.8): set speed, leader acceleration profile, target
// appearance (cut-in) and loss. Built from the generic [scenario] fields.

#include "params.hpp"

#include <optional>

namespace vs {

class Scenario {
public:
    explicit Scenario(const ScenarioParams& s) : s_(s) {}

    const ScenarioParams& params() const { return s_; }

    // Driver set speed at time t
    double v_set(double t) const {
        if (v_set_override_) return *v_set_override_;
        return (s_.v_set_step_time >= 0.0 && t >= s_.v_set_step_time) ? s_.v_set_step_value
                                                                       : s_.v_set;
    }

    // Leader acceleration command at time t for current leader speed.
    // Applies lead_accel from lead_accel_start until lead_v_target is reached,
    // then holds the speed (latched).
    double a_lead(double t, double v_lead) {
        if (lead_override_) return *lead_override_;
        if (target_reached_ || t < s_.lead_accel_start || s_.lead_accel == 0.0) return 0.0;
        const bool reached = s_.lead_accel > 0.0 ? v_lead >= s_.lead_v_target
                                                 : v_lead <= s_.lead_v_target;
        if (reached) { target_reached_ = true; return 0.0; }
        return s_.lead_accel;
    }

    // Is the leader physically on our lane at time t?
    bool leader_on_lane(double t) const {
        if (s_.target_appear_time >= 0.0) return t >= s_.target_appear_time;
        return s_.leader_present;
    }

    // Is the leader still tracked by the radar logic at time t (S4 loss)?
    bool target_kept(double t) const {
        return !(s_.target_lost_time >= 0.0 && t >= s_.target_lost_time);
    }

    // True exactly once, on the first call at/after target_appear_time.
    bool cut_in_now(double t) {
        if (cut_in_done_ || s_.target_appear_time < 0.0 || t < s_.target_appear_time) return false;
        cut_in_done_ = true;
        return true;
    }

    void reset() { target_reached_ = false; cut_in_done_ = false; }

    // Live overrides (runtime section). std::nullopt = follow the scenario.
    void set_v_set_override(std::optional<double> v) { v_set_override_ = v; }
    void set_lead_override(std::optional<double> a)  { lead_override_ = a; }

private:
    ScenarioParams s_;
    bool target_reached_ = false;
    bool cut_in_done_ = false;
    std::optional<double> v_set_override_;
    std::optional<double> lead_override_;
};

} // namespace vs