// phys3d.js - cutaway 3D models of every plant component for the Physics
// window: throttle body, intake manifold, inline-4 engine, gearbox + final
// drive, friction brake, vehicle body with forces, battery pack, DC-DC
// half-bridge converter, permanent-magnet DC motor, reduction gear, and the
// two assembled powertrains (exploded view).
//
// A rig owns its meshes and draws itself each frame from the live plant
// state:  rig.draw(ctx)  where ctx carries the base matrix, the state, the
// animation phases and helpers (add / glass / glow / label / arrow / flow).

import { M4, Geo, boxGeo, boxAt, cylGeo, coneGeo, sphereGeo, segGeo, lin } from "./gl3d.js";
import * as MD from "./models3d.js";

const PI = Math.PI, TAU = 2 * Math.PI;
const h1 = (i, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7 + 0.5) * 43758.5453; return v - Math.floor(v); };
const fract = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const T = (x, y, z) => M4.model(x, y, z);
const mul = (...ms) => ms.reduce((a, b) => M4.mul(a, b));

// ============================================================================ materials
export const PM = {
  alu: { color: "#b8bfc7", spec: 0.7, shine: 60, glow: 0, flag: 0 },
  cast: { color: "#6d7278", spec: 0.35, shine: 24, glow: 0, flag: 0 },
  steel: { color: "#9aa2aa", spec: 0.85, shine: 90, glow: 0, flag: 0 },
  dark: { color: "#2a2d31", spec: 0.3, shine: 30, glow: 0, flag: 0 },
  black: { color: "#141518", spec: 0.4, shine: 40, glow: 0, flag: 0 },
  cut: { color: "#e0703f", spec: 0.15, shine: 16, glow: 0, flag: 0 },
  copper: { color: "#c77a3d", spec: 0.9, shine: 90, glow: 0, flag: 0 },
  brass: { color: "#c9a54a", spec: 0.9, shine: 80, glow: 0, flag: 0 },
  red: { color: "#c3261d", spec: 0.6, shine: 60, glow: 0, flag: 0 },
  magN: { color: "#d2453a", spec: 0.5, shine: 50, glow: 0, flag: 0 },
  magS: { color: "#3b6fd1", spec: 0.5, shine: 50, glow: 0, flag: 0 },
  pcb: { color: "#1f6b3e", spec: 0.4, shine: 40, glow: 0, flag: 0 },
  chip: { color: "#111214", spec: 0.6, shine: 70, glow: 0, flag: 0 },
  orange: { color: "#f08a24", spec: 0.4, shine: 40, glow: 0, flag: 0 },
  rubber: { color: "#18191b", spec: 0.08, shine: 6, glow: 0, flag: 0 },
  blue: { color: "#2f5d9e", spec: 0.5, shine: 50, glow: 0, flag: 0 },
  white: { color: "#e6e8eb", spec: 0.4, shine: 40, glow: 0, flag: 0 },
  carbon: { color: "#2b2b2b", spec: 0.1, shine: 8, glow: 0, flag: 0 },
  pad: { color: "#3a332d", spec: 0.1, shine: 8, glow: 0, flag: 0 },
  disc: { color: "#8f959b", spec: 0.8, shine: 70, glow: 6, flag: 0 },
  cell: { color: "#2f7bd1", spec: 0.6, shine: 60, glow: 0, flag: 0 },
  led: { color: "#5cff9a", spec: 0.5, shine: 40, glow: 1, flag: 0 },
};

// ============================================================================ geometry helpers
// ear clipping of a simple 2D polygon -> index triples
function earclip(P) {
  let idx = P.map((_, i) => i);
  let area = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) idx.reverse();
  const out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = P[i0], b = P[i1], c = P[i2];
      if (cross(a, b, c) <= 1e-12) continue;
      let ok = true;
      for (const j of idx) if (j !== i0 && j !== i1 && j !== i2 && inside(P[j], a, b, c)) { ok = false; break; }
      if (!ok) continue;
      out.push([i0, i1, i2]); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.slice());
  return out;
}

// surface of revolution around z over [a0, a1]; profile [[r, z], ...] traversed
// with the outside on the right; optional section caps at a cut
export function lathe(prof, seg, mat, o = {}) {
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? TAU, full = Math.abs(a1 - a0) >= TAU - 1e-6;
  const g = new Geo();
  for (let i = 0; i < seg; i++) {
    const A0 = a0 + (a1 - a0) * (i / seg), A1 = a0 + (a1 - a0) * ((i + 1) / seg);
    const c0 = Math.cos(A0), s0 = Math.sin(A0), c1 = Math.cos(A1), s1 = Math.sin(A1);
    for (let k = 0; k + 1 < prof.length; k++) {
      const [ra, za] = prof[k], [rb, zb] = prof[k + 1];
      if (Math.abs(ra - rb) < 1e-9 && Math.abs(za - zb) < 1e-9) continue;
      const A = [ra * c0, ra * s0, za], B = [ra * c1, ra * s1, za], C = [rb * c1, rb * s1, zb], D = [rb * c0, rb * s0, zb];
      const dr = rb - ra, dz = zb - za, l = Math.hypot(dr, dz) || 1;
      const nr = dz / l, nz = -dr / l;
      const N = (c, s) => [nr * c, nr * s, nz];
      if (o.flat) { if (ra > 1e-6) g.tri(A, B, C); if (rb > 1e-6) g.tri(A, C, D); continue; }
      if (ra > 1e-6) g.triN(A, B, C, N(c0, s0), N(c1, s1), N(c1, s1));
      if (rb > 1e-6) g.triN(A, C, D, N(c0, s0), N(c1, s1), N(c0, s0));
    }
  }
  g.recolor(mat);
  if (!full && o.cap) {
    let P = prof.slice();
    const f = P[0], l = P[P.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) P.pop();
    const tris = earclip(P);
    const caps = new Geo();
    const rc = P.reduce((s, p) => s + p[0], 0) / P.length, zc = P.reduce((s, p) => s + p[1], 0) / P.length;
    for (const [a, dir] of [[a0, 1], [a1, -1]]) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const ins = [rc * Math.cos(a + dir * 0.2), rc * Math.sin(a + dir * 0.2), zc];
      for (const [i, j, k] of tris) {
        const p = (q) => [P[q][0] * ca, P[q][0] * sa, P[q][1]];
        caps.triOut(p(i), p(j), p(k), ins);
      }
    }
    caps.recolor(o.cap);
    g.add(caps);
  }
  return g;
}
// tube swept along a polyline
export function tubeGeo(pts, r, seg = 12, mat) {
  const g = new Geo();
  const n = pts.length;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const tg = pts.map((p, i) => nrm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let nv = Math.abs(tg[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  nv = nrm(sub(nv, tg[0].map((x) => x * dot(nv, tg[0]))));
  const rings = [];
  for (let i = 0; i < n; i++) {
    const t = tg[i];
    nv = nrm(sub(nv, t.map((x) => x * dot(nv, t))));
    const b = crs(t, nv);
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
      const d = [nv[0] * c + b[0] * s, nv[1] * c + b[1] * s, nv[2] * c + b[2] * s];
      ring.push([[pts[i][0] + d[0] * r, pts[i][1] + d[1] * r, pts[i][2] + d[2] * r], d]);
    }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < seg; k++) {
    const [A, nA] = rings[i][k], [B, nB] = rings[i + 1][k], [C, nC] = rings[i + 1][k + 1], [D, nD] = rings[i][k + 1];
    g.triN(A, C, B, nA, nC, nB); g.triN(A, D, C, nA, nD, nC);
  }
  return g.recolor(mat);
}
const bez = (p0, p1, p2, p3, n = 16) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return [0, 1, 2].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
});
// spur gear, axis z, centred
export function gearGeo(r, teeth, w, mat, o = {}) {
  const g = new Geo();
  const th = Math.min(0.012, r * 0.13), rr = r - th, d = Math.min(0.012, rr * 0.18);
  const hub = o.hub ?? Math.max(0.012, r * 0.28), bore = o.bore ?? Math.max(0.005, r * 0.1);
  const web = o.web ?? 0.22;
  if (rr - d > hub + 0.004) {
    g.add(lathe([[bore, -w / 2], [hub, -w / 2], [hub, -w * web], [rr - d, -w * web], [rr - d, -w / 2], [rr, -w / 2], [rr, w / 2],
      [rr - d, w / 2], [rr - d, w * web], [hub, w * web], [hub, w / 2], [bore, w / 2], [bore, -w / 2]], Math.max(24, teeth * 2), mat));
    if (r > 0.06) for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU, rm = (hub + rr - d) / 2;
      g.add(cylGeo((rr - d - hub) * 0.28, (rr - d - hub) * 0.28, w * 2 * web + 0.002, 14, true, PM.dark), M4.model(Math.cos(a) * rm, Math.sin(a) * rm, -w * web - 0.001, 0, 0, 1, 1, 1, PI / 2));
    }
  } else g.add(lathe([[bore, -w / 2], [rr, -w / 2], [rr, w / 2], [bore, w / 2], [bore, -w / 2]], Math.max(24, teeth * 2), mat));
  const tw = (TAU * rr / teeth) * 0.5;
  for (let k = 0; k < teeth; k++) {
    const a = (k / teeth) * TAU;
    g.add(new Geo().add(boxGeo(th * 1.1, tw, w, mat)), M4.model(Math.cos(a) * (rr + th * 0.5), Math.sin(a) * (rr + th * 0.5), 0, 0, a));
  }
  return g;
}
// cylinder along +x from x0 to x1
const shaftX = (x0, x1, r, mat, y = 0, z = 0, seg = 16) => new Geo().add(cylGeo(r, r, x1 - x0, seg, true, mat), M4.model(x0, y, z, 0, -PI / 2));
const shaftY = (y0, y1, r, mat, x = 0, z = 0, seg = 16) => new Geo().add(cylGeo(r, r, y1 - y0, seg, true, mat), M4.model(x, y0, z));
// rotation helpers: gear meshes with axis x spinning by angle a
const onX = (x, y, z, a) => mul(M4.model(x, y, z, PI / 2), M4.model(0, 0, 0, 0, a));
const onZ = (x, y, z, a) => M4.model(x, y, z, 0, a);

// ============================================================================ context
// ctx = { R, B, st, ph, t, lists, labels, slowTxt }
export function makeCtx(base) {
  const ctx = {
    ...base,
    sub(Bm) { return makeCtx({ ...this, B: M4.mul(this.B, Bm) }); },
    add(mesh, m, mat = {}, o = {}) { this.lists.opaque.push({ mesh, model: M4.mul(this.B, m || IDENT), mat, cast: o.cast, noCull: o.noCull }); },
    glass(mesh, m, mat = {}, o = {}) {
      const W = M4.mul(this.B, m || IDENT);
      const E = this.eye, dist = (W[12] - E[0]) ** 2 + (W[13] - E[1]) ** 2 + (W[14] - E[2]) ** 2;
      this.lists.glass.push({ mesh, model: W, mat: { alpha: 0.2, spec: 0.6, shine: 60, refl: 0.6, ...mat }, dist, noCull: o.noCull ?? true });
    },
    pt(p) { const q = M4.apply(this.B, p[0], p[1], p[2]); return [q[0], q[1], q[2]]; },
    scale() { return Math.cbrt(Math.abs(M4.det3(this.B))) || 1; },
    glow(p, size, col, alpha, mode = 1) {
      const q = this.pt(p), s = size * this.scale();
      this.lists.partsAdd.push([q[0], q[1], q[2], s, col[0], col[1], col[2], alpha, 0, 0, 0, mode, 0]);
    },
    label(p, html, o = {}) { if (this.labels) this.labels.push({ p: this.pt(p), html, ...o }); },
    arrow(p, dir, len, color, w = 0.02, o = {}) {
      if (!(Math.abs(len) > 1e-4)) return;
      const d = len < 0 ? dir.map((x) => -x) : dir, L = Math.abs(len);
      const p0 = this.pt(p), p1 = this.pt([p[0] + d[0] * L, p[1] + d[1] * L, p[2] + d[2] * L]);
      const v = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], Lw = Math.hypot(...v);
      if (Lw < 1e-5) return;
      const u = v.map((x) => x / Lw), ww = w * this.scale();
      const yaw = Math.atan2(-u[2], u[0]), pitch = Math.asin(clamp(u[1], -1, 1));
      const hl = Math.min(Lw * 0.45, ww * 4.5);
      const c = lin(color), em = c.map((x) => x * (o.em ?? 0.9));
      const mat = { colorLin: c, emissive: "#000", emissiveLin: em, spec: 0.4, shine: 30 };
      this.lists.opaque.push({ mesh: this.A.shaft, model: M4.mul(M4.model(p0[0], p0[1], p0[2], yaw, pitch), M4.model(0, 0, 0, 0, 0, Lw - hl, ww, ww)), mat, cast: false });
      const ph = [p0[0] + u[0] * (Lw - hl), p0[1] + u[1] * (Lw - hl), p0[2] + u[2] * (Lw - hl)];
      this.lists.opaque.push({ mesh: this.A.head, model: M4.mul(M4.model(ph[0], ph[1], ph[2], yaw, pitch), M4.model(0, 0, 0, 0, 0, hl, ww * 2.4, ww * 2.4)), mat, cast: false });
    },
    // n particles flowing along a polyline at `speed` m/s (local units)
    flow(pts, n, speed, size, col, alpha, jitter = 0, seed = 0) {
      if (n <= 0 || alpha <= 0) return;
      const seg = [], acc = [0];
      for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]); seg.push(l); acc.push(acc[acc.length - 1] + l); }
      const L = acc[acc.length - 1];
      if (L <= 0) return;
      for (let i = 0; i < n; i++) {
        let s = fract(h1(i, seed) + (this.t * speed) / L) * L;
        if (speed < 0) s = L - fract(h1(i, seed) - (this.t * speed) / L) * L;
        let k = 0;
        while (k < seg.length - 1 && acc[k + 1] < s) k++;
        const f = seg[k] > 0 ? (s - acc[k]) / seg[k] : 0;
        const a = pts[k], b = pts[k + 1];
        const p = [a[0] + (b[0] - a[0]) * f + (h1(i, seed + 1) - 0.5) * jitter, a[1] + (b[1] - a[1]) * f + (h1(i, seed + 2) - 0.5) * jitter, a[2] + (b[2] - a[2]) * f + (h1(i, seed + 3) - 0.5) * jitter];
        const fade = Math.min(1, (s / L) * 8, (1 - s / L) * 8);
        this.glow(p, size, col, alpha * fade);
      }
    },
  };
  return ctx;
}
const IDENT = M4.ident();
export function arrowMeshes(R) {
  const shaft = new Geo().add(cylGeo(1, 1, 1, 12, true), M4.model(0, 0, 0, 0, -PI / 2));
  const head = new Geo().add(coneGeo(1, 1, 16, undefined, true), M4.model(0, 0, 0, 0, -PI / 2));
  return { shaft: R.mesh(shaft), head: R.mesh(head) };
}
const heat = (k) => { const a = new Float32Array(8); a[6] = k; return a; };
const glowArr = (o) => { const a = new Float32Array(8); for (const [k, v] of Object.entries(o)) a[k] = v; return a; };
const pressureCol = (r) => {       // 0..1 -> blue .. cyan .. yellow .. red
  const stops = [[0, [0.1, 0.25, 0.9]], [0.35, [0.1, 0.75, 0.85]], [0.65, [0.95, 0.85, 0.2]], [1, [0.95, 0.25, 0.15]]];
  r = clamp(r, 0, 1);
  for (let i = 1; i < stops.length; i++) if (r <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (r - a) / (b - a);
    return ca.map((x, k) => x + (cb[k] - x) * t);
  }
  return stops[stops.length - 1][1];
};
const AIR = [0.55, 0.8, 1.0], CUR = [1.0, 0.72, 0.25], POW = [0.4, 1.0, 0.6], REG = [0.4, 0.75, 1.0];

// ============================================================================ ICE: throttle body
// bore along x (air flows +x), butterfly shaft along y; +z half cut away
export class Throttle {
  constructor(R) {
    const cutOpt = { a0: -PI / 2, a1: PI / 2, cap: PM.cut };
    const toX = M4.model(0, 0, 0, PI / 2);
    const body = new Geo().add(lathe([[0.025, -0.11], [0.036, -0.11], [0.036, 0.11], [0.025, 0.11], [0.025, -0.11]], 36, PM.alu, cutOpt), toX);
    for (const x of [-0.11, 0.11]) body.add(lathe([[0.025, -0.006], [0.062, -0.006], [0.062, 0.006], [0.025, 0.006], [0.025, -0.006]], 36, PM.alu, cutOpt), mul(T(x, 0, 0), toX));
    for (const x of [-0.11, 0.11]) for (const y of [0.035, -0.035]) body.add(shaftX(x - 0.012, x + 0.012, 0.005, PM.steel, y, -0.035, 10));
    // bosses for the shaft, actuator housing, motor, sensor
    body.add(shaftY(0.03, 0.048, 0.012, PM.alu));
    body.add(shaftY(-0.048, -0.03, 0.012, PM.alu));
    body.add(boxAt(-0.07, 0.048, -0.05, 0.06, 0.1, 0.02, PM.black));
    body.add(shaftX(-0.065, 0.02, 0.018, PM.steel, 0.12, -0.02));
    body.add(boxAt(-0.02, -0.075, -0.03, 0.03, -0.048, 0.015, PM.black));
    body.add(boxAt(0.005, -0.07, 0.015, 0.02, -0.055, 0.03, PM.orange));
    this.body = R.mesh(body);
    this.plate = R.mesh(new Geo().add(cylGeo(0.0245, 0.0245, 0.003, 40, true, PM.brass), M4.model(0.0015, 0, 0, 0, PI / 2)).add(shaftY(-0.045, 0.06, 0.004, PM.steel)));
    this.size = 0.32; this.floor = -0.09;
    this.cam = { target: [0, 0.0, 0], dist: 0.62, yaw: 0.55, pitch: 0.38 };
  }
  draw(ctx) {
    const s = ctx.st, th = s.theta ?? 0;
    ctx.add(this.body);
    ctx.add(this.plate, M4.model(0, 0, 0, th));
    // air: amount ~ mass flow, speed ~ volumetric flow
    const k = clamp((s.mth ?? 0) / 0.05, 0, 1.4);
    const n = Math.round(30 + 160 * k);
    for (let i = 0; i < n; i++) {
      const sp = 0.08 + 0.5 * k;
      const ph = fract(h1(i, 7) + ctx.t * sp / 0.42);
      const x = -0.2 + ph * 0.42;
      const rr = Math.sqrt(h1(i, 8)) * 0.022, a = h1(i, 9) * TAU;
      let y = Math.sin(a) * rr, z = Math.cos(a) * rr;
      if (Math.abs(x) < 0.03) {        // squeeze through the open gap around the plate
        const open = Math.max(0.05, 1 - Math.cos(th));
        y *= 0.6 + 0.4 * open; z = Math.sign(z || 1) * (0.024 - Math.abs(z) * open * 0.8);
      }
      const f = Math.min(1, ph * 6, (1 - ph) * 6);
      ctx.glow([x, y, z], 0.0035, s.choked ? [0.85, 0.9, 1.0] : AIR, 0.75 * f);
    }
    ctx.arrow([-0.26, 0, 0], [1, 0, 0], 0.06 + 0.06 * k, "#5ab8ff", 0.004);
    ctx.arrow([0.18, 0, 0], [1, 0, 0], 0.04 + 0.06 * k, "#5ab8ff", 0.004);
    ctx.label([-0.24, 0.035, 0], `air in · p<sub>atm</sub> = 101.3 kPa`);
    ctx.label([0.2, 0.035, 0], `to manifold · p<sub>m</sub> = ${(s.pm / 1000).toFixed(1)} kPa`);
    ctx.label([0.0, -0.035, -0.035], `butterfly θ<sub>th</sub> = ${(th * 180 / PI).toFixed(1)}°`, { ch: null });
    ctx.label([-0.005, 0.105, -0.015], "ETC actuator (DC motor + gears)");
    ctx.label([0.11, -0.065, 0.0], `flow ${s.choked ? "CHOKED · sonic" : "subsonic"} · r = ${(s.r ?? 0).toFixed(3)}`);
  }
}

// ============================================================================ ICE: intake manifold
export class Manifold {
  constructor(R) {
    const toX = M4.model(0, 0, 0, PI / 2);
    const cut = { a0: -PI / 2, a1: PI / 2, cap: PM.cut };
    const shell = [[0, -0.225], [0.08, -0.225], [0.08, 0.225], [0, 0.225], [0, 0.215], [0.072, 0.215], [0.072, -0.215], [0, -0.215], [0, -0.225]];
    const g = new Geo().add(lathe(shell, 40, PM.alu, cut), mul(T(0, 0.22, 0), toX));
    // inlet with a small throttle
    g.add(lathe([[0.026, -0.08], [0.032, -0.08], [0.032, 0.08], [0.026, 0.08], [0.026, -0.08]], 28, PM.alu, cut), mul(T(-0.3, 0.22, 0), toX));
    // cylinder head block with 4 ports
    g.add(boxAt(-0.25, -0.14, -0.24, 0.25, -0.03, -0.05, PM.cast));
    this.ports = [-0.16, -0.055, 0.055, 0.16];
    this.runners = this.ports.map((x) => bez([x, 0.17, -0.03], [x, 0.12, -0.16], [x, 0.04, -0.16], [x, -0.03, -0.145], 14));
    const run = new Geo();
    for (const p of this.runners) run.add(tubeGeo(p, 0.022, 14, PM.alu));
    this.run = R.mesh(run);
    this.body = R.mesh(g);
    const gasM = { color: null, spec: 0.2, shine: 10, glow: 0, flag: 0 };
    this.gas = R.mesh(new Geo().add(lathe([[0, -0.214], [0.071, -0.214], [0.071, 0.214], [0, 0.214]], 40, gasM, { a0: -PI / 2, a1: PI / 2, cap: gasM }), mul(T(0, 0.22, 0), toX)));
    this.plate = R.mesh(new Geo().add(cylGeo(0.0255, 0.0255, 0.003, 32, true, PM.brass), M4.model(0.0015, 0, 0, 0, PI / 2)));
    // pressure gauge
    const gauge = new Geo();
    gauge.add(shaftY(0.3, 0.36, 0.006, PM.steel));
    gauge.add(cylGeo(0.045, 0.045, 0.012, 36, true, PM.black), M4.model(0, 0.4, 0, 0, 0, 1, 1, 1, PI / 2));
    gauge.add(cylGeo(0.04, 0.04, 0.002, 36, true, PM.white), M4.model(0, 0.4, 0.012, 0, 0, 1, 1, 1, PI / 2));
    for (let i = 0; i <= 10; i++) {
      const a = (225 - 27 * i) * PI / 180;
      gauge.add(boxGeo(0.008, 0.0015, 0.002, i % 5 ? PM.dark : PM.red), M4.model(Math.cos(a) * 0.033, 0.4 + Math.sin(a) * 0.033, 0.0145, 0, a));
    }
    this.gauge = R.mesh(gauge);
    this.needle = R.mesh(boxAt(0, -0.0015, 0, 0.032, 0.0015, 0.002, PM.red));
    this.size = 0.6; this.floor = -0.145;
    this.cam = { target: [0, 0.1, -0.05], dist: 1.05, yaw: 0.5, pitch: 0.35 };
  }
  draw(ctx) {
    const s = ctx.st, r = clamp((s.pm ?? 0) / 101325, 0, 1);
    ctx.add(this.body);
    ctx.glass(this.run, null, { alpha: 0.28 });
    const c = pressureCol(r);
    ctx.glass(this.gas, null, { colorLin: c, emissiveLin: c.map((x) => x * 0.35), emissive: "#000", alpha: 0.3 + 0.35 * r, spec: 0.2 });
    ctx.add(this.plate, M4.model(-0.3, 0.22, 0, s.theta ?? 0));
    ctx.add(this.gauge);
    ctx.add(this.needle, M4.model(0, 0.4, 0.016, 0, (225 - 270 * r) * PI / 180));
    // molecules: density ~ p_m (jitter around fixed seeds)
    const n = Math.round(20 + 160 * r);
    for (let i = 0; i < n; i++) {
      const x = -0.2 + h1(i, 3) * 0.4, rr = Math.sqrt(h1(i, 4)) * 0.066, a = -PI / 2 + h1(i, 5) * PI;
      const jx = Math.sin(ctx.t * (3 + h1(i, 6) * 4) + i) * 0.006, jy = Math.cos(ctx.t * (2.5 + h1(i, 7) * 4) + i) * 0.006;
      ctx.glow([x + jx, 0.22 + Math.sin(a) * rr + jy, -Math.cos(a) * rr], 0.004, AIR, 0.7);
    }
    // flows: in through the throttle (m_th), out through the runners (m_cyl)
    const kin = clamp((s.mth ?? 0) / 0.05, 0, 1.4), kout = clamp((s.mcyl ?? 0) / 0.05, 0, 1.4);
    ctx.flow([[-0.42, 0.22, 0], [-0.21, 0.22, 0]], Math.round(10 + 50 * kin), 0.1 + 0.4 * kin, 0.004, AIR, 0.8, 0.03, 11);
    this.runners.forEach((p, i) => ctx.flow(p, Math.round(4 + 22 * kout), 0.08 + 0.35 * kout, 0.0035, AIR, 0.8, 0.02, 20 + i * 3));
    ctx.label([0.1, 0.32, 0], `plenum · V<sub>m</sub> = 3.75 L · p<sub>m</sub> = ${(s.pm / 1000).toFixed(1)} kPa`);
    ctx.label([0, 0.47, 0], `r = p<sub>m</sub>/p<sub>atm</sub> = ${r.toFixed(3)}`);
    ctx.label([-0.34, 0.27, 0], `ṁ<sub>th</sub> = ${((s.mth ?? 0) * 1000).toFixed(1)} g/s`);
    ctx.label([0.16, -0.02, -0.15], `runners → cylinders · ṁ<sub>cyl</sub> = ${((s.mcyl ?? 0) * 1000).toFixed(1)} g/s`);
  }
}

// ============================================================================ ICE: inline-4 engine
const BORE = 0.043, CR = 0.0535, ROD = 0.165, CYLX = [-0.1425, -0.0475, 0.0475, 0.1425], PHASE = [0, PI, PI, 0], FIRE = [0, 3 * PI, PI, 2 * PI];
export class Engine {
  constructor(R) {
    const g = new Geo();
    // liners (cutaway, along y): lathe around z then z->y
    const toY = M4.model(0, 0, 0, 0, 0, 1, 1, 1, -PI / 2);
    for (const x of CYLX) g.add(lathe([[BORE + 0.001, 0.115], [BORE + 0.007, 0.115], [BORE + 0.007, 0.285], [BORE + 0.001, 0.285], [BORE + 0.001, 0.115]], 32, PM.cast, { a0: 0, a1: PI, cap: PM.cut }), mul(T(x, 0, 0), toY));
    // main bearings
    for (const x of [-0.19, -0.095, 0, 0.095, 0.19]) g.add(boxAt(x - 0.012, -0.03, -0.06, x + 0.012, 0.115, -0.045, PM.cast));
    this.block = R.mesh(g);
    // translucent block + head + oil pan
    this.shell = R.mesh(new Geo().add(boxAt(-0.215, 0.05, -0.085, 0.215, 0.285, 0.085, PM.cast)).add(boxAt(-0.215, -0.13, -0.09, 0.215, 0.05, 0.09, PM.dark)));
    const head = new Geo().add(boxAt(-0.215, 0.285, -0.085, 0.215, 0.36, 0.085, PM.alu));
    this.head = R.mesh(head);
    const plugs = new Geo();
    for (const x of CYLX) { plugs.add(shaftY(0.3, 0.39, 0.007, PM.white, x)); plugs.add(shaftY(0.39, 0.41, 0.01, PM.dark, x)); }
    this.plugs = R.mesh(plugs);
    // piston, rod, crankshaft
    const pist = new Geo().add(cylGeo(BORE - 0.001, BORE - 0.001, 0.058, 28, true, PM.alu), T(0, -0.025, 0));
    for (const y of [0.018, 0.026]) pist.add(cylGeo(BORE, BORE, 0.003, 28, false, PM.dark), T(0, y, 0));
    pist.add(shaftX(-0.03, 0.03, 0.009, PM.steel));
    this.piston = R.mesh(pist);
    this.rod = R.mesh(new Geo().add(boxGeo(0.018, 1, 0.012, PM.steel)));
    const crank = new Geo();
    crank.add(shaftX(-0.27, 0.25, 0.024, PM.steel));
    CYLX.forEach((x, i) => {
      const a = PHASE[i], py = Math.cos(a) * CR, pz = Math.sin(a) * CR;
      crank.add(shaftX(x - 0.012, x + 0.012, 0.02, PM.steel, py, pz));
      for (const dx of [-0.019, 0.019]) {
        crank.add(boxGeo(0.014, 0.1, 0.05, PM.steel), M4.model(x + dx, py * 0.45, pz * 0.45, 0, 0, 1, 1, 1, a));
        crank.add(lathe([[0, -0.007], [0.085, -0.007], [0.085, 0.007], [0, 0.007]], 24, PM.cast, { a0: a + 1.5 * PI - 0.95, a1: a + 1.5 * PI + 0.95, cap: PM.cast }), mul(T(x + dx, 0, 0), M4.model(0, 0, 0, PI / 2)));
      }
    });
    crank.add(new Geo().add(gearGeo(0.15, 60, 0.03, PM.steel, { hub: 0.04 })), M4.model(0.27, 0, 0, PI / 2));
    crank.add(shaftX(-0.31, -0.27, 0.06, PM.dark));
    this.crank = R.mesh(crank);
    this.size = 0.7; this.floor = -0.16;
    this.cam = { target: [0, 0.12, 0], dist: 1.25, yaw: 0.5, pitch: 0.3 };
  }
  draw(ctx) {
    const s = ctx.st, phi = ctx.ph.crank ?? 0;
    ctx.add(this.block);
    ctx.glass(this.shell, null, { alpha: 0.13 });
    ctx.glass(this.head, null, { alpha: 0.22 });
    ctx.add(this.plugs);
    // the crank geometry has throw "0" at +y; Rx(phi) turns +y towards +z
    ctx.add(this.crank, M4.model(0, 0, 0, 0, 0, 1, 1, 1, phi));
    const load = clamp((s.Te ?? 0) / 200, 0, 1);
    CYLX.forEach((x, i) => {
      const a = phi + PHASE[i];
      const cy = Math.cos(a) * CR, cz = Math.sin(a) * CR;
      const yp = cy + Math.sqrt(ROD * ROD - cz * cz);
      ctx.add(this.piston, T(x, yp, 0));
      const dy = yp - cy, dz = -cz, L = Math.hypot(dy, dz), al = Math.atan2(dz, dy);
      ctx.add(this.rod, M4.mul(M4.model(x, (yp + cy) / 2, cz / 2, 0, 0, 1, 1, 1, al), M4.model(0, 0, 0, 0, 0, 1, L, 1)));
      // 4-stroke cycle phase of this cylinder (720 deg)
      const cyc = ((((ctx.ph.cycle ?? 0) - FIRE[i]) % (4 * PI)) + 4 * PI) % (4 * PI);
      if (cyc < PI && s.clutch !== false) {
        const k = Math.exp(-cyc * 1.6);
        ctx.glow([x, yp + 0.05, 0], 0.045, [1.0, 0.55, 0.15], (0.25 + 0.75 * load) * k);
        if (cyc < 0.25) ctx.glow([x, 0.3, 0], 0.03, [0.7, 0.8, 1.0], 1.0, 4);
      }
      if (cyc > 2 * PI && cyc < 3 * PI) ctx.glow([x, yp + 0.06, 0.0], 0.03, AIR, 0.35 * (s.pm / 101325));
    });
    // torque on the flywheel
    const Te = s.Te ?? 0;
    ctx.arrow([0.3, 0.155, 0], [0, 0, 1], Te / 900, Te >= 0 ? "#4fc3a1" : "#e5534b", 0.006);
    ctx.label([0.3, 0.2, 0.06], `T<sub>e</sub> = ${Te.toFixed(1)} N·m`);
    ctx.label([-0.1, 0.42, 0], `4 cylinders · V<sub>d</sub> = 2.5 L · η<sub>v</sub> = 0.85`);
    ctx.label([-0.28, -0.04, 0], `crankshaft · ω<sub>e</sub> = G v = ${((s.we ?? 0) * 60 / TAU).toFixed(0)} rpm`);
    ctx.label([0.27, -0.17, 0], "flywheel (I<sub>e</sub>)");
    ctx.label([0.0, 0.2, 0.05], "pistons · rods");
  }
}

// ============================================================================ ICE: gearbox + final drive + differential
// diff centre at origin, all shafts along x (transverse transaxle)
const RATIOS = [3.6, 2.1, 1.45, 1.21, 0.95], C1 = 0.12, FD = 3.39, RP = 0.034, RR = RP * FD;
export class Gearbox {
  constructor(R) {
    this.yIn = RP + RR + C1; this.yCt = RP + RR;
    this.gx = [-0.48, -0.42, -0.36, -0.3, -0.24];
    this.inG = []; this.outG = [];
    RATIOS.forEach((k, j) => {
      const ri = C1 / (1 + k), ro = C1 - ri;
      const hi = j === 3 ? { color: "#e3b341", spec: 0.85, shine: 90, glow: 0, flag: 0 } : PM.steel;
      this.inG.push(R.mesh(gearGeo(ri, Math.max(10, Math.round(ri * 520)), 0.022, hi)));
      this.outG.push(R.mesh(gearGeo(ro, Math.max(10, Math.round(ro * 520)), 0.022, hi)));
    });
    this.inS = R.mesh(shaftX(-0.66, -0.2, 0.012, PM.steel));
    this.ctS = R.mesh(shaftX(-0.53, -0.045, 0.014, PM.steel));
    this.clutch = R.mesh(new Geo().add(cylGeo(0.1, 0.1, 0.012, 36, true, PM.pad), M4.model(-0.62, 0, 0, 0, -PI / 2)).add(cylGeo(0.105, 0.105, 0.01, 36, true, PM.steel), M4.model(-0.64, 0, 0, 0, -PI / 2)));
    this.sync = R.mesh(new Geo().add(lathe([[0.016, -0.012], [0.04, -0.012], [0.04, 0.012], [0.016, 0.012], [0.016, -0.012]], 28, PM.brass), M4.model(0, 0, 0, PI / 2)));
    this.pin = R.mesh(gearGeo(RP, 12, 0.03, PM.steel));
    this.ring = R.mesh(gearGeo(RR, 40, 0.03, PM.steel, { hub: 0.05 }));
    const diff = new Geo().add(sphereGeo(0.065, 20, 12, PM.cast));
    for (const a of [0, PI]) diff.add(coneGeo(0.03, 0.03, 14, PM.steel, true), M4.model(0, Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0, 0, 1, 1, 1, a + PI));
    this.diff = R.mesh(diff);
    const half = new Geo();
    for (const sg of [1, -1]) {
      half.add(shaftX(Math.min(sg * 0.07, sg * 0.66), Math.max(sg * 0.07, sg * 0.66), 0.013, PM.steel));
      for (const x of [0.12, 0.62]) { half.add(sphereGeo(0.032, 16, 10, PM.steel), T(sg * x, 0, 0)); half.add(cylGeo(0.035, 0.02, 0.07, 16, true, PM.rubber), M4.model(sg * (x + 0.04), 0, 0, 0, sg > 0 ? -PI / 2 : PI / 2)); }
      half.add(cylGeo(0.07, 0.07, 0.02, 24, true, PM.steel), M4.model(sg * 0.68, 0, 0, 0, sg > 0 ? -PI / 2 : PI / 2));
    }
    this.half = R.mesh(half);
    this.case = R.mesh(boxAt(-0.68, -0.15, -0.13, 0.1, this.yIn + 0.08, 0.13, PM.alu));
    this.size = 0.9; this.floor = -0.2;
    this.cam = { target: [-0.25, 0.1, 0], dist: 1.45, yaw: 0.45, pitch: 0.34 };
  }
  draw(ctx) {
    const s = ctx.st, pe = ctx.ph.crank ?? 0, yI = this.yIn, yC = this.yCt;
    const pc = -pe / RATIOS[3], pd = pe / (RATIOS[3] * FD);
    ctx.glass(this.case, null, { alpha: 0.1 });
    ctx.add(this.clutch, M4.model(0, yI, 0, 0, 0, 1, 1, 1, pe));
    ctx.add(this.inS, M4.model(0, yI, 0, 0, 0, 1, 1, 1, pe));
    ctx.add(this.ctS, M4.model(0, yC, 0, 0, 0, 1, 1, 1, pc));
    RATIOS.forEach((k, j) => {
      ctx.add(this.inG[j], onX(this.gx[j], yI, 0, pe));
      ctx.add(this.outG[j], onX(this.gx[j], yC, 0, -pe / k));
    });
    ctx.add(this.sync, M4.mul(M4.model(this.gx[3] + 0.033, yC, 0), M4.model(0, 0, 0, 0, 0, 1, 1, 1, pc)));
    ctx.add(this.pin, onX(-0.075, yC, 0, pc));
    ctx.add(this.ring, onX(-0.075, 0, 0, pd));
    ctx.add(this.diff, M4.model(0, 0, 0, 0, 0, 1, 1, 1, pd));
    ctx.add(this.half, M4.model(0, 0, 0, 0, 0, 1, 1, 1, pd));
    // power flow (green = traction, red = engine braking)
    const P = (s.Ft ?? 0) * (s.v ?? 0), k = clamp(Math.abs(P) / 60000, 0, 1.2);
    const col = P >= 0 ? POW : [1.0, 0.45, 0.35], sp = (P >= 0 ? 1 : -1) * (0.15 + 0.35 * k);
    if (s.clutch !== false) {
      const path = [[-0.66, yI + 0.02, 0], [this.gx[3], yI + 0.02, 0], [this.gx[3], yC + 0.02, 0], [-0.075, yC + 0.02, 0], [-0.075, 0.05, 0], [0, 0.05, 0], [0.66, 0.02, 0]];
      ctx.flow(path, Math.round(8 + 40 * k), sp, 0.007, col, 0.9, 0.01, 5);
      ctx.flow([[0, 0.02, 0], [-0.66, 0.02, 0]], Math.round(4 + 20 * k), sp, 0.007, col, 0.9, 0.01, 6);
    }
    ctx.label([-0.62, yI + 0.12, 0], `clutch · ω<sub>e</sub> = ${((s.we ?? 0) * 60 / TAU).toFixed(0)} rpm ${s.clutch === false ? "· OPEN (v &lt; v<sub>min</sub>)" : ""}`);
    ctx.label([this.gx[3], yI + 0.09, 0], "4th gear 1.21 (engaged)");
    ctx.label([-0.075, -0.13, 0], `final drive ${FD} · differential`);
    ctx.label([0.5, 0.06, 0], `half-shafts · ω<sub>w</sub> = v/r<sub>w</sub> = ${((s.v ?? 0) / 0.3).toFixed(1)} rad/s`);
    ctx.label([-0.36, -0.07, 0.1], `i = 1.21 × 3.39 = 4.1 · η<sub>t</sub> = 0.92`);
  }
}

// ============================================================================ friction brake (common)
export class Brake {
  constructor(R, opts = {}) {
    const disc = new Geo();
    for (const z of [-0.017, 0.009]) disc.add(lathe([[0.09, z], [0.16, z], [0.16, z + 0.008], [0.09, z + 0.008], [0.09, z]], 48, PM.disc));
    for (let k = 0; k < 36; k++) { const a = (k / 36) * TAU; disc.add(boxGeo(0.07, 0.006, 0.018, PM.disc), M4.model(Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0, 0, a + 0.3)); }
    disc.add(lathe([[0.03, -0.017], [0.095, -0.017], [0.095, -0.009], [0.08, -0.009], [0.08, 0.04], [0.03, 0.04], [0.03, -0.017]], 40, PM.steel));
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; disc.add(shaftX(-0.006, 0.006, 0.006, PM.chip), mul(M4.model(Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0.045, -PI / 2))); }
    this.disc = R.mesh(disc);
    const cal = new Geo(), ca = PI * 0.15;
    for (let k = -2; k <= 2; k++) {
      const a = ca + k * 0.14;
      cal.add(boxGeo(0.05, 0.06, 0.085, PM.red), M4.model(Math.cos(a) * 0.15, Math.sin(a) * 0.15, -0.004, 0, a));
    }
    cal.add(boxGeo(0.03, 0.05, 0.075, { ...PM.white }), M4.model(Math.cos(ca) * 0.15, Math.sin(ca) * 0.15, 0.0, 0, ca, 0.2, 0.3, 1));
    this.cal = R.mesh(cal);
    const pad = new Geo();
    for (let k = -2; k <= 2; k++) { const a = ca + k * 0.12; pad.add(boxGeo(0.045, 0.05, 0.008, PM.pad), M4.model(Math.cos(a) * 0.135, Math.sin(a) * 0.135, 0, 0, a)); }
    this.pad = R.mesh(pad);
    this.hose = R.mesh(tubeGeo(bez([Math.cos(ca) * 0.2, Math.sin(ca) * 0.2, -0.03], [0.3, 0.12, -0.1], [0.32, 0.3, -0.12], [0.25, 0.42, -0.15], 18), 0.006, 10, PM.rubber));
    this.knuckle = R.mesh(new Geo().add(boxAt(-0.03, -0.2, -0.09, 0.03, 0.2, -0.06, PM.cast)).add(shaftX(-0.02, 0.02, 0.035, PM.cast), M4.model(0, 0, -0.075, PI / 2)));
    if (!opts.noTire) {
      const w = MD.buildCar("sedan", 4.5, { interior: false }).wheel;
      this.tire = R.mesh(w);
    }
    this.size = 0.8; this.floor = -0.3;
    this.cam = { target: [0, 0, -0.05], dist: 1.75, yaw: -2.35, pitch: 0.3 };
  }
  draw(ctx, o = {}) {
    const s = ctx.st, pw = ctx.ph.wheel ?? 0;
    const fb = clamp((s.Fb ?? 0) / 15225, 0, 1);
    ctx.add(this.disc, M4.model(0, 0, -0.07, 0, pw), { glow: heat(Math.min(5, (ctx.ph.heat ?? 0) * 5)) });
    ctx.add(this.cal, M4.model(0, 0, -0.07));
    const gap = 0.004 * (1 - Math.min(1, fb * 12));
    for (const sg of [1, -1]) ctx.add(this.pad, M4.model(0, 0, -0.07 + sg * (0.0165 + 0.004 + gap)));
    if (!o.inCar) {
      ctx.add(this.hose, M4.model(0, 0, -0.07));
      ctx.add(this.knuckle);
      if (this.tire) ctx.glass(this.tire, M4.model(0, 0, 0.045, 0, pw), { alpha: 0.16 });
      const pr = clamp((s.Fbcmd ?? 0) / 15225, 0, 1);
      ctx.flow(bez([0.25, 0.42, -0.22], [0.32, 0.3, -0.19], [0.3, 0.12, -0.17], [Math.cos(PI * 0.15) * 0.2, Math.sin(PI * 0.15) * 0.2, -0.1], 12), Math.round(4 + 24 * pr), -0.05 - 0.3 * pr, 0.006, [1, 0.35, 0.25], pr > 0.002 ? 0.9 : 0, 0.005, 3);
      const Fb = s.Fb ?? 0, Ft = s.Ft ?? 0;
      ctx.arrow([0, -0.3, 0], [-1, 0, 0], Fb / 25000, "#e5534b", 0.008);
      ctx.arrow([0, -0.29, 0.03], [1, 0, 0], Ft / 25000, "#4fc3a1", 0.008);
      ctx.label([0.12, 0.2, -0.1], `caliper · F<sub>b</sub> = ${(Fb / 1000).toFixed(2)} kN (cmd ${((s.Fbcmd ?? 0) / 1000).toFixed(2)})`);
      ctx.label([-0.17, -0.05, -0.08], "ventilated disc");
      ctx.label([0.25, 0.45, -0.15], "hydraulic line · 70 ms delay + 80 ms lag");
      ctx.label([0, -0.33, 0.06], `contact patch · r<sub>w</sub> = 0.3 m`);
    }
  }
}

// ============================================================================ vehicle body + forces (common)
export class Body {
  constructor(R, style) {
    this.c = MD.buildCar(style, 4.5, { interior: true });
    const c = this.c;
    this.m = { body: R.mesh(c.body), glass: R.mesh(c.glass), inter: R.mesh(c.interior), wheel: R.mesh(c.wheel), chassis: R.mesh(c.chassis) };
    this.road = R.mesh(MD.planeGeo(-0.5, 0.5, -0.5, 0.5));
    this.box = R.mesh(boxGeo(1, 1, 1));
    this.style = style;
    this.size = 6; this.floor = -0.02;
    this.cam = { target: [-2.25, 0.8, 0], dist: 8.5, yaw: 0.6, pitch: 0.28 };
    this.paint = style === "ev" ? "#1fae8a" : "#e8732a";
  }
  topAt(x) {        // silhouette height (car frame x)
    const c = this.c, s = -x / c.L;
    if (s < 0 || s > 1) return 0;
    const G = c.G;
    if (s >= G.A0 && s <= G.C0) return Math.max(c.beltOf(s), c.roofOf(s));
    return c.beltOf(s);
  }
  draw(ctx, o = {}) {
    const s = ctx.st, c = this.c, L = c.L, pw = ctx.ph.wheelReal ?? 0;
    const beta = o.flat ? 0 : (s.beta ?? 0);
    const B = ctx.sub(M4.model(0, 0, 0, 0, beta));
    if (!o.ghost) {
      // road segment that moves with x
      B.add(this.road, M4.model(-2.25, 0, -1.8, 0, 0, 40, 1, 7.4), { color: "#4c5158", kind: 0, spec: 0.05 });
      B.add(this.road, M4.model(-2.25, -0.01, 0, 0, 0, 40, 1, 16), { color: "#56683f", kind: 2 });
      const xo = ((s.x ?? 0) % 12 + 12) % 12;
      for (let k = -2; k < 3; k++) B.add(this.box, M4.model(-2.25 + k * 12 - xo, 0.006, -1.8, 0, 0, 4, 0.006, 0.13), { color: "#e9e9e2", kind: 9 }, { cast: false });
      for (const z of [1.85, -5.45]) B.add(this.box, M4.model(-2.25, 0.006, z, 0, 0, 40, 0.006, 0.14), { color: "#e9e9e2", kind: 9 }, { cast: false });
    }
    const mat = { color: this.paint, spec: 0.9, shine: 120, refl: 1 };
    const glow = new Float32Array(8); glow[2] = (s.Fb ?? 0) > 50 ? 14 : 1; glow[3] = (s.Fb ?? 0) > 50 ? 14 : 0; glow[5] = 4; glow[1] = 0.5;
    if (o.ghost) {
      B.glass(this.m.body, null, { colorLin: lin(this.paint), alpha: 0.09, spec: 0.5 });
      B.glass(this.m.glass, null, { alpha: 0.1 });
    } else {
      B.add(this.m.body, null, { ...mat, glow });
      B.add(this.m.inter, null, { glow });
      B.glass(this.m.glass, null, { alpha: 0.6, flags: 2, spec: 1, shine: 200, refl: 1 }, { noCull: false });
      B.add(this.m.chassis);
    }
    for (const ax of c.axles) for (const sg of [1, -1]) B.add(this.m.wheel, M4.model(ax, c.wr, sg * c.track, 0, -pw, 1, 1, sg), {}, { noCull: true });
    if (o.ghost) return;
    // forces (scale 1 m per 1500 N)
    const K = 1 / 1500, cg = [-L / 2, 0.55, 0];
    const drive = this.style === "ev" ? c.axles[1] : c.axles[0];
    const Ft = s.Ft ?? 0, Fb = s.Fb ?? 0, Fa = s.Faero ?? 0, Fr = s.Froll ?? 0, Fg = s.Fgrade ?? 0;
    for (const sg of [1, -1]) {
      B.arrow([drive, 0.03, sg * c.track], [1, 0, 0], Ft / 2 * K, Ft >= 0 ? "#4fc3a1" : "#e5534b", 0.035);
      for (const ax of c.axles) {
        B.arrow([ax, 0.06, sg * (c.track + 0.18)], [-1, 0, 0], Fb / 4 * K, "#e5534b", 0.03);
        B.arrow([ax, 0.02, sg * (c.track - 0.2)], [-1, 0, 0], Fr / 4 * K * 3, "#e3b341", 0.022);
      }
    }
    const la = Fa * K * 1.5;
    B.arrow([0.25 + la, 0.62, 0], [-1, 0, 0], la, "#5ab8ff", 0.04);
    if (Math.abs(Fg) > 1) B.arrow([cg[0] + 0.5, 1.75, 0], [-1, 0, 0], Fg * K, "#b48cff", 0.04);
    // airflow streamlines (relative to the car)
    const vv = Math.max(0, s.v ?? 0), k = clamp(vv / 40, 0, 1);
    if (vv > 0.5) {
      const lines = [[0.35, -0.45], [0.6, 0.0], [0.6, 0.45], [1.05, -0.3], [1.05, 0.3], [1.55, 0], [1.9, -0.4], [1.9, 0.4]];
      lines.forEach(([y0, z], li) => {
        const n = 26;
        for (let i = 0; i < n; i++) {
          const ph = fract(h1(i, li + 30) + ctx.t * (0.25 + 0.5 * k));
          const x = 3.0 - ph * 11;
          let top = 0;
          for (let dx = -0.6; dx <= 0.6; dx += 0.3) top = Math.max(top, this.topAt(x + dx));
          const wake = x < -L ? Math.exp((x + L) * 0.8) : 1;
          const lift = Math.max(0, top + 0.12 - y0 * 0.55) * (x < -L ? wake : 1);
          const tur = x < -L ? Math.sin(ctx.t * 9 + i * 1.7 + li) * 0.08 * (1 - wake) : 0;
          B.glow([x, y0 + lift + tur, z * (1 + 0.25 * lift)], 0.035, [0.55, 0.85, 1.0], 0.55 * k * Math.min(1, ph * 8, (1 - ph) * 8));
        }
      });
    }
    B.label([0.35, 0.85, 0], `aero c<sub>a</sub>v² = ${Fa.toFixed(0)} N`);
    B.label([drive, -0.1, c.track + 0.3], `F<sub>t</sub> = ${Ft.toFixed(0)} N`);
    if (Fb > 1) B.label([c.axles[1], -0.1, -(c.track + 0.4)], `F<sub>b</sub> = ${Fb.toFixed(0)} N`);
    B.label([-L - 0.2, 0.15, c.track], `rolling C<sub>r</sub>mg = ${Fr.toFixed(0)} N`);
    if (Math.abs(Fg) > 1) B.label([cg[0], 2.0, 0], `grade mg sinβ = ${Fg.toFixed(0)} N`);
    B.label([cg[0], 1.85, 0], `m = 1940 kg · m<sub>eff</sub> = ${this.style === "ev" ? "2162.2" : "2021.8"} kg · v = ${vv.toFixed(1)} m/s`);
  }
}

// ============================================================================ EV: battery pack
export class Battery {
  constructor(R) {
    const g = new Geo();
    g.add(boxAt(-0.8, 0, -0.55, 0.8, 0.03, 0.55, PM.cast));
    for (const z of [-0.55, 0.55]) g.add(boxAt(-0.8, 0, z - 0.015, 0.8, 0.13, z + 0.015, PM.cast));
    for (const x of [-0.8, 0.8]) g.add(boxAt(x - 0.015, 0, -0.55, x + 0.015, 0.13, 0.55, PM.cast));
    const cells = new Geo();
    this.mods = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
      const x0 = -0.72 + i * 0.245, z0 = j ? 0.04 : -0.49;
      this.mods.push([x0 + 0.1, z0 + 0.225]);
      g.add(boxAt(x0, 0.03, z0, x0 + 0.21, 0.1, z0 + 0.45, PM.dark));
      for (let a = 0; a < 5; a++) for (let b = 0; b < 11; b++) cells.add(cylGeo(0.0095, 0.0095, 0.012, 10, true, PM.cell), T(x0 + 0.022 + a * 0.042, 0.1, z0 + 0.02 + b * 0.041));
      g.add(boxAt(x0 + 0.01, 0.112, z0 + 0.01, x0 + 0.2, 0.116, z0 + 0.025, PM.copper));
      g.add(boxAt(x0 + 0.01, 0.112, z0 + 0.425, x0 + 0.2, 0.116, z0 + 0.44, PM.copper));
    }
    // BMS + HV connector + coolant
    g.add(boxAt(0.6, 0.11, -0.12, 0.76, 0.115, 0.12, PM.pcb));
    for (let k = 0; k < 5; k++) g.add(boxAt(0.62 + (k % 3) * 0.045, 0.115, -0.1 + Math.floor(k / 3) * 0.1, 0.65 + (k % 3) * 0.045, 0.125, -0.07 + Math.floor(k / 3) * 0.1, PM.chip));
    g.add(boxAt(0.8, 0.03, -0.12, 0.88, 0.11, 0.12, PM.orange));
    for (const z of [-0.53, 0.53]) g.add(tubeGeo([[-0.8, 0.05, z], [0.8, 0.05, z]], 0.012, 10, PM.blue));
    this.pack = R.mesh(g); this.cells = R.mesh(cells);
    this.lid = R.mesh(boxAt(-0.8, 0.13, -0.55, 0.8, 0.14, 0.55, PM.cast));
    this.cablePath = [[[0.88, 0.07, -0.06], [1.05, 0.07, -0.06], [1.2, 0.25, -0.06], [1.4, 0.3, -0.06]], [[0.88, 0.07, 0.06], [1.05, 0.07, 0.06], [1.2, 0.25, 0.06], [1.4, 0.3, 0.06]]];
    const cab = new Geo();
    for (const p of this.cablePath) cab.add(tubeGeo(bez(p[0], p[1], p[2], p[3], 14), 0.014, 10, PM.orange));
    this.cab = R.mesh(cab);
    this.size = 2.0; this.floor = -0.001;
    this.cam = { target: [0.1, 0.05, 0], dist: 2.6, yaw: 0.6, pitch: 0.55 };
  }
  draw(ctx, o = {}) {
    const s = ctx.st;
    ctx.add(this.pack); ctx.add(this.cells, null, { glow: glowArr({}) });
    if (!o.inCar) ctx.glass(this.lid, null, { alpha: 0.12 });
    ctx.add(this.cab);
    const ib = s.ibat ?? 0, k = clamp(Math.abs(ib) / 300, 0, 1.3);
    const sp = (ib >= 0 ? 1 : -1) * (0.1 + 0.6 * k);
    this.cablePath.forEach((p, i) => ctx.flow(bez(p[0], p[1], p[2], p[3], 12), Math.round(6 + 30 * k), i ? -sp : sp, 0.01, ib >= 0 ? CUR : REG, Math.abs(ib) > 0.5 ? 0.9 : 0, 0.008, 40 + i));
    // charge glow in the modules ~ power
    const P = (s.Vc ?? 0) * (s.ia ?? 0);
    this.mods.forEach((m, i) => ctx.glow([m[0], 0.13, m[1]], 0.09, P >= 0 ? CUR : REG, clamp(Math.abs(P) / 120000, 0, 1) * 0.35 * (0.7 + 0.3 * Math.sin(ctx.t * 3 + i))));
    ctx.glow([0.62, 0.13, -0.1], 0.012, [0.3, 1, 0.5], 0.8 + 0.2 * Math.sin(ctx.t * 6));
    if (o.inCar) return;
    ctx.label([-0.2, 0.25, -0.25], "12 modules · cells (ideal source)");
    ctx.label([0.68, 0.2, 0], "BMS (not modelled)");
    ctx.label([1.2, 0.36, 0], `HV cables · i<sub>bat</sub> = D·i<sub>a</sub> = ${ib.toFixed(1)} A ${ib < -0.5 ? "(charging · regen)" : ""}`);
    ctx.label([-0.6, 0.25, 0.4], `V<sub>bat</sub> = 400 V constant · P = ${(P / 1000).toFixed(1)} kW`);
  }
}

// ============================================================================ EV: DC-DC half-bridge converter
export class Converter {
  constructor(R) {
    const g = new Geo();
    g.add(boxAt(-0.16, 0, -0.11, 0.16, 0.012, 0.11, PM.alu));
    for (let k = 0; k < 14; k++) g.add(boxAt(-0.155 + k * 0.0225, -0.05, -0.11, -0.149 + k * 0.0225, 0, 0.11, PM.alu));
    g.add(boxAt(-0.15, 0.012, -0.1, 0.15, 0.016, 0.1, PM.pcb));
    this.sw = [[-0.06, 0.03], [-0.06, -0.04]];     // S1 high side, S2 low side (x, z)
    for (const [x, z] of this.sw) { g.add(boxAt(x - 0.045, 0.016, z - 0.025, x + 0.045, 0.036, z + 0.025, PM.chip)); for (let p = 0; p < 3; p++) g.add(boxAt(x + 0.045, 0.02, z - 0.015 + p * 0.015, x + 0.06, 0.024, z - 0.01 + p * 0.015, PM.steel)); }
    g.add(cylGeo(0.035, 0.035, 0.1, 28, true, { color: "#2c4f8a", spec: 0.5, shine: 40, glow: 0, flag: 0 }), T(0.09, 0.016, 0.03));
    g.add(cylGeo(0.036, 0.036, 0.01, 28, true, PM.steel), T(0.09, 0.115, 0.03));
    g.add(boxAt(0.04, 0.016, -0.08, 0.075, 0.022, -0.055, PM.chip));
    for (let k = 0; k < 6; k++) g.add(boxAt(0.0 + (k % 3) * 0.02, 0.016, -0.09 + Math.floor(k / 3) * 0.015, 0.012 + (k % 3) * 0.02, 0.02, -0.084 + Math.floor(k / 3) * 0.015, PM.chip));
    g.add(boxAt(-0.13, 0.036, -0.06, -0.12, 0.04, 0.06, PM.copper));
    g.add(boxAt(-0.13, 0.04, -0.005, 0.0, 0.044, 0.005, PM.copper));
    this.board = R.mesh(g);
    this.leds = this.sw.map(([x, z]) => [x + 0.03, 0.04, z + 0.018]);
    this.inP = [[[0.38, 0.03, 0.06], [0.25, 0.03, 0.06], [0.18, 0.04, 0.05], [0.12, 0.06, 0.03]], [[0.38, 0.03, -0.06], [0.25, 0.03, -0.06], [0.18, 0.04, -0.06], [0.12, 0.03, -0.04]]];
    this.outP = [[0.0, 0.05, 0.0], [-0.12, 0.06, 0.0], [-0.22, 0.05, 0.0], [-0.38, 0.03, 0.0]];
    const cab = new Geo();
    for (const p of this.inP) cab.add(tubeGeo(bez(p[0], p[1], p[2], p[3], 10), 0.01, 10, PM.orange));
    cab.add(tubeGeo(bez(...this.outP, 10), 0.012, 10, PM.orange));
    this.cab = R.mesh(cab);
    this.lid = R.mesh(boxAt(-0.16, 0.012, -0.11, 0.16, 0.13, 0.11, PM.alu));
    this.size = 0.5; this.floor = -0.05;
    this.cam = { target: [-0.02, 0.02, 0], dist: 1.0, yaw: 0.45, pitch: 0.62 };
  }
  draw(ctx, o = {}) {
    const s = ctx.st, D = s.D ?? 0;
    ctx.add(this.board); ctx.add(this.cab);
    if (o.inCar) ctx.add(this.lid);
    // PWM shown slowed down: period 1.2 s, S1 on for D of the period
    const ph = fract(ctx.t / 1.2), on1 = ph < D;
    ctx.glow(this.leds[0], 0.012, [0.3, 1.0, 0.5], on1 ? 1 : 0.08, 1);
    ctx.glow(this.leds[1], 0.012, [1.0, 0.4, 0.3], on1 ? 0.08 : 1, 1);
    const ia = s.ia ?? 0, k = clamp(Math.abs(ia) / 300, 0, 1.3), sg = ia >= 0 ? 1 : -1;
    ctx.flow(bez(...this.outP, 10), Math.round(6 + 30 * k), -sg * (0.05 + 0.3 * k), 0.006, ia >= 0 ? CUR : REG, Math.abs(ia) > 0.5 ? 0.9 : 0, 0.006, 51);
    if (on1) this.inP.forEach((p, i) => ctx.flow(bez(p[0], p[1], p[2], p[3], 8), Math.round(4 + 16 * k), (i ? 1 : -1) * sg * (0.05 + 0.3 * k), 0.006, ia >= 0 ? CUR : REG, Math.abs(ia) > 0.5 ? 0.9 : 0, 0.006, 61 + i));
    if (o.inCar) return;
    ctx.label([-0.06, 0.07, 0.06], `S1 high side ${on1 ? "ON" : "off"} (D = ${D.toFixed(3)})`);
    ctx.label([-0.06, 0.07, -0.07], `S2 low side ${on1 ? "off" : "ON"}`);
    ctx.label([0.09, 0.16, 0.03], "DC-link capacitor");
    ctx.label([0.34, 0.07, 0.0], "from battery · 400 V");
    ctx.label([-0.33, 0.08, 0], `to motor · V<sub>c</sub> = D·V<sub>bat</sub> = ${(s.Vc ?? 0).toFixed(1)} V`);
    ctx.label([0.0, -0.07, 0.11], "heat sink · PWM slowed for display");
  }
}

// ============================================================================ EV: permanent-magnet DC motor (axis x)
export class Motor {
  constructor(R) {
    const toX = M4.model(0, 0, 0, PI / 2), cut = { a0: -PI / 2, a1: PI / 2, cap: PM.cut };
    const g = new Geo();
    g.add(lathe([[0.108, -0.15], [0.12, -0.15], [0.12, 0.15], [0.108, 0.15], [0.108, -0.15]], 48, PM.steel, cut), toX);
    g.add(lathe([[0.02, -0.165], [0.12, -0.165], [0.12, -0.15], [0.02, -0.15], [0.02, -0.165]], 48, PM.cast, cut), toX);
    g.add(lathe([[0.02, 0.15], [0.12, 0.15], [0.12, 0.165], [0.02, 0.165], [0.02, 0.15]], 48, PM.cast, cut), toX);
    // magnets: N on top (y>0), S at the bottom
    g.add(lathe([[0.084, -0.11], [0.107, -0.11], [0.107, 0.11], [0.084, 0.11], [0.084, -0.11]], 24, PM.magN, { a0: PI / 6, a1: PI / 2, cap: PM.magN }), toX);
    g.add(lathe([[0.084, -0.11], [0.107, -0.11], [0.107, 0.11], [0.084, 0.11], [0.084, -0.11]], 24, PM.magS, { a0: -PI / 2, a1: -PI / 6, cap: PM.magS }), toX);
    // brush holders + springs
    for (const sg of [1, -1]) {
      g.add(boxAt(0.105, sg * 0.05 - 0.016, -0.016, 0.135, sg * 0.08 + 0.016 * sg, 0.016, PM.dark));
      const coil = [];
      for (let k = 0; k <= 60; k++) { const a = k * 0.6; coil.push([0.12 + Math.cos(a) * 0.008, sg * (0.075 + k * 0.0006), Math.sin(a) * 0.008]); }
      g.add(tubeGeo(coil, 0.0016, 6, PM.steel));
    }
    this.stator = R.mesh(g);
    const rot = new Geo(), cop = new Geo();
    rot.add(lathe([[0.012, -0.1], [0.075, -0.1], [0.075, 0.1], [0.012, 0.1], [0.012, -0.1]], 48, PM.dark), toX);
    this.slots = 12;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      cop.add(boxGeo(0.2, 0.016, 0.014, PM.copper), M4.model(0, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0, 0, 1, 1, 1, a));
    }
    for (const x of [-0.105, 0.105]) cop.add(lathe([[0.04, -0.008], [0.072, -0.008], [0.072, 0.008], [0.04, 0.008], [0.04, -0.008]], 32, PM.copper), mul(T(x, 0, 0), toX));
    for (let k = 0; k < 12; k++) {      // commutator segments
      const a = (k / 12) * TAU;
      rot.add(lathe([[0.024, 0.115], [0.036, 0.115], [0.036, 0.155], [0.024, 0.155], [0.024, 0.115]], 4, PM.copper, { a0: a + 0.03, a1: a + TAU / 12 - 0.03 }), toX);
    }
    rot.add(shaftX(-0.26, 0.2, 0.016, PM.steel));
    rot.add(gearGeo(0.028, 14, 0.03, PM.steel), M4.model(-0.24, 0, 0, PI / 2));
    this.rotor = R.mesh(rot); this.copper = R.mesh(cop);
    this.brush = R.mesh(boxAt(-0.008, 0, -0.01, 0.008, 0.03, 0.01, PM.carbon));
    this.size = 0.6; this.floor = -0.125;
    this.cam = { target: [-0.02, 0, 0], dist: 0.95, yaw: 0.5, pitch: 0.3 };
  }
  draw(ctx, o = {}) {
    const s = ctx.st, pm = ctx.ph.motor ?? 0;
    ctx.add(this.stator);
    const ia = s.ia ?? 0, k = clamp(Math.abs(ia) / 400, 0, 1.5);
    const glow = new Float32Array(8);
    ctx.add(this.rotor, M4.model(0, 0, 0, 0, 0, 1, 1, 1, pm));
    ctx.add(this.copper, M4.model(0, 0, 0, 0, 0, 1, 1, 1, pm), { emissive: "#000", emissiveLin: [1.6 * k, 0.6 * k, 0.12 * k], glow });
    for (const sg of [1, -1]) ctx.add(this.brush, M4.model(0.135, sg * 0.036, 0, 0, 0, 1, sg, 1));
    // field lines N -> rotor -> S, returning through the yoke
    for (let l = 0; l < 7; l++) {
      const zz = -0.06 + l * 0.02, x = -0.09 + (l % 4) * 0.06;
      const pts = [[x, 0.085, zz], [x, 0.0, zz * 0.6], [x, -0.085, zz]];
      ctx.flow(pts, 6, 0.08, 0.005, [0.55, 0.65, 1.0], 0.55, 0, 70 + l);
      ctx.flow([[x, -0.1, -0.02], [x, -0.112, -0.09], [x, 0, -0.114], [x, 0.112, -0.09], [x, 0.1, -0.02]], 6, 0.08, 0.004, [0.55, 0.65, 1.0], 0.35, 0, 80 + l);
    }
    if (Math.abs(ia) > 0.5) ctx.glow([0.135, 0, 0], 0.02, [0.6, 0.8, 1.0], clamp(k, 0.2, 1) * (0.5 + 0.5 * Math.sin(ctx.t * 40)), 4);
    const Te = s.Te ?? 0;
    ctx.arrow([-0.2, 0.06, 0.0], [0, 0, 1], Te / 700, Te >= 0 ? "#4fc3a1" : "#5ab8ff", 0.005);
    if (o.inCar) return;
    ctx.label([0, 0.16, -0.03], "N magnet · k<sub>t</sub> = k<sub>e</sub> = 0.25");
    ctx.label([0, -0.16, -0.03], "S magnet");
    ctx.label([-0.05, 0.03, 0.08], `armature · R<sub>a</sub> = 0.05 Ω · L<sub>a</sub> = 1 mH · i<sub>a</sub> = ${ia.toFixed(1)} A`);
    ctx.label([0.17, 0.07, 0], "commutator + brushes");
    ctx.label([-0.25, 0.09, 0], `T<sub>e</sub> = k<sub>t</sub> i<sub>a</sub> = ${Te.toFixed(1)} N·m`);
    ctx.label([-0.1, -0.12, 0.05], `back-EMF e = k<sub>e</sub>ω<sub>m</sub> = ${(0.25 * (s.wm ?? 0)).toFixed(1)} V · ${((s.wm ?? 0) * 60 / TAU).toFixed(0)} rpm`);
  }
}

// ============================================================================ EV: reduction gear i = 10 (two stages) + differential
export class Reduction {
  constructor(R) {
    const r1 = 0.028, R1 = r1 * 10 / 3, r2 = 0.035, R2 = r2 * 3;
    this.yM = R2 + r2 + r1 + R1; this.yI = R2 + r2; this.r = { r1, R1, r2, R2 };
    this.g1 = R.mesh(gearGeo(r1, 14, 0.03, { color: "#e3b341", spec: 0.85, shine: 90, glow: 0, flag: 0 }));
    this.g2 = R.mesh(gearGeo(R1, 47, 0.03, { color: "#e3b341", spec: 0.85, shine: 90, glow: 0, flag: 0 }));
    this.g3 = R.mesh(gearGeo(r2, 15, 0.034, PM.steel));
    this.g4 = R.mesh(gearGeo(R2, 45, 0.034, PM.steel, { hub: 0.04 }));
    this.sM = R.mesh(shaftX(-0.42, -0.1, 0.014, PM.steel));
    this.sI = R.mesh(shaftX(-0.33, -0.08, 0.014, PM.steel));
    const half = new Geo();
    for (const sg of [1, -1]) {
      half.add(shaftX(Math.min(sg * 0.06, sg * 0.62), Math.max(sg * 0.06, sg * 0.62), 0.013, PM.steel));
      half.add(sphereGeo(0.03, 14, 10, PM.steel), T(sg * 0.6, 0, 0));
    }
    half.add(sphereGeo(0.055, 18, 12, PM.cast));
    this.half = R.mesh(half);
    this.case = R.mesh(boxAt(-0.36, -0.13, -0.09, 0.02, this.yM + 0.06, 0.09, PM.alu));
    this.size = 0.8; this.floor = -0.14;
    this.cam = { target: [-0.15, 0.08, 0], dist: 1.25, yaw: 0.45, pitch: 0.3 };
  }
  draw(ctx, o = {}) {
    const s = ctx.st, pm = ctx.ph.motor ?? 0, pI = -pm / (10 / 3), pD = pm / 10, { yM, yI } = this;
    if (!o.inCar) ctx.glass(this.case, null, { alpha: 0.1 });
    ctx.add(this.sM, M4.model(0, yM, 0, 0, 0, 1, 1, 1, pm));
    ctx.add(this.g1, onX(-0.28, yM, 0, pm));
    ctx.add(this.sI, M4.model(0, yI, 0, 0, 0, 1, 1, 1, pI));
    ctx.add(this.g2, onX(-0.28, yI, 0, pI));
    ctx.add(this.g3, onX(-0.15, yI, 0, pI));
    ctx.add(this.g4, onX(-0.15, 0, 0, pD));
    ctx.add(this.half, M4.model(0, 0, 0, 0, 0, 1, 1, 1, pD));
    const P = (s.Ft ?? 0) * (s.v ?? 0), k = clamp(Math.abs(P) / 60000, 0, 1.2);
    const path = [[-0.42, yM + 0.02, 0], [-0.28, yM + 0.02, 0], [-0.28, yI + 0.02, 0], [-0.15, yI + 0.02, 0], [-0.15, 0.04, 0], [0, 0.04, 0], [0.6, 0.03, 0]];
    ctx.flow(path, Math.round(8 + 40 * k), (P >= 0 ? 1 : -1) * (0.12 + 0.3 * k), 0.006, P >= 0 ? POW : REG, Math.abs(P) > 50 ? 0.9 : 0, 0.008, 90);
    if (o.inCar) return;
    ctx.label([-0.28, yM + 0.08, 0], `stage 1 · 10/3 · ω<sub>m</sub> = ${((s.wm ?? 0) * 60 / TAU).toFixed(0)} rpm`);
    ctx.label([-0.15, -0.13, 0.05], "stage 2 · 3.0 + differential");
    ctx.label([0.45, 0.06, 0], `half-shafts · ω<sub>w</sub> = ${((s.v ?? 0) / 0.3).toFixed(1)} rad/s`);
    ctx.label([-0.2, yM + 0.15, 0], "i = 10 · η<sub>t</sub> = 0.95 · G = i/r<sub>w</sub> = 33.33 m⁻¹");
  }
}

// ============================================================================ whole powertrains in the (x-ray) car
export class System {
  constructor(R, plant, rigs) {
    this.plant = plant; this.rigs = rigs;
    this.body = rigs.body;
    this.brake = new Brake(R, { noTire: true });
    const c = this.body.c, ax = c.axles, tr = c.track;
    const Ry = (a) => M4.model(0, 0, 0, a);
    if (plant === "ice") {
      this.parts = [
        { rig: rigs.engine, M: mul(T(-0.6, 0.45, 0.25), Ry(PI / 2), M4.model(0, 0, 0, 0, 0, 0.85, 0.85, 0.85)), ex: [0.3, 1.1, 0.4], ch: "engine", name: "Engine" },
        { rig: rigs.manifold, M: mul(T(-0.98, 0.56, 0.25), Ry(PI / 2), M4.model(0, 0, 0, 0, 0, 0.7, 0.7, 0.7)), ex: [-0.6, 1.9, 0.4], ch: "manifold", name: "Intake manifold" },
        { rig: rigs.throttle, M: mul(T(-0.98, 0.714, 0.62), Ry(PI / 2)), ex: [-0.6, 2.4, 1.4], ch: "throttle", name: "Throttle" },
        { rig: rigs.gearbox, M: mul(T(ax[0], c.wr, 0), Ry(-PI / 2), M4.model(0, 0, 0, 0, 0, 1, 1, 1.0)), ex: [0.2, 0.25, 1.4], ch: "gearbox", name: "Gearbox + final drive" },
      ];
    } else {
      this.parts = [
        { rig: rigs.battery, M: mul(T(-2.2, 0.14, 0), M4.model(0, 0, 0, 0, 0, 0.95, 0.9, 0.95)), ex: [0, -0.6, 0], ch: "battery", name: "Battery" },
        { rig: rigs.converter, M: mul(T(-3.05, 0.62, 0.0), Ry(PI)), ex: [0, 1.6, 0], ch: "converter", name: "Converter" },
        { rig: rigs.motor, M: mul(T(ax[1], c.wr + rigs.reduction.yM, -0.52), Ry(PI / 2)), ex: [0.3, 1.0, -1.0], ch: "motor", name: "DC motor" },
        { rig: rigs.reduction, M: mul(T(ax[1], c.wr, 0), Ry(-PI / 2)), ex: [-0.3, 0.3, 1.5], ch: "reduction", name: "Reduction gear" },
      ];
    }
    this.brakes = [];
    for (const a of ax) for (const sg of [1, -1]) this.brakes.push(mul(T(a, c.wr, sg * (tr - 0.02)), M4.model(0, 0, 0, sg > 0 ? 0 : PI)));
    this.size = 6; this.floor = -0.01;
    this.cam = { target: [-2.25, 0.6, 0], dist: 7.2, yaw: 0.75, pitch: 0.42 };
  }
  draw(ctx) {
    const ex = ctx.explode ?? 0;
    this.body.draw(ctx, { ghost: true, flat: true });
    for (const p of this.parts) {
      const B = mul(T(p.ex[0] * ex, p.ex[1] * ex, p.ex[2] * ex), p.M);
      const sub = ctx.sub(B);
      sub.labels = null;
      p.rig.draw(sub, { inCar: true });
      const q = M4.apply(M4.mul(ctx.B, B), 0, p.rig.size * 0.25 + 0.15, 0);
      ctx.labels?.push({ p: [q[0], q[1], q[2]], html: `${p.name} ›`, ch: p.ch, cls: "sys" });
    }
    for (const m of this.brakes) { const sub = ctx.sub(mul(T(0, -0.0 * ex, 0), m)); sub.labels = null; this.brake.draw(sub, { inCar: true }); }
    ctx.labels?.push({ p: ctx.pt([this.body.c.axles[1], 0.75, this.body.c.track + 0.2]), html: "Brakes ›", ch: "brakes", cls: "sys" });
    ctx.labels?.push({ p: ctx.pt([-2.25, 1.75, 0]), html: "Vehicle body ›", ch: "body", cls: "sys" });
    if (this.plant === "ev") {
      // HV cables battery -> converter -> motor
      const v = ctx.st;
      const k = clamp(Math.abs(v.ibat ?? 0) / 300, 0, 1.2);
      ctx.flow([[-1.4, 0.26, 0.0], [-2.6, 0.4, 0], [-3.0, 0.62, 0]].map((p) => [p[0], p[1] + ex * 0.6 * (p[0] < -2.9 ? 1.6 : 0.2), p[2]]), Math.round(6 + 26 * k), (v.ibat ?? 0) >= 0 ? -0.6 : 0.6, 0.03, (v.ibat ?? 0) >= 0 ? CUR : REG, Math.abs(v.ibat ?? 0) > 0.5 ? 0.8 : 0, 0.02, 99);
    }
  }
}

export function buildRigs(R) {
  const A = arrowMeshes(R);
  const rigs = {
    throttle: new Throttle(R), manifold: new Manifold(R), engine: new Engine(R), gearbox: new Gearbox(R), brakes: new Brake(R),
    battery: new Battery(R), converter: new Converter(R), motor: new Motor(R), reduction: new Reduction(R),
    bodyIce: new Body(R, "ice"), bodyEv: new Body(R, "ev"),
  };
  rigs.sysIce = new System(R, "ice", { ...rigs, body: rigs.bodyIce });
  rigs.sysEv = new System(R, "ev", { ...rigs, body: rigs.bodyEv });
  return { rigs, A };
}
