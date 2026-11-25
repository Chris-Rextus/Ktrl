// Diagrams window: presentation slides of the control design of the txt
// (§11 and the speed-PI / distance-controller syntheses), drawn as large SVG
// block diagrams with the exact transfer functions and numbers of the document.
//
// Live: the switch between the two meshes is evaluated on the running
// simulation (target detected and d <= d_ref -> mesh 2), the active mesh is
// highlighted, and every wire shows the live value of its signal. The
// simulator itself runs §12; the signals of the txt design are computed from
// its live data (K_d = 0.5 1/s as in §11).

import { fmt, XYPlot } from "./plot.js";

const $ = (id) => document.getElementById(id);
const KD = 0.5;               // §11: K_d = 0.5 1/s (tau ideal = 2 s)
const TS = 0.02;              // §11.1: T_s = 20 ms

// ============================================================================ data of the txt
// EV: synthèse PI M1 DC (§4-6) + §11.2-11.6.  ICE: synthèse PI ICE (§6.3, §8) + §11.
const POINTS = {
  ev: [
    { v0: 0, Kp: 13.01405, Ki: 3.25351, q0: 13.07912, q1: 13.01405, N: 3.6614, D: 50, E: 30.51, u0: 1.8631,
      b1: 5.382726e-4, b2: 3.865800e-4, a1: -1.360173, a2: 0.367879,
      s1: { PM: 108.9, GM: 41.9, D: 0.0, ts: 16.9 }, B: { PM: 78.9, GM: 41.8, D: 6.8, ts: 15.0, Kdmax: "> 40" }, A: { PM: 22.2, D: 63.4, ts: 27.1, Kdmax: "12.6" } },
    { v0: 10, Kp: 13.06841, Ki: 3.26710, q0: 13.13375, q1: 13.06841, N: 3.6614, D: 50.0068, E: 30.85, u0: 85.6603,
      b1: 5.382464e-4, b2: 3.865434e-4, a1: -1.360037, a2: 0.367829,
      s1: { PM: 109.2, GM: 41.9, D: 0.0, ts: 17.0 }, B: { PM: 79.2, GM: 41.8, D: 6.8, ts: 15.1, Kdmax: "> 40" }, A: { PM: 22.5, D: 62.9, ts: 27.0, Kdmax: "12.8" } },
    { v0: 20, Kp: 13.12314, Ki: 3.28079, q0: 13.18876, q1: 13.12314, N: 3.6614, D: 50.0136, E: 31.19, u0: 170.3859,
      b1: 5.382201e-4, b2: 3.865068e-4, a1: -1.359902, a2: 0.367779,
      s1: { PM: 109.6, GM: 41.8, D: 0.0, ts: 17.1 }, B: { PM: 79.5, GM: 41.7, D: 6.8, ts: 15.1, Kdmax: "> 40" }, A: { PM: 22.8, D: 62.4, ts: 26.9, Kdmax: "13.0" } },
    { v0: 30, Kp: 13.17824, Ki: 3.29456, q0: 13.24413, q1: 13.17824, N: 3.6614, D: 50.0204, E: 31.53, u0: 256.0400,
      b1: 5.381938e-4, b2: 3.864702e-4, a1: -1.359767, a2: 0.367729,
      s1: { PM: 109.9, GM: 41.8, D: 0.0, ts: 17.2 }, B: { PM: 79.8, GM: 41.7, D: 6.9, ts: 15.2, Kdmax: "> 40" }, A: { PM: 23.1, D: 62.0, ts: 26.7, Kdmax: "13.1" } },
    { v0: 40, Kp: 13.23370, Ki: 3.30843, q0: 13.29987, q1: 13.23370, N: 3.6614, D: 50.0272, E: 31.87, u0: 342.6224,
      b1: 5.381675e-4, b2: 3.864337e-4, a1: -1.359631, a2: 0.367679,
      s1: { PM: 110.2, GM: 41.8, D: 0.0, ts: 17.3 }, B: { PM: 80.1, GM: 41.7, D: 6.9, ts: 15.3, Kdmax: "> 40" }, A: { PM: 23.4, D: 61.5, ts: 26.4, Kdmax: "13.3" } },
  ],
  ice: [
    { v0: 10, Kp: 0.22184, Ki: 0.05546, q0: 0.22295, q1: 0.22184, N: 21.3133, D: 6.17428, E: 0.264908, u0: 0.18244,
      b1: 4.092451e-3, b2: 3.927435e-3, a1: -1.883735, a2: 0.883834,
      s1: { PM: 65.1, GM: 25.6, D: 14.6, ts: 11.2 }, B: { PM: 36.4, GM: 24.7, D: 15.1, ts: 12.2, Kdmax: "2.96" }, A: null },
    { v0: 20, Kp: 0.25975, Ki: 0.06494, q0: 0.26105, q1: 0.25975, N: 36.2916, D: 12.34448, E: 0.516833, u0: 0.31406,
      b1: 6.695993e-3, b2: 6.167227e-3, a1: -1.781044, a2: 0.781227,
      s1: { PM: 68.8, GM: 26.2, D: 13.8, ts: 11.5 }, B: { PM: 40.5, GM: 25.7, D: 13.7, ts: 12.5, Kdmax: "4.63" }, A: null },
    { v0: 30, Kp: 0.26580, Ki: 0.06645, q0: 0.26713, q1: 0.26580, N: 53.1960, D: 18.51469, E: 0.903186, u0: 0.46993,
      b1: 9.438806e-3, b2: 8.343826e-3, a1: -1.690230, a2: 0.690531,
      s1: { PM: 70.5, GM: 26.6, D: 12.9, ts: 11.5 }, B: { PM: 42.4, GM: 26.3, D: 13.1, ts: 12.7, Kdmax: "5.75" }, A: null },
    { v0: 40, Kp: 0.42819, Ki: 0.10705, q0: 0.43033, q1: 0.42819, N: 69.0357, D: 38.68089, E: 1.888110, u0: 0.67582,
      b1: 1.084043e-2, b2: 8.385795e-3, a1: -1.460815, a2: 0.461341,
      s1: { PM: 71.8, GM: 27.4, D: 12.6, ts: 11.6 }, B: { PM: 43.9, GM: 27.2, D: 12.7, ts: 12.8, Kdmax: "7.50" }, A: null },
    { v0: 45, Kp: 0.79277, Ki: 0.19819, q0: 0.79673, q1: 0.79277, N: 70.6397, D: 73.25813, E: 3.408637, u0: 0.85400,
      b1: 9.162816e-3, b2: 5.665057e-3, a1: -1.230325, a2: 0.231040,
      s1: { PM: 72.2, GM: 28.1, D: 12.7, ts: 11.6 }, B: { PM: 44.3, GM: 27.9, D: 12.7, ts: 12.8, Kdmax: "8.60" }, A: null },
  ],
};
const PLANT = {
  ev:  { name: "EV · DC motor", u: "V_c", u0: "V_{c0}", du: "ΔV_c", unit: "V", sat: "[0, 400] V", delay: false, nd: 0 },
  ice: { name: "ICE · petrol engine", u: "θ_{th}", u0: "θ_{th0}", du: "Δθ_{th}", unit: "rad", sat: "[0, π/2] rad", delay: true, nd: 3 },
};

// ============================================================================ text helpers
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// "G_v(s)", "z^{-3}", "θ_{th}" -> SVG tspans
function m(str) {
  let out = "", i = 0;
  const s = String(str);
  while (i < s.length) {
    const c = s[i];
    if ((c === "_" || c === "^") && i + 1 < s.length) {
      let arg;
      if (s[i + 1] === "{") { const j = s.indexOf("}", i + 2); arg = s.slice(i + 2, j); i = j + 1; }
      else { arg = s[i + 1]; i += 2; }
      out += `<tspan class="${c === "_" ? "sub" : "sup"}" baseline-shift="${c === "_" ? "sub" : "super"}">${esc(arg)}</tspan>`;
    } else { out += esc(c); i++; }
  }
  return out;
}
// same for HTML
function mh(str) {
  return esc(String(str)).replace(/_\{([^}]*)\}|_([A-Za-z0-9À-ÿ]+)/g, (_, a, b) => `<sub>${a ?? b}</sub>`)
                         .replace(/\^\{([^}]*)\}|\^(.)/g, (_, a, b) => `<sup>${a ?? b}</sup>`);
}
const frac = (num, den) => `<span class="fr"><span>${mh(num)}</span><span>${mh(den)}</span></span>`;
const n4 = (v) => (Math.abs(v) < 1e-2 && v !== 0 ? v.toExponential(4) : (+v.toPrecision(6)).toString());
const textW = (s, size) => String(s).replace(/[_^{}]/g, "").length * size * 0.52;

// ============================================================================ SVG builder
class Svg {
  constructor(w, h) { this.w = w; this.h = h; this.p = []; }
  add(s) { this.p.push(s); return this; }
  html() {
    return `<svg class="dg-svg" viewBox="0 0 ${this.w} ${this.h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="dg-arr" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path class="dg-arrowhead" d="M0,0 L12,6 L0,12 z"/></marker>
        <marker id="dg-arr-on" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="13" markerHeight="13" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path class="dg-arrowhead on" d="M0,0 L12,6 L0,12 z"/></marker>
        <filter id="dg-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>${this.p.join("")}</svg>`;
  }
  // block with a small title and a body: a transfer function (frac) or text lines
  block(id, cx, cy, w, h, title, body, opt = {}) {
    let inner = "";
    if (body?.num !== undefined) {
      const fw = Math.max(textW(body.num, 24), textW(body.den, 24)) + 12;
      const y = cy + (title ? 10 : 0) + (body.after ? -4 : 0);
      const x0 = body.pre ? cx - (textW(body.pre, 24) + fw + (body.post ? textW(body.post, 24) : 0)) / 2 : cx - fw / 2;
      let x = x0;
      if (body.pre) { inner += `<text class="dg-tf" x="${x}" y="${y + 8}">${m(body.pre)}</text>`; x += textW(body.pre, 24) + 4; }
      inner += `<text class="dg-tf" x="${x + fw / 2}" y="${y - 8}" text-anchor="middle">${m(body.num)}</text>
        <line class="dg-fracline" x1="${x}" x2="${x + fw}" y1="${y}" y2="${y}"/>
        <text class="dg-tf" x="${x + fw / 2}" y="${y + 26}" text-anchor="middle">${m(body.den)}</text>`;
      x += fw + 4;
      if (body.post) inner += `<text class="dg-tf" x="${x}" y="${y + 8}">${m(body.post)}</text>`;
      if (body.after) inner += `<text class="dg-small" x="${cx}" y="${cy + h / 2 - 10}" text-anchor="middle">${m(body.after)}</text>`;
    } else if (body) {
      const lines = [].concat(body);
      const y0 = cy + (title ? 12 : 8) - (lines.length - 1) * 14;
      lines.forEach((ln, k) => {
        inner += `<text class="${k === 0 ? "dg-tf" : "dg-small"}" x="${cx}" y="${y0 + k * 28}" text-anchor="middle">${m(ln)}</text>`;
      });
    }
    this.add(`<g class="dg-block ${opt.cls || ""}" id="${id}">
      <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="14"/>
      ${title ? `<text class="dg-title" x="${cx}" y="${cy - h / 2 + 22}" text-anchor="middle">${m(title)}</text>` : ""}
      ${inner}</g>`);
  }
  // sum junction; signs: {left, right, top, bottom} = "+" | "−"
  sum(id, cx, cy, signs, opt = {}) {
    const r = 22;
    const pos = { left: [-r - 12, -10], right: [r + 4, -10], top: [-18, -r - 8], bottom: [-18, r + 22] };
    let s = `<g class="dg-sum ${opt.cls || ""}" id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/>
      <line x1="${cx - r * 0.7}" y1="${cy - r * 0.7}" x2="${cx + r * 0.7}" y2="${cy + r * 0.7}"/>
      <line x1="${cx - r * 0.7}" y1="${cy + r * 0.7}" x2="${cx + r * 0.7}" y2="${cy - r * 0.7}"/>`;
    for (const [k, sg] of Object.entries(signs)) {
      const [dx, dy] = pos[k];
      s += `<text class="dg-sign" x="${cx + dx}" y="${cy + dy}">${sg}</text>`;
    }
    this.add(s + "</g>");
  }
  wire(id, pts, opt = {}) {
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
    this.add(`<path class="dg-wire ${opt.arrow === false ? "noarrow" : ""} ${opt.cls || ""}" id="${id}" d="${d}"/>`);
    if (opt.label) this.label(opt.label[0], opt.label[1], opt.label[2], opt.labelAnchor);
  }
  dot(cx, cy, cls = "") { this.add(`<circle class="dg-dot ${cls}" cx="${cx}" cy="${cy}" r="6"/>`); }
  label(x, y, txt, anchor = "middle", cls = "dg-label") {
    this.add(`<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${m(txt)}</text>`);
  }
  badge(id, x, y, anchor = "middle") {
    this.add(`<g class="dg-badge" id="${id}" data-x="${x}" data-y="${y}" data-anchor="${anchor}">
      <rect rx="8" height="28"/><text y="${y + 5}">–</text></g>`);
  }
  region(id, x, y, w, h, title, opt = {}) {
    this.add(`<g class="dg-region ${opt.cls || ""}" id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22"/>
      <text class="dg-region-title" x="${x + 22}" y="${y + 34}">${m(title)}</text></g>`);
  }
  io(x, y, txt, anchor = "end") { this.label(x, y + 8, txt, anchor, "dg-io"); }
}

// ============================================================================ live state
let api = null;
let car = "ev";
let opMode = "auto";          // "auto" or index into POINTS[car]
let form = "full";            // mesh 2: "full" (as built) or "reduced" (§11.6 composite error)
let slide = 0;
let lastLive = 0;
let timeline = null;

function liveState() {
  const { columns, rows, status } = api.getLive();
  if (!rows.length) return null;
  const idx = Object.fromEntries(columns.map((n, i) => [n, i]));
  if (idx[`${car}_v`] === undefined) return null;
  const r = rows[rows.length - 1];
  const g = (k) => r[idx[`${car}_${k}`]];
  const target = g("target") > 0.5, leadOn = g("lead_on") > 0.5;
  const v = g("v"), vset = g("v_set"), d = g("d"), dref = g("d_ref"), vl = g("lead_v");
  const mesh = target && d <= dref ? 2 : 1;                      // the switch of the design
  const ed = target ? dref - d : null;
  const vcorr = target ? -KD * ed : null;
  const dv = leadOn ? vl - v : null;
  const vref = target ? vl + vcorr : null;
  const eps = mesh === 2 ? dv + vcorr : vset - v;
  const u = car === "ev" ? g("V_c") : g("theta_th");
  const op = opPoint(v);
  return { t: r[0], v, vset, d, dref, vl, target, leadOn, mesh, ed, vcorr, dv, vref, eps, u, du: u - op.u0, op,
           ev: vset - v, simMode: g("mode") > 0.5 ? "distance law" : "speed law", collided: g("collided") > 0.5,
           running: status?.state === "running" };
}
function opPoint(v) {
  const P = POINTS[car];
  if (opMode !== "auto") return P[+opMode];
  let best = P[0];
  for (const p of P) if (Math.abs(p.v0 - (v ?? 30)) < Math.abs(best.v0 - (v ?? 30))) best = p;
  return best;
}

function setBadge(id, text, show = true) {
  const g = document.getElementById(id);
  if (!g) return;
  g.style.display = show ? "" : "none";
  if (!show) return;
  const t = g.querySelector("text"), rc = g.querySelector("rect");
  t.textContent = text;
  const w = text.length * 9.2 + 18, x = +g.dataset.x, y = +g.dataset.y, a = g.dataset.anchor;
  const x0 = a === "start" ? x : a === "end" ? x - w : x - w / 2;
  rc.setAttribute("x", x0); rc.setAttribute("y", y - 15); rc.setAttribute("width", w);
  t.setAttribute("x", x0 + w / 2); t.setAttribute("text-anchor", "middle");
}
const val = (v, unit, d = 2) => (v == null || !isFinite(v) ? "—" : `${v.toFixed(d)} ${unit}`.trim());
function cls(ids, name, on) { for (const id of ids) document.getElementById(id)?.classList.toggle(name, on); }

// ============================================================================ slides
const SLIDES = [
  { key: "overview", tab: "Overview", title: "The switched ACC: two meshes", sub: "One speed controller C_v, two ways of building its error. The switch picks the mesh from the distance." },
  { key: "mesh1", tab: "Mesh 1 · speed", title: "Mesh 1 · speed control", sub: "Système 1 (§11.4): the PI M1 alone, unit feedback on v_ego." },
  { key: "mesh2", tab: "Mesh 2 · distance", forms: true, title: "Mesh 2 · distance control in cascade (architecture B)", sub: "§11.6: the distance controller C_d is piped into the speed controller; the speed set-point is built from v_lead.",
    subReduced: "§11.6 reduced: v_ref and v_ego merge into the radar's relative speed Δv, so one junction builds the composite error ε for a single PI." },
  { key: "arch_a", tab: "Derivation (A → B)", title: "How mesh 2 was derived: architecture A", sub: "Distance synthesis §2–4 and §11.5: the initial two-junction design, its simplification, and why it was corrected." },
  { key: "switch", tab: "Switching", title: "Switching between the meshes", sub: "The distance decides: mesh 2 when a target is detected and d ≤ d_ref, mesh 1 otherwise." },
  { key: "sampled", tab: "Sampling", title: "Sampled implementation", sub: "§11.1 and §11.3: discrete controllers at T_s = 20 ms, ZOH, continuous plant." },
  { key: "points", tab: "Operating points", title: "Operating points and gain scheduling", sub: "Gains, trims and closed-loop results of the txt for every operating point." },
];

// --------------------------------------------------------------------------- 1) overview
function overview() {
  const P = PLANT[car];
  const s = new Svg(1600, 780);
  s.region("rg1", 20, 40, 740, 180, "MESH 1 · SPEED");
  s.region("rg2", 20, 262, 740, 236, "MESH 2 · DISTANCE (cascade B)");
  // mesh 1
  s.io(80, 140, "v_{set}");
  s.wire("w-vset", [[92, 140], [128, 140]]);
  s.sum("s1", 150, 140, { left: "+", bottom: "−" });
  s.wire("w-ev", [[172, 140], [712, 140]]);
  s.label(440, 120, "e_v = v_{set} − v_{ego}");
  s.badge("b-ev", 440, 172);
  // mesh 2
  s.io(80, 380, "d_{ref}");
  s.wire("w-dref", [[92, 380], [208, 380]]);
  s.sum("s2", 230, 380, { left: "+", bottom: "−" });
  s.wire("w-ed", [[252, 380], [302, 380]], { label: [277, 362, "e_d"] });
  s.block("b-cd", 370, 380, 132, 96, "C_d", ["−K_d"]);
  s.wire("w-vcorr", [[436, 380], [528, 380]], { label: [482, 362, "v_{corr}"] });
  s.sum("s3", 550, 380, { left: "+", bottom: "+" });
  s.wire("w-eps", [[572, 380], [712, 380]], { label: [640, 362, "ε"] });
  s.badge("b-ed", 290, 418); s.badge("b-vcorr", 482, 418); s.badge("b-eps", 640, 418);
  // switch
  s.dot(720, 140, "pole"); s.dot(720, 380, "pole");
  s.label(728, 120, "1", "start", "dg-pole"); s.label(732, 410, "2", "start", "dg-pole");
  s.add(`<line class="dg-lever" id="lever" x1="806" y1="260" x2="726" y2="146"/>`);
  s.dot(806, 260, "pivot");
  s.add(`<g class="dg-switchnote"><rect x="680" y="455" width="250" height="62" rx="10"/>
    <text x="805" y="481" text-anchor="middle">${m("target ∧ d ≤ d_{ref}  → 2")}</text>
    <text x="805" y="505" text-anchor="middle">${m("otherwise  → 1")}</text></g>`);
  s.wire("w-cin", [[812, 260], [862, 260]]);
  // shared path
  s.block("b-cv", 960, 260, 190, 120, "C_v(z) · PI M1", { num: "q_0 z − q_1", den: "z − 1" });
  s.wire("w-u", [[1055, 260], [1095, 260]], { label: [1075, 242, "Δu"] });
  s.block("b-zoh", 1140, 260, 86, 80, "", ["ZOH"]);
  s.wire("w-uz", [[1183, 260], [1213, 260]]);
  s.block("b-trim", 1300, 260, 170, 100, "trim + sat", [`${P.u0} + Δu`, P.sat]);
  s.wire("w-up", [[1385, 260], [1405, 260]]);
  s.block("b-plant", 1490, 260, 166, 130, P.name.split(" · ")[0],
    { num: "N", den: "s^2 + D s + E", after: P.delay ? "G_v(s) · e^{−0.06 s}" : "G_v(s)" });
  s.badge("b-u", 1300, 345);
  s.wire("w-vout", [[1573, 260], [1592, 260]], { arrow: false });
  // feedbacks
  s.dot(1585, 260);
  s.wire("w-fb1", [[1585, 260], [1585, 580], [150, 580], [150, 162]], { cls: "fb" });
  s.label(900, 570, "v_{ego}");
  s.badge("b-v", 1060, 606);
  s.wire("w-fbr", [[1585, 580], [1585, 660], [1252, 660]], { cls: "fb" });
  s.io(1372, 702, "v_{lead} (radar)", "start");
  s.wire("w-vl", [[1360, 710], [1252, 710]]);
  s.badge("b-vl", 1462, 746);
  s.block("b-dyn", 1110, 685, 280, 110, "distance dynamics", ["Δv = v_{lead} − v_{ego}", "d = ∫ Δv dt"]);
  s.wire("w-dv", [[970, 660], [550, 660], [550, 402]], { cls: "fb" });
  s.label(760, 648, "Δv");
  s.badge("b-dv", 760, 690);
  s.wire("w-d", [[970, 712], [230, 712], [230, 402]], { cls: "fb" });
  s.label(420, 700, "d");
  s.badge("b-d", 420, 742);
  return {
    svg: s.html(),
    info: `<div class="dg-eq">
      <div><b>Mesh 1</b> ε = v_set − v_ego</div>
      <div><b>Mesh 2</b> ε = (v_lead − v_ego) − K_d·(d_ref − d) &nbsp;·&nbsp; K_d = ${KD} s⁻¹</div>
      <div><b>Both</b> Δu[k] = Δu[k−1] + q₀·ε[k] − q₁·ε[k−1],&nbsp; u = u₀ + Δu, saturated</div></div>`,
    live(st) {
      const m2 = st?.mesh === 2;
      cls(["rg2", "s2", "s3", "b-cd", "w-dref", "w-ed", "w-vcorr", "w-eps", "w-dv", "w-d"], "on", !!st && m2);
      cls(["rg1", "s1", "w-vset", "w-ev", "w-fb1"], "on", !!st && !m2);
      cls(["rg2", "s2", "s3", "b-cd", "w-dref", "w-ed", "w-vcorr", "w-eps"], "dim", !!st && !m2);
      cls(["rg1", "s1", "w-vset", "w-ev"], "dim", !!st && m2);
      cls(["w-cin", "b-cv", "w-u", "b-zoh", "w-uz", "b-trim", "w-up", "b-plant", "w-fbr", "w-vl", "b-dyn"], "on", !!st);
      const lever = $("lever");
      if (lever) lever.setAttribute("x2", m2 ? 726 : 726), lever.setAttribute("y2", m2 ? 374 : 146);
      setBadge("b-ev", val(st?.ev, "m/s"), !!st);
      setBadge("b-ed", val(st?.ed, "m", 1), !!st);
      setBadge("b-vcorr", val(st?.vcorr, "m/s"), !!st);
      setBadge("b-eps", val(m2 ? st?.eps : st?.dv != null && st?.vcorr != null ? st.dv + st.vcorr : null, "m/s"), !!st);
      setBadge("b-u", st ? `${P.u.replace(/[_{}]/g, "")} = ${st.u.toFixed(car === "ev" ? 1 : 3)} ${P.unit}` : "", !!st);
      setBadge("b-v", val(st?.v, "m/s"), !!st);
      setBadge("b-vl", val(st?.leadOn ? st.vl : null, "m/s"), !!st);
      setBadge("b-dv", val(st?.dv, "m/s"), !!st);
      setBadge("b-d", val(st?.leadOn ? st.d : null, "m", 1), !!st);
    },
  };
}

// --------------------------------------------------------------------------- 2) mesh 1
function mesh1() {
  const P = PLANT[car];
  const s = new Svg(1600, 470);
  s.io(70, 200, "v_{ref}");
  s.wire("m1-in", [[82, 200], [178, 200]]);
  s.sum("m1-s", 200, 200, { left: "+", bottom: "−" });
  s.wire("m1-e", [[222, 200], [292, 200]], { label: [256, 182, "e(t)"] });
  // sampler
  s.dot(300, 200); s.add(`<line class="dg-lever static" x1="306" y1="196" x2="350" y2="172"/>`); s.dot(356, 200);
  s.label(328, 150, "T_s", "middle", "dg-small");
  s.wire("m1-ek", [[362, 200], [428, 200]], { label: [395, 182, "e[k]"] });
  s.block("m1-cv", 530, 200, 200, 130, "C_v(z)", { num: "q_0 z − q_1", den: "z − 1" });
  s.wire("m1-uk", [[630, 200], [700, 200]], { label: [665, 182, "Δu[k]"] });
  s.block("m1-zoh", 748, 200, 90, 80, "", ["ZOH"]);
  s.wire("m1-ut", [[793, 200], [878, 200]], { label: [836, 182, "Δu(t)"] });
  s.sum("m1-s2", 900, 200, { left: "+", top: "+" });
  s.io(900, 96, `${P.u}_0  (trim)`, "middle");
  s.wire("m1-u0", [[900, 112], [900, 178]]);
  s.wire("m1-u", [[922, 200], [985, 200]], { label: [954, 182, P.u] });
  s.block("m1-sat", 1040, 200, 104, 90, "sat", [P.sat.split(" ")[0] + " " + P.sat.split(" ")[1]]);
  s.wire("m1-us", [[1092, 200], [1172, 200]]);
  s.label(1132, 182, "u");
  s.block("m1-g", 1305, 200, 266, 150, `G_v(s) · ${P.name.split(" · ")[0]}`,
    { num: "N", den: "s^2 + D s + E", after: P.delay ? "× e^{−0.06 s}  (torque delay 60 ms)" : "DC motor + vehicle (M1)" });
  s.wire("m1-v", [[1438, 200], [1570, 200]], { label: [1520, 182, "v_{ego}"] });
  s.dot(1490, 200);
  s.wire("m1-fb", [[1490, 200], [1490, 360], [200, 360], [200, 222]], { cls: "fb" });
  s.badge("m1-b-ref", 120, 240); s.badge("m1-b-e", 256, 240); s.badge("m1-b-u", 954, 240); s.badge("m1-b-v", 1520, 240);
  const p = opPoint(null);
  return {
    svg: s.html(),
    info: eqGrid([
      ["Controller (continuous)", `C(s) = K_p + K_i/s = K_p ${frac("s + 0.25", "s")}, &nbsp; z = K_i/K_p = 0.25 rad/s, &nbsp; ω_c = 0.8 rad/s`],
      ["Gain from the cut-off", `K_p = ${frac("√[(E − ω_c²)² + (D ω_c)²]", "N √(1 + (0.25/ω_c)²)")}, &nbsp; K_i = 0.25 K_p`],
      ["Discrete (backward Euler)", `C_v(z) = ${frac("q₀ z − q₁", "z − 1")}, &nbsp; q₀ = K_p(1 + 0.25 T_s) = 1.005 K_p, &nbsp; q₁ = K_p`],
      ["Plant M1", `G_v(s) = ${frac("Δv(s)", `${P.du}(s)`)} = ${frac("N", "s² + D s + E")}${P.delay ? " · e<sup>−0.06 s</sup> &nbsp;(60 ms = z<sup>−3</sup>)" : ""}`],
      ["Closed loop", `L_V(z) = C_v(z) G_v(z)${P.nd ? " z<sup>−3</sup>" : ""}, &nbsp; T_V(z) = ${frac("L_V(z)", "1 + L_V(z)")}, &nbsp; T_V(1) = 1 (zero static error)`],
    ]) + pointTable(p, "s1"),
    live(st) {
      cls(["m1-in", "m1-e", "m1-ek", "m1-cv", "m1-uk", "m1-zoh", "m1-ut", "m1-u0", "m1-u", "m1-sat", "m1-us", "m1-g", "m1-v", "m1-fb", "m1-s"], "on", !!st && st.mesh === 1);
      setBadge("m1-b-ref", val(st?.vset, "m/s"), !!st);
      setBadge("m1-b-e", val(st?.ev, "m/s"), !!st);
      setBadge("m1-b-u", st ? `${st.u.toFixed(car === "ev" ? 1 : 3)} ${P.unit}` : "", !!st);
      setBadge("m1-b-v", val(st?.v, "m/s"), !!st);
    },
  };
}

// --------------------------------------------------------------------------- 3) mesh 2 (B)
function mesh2() { return form === "reduced" ? mesh2Reduced() : mesh2Full(); }

function mesh2Full() {
  const P = PLANT[car];
  const s = new Svg(1600, 560);
  s.io(66, 200, "d_{ref}");
  s.wire("m2-in", [[78, 200], [148, 200]]);
  s.sum("m2-s1", 170, 200, { left: "+", bottom: "−" });
  s.wire("m2-ed", [[192, 200], [262, 200]], { label: [227, 182, "e_d"] });
  s.block("m2-cd", 325, 200, 120, 100, "C_d(s)", ["−K_d"]);
  s.wire("m2-vc", [[385, 200], [478, 200]], { label: [431, 182, "v_{corr}"] });
  s.sum("m2-s2", 500, 200, { left: "+", top: "+" });
  s.io(500, 84, "v_{lead}", "middle");
  s.wire("m2-vl", [[500, 100], [500, 178]]);
  s.wire("m2-vr", [[522, 200], [598, 200]], { label: [560, 182, "v_{ref}"] });
  s.sum("m2-s3", 620, 200, { left: "+", bottom: "−" });
  s.wire("m2-ev", [[642, 200], [712, 200]], { label: [677, 182, "e_v"] });
  s.block("m2-cv", 810, 200, 190, 130, "C_v(z) · PI M1", { num: "q_0 z − q_1", den: "z − 1" });
  s.wire("m2-u", [[905, 200], [955, 200]]);
  s.block("m2-zoh", 1000, 200, 86, 80, "", ["ZOH"]);
  s.wire("m2-uz", [[1043, 200], [1068, 200]]);
  s.block("m2-g", 1185, 200, 230, 150, `G_v(s) · ${P.name.split(" · ")[0]}`,
    { num: "N", den: "s^2 + D s + E", after: P.delay ? "× e^{−0.06 s}" : "M1" });
  s.wire("m2-v", [[1300, 200], [1462, 200], [1462, 268]], { label: [1400, 182, "v_{ego}"] });
  s.dot(1330, 200);
  s.block("m2-dyn", 1462, 325, 236, 110, "distance dynamics", ["ḋ = v_{lead} − v_{ego}", "d = ∫ ḋ dt"]);
  s.io(1540, 448, "v_{lead}", "middle");
  s.wire("m2-vl2", [[1540, 430], [1540, 382]]);
  s.wire("m2-d", [[1462, 380], [1462, 480], [170, 480], [170, 222]], { cls: "fb" });
  s.label(820, 468, "d (measured by the radar)");
  s.wire("m2-fbv", [[1330, 200], [1330, 410], [620, 410], [620, 222]], { cls: "fb" });
  s.label(1000, 398, "v_{ego}");
  s.badge("m2-b-ed", 227, 240); s.badge("m2-b-vc", 431, 240); s.badge("m2-b-vl", 560, 84, "start");
  s.badge("m2-b-vr", 560, 240); s.badge("m2-b-ev", 677, 240); s.badge("m2-b-v", 1400, 150); s.badge("m2-b-d", 820, 510);
  const p = opPoint(null);
  return {
    svg: s.html(),
    info: eqGrid([
      ["Distance controller", `e_d = d_ref − d, &nbsp; C_d(s) = −K_d, &nbsp; v_corr = −K_d·e_d, &nbsp; K_d = ${KD} s⁻¹ (τ = 1/K_d = 2 s)`],
      ["Speed set-point (B)", `v_ref = v_lead + v_corr, &nbsp; e_v = v_ref − v_ego = (v_lead − v_ego) − K_d (d_ref − d)`],
      ["Combined controller", `C_B(z) = C_v(z) = ${frac("q₀ z − q₁", "z − 1")}, &nbsp; Δu[k] = Δu[k−1] + q₀ ε[k] − q₁ ε[k−1]`],
      ["Loop (v_lead constant)", `L_B(z) = C_v(z) [ G_v(z) + K_d G_x(z) ]${P.nd ? " z<sup>−3</sup>" : ""}, &nbsp; G_x = position (ZOH of G_v(s)/s)`],
      ["Distance response", `T_d(z) = ${frac("K_d C_v(z) G_x(z) z^{−n_d}", "1 + L_B(z)")}, &nbsp; T_d(1) = 1 (zero static error)`],
      ["Ideal model (§7)", `v_ego = v_lead + v_corr ⇒ ė_d = −K_d e_d ⇒ e_d(t) = e_d(0) e<sup>−K_d t</sup>`],
    ]) + pointTable(p, "B"),
    live(st) {
      const on = !!st && st.mesh === 2;
      cls(["m2-in", "m2-ed", "m2-cd", "m2-vc", "m2-vl", "m2-vr", "m2-ev", "m2-cv", "m2-u", "m2-zoh", "m2-uz", "m2-g", "m2-v", "m2-v2", "m2-dyn", "m2-d", "m2-fbv", "m2-s1", "m2-s2", "m2-s3"], "on", on);
      setBadge("m2-b-ed", val(st?.ed, "m", 1), !!st);
      setBadge("m2-b-vc", val(st?.vcorr, "m/s"), !!st);
      setBadge("m2-b-vl", val(st?.leadOn ? st.vl : null, "m/s"), !!st);
      setBadge("m2-b-vr", val(st?.vref, "m/s"), !!st);
      setBadge("m2-b-ev", val(st?.vref != null ? st.vref - st.v : null, "m/s"), !!st);
      setBadge("m2-b-v", val(st?.v, "m/s"), !!st);
      setBadge("m2-b-d", val(st?.leadOn ? st.d : null, "m", 1), !!st);
    },
  };
}

// Reduced form (§11.6): e_v = (v_lead + v_corr) − v_ego = Δv + v_corr = ε,
// one junction fed by the radar's relative speed, one PI on the composite error.
function mesh2Reduced() {
  const P = PLANT[car];
  const s = new Svg(1600, 540);
  s.io(66, 200, "d_{ref}");
  s.wire("r-in", [[78, 200], [148, 200]]);
  s.sum("r-s1", 170, 200, { left: "+", bottom: "−" });
  s.wire("r-ed", [[192, 200], [262, 200]], { label: [227, 182, "e_d"] });
  s.block("r-cd", 325, 200, 120, 100, "C_d(s)", ["−K_d"]);
  s.wire("r-vc", [[385, 200], [478, 200]], { label: [431, 182, "v_{corr}"] });
  s.sum("r-s2", 500, 200, { left: "+", bottom: "+" });
  s.wire("r-eps", [[522, 200], [603, 200]], { label: [562, 182, "ε"] });
  s.block("r-cv", 700, 200, 190, 130, "C_B(z) = C_v(z)", { num: "q_0 z − q_1", den: "z − 1" });
  s.wire("r-u", [[795, 200], [845, 200]], { label: [820, 182, "Δu"] });
  s.block("r-zoh", 890, 200, 86, 80, "", ["ZOH"]);
  s.wire("r-uz", [[933, 200], [983, 200]]);
  s.block("r-g", 1100, 200, 230, 150, `G_v(s) · ${P.name.split(" · ")[0]}`,
    { num: "N", den: "s^2 + D s + E", after: P.delay ? "× e^{−0.06 s}" : "M1" });
  s.wire("r-v", [[1215, 200], [1303, 200]], { label: [1259, 182, "v_{ego}"] });
  s.block("r-dyn", 1420, 200, 230, 120, "radar · distance dynamics", ["Δv = v_{lead} − v_{ego}", "d = ∫ Δv dt"]);
  s.io(1480, 322, "v_{lead}", "middle");
  s.wire("r-vl", [[1480, 306], [1480, 262]]);
  s.wire("r-d", [[1535, 175], [1585, 175], [1585, 480], [170, 480], [170, 222]], { cls: "fb" });
  s.label(870, 468, "d");
  s.wire("r-dv", [[1535, 228], [1560, 228], [1560, 410], [500, 410], [500, 222]], { cls: "fb" });
  s.label(1000, 398, "Δv = v_{lead} − v_{ego}  (radar relative speed)");
  s.add(`<g class="dg-switchnote"><rect x="560" y="288" width="420" height="62" rx="10"/>
    <text x="770" y="314" text-anchor="middle">${m("ε = (v_{lead} − v_{ego}) − K_d (d_{ref} − d)")}</text>
    <text x="770" y="338" text-anchor="middle">${m("= e_v of the full form, at every sample")}</text></g>`);
  s.badge("r-b-ed", 227, 240); s.badge("r-b-vc", 431, 240); s.badge("r-b-eps", 562, 240);
  s.badge("r-b-v", 1259, 240); s.badge("r-b-dv", 1000, 440); s.badge("r-b-d", 870, 510);
  const p = opPoint(null);
  return {
    svg: s.html(),
    info: eqGrid([
      ["Reduction", `e_v = v_ref − v_ego = (v_lead + v_corr) − v_ego = (v_lead − v_ego) + v_corr = Δv − K_d e_d ≡ ε`],
      ["Composite error", `ε[k] = (v_lead[k] − v_ego[k]) − K_d (d_ref − d[k]), &nbsp; Δv = v_lead − v_ego = dd/dt, measured by the radar`],
      ["Single PI", `C_B(z) = C_v(z) = ${frac("q₀ z − q₁", "z − 1")}, &nbsp; Δu[k] = Δu[k−1] + q₀ ε[k] − q₁ ε[k−1]`],
      ["Loop (v_lead constant)", `L_B(z) = C_v(z) [ G_v(z) + K_d G_x(z) ]${P.nd ? " z<sup>−3</sup>" : ""}: one PI acting on speed and position of the same plant`],
      ["Distance response", `T_d(z) = ${frac("K_d C_v(z) G_x(z) z^{−n_d}", "1 + L_B(z)")}, &nbsp; T_d(1) = 1 (zero static error)`],
      ["Why it works (vs A)", `the Δv path measures the speed again (A had e_v = v_corr only): it adds the damping that makes the ICE loop stable`],
    ]) + pointTable(p, "B"),
    live(st) {
      const on = !!st && st.mesh === 2;
      cls(["r-in", "r-ed", "r-cd", "r-vc", "r-eps", "r-cv", "r-u", "r-zoh", "r-uz", "r-g", "r-v", "r-dyn", "r-vl", "r-d", "r-dv", "r-s1", "r-s2"], "on", on);
      setBadge("r-b-ed", val(st?.ed, "m", 1), !!st);
      setBadge("r-b-vc", val(st?.vcorr, "m/s"), !!st);
      setBadge("r-b-eps", val(st?.dv != null && st?.vcorr != null ? st.dv + st.vcorr : null, "m/s"), !!st);
      setBadge("r-b-v", val(st?.v, "m/s"), !!st);
      setBadge("r-b-dv", val(st?.dv, "m/s"), !!st);
      setBadge("r-b-d", val(st?.leadOn ? st.d : null, "m", 1), !!st);
    },
  };
}

// --------------------------------------------------------------------------- 4) architecture A
function archA() {
  const s = new Svg(1600, 640);
  s.add(`<text class="dg-step" x="30" y="44">① Initial design: two junctions around the speed controller</text>`);
  s.io(62, 150, "d_{ref}");
  s.wire("a-in", [[74, 150], [138, 150]]);
  s.sum("a-s1", 160, 150, { left: "+", bottom: "−" });
  s.wire("a-ed", [[182, 150], [240, 150]], { label: [211, 132, "e_d"] });
  s.block("a-cd", 300, 150, 112, 92, "C_d", ["−K_d"]);
  s.wire("a-vc", [[356, 150], [448, 150]], { label: [402, 132, "v_{corr}"] });
  s.sum("a-s2", 470, 150, { left: "+", bottom: "+" });
  s.wire("a-vr", [[492, 150], [568, 150]], { label: [530, 132, "v_{ref}"] });
  s.sum("a-s3", 590, 150, { left: "+", bottom: "−" });
  s.wire("a-ev", [[612, 150], [680, 150]], { label: [646, 132, "e_v"] });
  s.block("a-cv", 750, 150, 130, 92, "C_v(s)", ["PI M1"]);
  s.wire("a-u", [[815, 150], [880, 150]]);
  s.block("a-g", 960, 150, 150, 92, "plant", ["ICE / EV"]);
  s.wire("a-v", [[1035, 150], [1170, 150]], { label: [1100, 132, "v_{ego}"] });
  s.block("a-dyn", 1260, 150, 170, 92, "distance", ["dynamics"]);
  s.io(1260, 238, "v_{lead}", "middle");
  s.wire("a-vl", [[1260, 222], [1260, 196]]);
  s.wire("a-d", [[1345, 150], [1400, 150], [1400, 270], [160, 270], [160, 172]], { cls: "fb" });
  s.label(780, 262, "d_{mesurée}");
  s.dot(1100, 150);
  s.wire("a-fb1", [[1100, 150], [1100, 220], [470, 220], [470, 172]], { cls: "fb" });
  s.wire("a-fb2", [[1100, 220], [1100, 236], [590, 236], [590, 172]], { cls: "fb" });
  s.add(`<text class="dg-note" x="1450" y="120">v_ref = v_ego + v_corr</text>
         <text class="dg-note" x="1450" y="150">e_v = v_ref − v_ego</text>
         <text class="dg-note strong" x="1450" y="182">⇒ e_v = v_corr</text>`);

  s.add(`<text class="dg-step" x="30" y="356">② Simplified cascade: the distance controller piped into the speed controller</text>`);
  s.io(62, 470, "d_{ref}");
  s.wire("b-in", [[74, 470], [138, 470]]);
  s.sum("b-s1", 160, 470, { left: "+", bottom: "−" });
  s.wire("b-ed", [[182, 470], [262, 470]], { label: [222, 452, "e_d"] });
  s.block("b-cd2", 330, 470, 130, 96, "C_d(s)", ["−K_d"]);
  s.wire("b-vc", [[395, 470], [500, 470]], { label: [448, 452, "v_{corr} = e_v"] });
  s.block("b-cv2", 580, 470, 156, 96, "C_v(s)", { num: "K_p (s + 0.25)", den: "s" });
  s.wire("b-u", [[658, 470], [760, 470]]);
  s.block("b-g2", 850, 470, 176, 96, "plant ICE / EV", { num: "N", den: "s^2 + D s + E" });
  s.wire("b-v", [[938, 470], [1050, 470]], { label: [994, 452, "v_{ego}"] });
  s.block("b-dyn2", 1140, 470, 176, 96, "distance dynamics", ["ḋ = v_{lead} − v_{ego}"]);
  s.io(1140, 562, "v_{lead}", "middle");
  s.wire("b-vl", [[1140, 548], [1140, 518]]);
  s.wire("b-d", [[1228, 470], [1290, 470], [1290, 600], [160, 600], [160, 492]], { cls: "fb" });
  s.label(720, 590, "d");
  s.add(`<g class="dg-verdict"><rect x="1330" y="400" width="250" height="210" rx="14"/>
    <text x="1455" y="432" text-anchor="middle" class="h">§11.5 verdict</text>
    <text x="1350" y="466">EV: stable but PM ≈ 23°,</text>
    <text x="1350" y="492">overshoot ≈ 62 %</text>
    <text x="1350" y="530" class="bad">ICE: UNSTABLE</text>
    <text x="1350" y="556" class="bad">for every K_d &gt; 0</text>
    <text x="1350" y="590">→ corrected to B</text></g>`);
  return {
    svg: s.html(),
    info: eqGrid([
      ["Why A fails", `L_A(s) = ${frac("K (s + 0.25)", "s² (s² + D s + E)")}, K = K_d K_p N — a <b>double integrator</b> (PI + d → v), so −180°; the only phase lead is the PI zero at 0.25 rad/s`],
      ["Routh", `s⁴ + D s³ + E s² + K s + 0.25 K: stable ⇔ 0 &lt; K &lt; D (E − 0.25 D) — needs E &gt; 0.25 D`],
      ["EV (v₀ = 30)", `E − 0.25 D = 31.53 − 12.51 = 19.03 &gt; 0 → K_d &lt; 19.7 (13.1 discrete), but only ≈ 23° of margin`],
      ["ICE (v₀ = 30)", `E − 0.25 D = 0.903 − 4.629 = −3.73 &lt; 0 → <b>no K_d</b> stabilises A (negative at all 5 points)`],
      ["Correction (§11.6)", `v_ref = v_lead + v_corr instead of v_ego + v_corr: the relative speed v_lead − v_ego (radar) gives the damping that A lacks`],
    ]),
    live() {},
  };
}

// --------------------------------------------------------------------------- 5) switching
function switching() {
  const s = new Svg(1600, 420);
  s.add(`<g class="dg-state" id="st1"><rect x="160" y="110" width="440" height="200" rx="100"/>
    <text class="big" x="380" y="190" text-anchor="middle">MESH 1</text>
    <text class="sm" x="380" y="230" text-anchor="middle">${m("speed: ε = v_{set} − v_{ego}")}</text>
    <text class="sm" x="380" y="262" text-anchor="middle">cruise at the set speed</text></g>`);
  s.add(`<g class="dg-state" id="st2"><rect x="1000" y="110" width="440" height="200" rx="100"/>
    <text class="big" x="1220" y="190" text-anchor="middle">MESH 2</text>
    <text class="sm" x="1220" y="230" text-anchor="middle">${m("distance: ε = Δv − K_d (d_{ref} − d)")}</text>
    <text class="sm" x="1220" y="262" text-anchor="middle">follow the car ahead</text></g>`);
  s.wire("tr12", [[600, 165], [1000, 165]]);
  s.wire("tr21", [[1000, 255], [600, 255]]);
  s.add(`<text class="dg-cond" x="800" y="145" text-anchor="middle">${m("target detected  ∧  d ≤ d_{ref}")}</text>
         <text class="dg-cond" x="800" y="295" text-anchor="middle">${m("no target  ∨  d > d_{ref}")}</text>
         <text class="dg-small" x="800" y="370" text-anchor="middle">${m("Evaluated every T_s = 20 ms on the radar measurements (d, v_{lead}) · the speed PI C_v is shared, so only its input changes")}</text>`);
  s.badge("sw-b", 800, 60);
  return {
    svg: s.html(),
    info: `<div class="dg-timeline"><div id="dg-tl1"></div><div id="dg-tl2"></div></div>
      <p class="dg-caption">Last 60 s of the running simulation: the gap d against d_ref, and the mesh the switch selects.
      Note: the simulator runs §12 (min-selection of the speed and distance laws); its own mode is shown in the badge
      for comparison.</p>`,
    live(st) {
      cls(["st1", "tr21"], "on", !!st && st.mesh === 1);
      cls(["st2", "tr12"], "on", !!st && st.mesh === 2);
      setBadge("sw-b", st ? `d = ${st.leadOn ? st.d.toFixed(1) : "—"} m · d_ref = ${st.target ? st.dref.toFixed(1) : "—"} m → mesh ${st.mesh}   (simulator: ${st.simMode})` : "no data", true);
      drawTimeline();
    },
  };
}
function drawTimeline() {
  const { columns, rows } = api.getLive();
  if (!rows.length || !$("dg-tl1")) return;
  const idx = Object.fromEntries(columns.map((n, i) => [n, i]));
  if (idx[`${car}_d`] === undefined) return;
  const tEnd = rows[rows.length - 1][0];
  const k0 = rows.findIndex((r) => r[0] >= tEnd - 60);
  const step = Math.max(1, Math.floor((rows.length - k0) / 600));
  const t = [], d = [], dr = [], mesh = [];
  for (let k = Math.max(0, k0); k < rows.length; k += step) {
    const r = rows[k], g = (n) => r[idx[`${car}_${n}`]];
    const tg = g("target") > 0.5, lo = g("lead_on") > 0.5;
    t.push(r[0]); d.push(lo ? g("d") : null); dr.push(tg && g("d_ref") > 0 ? g("d_ref") : null);
    mesh.push(tg && g("d") <= g("d_ref") ? 2 : 1);
  }
  if (!timeline) {
    timeline = {
      a: new XYPlot($("dg-tl1"), { title: "Gap and target", xlabel: "time [s]", ylabel: "m", height: 220 }),
      b: new XYPlot($("dg-tl2"), { title: "Selected mesh", xlabel: "time [s]", ylabel: "mesh", height: 220, ymin: 0.8, ymax: 2.2 }),
    };
  }
  timeline.a.set([{ name: "d", x: t, y: d, color: `var(--${car})` }, { name: "d_ref", x: t, y: dr, color: "var(--target)", dash: [8, 5] }], { yzero: true });
  timeline.b.set([{ name: "mesh (1 speed, 2 distance)", x: t, y: mesh, color: "var(--accent)", width: 3 }]);
}

// --------------------------------------------------------------------------- 6) sampled
function sampled() {
  const P = PLANT[car];
  const s = new Svg(1600, 600);
  s.add(`<text class="dg-step" x="30" y="44">Sampled chain (§11.1): only the controllers are discrete, the plant stays continuous</text>`);
  s.io(92, 160, "set-point");
  s.wire("sp-in", [[104, 160], [178, 160]]);
  s.sum("sp-s", 200, 160, { left: "+", bottom: "−" });
  s.wire("sp-e", [[222, 160], [292, 160]], { label: [256, 142, "e(t)"] });
  s.dot(300, 160); s.add(`<line class="dg-lever static" x1="306" y1="156" x2="350" y2="132"/>`); s.dot(356, 160);
  s.label(328, 112, "T_s = 20 ms", "middle", "dg-small");
  s.wire("sp-ek", [[362, 160], [440, 160]], { label: [400, 142, "e[k]"] });
  s.block("sp-c", 520, 160, 150, 96, "", ["C(z)"]);
  s.wire("sp-uk", [[595, 160], [680, 160]], { label: [638, 142, "u[k]"] });
  s.block("sp-zoh", 730, 160, 96, 86, "", ["ZOH"]);
  s.wire("sp-ut", [[778, 160], [870, 160]], { label: [824, 142, "u(t)"] });
  s.block("sp-g", 960, 160, 170, 96, "continuous", ["G(s)"]);
  s.wire("sp-y", [[1045, 160], [1180, 160]], { label: [1110, 142, "output"] });
  s.dot(1110, 160);
  s.wire("sp-fb", [[1110, 160], [1110, 270], [200, 270], [200, 182]], { cls: "fb" });
  s.add(`<g class="dg-verdict info"><rect x="1210" y="80" width="370" height="200" rx="14"/>
    <text x="1230" y="114">ZOH phase loss ≈ ω_c T_s / 2 = 0.46°</text>
    <text x="1230" y="148">ω_s = 2π/T_s = 314 rad/s ≈ 390 ω_c</text>
    <text x="1230" y="182">Nyquist π/T_s = 157 rad/s</text>
    <text x="1230" y="216">v and d sampled at the same kT_s</text>
    <text x="1230" y="250">${P.delay ? "ICE delay 60 ms = z⁻³" : "EV: no transport delay"}</text></g>`);

  s.add(`<text class="dg-step" x="30" y="360">Combined controller (§11.3 b): substitution commutes with the product</text>`);
  s.wire("eq-in", [[60, 470], [150, 470]]);
  s.label(105, 452, "e_d");
  s.block("eq-cd", 220, 470, 130, 92, "C_d", ["−K_d"]);
  s.wire("eq-m", [[285, 470], [370, 470]]);
  s.block("eq-cv", 460, 470, 170, 92, "C_v(s)", { num: "K_p (s + 0.25)", den: "s" });
  s.wire("eq-out", [[545, 470], [620, 470]]);
  s.add(`<text class="dg-equiv" x="680" y="482" text-anchor="middle">≡</text>`);
  s.wire("eq-in2", [[740, 470], [830, 470]]);
  s.block("eq-ceq", 980, 470, 290, 100, "C_{eq}(s) = C_d C_v(s)", { num: "−K_d K_p (s + 0.25)", den: "s" });
  s.wire("eq-out2", [[1125, 470], [1180, 470]]);
  s.add(`<g class="dg-verdict info"><rect x="1195" y="400" width="395" height="150" rx="14"/>
    <text x="1213" y="436">s → (z − 1)/(z T_s) is a substitution,</text>
    <text x="1213" y="468">so discrete(C_d·C_v) = C_d·discrete(C_v)</text>
    <text x="1213" y="500">exactly. Not true for a ZOH or a</text>
    <text x="1213" y="530">pole–zero matching discretisation.</text></g>`);
  return {
    svg: s.html(),
    info: eqGrid([
      ["Backward Euler", `s → ${frac("z − 1", "z T_s")}, &nbsp; C_v(z) = ${frac("q₀ z − q₁", "z − 1")} = ${frac("q₀ − q₁ z⁻¹", "1 − z⁻¹")}`],
      ["Zero and pole", `zero z = q₁/q₀ = 1/1.005 = 0.99502 (= e<sup>−0.25 T_s</sup>), &nbsp; pole z = 1 (integrator)`],
      ["Every 20 ms", `Δu[k] = Δu[k−1] + q₀ e[k] − q₁ e[k−1], &nbsp; u[k] = u₀ + Δu[k], saturated to ${PLANT[car].sat}`],
      ["Anti-windup", `if u[k] saturates: Δu[k] ← u_sat − u₀ before it is stored`],
      ["Plant (ZOH, analysis only)", `G_v(z) = ${frac("b₁ z + b₂", "z² + a₁ z + a₂")}, &nbsp; G(z) = (1 − z⁻¹)·Z{G(s)/s}; same static gain N/E`],
    ]) + zTable(opPoint(null)),
    live(st) {
      cls(["sp-in", "sp-e", "sp-ek", "sp-c", "sp-uk", "sp-zoh", "sp-ut", "sp-g", "sp-y", "sp-fb"], "on", !!st && st.running);
    },
  };
}

// --------------------------------------------------------------------------- 7) operating points
function points() {
  return {
    svg: "",
    info: `<div class="dg-points">
      <div class="dg-pp" id="dg-pp1"></div><div class="dg-pp" id="dg-pp2"></div>
      <div class="dg-pp" id="dg-pp3"></div><div class="dg-pp" id="dg-pp4"></div></div>` +
      ["ev", "ice"].map((c) => `<h3 class="dg-h3">${PLANT[c].name}</h3>` + bigTable(c)).join("") +
      `<p class="dg-caption">Gain scheduling: q₀, q₁ and the trim u₀ are interpolated in v[k] between these points (§11.7).
       The analysis point by point does not guarantee by itself that the transitions stay stable; the simulation checks it.</p>`,
    after() {
      const P = (c, k) => POINTS[c].map((p) => p[k]);
      const sub = (c, s, k) => POINTS[c].map((p) => (p[s] ? p[s][k] : null));
      pts.push(new XYPlot($("dg-pp1"), { title: "EV: K_p vs operating speed", xlabel: "v₀ [m/s]", ylabel: "V/(m/s)", height: 230 })
        .set([{ name: "K_p", x: P("ev", "v0"), y: P("ev", "Kp"), color: "var(--ev)", dots: true }]));
      pts.push(new XYPlot($("dg-pp2"), { title: "ICE: K_p vs operating speed", xlabel: "v₀ [m/s]", ylabel: "rad/(m/s)", height: 230 })
        .set([{ name: "K_p", x: P("ice", "v0"), y: P("ice", "Kp"), color: "var(--ice)", dots: true }]));
      pts.push(new XYPlot($("dg-pp3"), { title: "Phase margin (discrete)", xlabel: "v₀ [m/s]", ylabel: "degrees", height: 230 })
        .set([
          { name: "EV mesh 1", x: P("ev", "v0"), y: sub("ev", "s1", "PM"), color: "var(--ev)", dots: true },
          { name: "EV mesh 2 (B)", x: P("ev", "v0"), y: sub("ev", "B", "PM"), color: "var(--ev)", dash: [6, 4], dots: true },
          { name: "ICE mesh 1", x: P("ice", "v0"), y: sub("ice", "s1", "PM"), color: "var(--ice)", dots: true },
          { name: "ICE mesh 2 (B)", x: P("ice", "v0"), y: sub("ice", "B", "PM"), color: "var(--ice)", dash: [6, 4], dots: true },
        ], { yzero: true }));
      pts.push(new XYPlot($("dg-pp4"), { title: "Step overshoot", xlabel: "v₀ [m/s]", ylabel: "%", height: 230 })
        .set([
          { name: "EV mesh 1", x: P("ev", "v0"), y: sub("ev", "s1", "D"), color: "var(--ev)", dots: true },
          { name: "EV mesh 2 (B)", x: P("ev", "v0"), y: sub("ev", "B", "D"), color: "var(--ev)", dash: [6, 4], dots: true },
          { name: "ICE mesh 1", x: P("ice", "v0"), y: sub("ice", "s1", "D"), color: "var(--ice)", dots: true },
          { name: "ICE mesh 2 (B)", x: P("ice", "v0"), y: sub("ice", "B", "D"), color: "var(--ice)", dash: [6, 4], dots: true },
        ], { yzero: true }));
    },
    live() {},
  };
}
let pts = [];

// --------------------------------------------------------------------------- tables
function eqGrid(rows) {
  return `<div class="dg-eqgrid">${rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${mh(v).replace(/&lt;(\/?(?:b|sup|sub|span)[^&]*)&gt;/g, "<$1>").replace(/&amp;/g, "&")}</div>`).join("")}</div>`;
}
function pointTable(p, sys) {
  const P = PLANT[car], r = p[sys];
  const sysName = sys === "s1" ? "mesh 1 (Système 1)" : "mesh 2 (cascade B)";
  return `<div class="dg-numbers">
    <div class="dg-num"><span>operating point</span><b>v₀ = ${p.v0} m/s</b></div>
    <div class="dg-num"><span>PI gains</span><b>K_p = ${p.Kp}, K_i = ${p.Ki}</b></div>
    <div class="dg-num"><span>discrete</span><b>q₀ = ${p.q0}, q₁ = ${p.q1}</b></div>
    <div class="dg-num"><span>plant</span><b>N = ${p.N}, D = ${p.D}, E = ${p.E}</b></div>
    <div class="dg-num"><span>trim</span><b>${mh(P.u)}₀ = ${p.u0} ${P.unit}</b></div>
    <div class="dg-num hl"><span>${sysName}</span><b>PM ${r.PM}° · GM ${r.GM} dB · overshoot ${r.D} % · t_s ${r.ts} s${r.Kdmax ? ` · K_d,max ${r.Kdmax}` : ""}</b></div>
  </div>`;
}
function zTable(p) {
  return `<div class="dg-numbers">
    <div class="dg-num"><span>v₀</span><b>${p.v0} m/s</b></div>
    <div class="dg-num"><span>G_v(z) numerator</span><b>b₁ = ${n4(p.b1)}, b₂ = ${n4(p.b2)}</b></div>
    <div class="dg-num"><span>G_v(z) denominator</span><b>a₁ = ${p.a1}, a₂ = ${p.a2}</b></div>
    <div class="dg-num"><span>C_v(z)</span><b>q₀ = ${p.q0}, q₁ = ${p.q1}</b></div></div>`;
}
function bigTable(c) {
  const P = PLANT[c];
  return `<div class="dg-tablewrap"><table class="dg-table"><thead><tr>
    <th>v₀ [m/s]</th><th>K_p</th><th>K_i</th><th>q₀</th><th>q₁</th><th>${mh(P.u)}₀ [${P.unit}]</th><th>G_v(s)</th>
    <th>mesh 1: PM · D% · t_s</th><th>mesh 2 (B): PM · D% · t_s · K_d,max</th><th>A (initial)</th></tr></thead><tbody>
    ${POINTS[c].map((p) => `<tr><td>${p.v0}</td><td>${p.Kp}</td><td>${p.Ki}</td><td>${p.q0}</td><td>${p.q1}</td><td>${p.u0}</td>
      <td>${p.N} / (s² + ${p.D} s + ${p.E})${P.delay ? " · e<sup>−0.06s</sup>" : ""}</td>
      <td>${p.s1.PM}° · ${p.s1.D} % · ${p.s1.ts} s</td>
      <td>${p.B.PM}° · ${p.B.D} % · ${p.B.ts} s · ${p.B.Kdmax}</td>
      <td class="${p.A ? "" : "bad"}">${p.A ? `${p.A.PM}° · ${p.A.D} %` : "unstable"}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// ============================================================================ page
let current = null;

export function initDiagrams(a) {
  api = a;
  try {
    const st = JSON.parse(localStorage.getItem("ktrl.diagrams") || "{}");
    slide = st.slide ?? 0; car = st.car ?? "ev"; opMode = st.op ?? "auto"; form = st.form ?? "full";
  } catch { /* */ }
  // Full / Reduced switch (created here, shown on the slides that have two forms)
  const fm = document.createElement("div");
  fm.className = "seg small";
  fm.id = "dg-form";
  fm.title = "Diagram form (Mesh 2): as built, or reduced as in §11.6";
  fm.innerHTML = '<button data-value="full">Full</button><button data-value="reduced">Reduced</button>';
  $("dg-car").before(fm);
  fm.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { form = b.dataset.value; save(); render(); }));
  const nav = $("dg-nav");
  SLIDES.forEach((s, i) => {
    const b = document.createElement("button");
    b.dataset.i = i;
    b.innerHTML = `<span>${i + 1}</span>${s.tab}`;
    b.addEventListener("click", () => go(i));
    nav.appendChild(b);
  });
  document.querySelectorAll("#dg-car button").forEach((b) => b.addEventListener("click", () => {
    car = b.dataset.value; opMode = "auto"; save(); render();
  }));
  $("dg-op").addEventListener("change", (e) => { opMode = e.target.value; save(); render(); });
  $("dg-prev").addEventListener("click", () => go(slide - 1));
  $("dg-next").addEventListener("click", () => go(slide + 1));
  $("dg-present").addEventListener("click", () => {
    const el = $("dg-stage");
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  });
  document.addEventListener("fullscreenchange", () => {
    $("dg-stage").classList.toggle("fs", document.fullscreenElement === $("dg-stage"));
  });
  document.addEventListener("keydown", (e) => {
    if (!$("view-diagrams").classList.contains("on") || e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(slide + 1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(slide - 1); }
    if (e.key === "f" || e.key === "F") $("dg-present").click();
    if ((e.key === "v" || e.key === "V") && SLIDES[slide].forms) { form = form === "full" ? "reduced" : "full"; save(); render(); }
  });
  render();
}
function save() { try { localStorage.setItem("ktrl.diagrams", JSON.stringify({ slide, car, op: opMode, form })); } catch { /* */ } }
function go(i) { slide = (i + SLIDES.length) % SLIDES.length; save(); render(); }

function render() {
  for (const p of pts) p.destroy();
  pts = [];
  if (timeline) { timeline.a.destroy(); timeline.b.destroy(); timeline = null; }
  const S = SLIDES[slide];
  document.querySelectorAll("#dg-nav button").forEach((b) => b.classList.toggle("on", +b.dataset.i === slide));
  document.querySelectorAll("#dg-car button").forEach((b) => b.classList.toggle("on", b.dataset.value === car));
  const op = $("dg-op");
  op.innerHTML = `<option value="auto">auto (live speed)</option>` +
    POINTS[car].map((p, i) => `<option value="${i}">v₀ = ${p.v0} m/s</option>`).join("");
  op.value = opMode;
  $("dg-form").style.display = S.forms ? "" : "none";
  document.querySelectorAll("#dg-form button").forEach((b) => b.classList.toggle("on", b.dataset.value === form));
  $("dg-title").innerHTML = mh(S.forms && form === "reduced" ? S.title.replace("(architecture B)", "(architecture B, reduced)") : S.title);
  $("dg-sub").innerHTML = mh(S.forms && form === "reduced" ? S.subReduced : S.sub);
  $("dg-count").textContent = `${slide + 1} / ${SLIDES.length}`;
  const builder = { overview, mesh1, mesh2, arch_a: archA, switch: switching, sampled, points }[S.key];
  current = builder();
  $("dg-svg").innerHTML = current.svg;
  $("dg-info").innerHTML = current.info || "";
  current.after?.();
  lastLive = 0;
  tick(true);
}

// called by the app's render loop while the window is visible
export function tick(force = false) {
  if (!current || !$("view-diagrams").classList.contains("on")) return;
  const now = performance.now();
  if (!force && now - lastLive < 150) return;
  lastLive = now;
  const st = liveState();
  current.live?.(st);
  const pill = $("dg-live");
  if (st) {
    pill.className = "badge " + (st.collided ? "bad" : st.running ? "ok" : "");
    pill.textContent = `${car.toUpperCase()} · t = ${st.t.toFixed(1)} s · mesh ${st.mesh} · v = ${st.v.toFixed(1)} m/s · op. point v₀ = ${st.op.v0}`;
  } else {
    pill.className = "badge";
    pill.textContent = "no live data: start a run to animate the diagrams";
  }
}
export function redrawDiagrams() { if (timeline) { timeline.a.draw(); timeline.b.draw(); } for (const p of pts) p.draw(); }
