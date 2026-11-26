// physics.js - the Physics window: the mathematical models of both plants
// exactly as in the model file (sections 1-4, 6, 9, 10), one chapter per
// physical component, each with a live cutaway 3D model, the phenomenon, the
// equations, the parameters, the dynamics and a live nonlinear simulation of
// the plant (with its lower-level controller or with direct inputs).

import { M4, Renderer, lin, planeGeo } from "./gl3d.js";
import { buildRigs, makeCtx } from "./phys3d.js";

const $ = (id) => document.getElementById(id);
const PI = Math.PI, TAU = 2 * PI, g0 = 9.81;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ============================================================================ TeX-lite
const GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", eta: "η", theta: "θ", lambda: "λ", mu: "μ",
  pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", Phi: "Φ", omega: "ω", Omega: "Ω", Gamma: "Γ" };
const SYM = { cdot: "·", times: "×", le: "≤", ge: "≥", to: "→", approx: "≈", infty: "∞", pm: "±", lt: "&lt;", gt: "&gt;",
  int: "∫", partial: "∂", sum: "Σ", neq: "≠", propto: "∝", Rightarrow: "⇒", ldots: "…", quad: "<span class='q'></span>",
  ",": "<span class='tq'></span>", "{": "{", "}": "}", "|": "‖", deg: "°", qquad: "<span class='q'></span><span class='q'></span>", in: "∈", notin: "∉", cdots: "⋯" };
const FN = new Set(["sin", "cos", "arccos", "min", "max", "exp", "sign", "sat", "ln", "Int"]);
export function tex(s) {
  let i = 0, depth = 0;
  const group = () => {
    while (s[i] === " ") i++;
    if (s[i] === "{") { i++; const o = seq("}"); i++; return o; }
    return item();
  };
  const raw = () => { if (s[i] !== "{") return ""; let d = 0, o = ""; i++; while (i < s.length && !(s[i] === "}" && d === 0)) { if (s[i] === "{") d++; if (s[i] === "}") d--; o += s[i++]; } i++; return o; };
  const seq = (end) => { let o = ""; while (i < s.length && s[i] !== end) o += item(); return o; };
  const item = () => {
    const c = s[i];
    if (c === "\\") {
      i++;
      let name = "";
      if (/[A-Za-z]/.test(s[i])) while (i < s.length && /[A-Za-z]/.test(s[i])) name += s[i++];
      else name = s[i++];
      if (name === "frac") { const a = group(), b = group(); return `<span class="fr"><span>${a}</span><span>${b}</span></span>`; }
      if (name === "sqrt") return `<span class="sqr">√<span class="sq">${group()}</span></span>`;
      if (name === "dot") return `<span class="dt">${group()}</span>`;
      if (name === "bar") return `<span class="ov">${group()}</span>`;
      if (name === "text") return `<span class="tx">${raw()}</span>`;
      if (name === "left" || name === "right") return "";
      if (name === "big") { const d = s[i++]; return `<span class="bg">${d}</span>`; }
      if (GREEK[name]) return name[0] === name[0].toUpperCase() ? GREEK[name] : `<i>${GREEK[name]}</i>`;
      if (SYM[name] !== undefined) return SYM[name];
      if (FN.has(name)) return `<span class="fn">${name}</span>`;
      return name;
    }
    if (c === "_" || c === "^") {
      i++; depth++;
      const o = group(); depth--;
      return c === "_" ? `<sub>${o}</sub>` : `<sup>${o}</sup>`;
    }
    if (c === "{") { i++; const o = seq("}"); i++; return o; }
    if (/[A-Za-z]/.test(c)) {
      let w = "";
      while (i < s.length && /[A-Za-z]/.test(s[i])) w += s[i++];
      return depth > 0 && w.length > 1 ? `<span class="tx">${w}</span>` : `<i>${w}</i>`;
    }
    i++;
    if (c === "-") return "−";
    if (c === "=" || c === "+" || c === "−") return `<span class="op">${c}</span>`;
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    if (c === "&") return "&amp;";
    if (c === "~") return "&nbsp;";
    return c;
  };
  return seq(undefined);
}
const T = tex;
const eq = (s, n = "") => `<div class="ph-eq"><span class="m">${tex(s)}</span>${n ? `<b>(${n})</b>` : ""}</div>`;
const tbl = (rows, head = ["Symbol", "Value", "Unit", "Note"]) =>
  `<table class="ph-tab"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td>${k === 0 ? tex(c) : c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const chain = (blocks) => `<div class="ph-chain">${blocks.map((b, i) => (i ? '<span class="ar">→</span>' : "") + `<div class="bk${b.cls ? " " + b.cls : ""}"><small>${b.t}</small>${tex(b.m)}</div>`).join("")}</div>`;

// ============================================================================ plant constants (model file §1-§4)
const BODY = { m: 1940, rw: 0.3, Ad: 2.4, Cx: 0.5, Cr: 0.0155, rho: 1.225 };
BODY.ca = 0.5 * BODY.rho * BODY.Cx * BODY.Ad;              // 0.735
BODY.Rx = BODY.Cr * BODY.m * g0;                           // 294.99
const FBMAX = 0.8 * BODY.m * g0, THB = 0.07, TAUB = 0.08;
const ICE = (() => {
  const c = { patm: 101325, Tatm: 288.15, Rair: 287, rc: 0.528, Phimax: 0.68473, rth: 0.025, Cdth: 0.8, Vd: 2.5e-3, etav: 0.85,
    BMEP: 10e5, T0: 15, cw: 0.048, wref: 3000 * TAU / 60, the: 0.06, i: 4.1, eta: 0.92, Iet: 0.2, Iw: 4.0 };
  c.Amax = PI * c.rth ** 2; c.Vm = 1.5 * c.Vd; c.Tm = c.Tatm; c.G = c.i / BODY.rw;
  c.meff = BODY.m + c.Iet * c.G ** 2 + c.Iw / BODY.rw ** 2;
  c.K1 = c.Rair * c.Tm / c.Vm;
  c.K2 = c.Cdth * c.Amax * c.patm / Math.sqrt(c.Rair * c.Tatm);
  c.K3 = c.etav * c.Vd * c.G / (4 * PI * c.Rair * c.Tm);
  c.kT = (c.BMEP * c.Vd / (4 * PI) + c.T0 + c.cw * c.wref) / c.patm;
  c.vmin = 1000 * TAU / 60 / c.G; c.vmax = 6500 * TAU / 60 / c.G;
  return c;
})();
const EV = (() => {
  const c = { Vbat: 400, Ra: 0.05, La: 1e-3, ke: 0.25, kt: 0.25, Jm: 0.2, i: 10, eta: 0.95, imax: 400, Pmax: 120e3, wci: 600 };
  c.G = c.i / BODY.rw; c.meff = BODY.m + c.Jm * c.G ** 2; c.Kpi = c.La * c.wci; c.Kii = c.Ra * c.wci;
  return c;
})();
const Phi = (r) => { r = clamp(r, 0, 1); return r > ICE.rc ? Math.sqrt(Math.max(0, 7 * (r ** (2 / 1.4) - r ** (2.4 / 1.4)))) : ICE.Phimax; };
const Tloss = (we) => ICE.T0 + ICE.cw * we;
const Fres = (v, beta = 0) => BODY.ca * v * Math.abs(v) + BODY.Rx * Math.cos(beta) * Math.sign(v) + BODY.m * g0 * Math.sin(beta);
const ilim = (v) => { const w = EV.G * Math.abs(v); return w < 1e-6 ? EV.imax : Math.min(EV.imax, EV.Pmax / (EV.kt * w)); };
const FtEV = (i) => (i >= 0 ? EV.eta * EV.G * EV.kt * i : EV.G * EV.kt * i / EV.eta);

// ============================================================================ simulation
class Delay {
  constructor(n, v = 0) { this.b = new Float64Array(Math.max(1, n)).fill(v); this.k = 0; }
  push(x) { const y = this.b[this.k]; this.b[this.k] = x; this.k = (this.k + 1) % this.b.length; return y; }
  fill(v) { this.b.fill(v); }
}
export class Sim {
  constructor(plant) {
    this.plant = plant; this.mode = "ades"; this.ades = 0; this.theta = 0.3; this.D = 0.4; this.FbcmdIn = 0; this.beta = 0;
    this.dt = plant === "ice" ? 5e-4 : 2e-4;
    this.dTe = new Delay(Math.round(ICE.the / 5e-4));
    this.dFb = new Delay(Math.round(THB / this.dt));
    this.hist = [];
    this.trim(plant === "ice" ? 20 : 20);
  }
  trim(v0) {
    const s = this.s = { v: v0, x: 0, Fb: 0, a: 0, t: 0, clutch: true, I: 0 };
    this.ades = 0; this.FbcmdIn = 0;
    if (this.plant === "ice") {
      v0 = Math.max(v0, ICE.vmin + 0.2); s.v = v0;
      const F = Fres(v0), Te = F / (ICE.G * ICE.eta);
      s.pm = (Te + Tloss(ICE.G * v0)) / ICE.kT;
      const mth = ICE.K3 * s.pm * v0;
      this.theta = Math.acos(1 - clamp(mth / (ICE.K2 * Phi(s.pm / ICE.patm)), 0, 1));
      this.dTe.fill(Te);
    } else {
      const F = Fres(v0);
      s.ia = F / (EV.eta * EV.G * EV.kt);
      this.D = (EV.Ra * s.ia + EV.ke * EV.G * v0) / EV.Vbat;
      s.I = EV.Ra * s.ia;
    }
    this.dFb.fill(0);
    this.hist = [];
    this.derive(this.plant === "ice" ? this.theta : this.D, 0);
  }
  // one integration step (Euler, as in §5)
  step() {
    const s = this.s, dt = this.dt, b = this.beta;
    let Fbcmd;
    if (this.plant === "ice") {
      const we = ICE.G * s.v;
      if (s.clutch && s.v < ICE.vmin) s.clutch = false;
      if (!s.clutch && s.v > ICE.vmin + 0.3) s.clutch = true;           // demo: re-engage above v_min
      let th = this.theta;
      if (this.mode === "ades") {
        const Fdes = ICE.meff * this.ades + BODY.ca * s.v * s.v + BODY.Rx;
        const Fmin = -ICE.G * Tloss(we) / ICE.eta;
        s.Fdes = Fdes; s.Fmin = Fmin;
        if (!s.clutch) { th = 0; Fbcmd = clamp(-Fdes, 0, FBMAX); s.pdes = 0; }
        else if (Fdes >= Fmin) {
          const Tdes = Fdes >= 0 ? Fdes / (ICE.G * ICE.eta) : Fdes * ICE.eta / ICE.G;
          const pdes = clamp((Tdes + Tloss(we)) / ICE.kT, 0, ICE.patm);
          const mdes = ICE.K3 * pdes * s.v, ph = Phi(s.pm / ICE.patm);
          const arg = ph < 1e-9 ? 1 : mdes / (ICE.K2 * ph);
          th = Math.acos(1 - clamp(arg, 0, 1)); Fbcmd = 0; s.pdes = pdes;
        } else { th = 0; Fbcmd = Math.min(Fmin - Fdes, FBMAX); s.pdes = 0; }
        this.theta = th;
      } else Fbcmd = this.FbcmdIn;
      const r = clamp(s.pm / ICE.patm, 0, 1);
      const mth = ICE.K2 * (1 - Math.cos(th)) * Phi(r), mcyl = ICE.K3 * s.pm * Math.max(s.v, 0);
      let Te = ICE.kT * s.pm - Tloss(we);
      if (s.v > ICE.vmax) Te = -Tloss(we);
      const Teff = this.dTe.push(Te);
      const Ft = !s.clutch ? 0 : Teff >= 0 ? ICE.eta * ICE.G * Teff : ICE.G * Teff / ICE.eta;
      const Fbd = this.dFb.push(Fbcmd);
      const net = Ft - s.Fb - Fres(s.v, b);
      let a = net / ICE.meff;
      if (s.v <= 0 && a < 0) { a = 0; s.v = 0; }
      s.pm = clamp(s.pm + (s.clutch ? ICE.K1 * (mth - mcyl) : 0) * dt, 0, ICE.patm);
      s.v = Math.max(0, s.v + a * dt); s.x += s.v * dt;
      s.Fb = clamp(s.Fb + (Fbd - s.Fb) / TAUB * dt, 0, FBMAX);
      s.a = a; s.Fbcmd = Fbcmd; s.t += dt;
      Object.assign(s, { theta: th, mth, mcyl, Te, Teff, Ft, we, r });
    } else {
      const wm = EV.G * s.v;
      let D = this.D;
      if (this.mode === "ades") {
        const Fdes = EV.meff * this.ades + BODY.ca * s.v * s.v + BODY.Rx;
        const iref = Fdes >= 0 ? Fdes / (EV.eta * EV.G * EV.kt) : Fdes * EV.eta / (EV.G * EV.kt);
        const il = ilim(s.v), irs = clamp(iref, -il, il);
        Fbcmd = clamp(FtEV(irs) - Fdes, 0, FBMAX);
        const e = irs - s.ia;
        const Vc = EV.ke * wm + EV.Kpi * e + s.I;
        D = clamp(Vc / EV.Vbat, 0, 1);
        if (D > 0 && D < 1) s.I += EV.Kii * e * dt;                   // anti-windup
        Object.assign(s, { Fdes, iref: irs, ilim: il });
        this.D = D;
      } else { Fbcmd = this.FbcmdIn; s.iref = null; s.ilim = ilim(s.v); }
      const Vc = D * EV.Vbat;
      const dia = (Vc - EV.Ra * s.ia - EV.ke * wm) / EV.La;
      const Ft = FtEV(s.ia);
      const Fbd = this.dFb.push(Fbcmd);
      let a = (Ft - s.Fb - Fres(s.v, b)) / EV.meff;
      if (s.v <= 0 && a < 0) { a = 0; s.v = 0; }
      s.ia += dia * dt;
      s.v = Math.max(0, s.v + a * dt); s.x += s.v * dt;
      s.Fb = clamp(s.Fb + (Fbd - s.Fb) / TAUB * dt, 0, FBMAX);
      s.a = a; s.Fbcmd = Fbcmd; s.t += dt;
      Object.assign(s, { D, Vc, Ft, wm });
    }
  }
  derive() {
    const s = this.s;
    if (this.plant === "ice") {
      s.we = ICE.G * s.v; s.r = clamp(s.pm / ICE.patm, 0, 1); s.phi = Phi(s.r); s.choked = s.r <= ICE.rc;
      s.theta = s.theta ?? this.theta;
      s.mth = ICE.K2 * (1 - Math.cos(this.theta)) * s.phi; s.mcyl = ICE.K3 * s.pm * s.v;
      s.Te = s.Te ?? ICE.kT * s.pm - Tloss(s.we); s.Tloss = Tloss(s.we);
      s.Ft = s.Ft ?? ICE.eta * ICE.G * s.Te;
      s.taum = s.v > 0.1 ? 1 / (ICE.K1 * ICE.K3 * s.v) : Infinity;
    } else {
      s.wm = EV.G * s.v; s.D = this.D; s.Vc = this.D * EV.Vbat; s.Te = EV.kt * s.ia; s.Ft = FtEV(s.ia);
      s.emf = EV.ke * s.wm; s.ibat = s.D * s.ia; s.Pel = s.Vc * s.ia; s.Pj = EV.Ra * s.ia * s.ia; s.Pmech = s.emf * s.ia;
      s.regen = s.ia < 0; s.ilim = ilim(s.v);
    }
    s.Faero = BODY.ca * s.v * Math.abs(s.v); s.Froll = BODY.Rx * Math.cos(this.beta); s.Fgrade = BODY.m * g0 * Math.sin(this.beta);
    s.Fres = s.Faero + s.Froll + s.Fgrade; s.beta = this.beta;
    s.Fbcmd = s.Fbcmd ?? 0;
  }
  run(T) {
    const n = Math.min(4000, Math.round(T / this.dt));
    for (let k = 0; k < n; k++) this.step();
    this.derive();
    const s = this.s;
    if (!this.hist.length || s.t - this.hist[this.hist.length - 1].t > 0.05) {
      this.hist.push({ t: s.t, v: s.v, a: s.a, y: this.plant === "ice" ? s.pm / 1000 : s.ia });
      while (this.hist.length && s.t - this.hist[0].t > 30) this.hist.shift();
    }
  }
}

// ============================================================================ chapters (text)
const P = (s) => `<p>${s}</p>`;
const H = (s) => `<h3>${s}</h3>`;
const note = (s) => `<div class="ph-note">${s}</div>`;
const iceEq = {
  v: `v \\in [v_{min}, v_{max}] = [7.66, 49.81]~\\text{m/s}`,
};
const BODY_TXT = (plant) => {
  const me = plant === "ice" ? "2021.8" : "2162.2";
  return H("Physical phenomenon") +
    P("Newton's second law along the road. The traction force at the tyre contact patches drives the car; it is opposed by the aerodynamic drag (quadratic in speed), the rolling resistance of the tyres (constant on a flat road) and, on a slope, the weight component along the road. The friction brakes add a force opposing the motion. The rotating parts are lumped into an <b>effective mass</b>.") +
    H("Model (§1, common to both plants)") +
    eq(`m_{eff}\\dot v = F_t - F_b - c_a v|v| - C_r m g\\cos\\beta~\\sign(v) - m g\\sin\\beta`, "B1") +
    eq(`c_a = \\frac{1}{2}\\rho C_x A_d = 0.735~\\text{kg/m}\\quad R_x = C_r m g = 294.99~\\text{N}`, "B2") +
    eq(`F_{res}(v) = 0.735 v^2 + 294.99~\\text{N}~~(\\text{flat}, v > 0)`, "B3") +
    eq(`\\dot x = v`, "B4") +
    H("Parameters (Diba, Table 1 — the same body for both plants)") +
    tbl([["m", "1940", "kg", "mass"], ["r_w", "0.3", "m", "wheel radius"], ["A_d", "2.4", "m²", "frontal area"], ["C_x", "0.5", "–", "drag coefficient"],
      ["C_r", "0.0155", "–", "rolling coefficient"], ["\\rho", "1.225", "kg/m³", "air density"], ["\\beta", "0", "rad", "slope (disturbance, &gt; 0 uphill)"],
      ["m_{eff}", me, "kg", plant === "ice" ? "m + (I_e+I_t)G² + I_w/r_w²" : "m + J_m G²"]]) +
    H("Numbers") +
    P(`At 30 m/s: ${T("F_{res}")} = 956.5 N (aero 661.5 + rolling 295.0), i.e. 28.69 kW at the wheels — identical to Table 6 of the PDF.`) +
    tbl(plant === "ice"
      ? [["v = 10", "1.106 (0.113 g)", "−0.34", ""], ["v = 20", "0.951 (0.097 g)", "−0.50", ""], ["v = 30", "0.719 (0.073 g)", "−0.73", ""], ["v = 40", "0.411 (0.042 g)", "−1.03", ""]]
      : [["v = 10", "1.294 (0.132 g)", "−1.79", "current limit"], ["v = 20", "1.192 (0.122 g)", "−1.90", ""], ["v = 30", "1.022 (0.104 g)", "−2.07", ""], ["v = 40", "0.638 (0.065 g)", "−2.14", "power limit"]],
    ["Speed [m/s]", "a<sub>max</sub> [m/s²]", plant === "ice" ? "engine brake [m/s²]" : "regen [m/s²]", ""]) +
    note(`<b>+0.25 g is unreachable</b> by both vehicles (O1): at 30 m/s it needs 177 kW (ICE) / 188 kW (EV) at the wheels, above P<sub>max</sub> = 120 kW. S1 and S4 saturate and the anti-windup works.`) +
    H("Dynamics") +
    P(`Linearised around v<sub>0</sub>, the drag gives the mechanical pole ${T("-2c_a v_0/m_{eff}")} (−0.0204 s⁻¹ at 30 m/s for the EV): the car alone is a very slow integrator-like system; everything fast happens in the powertrain.`);
};
const BRAKE_TXT = (plant) => H("Physical phenomenon") +
  P("Hydraulic disc brakes: the pedal (here the lower-level command) builds pressure in the line, the caliper pistons clamp the pads on the rotating disc and friction converts kinetic energy into heat. The hydraulic transmission has a pure delay and a first-order lag; the force is bounded by tyre adhesion.") +
  H("Model (§2, common)") +
  eq(`\\dot F_b = \\frac{F_{b,cmd}(t - \\theta_b) - F_b}{\\tau_b}`, "F1") +
  eq(`\\theta_b = 70~\\text{ms}\\quad\\tau_b = 80~\\text{ms}\\quad 0 \\le F_b \\le F_{b,max} = 0.8 m g = 15225~\\text{N}`, "F2") +
  P(`The delay is a circular buffer of ${plant === "ice" ? "140 samples at 0.5 ms" : "350 samples at 0.2 ms"}, initialised at the equilibrium value. Maximum brake torque ${T("T_{br,max} = 4568")} N·m.`) +
  H(plant === "ice" ? "Blending with the engine brake" : "Blending with regeneration") +
  (plant === "ice"
    ? P(`Closed throttle gives the engine-brake force ${T("F_{min} = -G T_{loss}(\\omega_e)/\\eta_t")} ≈ −515 N at 30 m/s. Below that the friction brake adds ${T("F_{b,cmd} = F_{min} - F_{des}")}. Threshold at 30 m/s: |a<sub>des</sub>| &gt; 0.074 g.`) +
      tbl([["a_{des} = -0.5g", "8445 N", "", "engine brake 515 N + friction"], ["a_{des} = -0.3g", "4479 N", "", ""], ["a_{des} = -0.1g", "512 N", "", ""], ["a_{des} = -0.05g", "0", "", "engine brake only"]], ["Demand at 30 m/s", "F<sub>b</sub>", "", ""])
    : P(`Regeneration first, friction for the rest: ${T("F_{b,cmd} = \\min(\\max(F_t(i_{ref,s}) - F_{des}, 0), F_{b,max})")}. Maximum regeneration 3509 N (−2.07 m/s² at 30 m/s), so friction is needed above |a<sub>des</sub>| = 0.21 g.`) +
      tbl([["a_{des} = -0.5g", "6140 N", "regen 3509 N", ""], ["a_{des} = -0.3g", "1898 N", "regen 3509 N", ""], ["a_{des} = -0.2g", "0", "regen 3286 N", "regen only"]], ["Demand at 30 m/s", "F<sub>b</sub>", "", ""])) +
  note("Emergency stop −0.5 g from 30 m/s: the EV reaches −2.95 m/s² after 0.1 s (regeneration is immediate, 1.6 ms) while the ICE is at −1.67 m/s² (waiting for the 70 + 80 ms hydraulics). Both settle at −4.89 m/s² (O3).");

const CH = {
  ice: [
    { id: "overview", name: "Overview", rig: "sysIce", title: "Petrol engine + vehicle", sub: "Thermal plant · model file §3",
      live: ["v", "a", "theta", "pm", "we", "Te", "Ft", "Fb", "clutch"], plot: "histIce",
      html: () => P("Air passes the throttle, fills the intake manifold and is pumped by the cylinders; the burnt air–fuel mixture produces a crankshaft torque proportional to the manifold pressure. The torque reaches the wheels through the gearbox and final drive, and moves the car against drag, rolling resistance and slope. Friction brakes complete it.") +
        chain([{ t: "input", m: "\\theta_{th}", cls: "in" }, { t: "throttle", m: "\\dot m_{th}" }, { t: "manifold", m: "p_m" }, { t: "cylinders", m: "\\dot m_{cyl}, T_e" }, { t: "delay 60 ms", m: "T_{e,eff}" }, { t: "gearbox", m: "F_t" }, { t: "body", m: "v, x", cls: "out" }]) +
        chain([{ t: "input", m: "F_{b,cmd}", cls: "in" }, { t: "70 ms + 80 ms", m: "F_b" }, { t: "body", m: "v", cls: "out" }]) +
        H("States and inputs") + P(`States ${T("p_m, v, x, F_b")} · inputs ${T("\\theta_{th}")} (throttle angle) and ${T("F_{b,cmd}")} (brakes).`) +
        H("Differential system (§3.5)") +
        eq(`\\dot p_m = K_1\\big[K_2(1-\\cos\\theta_{th})\\Phi(p_m/p_{atm}) - K_3 p_m v\\big]`, "E1") +
        eq(`m_{eff}\\dot v = F_t - F_b - c_a v|v| - C_r m g\\cos\\beta~\\sign(v) - m g\\sin\\beta`, "E2") +
        eq(`\\dot x = v\\qquad\\dot F_b = \\frac{F_{b,cmd}(t-\\theta_b) - F_b}{\\tau_b}`, "E3") +
        P("Numerical form (flat road, traction, v &gt; 0):") +
        eq(`\\dot p_m = 1.2206\\cdot10^7(1-\\cos\\theta_{th})\\Phi - 0.61628~p_m v~~[\\text{Pa/s}]`) +
        eq(`\\dot v = 1.4056\\cdot10^{-5}p_m(t-0.06) - 4.080\\cdot10^{-3}v - 3.6354\\cdot10^{-4}v^2 - 0.23918 - \\frac{F_b}{2021.8}`) +
        H("Dynamics (§6.4, §10.5)") +
        tbl([["v = 10", "−6.13", "−0.043", "162 ms"], ["v = 20", "−12.30", "−0.042", "81 ms"], ["v = 30", "−18.47", "−0.049", "54 ms"], ["v = 40", "−38.63", "−0.049", "41 ms"]], ["Speed [m/s]", "fast (manifold) [s⁻¹]", "slow (vehicle) [s⁻¹]", "τ<sub>m</sub>"]) +
        P(`Seen by the upper controller through the lower level: ${T("A_{IC}(s) = \\frac{e^{-0.06s}}{\\tau_m(v_0)s + 1}")}, ${T("\\tau_m = 1/(K_1K_3v)")}.`) +
        H("Domain") + P(`${T("v \\in [7.66, 49.81]")} m/s ↔ 1000–6500 rpm with the clutch closed. Below ${T("v_{min}")} the clutch opens: ${T("F_t = 0")}, brakes only (restart not modelled).`) +
        note("Click a component in the 3D view (or use the tabs / ← →) to open its chapter. The explode slider separates the parts.") },
    { id: "throttle", name: "Throttle", rig: "throttle", title: "Throttle body", sub: "Compressible flow through a restriction · §3.4 (1)–(4)",
      live: ["theta", "Ath", "r", "phi", "regime", "mth", "pm"], plot: "phi",
      html: () => H("Physical phenomenon") +
        P("The butterfly valve sets the open area of the 50 mm bore. Air expands isentropically from the atmosphere into the manifold. As long as the manifold pressure is high the flow is <b>subsonic</b> and depends on both pressures; when p<sub>m</sub>/p<sub>atm</sub> drops below the critical ratio 0.528 the throat reaches the speed of sound and the flow is <b>choked</b>: it no longer depends on the downstream pressure.") +
        H("Model") +
        eq(`A_{th}(\\theta_{th}) = \\pi r_{th}^2(1 - \\cos\\theta_{th})`, "1") +
        eq(`r = \\min(\\max(p_m/p_{atm}, 0), 1)`, "2") +
        eq(`\\Phi(r) = \\sqrt{\\frac{2\\gamma}{\\gamma-1}\\big(r^{2/\\gamma} - r^{(\\gamma+1)/\\gamma}\\big)} = \\sqrt{7(r^{1.4286} - r^{1.7143})}~~~r > r_c`, "3") +
        eq(`\\Phi(r) = \\Phi_{max} = 0.68473~~~r \\le r_c = 0.528~~(\\text{choked})`, "3'") +
        eq(`\\dot m_{th} = K_2(1 - \\cos\\theta_{th})\\Phi(r)\\qquad K_2 = \\frac{C_{d,th}A_{max}p_{atm}}{\\sqrt{R T_{atm}}} = 0.55346~\\text{kg/s}`, "4") +
        P("The two branches join smoothly at r<sub>c</sub> (Φ(0.528) = 0.68473 on both sides)."). concat(
        H("Parameters")) +
        tbl([["D_{th}", "50", "mm", "bore"], ["C_{d,th}", "0.8", "–", "discharge coefficient"], ["A_{max}", "1.9635·10⁻³", "m²", "π r<sub>th</sub>²"],
          ["p_{atm}", "101325", "Pa", "ISA"], ["T_{atm}", "288.15", "K", "ISA"], ["R", "287", "J/(kg·K)", "air"], ["\\gamma", "1.4", "–", ""]]) +
        H("Linearisation (§10.5)") +
        eq(`\\frac{\\partial f_1}{\\partial\\theta_{th}} = K_1K_2\\sin\\theta_{th,0}\\Phi(r_0)`, "L1") +
        P("= 1.516·10⁶ (10 m/s), 2.582·10⁶ (20), 3.784·10⁶ (30), 4.911·10⁶ Pa/(s·rad) (40). The slope of Φ is zero while choked (v &lt; 32.4 m/s at equilibrium).") +
        note("Validity: always clamp r to [0, 1] before Φ. Φ(1) = 0 with an infinite slope, so the model is initialised at equilibrium, never at p<sub>m</sub> = p<sub>atm</sub>.") },
    { id: "manifold", name: "Manifold", rig: "manifold", title: "Intake manifold", sub: "Isothermal filling and emptying · §3.4–3.5",
      live: ["pm", "r", "mth", "mcyl", "dpm", "taum", "theta"], plot: "taum",
      html: () => H("Physical phenomenon") +
        P("The plenum is a fixed volume of air at the temperature of the atmosphere (isothermal). Its mass changes with the inflow through the throttle and the outflow drawn by the cylinders; by the ideal-gas law the pressure follows the mass. This is a first-order filling dynamic — the main lag of the petrol engine.") +
        H("Model") +
        eq(`p_m V_m = M R T_m\\quad\\Rightarrow\\quad\\dot p_m = \\frac{R T_m}{V_m}\\big(\\dot m_{th} - \\dot m_{cyl}\\big)`, "M1") +
        eq(`K_1 = \\frac{R T_m}{V_m} = 2.2053\\cdot10^7~\\text{Pa/kg}`, "M2") +
        eq(`\\dot m_{cyl} = K_3 p_m v\\quad\\Rightarrow\\quad\\dot p_m = K_1\\big[K_2(1-\\cos\\theta_{th})\\Phi(r) - K_3 p_m v\\big]`, "E1") +
        H("Parameters") +
        tbl([["V_m", "3.75", "L", "1.5 V<sub>d</sub>"], ["T_m", "288.15", "K", "isothermal"], ["K_1", "2.2053·10⁷", "Pa/kg", ""], ["K_3", "2.7946·10⁻⁸", "kg/(Pa·m)", "see engine"]]) +
        H("Dynamics") +
        P(`With the throttle choked, the only pressure-dependent term is the cylinder pumping, so the manifold is a first-order system with ${T("\\tau_m(v) = \\frac{1}{K_1K_3v}")}: faster at high speed because the engine pumps more air per second.`) +
        tbl([["10", "22.51 kPa", "10.5°", "162 ms"], ["20", "33.17 kPa", "18.0°", "81 ms"], ["30", "49.00 kPa", "26.9°", "54 ms"], ["40", "70.01 kPa", "38.7°", "41 ms"]], ["v [m/s]", "p<sub>m</sub> trim", "θ<sub>th</sub> trim", "τ<sub>m</sub>"]) +
        P("The lower level (§3.7) inverts the chain so that p<sub>m</sub> follows p<sub>des</sub> exactly with this time constant, at every speed (also above r<sub>c</sub>, O6).") +
        note("Try it: in “θ<sub>th</sub> direct” mode, step the throttle and watch p<sub>m</sub> settle in ≈ 3τ<sub>m</sub>.") },
    { id: "engine", name: "Engine", rig: "engine", title: "Cylinders and crankshaft", sub: "Speed-density pumping and Willans torque · §3.4 (5)–(8)",
      live: ["we", "pm", "mcyl", "Te", "Tloss", "Teff", "clutch"], plot: "torque",
      html: () => H("Physical phenomenon") +
        P("Each cylinder breathes a volume V<sub>d</sub>/4 every two crank revolutions at the manifold density (speed-density). The torque produced by combustion is proportional to the air mass per cycle, i.e. to p<sub>m</sub> (Willans line); friction, pumping and accessories subtract a loss growing with the engine speed. With the throttle closed the net torque is negative: <b>engine braking</b>. Combustion takes time to reach the crankshaft: a 60 ms pure delay.") +
        H("Model") +
        eq(`\\omega_e = G v\\qquad G = i/r_w = 13.6667~\\text{m}^{-1}`, "5") +
        eq(`\\dot m_{cyl} = \\frac{\\eta_v V_d\\omega_e}{4\\pi R T_m}p_m = K_3 p_m v\\qquad K_3 = 2.7946\\cdot10^{-8}`, "6") +
        eq(`T_e = k_T p_m - T_{loss}(\\omega_e)\\qquad T_{loss} = T_0 + c_w\\omega_e`, "7") +
        eq(`k_T = \\frac{BMEP_{max}V_d/(4\\pi) + T_0 + c_w\\omega_{ref}}{p_{atm}} = 2.2603\\cdot10^{-3}~\\text{N·m/Pa}`, "7'") +
        eq(`T_{e,eff}(t) = T_e(t - \\theta_e)\\qquad\\theta_e = 60~\\text{ms}`, "8") +
        H("Parameters (2.5 L naturally aspirated, [Est])") +
        tbl([["V_d", "2.5", "L", ""], ["\\eta_v", "0.85", "–", "volumetric efficiency"], ["BMEP_{max}", "10", "bar", "at 3000 rpm"], ["T_0", "15", "N·m", "constant loss"],
          ["c_w", "0.048", "N·m·s/rad", "speed loss"], ["\\theta_e", "60", "ms", "torque delay"], ["\\omega_e", "1000–6500", "rpm", "7.66–49.81 m/s"]]) +
        H("Numbers (§6.1)") +
        tbl([["1000", "209.0", "−20.0"], ["2000", "204.0", "−25.1"], ["3000", "198.9", "−30.1"], ["4000", "193.9", "−35.1"], ["5000", "188.9", "−40.1"], ["6500", "181.4", "−47.7"]], ["rpm", "full load [N·m]", "closed throttle [N·m]"]) +
        P("Peak net torque 198.9 N·m (the PDF estimate of 250 N·m is not reachable at 10 bar with η<sub>v</sub> = 0.85: it would need a 45 % gross efficiency). Check: 2.604 g of air per cycle, 7793 J of fuel energy, 2878 J of gross work → 0.369 indicated efficiency, plausible.") +
        note("The 3D animation runs at 1/40 of the real crank speed; the spark and combustion glow follow the 1-3-4-2 firing order.") },
    { id: "gearbox", name: "Transmission", rig: "gearbox", title: "Gearbox, final drive, differential", sub: "Rigid reduction with direction-dependent losses · §3.2, §3.4 (9)",
      live: ["we", "wwheel", "Teff", "Ft", "v", "clutch"], plot: "envIce",
      html: () => H("Physical phenomenon") +
        P("The clutch is closed and the transmission is rigid: engine speed and car speed are tied by the total ratio. Gear losses depend on the direction of the power flow — when the engine drives, the losses reduce the force at the wheels; when the wheels drive the engine (engine braking) the losses add to the retarding force. The rotating inertias of the engine, gearbox and wheels are reflected to the car as an extra mass.") +
        H("Model") +
        eq(`\\omega_e = G v\\qquad G = \\frac{i}{r_w} = \\frac{4.1}{0.3}`, "T1") +
        eq(`F_t = \\eta_t G T_{e,eff}~~~(T_{e,eff} \\ge 0)\\qquad F_t = \\frac{G T_{e,eff}}{\\eta_t}~~~(T_{e,eff} < 0)`, "9") +
        eq(`m_{eff} = m + (I_e + I_t)G^2 + \\frac{I_w}{r_w^2} = 1940 + 37.36 + 44.44 = 2021.8~\\text{kg}`, "T2") +
        H("Parameters") +
        tbl([["i", "4.1", "–", "4th gear × final drive (1.21 × 3.39)"], ["\\eta_t", "0.92", "–", ""], ["I_e + I_t", "0.20", "kg·m²", "engine + gearbox"], ["I_w", "4.0", "kg·m²", "4 wheels"], ["G", "13.6667", "m⁻¹", ""]]) +
        P("Correction C3 of the model file: applying η in both directions underestimated the engine brake (and the EV regeneration) by ≈ 10 %.") +
        note("The power flow in the 3D view is green when the engine drives the car and red when the car drives the engine (engine braking).") },
    { id: "brakes", name: "Brakes", rig: "brakes", title: "Friction brakes", sub: "Hydraulic delay, lag and adhesion limit · §2", live: ["Fbcmd", "Fb", "v", "a"], plot: "brake", html: () => BRAKE_TXT("ice") },
    { id: "body", name: "Vehicle", rig: "bodyIce", title: "Vehicle body", sub: "Longitudinal dynamics · §1", live: ["v", "a", "Ft", "Fb", "Faero", "Froll", "Fgrade", "Fres"], plot: "fres", html: () => BODY_TXT("ice") },
    { id: "lower", name: "Lower level", rig: "chainIce", title: "Lower-level controller (inversion)", sub: "a_des → θ_th, F_b,cmd · §3.7, §10.7",
      live: ["ades", "Fdes", "Fmin", "pdes", "pm", "theta", "Fbcmd", "a"], plot: "histIce",
      html: () => H("Idea") +
        P("The upper controller asks for an acceleration a<sub>des</sub>. The lower level inverts the physics algebraically, block by block, to find the throttle angle (or the brake force) that produces it. What remains is the manifold lag and the torque delay.") +
        H("Inversion chain") +
        eq(`F_{des} = m_{eff}a_{des} + c_a v^2 + R_x\\qquad F_{min} = -\\frac{G T_{loss}(\\omega_e)}{\\eta_t}`, "I1") +
        eq(`T_{des} = \\frac{F_{des}}{G\\eta_t}~(F_{des}\\ge0)\\qquad T_{des} = \\frac{F_{des}\\eta_t}{G}~(F_{des}<0)`, "I2") +
        eq(`p_{des} = \\min\\big(\\max\\big(\\frac{T_{des} + T_{loss}}{k_T}, 0\\big), p_{atm}\\big)\\qquad\\dot m_{des} = K_3 p_{des} v`, "I3") +
        eq(`\\theta_{th} = \\arccos\\big(1 - \\min(\\max(\\frac{\\dot m_{des}}{K_2\\Phi(p_m/p_{atm})}, 0), 1)\\big)`, "I4") +
        eq(`F_{des} < F_{min}:\\quad\\theta_{th} = 0,~~F_{b,cmd} = \\min(F_{min} - F_{des}, F_{b,max})`, "I5") +
        H("Result") +
        eq(`\\dot p_m = K_1K_3v\\,(p_{des} - p_m)\\quad\\Rightarrow\\quad\\frac{a}{a_{des}} = A_{IC}(s) = \\frac{e^{-0.06s}}{\\tau_m(v)s + 1}`, "I6") +
        tbl([["10", "0.222 s", "0.162 s"], ["20", "0.141 s", "0.081 s"], ["30", "0.114 s", "0.054 s"], ["40", "0.100 s", "0.041 s"]], ["v₀ [m/s]", "t₆₃ (simulated)", "τ<sub>m</sub> = t₆₃ − 0.060"]) +
        P(`Linear models: plant M1 ${T("v/\\theta_{th} = 53.20/(s^2 + 18.51s + 0.9032)")} at 30 m/s; synthesis model M3 ${T("v/a_{des} = e^{-0.06s}/(s(\\tau_m s + 1))")} (Padé-1 for the delay).`) +
        note("Use the a<sub>des</sub> slider: θ<sub>th</sub> jumps immediately (algebraic), p<sub>m</sub> follows with τ<sub>m</sub>, and the car accelerates 60 ms later.") },
  ],
  ev: [
    { id: "overview", name: "Overview", rig: "sysEv", title: "DC motor + vehicle", sub: "Electric plant · model file §4",
      live: ["v", "a", "D", "Vc", "ia", "Te", "Ft", "Fb", "Pel"], plot: "histEv",
      html: () => P("A constant-voltage battery feeds a bidirectional half-bridge converter that applies the average voltage D·V<sub>bat</sub> to the armature of a permanent-magnet DC motor. The armature current makes the torque; a single reduction gear and the differential bring it to the wheels. The converter can reverse the current: the motor then brakes the car and returns energy to the battery (regeneration).") +
        chain([{ t: "input", m: "D", cls: "in" }, { t: "battery + converter", m: "V_c = D V_{bat}" }, { t: "armature", m: "i_a" }, { t: "magnets", m: "T_e = k_t i_a" }, { t: "reduction", m: "F_t" }, { t: "body", m: "v, x", cls: "out" }]) +
        chain([{ t: "feedback", m: "e = k_e G v", cls: "in" }, { t: "back-EMF", m: "-k_e\\omega_m" }, { t: "armature", m: "i_a", cls: "out" }]) +
        H("States and inputs") + P(`States ${T("i_a, v, x, F_b")} (+ the current-loop integrator) · inputs ${T("D")} (duty cycle) and ${T("F_{b,cmd}")}.`) +
        H("Differential system (§4.5)") +
        eq(`L_a\\dot i_a = D V_{bat} - R_a i_a - k_e G v`, "E1") +
        eq(`m_{eff}\\dot v = F_t(i_a) - F_b - c_a v|v| - C_r m g\\cos\\beta~\\sign(v) - m g\\sin\\beta`, "E2") +
        eq(`\\dot x = v\\qquad\\dot F_b = \\frac{F_{b,cmd}(t-\\theta_b) - F_b}{\\tau_b}`, "E3") +
        P("Numerical form (flat, v &gt; 0, traction):") +
        eq(`\\dot i_a = 4.0\\cdot10^5 D - 50 i_a - 8333.3 v\\qquad\\dot v = 3.6614\\cdot10^{-3}i_a - 3.3993\\cdot10^{-4}v^2 - 0.13643 - \\frac{F_b}{2162.2}`) +
        H("Dynamics (§6.4, §9.5)") +
        P(`At fixed D: electrical pole −49.38 s⁻¹ (≈ R<sub>a</sub>/L<sub>a</sub>) and a slow pole −0.62…−0.65 s⁻¹ created by the back-EMF coupling (30× faster than the drag alone). ${T("v/V_c = 3.6614/(s^2 + 50.02s + 31.53)")} at 30 m/s.`) +
        P(`With the current loop and the feedforward the upper controller sees ${T("A_{EV}(s) = 1/(s/600 + 1)")}, t₆₃ = 1.6 ms.`) +
        H("Domain") + P("Starts from v = 0 (ω<sub>m</sub> = 0 is not a singularity, no clutch). Maximum speed 46.6 m/s, limited by the battery voltage (no field weakening).") +
        note("Click a component in the 3D view (or use the tabs / ← →).") },
    { id: "battery", name: "Battery", rig: "battery", title: "Battery pack", sub: "Ideal voltage source · §4 hypotheses", live: ["ibat", "Pel", "Pj", "Pmech", "ia", "regen"], plot: "ilim",
      html: () => H("Physical phenomenon") +
        P("Lithium-ion cells in series and parallel deliver the DC bus voltage. Over the few tens of seconds of an ACC manoeuvre the state of charge, internal resistance and temperature barely change, so the pack is modelled as a <b>constant, ideal voltage source</b>. Its current is the motor current scaled by the duty cycle (ideal converter, power conserved).") +
        H("Model") +
        eq(`V_{bat} = 400~\\text{V}\\qquad i_{bat} = D~i_a\\qquad P_{bat} = V_{bat}i_{bat} = V_c i_a`, "B1") +
        eq(`|P| \\le P_{max} = 120~\\text{kW}~~(\\text{traction and regeneration})`, "B2") +
        H("Energy balance check (§6.6)") +
        P("EV from 30 m/s with a +0.3 m/s² step, 3 s:") +
        tbl([["E_{bat} = \\int V_c i_a dt", "157 648.0", "J", ""], ["E_{joule} = \\int R_a i_a^2 dt", "6 033.7", "J", ""], ["E_{meca} = \\int k_e\\omega_m i_a dt", "151 600.3", "J", ""], ["E_{L}", "14.2", "J", "inductance"], ["residual", "−0.21", "J", "1.4·10⁻⁶ relative (Euler 0.2 ms)"]], ["Term", "Value", "Unit", ""]) +
        note("Not modelled (O5): variable battery voltage, BMS, thermal limits. The BMS is drawn for context only.") },
    { id: "converter", name: "Converter", rig: "converter", title: "DC-DC half-bridge converter", sub: "Two-quadrant chopper, averaged · §4.4, §9.1",
      live: ["D", "Vc", "ia", "ibat", "regen", "emf"], plot: "pwm",
      html: () => H("Physical phenomenon") +
        P("Two power switches chop the battery voltage at a high frequency. The high-side switch S1 conducts during a fraction D of each period and the low-side switch S2 during the rest; the motor inductance smooths the current, so the motor sees the <b>average</b> voltage. Because S2 can carry the current back, the current may become negative: this is the second quadrant, regeneration.") +
        H("Model (averaged, ideal)") +
        eq(`V_c = D~V_{bat}\\qquad D \\in [0, 1]\\qquad V_c \\in [0, 400]~\\text{V}`, "C1") +
        eq(`i_a < 0~\\text{allowed}~(\\text{regeneration})`, "C2") +
        P("For synthesis the voltage V<sub>c</sub> is used as the plant input (§9.1): the 1/V<sub>bat</sub> gain and the saturation stay in the modulator. Both choices give the same poles and margins (B<sub>D</sub> = V<sub>bat</sub>·B<sub>Vc</sub>).") +
        H("Why a current loop is mandatory") +
        P("R<sub>a</sub> = 0.05 Ω is tiny: a step of D from 0.1 to 0.8 at constant speed would drive ≈ (0.7·400)/0.05 = 5600 A through the motor (§0.1 c). The duty cycle is therefore never commanded directly; it comes from the current loop (next chapters).") +
        note("The PWM in the 3D view is slowed down to a 1.2 s period so that the switching is visible. Try “D direct” mode with a large D to see the current explode.") },
    { id: "motor", name: "DC motor", rig: "motor", title: "Permanent-magnet DC motor", sub: "Armature circuit, back-EMF, torque · §4.4–4.5",
      live: ["Vc", "ia", "emf", "wm", "Te", "Pj", "Pmech"], plot: "tw",
      html: () => H("Physical phenomenon") +
        P("Permanent magnets create a constant field across the armature. Current in the armature conductors feels the Laplace force: torque proportional to the current. The rotating conductors cut the field and induce a voltage proportional to the speed (back-EMF, Lenz) that opposes the supply. The commutator keeps the current direction fixed relative to the field. The armature is a resistor and an inductor in series.") +
        H("Model") +
        eq(`L_a\\frac{di_a}{dt} = V_c - R_a i_a - k_e\\omega_m`, "D1") +
        eq(`T_e = k_t i_a\\qquad\\omega_m = G v\\qquad k_t = k_e~(\\text{SI})`, "D2") +
        eq(`V_c i_a = R_a i_a^2 + k_e\\omega_m i_a + \\frac{d}{dt}\\big(\\frac{1}{2}L_a i_a^2\\big)`, "D3") +
        H("Parameters [Est]") +
        tbl([["V_{bat}", "400", "V", ""], ["R_a", "0.05", "Ω", ""], ["L_a", "1.0", "mH", "τ<sub>e</sub> = L<sub>a</sub>/R<sub>a</sub> = 20 ms"], ["k_e = k_t", "0.25", "V·s/rad", ""], ["J_m", "0.2", "kg·m²", "rotor + reducer"], ["i_{max}", "400", "A", "on the reference"]]) +
        H("Equilibria (§6.2)") +
        tbl([["10", "46.55", "85.66", "0.214", "0.924"], ["20", "74.40", "170.39", "0.426", "0.929"], ["30", "120.82", "256.04", "0.640", "0.928"], ["40", "185.81", "342.62", "0.857", "0.924"]], ["v [m/s]", "i<sub>a</sub> [A]", "V<sub>c</sub> [V]", "D", "efficiency"]) +
        H("Linear model M1 (§9.5)") +
        eq(`A = \\big[~-50~~~-8333.3~~~0~;~~0.0036614~~~-0.000680v_0~~~0~;~~0~~~1~~~0~\\big]\\qquad B = [1000~;~0~;~0]`) +
        P("Poles −49.38, −0.639, 0 at 30 m/s. The slow pole is the back-EMF coupling: −8333.3 × 0.0036614 = −30.51.") +
        note("The rotor turns at 1/80 of its real speed in the 3D view; the windings glow with the current.") },
    { id: "lower", name: "Current loop", rig: "chainEv", title: "Lower level: current loop", sub: "a_des → i_ref → D · §4.7, §12.3",
      live: ["ades", "Fdes", "iref", "ilim", "ia", "D", "Fbcmd", "a"], plot: "iloop",
      html: () => H("Idea") +
        P("The lower level converts the requested acceleration into a current reference (the torque), limits it, and closes a fast PI current loop on the converter. The back-EMF is cancelled by feedforward (decoupling) and the PI zero cancels the electrical pole: the current follows its reference as a 600 rad/s first-order system.") +
        H("Equations") +
        eq(`F_{des} = m_{eff}a_{des} + c_a v^2 + R_x`, "L1") +
        eq(`i_{ref} = \\frac{F_{des}}{\\eta_t G k_t}~(F_{des}\\ge0)\\qquad i_{ref} = \\frac{F_{des}\\eta_t}{G k_t}~(F_{des}<0)`, "L2") +
        eq(`i_{lim}(v) = \\min\\big(i_{max}, \\frac{P_{max}}{k_t\\omega_m}\\big)\\qquad i_{ref,s} = \\sat(i_{ref}, -i_{lim}, i_{lim})`, "L3") +
        eq(`V_c = k_e\\omega_m + K_{p,i}(i_{ref,s} - i_a) + K_{i,i}\\int(i_{ref,s} - i_a)dt\\qquad D = \\sat(V_c/V_{bat}, 0, 1)`, "L4") +
        eq(`K_{p,i} = L_a\\omega_{ci} = 0.6~\\text{V/A}\\qquad K_{i,i} = R_a\\omega_{ci} = 30~\\text{V/(A·s)}\\qquad\\omega_{ci} = 600~\\text{rad/s}`, "L5") +
        eq(`F_{b,cmd} = \\min(\\max(F_t(i_{ref,s}) - F_{des}, 0), F_{b,max})`, "L6") +
        H("Result") +
        eq(`\\frac{i_a}{i_{ref}} = \\frac{1}{s/600 + 1}\\qquad\\frac{v}{a_{des}} = \\frac{1}{s(s/600 + 1)}`, "L7") +
        P("Anti-windup: the integral is frozen when D saturates. Discretised at 0.2 ms with Euler backward (q₀ = 0.606, q₁ = 0.6 V/A).") +
        note("Compare the modes: with the loop the current never exceeds i<sub>lim</sub>; in “D direct” mode a large D step gives thousands of amperes.") },
    { id: "reduction", name: "Reduction", rig: "reduction", title: "Reduction gear and differential", sub: "Single ratio i = 10 · §4.2, §4.4",
      live: ["wm", "wwheel", "Te", "Ft", "regen"], plot: "envEv",
      html: () => H("Physical phenomenon") +
        P("A fixed two-stage reduction multiplies the motor torque by 10 and divides its speed by 10; the differential splits it between the wheels. As for the petrol car, losses depend on the power direction, and the motor inertia is reflected to the car — strongly, because of the high ratio.") +
        H("Model") +
        eq(`\\omega_m = G v\\qquad G = \\frac{i}{r_w} = \\frac{10}{0.3} = 33.33~\\text{m}^{-1}`, "R1") +
        eq(`F_t = \\eta_t G k_t i_a = 7.9167~i_a~(i_a\\ge0)\\qquad F_t = \\frac{G k_t i_a}{\\eta_t} = 8.7719~i_a~(i_a<0)`, "R2") +
        eq(`m_{eff} = m + J_m G^2 = 1940 + 222.22 = 2162.2~\\text{kg}`, "R3") +
        H("Parameters") +
        tbl([["i", "10", "–", "two stages 10/3 × 3 (E4: 8 → 10)"], ["\\eta_t", "0.95", "–", ""], ["G", "33.333", "m⁻¹", ""], ["F_{t,max}", "3167", "N", "400 A, traction"], ["F_{regen,max}", "3509", "N", "−400 A"]]) +
        P("Ratio 10 was chosen (E4) so that the traction force is comparable to the petrol car with i<sub>max</sub> = 400 A unchanged.") },
    { id: "brakes", name: "Brakes", rig: "brakes", title: "Friction brakes + regeneration", sub: "Hydraulic delay, lag and adhesion limit · §2, D4", live: ["Fbcmd", "Fb", "ia", "regen", "a"], plot: "brake", html: () => BRAKE_TXT("ev") },
    { id: "body", name: "Vehicle", rig: "bodyEv", title: "Vehicle body", sub: "Longitudinal dynamics · §1", live: ["v", "a", "Ft", "Fb", "Faero", "Froll", "Fgrade", "Fres"], plot: "fres", html: () => BODY_TXT("ev") },
  ],
};

// live variables: [tex, unit, fn(state, sim), digits]
const VARS = {
  v: ["v", "m/s", (s) => s.v, 2], a: ["a", "m/s²", (s) => s.a, 3], theta: ["\\theta_{th}", "°", (s) => s.theta * 180 / PI, 2],
  Ath: ["A_{th}", "mm²", (s) => PI * 625 * (1 - Math.cos(s.theta)), 1], pm: ["p_m", "kPa", (s) => s.pm / 1000, 2], r: ["r", "", (s) => s.r, 4],
  phi: ["\\Phi(r)", "", (s) => s.phi, 4], regime: ["\\text{flow}", "", (s) => (s.choked ? "choked" : "subsonic")], mth: ["\\dot m_{th}", "g/s", (s) => s.mth * 1000, 2],
  mcyl: ["\\dot m_{cyl}", "g/s", (s) => s.mcyl * 1000, 2], dpm: ["\\dot p_m", "kPa/s", (s) => ICE.K1 * (s.mth - s.mcyl) / 1000, 2], taum: ["\\tau_m", "ms", (s) => s.taum * 1000, 1],
  we: ["\\omega_e", "rpm", (s) => s.we * 60 / TAU, 0], Te: ["T_e", "N·m", (s) => s.Te, 1], Tloss: ["T_{loss}", "N·m", (s) => s.Tloss, 1], Teff: ["T_{e,eff}", "N·m", (s) => s.Teff ?? s.Te, 1],
  Ft: ["F_t", "N", (s) => s.Ft, 0], Fb: ["F_b", "N", (s) => s.Fb, 0], Fbcmd: ["F_{b,cmd}", "N", (s) => s.Fbcmd, 0], Fres: ["F_{res}", "N", (s) => s.Fres, 0],
  Faero: ["c_a v^2", "N", (s) => s.Faero, 0], Froll: ["C_r m g\\cos\\beta", "N", (s) => s.Froll, 0], Fgrade: ["m g\\sin\\beta", "N", (s) => s.Fgrade, 0],
  clutch: ["\\text{clutch}", "", (s) => (s.clutch ? "closed" : "OPEN")], ades: ["a_{des}", "m/s²", (s, sim) => (sim.mode === "ades" ? sim.ades : NaN), 2],
  Fdes: ["F_{des}", "N", (s) => s.Fdes, 0], Fmin: ["F_{min}", "N", (s) => s.Fmin, 0], pdes: ["p_{des}", "kPa", (s) => (s.pdes ?? NaN) / 1000, 2],
  D: ["D", "", (s) => s.D, 4], Vc: ["V_c", "V", (s) => s.Vc, 1], ia: ["i_a", "A", (s) => s.ia, 1], iref: ["i_{ref,s}", "A", (s) => s.iref ?? NaN, 1],
  ilim: ["i_{lim}", "A", (s) => s.ilim, 1], emf: ["k_e\\omega_m", "V", (s) => s.emf, 1], wm: ["\\omega_m", "rpm", (s) => s.wm * 60 / TAU, 0],
  ibat: ["i_{bat}", "A", (s) => s.ibat, 1], Pel: ["V_c i_a", "kW", (s) => s.Pel / 1000, 2], Pj: ["R_a i_a^2", "kW", (s) => s.Pj / 1000, 3],
  Pmech: ["k_e\\omega_m i_a", "kW", (s) => s.Pmech / 1000, 2], regen: ["\\text{mode}", "", (s) => (s.ia < -0.5 ? "regeneration" : s.ia > 0.5 ? "traction" : "idle")],
  wwheel: ["\\omega_w", "rad/s", (s) => s.v / 0.3, 2],
};

// ============================================================================ page state
let api = null, R = null, rigs = null, A = null, canvas = null, floor = null;
const prefs = { plant: "ice", ch: { ice: 0, ev: 0 }, turn: false, labels: true, explode: 0.0, speed: 1 };
const sims = {};
const ph = { crank: 0, cycle: 0, motor: 0, wheel: 0, wheelReal: 0, heat: 0 };
const cam = { yaw: 0.5, pitch: 0.3, dist: 1, target: [0, 0, 0], uYaw: 0, uPitch: 0, zoom: 1, cur: null };
let paused = false, lastNow = 0, lastUi = 0, lastPlot = 0, animT = 0;
const CSS = `
#view-physics.on { padding: 0; }
.ph { display: grid; grid-template-rows: auto 1fr; height: 100%; min-height: 0; }
.ph-top { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--panel); flex-wrap: wrap; }
.ph-top .seg button { padding: 6px 12px; }
.ph-chs { display: flex; gap: 4px; flex-wrap: wrap; }
.ph-chs button { padding: 5px 11px; border-radius: 999px; font-size: 13px; }
.ph-chs button.on { background: var(--accent-2); border-color: var(--accent-2); color: #fff; }
.ph-chs button i { font-style: normal; opacity: .6; margin-right: 5px; font-size: 11px; }
.ph-main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(440px, 36%); min-height: 0; }
.ph-stage { position: relative; min-height: 0; overflow: hidden; background: var(--bg); }
.ph-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
.ph-stage canvas:active { cursor: grabbing; }
.ph-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.ph-tag { position: absolute; transform: translate(-50%, -100%); padding: 4px 8px; border-radius: 7px; white-space: nowrap; pointer-events: none;
  background: rgba(16,19,23,.76); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.14); color: #eef1f4; font: 600 12px Inter, system-ui, sans-serif; }
.ph-tag.sys { pointer-events: auto; cursor: pointer; background: rgba(47,111,214,.85); border-color: rgba(255,255,255,.35); font-size: 13px; padding: 5px 11px; }
.ph-tag.sys:hover { background: rgba(70,140,240,.95); }
.ph-tag sub, .ph-text sub { font-size: .72em; }
.ph-ctl { position: absolute; left: 14px; bottom: 14px; width: 420px; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px;
  background: color-mix(in srgb, var(--panel) 88%, transparent); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); }
.ph-ctl .row { display: flex; align-items: center; gap: 8px; }
.ph-ctl .lb { width: 70px; flex: none; font-size: 12px; color: var(--muted); font-weight: 700; }
.ph-ctl input[type=range] { flex: 1; }
.ph-ctl .val { min-width: 92px; text-align: right; font: 600 12px ui-monospace, monospace; }
.ph-ctl .seg button { padding: 3px 9px; font-size: 12px; }
.ph-ctl h4 { margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); display: flex; justify-content: space-between; }
.ph-ctl.collapsed > :not(h4) { display: none; }
.ph-tool { position: absolute; right: 14px; top: 14px; display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 10px;
  background: color-mix(in srgb, var(--panel) 85%, transparent); border: 1px solid var(--border); font-size: 12px; }
.ph-hint { position: absolute; right: 14px; bottom: 14px; font-size: 11px; color: var(--muted); }
.ph-text { overflow: auto; border-left: 1px solid var(--border); background: var(--panel); padding: 18px 22px 40px; font-size: 15px; line-height: 1.55; color: var(--text-2); }
.ph-text h2 { margin: 0; font-size: 24px; color: var(--text); letter-spacing: -.01em; }
.ph-text .sub { color: var(--muted); margin: 2px 0 14px; font-size: 13px; }
.ph-text h3 { color: var(--text); font-size: 13px; letter-spacing: .07em; text-transform: uppercase; margin: 22px 0 8px; }
.ph-text p { margin: 8px 0; }
.ph-text b { color: var(--text); }
.ph-eq { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0; padding: 10px 14px; border-radius: 10px;
  background: var(--panel-2); border: 1px solid var(--border); overflow-x: auto; }
.ph-eq .m { font: 18px "Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman", serif; color: var(--text); white-space: nowrap; }
.ph-eq b { color: var(--muted); font: 600 12px ui-monospace, monospace; }
.m i, .ph-tab i, .lv i, .ph-chain i { font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif; }
.fr { display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; margin: 0 2px; font-size: .9em; }
.fr > span:first-child { border-bottom: 1px solid currentColor; padding: 0 3px 1px; }
.fr > span:last-child { padding: 1px 3px 0; }
.sqr { white-space: nowrap; } .sq { border-top: 1px solid currentColor; padding: 0 2px; }
.dt { position: relative; display: inline-block; } .dt::after { content: "˙"; position: absolute; left: 50%; top: -.55em; transform: translateX(-50%); }
.ov { text-decoration: overline; }
.op { margin: 0 .22em; } .q { display: inline-block; width: 1em; } .tq { display: inline-block; width: .2em; }
.fn, .tx { font-style: normal; } .fn { margin: 0 .12em 0 .18em; }
.bg { font-size: 1.35em; vertical-align: -.08em; }
.ph-tab { width: 100%; border-collapse: collapse; font-size: 13px; margin: 6px 0; }
.ph-tab th { text-align: left; font-weight: 700; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; padding: 5px 8px; border-bottom: 1px solid var(--border); }
.ph-tab td { padding: 5px 8px; border-bottom: 1px solid var(--border); color: var(--text); font-variant-numeric: tabular-nums; }
.ph-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0; }
.ph-chain .bk { padding: 6px 10px; border-radius: 9px; background: var(--panel-2); border: 1px solid var(--border-2); color: var(--text); font: 15px "Cambria Math", "Times New Roman", serif; text-align: center; }
.ph-chain .bk small { display: block; font: 600 10px Inter, system-ui; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.ph-chain .bk.in { border-color: var(--accent); } .ph-chain .bk.out { border-color: var(--ok); }
.ph-chain .ar { color: var(--muted); }
.ph-note { margin: 12px 0; padding: 10px 12px; border-radius: 10px; border-left: 3px solid var(--accent); background: var(--accent-a); font-size: 13.5px; color: var(--text); }
.ph-live { position: sticky; top: -18px; z-index: 2; margin: 0 -22px 12px; padding: 10px 22px; background: color-mix(in srgb, var(--panel) 94%, transparent);
  backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); }
.ph-live .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 4px 12px; }
.lv { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
.lv .k { color: var(--muted); font-family: "Cambria Math", "Times New Roman", serif; font-size: 15px; }
.lv .v { color: var(--text); font: 600 13px ui-monospace, monospace; } .lv .u { color: var(--muted); font-size: 11px; }
.ph-plot { width: 100%; height: 190px; display: block; margin: 4px 0 6px; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--border); }
.ph-plotcap { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.ph-num { color: var(--accent); font-weight: 700; margin-right: 6px; }
@media (max-width: 1300px) { .ph-main { grid-template-columns: minmax(0, 1fr) 420px; } .ph-ctl { width: 360px; } }
`;

function buildDOM() {
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  $("view-physics").innerHTML = `
  <div class="ph">
    <div class="ph-top">
      <div class="seg" id="ph-plant"><button data-value="ice">ICE · petrol engine</button><button data-value="ev">EV · DC motor</button></div>
      <button class="icon" id="ph-prev" title="Previous chapter (←)">‹</button>
      <div class="ph-chs" id="ph-chs"></div>
      <button class="icon" id="ph-next" title="Next chapter (→)">›</button>
    </div>
    <div class="ph-main">
      <div class="ph-stage" id="ph-stage">
        <canvas id="ph-canvas"></canvas>
        <div class="ph-labels" id="ph-labels"></div>
        <div class="ph-tool">
          <label class="switch"><input type="checkbox" id="ph-turn"><i></i>Turntable</label>
          <label class="switch"><input type="checkbox" id="ph-lab"><i></i>Labels</label>
          <span id="ph-explode-w" class="hidden">Explode <input type="range" id="ph-explode" min="0" max="1" step="0.01" style="width:110px;vertical-align:middle"></span>
          <button class="icon" id="ph-reset" title="Reset the view">⟲</button>
        </div>
        <div class="ph-ctl" id="ph-ctl">
          <h4><span>Live plant · nonlinear model</span><span id="ph-simt" class="mono"></span></h4>
          <div class="row"><span class="lb">Input</span><div class="seg" id="ph-mode"></div></div>
          <div class="row" id="ph-r-ades"><span class="lb">a<sub>des</sub></span><input type="range" id="ph-ades" min="-4.905" max="2.4525" step="0.005"><span class="val" id="ph-ades-v"></span></div>
          <div class="row" id="ph-r-u"><span class="lb" id="ph-u-lb"></span><input type="range" id="ph-u" min="0" max="1" step="0.001"><span class="val" id="ph-u-v"></span></div>
          <div class="row" id="ph-r-fb"><span class="lb">F<sub>b,cmd</sub></span><input type="range" id="ph-fb" min="0" max="15225" step="25"><span class="val" id="ph-fb-v"></span></div>
          <div class="row"><span class="lb">Slope β</span><input type="range" id="ph-beta" min="-8" max="8" step="0.1"><span class="val" id="ph-beta-v"></span></div>
          <div class="row"><span class="lb">Trim v₀</span><div class="seg" id="ph-trim"></div>
            <button class="icon" id="ph-pause" title="Pause the simulation">⏸</button>
            <div class="seg" id="ph-speed"><button data-value="0.25">¼×</button><button data-value="1">1×</button></div></div>
          <div class="row" style="font-size:12px;color:var(--muted)" id="ph-ro"></div>
        </div>
        <div class="ph-hint">drag to orbit · wheel to zoom · double-click to reset · ← → chapters</div>
      </div>
      <div class="ph-text" id="ph-text"></div>
    </div>
  </div>`;
  canvas = $("ph-canvas");
}

// ============================================================================ init
function save() { try { localStorage.setItem("ktrl.physics.v1", JSON.stringify(prefs)); } catch { /* */ } }
const chList = () => CH[prefs.plant];
const curCh = () => chList()[clamp(prefs.ch[prefs.plant], 0, chList().length - 1)];
const sim = () => sims[prefs.plant];

export function initPhysics(a) {
  api = a;
  try { Object.assign(prefs, JSON.parse(localStorage.getItem("ktrl.physics.v1") || "{}")); } catch { /* */ }
  buildDOM();
  sims.ice = new Sim("ice"); sims.ev = new Sim("ev");
  try {
    R = new Renderer(canvas);
    R.quality = { msaa: 4, shadow: 2048, bloom: true };
    const B = buildRigs(R); rigs = B.rigs; A = B.A;
    rigs.chainIce = new Chain([[rigs.manifold, M4.ident()], [rigs.throttle, M4.model(-0.5, 0.22, 0)], [rigs.engine, M4.mul(M4.model(0, -0.47, -0.145), M4.model(0, 0, 0, 0, 0, 0.88, 0.88, 0.88))]],
      { size: 1.0, floor: -0.65, cam: { target: [-0.05, -0.05, 0], dist: 1.9, yaw: 0.55, pitch: 0.28 } });
    rigs.chainEv = new Chain([[rigs.converter, M4.model(0.42, 0.0, 0.0)], [rigs.motor, M4.model(-0.33, 0.1, 0)]],
      { size: 0.9, floor: -0.06, cam: { target: [0.0, 0.05, 0], dist: 1.45, yaw: 0.4, pitch: 0.45 } });
    floor = R.mesh(planeGeo(-0.5, 0.5, -0.5, 0.5));
  } catch (e) {
    console.error(e); R = null;
    $("ph-stage").insertAdjacentHTML("beforeend", `<div class="v3-empty" style="position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);padding:16px;background:var(--panel);border:1px solid var(--border);border-radius:12px"><b>3D is not available</b><br>${e.message}</div>`);
  }
  // controls
  document.querySelectorAll("#ph-plant button").forEach((b) => b.addEventListener("click", () => { prefs.plant = b.dataset.value; save(); openChapter(prefs.ch[prefs.plant]); }));
  $("ph-prev").addEventListener("click", () => openChapter(prefs.ch[prefs.plant] - 1));
  $("ph-next").addEventListener("click", () => openChapter(prefs.ch[prefs.plant] + 1));
  $("ph-turn").addEventListener("change", (e) => { prefs.turn = e.target.checked; save(); });
  $("ph-lab").addEventListener("change", (e) => { prefs.labels = e.target.checked; save(); });
  $("ph-explode").addEventListener("input", (e) => { prefs.explode = +e.target.value; save(); });
  $("ph-reset").addEventListener("click", resetCam);
  $("ph-ades").addEventListener("input", (e) => { sim().ades = +e.target.value; });
  $("ph-u").addEventListener("input", (e) => { const s = sim(); if (s.plant === "ice") s.theta = +e.target.value * PI / 2; else s.D = +e.target.value; });
  $("ph-fb").addEventListener("input", (e) => { sim().FbcmdIn = +e.target.value; });
  $("ph-beta").addEventListener("input", (e) => { sims.ice.beta = sims.ev.beta = +e.target.value * PI / 180; });
  $("ph-pause").addEventListener("click", () => { paused = !paused; $("ph-pause").textContent = paused ? "▶" : "⏸"; });
  document.querySelectorAll("#ph-speed button").forEach((b) => b.addEventListener("click", () => { prefs.speed = +b.dataset.value; save(); syncCtl(); }));
  document.querySelector("#ph-ctl h4").addEventListener("dblclick", () => $("ph-ctl").classList.toggle("collapsed"));
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    cam.uYaw += (e.clientX - drag[0]) * 0.006; cam.uPitch = clamp(cam.uPitch + (e.clientY - drag[1]) * 0.005, -0.5, 1.2);
    drag = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.zoom = clamp(cam.zoom * Math.exp(e.deltaY * 0.0012), 0.15, 6); }, { passive: false });
  canvas.addEventListener("dblclick", resetCam);
  $("ph-labels").addEventListener("click", (e) => {
    const t = e.target.closest("[data-ch]");
    if (t) openChapterById(t.dataset.ch);
  });
  document.addEventListener("keydown", (e) => {
    if (!$("view-physics")?.classList.contains("on")) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); openChapter(prefs.ch[prefs.plant] + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); openChapter(prefs.ch[prefs.plant] - 1); }
  });
  $("ph-turn").checked = prefs.turn; $("ph-lab").checked = prefs.labels; $("ph-explode").value = prefs.explode;
  openChapter(prefs.ch[prefs.plant] ?? 0);
}
function resetCam() { cam.uYaw = 0; cam.uPitch = 0; cam.zoom = 1; }
function openChapterById(id) { const i = chList().findIndex((c) => c.id === id); if (i >= 0) openChapter(i); }
function openChapter(i) {
  const L = chList();
  i = (i + L.length) % L.length;
  prefs.ch[prefs.plant] = i; save();
  const c = L[i];
  document.querySelectorAll("#ph-plant button").forEach((b) => b.classList.toggle("on", b.dataset.value === prefs.plant));
  $("ph-chs").innerHTML = L.map((x, k) => `<button data-k="${k}" class="${k === i ? "on" : ""}"><i>${k}</i>${x.name}</button>`).join("");
  $("ph-chs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => openChapter(+b.dataset.k)));
  $("ph-text").innerHTML = `<div class="sub"><span class="ph-num">${prefs.plant === "ice" ? "ICE" : "EV"} · ${i}/${L.length - 1}</span>${c.sub}</div><h2>${c.title}</h2>
    <div class="ph-live" id="ph-live"><div class="grid" id="ph-lv"></div></div>
    <canvas class="ph-plot" id="ph-plot"></canvas><div class="ph-plotcap" id="ph-plotcap"></div>${c.html()}`;
  $("ph-text").scrollTop = 0;
  $("ph-explode-w").classList.toggle("hidden", !c.rig.startsWith("sys"));
  resetCam(); cam.cur = null;
  syncCtl();
  lastPlot = 0;
}
function syncCtl() {
  const s = sim(), ice = s.plant === "ice";
  $("ph-mode").innerHTML = `<button data-value="ades">a<sub>des</sub> · lower level</button><button data-value="direct">${ice ? "θ<sub>th</sub>" : "D"} direct</button>`;
  $("ph-mode").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.value === s.mode);
    b.addEventListener("click", () => { s.mode = b.dataset.value; if (s.mode === "ades") s.ades = 0; syncCtl(); });
  });
  $("ph-r-ades").classList.toggle("hidden", s.mode !== "ades");
  $("ph-r-u").classList.toggle("hidden", s.mode === "ades");
  $("ph-r-fb").classList.toggle("hidden", s.mode === "ades");
  $("ph-u-lb").innerHTML = ice ? "θ<sub>th</sub>" : "D";
  $("ph-ades").value = s.ades;
  $("ph-u").value = ice ? s.theta / (PI / 2) : s.D;
  $("ph-fb").value = s.FbcmdIn;
  $("ph-beta").value = s.beta * 180 / PI;
  $("ph-trim").innerHTML = (ice ? [10, 20, 30, 40] : [0, 10, 20, 30, 40]).map((v) => `<button data-value="${v}">${v}</button>`).join("");
  $("ph-trim").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { s.trim(+b.dataset.value); s.mode = s.mode; syncCtl(); }));
  document.querySelectorAll("#ph-speed button").forEach((b) => b.classList.toggle("on", +b.dataset.value === prefs.speed));
}

// a group of rigs drawn together (lower-level chapters)
class Chain {
  constructor(items, o) { this.items = items; Object.assign(this, o); }
  draw(ctx) { for (const [rig, M] of this.items) rig.draw(ctx.sub(M)); }
}

// ============================================================================ frame
export function tick() {
  if (!$("view-physics")?.classList.contains("on")) { lastNow = 0; return; }
  const now = performance.now() / 1000;
  const dtw = lastNow ? Math.min(0.1, now - lastNow) : 0.016;
  lastNow = now;
  const S = sim(), c = curCh();
  if (!paused) {
    S.run(dtw * prefs.speed);
    const st = S.s;
    const slow = 1 / 40;
    if (S.plant === "ice") {
      const dphi = (st.clutch ? st.we : 0) * dtw * prefs.speed * slow;
      ph.crank += dphi; ph.cycle += dphi;
    }
    ph.motor += (st.wm ?? 0) * dtw * prefs.speed / 80;
    ph.wheel += st.v / 0.3 * dtw * prefs.speed * slow;
    ph.wheelReal += st.v / 0.3 * dtw * prefs.speed;
    ph.heat = Math.max(0, ph.heat + dtw * prefs.speed * (st.Fb * st.v / 3e5 - ph.heat * 0.15));
    animT += dtw;
  }
  if (now - lastUi > 0.1) { lastUi = now; liveBox(S, c); }
  if (now - lastPlot > 0.25) { lastPlot = now; drawPlot(c.plot, S); }
  if (!R || !rigs) return;
  const rig = rigs[c.rig];
  const W = R.resize(1); const aspect = W[0] / Math.max(1, W[1]);
  // camera
  const base = rig.cam;
  if (prefs.turn) cam.uYaw += dtw * 0.12;
  const yaw = base.yaw + cam.uYaw, pitch = clamp(base.pitch + cam.uPitch, -0.2, 1.45), dist = base.dist * cam.zoom;
  const tg = base.target;
  const eyeT = [tg[0] - Math.sin(yaw) * Math.cos(pitch) * dist, tg[1] + Math.sin(pitch) * dist, tg[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
  if (!cam.cur || cam.cur.rig !== c.rig) cam.cur = { rig: c.rig, eye: eyeT.slice(), tg: tg.slice() };
  const k = 1 - Math.exp(-dtw * 8);
  for (let i = 0; i < 3; i++) { cam.cur.eye[i] += (eyeT[i] - cam.cur.eye[i]) * k; cam.cur.tg[i] += (tg[i] - cam.cur.tg[i]) * k; }
  const eye = cam.cur.eye;
  const view = M4.lookAt(eye, cam.cur.tg, [0, 1, 0]);
  const proj = M4.perspective(36 * PI / 180, aspect, Math.max(0.005, dist * 0.02), dist * 60 + 50);
  const vp = M4.mul(proj, view);
  const light = document.documentElement.dataset.theme === "light";
  const env = studioEnv(now, light);
  const lists = { ground: [], opaque: [], glass: [], mirror: [], flats: [], beams: [], partsAlpha: [], partsAdd: [], groups: [] };
  const labels = prefs.labels ? [] : null;
  const ctx = makeCtx({ R, A, B: M4.ident(), st: S.s, ph, t: animT, lists, labels: [], eye, explode: prefs.explode });
  ctx.labels = labels ?? [];
  const sysLabels = [];
  if (!prefs.labels) ctx.labels = sysLabels;
  rig.draw(ctx);
  const fs = rig.size * 9;
  lists.ground.push({ mesh: floor, model: M4.model(cam.cur.tg[0], rig.floor, cam.cur.tg[2], 0, 0, fs, 1, fs), mat: { color: light ? "#d4d7db" : "#25282c", kind: 10, alpha: 0.999, refl: Math.pow(10, Math.round(Math.log10(rig.size / 4))) } });
  R.render({
    cam: { vp, view, proj, eye, worldX: ((S.s.x % 4000) + 4000) % 4000, invVP: M4.invert(vp), right: [view[0], view[4], view[8]], up: [view[1], view[5], view[9]], target: cam.cur.tg },
    env, shadow: { center: tg, half: rig.size * 0.85, ox: 0 },
    post: { bloom: 0.05, threshold: 1.1, vignette: 0.25, grain: 0.006, ca: 0.0006, sat: 1.02, lift: [0, 0, 0], gain: [1, 1, 1] }, ...lists,
  });
  drawLabels(prefs.labels ? ctx.labels : ctx.labels.filter((l) => l.ch), vp, W[0], W[1]);
}

function studioEnv(t, light) {
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const hor = lin(light ? "#e9ebee" : "#2b2e34");
  return {
    sunDir: n([0.45, 0.85, 0.55]), sunCol: [2.3, 2.22, 2.1], sunVis: 0, skyTop: lin(light ? "#c4c8ce" : "#121417"), skyHor: hor,
    skyGround: lin(light ? "#d5d8dc" : "#1b1d21"), fogCol: hor, ambSky: light ? [0.5, 0.52, 0.56] : [0.36, 0.38, 0.43], ambGround: [0.1, 0.1, 0.11],
    fogDen: 1e-7, fogFall: 0, night: 0, wet: 0, snow: 0, time: t, cloud: 0, cloudDark: 0, cloudOff: [0, 0], stars: 0, moonDir: [0, 1, 0],
    exposure: light ? 0.95 : 1.05, wind: 0, shadowK: 0.85, castShadows: true, lamp: [50, 9, 0, 0], lampZ2: 0, lampCol: [1, 1, 1], spots: [],
    grade: { gain: [1, 1, 1], lift: [0, 0, 0], sat: 1 }, rain: 0, snowfall: 0, flash: 0, headlights: 0, lampsOn: 0,
  };
}

function drawLabels(list, vp, W, H) {
  const host = $("ph-labels");
  while (host.children.length < list.length) host.appendChild(document.createElement("div"));
  while (host.children.length > list.length) host.lastChild.remove();
  list.forEach((l, i) => {
    const el = host.children[i];
    const [x, y, , w] = M4.apply(vp, l.p[0], l.p[1], l.p[2]);
    const cls = "ph-tag" + (l.cls ? " " + l.cls : "");
    if (el.className !== cls) el.className = cls;
    if (el.dataset.html !== l.html) { el.innerHTML = l.html; el.dataset.html = l.html; }
    if (l.ch) el.dataset.ch = l.ch; else delete el.dataset.ch;
    el.style.display = w > 0 && Math.abs(x) < 1.1 && Math.abs(y) < 1.1 ? "" : "none";
    el.style.left = `${(x * 0.5 + 0.5) * W}px`;
    el.style.top = `${(-y * 0.5 + 0.5) * H}px`;
  });
}

function liveBox(S, c) {
  const s = S.s, box = $("ph-lv");
  if (!box) return;
  box.innerHTML = c.live.map((k) => {
    const d = VARS[k];
    if (!d) return "";
    const v = d[2](s, S);
    const txt = typeof v === "string" ? v : Number.isFinite(v) ? v.toFixed(d[3] ?? 2) : "–";
    return `<div class="lv"><span class="k">${tex(d[0])}</span><span class="v">${txt}</span><span class="u">${d[1]}</span></div>`;
  }).join("");
  $("ph-simt").textContent = `t = ${s.t.toFixed(1)} s`;
  const ice = S.plant === "ice";
  $("ph-ades-v").textContent = `${S.ades.toFixed(2)} m/s² (${(S.ades / g0).toFixed(3)} g)`;
  $("ph-u-v").textContent = ice ? `${(S.theta * 180 / PI).toFixed(1)}°` : S.D.toFixed(3);
  $("ph-fb-v").textContent = `${S.FbcmdIn.toFixed(0)} N`;
  $("ph-beta-v").textContent = `${(S.beta * 180 / PI).toFixed(1)}°`;
  if (S.mode === "ades" && document.activeElement !== $("ph-u")) $("ph-u").value = ice ? S.theta / (PI / 2) : S.D;
  $("ph-ro").innerHTML = `v = <b>${s.v.toFixed(2)}</b> m/s (${(s.v * 3.6).toFixed(0)} km/h) · a = <b>${s.a.toFixed(2)}</b> m/s² · ${ice ? `p<sub>m</sub> = ${(s.pm / 1000).toFixed(1)} kPa` : `i<sub>a</sub> = ${s.ia.toFixed(0)} A`}`;
}

// ============================================================================ plots
function drawPlot(kind, S) {
  const cv = $("ph-plot"), cap = $("ph-plotcap");
  if (!cv) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const C = { text: css.getPropertyValue("--text").trim(), muted: css.getPropertyValue("--muted").trim(), grid: css.getPropertyValue("--border").trim(),
    acc: "#6ea8fe", ok: "#4fc3a1", warn: "#e3b341", bad: "#e5534b", vio: "#b48cff" };
  const s = S.s;
  const ser = [], pts = [];
  let xr, yr, xl, yl, shade = null, capTxt = "";
  const fn = (f, a, b, n = 160) => Array.from({ length: n + 1 }, (_, i) => { const x = a + (b - a) * i / n; return [x, f(x)]; });
  const fullT = (rpm) => ICE.kT * ICE.patm * 0.99 - Tloss(rpm * TAU / 60);
  switch (kind) {
    case "phi":
      xr = [0, 1]; yr = [0, 0.75]; xl = "r = p_m / p_atm"; yl = "Φ(r)";
      ser.push({ pts: fn(Phi, 0, 1), col: C.acc });
      shade = [0, ICE.rc, "choked"]; pts.push([s.r, s.phi]);
      capTxt = "Flow function: flat (sonic, choked) below r<sub>c</sub> = 0.528, then falls to 0 at r = 1. Dot = current operating point."; break;
    case "taum":
      xr = [5, 50]; yr = [0, 0.3]; xl = "v [m/s]"; yl = "τ_m [s]";
      ser.push({ pts: fn((v) => 1 / (ICE.K1 * ICE.K3 * v), 7.66, 50), col: C.acc });
      pts.push([s.v, s.taum]); shade = [0, ICE.vmin, "clutch open"];
      capTxt = "Manifold time constant τ<sub>m</sub> = 1/(K₁K₃v): the faster the car, the faster the engine breathes."; break;
    case "torque":
      xr = [0, 7000]; yr = [-60, 230]; xl = "engine speed [rpm]"; yl = "T_e [N·m]";
      ser.push({ pts: fn(fullT, 1000, 6500), col: C.ok, name: "full load" });
      ser.push({ pts: fn((r) => -Tloss(r * TAU / 60), 1000, 6500), col: C.bad, name: "closed throttle (engine brake)" });
      ser.push({ pts: [[0, 0], [7000, 0]], col: C.grid });
      pts.push([s.we * 60 / TAU, s.Te]);
      capTxt = "Net torque map of the model: T<sub>e</sub> = k<sub>T</sub>p<sub>m</sub> − T<sub>0</sub> − c<sub>w</sub>ω<sub>e</sub>, between closed throttle and full load."; break;
    case "envIce": case "envEv": case "fres": {
      xr = [0, 50]; yr = [0, 4000]; xl = "v [m/s]"; yl = "force [N]";
      ser.push({ pts: fn((v) => Fres(v), 0, 50), col: C.warn, name: "F_res" });
      if (kind !== "fres" || S.plant === "ice") ser.push({ pts: fn((v) => ICE.eta * ICE.G * fullT(ICE.G * v * 60 / TAU), ICE.vmin, ICE.vmax), col: C.acc, name: "ICE max traction", dash: kind === "envEv" });
      if (kind !== "fres" || S.plant === "ev") ser.push({ pts: fn((v) => FtEV(ilim(v)), 0, 46.6), col: C.ok, name: "EV max traction", dash: kind === "envIce" });
      if (kind === "fres") { ser.push({ pts: fn((v) => BODY.ca * v * v, 0, 50), col: "#5ab8ff", name: "aero" }); ser.push({ pts: [[0, BODY.Rx], [50, BODY.Rx]], col: C.vio, name: "rolling" }); }
      pts.push([s.v, kind === "fres" ? s.Fres : s.Ft]);
      capTxt = kind === "fres" ? "Resistance forces vs speed and the traction envelope; dot = current F<sub>res</sub>." : "Traction envelopes (ICE: full load; EV: current then power limit) vs the road load. Dot = current F<sub>t</sub>. The gap is the acceleration reserve."; break;
    }
    case "brake": {
      xr = [0, 0.5]; yr = [0, 1.1]; xl = "t [s]"; yl = "F_b / F_b,cmd";
      ser.push({ pts: [[0, 1], [0.5, 1]], col: C.grid, name: "command" });
      ser.push({ pts: fn((t) => (t < THB ? 0 : 1 - Math.exp(-(t - THB) / TAUB)), 0, 0.5, 200), col: C.bad, name: "friction brake" });
      if (S.plant === "ev") ser.push({ pts: fn((t) => 1 - Math.exp(-t * 600), 0, 0.5, 200), col: C.ok, name: "regeneration (current loop)" });
      capTxt = "Step response of the friction brake: 70 ms pure delay then an 80 ms first-order lag (t₆₃ = 150 ms)." + (S.plant === "ev" ? " Regeneration reacts in 1.7 ms." : ""); break;
    }
    case "ilim":
      xr = [0, 50]; yr = [0, 450]; xl = "v [m/s]"; yl = "|i| [A]";
      ser.push({ pts: fn(ilim, 0, 50), col: C.acc, name: "i_lim(v)" });
      pts.push([s.v, Math.abs(s.ia)]);
      capTxt = "Current limit: 400 A until the power limit 120 kW takes over at 37.9 m/s. Dot = |i<sub>a</sub>|."; break;
    case "tw":
      xr = [0, 16000]; yr = [-120, 120]; xl = "ω_m [rpm]"; yl = "T_e [N·m]";
      ser.push({ pts: fn((r) => EV.kt * ilim(r * TAU / 60 / EV.G), 0, 16000), col: C.ok, name: "max (traction)" });
      ser.push({ pts: fn((r) => -EV.kt * ilim(r * TAU / 60 / EV.G), 0, 16000), col: "#5ab8ff", name: "min (regeneration)" });
      ser.push({ pts: [[0, 0], [16000, 0]], col: C.grid });
      pts.push([s.wm * 60 / TAU, s.Te]);
      capTxt = "Torque–speed envelope of the drive: 100 N·m (400 A) then constant power 120 kW."; break;
    case "pwm": {
      xr = [0, 2]; yr = [-30, 430]; xl = "t / T_PWM"; yl = "V [V]";
      const D = s.D, wave = [];
      for (let p = 0; p < 2; p++) { wave.push([p, 400], [p + D, 400], [p + D, 0], [p + 1, 0]); }
      ser.push({ pts: wave, col: C.warn, name: "switched voltage" });
      ser.push({ pts: [[0, D * 400], [2, D * 400]], col: C.ok, name: "average V_c = D·V_bat" });
      capTxt = `PWM of the half-bridge: S1 conducts during D·T. The motor (L<sub>a</sub>) filters it; the model keeps only the average ${(D * 400).toFixed(0)} V.`; break;
    }
    case "iloop": {
      xr = [0, 0.1]; yr = [0, 1.15]; xl = "t [s]"; yl = "i_a / i_ref";
      ser.push({ pts: fn((t) => 1 - Math.exp(-600 * t), 0, 0.1, 200), col: C.ok, name: "closed current loop 1/(s/600+1)" });
      ser.push({ pts: fn((t) => 1 - Math.exp(-t / 0.02), 0, 0.1, 200), col: C.bad, name: "armature alone (τ_e = 20 ms)" });
      capTxt = "Current response: the PI with decoupling gives t₆₃ = 1.7 ms instead of the electrical 20 ms — and it bounds the current."; break;
    }
    case "histIce": case "histEv": default: {
      const h = S.hist;
      const t1 = h.length ? h[h.length - 1].t : 0;
      xr = [t1 - 30, t1]; xl = "t [s]"; yl = "";
      const vmax = Math.max(10, ...h.map((p) => p.v)) * 1.1;
      yr = [0, vmax];
      ser.push({ pts: h.map((p) => [p.t, p.v]), col: C.acc, name: "v [m/s]" });
      const ymax = Math.max(1, ...h.map((p) => Math.abs(p.y)));
      ser.push({ pts: h.map((p) => [p.t, (p.y / ymax) * vmax * 0.9]), col: S.plant === "ice" ? C.warn : C.ok, name: S.plant === "ice" ? `p_m (max ${ymax.toFixed(0)} kPa)` : `i_a (max ${ymax.toFixed(0)} A)` });
      ser.push({ pts: h.map((p) => [p.t, vmax / 2 + p.a * vmax / 10]), col: C.vio, name: "a (centre line = 0)" });
      capTxt = "Last 30 s of the live simulation (normalised). Move the sliders of the control panel."; break;
    }
  }
  cap.innerHTML = capTxt;
  const L = 46, Rm = 10, Tm = 10, Bm = 30, pw = W - L - Rm, phh = H - Tm - Bm;
  const X = (x) => L + (x - xr[0]) / (xr[1] - xr[0]) * pw, Y = (y) => Tm + (1 - (y - yr[0]) / (yr[1] - yr[0])) * phh;
  g.font = "11px Inter, system-ui, sans-serif"; g.fillStyle = C.muted; g.strokeStyle = C.grid; g.lineWidth = 1;
  const nice = (a, b, n) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / n))); const m = [1, 2, 5, 10].find((k) => (b - a) / (st * k) <= n) * st; const o = []; for (let v = Math.ceil(a / m) * m; v <= b + 1e-9; v += m) o.push(v); return o; };
  for (const v of nice(xr[0], xr[1], 6)) { g.beginPath(); g.moveTo(X(v), Tm); g.lineTo(X(v), Tm + phh); g.stroke(); g.textAlign = "center"; g.fillText(+v.toPrecision(4) + "", X(v), H - 14); }
  for (const v of nice(yr[0], yr[1], 4)) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(L + pw, Y(v)); g.stroke(); g.textAlign = "right"; g.fillText(+v.toPrecision(4) + "", L - 6, Y(v) + 4); }
  g.textAlign = "center"; g.fillText(xl, L + pw / 2, H - 2);
  if (shade) { g.fillStyle = "rgba(110,168,254,.10)"; g.fillRect(X(Math.max(shade[0], xr[0])), Tm, X(shade[1]) - X(Math.max(shade[0], xr[0])), phh); g.fillStyle = C.muted; g.textAlign = "left"; g.fillText(shade[2], X(Math.max(shade[0], xr[0])) + 6, Tm + 14); }
  g.save(); g.beginPath(); g.rect(L, Tm, pw, phh); g.clip();
  let ly = Tm + 14;
  for (const sr of ser) {
    if (!sr.pts.length) continue;
    g.strokeStyle = sr.col; g.lineWidth = 2; g.setLineDash(sr.dash ? [5, 4] : []);
    g.beginPath(); sr.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke();
  }
  g.setLineDash([]);
  for (const [x, y] of pts) if (Number.isFinite(x) && Number.isFinite(y)) {
    g.fillStyle = "#fff"; g.beginPath(); g.arc(X(x), Y(y), 5.5, 0, 7); g.fill();
    g.fillStyle = C.bad; g.beginPath(); g.arc(X(x), Y(y), 3.5, 0, 7); g.fill();
  }
  g.restore();
  g.textAlign = "right";
  for (const sr of ser) if (sr.name) { g.fillStyle = sr.col; g.fillRect(L + pw - 150, ly - 8, 10, 3); g.fillStyle = C.text; g.textAlign = "left"; g.fillText(sr.name, L + pw - 136, ly - 3); ly += 14; }
}
