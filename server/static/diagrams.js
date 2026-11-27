// Diagrams window: presentation slides of the control design of the txt
// (§11 and the speed-PID / distance-controller syntheses), drawn as large SVG
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
// PID: the PI M1 gains of the txt are kept and a filtered derivative is added,
// C(s) = K_p + K_i/s + K_D s/(tau_f s + 1), T_D = K_D/K_p = T_i/8 = 0.5 s, tau_f = T_D/N
// (largest round T_D that keeps GM >= 12 dB at every linearization of both meshes).
const TD = 0.5, ND = 10, TF = TD / ND;
const PF = TF / (TF + TS);                                   // derivative-filter pole in z
const kf = (p) => p.KD / (TF + TS);                         // derivative gain in z
const CV_BODY = { num: "q_0 z − q_1", den: "z − 1", post: "+ D", after: "D = k_f (z − 1)/(z − p_f)" };

// ============================================================================ data of the txt
// EV: synthèse PI M1 DC (§4-6) + §11.2-11.6.  ICE: synthèse PI ICE (§6.3, §8) + §11.
const POINTS = {
  ev: [
    { v0: 0, Kp: 13.01405, Ki: 3.25351, q0: 13.07912, q1: 13.01405, N: 3.6614, D: 50, E: 30.51, u0: 1.8631,
      b1: 5.382726e-4, b2: 3.865800e-4, a1: -1.360173, a2: 0.367879,
      KD: 6.50702, s1: { PM: 130.7, GM: 25.0, D: 0.0, ts: 16.5, PMpi: 108.9 }, B: { PM: 105.7, GM: 24.9, D: 7.5, ts: 15.7, Kdmax: "> 40", PMpi: 78.9 }, A: { PM: 37.9, D: 41.0, ts: 18.3, Kdmax: "> 40", PMpi: 22.2 } },
    { v0: 10, Kp: 13.06841, Ki: 3.26710, q0: 13.13375, q1: 13.06841, N: 3.6614, D: 50.0068, E: 30.85, u0: 85.6603,
      b1: 5.382464e-4, b2: 3.865434e-4, a1: -1.360037, a2: 0.367829,
      KD: 6.53421, s1: { PM: 131.0, GM: 25.0, D: 0.0, ts: 16.6, PMpi: 109.2 }, B: { PM: 106.0, GM: 24.9, D: 7.5, ts: 15.7, Kdmax: "> 40", PMpi: 79.2 }, A: { PM: 38.2, D: 40.7, ts: 18.0, Kdmax: "> 40", PMpi: 22.5 } },
    { v0: 20, Kp: 13.12314, Ki: 3.28079, q0: 13.18876, q1: 13.12314, N: 3.6614, D: 50.0136, E: 31.19, u0: 170.3859,
      b1: 5.382201e-4, b2: 3.865068e-4, a1: -1.359902, a2: 0.367779,
      KD: 6.56157, s1: { PM: 131.3, GM: 24.9, D: 0.0, ts: 16.7, PMpi: 109.6 }, B: { PM: 106.4, GM: 24.9, D: 7.5, ts: 15.8, Kdmax: "> 40", PMpi: 79.5 }, A: { PM: 38.5, D: 40.4, ts: 14.6, Kdmax: "> 40", PMpi: 22.8 } },
    { v0: 30, Kp: 13.17824, Ki: 3.29456, q0: 13.24413, q1: 13.17824, N: 3.6614, D: 50.0204, E: 31.53, u0: 256.0400,
      b1: 5.381938e-4, b2: 3.864702e-4, a1: -1.359767, a2: 0.367729,
      KD: 6.58912, s1: { PM: 131.6, GM: 24.9, D: 0.0, ts: 16.8, PMpi: 109.9 }, B: { PM: 106.7, GM: 24.8, D: 7.5, ts: 15.9, Kdmax: "> 40", PMpi: 79.8 }, A: { PM: 38.8, D: 40.1, ts: 14.6, Kdmax: "> 40", PMpi: 23.1 } },
    { v0: 40, Kp: 13.23370, Ki: 3.30843, q0: 13.29987, q1: 13.23370, N: 3.6614, D: 50.0272, E: 31.87, u0: 342.6224,
      b1: 5.381675e-4, b2: 3.864337e-4, a1: -1.359631, a2: 0.367679,
      KD: 6.61685, s1: { PM: 131.9, GM: 24.9, D: 0.0, ts: 16.9, PMpi: 110.2 }, B: { PM: 107.0, GM: 24.8, D: 7.6, ts: 15.9, Kdmax: "> 40", PMpi: 80.1 }, A: { PM: 39.1, D: 39.8, ts: 14.7, Kdmax: "> 40", PMpi: 23.4 } },
  ],
  ice: [
    { v0: 10, Kp: 0.22184, Ki: 0.05546, q0: 0.22295, q1: 0.22184, N: 21.3133, D: 6.17428, E: 0.264908, u0: 0.18244,
      b1: 4.092451e-3, b2: 3.927435e-3, a1: -1.883735, a2: 0.883834,
      KD: 0.11092, s1: { PM: 86.7, GM: 18.6, D: 11.9, ts: 12.4, PMpi: 65.1 }, B: { PM: 61.5, GM: 18.4, D: 11.1, ts: 14.4, Kdmax: "20.4", PMpi: 36.4 }, A: null },
    { v0: 20, Kp: 0.25975, Ki: 0.06494, q0: 0.26105, q1: 0.25975, N: 36.2916, D: 12.34448, E: 0.516833, u0: 0.31406,
      b1: 6.695993e-3, b2: 6.167227e-3, a1: -1.781044, a2: 0.781227,
      KD: 0.12987, s1: { PM: 90.2, GM: 15.6, D: 11.6, ts: 12.6, PMpi: 68.8 }, B: { PM: 65.7, GM: 15.4, D: 10.8, ts: 14.7, Kdmax: "25.7", PMpi: 40.5 }, A: null },
    { v0: 30, Kp: 0.26580, Ki: 0.06645, q0: 0.26713, q1: 0.26580, N: 53.1960, D: 18.51469, E: 0.903186, u0: 0.46993,
      b1: 9.438806e-3, b2: 8.343826e-3, a1: -1.690230, a2: 0.690531,
      KD: 0.13290, s1: { PM: 91.9, GM: 14.4, D: 11.0, ts: 12.6, PMpi: 70.5 }, B: { PM: 67.6, GM: 14.2, D: 10.5, ts: 14.8, Kdmax: "28.6", PMpi: 42.4 }, A: null },
    { v0: 40, Kp: 0.42819, Ki: 0.10705, q0: 0.43033, q1: 0.42819, N: 69.0357, D: 38.68089, E: 1.888110, u0: 0.67582,
      b1: 1.084043e-2, b2: 8.385795e-3, a1: -1.460815, a2: 0.461341,
      KD: 0.21410, s1: { PM: 93.2, GM: 13.2, D: 10.8, ts: 12.7, PMpi: 71.8 }, B: { PM: 69.1, GM: 13.1, D: 10.4, ts: 14.8, Kdmax: "33.7", PMpi: 43.9 }, A: null },
    { v0: 45, Kp: 0.79277, Ki: 0.19819, q0: 0.79673, q1: 0.79277, N: 70.6397, D: 73.25813, E: 3.408637, u0: 0.85400,
      b1: 9.162816e-3, b2: 5.665057e-3, a1: -1.230325, a2: 0.231040,
      KD: 0.39638, s1: { PM: 93.6, GM: 13.0, D: 10.9, ts: 12.7, PMpi: 72.2 }, B: { PM: 69.6, GM: 12.9, D: 10.4, ts: 14.9, Kdmax: "37.5", PMpi: 44.3 }, A: null },
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
  constructor(w, h) { this.w = w; this.h = h; this.p = []; this.tall = false; }
  add(s) { this.p.push(s); return this; }
  html() {
    return `<svg class="dg-svg${this.tall ? " tall" : ""}" viewBox="0 0 ${this.w} ${this.h}" xmlns="http://www.w3.org/2000/svg">
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
      const x0 = body.pre || body.post
        ? cx - ((body.pre ? textW(body.pre, 24) + 4 : 0) + fw + (body.post ? textW(body.post, 24) + 4 : 0)) / 2 : cx - fw / 2;
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
    this.add(`<g class="dg-block ${opt.cls || ""}" id="${id}" ${opt.data || ""}>${opt.tip ? `<title>${esc(opt.tip)}</title>` : ""}
      <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="14"/>
      ${title ? `<text class="dg-title" x="${cx}" y="${cy - h / 2 + 22}" text-anchor="middle">${m(title)}</text>` : ""}
      ${inner}</g>`);
  }
  // physical sub-block (opened plant): small title and equation lines
  sblock(id, cx, cy, w, h, title, lines) {
    const L = [].concat(lines || []);
    const y0 = cy + (title ? 10 : 6) - (L.length - 1) * 11;
    this.add(`<g class="dg-block sub" id="${id}">
      <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="12"/>
      ${title ? `<text class="dg-subtitle" x="${cx}" y="${cy - h / 2 + 19}" text-anchor="middle">${m(title)}</text>` : ""}
      ${L.map((ln, k) => `<text class="dg-eqs" x="${cx}" y="${y0 + k * 23}" text-anchor="middle">${m(ln)}</text>`).join("")}</g>`);
  }
  // unit of a signal under its wire; with an id it is replaced by the live value
  unit(id, x, y, unit, anchor = "middle", def) {
    const d = def ?? `[${unit}]`;
    this.add(`<text class="dg-unit" ${id ? `id="${id}"` : ""} data-def="${esc(d)}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(d)}</text>`);
  }
  // role of a signal: controlled / manipulated / reference / disturbance
  role(x, y, txt, kind = "") {
    const w = String(txt).replace(/_\{([^}]*)\}/g, "$1").replace(/[_^{}]/g, "").length * 7.4 + 22;
    this.add(`<g class="dg-role ${kind}"><rect x="${x - w / 2}" y="${y - 12}" width="${w}" height="23" rx="11.5"/>
      <text x="${x}" y="${y + 4.5}" text-anchor="middle">${m(txt)}</text></g>`);
  }
  // "click to open the plant" pill under the plant block
  plantHint(cx, y) {
    const t = plantOpen ? "▾ plant opened below · click to close" : "▸ click to open the plant";
    const w = t.length * 7.3 + 26;
    this.add(`<g class="dg-hint" data-plant="1"><rect x="${cx - w / 2}" y="${y - 14}" width="${w}" height="28" rx="14"/>
      <text x="${cx}" y="${y + 5}" text-anchor="middle">${t}</text></g>`);
  }
  under(s) { this.p.unshift(s); return this; }
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
let plantOpen = false;        // mesh tabs: the plant block opened into its physical sub-blocks
let plantScroll = false;
let tfShown = "";             // transfer-function slide: "car:v0" currently drawn

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
  // signals inside the plant (opened plant view)
  const sig = car === "ice"
    ? { th: g("theta_th"), pm: g("p_m"), Te: g("T_e"), rpm: g("rpm"), Ft: g("F_t"), Fb: g("F_b") }
    : { Vc: g("V_c"), D: g("D"), ia: g("i_a"), rpm: g("rpm"), Ft: g("F_t"), Fb: g("F_b") };
  return { t: r[0], v, vset, d, dref, vl, target, leadOn, mesh, ed, vcorr, dv, vref, eps, u, du: u - op.u0, op, sig,
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
  { key: "mesh1", tab: "Mesh 1 · speed", title: "Mesh 1 · speed control", sub: "Système 1 (§11.4): the speed PID (PI M1 + filtered D) alone, unit feedback on v_ego." },
  { key: "mesh2", tab: "Mesh 2 · distance", forms: true, title: "Mesh 2 · distance control in cascade (architecture B)", sub: "§11.6: the distance controller C_d is piped into the speed controller; the speed set-point is built from v_lead.",
    subReduced: "§11.6 reduced: v_ref and v_ego merge into the radar's relative speed Δv, so one junction builds the composite error ε for a single PID." },
  { key: "tf", tab: "Transfer functions", title: "Transfer functions, poles and zeros", sub: "Every transfer function of the loop with the numbers of the chosen linearization substituted, and its z-plane (T_s = 20 ms)." },
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
  s.wire("w-cin", [[812, 260], [856, 260]]);
  // shared path
  s.block("b-cv", 960, 260, 206, 120, "C_v(z) · PID", CV_BODY);
  s.wire("w-u", [[1063, 260], [1095, 260]], { label: [1079, 242, "Δu"] });
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
      <div><b>Both (PID)</b> Δu[k] = Δu<sub>PI</sub>[k] + D[k]: &nbsp;Δu<sub>PI</sub>[k] = Δu<sub>PI</sub>[k−1] + q₀·ε[k] − q₁·ε[k−1], &nbsp;D[k] = p<sub>f</sub>·D[k−1] + k<sub>f</sub>·(ε[k] − ε[k−1]),&nbsp; u = u₀ + Δu, saturated</div></div>`,
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
  s.block("m1-cv", 530, 200, 200, 130, "C_v(z) · PID", CV_BODY);
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
    { num: "N", den: "s^2 + D s + E", after: P.delay ? "× e^{−0.06 s}  (torque delay 60 ms)" : "DC motor + vehicle (M1)" }, plantOpt());
  s.plantHint(1305, 300);
  s.wire("m1-v", [[1438, 200], [1570, 200]], { label: [1520, 182, "v_{ego}"] });
  s.dot(1490, 200);
  s.wire("m1-fb", [[1490, 200], [1490, 360], [200, 360], [200, 222]], { cls: "fb" });
  s.badge("m1-b-ref", 120, 240); s.badge("m1-b-e", 256, 240); s.badge("m1-b-u", 954, 240); s.badge("m1-b-v", 1520, 240);
  // units and roles of the signals
  [[256, "m/s"], [395, "m/s"], [665, P.unit], [836, P.unit], [954, P.unit], [1132, P.unit], [1520, "m/s"]]
    .forEach(([x, u]) => s.unit(null, x, 221, u));
  s.label(900, 70, `[${P.unit}]`, "middle", "dg-unit");
  s.label(600, 383, "v_{ego} [m/s] measured (unit feedback)", "middle", "dg-small");
  s.role(44, 152, "REFERENCE", "ref");
  s.role(256, 150, "ERROR", "err");
  s.role(1132, 100, "MANIPULATED · u", "mv");
  s.role(1520, 140, "CONTROLLED · v_{ego}", "cv");
  const det = plantDetailIn(s, 430, "m1d", { x1: 1172, x2: 1438, y2: 275 });
  const p = opPoint(null);
  return {
    svg: s.html(),
    info: varsStrip(1) + ioTable(1) + eqGrid([
      ["Controller (continuous)", `C(s) = K_p + K_i/s + ${frac("K_D s", "τ_f s + 1")} = K_p ${frac("s + 0.25", "s")} + ${frac("K_D s", "τ_f s + 1")}, &nbsp; T_i = 4 s, &nbsp; T_D = K_D/K_p = T_i/8 = ${TD} s, &nbsp; τ_f = T_D/N = ${TF} s (N = ${ND})`],
      ["Gains", `K_p = ${frac("√[(E − ω_c²)² + (D ω_c)²]", "N √(1 + (0.25/ω_c)²)")} (PI M1, ω_c = 0.8 rad/s, kept), &nbsp; K_i = 0.25 K_p, &nbsp; K_D = ${TD} K_p`],
      ["Discrete (backward Euler)", `C_v(z) = ${frac("q₀ z − q₁", "z − 1")} + k_f ${frac("z − 1", "z − p_f")}, &nbsp; q₀ = K_p + K_i T_s, q₁ = K_p, &nbsp; k_f = K_D/(τ_f + T_s), &nbsp; p_f = τ_f/(τ_f + T_s) = ${PF.toFixed(4)}`],
      ["Plant M1", `G_v(s) = ${frac("Δv(s)", `${P.du}(s)`)} = ${frac("N", "s² + D s + E")}${P.delay ? " · e<sup>−0.06 s</sup> &nbsp;(60 ms = z<sup>−3</sup>)" : ""}`],
      ["Closed loop", `L_V(z) = C_v(z) G_v(z)${P.nd ? " z<sup>−3</sup>" : ""}, &nbsp; T_V(z) = ${frac("L_V(z)", "1 + L_V(z)")}, &nbsp; T_V(1) = 1 (zero static error)`],
    ]) + pointTable(p, "s1"),
    live(st) {
      cls(["m1-in", "m1-e", "m1-ek", "m1-cv", "m1-uk", "m1-zoh", "m1-ut", "m1-u0", "m1-u", "m1-sat", "m1-us", "m1-g", "m1-v", "m1-fb", "m1-s"], "on", !!st && st.mesh === 1);
      det?.live(st, !!st && st.mesh === 1);
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
  s.wire("m2-ev", [[642, 200], [706, 200]], { label: [674, 182, "e_v"] });
  s.block("m2-cv", 810, 200, 206, 130, "C_v(z) · PID", CV_BODY);
  s.wire("m2-u", [[913, 200], [955, 200]], { label: [934, 182, "Δu"] });
  s.block("m2-zoh", 1000, 200, 86, 80, "", ["ZOH"]);
  s.wire("m2-uz", [[1043, 200], [1068, 200]]);
  s.block("m2-g", 1185, 200, 230, 150, `G_v(s) · ${P.name.split(" · ")[0]}`,
    { num: "N", den: "s^2 + D s + E", after: P.delay ? "× e^{−0.06 s}" : "M1" }, plantOpt());
  s.plantHint(1185, 300);
  [[227, "m"], [431, "m/s"], [560, "m/s"], [677, "m/s"], [930, P.unit], [1400, "m/s"]].forEach(([x, u]) => s.unit(null, x, 221, u));
  s.unit(null, 1000, 425, "m/s");
  s.role(40, 152, "REFERENCE", "ref");
  s.role(500, 50, "DISTURBANCE · radar", "dist");
  s.role(1040, 100, "MANIPULATED · u", "mv");
  s.role(1400, 110, "INNER · v_{ego}", "err");
  s.role(820, 440, "CONTROLLED · d", "cv");
  const det = plantDetailIn(s, 545, "m2d", { x1: 1070, x2: 1300, y2: 275 });
  s.wire("m2-v", [[1300, 200], [1462, 200], [1462, 268]], { label: [1400, 182, "v_{ego}"] });
  s.dot(1330, 200);
  s.block("m2-dyn", 1462, 325, 236, 110, "distance dynamics", ["ḋ = v_{lead} − v_{ego}", "d = ∫ ḋ dt"]);
  s.io(1540, 448, "v_{lead}", "middle");
  s.wire("m2-vl2", [[1540, 430], [1540, 382]]);
  s.wire("m2-d", [[1462, 380], [1462, 480], [170, 480], [170, 222]], { cls: "fb" });
  s.label(820, 468, "d [m]  (measured by the radar)");
  s.wire("m2-fbv", [[1330, 200], [1330, 410], [620, 410], [620, 222]], { cls: "fb" });
  s.label(1000, 398, "v_{ego}");
  s.badge("m2-b-ed", 227, 240); s.badge("m2-b-vc", 431, 240); s.badge("m2-b-vl", 560, 84, "start");
  s.badge("m2-b-vr", 560, 240); s.badge("m2-b-ev", 677, 240); s.badge("m2-b-v", 1400, 150); s.badge("m2-b-d", 820, 510);
  const p = opPoint(null);
  return {
    svg: s.html(),
    info: varsStrip(2) + ioTable(2) + eqGrid([
      ["Distance controller", `e_d = d_ref − d, &nbsp; C_d(s) = −K_d, &nbsp; v_corr = −K_d·e_d, &nbsp; K_d = ${KD} s⁻¹ (τ = 1/K_d = 2 s)`],
      ["Speed set-point (B)", `v_ref = v_lead + v_corr, &nbsp; e_v = v_ref − v_ego = (v_lead − v_ego) − K_d (d_ref − d)`],
      ["Combined controller", `C_B(z) = C_v(z) = ${frac("q₀ z − q₁", "z − 1")} + k_f ${frac("z − 1", "z − p_f")} (PID), &nbsp; Δu[k] = Δu_PI[k] + D[k]`],
      ["Loop (v_lead constant)", `L_B(z) = C_v(z) [ G_v(z) + K_d G_x(z) ]${P.nd ? " z<sup>−3</sup>" : ""}, &nbsp; G_x = position (ZOH of G_v(s)/s)`],
      ["Distance response", `T_d(z) = ${frac("K_d C_v(z) G_x(z) z^{−n_d}", "1 + L_B(z)")}, &nbsp; T_d(1) = 1 (zero static error)`],
      ["Ideal model (§7)", `v_ego = v_lead + v_corr ⇒ ė_d = −K_d e_d ⇒ e_d(t) = e_d(0) e<sup>−K_d t</sup>`],
    ]) + pointTable(p, "B"),
    live(st) {
      const on = !!st && st.mesh === 2;
      cls(["m2-in", "m2-ed", "m2-cd", "m2-vc", "m2-vl", "m2-vr", "m2-ev", "m2-cv", "m2-u", "m2-zoh", "m2-uz", "m2-g", "m2-v", "m2-v2", "m2-dyn", "m2-d", "m2-fbv", "m2-s1", "m2-s2", "m2-s3"], "on", on);
      det?.live(st, on);
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
// one junction fed by the radar's relative speed, one PID on the composite error.
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
  s.wire("r-eps", [[522, 200], [597, 200]], { label: [560, 182, "ε"] });
  s.block("r-cv", 700, 200, 206, 130, "C_B(z) = C_v(z)", CV_BODY);
  s.wire("r-u", [[803, 200], [845, 200]], { label: [824, 182, "Δu"] });
  s.block("r-zoh", 890, 200, 86, 80, "", ["ZOH"]);
  s.wire("r-uz", [[933, 200], [983, 200]]);
  s.block("r-g", 1100, 200, 230, 150, `G_v(s) · ${P.name.split(" · ")[0]}`,
    { num: "N", den: "s^2 + D s + E", after: P.delay ? "× e^{−0.06 s}" : "M1" }, plantOpt());
  s.plantHint(1132, 300);
  [[227, "m"], [431, "m/s"], [562, "m/s"], [820, P.unit], [1259, "m/s"]].forEach(([x, u]) => s.unit(null, x, 221, u));
  s.role(40, 152, "REFERENCE", "ref");
  s.role(562, 110, "COMPOSITE ERROR · ε", "err");
  s.role(958, 100, "MANIPULATED · u", "mv");
  s.role(1259, 100, "PLANT OUTPUT · v_{ego}", "err");
  s.role(760, 440, "CONTROLLED · d", "cv");
  s.role(1480, 352, "DISTURBANCE", "dist");
  const det = plantDetailIn(s, 530, "r2d", { x1: 985, x2: 1215, y2: 275 });
  s.wire("r-v", [[1215, 200], [1303, 200]], { label: [1259, 182, "v_{ego}"] });
  s.block("r-dyn", 1420, 200, 230, 120, "radar · distance dynamics", ["Δv = v_{lead} − v_{ego}", "d = ∫ Δv dt"]);
  s.io(1480, 322, "v_{lead}", "middle");
  s.wire("r-vl", [[1480, 306], [1480, 262]]);
  s.wire("r-d", [[1535, 175], [1585, 175], [1585, 480], [170, 480], [170, 222]], { cls: "fb" });
  s.label(870, 468, "d [m]");
  s.wire("r-dv", [[1535, 228], [1560, 228], [1560, 410], [500, 410], [500, 222]], { cls: "fb" });
  s.label(1000, 398, "Δv = v_{lead} − v_{ego} [m/s]  (radar relative speed)");
  s.add(`<g class="dg-switchnote"><rect x="560" y="288" width="420" height="62" rx="10"/>
    <text x="770" y="314" text-anchor="middle">${m("ε = (v_{lead} − v_{ego}) − K_d (d_{ref} − d)")}</text>
    <text x="770" y="338" text-anchor="middle">${m("= e_v of the full form, at every sample")}</text></g>`);
  s.badge("r-b-ed", 227, 240); s.badge("r-b-vc", 431, 240); s.badge("r-b-eps", 562, 240);
  s.badge("r-b-v", 1259, 240); s.badge("r-b-dv", 1000, 440); s.badge("r-b-d", 870, 510);
  const p = opPoint(null);
  return {
    svg: s.html(),
    info: varsStrip(3) + ioTable(3) + eqGrid([
      ["Reduction", `e_v = v_ref − v_ego = (v_lead + v_corr) − v_ego = (v_lead − v_ego) + v_corr = Δv − K_d e_d ≡ ε`],
      ["Composite error", `ε[k] = (v_lead[k] − v_ego[k]) − K_d (d_ref − d[k]), &nbsp; Δv = v_lead − v_ego = dd/dt, measured by the radar`],
      ["Single PID", `C_B(z) = C_v(z) = ${frac("q₀ z − q₁", "z − 1")} + k_f ${frac("z − 1", "z − p_f")}, &nbsp; Δu[k] = Δu_PI[k] + D[k] on ε`],
      ["Loop (v_lead constant)", `L_B(z) = C_v(z) [ G_v(z) + K_d G_x(z) ]${P.nd ? " z<sup>−3</sup>" : ""}: one PID acting on speed and position of the same plant`],
      ["Distance response", `T_d(z) = ${frac("K_d C_v(z) G_x(z) z^{−n_d}", "1 + L_B(z)")}, &nbsp; T_d(1) = 1 (zero static error)`],
      ["Why it works (vs A)", `the Δv path measures the speed again (A had e_v = v_corr only): it adds the damping that makes the ICE loop stable`],
    ]) + pointTable(p, "B"),
    live(st) {
      const on = !!st && st.mesh === 2;
      cls(["r-in", "r-ed", "r-cd", "r-vc", "r-eps", "r-cv", "r-u", "r-zoh", "r-uz", "r-g", "r-v", "r-dyn", "r-vl", "r-d", "r-dv", "r-s1", "r-s2"], "on", on);
      det?.live(st, on);
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
  s.block("a-cv", 750, 150, 130, 92, "C_v(s)", ["PID"]);
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
  s.wire("b-vc", [[395, 470], [462, 470]], { label: [428, 452, "v_{corr} = e_v"] });
  s.block("b-cv2", 584, 470, 244, 96, "C_v(s) · PID", { num: "K_p (s + 0.25)", den: "s", post: "+ D" });
  s.wire("b-u", [[706, 470], [760, 470]]);
  s.block("b-g2", 850, 470, 176, 96, "plant ICE / EV", { num: "N", den: "s^2 + D s + E" });
  s.wire("b-v", [[938, 470], [1050, 470]], { label: [994, 452, "v_{ego}"] });
  s.block("b-dyn2", 1140, 470, 176, 96, "distance dynamics", ["ḋ = v_{lead} − v_{ego}"]);
  s.io(1140, 562, "v_{lead}", "middle");
  s.wire("b-vl", [[1140, 548], [1140, 518]]);
  s.wire("b-d", [[1228, 470], [1290, 470], [1290, 600], [160, 600], [160, 492]], { cls: "fb" });
  s.label(720, 590, "d");
  s.add(`<g class="dg-verdict"><rect x="1330" y="400" width="250" height="210" rx="14"/>
    <text x="1455" y="432" text-anchor="middle" class="h">§11.5 verdict</text>
    <text x="1350" y="466">EV: stable, PM ≈ ${POINTS.ev[3].A.PM}°</text>
    <text x="1350" y="492">(PI: ${POINTS.ev[3].A.PMpi}°), D ≈ ${Math.round(POINTS.ev[3].A.D)} %</text>
    <text x="1350" y="530" class="bad">ICE: UNSTABLE</text>
    <text x="1350" y="556" class="bad">for every K_d &gt; 0 (PI, PID)</text>
    <text x="1350" y="590">→ corrected to B</text></g>`);
  return {
    svg: s.html(),
    info: eqGrid([
      ["Why A fails", `L_A(s) = ${frac("K (s + 0.25)", "s² (s² + D s + E)")}, K = K_d K_p N — a <b>double integrator</b> (PI + d → v), so −180°; the only phase lead is the PI zero at 0.25 rad/s`],
      ["Routh (PI part)", `s⁴ + D s³ + E s² + K s + 0.25 K: stable ⇔ 0 &lt; K &lt; D (E − 0.25 D) — needs E &gt; 0.25 D`],
      ["EV (v₀ = 30)", `E − 0.25 D = 31.53 − 12.51 = 19.03 &gt; 0 → K_d &lt; 19.7 (13.1 discrete), but only ≈ 23° of margin`],
      ["ICE (v₀ = 30)", `E − 0.25 D = 0.903 − 4.629 = −3.73 &lt; 0 → <b>no K_d</b> stabilises A (negative at all 5 points)`],
      ["Correction (§11.6)", `v_ref = v_lead + v_corr instead of v_ego + v_corr: the relative speed v_lead − v_ego (radar) gives the damping that A lacks`],
      ["With the PID", `the Routh analysis above is the PI part (txt). With the filtered D (T_D = ${TD} s), computed at every linearization: EV A stable up to K_d &gt; 40 (PM ≈ ${POINTS.ev[3].A.PM}°); ICE A still unstable for every K_d &gt; 0 → B is kept`],
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
         <text class="dg-small" x="800" y="370" text-anchor="middle">${m("Evaluated every T_s = 20 ms on the radar measurements (d, v_{lead}) · the speed PID C_v is shared, so only its input changes")}</text>`);
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
  s.wire("eq-m", [[285, 470], [336, 470]]);
  s.block("eq-cv", 460, 470, 248, 92, "C_v(s) · PID", { num: "K_p (s + 0.25)", den: "s", post: "+ D" });
  s.wire("eq-out", [[584, 470], [632, 470]]);
  s.add(`<text class="dg-equiv" x="680" y="482" text-anchor="middle">≡</text>`);
  s.wire("eq-in2", [[730, 470], [800, 470]]);
  s.block("eq-ceq", 980, 470, 360, 100, "C_{eq}(s) = C_d C_v(s)", { num: "−K_d K_p (s + 0.25)", den: "s", post: "− K_d D" });
  s.wire("eq-out2", [[1160, 470], [1186, 470]]);
  s.add(`<g class="dg-verdict info"><rect x="1195" y="400" width="395" height="150" rx="14"/>
    <text x="1213" y="436">s → (z − 1)/(z T_s) is a substitution,</text>
    <text x="1213" y="468">so discrete(C_d·C_v) = C_d·discrete(C_v)</text>
    <text x="1213" y="500">exactly. Not true for a ZOH or a</text>
    <text x="1213" y="530">pole–zero matching discretisation.</text></g>`);
  return {
    svg: s.html(),
    info: eqGrid([
      ["Backward Euler", `s → ${frac("z − 1", "z T_s")}, &nbsp; C_v(z) = ${frac("q₀ z − q₁", "z − 1")} + k_f ${frac("z − 1", "z − p_f")}, &nbsp; D(s) = ${frac("K_D s", "τ_f s + 1")} → k_f = K_D/(τ_f + T_s), p_f = τ_f/(τ_f + T_s)`],
      ["Zeros and poles", `PI part: zero q₁/q₀ = 0.99502 (= e<sup>−0.25 T_s</sup>), pole z = 1 (integrator); &nbsp; D part: pole p_f = ${PF.toFixed(4)} (filter τ_f = ${TF} s); the sum has two zeros (see Transfer functions)`],
      ["Every 20 ms", `Δu_PI[k] = Δu_PI[k−1] + q₀ e[k] − q₁ e[k−1], &nbsp; D[k] = p_f D[k−1] + k_f (e[k] − e[k−1]), &nbsp; u[k] = u₀ + Δu_PI[k] + D[k], saturated to ${PLANT[car].sat}`],
      ["Anti-windup", `if u[k] saturates: Δu_PI[k] ← u_sat − u₀ − D[k] before it is stored`],
      ["Derivative filter", `N = ${ND}: τ_f = T_D/N = ${TF} s = 2.5 T_s, so the D term is smooth at 20 ms; its high-frequency gain is bounded by K_D/τ_f = N K_p`],
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
      `<p class="dg-caption">PID: K_p, K_i of the PI M1 synthesis kept, K_D = ${TD}·K_p (T_D = T_i/8), filter N = ${ND}; margins, overshoot and t_s
       are those of the PID (PI phase margin in brackets on the mesh tabs). Gain scheduling: q₀, q₁, k_f and the trim u₀ are interpolated in v[k] between these points (§11.7).
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
    <div class="dg-num"><span>PID gains</span><b>K_p = ${p.Kp}, K_i = ${p.Ki}, K_D = ${p.KD}</b></div>
    <div class="dg-num"><span>discrete</span><b>q₀ = ${p.q0}, q₁ = ${p.q1}, k_f = ${n4(kf(p))}, p_f = ${PF.toFixed(4)}</b></div>
    <div class="dg-num"><span>plant</span><b>N = ${p.N}, D = ${p.D}, E = ${p.E}</b></div>
    <div class="dg-num"><span>trim</span><b>${mh(P.u)}₀ = ${p.u0} ${P.unit}</b></div>
    <div class="dg-num hl"><span>${sysName} · PID</span><b>PM ${r.PM}° (PI ${r.PMpi}°) · GM ${r.GM} dB · overshoot ${r.D} % · t_s ${r.ts} s${r.Kdmax ? ` · K_d,max ${r.Kdmax}` : ""}</b></div>
  </div>`;
}
function zTable(p) {
  return `<div class="dg-numbers">
    <div class="dg-num"><span>v₀</span><b>${p.v0} m/s</b></div>
    <div class="dg-num"><span>G_v(z) numerator</span><b>b₁ = ${n4(p.b1)}, b₂ = ${n4(p.b2)}</b></div>
    <div class="dg-num"><span>G_v(z) denominator</span><b>a₁ = ${p.a1}, a₂ = ${p.a2}</b></div>
    <div class="dg-num"><span>C_v(z) · PID</span><b>q₀ = ${p.q0}, q₁ = ${p.q1}, k_f = ${n4(kf(p))}, p_f = ${PF.toFixed(4)}</b></div></div>`;
}
function bigTable(c) {
  const P = PLANT[c];
  return `<div class="dg-tablewrap"><table class="dg-table"><thead><tr>
    <th>v₀ [m/s]</th><th>K_p</th><th>K_i</th><th>K_D</th><th>q₀</th><th>q₁</th><th>${mh(P.u)}₀ [${P.unit}]</th><th>G_v(s)</th>
    <th>mesh 1 (PID): PM · D% · t_s</th><th>mesh 2 (B, PID): PM · D% · t_s · K_d,max</th><th>A (initial, PID)</th></tr></thead><tbody>
    ${POINTS[c].map((p) => `<tr><td>${p.v0}</td><td>${p.Kp}</td><td>${p.Ki}</td><td>${p.KD}</td><td>${p.q0}</td><td>${p.q1}</td><td>${p.u0}</td>
      <td>${p.N} / (s² + ${p.D} s + ${p.E})${P.delay ? " · e<sup>−0.06s</sup>" : ""}</td>
      <td>${p.s1.PM}° · ${p.s1.D} % · ${p.s1.ts} s</td>
      <td>${p.B.PM}° · ${p.B.D} % · ${p.B.ts} s · ${p.B.Kdmax}</td>
      <td class="${p.A ? "" : "bad"}">${p.A ? `${p.A.PM}° · ${p.A.D} %` : "unstable"}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// ============================================================================ the plant, opened
// G_v(s) of the meshes is the linearisation (M1) of the physical chain that the
// simulator integrates (§3.5 ICE, §4.5 EV). Clicking the plant block opens that
// chain under the mesh: every sub-block with its input and output signal, the
// unit and the live value of each signal.
function cfgNum(sec, key, d) {
  const v = parseFloat(api?.cfgVal?.(sec, key, d));
  return Number.isFinite(v) ? v : d;
}
function physK() {
  const g = cfgNum("environment", "g", 9.81), rho = cfgNum("environment", "rho", 1.225), beta = cfgNum("environment", "beta", 0);
  const m = cfgNum("body", "m", 1940), rw = cfgNum("body", "r_w", 0.3);
  const ca = 0.5 * rho * cfgNum("body", "Cx", 0.5) * cfgNum("body", "A_d", 2.4), Rx = cfgNum("body", "Cr", 0.0155) * m * g;
  const pa = cfgNum("ice", "p_atm", 101325), ga = cfgNum("ice", "gamma", 1.4), Dth = cfgNum("ice", "D_th", 0.05);
  const K2 = cfgNum("ice", "Cd_th", 0.8) * Math.PI * Dth * Dth / 4 * pa / Math.sqrt(cfgNum("ice", "R_air", 287) * cfgNum("ice", "T_atm", 288.15));
  const rc = Math.pow(2 / (ga + 1), ga / (ga - 1));
  const PhiMax = Math.sqrt(ga) * Math.pow(2 / (ga + 1), (ga + 1) / (2 * (ga - 1)));
  const Phi = (r) => {                                     // choked / unchoked flow function (§3.2)
    r = Math.min(Math.max(r, 0), 1);
    return r <= rc ? PhiMax : Math.sqrt(Math.max(0, 2 * ga / (ga - 1) * (Math.pow(r, 2 / ga) - Math.pow(r, (ga + 1) / ga))));
  };
  return {
    Fres: (v) => ca * v * Math.abs(v) + Rx * Math.cos(beta) * Math.sign(v) + m * g * Math.sin(beta),
    mth: (th, pm) => K2 * (1 - Math.cos(th)) * Phi(pm / pa),
    Gice: cfgNum("ice", "i_gear", 4.1) / rw, etaI: cfgNum("ice", "eta_t", 0.92),
    Gev: cfgNum("ev", "i_gear", 10) / rw, ke: cfgNum("ev", "k_e", 0.25), kt: cfgNum("ev", "k_t", 0.25),
  };
}
const plantOpt = () => ({
  cls: `dg-click${plantOpen ? " open" : ""}`, data: 'data-plant="1"',
  tip: plantOpen ? "Click to close the plant" : "Click to open the plant into its physical sub-blocks",
});
// draws the opened plant at y0 when it is open; returns its live updater (or null)
function plantDetailIn(s, y0, pf, box) {
  if (!plantOpen) return null;
  s.h = y0 + 366;
  s.tall = true;
  return plantDetail(s, y0, pf, box);
}
function plantDetail(s, y0, pf, box) {
  const ice = car === "ice", yc = y0 + 140, xs = 1250, ids = [];
  const W = (id, pts, opt) => { s.wire(id, pts, opt); ids.push(id); };
  const B = (id, ...a) => { s.sblock(id, ...a); ids.push(id); };
  const sig = (id, x1, x2, name, unit) => {
    W(id, [[x1, yc], [x2, yc]]);
    s.label((x1 + x2) / 2, yc - 13, name, "middle", "dg-sig");
    s.unit(`${id}-u`, (x1 + x2) / 2, yc + 25, unit);
  };
  s.under(`<path class="dg-callout" d="M${box.x1},${box.y2} L${box.x2},${box.y2} L1588,${y0} L12,${y0} Z"/>`);
  s.region(`${pf}-rg`, 12, y0, 1576, 350,
    ice ? "PLANT G_v(s), OPENED · ICE:  θ_{th} → ṁ_{th} → p_m → T_e → F_t → v"
        : "PLANT G_v(s), OPENED · EV:  V_c → i_a → T_m → F_t → v", { cls: "dg-detail" });
  s.add(`<g class="dg-close" data-plant="1"><rect x="1474" y="${y0 + 13}" width="100" height="28" rx="14"/>
    <text x="1524" y="${y0 + 32}" text-anchor="middle">✕ close</text></g>`);
  s.role(68, yc - 72, "INPUT · u", "mv");
  if (ice) {
    sig(`${pf}-th`, 24, 96, "θ_{th}", "rad");
    B(`${pf}-thr`, 186, yc, 180, 104, "THROTTLE BODY", ["ṁ_{th} = K_2 (1 − cos θ_{th})", "· Φ(p_m / p_{atm})"]);
    sig(`${pf}-mth`, 276, 352, "ṁ_{th}", "g/s");
    B(`${pf}-man`, 442, yc, 180, 104, "INTAKE MANIFOLD", ["ṗ_m = K_1 (ṁ_{th} − ṁ_{cyl})", "ṁ_{cyl} = K_3 p_m v"]);
    sig(`${pf}-pm`, 532, 604, "p_m", "kPa");
    B(`${pf}-eng`, 689, yc, 170, 104, "ENGINE TORQUE", ["T_e = k_T p_m − T_{loss}", "T_{loss} = T_0 + c_w ω_e"]);
    sig(`${pf}-te`, 774, 846, "T_e", "N·m");
    B(`${pf}-del`, 893, yc, 94, 104, "DELAY", ["e^{−0.06 s}", "60 ms = 3 T_s"]);
    sig(`${pf}-tef`, 940, 1018, "T_{e,eff}", "N·m");
    B(`${pf}-trn`, 1094, yc, 152, 104, "TRANSMISSION", ["F_t = η_t G T_{e,eff}", "G = i_{gear} / r_w"]);
    sig(`${pf}-ft`, 1170, 1228, "F_t", "N");
  } else {
    sig(`${pf}-vci`, 24, 96, "V_c", "V");
    B(`${pf}-cnv`, 181, yc, 170, 104, "DC/DC CONVERTER", ["V_c = D · V_{bat}"]);
    s.unit(`${pf}-dd`, 181, yc + 36, "", "middle", "D ∈ [0, 1] (PWM)");
    sig(`${pf}-vc`, 266, 336, "V_c", "V");
    s.sum(`${pf}-se`, 358, yc, { left: "+", bottom: "−" }); ids.push(`${pf}-se`);
    sig(`${pf}-ul`, 380, 450, "u_L", "V");
    B(`${pf}-arm`, 550, yc, 200, 104, "ARMATURE (R–L)", ["L_a di_a/dt = u_L − R_a i_a", "i_a / u_L = 1 / (L_a s + R_a)"]);
    sig(`${pf}-ia`, 650, 730, "i_a", "A");
    B(`${pf}-mot`, 805, yc, 150, 104, "DC MOTOR", ["T_m = k_t i_a", "ω_m = G v"]);
    sig(`${pf}-tm`, 880, 958, "T_m", "N·m");
    B(`${pf}-red`, 1039, yc, 162, 104, "REDUCTION", ["F_t = η_t G T_m", "G = i_{gear} / r_w"]);
    sig(`${pf}-ft`, 1120, 1228, "F_t", "N");
  }
  // force balance, body, output
  s.sum(`${pf}-sum`, xs, yc, { left: "+", top: "−", bottom: "−" }); ids.push(`${pf}-sum`);
  sig(`${pf}-fn`, 1272, 1322, "ΣF", "N");
  B(`${pf}-body`, 1382, yc, 120, 104, "VEHICLE BODY", ["m_{eff} v̇ = ΣF", "v = ∫ v̇ dt"]);
  W(`${pf}-v`, [[1442, yc], [1582, yc]]);
  s.label(1532, yc - 13, "v = v_{ego}", "middle", "dg-sig");
  s.unit(`${pf}-v-u`, 1532, yc + 25, "m/s");
  s.dot(1500, yc);
  s.role(1514, yc - 72, "OUTPUT · v", "cv");
  // brakes (disturbance input of the force balance)
  s.label(xs, yc - 90, "F_b", "middle", "dg-sig");
  s.label(xs + 20, yc - 90, "brakes (70 ms + lag 80 ms)", "start", "dg-small");
  W(`${pf}-fb`, [[xs, yc - 80], [xs, yc - 23]]);
  s.unit(`${pf}-fb-u`, xs + 12, yc - 46, "N", "start");
  // road load
  W(`${pf}-vr`, [[1500, yc], [1500, yc + 100], [1371, yc + 100]]);
  B(`${pf}-res`, xs, yc + 100, 240, 64, "ROAD LOAD", ["F_{res} = c_a v² + R_x + m g sin β"]);
  W(`${pf}-fr`, [[xs, yc + 68], [xs, yc + 23]]);
  s.label(xs - 12, yc + 52, "F_{res}", "end", "dg-sig");
  s.unit(`${pf}-fr-u`, xs + 12, yc + 52, "N", "start");
  s.dot(1500, yc + 100);
  // internal feedbacks of the speed
  if (ice) {
    W(`${pf}-we`, [[1500, yc + 100], [1500, yc + 172], [442, yc + 172], [442, yc + 53]]);
    W(`${pf}-we2`, [[689, yc + 172], [689, yc + 53]]);
    s.dot(689, yc + 172);
    s.label(1060, yc + 162, "v  →  ω_e = G v   (engine speed, clutch closed)", "middle", "dg-small");
    s.unit(`${pf}-we-u`, 1060, yc + 194, "rad/s");
    s.label(452, yc + 112, "pumping ṁ_{cyl}", "start", "dg-small");
    s.label(699, yc + 112, "friction T_{loss}", "start", "dg-small");
  } else {
    W(`${pf}-vb`, [[1500, yc + 100], [1500, yc + 172], [906, yc + 172]]);
    s.label(1200, yc + 162, "v", "middle", "dg-sig");
    s.unit(`${pf}-vb-u`, 1200, yc + 194, "m/s");
    B(`${pf}-emf`, 805, yc + 172, 200, 58, "BACK-EMF", ["e_b = k_e G v"]);
    W(`${pf}-eb`, [[705, yc + 172], [358, yc + 172], [358, yc + 23]]);
    s.label(530, yc + 162, "e_b", "middle", "dg-sig");
    s.unit(`${pf}-eb-u`, 530, yc + 194, "V");
  }
  const put = (id, txt) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ok = txt != null && !/NaN|undefined/.test(txt);
    el.textContent = ok ? txt : el.dataset.def;
    el.classList.toggle("live", ok);
  };
  const all = ice ? ["th", "mth", "pm", "te", "tef", "we"] : ["vci", "vc", "ul", "ia", "tm", "vb", "eb"];
  return {
    live(st, on) {
      cls(ids, "on", on);
      const S = st?.sig;
      if (!st || !S) {
        for (const k of [...all, "ft", "fn", "fb", "fr", "v"]) put(`${pf}-${k}-u`, null);
        put(`${pf}-dd`, null);
        return;
      }
      const K = physK(), v = st.v, Fres = K.Fres(v), N0 = (x) => (Math.abs(x) >= 9999.5 ? `${(x / 1e3).toFixed(1)} kN` : `${x.toFixed(0)} N`);
      if (ice) {
        put(`${pf}-th-u`, `${S.th.toFixed(3)} rad`);
        put(`${pf}-mth-u`, `${(1e3 * K.mth(S.th, S.pm)).toFixed(2)} g/s`);
        put(`${pf}-pm-u`, `${(S.pm / 1e3).toFixed(1)} kPa`);
        put(`${pf}-te-u`, `${S.Te.toFixed(1)} N·m`);
        const Teff = S.Ft >= 0 ? S.Ft / (K.etaI * K.Gice) : S.Ft * K.etaI / K.Gice;
        put(`${pf}-tef-u`, `${Teff.toFixed(1)} N·m`);
        put(`${pf}-we-u`, `${(K.Gice * v).toFixed(1)} rad/s · ${S.rpm.toFixed(0)} rpm`);
      } else {
        const eb = K.ke * K.Gev * v;
        put(`${pf}-vci-u`, `${S.Vc.toFixed(1)} V`);
        put(`${pf}-vc-u`, `${S.Vc.toFixed(1)} V`);
        put(`${pf}-dd`, `D = ${S.D.toFixed(3)}`);
        put(`${pf}-ul-u`, `${(S.Vc - eb).toFixed(2)} V`);
        put(`${pf}-ia-u`, `${S.ia.toFixed(1)} A`);
        put(`${pf}-tm-u`, `${(K.kt * S.ia).toFixed(1)} N·m`);
        put(`${pf}-vb-u`, `${v.toFixed(2)} m/s`);
        put(`${pf}-eb-u`, `${eb.toFixed(1)} V`);
      }
      put(`${pf}-ft-u`, N0(S.Ft));
      put(`${pf}-fb-u`, N0(S.Fb));
      put(`${pf}-fr-u`, N0(Fres));
      put(`${pf}-fn-u`, N0(S.Ft - S.Fb - Fres));
      put(`${pf}-v-u`, `${v.toFixed(2)} m/s`);
    },
  };
}

// roles of the signals and input -> output of every block (info under the meshes)
function varsStrip(kind) {
  const P = PLANT[car], range = P.sat.replace(/\s\S+$/, "");
  const mv = ["mv", "Manipulated variable", `${mh(P.u)} [${P.unit}] ∈ ${range}`];
  const chips = kind === 1 ? [
    ["cv", "Controlled variable", "v<sub>ego</sub> [m/s]"],
    ["ref", "Reference", "v<sub>ref</sub> = v<sub>set</sub> [m/s]"],
    ["err", "Error", "e = v<sub>ref</sub> − v<sub>ego</sub> [m/s]"],
    mv,
    ["dist", "Disturbances", "F<sub>res</sub>(v), grade β, F<sub>b</sub> [N]"],
    ["", "Measured", "v<sub>ego</sub> (unit feedback)"],
    ["", "Sampling", "T<sub>s</sub> = 20 ms, ZOH"],
  ] : [
    ["cv", "Controlled variable", "d [m]"],
    ["err", "Inner variable", "v<sub>ego</sub> [m/s]"],
    ["ref", "Reference", "d<sub>ref</sub> [m] (time gap)"],
    ["err", kind === 2 ? "Errors" : "Composite error", kind === 2
      ? "e<sub>d</sub> [m] → v<sub>corr</sub> → e<sub>v</sub> [m/s]"
      : "ε = Δv − K<sub>d</sub> e<sub>d</sub> [m/s]"],
    mv,
    ["dist", "Disturbance (measured)", "v<sub>lead</sub> [m/s]"],
    ["", "Measured (radar)", "d [m], Δv = v<sub>lead</sub> − v<sub>ego</sub> [m/s]"],
    ["", "Sampling", "T<sub>s</sub> = 20 ms, ZOH"],
  ];
  return `<div class="dg-vars">${chips.map(([k, a, b]) => `<div class="dg-var ${k}"><span>${a}</span><b>${b}</b></div>`).join("")}</div>`;
}
function ioTable(kind) {
  const P = PLANT[car], U = P.unit, u = P.u;
  const r = (blk, inp, out, rel, c = "") => `<tr class="${c}"><td>${mh(blk)}</td><td>${mh(inp)}</td><td>${mh(out)}</td><td>${mh(rel)}</td></tr>`;
  const pi = `Δu[k] = Δu_{PI}[k] + D[k]:  Δu_{PI}[k−1] + q_0 e[k] − q_1 e[k−1],  D[k] = p_f D[k−1] + k_f (e[k] − e[k−1])`;
  const plant = r(`Plant G_v(s) · ${P.name.split(" · ")[0]}`, `${u} [${U}]`, `v_{ego} [m/s]${kind === 1 ? "  (controlled)" : ""}`,
    `Δv/${P.du} = N/(s² + D s + E)${P.delay ? " · e^{−0.06 s}" : ""}  (linearised M1)`, "plant");
  const zoh = r("ZOH", "Δu[k]", `Δu(t) [${U}]`, "held constant over each T_s");
  const ctrl = {
    1: [
      r("Σ speed error", "v_{ref}, v_{ego} [m/s]", "e(t) [m/s]", "e = v_{ref} − v_{ego}"),
      r("Sampler", "e(t) [m/s]", "e[k] [m/s]", "e[k] = e(k T_s),  T_s = 20 ms"),
      r("C_v(z) · PID", "e[k] [m/s]", `Δu[k] [${U}]`, pi), zoh,
      r("Σ trim", `Δu(t), ${P.u0} [${U}]`, `${u} [${U}]`, `${u} = ${P.u0} + Δu`),
      r("Saturation", `${u} [${U}]`, `${u} [${U}]`, `${u} ∈ ${P.sat},  anti-windup`), plant],
    2: [
      r("Σ distance error", "d_{ref}, d [m]", "e_d [m]", "e_d = d_{ref} − d"),
      r("C_d", "e_d [m]", "v_{corr} [m/s]", `v_{corr} = −K_d e_d,  K_d = ${KD} s^{−1}`),
      r("Σ speed set-point", "v_{lead}, v_{corr} [m/s]", "v_{ref} [m/s]", "v_{ref} = v_{lead} + v_{corr}"),
      r("Σ speed error", "v_{ref}, v_{ego} [m/s]", "e_v [m/s]", "e_v = v_{ref} − v_{ego}"),
      r("C_v(z) · PID", "e_v[k] [m/s]", `Δu[k] [${U}]`, pi.replace(/e\[/g, "e_v[")), zoh, plant],
    3: [
      r("Σ distance error", "d_{ref}, d [m]", "e_d [m]", "e_d = d_{ref} − d"),
      r("C_d", "e_d [m]", "v_{corr} [m/s]", `v_{corr} = −K_d e_d,  K_d = ${KD} s^{−1}`),
      r("Σ composite error", "v_{corr}, Δv [m/s]", "ε [m/s]", "ε = Δv + v_{corr} = Δv − K_d e_d"),
      r("C_B(z) = C_v(z)", "ε[k] [m/s]", `Δu[k] [${U}]`, pi.replace(/e\[/g, "ε[")), zoh, plant],
  }[kind];
  const sub = (car === "ice" ? [
    ["Throttle body", "θ_{th} [rad], p_m [kPa]", "ṁ_{th} [g/s]", "ṁ_{th} = K_2 (1 − cos θ_{th}) Φ(p_m/p_{atm})"],
    ["Intake manifold", "ṁ_{th} [g/s], v [m/s]", "p_m [kPa]", "ṗ_m = K_1 (ṁ_{th} − ṁ_{cyl}),  ṁ_{cyl} = K_3 p_m v"],
    ["Engine torque", "p_m [kPa], ω_e [rad/s]", "T_e [N·m]", "T_e = k_T p_m − (T_0 + c_w ω_e)"],
    ["Torque delay", "T_e [N·m]", "T_{e,eff} [N·m]", "T_{e,eff}(t) = T_e(t − 60 ms)  →  z^{−3}"],
    ["Transmission", "T_{e,eff} [N·m]", "F_t [N]", "F_t = η_t G T_{e,eff},  G = i_{gear}/r_w"],
  ] : [
    ["DC/DC converter", "V_c command [V]", "V_c [V]", "V_c = D V_{bat},  D ∈ [0, 1]"],
    ["Σ armature voltage", "V_c, e_b [V]", "u_L [V]", "u_L = V_c − e_b"],
    ["Armature R–L", "u_L [V]", "i_a [A]", "L_a di_a/dt = u_L − R_a i_a"],
    ["DC motor", "i_a [A]", "T_m [N·m]", "T_m = k_t i_a"],
    ["Reduction", "T_m [N·m]", "F_t [N]", "F_t = η_t G T_m,  G = i_{gear}/r_w"],
  ]).concat([
    ["Σ force balance", "F_t, F_b, F_{res} [N]", "ΣF [N]", "ΣF = F_t − F_b − F_{res}"],
    ["Vehicle body", "ΣF [N]", "v [m/s]", "m_{eff} v̇ = ΣF"],
    ["Road load", "v [m/s]", "F_{res} [N]", "F_{res} = c_a v|v| + R_x cos β + m g sin β"],
  ], car === "ice" ? [["Engine speed", "v [m/s]", "ω_e [rad/s]", "ω_e = G v  (clutch closed)"]]
                   : [["Back-EMF", "v [m/s]", "e_b [V]", "e_b = k_e G v"]]).map((x) => r(...x, "sub")).join("");
  const tail = {
    1: "",
    2: r("Distance dynamics", "v_{lead}, v_{ego} [m/s]", "d [m]  (controlled)", "ḋ = v_{lead} − v_{ego}"),
    3: r("Radar · distance dynamics", "v_{lead}, v_{ego} [m/s]", "Δv [m/s], d [m]  (controlled)", "Δv = v_{lead} − v_{ego},  ḋ = Δv"),
  }[kind];
  return `<details class="dg-iotab" open><summary>Signals of every block · input → output · ${PLANT[car].name}</summary>
    <div class="dg-tablewrap"><table class="dg-table io"><thead><tr><th>Block</th><th>Input(s)</th><th>Output</th><th>Relation</th></tr></thead>
    <tbody>${ctrl.join("")}<tr class="grp"><td colspan="4">inside the plant — click the plant block to open it</td></tr>${sub}${tail}</tbody></table></div></details>`;
}

// ============================================================================ z-domain numerics
// Small, dependency-free tools for the transfer-function slide: polynomials
// (coefficients from the highest power down), their roots, the matrix
// exponential and the ZOH discretisation G(z) = (1 - z^-1) Z{G(s)/s}.
const pmul = (a, b) => {
  const r = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { r[i + j] += x * y; }));
  return r;
};
const padd = (a, b) => {
  const n = Math.max(a.length, b.length), r = new Array(n).fill(0);
  a.forEach((x, i) => { r[n - a.length + i] += x; });
  b.forEach((x, i) => { r[n - b.length + i] += x; });
  return r;
};
const pscale = (a, k) => a.map((x) => x * k);
const pval = (a, x) => a.reduce((s, c) => s * x + c, 0);
// complex numbers as [re, im]
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a) => Math.hypot(a[0], a[1]);
const cpval = (p, z) => p.reduce((s, c) => { const t = cmul(s, z); return [t[0] + c, t[1]]; }, [0, 0]);
const cdpval = (p, z) => { const n = p.length - 1; return cpval(p.slice(0, -1).map((c, i) => c * (n - i)), z); };

// all roots of a real polynomial (Durand-Kerner, Newton polish, conjugate cleanup)
function roots(p) {
  let a = p.slice();
  while (a.length > 1 && a[0] === 0) a.shift();
  const out = [];
  while (a.length > 1 && a[a.length - 1] === 0) { a.pop(); out.push([0, 0]); }   // exact roots at z = 0
  const n = a.length - 1;
  if (n < 1) return out;
  const c = a.map((x) => x / a[0]);
  if (n === 1) return out.concat([[-c[1], 0]]);
  if (n === 2) {
    const d = c[1] * c[1] - 4 * c[2];
    if (d >= 0) {                                  // stable form of the quadratic formula
      const q = -0.5 * (c[1] + Math.sign(c[1] || 1) * Math.sqrt(d));
      return out.concat([[q, 0], [c[2] / q, 0]]);
    }
    return out.concat([[-c[1] / 2, Math.sqrt(-d) / 2], [-c[1] / 2, -Math.sqrt(-d) / 2]]);
  }
  const r0 = Math.max(0.5, Math.pow(Math.abs(c[n]), 1 / n)) * 1.05;
  let z = Array.from({ length: n }, (_, k) => [r0 * Math.cos(2 * Math.PI * k / n + 0.4), r0 * Math.sin(2 * Math.PI * k / n + 0.4)]);
  for (let it = 0; it < 4000; it++) {
    let mx = 0;
    for (let k = 0; k < n; k++) {
      let den = [1, 0];
      for (let j = 0; j < n; j++) if (j !== k) den = cmul(den, [z[k][0] - z[j][0], z[k][1] - z[j][1]]);
      const dz = cdiv(cpval(c, z[k]), den);
      z[k] = [z[k][0] - dz[0], z[k][1] - dz[1]];
      mx = Math.max(mx, cabs(dz) / (1 + cabs(z[k])));
    }
    if (mx < 1e-16) break;
  }
  z = z.map((r) => {                                 // Newton polish on the full polynomial
    for (let i = 0; i < 3; i++) {
      const d = cdpval(c, r);
      if (cabs(d) < 1e-300) break;
      const dz = cdiv(cpval(c, r), d);
      if (!isFinite(dz[0]) || !isFinite(dz[1])) break;
      r = [r[0] - dz[0], r[1] - dz[1]];
    }
    return Math.abs(r[1]) < 1e-7 * (1 + Math.abs(r[0])) ? [r[0], 0] : r;
  });
  return out.concat(z).sort((u, v) => cabs(v) - cabs(u) || v[1] - u[1]);
}

// matrices as arrays of rows
const mzeros = (n, m = n) => Array.from({ length: n }, () => new Array(m).fill(0));
const meye = (n) => mzeros(n).map((r, i) => (r[i] = 1, r));
const mmul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));
function expm(M) {                                   // scaling and squaring + Taylor
  const n = M.length;
  const nrm = Math.max(...M.map((r) => r.reduce((s, x) => s + Math.abs(x), 0)));
  const sq = Math.max(0, Math.ceil(Math.log2(nrm / 0.25)));
  const A = M.map((r) => r.map((x) => x / 2 ** sq));
  let E = meye(n), T = meye(n);
  for (let k = 1; k <= 22; k++) {
    T = mmul(T, A).map((r) => r.map((x) => x / k));
    E = E.map((r, i) => r.map((x, j) => x + T[i][j]));
  }
  for (let i = 0; i < sq; i++) E = mmul(E, E);
  return E;
}
// ZOH of x' = A x + B u, y = C x at the period ts -> { num, den } in z (Faddeev-LeVerrier)
function zohTF(A, B, C, ts) {
  const n = A.length, M = mzeros(n + 1);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] = A[i][j] * ts; M[i][n] = B[i] * ts; }
  const E = expm(M);
  const Phi = E.slice(0, n).map((r) => r.slice(0, n)), Gam = E.slice(0, n).map((r) => r[n]);
  let Mk = mzeros(n);
  const den = [1], num = [];
  for (let k = 1; k <= n; k++) {
    Mk = mmul(Phi, Mk).map((r, i) => r.map((x, j) => x + (i === j ? den[k - 1] : 0)));
    num.push(C.reduce((s, ci, i) => s + ci * Mk[i].reduce((t, x, j) => t + x * Gam[j], 0), 0));
    const PM = mmul(Phi, Mk);
    den.push(-PM.reduce((s, r, i) => s + r[i], 0) / k);
  }
  return { num, den };
}

// every transfer function of the slide, for one operating point
function tfAnalysis(p, nd, ts, kd) {
  const { N, D, E, q0, q1 } = p;
  const Gv = zohTF([[0, 1], [-E, -D]], [0, 1], [N, 0], ts);                  // speed
  const Gx = zohTF([[0, 1, 0], [-E, -D, 0], [N, 0, 0]], [0, 1, 0], [0, 0, 1], ts); // position (G_v/s)
  const numV = Gv.num, denV = Gv.den, numX = Gx.num;
  // PID: C(z) = (q0 z - q1)/(z - 1) + kf (z - 1)/(z - pf) = Cn / ((z - 1)(z - pf))
  const pf = TF / (TF + ts), kfz = p.KD / (TF + ts);
  const zm1 = [1, -1], Z = [1, ...new Array(nd).fill(0)];
  const C = padd(pmul([q0, -q1], [1, -pf]), pscale(pmul(zm1, zm1), kfz));
  const Cd = pmul(zm1, [1, -pf]);
  const denX = pmul(zm1, denV);                         // (z - 1) den_v exactly
  // mesh 1
  const nL1 = pmul(C, numV), dL1 = pmul(pmul(Cd, denV), Z);
  const ch1 = padd(dL1, nL1);
  // mesh 2, architecture B
  const inner = padd(pmul(numV, zm1), pscale(numX, kd));
  const nLB = pmul(C, inner), dLB = pmul(pmul(pmul(Cd, zm1), denV), Z);
  const chB = padd(dLB, nLB);
  const nTd = pscale(pmul(C, numX), kd);
  // architecture A (rejected)
  const chA = padd(dLB, nTd);
  // open-loop poles are known factors: (z - 1)^k, the plant, z^nd
  const pv = roots(denV), z0 = new Array(nd).fill(0).map(() => [0, 0]);
  const ol = (k) => [...new Array(k).fill(0).map(() => [1, 0]), [pf, 0], ...pv, ...z0].sort((u, v) => cabs(v) - cabs(u));
  // continuous PID: ((K_p tau_f + K_D) s^2 + (K_p + K_i tau_f) s + K_i) / (s (tau_f s + 1))
  const cS = [p.Kp * TF + p.KD, p.Kp + p.Ki * TF, p.Ki];
  return {
    sPoles: roots([1, D, E]),
    numV, denV, numX, denX, nd, C, pf, kfz, cS, cSz: roots(cS),
    gv: { zeros: roots(numV), poles: [...pv, ...z0] },
    cv: { zeros: roots(C), poles: [[1, 0], [pf, 0]] },
    m1: { nL: nL1, dL: dL1, ch: ch1, zeros: roots(nL1), poles: roots(ch1), olPoles: ol(1) },
    mB: { nL: nLB, dL: dLB, ch: chB, nT: nTd, zeros: roots(nTd), poles: roots(chB), olPoles: ol(2) },
    mA: { nL: nTd, dL: dLB, ch: chA, nT: nTd, zeros: roots(nTd), poles: roots(chA), olPoles: ol(2) },
  };
}

// --------------------------------------------------------------------------- 4) transfer functions
// HTML helpers for numbers, polynomials and root lists
const fracH = (a, b) => `<span class="fr"><span>${a}</span><span>${b}</span></span>`;
const MINUS = (s) => String(s).replace(/-/g, "−");
function numH(v, sig = 5) {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e5) return MINUS(+v.toPrecision(sig));
  const e = Math.floor(Math.log10(a));
  return `${MINUS(+(v / 10 ** e).toPrecision(sig))}·10<sup>${MINUS(e)}</sup>`;
}
const fx = (v, d = 5) => (Math.abs(v) < 0.5 * 10 ** -d ? "0" : MINUS(+v.toFixed(d)));
function polyH(c, x = "z", sig = 5) {
  const n = c.length - 1;
  let s = "";
  c.forEach((a, i) => {
    const k = n - i;
    if (a === 0) return;
    const mag = Math.abs(a);
    const coef = mag === 1 && k > 0 ? "" : numH(mag, sig);
    const pw = k === 0 ? "" : k === 1 ? x : `${x}<sup>${k}</sup>`;
    const term = coef && pw ? `${coef} ${pw}` : coef || pw;
    s += s ? (a < 0 ? " − " : " + ") + term : (a < 0 ? "−" : "") + term;
  });
  return s || "0";
}
// list of roots: conjugate pairs as a ± bj, repeated roots as (×n)
function rootList(rs, d = 5) {
  const used = rs.map(() => false), out = [];
  rs.forEach((r, i) => {
    if (used[i]) return;
    used[i] = true;
    if (r[1] !== 0) {
      const j = rs.findIndex((q, k) => !used[k] && Math.abs(q[0] - r[0]) < 1e-9 && Math.abs(q[1] + r[1]) < 1e-9);
      if (j >= 0) used[j] = true;
      out.push(`${fx(r[0], d)} ± ${fx(Math.abs(r[1]), d)}j`);
      return;
    }
    let n = 1;
    rs.forEach((q, k) => { if (!used[k] && q[1] === 0 && Math.abs(q[0] - r[0]) < 1e-9) { used[k] = true; n++; } });
    out.push(n > 1 ? `${fx(r[0], d)} (×${n})` : fx(r[0], d));
  });
  return out.length ? out.join(", ") : "none";
}
const zToS = (z) => [Math.log(cabs(z)) / TS, Math.atan2(z[1], z[0]) / TS];
function sH(s) {
  return s[1] === 0 || Math.abs(s[1]) < 1e-9 ? fx(s[0], 4) : `${fx(s[0], 4)} ± ${fx(Math.abs(s[1]), 4)}j`;
}
function factS(rs) {                                   // (s + a)(s + b) or s² + 2ζω s + ω²
  if (rs.length === 2 && rs[0][1] === 0) return rs.slice().sort((a, b) => b[0] - a[0]).map((r) => `(s ${r[0] <= 0 ? "+" : "−"} ${fx(Math.abs(r[0]), 5)})`).join("");
  return polyH([1, -2 * rs[0][0], rs[0][0] ** 2 + rs[0][1] ** 2], "s");
}
function niceTicks(lo, hi, n = 4) {
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return { ticks: out, dec: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

// z-plane: full view (unit circle) or a zoom on the poles that crowd near z = 1
let zpId = 0;
function zPlane(set, mode) {
  const L = 46, T = 10, Wp = 244, id = `zpc${++zpId}`;
  const all = [...set.poles, ...set.zeros, ...(set.ghost || [])];
  let cx = 0, h;
  if (mode === "full") {
    h = Math.max(1.3, 1.1 * Math.max(...set.poles.map(cabs), 0));
  } else {
    const near = all.filter((z) => Math.hypot(z[0] - 1, z[1]) < 0.06).concat([[1, 0]]);
    const x0 = Math.min(...near.map((z) => z[0])), x1 = Math.max(...near.map((z) => z[0]));
    const y1 = Math.max(...near.map((z) => Math.abs(z[1])));
    cx = (x0 + x1) / 2;
    h = Math.max((x1 - x0) / 2, y1) * 1.35 + 0.0012;
  }
  const X = (x) => L + (x - cx + h) / (2 * h) * Wp, Y = (y) => T + (h - y) / (2 * h) * Wp;
  const inside = (z) => Math.abs(z[0] - cx) <= h && Math.abs(z[1]) <= h;
  let g = `<defs><clipPath id="${id}"><rect x="${L}" y="${T}" width="${Wp}" height="${Wp}"/></clipPath></defs>
    <rect class="zp-bg" x="${L}" y="${T}" width="${Wp}" height="${Wp}"/>`;
  const tx = niceTicks(cx - h, cx + h, mode === "full" ? 4 : 3), ty = niceTicks(-h, h, mode === "full" ? 4 : 3);
  g += `<g clip-path="url(#${id})">`;
  for (const v of tx.ticks) g += `<line class="zp-grid" x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${T + Wp}"/>`;
  for (const v of ty.ticks) g += `<line class="zp-grid" y1="${Y(v)}" y2="${Y(v)}" x1="${L}" x2="${L + Wp}"/>`;
  if (Math.abs(cx) <= h) g += `<line class="zp-axis" x1="${X(0)}" x2="${X(0)}" y1="${T}" y2="${T + Wp}"/>`;
  g += `<line class="zp-axis" y1="${Y(0)}" y2="${Y(0)}" x1="${L}" x2="${L + Wp}"/>`;
  if (mode === "full") {
    g += `<circle class="zp-unit" cx="${X(0)}" cy="${Y(0)}" r="${Wp / (2 * h)}"/>`;
  } else {                                              // the arc of |z| = 1 through the window
    const a = Math.min(Math.PI, 1.5 * h + 0.01), pts = [];
    for (let k = 0; k <= 240; k++) { const t = -a + 2 * a * k / 240; pts.push(`${X(Math.cos(t)).toFixed(2)},${Y(Math.sin(t)).toFixed(2)}`); }
    g += `<polyline class="zp-unit" points="${pts.join(" ")}"/>`;
  }
  // markers (grouped when repeated), drawn ghost -> zeros -> poles
  const groups = (rs) => {
    const out = [];
    for (const r of rs) {
      const o = out.find((q) => Math.abs(q.z[0] - r[0]) < 1e-7 && Math.abs(q.z[1] - r[1]) < 1e-7);
      if (o) o.n++; else out.push({ z: r, n: 1 });
    }
    return out;
  };
  const off = [];
  const mark = (kind, list, cl) => {
    for (const { z, n } of groups(list)) {
      if (!inside(z)) { if (mode === "full" && kind !== "g") off.push({ z, kind }); continue; }
      const x = X(z[0]), y = Y(z[1]), bad = kind !== "z" && cabs(z) > 1 + 1e-9 ? " bad" : "";
      const sd = zToS(z);
      const tip = `${kind === "z" ? "zero" : kind === "g" ? "open-loop pole" : "pole"}  z = ${fx(z[0], 6)}${z[1] ? ` ${z[1] < 0 ? "−" : "+"} ${fx(Math.abs(z[1]), 6)}j` : ""}` +
        `  |z| = ${fx(cabs(z), 6)}${cabs(z) > 0 ? `  ·  s = ${fx(sd[0], 4)}${sd[1] ? ` ${sd[1] < 0 ? "−" : "+"} ${fx(Math.abs(sd[1]), 4)}j` : ""} rad/s` : "  (pure delay)"}${n > 1 ? `  ·  ×${n}` : ""}`;
      g += `<g class="zm ${cl}${bad}"><title>${esc(tip)}</title>` + (kind === "z"
        ? `<circle cx="${x}" cy="${y}" r="5.6"/>`
        : `<path d="M${x - 5.5},${y - 5.5}L${x + 5.5},${y + 5.5}M${x - 5.5},${y + 5.5}L${x + 5.5},${y - 5.5}"/>`) +
        (n > 1 ? `<text x="${x + 8}" y="${y - 7}">${n}</text>` : "") + "</g>";
    }
  };
  mark("g", set.ghost || [], "ghost");
  mark("z", set.zeros, "zero");
  mark("p", set.poles, "pole");
  g += "</g>";
  off.forEach(({ z, kind }, i) => {                     // off-scale roots: a pointer at the border
    const left = z[0] < cx, x = left ? L + 8 : L + Wp - 8, y = T + Wp / 2 + 16 + i * 16;
    g += `<g class="zm off ${kind === "z" ? "zero" : "pole"}"><title>${kind === "z" ? "zero" : "pole"} z = ${fx(z[0], 5)} (off scale)</title>
      <text x="${x}" y="${y}" text-anchor="${left ? "start" : "end"}">${left ? "◂ " : ""}${kind === "z" ? "○" : "×"} ${fx(z[0], 3)}${left ? "" : " ▸"}</text></g>`;
  });
  for (const v of tx.ticks) g += `<text class="zp-tick" x="${X(v)}" y="${T + Wp + 15}" text-anchor="middle">${MINUS(v.toFixed(tx.dec))}</text>`;
  for (const v of ty.ticks) g += `<text class="zp-tick" x="${L - 5}" y="${Y(v) + 4}" text-anchor="end">${MINUS(v.toFixed(ty.dec))}</text>`;
  g += `<text class="zp-cap" x="${L + 6}" y="${T + 15}">${mode === "full" ? "z-plane" : `zoom near z = 1`}</text>
        <text class="zp-ax" x="${L + Wp}" y="${T + Wp + 28}" text-anchor="end">Re z</text>
        <text class="zp-ax" x="${L + Wp - 6}" y="${T + 15}" text-anchor="end">Im z</text>`;
  return `<svg class="zp" viewBox="0 0 300 290" xmlns="http://www.w3.org/2000/svg" style="--zc: var(--${car})">${g}</svg>`;
}

function tfSlide() {
  const P = PLANT[car], st = liveState();
  const p = opPoint(st?.v ?? null), nd = P.nd;
  tfShown = `${car}:${p.v0}`;
  const A = tfAnalysis(p, nd, TS, KD);
  const dl = nd ? " · e<sup>−0.06 s</sup>" : "", dz = nd ? " · z<sup>−3</sup>" : "", z3 = nd ? " z<sup>3</sup>" : "";
  const S = (k) => `<sub>${k}</sub>`;
  const core = (items) => `<div class="tf-core">${items.map(([k, v, c = ""]) => `<div class="${c}"><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;
  const row = (n, title, eqs, items, zset, note = "") => `<section class="tf-row" style="--zc: var(--${car})">
    <div class="tf-left"><h3><span class="tf-n"><span>${n}</span></span><span>${title}</span></h3>
      ${eqs.map(([k, v]) => `<div class="tf-eq"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}
      ${core(items)}${note ? `<p class="tf-note">${note}</p>` : ""}</div>
    <div class="tf-z"><div class="tf-zp">${zPlane(zset, "full")}${zPlane(zset, "zoom")}</div>
      <div class="tf-legend"><span class="p">×</span> pole <span class="z">○</span> zero${zset.ghost ? ` <span class="g">×</span> open-loop pole` : ""}
        <span class="b">×</span> |z| &gt; 1 · hover a marker for its value</div></div></section>`;
  const closed = (sys, txt, num) => {
    const rho = cabs(sys.poles[0]), dom = zToS(sys.poles[0]);
    const stable = rho < 1;
    const T1 = pval(num, 1) / pval(sys.ch, 1);
    return [
      [`closed-loop poles z`, rootList(sys.poles)],
      [`zeros z`, rootList(sys.zeros)],
      [`max |z|`, `${fx(rho, 6)} ${stable ? "&lt; 1 · stable" : "&gt; 1 · UNSTABLE"}`, stable ? "ok" : "bad"],
      [`dominant pole in s = ln z / T${S("s")}`, `${sH(dom)} rad/s`],
      ...(stable ? [[`τ${S("dom")} = −T${S("s")} / ln|z|max`, `${fx(-TS / Math.log(rho), 2)} s (≈ ${fx(-4 * TS / Math.log(rho), 1)} s to 2 %)`]] : []),
      [`static gain T(1)`, fx(T1, 4)],
      [`open-loop poles`, rootList(sys.olPoles)],
      ...(txt ? [[`PM (PI → PID) · GM`, `${txt.PMpi}° → ${txt.PM}° · ${txt.GM ?? "—"} dB`], [`overshoot · t${S("s")} (PID)`, `${txt.D} % · ${txt.ts} s`]]
              : [[`verdict (PI and PID)`, `unstable for every K${S("d")} &gt; 0`, "bad"]]),
    ];
  };
  const pick = `<div class="tf-pick"><span class="lbl">Linearization</span>
    <button data-op="auto" class="${opMode === "auto" ? "on" : ""}">auto · live speed</button>
    ${POINTS[car].map((q, i) => `<button data-op="${i}" class="${String(opMode) === String(i) ? "on" : ""}">v₀ = ${q.v0} m/s</button>`).join("")}
    <em>${P.name} · shown: <b>v₀ = ${p.v0} m/s</b> · trim ${mh(P.u0)} = ${p.u0} ${P.unit}</em></div>`;
  const fast = Math.max(...A.sPoles.map(cabs));
  const dt = cfgNum("simulation", car === "ice" ? "dt_ice" : "dt_ev", car === "ice" ? 5e-4 : 2e-4);
  const sampling = `<section class="tf-row tf-samp"><div class="tf-left"><h3><span class="tf-n"><span>T${S("s")}</span></span><span>Sampling and structure (common to every transfer function below)</span></h3>
    ${core([
      [`T${S("s")} · speed PID C${S("v")}, distance C${S("d")}, switch`, "20 ms", "hl"],
      [`D filter τ${S("f")} = T${S("D")}/N`, `${TF} s (N = ${ND}) → pole z = p${S("f")} = ${fx(PF, 5)}`],
      ["hold", "ZOH on u (plant continuous)"],
      [`ω${S("s")} = 2π/T${S("s")}`, `${fx(2 * Math.PI / TS, 1)} rad/s`],
      [`Nyquist π/T${S("s")}`, `${fx(Math.PI / TS, 1)} rad/s`],
      [`ω${S("c")} (design cut-off)`, "0.8 rad/s"],
      [`ω${S("s")} / ω${S("c")}`, fx(2 * Math.PI / TS / 0.8, 0)],
      [`ZOH lag at ω${S("c")} ≈ ω${S("c")}T${S("s")}/2`, `${fx(0.8 * TS / 2 * 180 / Math.PI, 2)}°`],
      [`fastest plant pole`, `${fx(-fast, 3)} rad/s → |p|T${S("s")} = ${fx(fast * TS, 3)}`],
      [`delay`, nd ? `θ${S("e")} = 60 ms = 3 T${S("s")} → z<sup>−3</sup>` : "none (EV)"],
      [`K${S("d")} (mesh 2)`, `${KD} s<sup>−1</sup>`],
      [`plant integration`, `RK4, dt = ${fx(dt * 1e3, 2)} ms`],
      [`scheduling`, `q${S("0")}, q${S("1")}, k${S("f")}, ${mh(P.u0)} interpolated in v[k]`],
    ])}</div></section>`;
  const r1 = row(1, `Plant G${S("v")} — ${P.name}, linearised at v₀ = ${p.v0} m/s`, [
    ["general", `G${S("v")}(s) = ${frac("Δv(s)", `${P.du}(s)`)} = ${frac("N", "s^2 + D s + E")}${dl}`],
    ["substituted", `G${S("v")}(s) = ${fracH(numH(p.N, 6), polyH([1, p.D, p.E], "s", 6))}${dl}`],
    ["factored", `G${S("v")}(s) = ${fracH(numH(p.N, 6), factS(A.sPoles))}${dl}`],
    [`ZOH, T${S("s")} = 20 ms`, `G${S("v")}(z) = (1 − z<sup>−1</sup>) 𝒵{G${S("v")}(s)/s} = ${frac("b_1 z + b_2", "z^2 + a_1 z + a_2")}${nd ? ` · z<sup>−n${S("d")}</sup>` : ""}`],
    ["substituted", `G${S("v")}(z) = ${fracH(polyH(A.numV, "z", 6), polyH(A.denV, "z", 6))}${dz}`],
  ], [
    ["poles s", `${rootList(A.sPoles, 5)} rad/s`],
    ["time constants −1/p", A.sPoles.map((r) => `${fx(-1 / r[0], 3)} s`).join(", ")],
    [`ω${S("n")} = √E · ζ = D / 2√E`, `${fx(Math.sqrt(p.E), 4)} rad/s · ${fx(p.D / (2 * Math.sqrt(p.E)), 3)}`],
    ["static gain N/E", `${fx(p.N / p.E, 4)} (m/s)/${P.unit}`],
    ["finite zeros s", "none"],
    [`poles z = e<sup>pT${S("s")}</sup>`, rootList(A.gv.poles)],
    ["zero z (sampling zero)", rootList(A.gv.zeros)],
    [`n${S("d")} (delay)`, nd ? "3 · 60 ms" : "0"],
  ], { poles: A.gv.poles, zeros: A.gv.zeros },
  nd ? "The torque delay adds three poles at z = 0 (pure delay). The slow pole near z = 1 is the vehicle, the other the intake manifold." : "Both poles are real: the slow one is the vehicle with the back-EMF, the fast one the armature.");

  const r2 = row(2, `Speed controller C${S("v")} — PID (PI M1 + filtered D)`, [
    ["general", `C${S("v")}(s) = K${S("p")} + ${frac("K_i", "s")} + ${frac("K_D s", "τ_f s + 1")} = K${S("p")} [1 + ${frac("1", "T_i s")} + ${frac("T_D s", "T_D s / N + 1")}], &nbsp; T${S("i")} = K${S("p")}/K${S("i")}, T${S("D")} = K${S("D")}/K${S("p")}`],
    ["substituted", `C${S("v")}(s) = ${numH(p.Kp, 6)} + ${fracH(numH(p.Ki, 6), "s")} + ${fracH(`${numH(p.KD, 6)} s`, `${TF} s + 1`)} = ${fracH(polyH(A.cS, "s", 6), `s (${TF} s + 1)`)}`],
    ["backward Euler", `s → ${frac("z − 1", "z T_s")}: &nbsp; C${S("v")}(z) = ${frac("q_0 z − q_1", "z − 1")} + k${S("f")} ${frac("z − 1", "z − p_f")}, &nbsp; q${S("0")} = K${S("p")} + K${S("i")}T${S("s")}, q${S("1")} = K${S("p")}, k${S("f")} = ${frac("K_D", "τ_f + T_s")}, p${S("f")} = ${frac("τ_f", "τ_f + T_s")}`],
    ["substituted", `C${S("v")}(z) = ${fracH(polyH([p.q0, -p.q1], "z", 6), "z − 1")} + ${numH(A.kfz, 6)} ${fracH("z − 1", `z − ${fx(A.pf, 5)}`)} = ${fracH(polyH(A.C, "z", 6), `(z − 1)(z − ${fx(A.pf, 5)})`)}`],
  ], [
    [`K${S("p")} · K${S("i")} · K${S("D")}`, `${p.Kp} · ${p.Ki} · ${p.KD}`],
    [`T${S("i")} · T${S("D")} = T${S("i")}/8 · N`, `${fx(p.Kp / p.Ki, 3)} s · ${TD} s · ${ND}`],
    [`ω${S("c")} (PI M1 design, gains kept)`, "0.8 rad/s"],
    ["zeros s", `${rootList(A.cSz, 4)} rad/s`],
    ["poles s", `0, ${fx(-1 / TF, 3)} rad/s (filter)`],
    ["zeros z", rootList(A.cv.zeros)],
    ["poles z", `1 (integrator), ${fx(A.pf, 5)} (filter)`],
    [`q${S("0")} · q${S("1")} · k${S("f")}`, `${p.q0} · ${p.q1} · ${numH(A.kfz, 5)}`],
    [`T${S("s")}`, "20 ms"],
  ], { poles: A.cv.poles, zeros: A.cv.zeros },
  `Same controller in both meshes (only its input changes). The D adds a second zero and the filter pole p_f: phase lead around ω_c, so the phase margin rises (mesh 2: ${p.B.PMpi}° → ${p.B.PM}°) while the gain margin stays ≥ 12.9 dB everywhere.`);

  const r3 = row(3, `Mesh 1 · speed loop (Système 1)`, [
    ["general", `L${S("1")}(z) = C${S("v")}(z) G${S("v")}(z)${dz.replace(" · ", " ")}, &nbsp; T${S("1")}(z) = ${frac("v_{ego}(z)", "v_{ref}(z)")} = ${frac("L_1(z)", "1 + L_1(z)")}`],
    ["open loop", `L${S("1")}(z) = ${fracH(polyH(A.m1.nL), `(z − 1)(z − ${fx(A.pf, 4)})(${polyH(A.denV)})${z3}`)}`],
    ["closed loop", `T${S("1")}(z) = ${fracH(polyH(A.m1.nL), polyH(A.m1.ch))}`],
  ], closed(A.m1, p.s1, A.m1.nL), { poles: A.m1.poles, zeros: A.m1.zeros, ghost: A.m1.olPoles });

  const r4 = row(4, `Mesh 2 · distance loop, architecture B`, [
    ["general", `G${S("x")}(z) = (1 − z<sup>−1</sup>) 𝒵{G${S("v")}(s)/s<sup>2</sup>} (position), &nbsp; L${S("B")}(z) = C${S("v")}(z) [G${S("v")}(z) + K${S("d")} G${S("x")}(z)]${dz.replace(" · ", " ")}`],
    ["", `T${S("d")}(z) = ${frac("d(z)", "d_{ref}(z)")} = ${frac("K_d C_v(z) G_x(z) z^{−n_d}", "1 + L_B(z)")}`],
    ["position", `G${S("x")}(z) = ${fracH(polyH(A.numX), `(z − 1)(${polyH(A.denV)})`)}`],
    ["open loop", `L${S("B")}(z) = ${fracH(polyH(A.mB.nL), `(z − 1)<sup>2</sup>(z − ${fx(A.pf, 4)})(${polyH(A.denV)})${z3}`)}`],
    ["closed loop", `T${S("d")}(z) = ${fracH(polyH(A.mB.nT), polyH(A.mB.ch))}`],
  ], closed(A.mB, p.B, A.mB.nT).concat([[`K${S("d")} · K${S("d,max")} (txt)`, `${KD} s<sup>−1</sup> · ${p.B.Kdmax}`]]),
  { poles: A.mB.poles, zeros: A.mB.zeros, ghost: A.mB.olPoles },
  "The double pole at z = 1 (integrator + position) is pulled inside the circle by the K_d G_x term (the radar's Δv path); the D term adds damping on top.");

  const r5 = row(5, `Architecture A (initial design, rejected)`, [
    ["general", `L${S("A")}(z) = K${S("d")} C${S("v")}(z) G${S("x")}(z)${dz.replace(" · ", " ")} &nbsp;(e${S("v")} = v${S("corr")} only), &nbsp; T${S("A")}(z) = ${frac("L_A(z)", "1 + L_A(z)")}`],
    ["open loop", `L${S("A")}(z) = ${fracH(polyH(A.mA.nL), `(z − 1)<sup>2</sup>(z − ${fx(A.pf, 4)})(${polyH(A.denV)})${z3}`)}`],
    ["closed loop", `T${S("A")}(z) = ${fracH(polyH(A.mA.nT), polyH(A.mA.ch))}`],
  ], closed(A.mA, p.A, A.mA.nT), { poles: A.mA.poles, zeros: A.mA.zeros, ghost: A.mA.olPoles },
  car === "ice" ? "Without the Δv path the ICE loop has a pole outside the unit circle at every operating point, with the PI and with the PID: this is why B replaced A."
                : `Stable for the EV, but with little damping (PM ≈ ${p.A?.PM}°, PI: ${p.A?.PMpi}°): B was kept for both plants.`);
  return {
    svg: "",
    info: pick + sampling + r1 + r2 + r3 + r4 + r5 +
      `<p class="dg-caption">Physical parameters are already inside N, D, E (linearised M1 of the txt) and inside the gains; this slide
       lists only what the loop is made of: poles, zeros, gains and the sampling. Numbers are computed here from N, D, E, q₀, q₁
       (ZOH by matrix exponential, roots by Durand–Kerner) and match the b, a coefficients of the txt.</p>`,
    live(s2) { if (opMode === "auto" && s2 && `${car}:${s2.op.v0}` !== tfShown) render(); },
  };
}

// ============================================================================ page
let current = null;

export function initDiagrams(a) {
  api = a;
  try {
    const st = JSON.parse(localStorage.getItem("ktrl.diagrams") || "{}");
    slide = st.slide ?? 0; car = st.car ?? "ev"; opMode = st.op ?? "auto"; form = st.form ?? "full"; plantOpen = !!st.plant;
    if (!(slide >= 0 && slide < SLIDES.length)) slide = 0;
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
  // mesh tabs: click the plant block (or its pill / the close button) to open or close it
  $("dg-svg").addEventListener("click", (e) => {
    if (!e.target.closest("[data-plant]")) return;
    plantOpen = !plantOpen; plantScroll = plantOpen; save(); render();
  });
  // transfer-function tab: linearization chips
  $("dg-info").addEventListener("click", (e) => {
    const b = e.target.closest("[data-op]");
    if (!b) return;
    opMode = b.dataset.op; save(); render();
  });
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
    if ((e.key === "p" || e.key === "P") && /^mesh/.test(SLIDES[slide].key)) { plantOpen = !plantOpen; plantScroll = plantOpen; save(); render(); }
  });
  render();
}
function save() { try { localStorage.setItem("ktrl.diagrams", JSON.stringify({ slide, car, op: opMode, form, plant: plantOpen })); } catch { /* */ } }
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
  const builder = { overview, mesh1, mesh2, tf: tfSlide, arch_a: archA, switch: switching, sampled, points }[S.key];
  zpId = 0;
  current = builder();
  $("dg-svg").innerHTML = current.svg;
  $("dg-info").innerHTML = current.info || "";
  current.after?.();
  if (plantScroll) {
    plantScroll = false;
    $("dg-svg").querySelector(".dg-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
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
