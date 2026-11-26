// menubg3d.js - live backdrop of the title screen: the highway of the 3D view
// (world3d.js) seen from a gantry camera, with cars and trucks in all four
// lanes at constant, real speeds. Only the clock and the weather run fast: a
// day lasts 48 s and the weather crossfades clear -> fog -> rain -> snow ->
// cloudy -> clear ...
//
//   const bg = new Backdrop(canvas);   bg.frame(dt, { mouse: [x, y] });   bg.destroy();
//   bg.state -> { hour, weather, night }

import { M4, Renderer, lin, Geo, cylGeo } from "./gl3d.js";
import * as MD from "./models3d.js";
import { World, makeEnv, LAYOUT } from "./world3d.js";
import { FX } from "./fx3d.js";

const OX = 765;                       // world x of the camera (no gantry in the first 400 m)
const HOUR0 = 15.5, HOUR_RATE = 0.5;  // clock: starts mid-afternoon, 0.5 h per second
const SCHEDULE = [["clear", 9], ["fog", 7.5], ["rain", 8], ["snow", 8.5], ["cloudy", 6.5]];
const FADE = 2.5;                     // weather crossfade [s]
const WIN0 = 380;                     // vehicles live in [-WIN0, P - WIN0] around the camera
const LANES = [                       // z, direction, speed [m/s], share of trucks
  { z: LAYOUT.egoZ, dir: 1, v: 24.5, trucks: 0.3, n: 15 },
  { z: LAYOUT.passZ, dir: 1, v: 33.0, trucks: 0, n: 13 },
  { z: LAYOUT.oncFast, dir: -1, v: 31.5, trucks: 0, n: 13 },
  { z: LAYOUT.oncSlow, dir: -1, v: 25.0, trucks: 0.3, n: 15 },
];
const STYLES = [["sedan", 4.6], ["hatch", 4.1], ["suv", 4.7], ["ev", 4.5], ["ice", 4.5]];
const PALETTE = ["#d8dde3", "#1f2329", "#9aa3ad", "#8c1d18", "#1e3f7a", "#e6e6e6", "#3d4a3a", "#b88a3a",
                 "#5a5f66", "#f2f2f2", "#2a6f8f", "#6b2d5c", "#c9c2b4", "#33373d"];
const HERO = { ev: "#1fae8a", ice: "#e8732a" };

const h1 = (i, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7 + 0.5) * 43758.5453; return v - Math.floor(v); };
const wrap = (v, a, b) => { const p = b - a; return ((((v - a) % p) + p) % p) + a; };
const sstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// linear crossfade of two environments (fog density in log space)
function mixEnv(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = {};
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (typeof x === "number") out[k] = k === "fogDen" ? Math.exp(Math.log(x) + (Math.log(y) - Math.log(x)) * t) : x + (y - x) * t;
    else if (Array.isArray(x) || x instanceof Float32Array) out[k] = Array.from(x, (v, i) => v + (y[i] - v) * t);
    else if (typeof x === "boolean") out[k] = x || y;
    else if (x && typeof x === "object") out[k] = mixEnv(x, y, t);
    else out[k] = t < 0.5 ? x : y;
  }
  return out;
}

// weather at time T: [current, next, crossfade 0..1]
function weatherAt(T) {
  const C = SCHEDULE.reduce((s, w) => s + w[1], 0);
  let p = ((T % C) + C) % C;
  for (let i = 0; i < SCHEDULE.length; i++) {
    const [w, d] = SCHEDULE[i];
    if (p < d) return [w, SCHEDULE[(i + 1) % SCHEDULE.length][0], sstep((p - (d - FADE)) / FADE)];
    p -= d;
  }
  return ["clear", "clear", 0];
}

export class Backdrop {
  constructor(canvas) {
    this.canvas = canvas;
    const R = this.R = new Renderer(canvas);
    R.quality = { msaa: 2, shadow: 1536, bloom: true };
    this.atlas = MD.buildAtlas();
    R.setAtlas(this.atlas.canvas);
    this.world = new World(R, this.atlas);
    this.world.updateVMS(["KTRL · ACC", "ICE  VS  EV"]);
    this.fx = new FX(R);
    this.T = 0;
    this.beam = R.mesh(new Geo().add(cylGeo(0, 1, 1, 18, false), M4.model(0, 0, 0, 0, -Math.PI / 2)));
    // vehicle meshes, instanced
    const uv = this.atlas.uv;
    this.cars = {};
    for (const [st, L] of STYLES) {
      const c = MD.buildCar(st, L, { interior: false, plate: uv.plate_t0 });
      this.cars[st] = { c, body: R.inst(R.mesh(c.body), 24), glass: R.inst(R.mesh(c.glass), 24), wheel: R.inst(R.mesh(c.wheel), 96) };
    }
    const tr = MD.buildTruck(uv);
    this.truck = { tr, body: R.inst(R.mesh(tr.body), 16), wheel: R.inst(R.mesh(tr.wheel), 200) };
    // traffic: fixed positions along each lane, constant speeds
    this.traffic = [];
    let k = 0;
    for (const [li, ln] of LANES.entries()) {
      let s = 0;
      const list = [];
      for (let i = 0; i < ln.n; i++, k++) {
        const truck = h1(k, 1) < ln.trucks;
        let style = truck ? "truck" : STYLES[Math.floor(h1(k, 2) * 3)][0];
        if (!truck && h1(k, 3) < 0.12) style = h1(k, 4) < 0.5 ? "ev" : "ice";
        const L = style === "truck" ? tr.L : this.cars[style].c.L;
        const paint = lin(HERO[style] || PALETTE[Math.floor(h1(k, 5) * PALETTE.length)]);
        list.push({ style, s0: s, L, paint, lane: li });
        s += L + 26 + h1(k, 6) * 105 + (truck ? 20 : 0);
      }
      for (const v of list) { v.P = s; this.traffic.push(v); }
    }
    this.state = { hour: HOUR0, weather: "clear", night: 0 };
  }

  frame(dt, opt = {}) {
    const R = this.R, world = this.world;
    this.T += Math.min(0.1, Math.max(0, dt));
    if (opt.T != null) this.T = opt.T;                      // tests: jump to a moment of the cycle
    const T = this.T, now = performance.now() / 1000;
    R.resize(opt.scale ?? 0.85);
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (W < 2 || H < 2) return;

    // ---- clock and weather
    const hour = (HOUR0 + HOUR_RATE * T) % 24;
    const [wa, wb, f] = weatherAt(T);
    const envA = makeEnv(hour, wa, now, OX), envB = f > 0 ? makeEnv(hour, wb, now, OX) : envA;
    const env = mixEnv(envA, envB, f);
    env.weather = f < 0.5 ? wa : wb;
    env.spots = [];
    const wt = (w) => (wa === w ? 1 - f : 0) + (wb === w && f > 0 ? f : 0);
    this.state = { hour, weather: env.weather, night: env.night };

    // ---- camera: on a gantry above the passing lane, looking down the road
    const m = opt.mouse || [0, 0];
    const eye = [Math.sin(T * 0.05) * 1.5, 7.6 + Math.sin(T * 0.07) * 0.25 + m[1] * 0.35, -2.3 + Math.sin(T * 0.04) * 0.4 + m[0] * 0.8];
    const target = [150, 0.4, -5.9 + m[0] * 1.5];
    const view = M4.lookAt(eye, target, [0, 1, 0]);
    const proj = M4.perspective(50 * Math.PI / 180, W / H, 0.3, 9500);
    const vp = M4.mul(proj, view);
    const cam = { vp, view, proj, eye, worldX: ((OX % 4000) + 4000) % 4000, invVP: M4.invert(vp),
                  right: [view[0], view[4], view[8]], up: [view[1], view[5], view[9]], target };

    // ---- scene
    const lists = { ground: [], opaque: [], glass: [], mirror: [], flats: [], beams: [], partsAlpha: [], partsAdd: [], groups: [] };
    const ctx = {
      ox: OX, cx: 60, t: T, now, env, q: { veg: 0.8, parts: 0.7, fx: true, weatherFx: true }, traffic: false, lists,
      glow: (x, y, z, size, col, alpha, mode = 1) => lists.partsAdd.push([x, y, z, size, col[0] * 3, col[1] * 3, col[2] * 3, alpha, 0, 0, 0, mode, 0]),
      streak: (x, z, col, alpha) => lists.partsAdd.push([x, 0.03, z, 0.18, col[0] * 2, col[1] * 2, col[2] * 2, alpha, 0, -30, 0, 3, 0]),
      spot: (p, d, I, c) => { const n = Math.hypot(...d); env.spots.push({ p, d: d.map((x) => x / n), i: I, cos: c }); },
    };
    world.update(ctx);
    this.trafficFrame(ctx, T, eye);

    // ---- weather particles around the camera (two passes while rain and snow crossfade)
    const fxCam = { eye, target: [eye[0] + 24, 0, eye[2] - 3] };
    const rainK = wt("rain"), snowK = wt("snow");
    if (rainK > 0.01) this.fx.emit({ ox: 0, env: { ...env, rain: 1, snowfall: 0 }, cam: fxCam, q: { parts: 0.75 * rainK, weatherFx: true }, lists, now });
    if (snowK > 0.01) this.fx.emit({ ox: 0, env: { ...env, rain: 0, snowfall: 1 }, cam: fxCam, q: { parts: 0.75 * snowK, weatherFx: true }, lists, now });

    // ---- post
    const sunP = M4.apply(vp, eye[0] + env.sunDir[0] * 3000, eye[1] + env.sunDir[1] * 3000, eye[2] + env.sunDir[2] * 3000);
    const sunUV = [sunP[0] * 0.5 + 0.5, sunP[1] * 0.5 + 0.5];
    const onScr = sunP[3] > 0 && sunUV[0] > -0.1 && sunUV[0] < 1.1 && sunUV[1] > -0.1 && sunUV[1] < 1.1 ? 1 : 0;
    const post = {
      bloom: 0.06 + env.night * 0.035 + wt("fog") * 0.03, threshold: 1.0, vignette: 0.3, grain: 0.012, ca: 0.0012, letter: 0,
      flare: onScr * env.sunVis * (1 - env.cloud * 0.95) * 0.8, sunScr: sunUV, flareCol: env.sunCol.map((c) => Math.min(1, c / 3)),
      sat: env.grade.sat, lift: env.grade.lift, gain: env.grade.gain, hit: 0,
    };
    const shadow = env.castShadows ? { center: [48, 0, -6], half: 70, ox: OX } : null;
    R.render({ cam, env, shadow, post, ...lists });
  }

  trafficFrame(ctx, T, eye) {
    const L = ctx.lists, env = ctx.env, head = env.headlights;
    for (const s of Object.values(this.cars)) { s.body.clear(); s.glass.clear(); s.wheel.clear(); }
    this.truck.body.clear(); this.truck.wheel.clear();
    const near = [];
    for (const v of this.traffic) {
      const ln = LANES[v.lane], dir = ln.dir, z = ln.z;
      const xw = v.s0 + dir * ln.v * T;                      // unwrapped (wheel spin)
      const x = wrap(xw, -WIN0, v.P - WIN0);
      const yaw = dir > 0 ? 0 : Math.PI;
      if (v.style === "truck") {
        const tr = this.truck.tr;
        this.truck.body.push(x, 0, z, yaw, 1, 1, 1, 0, ...v.paint, 1);
        for (const ax of tr.axles) for (const sgn of [1, -1])
          this.truck.wheel.push(x + dir * ax, tr.wr, z + dir * sgn * tr.track, yaw, 1, 1, sgn, -(xw / tr.wr));
        if (head > 0.05) for (const sgn of [1, -1]) ctx.glow(x + dir * 0.05, 1.15, z + sgn * 0.9, 1.6, [1, 0.95, 0.85], 0.9 * head, 4);
        for (const sgn of [1, -1]) ctx.glow(x - dir * (tr.L - 0.1), 0.9, z + sgn * 1.1, 0.6, [1, 0.08, 0.04], 0.4 * Math.max(head, 0.15), 1);
      } else {
        const S = this.cars[v.style], c = S.c;
        S.body.push(x, 0, z, yaw, 1, 1, 1, 0, ...v.paint, 1);
        S.glass.push(x, 0, z, yaw, 1, 1, 1, 0, 1, 1, 1, 0);
        for (const ax of c.axles) for (const sgn of [1, -1])
          S.wheel.push(x + dir * ax, c.wr, z + dir * sgn * c.track, yaw, 1, 1, sgn, -(xw / c.wr));
        if (head > 0.05) for (const p of c.lights.head) {
          ctx.glow(x + dir * (p[0] + 0.08), p[1], z + dir * p[2], 1.3, [1, 0.95, 0.85], 0.9 * head, 4);
          if (env.wet > 0.2) ctx.streak(x + dir * 1.2, z + dir * p[2], [1, 0.95, 0.85], 0.22 * head * env.wet);
        }
        for (const p of c.lights.tail) {
          ctx.glow(x + dir * (p[0] - 0.05), p[1], z + dir * p[2], 0.6, [1, 0.08, 0.04], 0.35 * Math.max(head, 0.15), 1);
          if (env.wet > 0.2 && head > 0.05) ctx.streak(x + dir * (p[0] - 1.0), z + dir * p[2], [1, 0.1, 0.05], 0.12 * head * env.wet);
        }
      }
      const d = Math.hypot(x - eye[0], z - eye[2]);
      if (x > -15 && x < 170) near.push({ v, x, z, dir, d });
    }
    const glowT = new Float32Array(8); glowT[1] = 14 * head; glowT[2] = 1.5 + 4 * head; glowT[5] = 6;
    for (const s of Object.values(this.cars)) {
      L.opaque.push({ group: s.body, model: M4.ident(), mat: { spec: 0.8, shine: 80, refl: 1.0, glow: glowT } });
      L.opaque.push({ group: s.wheel, model: M4.ident(), mat: { glow: new Float32Array(8) }, noCull: true });
      L.glass.push({ group: s.glass, model: M4.ident(), mat: { alpha: 0.55, flags: 2, spec: 1, shine: 160, refl: 1 }, dist: 1e9 });
      L.groups.push(s.body, s.glass, s.wheel);
    }
    L.opaque.push({ group: this.truck.body, model: M4.ident(), mat: { spec: 0.5, shine: 50, glow: glowT } });
    L.opaque.push({ group: this.truck.wheel, model: M4.ident(), mat: {}, noCull: true });
    L.groups.push(this.truck.body, this.truck.wheel);
    // headlight pools and beams of the closest vehicles
    if (head > 0.05) {
      near.sort((a, b) => a.d - b.d);
      for (const n of near.slice(0, 7)) ctx.spot([n.x + n.dir * 0.1, 0.7, n.z], [0.995 * n.dir, -0.08, 0], 10 * head, 0.9);
      const beamA = (0.03 + 0.1 * Math.min(2.5, env.fogDen * 160)) * head;
      for (const n of near.slice(0, 5)) {
        if (n.v.style === "truck") continue;
        for (const p of this.cars[n.v.style].c.lights.head) {
          const x = n.x + n.dir * p[0], z = n.z + n.dir * p[2];
          L.beams.push({ mesh: this.beam, model: M4.mul(M4.model(x + n.dir * 0.05, p[1], z, n.dir > 0 ? 0 : Math.PI, -0.07), M4.model(0, 0, 0, 0, 0, 26, 3.2, 3.2)),
                         color: "#fff3dc", alpha: beamA, mode: 3, additive: true });
        }
      }
    }
  }

  destroy() {
    try { this.R.gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* already lost */ }
  }
}
