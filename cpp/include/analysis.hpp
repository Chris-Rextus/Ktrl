#pragma once
// Deep analysis mode:  vehicle_sim [config] --analyze <kind> [key=value ...]
// Prints one JSON object on stdout (the viewer's Analysis page reads it).
//
// kinds
//   plant    open-loop lower level + vehicle: a_des step -> a (delays, rise times,
//            speed dependence, model time constants)
//   steps    closed loop: speed loop (v_set step) and distance loop (leader slows
//            down), ICE / EV / ideal plant (same controller, a = a_des)
//   bode     frequency responses: plant a_des -> a, speed loop v_set -> v,
//            following loop v_lead -> v (string stability), with theory curves
//   min_gap  solvers: smallest following distance, time gap and initial gap that
//            avoid a collision when the leader brakes; curves vs braking and speed
//   sweep    1D or 2D sweep of a controller / scenario parameter, metrics per run
//
// All runs use the parameters of the config file (no [runtime] overrides) and
// are independent, so they run in parallel on every core.

#include "params.hpp"

#include <map>
#include <ostream>
#include <string>

namespace vs {

using Args = std::map<std::string, std::string>;

// Returns 0 on success. Errors are reported as {"error": "..."} on os.
int run_analysis(const Params& p, const std::string& kind, const Args& args, std::ostream& os);

} // namespace vs