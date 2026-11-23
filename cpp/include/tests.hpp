#pragma once
// Built-in validation runs against the document (§6.2, §6.4, §12.6).

#include "params.hpp"

#include <iosfwd>

namespace vs {

// ICE: trim drift (C2), step responses t10/t63/t90, t63 vs speed, AEB -0.5 g.
// Returns the number of failed checks.
int test_ice(const Params& p, std::ostream& os);

// EV: trim drift (C2), start from 0, step responses, AEB -0.5 g, energy (C6).
int test_ev(const Params& p, std::ostream& os);

// Closed loop (upper controller + leader): T0 overshoot (C1), S2, S3 (C3).
int test_loop(const Params& p, std::ostream& os);

} // namespace vs