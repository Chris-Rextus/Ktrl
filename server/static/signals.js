// Signal catalogue: what each output column means, its unit, and how to draw it.
// Column names in the output file are "<lane>_<signal>" (lane = ice | ev).
//
//   shared : the same for both lanes (leader, set speed): drawn once, in a neutral colour
//   when   : only drawn while this flag column is 1 (e.g. d only when a car is ahead)
//   step   : discrete signal (mode, flags): drawn as steps with a fixed 0..1 range

export const LANES = ["ice", "ev"];
export const LANE_NAME = { ice: "ICE", ev: "EV" };

export const SIGNALS = {
  // motion
  x:        { label: "Position", unit: "m", group: "Motion" },
  v:        { label: "Speed", unit: "m/s", group: "Motion" },
  a:        { label: "Acceleration", unit: "m/s²", group: "Motion" },
  // controller
  a_des:    { label: "Commanded acceleration a_des", unit: "m/s²", group: "Controller" },
  a_cr:     { label: "Cruise law a_cr", unit: "m/s²", group: "Controller" },
  a_sv:     { label: "Follow law a_sv", unit: "m/s²", group: "Controller", when: "target" },
  mode:     { label: "Mode (0 speed, 1 distance)", unit: "", group: "Controller", step: true },
  I:        { label: "Integral state I", unit: "m/s²", group: "Controller" },
  v_set:    { label: "Set speed", unit: "m/s", group: "Controller", shared: true },
  e_v:      { label: "Speed error e_v", unit: "m/s", group: "Controller" },
  d:        { label: "Distance to car ahead", unit: "m", group: "Controller", when: "lead_on" },
  d_ref:    { label: "Target distance d_ref", unit: "m", group: "Controller", when: "target" },
  e_s:      { label: "Spacing error e_s", unit: "m", group: "Controller", when: "target" },
  target:   { label: "Target detected", unit: "", group: "Controller", step: true },
  // leader
  lead_on:  { label: "Leader on lane", unit: "", group: "Leader", step: true, shared: true },
  lead_x:   { label: "Leader position", unit: "m", group: "Leader", shared: true, when: "lead_on" },
  lead_v:   { label: "Leader speed", unit: "m/s", group: "Leader", shared: true, when: "lead_on" },
  lead_a:   { label: "Leader acceleration", unit: "m/s²", group: "Leader", shared: true, when: "lead_on" },
  // forces / lower level
  F_t:      { label: "Traction force F_t", unit: "N", group: "Forces" },
  F_b:      { label: "Brake force F_b", unit: "N", group: "Forces" },
  F_b_cmd:  { label: "Brake command", unit: "N", group: "Forces" },
  sat_hi:   { label: "Saturated high", unit: "", group: "Forces", step: true },
  sat_lo:   { label: "Saturated low", unit: "", group: "Forces", step: true },
  collided: { label: "Collision", unit: "", group: "Forces", step: true },
  // ICE only
  theta_th: { label: "Throttle angle θ_th", unit: "rad", group: "ICE" },
  p_m:      { label: "Manifold pressure p_m", unit: "Pa", group: "ICE" },
  T_e:      { label: "Engine torque T_e", unit: "N·m", group: "ICE" },
  clutch:   { label: "Clutch closed", unit: "", group: "ICE", step: true },
  // EV only
  i_a:      { label: "Motor current i_a", unit: "A", group: "EV" },
  i_ref:    { label: "Current reference i_ref", unit: "A", group: "EV" },
  D:        { label: "Duty cycle D", unit: "", group: "EV" },
  V_c:      { label: "Motor voltage V_c", unit: "V", group: "EV" },
  P_bat:    { label: "Battery power P_bat", unit: "W", group: "EV" },
  E_bat:    { label: "Battery energy E_bat", unit: "J", group: "EV" },
  // both
  rpm:      { label: "Motor / engine speed", unit: "rpm", group: "Motion" },
};

export const GROUP_ORDER = ["Motion", "Controller", "Leader", "Forces", "ICE", "EV"];

export const sigInfo = (s) => SIGNALS[s] || { label: s, unit: "", group: "Other" };

// Default chart layout of the Plots view.
export const DEFAULT_CHARTS = [
  { title: "Speed", sigs: ["v", "v_set", "lead_v"] },
  { title: "Distance and target distance", sigs: ["d", "d_ref"], zero: true },
  { title: "Acceleration", sigs: ["a", "a_des"] },
  { title: "Controller mode", sigs: ["mode"] },
];

// Available signals in a list of columns (strip the lane prefix).
export function signalsIn(columns) {
  const set = new Set();
  for (const c of columns) {
    const m = c.match(/^(ice|ev)_(.+)$/);
    if (m) set.add(m[2]);
  }
  return [...set];
}
