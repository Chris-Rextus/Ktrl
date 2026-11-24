#include "presets.hpp"

namespace vs {

namespace {

ScenarioParams blank(const std::string& name) {
    ScenarioParams s{};
    s.preset             = name;
    s.v_set_step_time    = -1.0;
    s.leader_present     = false;
    s.d_init             = -1.0;   // auto: d0 + h*v0
    s.lead_accel         = 0.0;
    s.lead_accel_start   = 0.0;
    s.lead_v_target      = 0.0;
    s.target_appear_time = -1.0;
    s.cutin_distance     = 20.0;
    s.target_lost_time   = -1.0;
    return s;
}

} // namespace

const std::vector<std::string>& preset_names() {
    static const std::vector<std::string> names = {"T0", "S1", "S2", "S3", "S4", "S5", "S6"};
    return names;
}

std::string preset_description(const std::string& n) {
    if (n == "T0") return "linearity: v_set 30 -> 30.5 m/s at 5 s, no leader";
    if (n == "S1") return "cruise step: v_set 20 -> 30 m/s at 5 s, no leader";
    if (n == "S2") return "steady following at 25 m/s, v_set 30";
    if (n == "S3") return "leader -1 m/s2 from 10 s, 30 -> 20 m/s";
    if (n == "S4") return "leader +1 m/s2 from 10 s, 20 -> 30 m/s, target lost at 40 s, v_set 28";
    if (n == "S5") return "leader -3 m/s2 from 10 s down to standstill";
    if (n == "S6") return "cut-in at 10 s: 20 m ahead, 22 m/s, ego at 25 m/s";
    if (n == "custom") return "custom ([scenario] fields)";
    return "?";
}

bool apply_preset(const std::string& name, ScenarioParams& s, double& duration) {
    if (name == "custom") return true;
    ScenarioParams p = blank(name);

    if (name == "T0") {
        p.v0 = 30; p.v_set = 30; p.v_set_step_time = 5; p.v_set_step_value = 30.5;
        duration = 40;
    } else if (name == "S1") {
        p.v0 = 20; p.v_set = 20; p.v_set_step_time = 5; p.v_set_step_value = 30;
        duration = 60;
    } else if (name == "S2") {
        p.v0 = 25; p.v_set = 30; p.leader_present = true; p.v_lead0 = 25;
        duration = 60;
    } else if (name == "S3") {
        p.v0 = 30; p.v_set = 30; p.leader_present = true; p.v_lead0 = 30;
        p.lead_accel = -1.0; p.lead_accel_start = 10; p.lead_v_target = 20;
        duration = 60;
    } else if (name == "S4") {
        p.v0 = 20; p.v_set = 28; p.leader_present = true; p.v_lead0 = 20;
        p.lead_accel = +1.0; p.lead_accel_start = 10; p.lead_v_target = 30;
        p.target_lost_time = 40;
        duration = 80;
    } else if (name == "S5") {
        p.v0 = 20; p.v_set = 20; p.leader_present = true; p.v_lead0 = 20;
        p.lead_accel = -3.0; p.lead_accel_start = 10; p.lead_v_target = 0;
        duration = 40;
    } else if (name == "S6") {
        p.v0 = 25; p.v_set = 25; p.v_lead0 = 22;
        p.target_appear_time = 10; p.cutin_distance = 20;
        duration = 40;
    } else {
        return false;
    }
    p.v_set_step_value = p.v_set_step_time >= 0 ? p.v_set_step_value : p.v_set;
    s = p;
    return true;
}

} // namespace vs