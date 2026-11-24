#pragma once
// Scenario presets T0, S1..S6 (§12.8). A preset overwrites the generic
// [scenario] fields and the simulation duration; 'custom' leaves them as read.

#include "params.hpp"

#include <string>
#include <vector>

namespace vs {

const std::vector<std::string>& preset_names();      // T0, S1, ..., S6

// Returns false if the name is unknown. 'custom' -> true, nothing changed.
bool apply_preset(const std::string& name, ScenarioParams& s, double& duration);

// One-line description for logs and the batch summary.
std::string preset_description(const std::string& name);

} // namespace vs