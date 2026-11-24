#pragma once
// Batch mode (§12.10): runs scenarios at full speed for the ICE and the EV,
// writes one output file per run (same format as the live stream) and a
// summary table with the validation criteria C3-C7.

#include "params.hpp"

#include <iosfwd>
#include <string>
#include <vector>

namespace vs {

// presets empty -> all (T0, S1..S6). Returns the number of failed criteria.
int run_batch(const Params& base, const std::vector<std::string>& presets,
              const std::string& out_dir, std::ostream& os);

} // namespace vs