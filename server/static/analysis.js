// Analysis page: runs `vehicle_sim --analyze <kind>` through POST /api/analysis
// and turns the JSON into tiles, plots, tables and explanations.

import { fmt, Heatmap, redrawAll, XYPlot } from "./plot.js";

export { redrawAll };

const $ = (id) => document.getElementById(id);
const C = { ice: "var(--ice)", ev: "var(--ev)", ideal: "var(--target)", lead: "var(--lead)",
            bound: "var(--muted)", cfg: "var(--accent)", bad: "var(--bad)" };
const NAME = { ice: "ICE", ev: "EV", ideal: "Ideal plant" };
const STEP_COLORS = ["#f2994a", "#e3b341", "#6ea8fe", "#b48cff", "#e5534b"];
const ms = (s) => (s == null ? "–" : `${fmt(s * 1000, 3)} ms`);
const num = (v, d = 3) => fmt(v, d);
const abs = Math.abs;

// --------------------------------------------------------------------------- definitions
const SWEEP_PARAMS = {
  h: { label: "time gap h [s]", range: [0.3, 3] },
  d_set: { label: "fixed distance d_set [m]", range: [5, 80] },
  k_p: { label: "speed gain k_p [1/s]", range: [0.2, 2] },
  k_i: { label: "speed gain k_i [1/s²]", range: [0.02, 0.6] },
  k_d: { label: "speed gain k_d (D) [–]", range: [0, 1.5] },
  lambda: { label: "distance gain λ [1/s]", range: [0.1, 1.5] },
  d0: { label: "standstill distance d0 [m]", range: [0, 15] },
  d_det: { label: "radar range d_det [m]", range: [30, 250] },
  a_min: { label: "braking limit |a_min| [m/s²]", range: [1, 9] },
  a_max: { label: "acceleration limit a_max [m/s²]", range: [0.5, 4] },
  a_b: { label: "leader braking |a_b| [m/s²]", range: [1, 9] },
  v0: { label: "initial speed v0 [m/s]", range: [10, 40] },
  v_set: { label: "set speed v_set [m/s]", range: [10, 40] },
  v_lead0: { label: "leader speed v_lead0 [m/s]", range: [5, 40] },
  d_init: { label: "initial gap d_init [m]", range: [2, 80] },
};
const METRICS = {
  d_min: { label: "smallest gap d_min", unit: "m" },
  collided: { label: "collision (1 = yes)", unit: "" },
  a_min: { label: "hardest braking a_min", unit: "m/s²" },
  a_max: { label: "strongest acceleration a_max", unit: "m/s²" },
  jerk_max: { label: "max jerk", unit: "m/s³" },
  es_max: { label: "max |spacing error|", unit: "m" },
  t_settle: { label: "last time |e_s| > 0.5 m", unit: "s" },
  v_overshoot: { label: "speed overshoot", unit: "%" },
  v_settle: { label: "speed settling time", unit: "s" },
  v_end: { label: "final speed", unit: "m/s" },
  t_collision: { label: "collision time", unit: "s" },
};

const DEFS = {
  plant: {
    title: "Plant response", icon: "⚙",
    desc: "How fast each car turns a commanded acceleration into real acceleration (lower level + vehicle, no upper controller). Steps of +0.5, +1.5, −0.5, −2 and −4 m/s², plus the dependence on speed.",
    fields: [{ key: "v0", label: "Speed", unit: "m/s", value: 30, step: 1 }],
    render: renderPlant,
  },
  steps: {
    title: "Closed-loop responses", icon: "⤴",
    desc: "The speed loop (set-speed step) and the distance loop (the leader slows down), for the ICE, the EV and an ideal plant that does exactly a = a_des with the same controller. The ideal plant separates what the controller does from what the car adds.",
    fields: [
      { key: "v0", label: "Speed", unit: "m/s", value: 20, step: 1 },
      { key: "dv", label: "Set-speed step", unit: "m/s", value: 2, step: 0.5 },
      { key: "dvl", label: "Leader speed change", unit: "m/s", value: -8, step: 1 },
      { key: "a_lead", label: "Leader acceleration", unit: "m/s²", value: 3, step: 0.5 },
      { key: "t_end", label: "Duration", unit: "s", value: 40, step: 5 },
    ],
    render: renderSteps,
  },
  bode: {
    title: "Frequency response", icon: "∿",
    desc: "Sine inputs at many frequencies: plant (a_des → a), speed loop (v_set → v) and following loop (leader speed → ego speed). The last one is string stability: a gain above 0 dB means the car amplifies the leader's speed swings.",
    fields: [
      { key: "v0", label: "Speed", unit: "m/s", value: 25, step: 1 },
      { key: "n", label: "Frequencies per curve", unit: "", value: 14, step: 1 },
    ],
    render: renderBode,
  },
  min_gap: {
    title: "Minimum safe distance", icon: "⇥",
    desc: "Solvers (bisection on full simulations): the leader brakes from v0 to a stop. What is the smallest following distance, time gap and initial gap that still avoids a collision, for the ICE, the EV and the ideal plant? Plus curves against braking severity and speed.",
    fields: [
      { key: "v0", label: "Speed", unit: "m/s", value: 30, step: 1 },
      { key: "a_b", label: "Leader braking", unit: "m/s²", value: 5, step: 0.5 },
    ],
    render: renderMinGap,
  },
  sweep: {
    title: "Parameter sweep", icon: "▦",
    desc: "Vary one parameter (curves) or two (heatmaps) and run a scenario for every value. Collisions are marked. Use it to find safe regions and trade-offs.",
    fields: [
      { key: "scenario", label: "Scenario", type: "select", value: "brake",
        options: [["brake", "Leader brakes to a stop"], ["T0", "T0"], ["S1", "S1"], ["S2", "S2"], ["S3", "S3"], ["S4", "S4"], ["S5", "S5"], ["S6", "S6"]] },
      { key: "v0", label: "Speed (brake)", unit: "m/s", value: 30, step: 1, showIf: (f) => f.scenario === "brake" },
      { key: "a_b", label: "Leader braking (brake)", unit: "m/s²", value: 5, step: 0.5, showIf: (f) => f.scenario === "brake" },
      { key: "x", label: "Parameter x", type: "select", value: "h", options: Object.entries(SWEEP_PARAMS).map(([k, v]) => [k, v.label]) },
      { key: "x0", label: "x from", value: 0.3, step: 0.1 },
      { key: "x1", label: "x to", value: 3, step: 0.1 },
      { key: "nx", label: "x points", value: 15, step: 1 },
      { key: "y", label: "Parameter y (2D)", type: "select", value: "",
        options: [["", "— none (curves) —"], ...Object.entries(SWEEP_PARAMS).map(([k, v]) => [k, v.label])] },
      { key: "y0", label: "y from", value: 1, step: 0.1, showIf: (f) => f.y },
      { key: "y1", label: "y to", value: 9, step: 0.1, showIf: (f) => f.y },
      { key: "ny", label: "y points", value: 12, step: 1, showIf: (f) => f.y },
    ],
    render: renderSweep,
  },
};

// --------------------------------------------------------------------------- page
let api = null;            // {POST, toast, cfgVal}
let current = "min_gap";
const lastResult = {};
const formState = {};
let plots = [];

export function initAnalysis(a) {
  api = a;
  try { current = localStorage.getItem("ktrl.analysis.current") || current; } catch { /* */ }
  if (!DEFS[current]) current = "min_gap";
  try { Object.assign(formState, JSON.parse(localStorage.getItem("ktrl.analysis.forms") || "{}")); } catch { /* */ }
  const nav = $("an-nav");
  for (const [k, d] of Object.entries(DEFS)) {
    const b = document.createElement("button");
    b.dataset.an = k;
    b.innerHTML = `<span class="an-ico">${d.icon}</span><span><b>${d.title}</b><small>${d.desc.split(".")[0]}.</small></span>`;
    b.addEventListener("click", () => select(k));
    nav.appendChild(b);
  }
  $("an-run").addEventListener("click", run);
  $("an-json").addEventListener("click", () => {
    const r = lastResult[current];
    if (!r) return api.toast("Run the analysis first", true);
    const blob = new Blob([JSON.stringify(r, null, 1)], { type: "application/json" });
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = `ktrl_analysis_${current}.json`;
    a2.click();
    setTimeout(() => URL.revokeObjectURL(a2.href), 2000);
  });
  select(current);
}

function select(k) {
  current = k;
  try { localStorage.setItem("ktrl.analysis.current", k); } catch { /* */ }
  document.querySelectorAll("#an-nav button").forEach((b) => b.classList.toggle("on", b.dataset.an === k));
  const d = DEFS[k];
  $("an-title").textContent = d.title;
  $("an-desc").textContent = d.desc;
  buildForm();
  clearResults();
  if (lastResult[k]) render(lastResult[k]);
  else $("an-results").innerHTML = `<div class="an-empty">Set the inputs and press <b>Run analysis</b>.
    <br><span class="muted">It uses the parameters saved in sim_config.txt${$("an-runtime").checked ? " plus the live overrides" : ""}.</span></div>`;
}

function values() {
  const st = (formState[current] ??= {});
  const out = {};
  for (const f of DEFS[current].fields) out[f.key] = st[f.key] ?? f.value;
  return out;
}

function buildForm() {
  const form = $("an-form");
  form.innerHTML = "";
  const st = (formState[current] ??= {});
  const vals = values();
  for (const f of DEFS[current].fields) {
    if (f.showIf && !f.showIf(vals)) continue;
    const lab = document.createElement("label");
    lab.className = "an-field";
    lab.innerHTML = `<span>${f.label}${f.unit ? ` <small>${f.unit}</small>` : ""}</span>`;
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      for (const [v, t] of f.options) input.add(new Option(t, v, false, String(vals[f.key]) === v));
    } else {
      input = document.createElement("input");
      input.type = "number"; input.step = f.step ?? "any"; input.value = vals[f.key];
    }
    input.addEventListener("change", () => {
      st[f.key] = f.type === "select" ? input.value : +input.value;
      if (current === "sweep" && (f.key === "x" || f.key === "y") && input.value) {
        const r = SWEEP_PARAMS[input.value].range;          // sensible default range
        st[f.key + "0"] = r[0]; st[f.key + "1"] = r[1];
      }
      try { localStorage.setItem("ktrl.analysis.forms", JSON.stringify(formState)); } catch { /* */ }
      if (f.type === "select") buildForm();
    });
    lab.appendChild(input);
    form.appendChild(lab);
  }
}

async function run() {
  const btn = $("an-run");
  const args = {};
  const vals = values();
  for (const f of DEFS[current].fields) {
    if (f.showIf && !f.showIf(vals)) continue;
    if (vals[f.key] === "" || vals[f.key] == null) continue;
    args[f.key] = vals[f.key];
  }
  btn.disabled = true;
  const t0 = performance.now();
  const kind = current;
  const timer = setInterval(() => { $("an-status").textContent = `running… ${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 200);
  try {
    const r = await api.POST("/api/analysis", { kind, args, use_runtime: $("an-runtime").checked });
    lastResult[kind] = r;
    $("an-status").textContent = `done in ${r.seconds?.toFixed(2)} s on ${r.threads} core${r.threads > 1 ? "s" : ""}` +
      (Object.keys(r.applied_changes || {}).length ? " · with live overrides" : "");
    if (current === kind) { clearResults(); render(r); }
  } catch (e) {
    $("an-status").textContent = "failed";
    api.toast(e.message, true);
  } finally {
    clearInterval(timer);
    btn.disabled = false;
  }
}

function clearResults() {
  for (const p of plots) p.destroy();
  plots = [];
  $("an-results").innerHTML = "";
}
function render(r) { DEFS[r.kind].render(r, $("an-results")); requestAnimationFrame(redrawAll); }

// --------------------------------------------------------------------------- building blocks
function section(host, title, sub) {
  const s = document.createElement("div");
  s.className = "an-section";
  s.innerHTML = `<h3>${title}${sub ? ` <small>${sub}</small>` : ""}</h3>`;
  host.appendChild(s);
  return s;
}
function tiles(host, items) {
  const box = document.createElement("div");
  box.className = "an-tiles";
  box.innerHTML = items.map((t) => `
    <div class="an-tile ${t.tone || ""}">
      <div class="lbl">${t.label}</div>
      <div class="val">${t.value}${t.unit ? `<small>${t.unit}</small>` : ""}</div>
      ${t.note ? `<div class="note">${t.note}</div>` : ""}
    </div>`).join("");
  host.appendChild(box);
}
function grid(host, cols = 2) {
  const g = document.createElement("div");
  g.className = "an-plots";
  g.style.setProperty("--cols", cols);
  host.appendChild(g);
  return g;
}
function xy(host, opts, series, extras) {
  const p = new XYPlot(host, opts).set(series, extras);
  plots.push(p);
  return p;
}
function heat(host, opts, data) {
  const p = new Heatmap(host, opts).set(data);
  plots.push(p);
  return p;
}
function why(host, title, paragraphs) {
  const d = document.createElement("div");
  d.className = "an-why";
  d.innerHTML = `<div class="an-why-h">💡 ${title}</div>` + paragraphs.filter(Boolean).map((p) => `<p>${p}</p>`).join("");
  host.appendChild(d);
}
function table(host, head, rows) {
  const t = document.createElement("div");
  t.className = "an-table-wrap";
  t.innerHTML = `<table class="an-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  host.appendChild(t);
}
const slice = (arr, i0, i1) => (arr ? arr.slice(i0, i1) : arr);
// interpolate x where y crosses level (first crossing from above)
function crossing(x, y, level) {
  for (let i = 1; i < x.length; i++) {
    if (y[i - 1] == null || y[i] == null) continue;
    if ((y[i - 1] - level) * (y[i] - level) <= 0 && y[i - 1] !== y[i]) {
      const f = (level - y[i - 1]) / (y[i] - y[i - 1]);
      if (x[i - 1] > 0 && x[i] > 0)                // log axis (Bode): interpolate in log f
        return Math.pow(10, Math.log10(x[i - 1]) + f * (Math.log10(x[i]) - Math.log10(x[i - 1])));
      return x[i - 1] + f * (x[i] - x[i - 1]);
    }
  }
  return null;
}
function interpAt(x, y, xv) {
  for (let i = 1; i < x.length; i++)
    if (x[i] >= xv && y[i] != null && y[i - 1] != null) {
      const f = (Math.log10(xv) - Math.log10(x[i - 1])) / (Math.log10(x[i]) - Math.log10(x[i - 1]));
      return y[i - 1] + f * (y[i] - y[i - 1]);
    }
  return null;
}

// =========================================================================== 1) plant
function renderPlant(r, host) {
  const m = r.model, t = r.t;
  const i0 = t.findIndex((x) => x >= 0), i1 = t.findIndex((x) => x > 1.0);
  const tt = slice(t, i0, i1).map((x) => x * 1000);
  const ice05 = r.cars.ice[0], ev05 = r.cars.ev[0];
  const sp = r.speed;
  const k10 = sp.v.indexOf(10), k40 = sp.v.indexOf(40);
  const ratio = ice05.t63 && ev05.t63 ? ice05.t63 / ev05.t63 : null;

  tiles(host, [
    { label: "ICE dead time", value: ms(ice05.dead).replace(" ms", ""), unit: "ms", note: `torque delay th_e = ${ms(m.th_e)}` },
    { label: `ICE 63 % time at ${r.v0} m/s`, value: ms(ice05.t63).replace(" ms", ""), unit: "ms", note: `th_e + τ_m = ${ms(m.th_e + m.tau_m_v0)}` },
    { label: "EV 63 % time", value: ms(ev05.t63).replace(" ms", ""), unit: "ms", note: `current loop 1/ω_ci = ${ms(m.tau_i)}`, tone: "good" },
    { label: "EV faster by", value: ratio ? `×${fmt(ratio, 2)}` : "–", note: "at +0.5 m/s²" },
    { label: "ICE 63 % at 10 → 40 m/s", value: `${ms(sp.ice_t63[k10]).replace(" ms", "")} → ${ms(sp.ice_t63[k40]).replace(" ms", "")}`, unit: "ms", note: "manifold fills faster at high rpm" },
  ]);

  const s1 = section(host, "Step responses", "a / a_step after the step (1 = reached the command)");
  const g1 = grid(s1);
  for (const car of ["ice", "ev"]) {
    xy(g1, { title: `${NAME[car]}: normalised acceleration`, xlabel: "time after step [ms]", ylabel: "a / a_step", height: 250 },
      r.cars[car].map((s, k) => ({ name: `${s.a_step > 0 ? "+" : ""}${s.a_step} m/s²`, color: STEP_COLORS[k],
        x: tt, y: slice(s.a, i0, i1).map((a) => a / s.a_step) })),
      { hlines: [{ y: 1, color: "var(--muted)" }, { y: 0.63, label: "63 %", color: "var(--muted)", dash: [2, 3] }],
        vlines: car === "ice" ? [{ x: m.th_e * 1000, label: "th_e", color: C.ice }, { x: m.th_b * 1000, label: "th_b", color: C.bad }]
                              : [{ x: m.th_b * 1000, label: "th_b (friction)", color: C.bad }] });
  }

  const s2 = section(host, "Speed dependence", "+0.5 m/s² step at each speed");
  const g2 = grid(s2);
  const theory = sp.v.map((_, i) => (m.th_e + sp.ice_tau_m[i]) * 1000);
  xy(g2, { title: "Time to 63 % vs speed", xlabel: "speed [m/s]", ylabel: "t63 [ms]", height: 240 }, [
    { name: "ICE measured", x: sp.v, y: sp.ice_t63.map((v) => v * 1000), color: C.ice, dots: true },
    { name: "ICE theory th_e + τ_m(v)", x: sp.v, y: theory, color: C.ice, dash: [5, 4], width: 1.2 },
    { name: "EV measured", x: sp.v, y: sp.ev_t63.map((v) => v * 1000), color: C.ev, dots: true },
  ], { yzero: true });
  xy(g2, { title: "ICE manifold time constant τ_m = 1/(K1·K3·v)", xlabel: "speed [m/s]", ylabel: "τ_m [ms]", height: 240 }, [
    { name: "τ_m", x: sp.v, y: sp.ice_tau_m.map((v) => v * 1000), color: C.ice, dots: true },
  ], { yzero: true, hlines: [{ y: m.th_e * 1000, label: "torque delay th_e", color: "var(--muted)" }] });

  const s3 = section(host, "All steps");
  const rows = [];
  for (const car of ["ice", "ev"])
    for (const s of r.cars[car]) {
      const sat = s.a_end != null && abs(s.a_end) < 0.9 * abs(s.a_step);
      const brakes = Math.max(...s.F_b) > 50;
      rows.push([NAME[car], `${s.a_step > 0 ? "+" : ""}${s.a_step}`, ms(s.dead), ms(s.t10), ms(s.t63), ms(s.t90),
        `${num(s.a_end, 3)}${sat ? ' <span class="tag bad">saturated</span>' : ""}`, brakes ? "friction" : (s.a_step < 0 ? (car === "ev" ? "regen" : "engine") : "–")]);
    }
  table(s3, ["car", "a_step [m/s²]", "dead", "10 %", "63 %", "90 %", "a after 2.8 s", "braking by"], rows);

  const ice15 = r.cars.ice[1], ev15 = r.cars.ev[1], ev4 = r.cars.ev[4], ice4 = r.cars.ice[4];
  why(host, "Why they respond like this", [
    `<b>ICE: delay, then lag.</b> For the first ${ms(ice05.dead)} nothing happens. That is the combustion torque delay
     th_e = ${ms(m.th_e)}: fuel admitted now produces torque ${ms(m.th_e)} later. After it, the torque follows the filling
     of the intake manifold, a first-order lag τ_m = 1/(K1·K3·v) = ${ms(m.tau_m_v0)} at ${r.v0} m/s. A delay plus a lag
     reaches 63 % at th_e + τ_m = ${ms(m.th_e + m.tau_m_v0)}; the simulation gives ${ms(ice05.t63)}.`,
    `<b>The ICE is slower at low speed.</b> τ_m is inversely proportional to the engine speed: the manifold empties into
     the cylinders faster when the engine turns faster. At 10 m/s the 63 % time is ${ms(sp.ice_t63[k10])}, at 40 m/s
     ${ms(sp.ice_t63[k40])}. The 60 ms delay does not change with speed.`,
    `<b>EV: almost instantaneous.</b> The motor torque is the current, and the current loop has a bandwidth
     ω_ci = ${m.w_ci} rad/s, a time constant of ${ms(m.tau_i)}, with no transport delay. That is why the EV reaches
     63 % in ${ms(ev05.t63)}, about ${ratio ? fmt(ratio, 2) : "–"} times faster than the ICE.`,
    ice15.a_end < 0.9 * ice15.a_step || ev15.a_end < 0.9 * ev15.a_step
      ? `<b>Saturation at +1.5 m/s².</b> At ${r.v0} m/s the ICE only reaches ${num(ice15.a_end)} m/s² (full throttle:
         the engine torque minus drag is the limit) and the EV ${num(ev15.a_end)} m/s² (motor current / power limit
         P_max = ${fmt(m.P_max / 1000, 3)} kW). The command is beyond what the car can do at this speed, which is why the
         upper controller's anti-windup watches the lower-level saturation flags.` : "",
    `<b>Braking.</b> Small decelerations are made without friction brakes (engine braking for the ICE, regeneration for
     the EV), so they have the same dynamics as acceleration. Larger ones need the friction brakes, which add a pure
     delay th_b = ${ms(m.th_b)} and a lag τ_b = ${ms(m.tau_b)}. For −4 m/s² the EV's 63 % time grows to ${ms(ev4.t63)}
     because regeneration alone is not enough and the friction brakes must blend in; the ICE reaches 63 % in
     ${ms(ice4.t63)}.`,
    `<b>What it means for control.</b> The upper controller runs every ${ms(m.Ts_ctrl)}. The plant time constants
     (≈ ${ms(ice05.t63)} for the ICE) are about 20 times shorter than the speed loop's (seconds), so the plant barely
     changes the speed loop. It matters in emergencies: ${ms(ice05.dead)} at 30 m/s is ${fmt(30 * ice05.dead, 2)} m
     travelled before the ICE even starts to react.`,
  ]);
}

// =========================================================================== 2) steps
function renderSteps(r, host) {
  const th = r.theory, t = r.t, sp = r.speed, fo = r.follow;
  const cars = ["ice", "ev", "ideal"];
  const mt = (c) => sp[c].metrics;
  tiles(host, [
    ...cars.map((c) => ({ label: `${NAME[c]} overshoot`, value: num(mt(c).overshoot, 3), unit: "%",
      note: `settles in ${num(mt(c).t_settle, 3)} s`, tone: c === "ideal" ? "muted" : "" })),
    { label: "Ideal loop", value: `ζ = ${num(th.zeta)}`, note: `ω_n = √(k_i/(1+k_d)) = ${num(th.wn)} rad/s` },
    ...["ice", "ev"].map((c) => ({ label: `${NAME[c]} max |spacing error|`, value: num(fo[c].metrics.es_max), unit: "m",
      note: `ideal: ${num(fo.ideal.metrics.es_max)} m`, tone: fo[c].metrics.collided ? "bad" : "" })),
  ]);

  const s1 = section(host, "Speed loop", `set speed ${r.v0} → ${r.v0 + r.dv} m/s at t = ${r.t_step} s, no leader`);
  const g1 = grid(s1);
  xy(g1, { title: "Speed", xlabel: "time [s]", ylabel: "v [m/s]" },
    cars.map((c) => ({ name: NAME[c], x: t, y: sp[c].v, color: C[c], dash: c === "ideal" ? [6, 4] : [] })),
    { hlines: [{ y: r.v0 + r.dv, label: "v_set", color: "var(--muted)" }] });
  xy(g1, { title: "Acceleration (solid) and command a_des (dotted)", xlabel: "time [s]", ylabel: "m/s²" }, [
    ...cars.map((c) => ({ name: NAME[c], x: t, y: sp[c].a, color: C[c], dash: c === "ideal" ? [6, 4] : [] })),
    ...["ice", "ev"].map((c) => ({ name: `${NAME[c]} a_des`, x: t, y: sp[c].a_des, color: C[c], dash: [2, 3], width: 1.2 })),
  ]);

  const s2 = section(host, "Distance loop", `steady following at ${r.v0} m/s, the leader changes speed by ${r.dvl} m/s at ${num(r.a_lead)} m/s²`);
  const g2 = grid(s2);
  const ft = fo.t;
  xy(g2, { title: "Spacing error e_s = d − d_ref", xlabel: "time [s]", ylabel: "e_s [m]" },
    cars.map((c) => ({ name: NAME[c], x: ft, y: fo[c].e_s, color: C[c], dash: c === "ideal" ? [6, 4] : [] })), { yzero: true });
  xy(g2, { title: "Gap d (solid) and target d_ref (dashed)", xlabel: "time [s]", ylabel: "m" }, [
    ...["ice", "ev"].map((c) => ({ name: `${NAME[c]} d`, x: ft, y: fo[c].d, color: C[c] })),
    { name: "d_ref (ICE)", x: ft, y: fo.ice.d_ref, color: C.ice, dash: [6, 4], width: 1.2 },
  ]);
  xy(g2, { title: "Speeds", xlabel: "time [s]", ylabel: "m/s" }, [
    { name: "leader", x: ft, y: fo.lead_v, color: C.lead, width: 1.4 },
    ...cars.map((c) => ({ name: NAME[c], x: ft, y: fo[c].v, color: C[c], dash: c === "ideal" ? [6, 4] : [] })),
  ]);
  xy(g2, { title: "Acceleration", xlabel: "time [s]", ylabel: "m/s²" },
    cars.map((c) => ({ name: NAME[c], x: ft, y: fo[c].a, color: C[c], dash: c === "ideal" ? [6, 4] : [] })),
    { hlines: [{ y: th.a_min, label: "a_min (controller limit)", color: C.bad }] });

  table(host, ["", "rise 10–90 %", "overshoot", "settling (2 %)", "peak |a|", "follow: max |e_s|", "settle e_s", "d_min", "braking peak"],
    cars.map((c) => [NAME[c], `${num(mt(c).t_rise)} s`, `${num(mt(c).overshoot)} %`, `${num(mt(c).t_settle)} s`,
      `${num(sp[c].a_peak)} m/s²`, `${num(fo[c].metrics.es_max)} m`, `${num(fo[c].metrics.t_settle)} s`,
      `${num(fo[c].metrics.d_min)} m`, `${num(fo[c].metrics.a_min)} m/s²`]));

  const satIce = sp.ice.a_peak < 0.95 * sp.ideal.a_peak, satEv = sp.ev.a_peak < 0.95 * sp.ideal.a_peak;
  const tsIdeal = 4 / (th.zeta * th.wn);
  const tooHard = abs(r.a_lead) > abs(th.a_min);
  why(host, "Why the loops behave like this", [
    `<b>Speed loop = second order with a zero (PID).</b> With a perfect actuator, v̇ = a = k_p·e + k_i·∫e − k_d·v̇: the
     derivative acts on the measured speed (filtered, τ_f = ${num(th.tau_f)} s), so a set-speed step gives no kick, and it
     behaves like an extra (1 + k_d) on the inertia. The closed loop is (k_p·s + k_i)/((1 + k_d)·s² + k_p·s + k_i). With
     k_p = ${th.k_p}, k_i = ${th.k_i} and k_d = ${th.k_d}: ω_n = √(k_i/(1+k_d)) = ${num(th.wn)} rad/s and
     ζ = k_p/(2√(k_i(1+k_d))) = ${num(th.zeta)}. The D term buys phase margin against the actuator delay; the overshoot of
     ${num(mt("ideal").overshoot)} % still comes from the zero at k_i/k_p = ${num(th.zero)} rad/s, which sits below ω_n and
     makes the response overshoot even though ζ is high. The settling time is about 4/(ζ·ω_n) = ${num(tsIdeal)} s.`,
    satIce || satEv
      ? `<b>Why the real cars overshoot less than the ideal plant.</b> The ideal plant delivers the full a_des
         (${num(sp.ideal.a_peak)} m/s² peak). The ICE only reaches ${num(sp.ice.a_peak)} m/s² and the EV
         ${num(sp.ev.a_peak)} m/s², because the actuator saturates at this speed. When the lower level saturates, the
         controller stops integrating (conditional integration), so less error is stored in the integrator and there is
         less overshoot (ICE ${num(mt("ice").overshoot)} %, EV ${num(mt("ev").overshoot)} %). The step is slower, though.`
      : `<b>Real cars vs ideal plant.</b> The ICE and EV follow the ideal plant closely: the plant delays (≈0.1 s) are
         very short compared with the loop's time scale (seconds).`,
    `<b>Distance loop: in theory the spacing error never moves.</b> The law a = ((v_lead − v) + λ·e_s)/h with
     d_ref = d0 + h·v gives ė_s = (v_lead − v) − h·a = −λ·e_s. With a perfect actuator, e_s does not depend on the
     leader's manoeuvre at all and decays with τ = 1/λ = ${num(th.tau_es)} s. The ideal plant's max |e_s| is
     ${num(fo.ideal.metrics.es_max)} m.`,
    `<b>What the real cars add.</b> The car cannot change its acceleration instantly, so it falls behind the law while the
     leader changes speed. That creates e_s = ${num(fo.ice.metrics.es_max)} m for the ICE (60 ms delay + manifold lag)
     and ${num(fo.ev.metrics.es_max)} m for the EV. The λ term then pulls it back with τ = ${num(th.tau_es)} s.`,
    tooHard ? `<b>Saturation.</b> The leader decelerates at ${num(abs(r.a_lead))} m/s², more than the controller's limit
     |a_min| = ${num(abs(th.a_min))} m/s². The law saturates, the gap closes faster than planned and e_s grows until the
     leader stops decelerating.` : "",
    th.fixed_spacing ? `<b>Fixed spacing is in use.</b> With d_ref = d_set (constant), ė_s = v_lead − v and, while the
     leader decelerates at A, e_s settles at −h·A/λ: the gap shrinks while the leader brakes.` : "",
  ]);
}

// =========================================================================== 3) bode
function renderBode(r, host) {
  const m = r.model;
  const band = (L, c) => crossing(r[L].f, r[L][c].gain_db, -3);
  const peak = (L, c) => Math.max(...r[L][c].gain_db.filter((v) => v != null));
  const ph1 = (c) => interpAt(r.plant.f, r.plant[c].phase, 1.0);
  const stable = (c) => peak("follow", c) <= 0.05;
  tiles(host, [
    { label: "ICE plant bandwidth (−3 dB)", value: num(band("plant", "ice")), unit: "Hz", note: `phase at 1 Hz: ${num(ph1("ice"))}°` },
    { label: "EV plant bandwidth", value: band("plant", "ev") ? num(band("plant", "ev")) : "> 8", unit: "Hz", note: `phase at 1 Hz: ${num(ph1("ev"))}°`, tone: "good" },
    { label: "Speed loop peak", value: num(peak("speed", "ice")), unit: "dB", note: `bandwidth ${num(band("speed", "ice"))} Hz (ICE)` },
    ...["ice", "ev"].map((c) => ({ label: `${NAME[c]} string stability`, value: stable(c) ? "stable" : "unstable",
      note: `peak |v/v_lead| = ${num(peak("follow", c))} dB`, tone: stable(c) ? "good" : "bad" })),
  ]);
  const loops = [
    ["plant", "Plant: a_des → a", "how faithfully the car follows an acceleration command"],
    ["speed", "Speed loop: v_set → v", "how fast set-speed changes are followed"],
    ["follow", "Following loop: v_lead → v", "string stability: gain ≤ 0 dB means swings are not amplified"],
  ];
  for (const [L, title, sub] of loops) {
    const s = section(host, title, sub);
    const g = grid(s);
    const d = r[L];
    xy(g, { title: "Gain", xlabel: "frequency [Hz]", ylabel: "dB", xlog: true, height: 230 }, [
      { name: "ICE", x: d.f, y: d.ice.gain_db, color: C.ice, dots: true },
      { name: "EV", x: d.f, y: d.ev.gain_db, color: C.ev, dots: true },
      { name: "ideal (theory)", x: d.ideal.f, y: d.ideal.gain_db, color: C.ideal, dash: [6, 4], width: 1.3 },
    ], { hlines: [{ y: 0, color: "var(--muted)" }, { y: -3, label: "−3 dB", color: "var(--muted)", dash: [2, 3] }] });
    xy(g, { title: "Phase", xlabel: "frequency [Hz]", ylabel: "degrees", xlog: true, height: 230 }, [
      { name: "ICE", x: d.f, y: d.ice.phase, color: C.ice, dots: true },
      { name: "EV", x: d.f, y: d.ev.phase, color: C.ev, dots: true },
      { name: "ideal (theory)", x: d.ideal.f, y: d.ideal.phase, color: C.ideal, dash: [6, 4], width: 1.3 },
    ]);
  }
  const delayPhase = -360 * m.th_e;
  why(host, "Reading the curves", [
    `<b>Plant.</b> The ICE's phase falls steadily with frequency, the signature of a pure delay: a delay T costs
     360·f·T degrees, ${num(delayPhase)}° per Hz for th_e = ${ms(m.th_e)}. The manifold lag (τ_m = ${ms(m.tau_m_v0)} at
     ${r.v0} m/s) adds atan(2π·f·τ_m) and pulls the gain down: −3 dB at about ${num(band("plant", "ice"))} Hz. The EV
     stays near 0 dB and 0° over the whole range, because its current loop (ω_ci = ${m.w_ci} rad/s ≈
     ${num(m.w_ci / (2 * Math.PI))} Hz) is far above these frequencies.`,
    `<b>Speed loop.</b> The theory curve is (k_p·s + k_i)/(s² + k_p·s + k_i + k_d·s²/(τ_f·s + 1)) (PID, D on the measurement).
     It has a small resonance peak (${num(Math.max(...r.speed.ideal.gain_db))} dB) from the zero k_i/k_p, the frequency-domain image of the step overshoot.
     The bandwidth is about ${num(band("speed", "ice"))} Hz, so set-speed changes slower than about
     ${num(1 / (band("speed", "ice") || 1), 2)} s are tracked and faster ones are smoothed. The real cars match the
     theory because the plant is about 50 times faster than this loop.`,
    `<b>String stability.</b> In a line of cars, each one should damp the speed oscillations of the car ahead.
     ${m.fixed_spacing
       ? `With <b>fixed spacing</b> the theory is (s + λ)/(h·s² + s + λ), which peaks above 0 dB
          (${num(Math.max(...r.follow.ideal.gain_db))} dB): a constant distance policy amplifies swings down the line.`
       : `With the <b>time-gap</b> policy (d_ref = d0 + h·v) the theory reduces exactly to 1/(1 + h·s), a low-pass filter
          that never exceeds 0 dB: string stable for any h > 0 with a perfect actuator. Plant lag adds phase and can
          create a peak; the usual rule is h > 2 × the plant lag, and here h = ${m.h} s is far above it.`}
     Measured peaks: ICE ${num(peak("follow", "ice"))} dB, EV ${num(peak("follow", "ev"))} dB.`,
  ]);
}

// =========================================================================== 4) min gap
// Solver answers at the lower end of the search range are upper bounds ("≤").
const LOW = { d: 0.05, h: 0.02 };
const bound = (v, lo) => (v != null && v <= lo * 1.0001 ? `≤ ${lo}` : num(v));

function renderMinGap(r, host) {
  const s = r.solve, cars = ["ice", "ev", "ideal"];
  const worst = Math.max(s.ice.d_follow ?? 0, s.ev.d_follow ?? 0);
  const margin = r.d_ref_config - Math.max(s.ice.d_initial ?? 0, s.ev.d_initial ?? 0);
  const A = abs(r.a_b);
  tiles(host, [
    ...cars.map((c) => ({ label: `${NAME[c]}: min following distance`, value: bound(s[c].d_follow, LOW.d), unit: "m",
      note: `fixed spacing, d_set = gap`, tone: c === "ideal" ? "muted" : "" })),
    ...["ice", "ev"].map((c) => ({ label: `${NAME[c]}: min time gap`, value: bound(s[c].h_min, LOW.h), unit: "s",
      note: `${s[c].h_min <= LOW.h * 1.0001 ? "≤" : "="} ${num(s[c].d_h_min)} m at ${r.v0} m/s` })),
    { label: "Configured target at v0", value: num(r.d_ref_config), unit: "m",
      note: r.fixed_spacing ? "fixed spacing d_set" : `d0 + h·v = ${r.d0} + ${r.h_config}·${r.v0}`,
      tone: r.d_ref_config >= worst ? "good" : "bad" },
    { label: "Min initial gap (current controller)", value: bound(Math.max(s.ice.d_initial, s.ev.d_initial), LOW.d), unit: "m",
      note: `margin to the configured target: ${num(margin)} m`, tone: margin > 0 ? "good" : "bad" },
  ]);

  const s1 = section(host, "Minimum following distance", "fixed spacing d_set = initial gap, leader brakes to a stop");
  const g1 = grid(s1);
  const ab = r.vs_brake.a_b.map(abs);
  xy(g1, { title: `vs leader braking (at ${r.v0} m/s)`, xlabel: "leader deceleration |a_b| [m/s²]", ylabel: "minimum distance [m]" }, [
    ...cars.map((c) => ({ name: NAME[c], x: ab, y: r.vs_brake[c], color: C[c], dots: true, dash: c === "ideal" ? [6, 4] : [] })),
    { name: "kinematic, braking at a_min", x: ab, y: r.vs_brake.kin_ctrl, color: C.bound, dash: [2, 3] },
    { name: "kinematic, braking at μ·g", x: ab, y: r.vs_brake.kin_phys, color: C.bound, dash: [8, 3, 2, 3] },
  ], { yzero: true, hlines: [{ y: r.d_ref_config, label: `configured target ${num(r.d_ref_config)} m`, color: C.cfg }],
       vlines: [{ x: abs(r.A_ctrl), label: "|a_min|", color: C.bad }, { x: A, label: "this case", color: "var(--muted)" }] });
  const vv = r.vs_speed.v0;
  xy(g1, { title: `vs speed (leader at ${num(A)} m/s²)`, xlabel: "speed v0 [m/s]", ylabel: "minimum distance [m]" }, [
    ...cars.map((c) => ({ name: NAME[c], x: vv, y: r.vs_speed[c], color: C[c], dots: true, dash: c === "ideal" ? [6, 4] : [] })),
    { name: "configured target d_ref(v)", x: vv, y: r.vs_speed.d_ref, color: C.cfg, width: 1.4 },
    { name: "kinematic, braking at a_min", x: vv, y: r.vs_speed.kin_ctrl, color: C.bound, dash: [2, 3] },
  ], { yzero: true });

  const s2 = section(host, "Near miss", "the run at the minimum following distance (+5 cm)");
  const g2 = grid(s2);
  const nm = r.near_miss;
  xy(g2, { title: "Gap", xlabel: "time [s]", ylabel: "d [m]" },
    cars.filter((c) => nm[c]).map((c) => ({ name: `${NAME[c]} (min ${num(nm[c].d_min)} m)`, x: nm[c].t, y: nm[c].d, color: C[c], dash: c === "ideal" ? [6, 4] : [] })),
    { yzero: true });
  xy(g2, { title: "Speeds and acceleration", xlabel: "time [s]", ylabel: "m/s · m/s²" }, [
    nm.ice && { name: "leader v", x: nm.ice.t, y: nm.ice.lead_v, color: C.lead },
    ...cars.filter((c) => nm[c]).map((c) => ({ name: `${NAME[c]} v`, x: nm[c].t, y: nm[c].v, color: C[c] })),
    ...["ice", "ev"].filter((c) => nm[c]).map((c) => ({ name: `${NAME[c]} a`, x: nm[c].t, y: nm[c].a, color: C[c], dash: [2, 3], width: 1.2 })),
  ]);

  table(host, ["", "min following distance (fixed)", "min time gap (time-gap policy)", "gap at that h", "min initial gap (current controller)"],
    cars.map((c) => [NAME[c], `${bound(s[c].d_follow, LOW.d)} m`, `${bound(s[c].h_min, LOW.h)} s`,
      `${s[c].h_min <= LOW.h * 1.0001 ? "≤ " : ""}${num(s[c].d_h_min)} m`, `${bound(s[c].d_initial, LOW.d)} m`]));

  const lag = (r.h_config * A) / r.lambda;           // fixed-spacing steady error h·A/λ
  const delayGap = (s.ice.d_follow ?? 0) - (s.ideal.d_follow ?? 0);
  why(host, "What sets the minimum distance", [
    `<b>Three questions, three answers.</b> (1) <i>Fixed spacing:</i> the smallest constant distance the car can hold
     and still stop behind a leader braking at ${num(A)} m/s² from ${r.v0} m/s: ${num(s.ice.d_follow)} m (ICE),
     ${num(s.ev.d_follow)} m (EV). (2) <i>Time-gap policy:</i> the smallest h: ${bound(s.ice.h_min, LOW.h)} s (ICE),
     ${bound(s.ev.h_min, LOW.h)} s (EV)${[s.ice.h_min, s.ev.h_min].some((h) => h <= LOW.h * 1.0001)
       ? ` ("≤ ${LOW.h}" means even the smallest h tried is safe: the standstill distance d0 = ${r.d0} m alone absorbs the approach)` : ""}. (3) <i>Your current controller</i> starting closer than its target: it survives from
     ${num(Math.max(s.ice.d_initial, s.ev.d_initial))} m. The configured target is ${num(r.d_ref_config)} m, a margin
     of ${num(margin)} m.`,
    `<b>Why fixed spacing needs so much room.</b> With d_ref constant, the law a = ((v_lead − v) + λ·(d − d_set))/h
     behaves like a spring and damper on the gap. While the leader keeps decelerating at A, it only produces −A when
     λ·e_s = −h·A, so the gap settles <b>h·A/λ</b> below d_set: here ${r.h_config}·${num(A)}/${r.lambda} = ${num(lag)} m.
     Add the transient and the
     plant's delay. That is why the minimum distance grows almost linearly with braking severity in the left plot.`,
    `<b>Why the time-gap policy needs much less.</b> d_ref = d0 + h·v shrinks as the car slows down, so the error stays near
     zero (ė_s = −λ·e_s) and the gap shrinks together with the speed. It only fails when the leader brakes harder than the
     car can follow.`,
    A > abs(r.A_ctrl)
      ? `<b>Braking limit.</b> The leader brakes at ${num(A)} m/s², harder than the controller's limit
         |a_min| = ${num(abs(r.A_ctrl))} m/s². Even an instant reaction needs v0²/2·(1/|a_min| − 1/A) = ${num(r.kin_ctrl)} m
         (dotted line). The friction brakes could do μ·g = ${num(r.A_phys)} m/s² (${num(r.kin_phys)} m needed), so raising
         limits.a_min_g would reduce the requirement.`
      : `<b>Braking limit.</b> The leader brakes at ${num(A)} m/s², within the controller's limit
         |a_min| = ${num(abs(r.A_ctrl))} m/s², so kinematics alone need no extra room. The whole requirement comes from the
         control law and the plant delays. To the right of the red line (|a_b| > |a_min|) the dotted kinematic term grows
         fast.`,
    `<b>ICE vs EV vs ideal.</b> The ideal plant (same controller, a = a_des) needs ${num(s.ideal.d_follow)} m. The ICE
     needs ${num(delayGap)} m more because of its 60 ms torque delay and manifold lag, and the friction brakes' 70 ms + 80 ms
     when it brakes hard. At ${r.v0} m/s, every 0.1 s of delay costs ${fmt(r.v0 * 0.1, 2)} m of approach.`,
  ]);
}

// =========================================================================== 5) sweep
function renderSweep(r, host) {
  const xs = r.x.values, xn = r.x.name, cars = ["ice", "ev", "ideal"];
  const cfgVal = (name) => {
    const c = r.config;
    if (name === "a_b") return abs(c.a_b);
    return c[name];
  };
  const xlabel = SWEEP_PARAMS[xn]?.label || xn;

  if (!r.y) {
    // ------------- 1D
    const coll = (c) => r.cars[c].collided;
    const summary = cars.map((c) => {
      const safe = xs.filter((_, i) => coll(c)[i] === 0);
      const bad = xs.filter((_, i) => coll(c)[i] === 1);
      if (!bad.length) return `<b>${NAME[c]}</b>: no collision anywhere in the range.`;
      if (!safe.length) return `<b>${NAME[c]}</b>: collides everywhere in the range.`;
      return `<b>${NAME[c]}</b>: collides for ${xn} in [${fmt(Math.min(...bad))}, ${fmt(Math.max(...bad))}], safe for
        ${xn} in [${fmt(Math.min(...safe))}, ${fmt(Math.max(...safe))}].`;
    });
    tiles(host, cars.map((c) => {
      const n = coll(c).filter((v) => v === 1).length;
      return { label: `${NAME[c]} collisions`, value: `${n} / ${xs.length}`, tone: n ? "bad" : "good",
        note: n ? `first safe ${xn}: ${fmt(xs.find((_, i) => coll(c)[i] === 0) ?? NaN)}` : "none" };
    }));
    const g = grid(section(host, `Metrics vs ${xlabel}`, `scenario ${r.scenario}; × = collision`), 2);
    const cfgx = cfgVal(xn);
    for (const mk of ["d_min", "a_min", "es_max", "jerk_max", "v_overshoot", "v_settle", "t_settle", "v_end"]) {
      const any = cars.some((c) => r.cars[c][mk].some((v) => v != null && v !== 0));
      if (!any && mk !== "d_min") continue;
      xy(g, { title: `${METRICS[mk].label} [${METRICS[mk].unit}]`, xlabel, height: 220 },
        cars.map((c) => ({ name: NAME[c], x: xs, y: r.cars[c][mk], color: C[c], dots: true, dash: c === "ideal" ? [6, 4] : [],
          marks: mk === "d_min" ? xs.map((x, i) => (coll(c)[i] === 1 ? { x, y: 0, color: C.bad } : null)).filter(Boolean) : [] })),
        { yzero: mk === "d_min", vlines: cfgx != null && isFinite(cfgx) ? [{ x: cfgx, label: "config", color: C.cfg }] : [] });
    }
    why(host, "Summary", summary);
    return;
  }

  // ------------- 2D
  const ys = r.y.values, yn = r.y.name, ylabel = SWEEP_PARAMS[yn]?.label || yn;
  const bar = document.createElement("div");
  bar.className = "an-bar";
  bar.innerHTML = `<label class="inline">Colour by <select id="an-metric">${Object.entries(METRICS)
    .map(([k, v]) => `<option value="${k}">${v.label} [${v.unit || "–"}]</option>`).join("")}</select></label>
    <span class="muted small">hatched red = collision · white ring = current config</span>`;
  host.appendChild(bar);
  const box = document.createElement("div");
  host.appendChild(box);
  const draw = (mk) => {
    for (const p of plots.splice(0)) p.destroy();
    box.innerHTML = "";
    const g = grid(box, 3);
    for (const c of cars)
      heat(g, { title: NAME[c], xlabel, ylabel, zlabel: METRICS[mk].label, unit: METRICS[mk].unit, height: 300 }, {
        x: xs, y: ys, z: r.cars[c][mk], mask: r.cars[c].collided.map((v) => v === 1), maskLabel: "collision",
        marker: { x: cfgVal(xn), y: cfgVal(yn), label: "config" },
      });
    const lines = cars.map((c) => {
      const n = r.cars[c].collided.filter((v) => v === 1).length;
      return `<b>${NAME[c]}</b>: ${n} of ${xs.length * ys.length} combinations collide (${fmt(100 * n / (xs.length * ys.length), 2)} %).`;
    });
    why(box, "Summary", lines);
  };
  const sel = bar.querySelector("#an-metric");
  sel.value = "d_min";
  sel.addEventListener("change", () => draw(sel.value));
  draw("d_min");
}
