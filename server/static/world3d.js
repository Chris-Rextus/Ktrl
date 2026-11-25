// world3d.js - the environment of the 3D view: a divided highway with all its
// furniture, fields, railway with a passing train, farms, wind turbines, a city
// skyline, mountains, birds, balloons, oncoming traffic; plus the time-of-day /
// weather lighting presets.
//
// Everything world-anchored is generated procedurally from hashes of world x,
// stored relative to a base position and re-filled only when the camera window
// moves far enough (floating origin).

import { M4, lin, mix3, planeGeo, boxGeo, boxAt, extrudeXY, Geo } from "./gl3d.js";
import * as MD from "./models3d.js";

// ============================================================================ layout (z, metres)
export const LAYOUT = {
  egoZ: 0, passZ: -3.6, oncFast: -10.8, oncSlow: -14.4,
  ourL: -6.4, ourR: 4.6, medL: -8.0, oncL: -19.0,
  barrierZ: -7.2, lampZ: -7.2, lampArm: 4.4, lampH: 9.4, lampP: 50,
  railNear: 5.3, railFar: -19.6, fenceZ: -27.5, powerZ: -33, trackZ: -70,
};
const LY = LAYOUT;
const h1 = (i, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7 + 0.5) * 43758.5453; return v - Math.floor(v); };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = (v, a, b) => { const p = b - a; return ((((v - a) % p) + p) % p) + a; };

// ============================================================================ environment
const KEYS = [   // by sun elevation (degrees)
  { e: -18, top: "#02040b", hor: "#060a14", sun: [0.035, 0.05, 0.09], amb: [0.008, 0.011, 0.022], gnd: [0.003, 0.003, 0.005], fog: "#05080f", exp: 2.3, gain: [0.9, 0.97, 1.12], lift: [0, 0.004, 0.018], sat: 0.85 },
  { e: -6, top: "#0b1734", hor: "#283357", sun: [0.07, 0.06, 0.1], amb: [0.04, 0.05, 0.09], gnd: [0.012, 0.012, 0.02], fog: "#1d2440", exp: 1.8, gain: [0.95, 0.96, 1.08], lift: [0.01, 0.0, 0.02], sat: 0.95 },
  { e: 0, top: "#2a3f70", hor: "#ef8f5c", sun: [2.3, 0.85, 0.3], amb: [0.2, 0.16, 0.18], gnd: [0.08, 0.06, 0.05], fog: "#c98c72", exp: 1.15, gain: [1.06, 0.97, 0.9], lift: [0.015, 0.0, 0.01], sat: 1.08 },
  { e: 7, top: "#38598f", hor: "#f2b783", sun: [3.0, 1.75, 0.85], amb: [0.3, 0.29, 0.32], gnd: [0.11, 0.1, 0.08], fog: "#d7b597", exp: 1.0, gain: [1.05, 1.0, 0.92], lift: [0.01, 0.005, 0.0], sat: 1.08 },
  { e: 22, top: "#3a69a6", hor: "#bdd0e2", sun: [3.1, 2.7, 2.2], amb: [0.42, 0.46, 0.56], gnd: [0.13, 0.12, 0.1], fog: "#b3c3d2", exp: 0.9, gain: [1.01, 1.0, 0.99], lift: [0, 0, 0], sat: 1.05 },
  { e: 50, top: "#2c64a8", hor: "#aac7e3", sun: [3.3, 3.1, 2.85], amb: [0.5, 0.56, 0.68], gnd: [0.15, 0.14, 0.12], fog: "#a9bfd4", exp: 0.82, gain: [1, 1, 1], lift: [0, 0, 0], sat: 1.06 },
];
const lerpKey = (e) => {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  if (e <= a.e) b = a;
  else if (e >= b.e) a = b;
  else for (let i = 1; i < KEYS.length; i++) if (e <= KEYS[i].e) { a = KEYS[i - 1]; b = KEYS[i]; break; }
  const t = a === b ? 0 : (e - a.e) / (b.e - a.e);
  const L = (x, y) => (Array.isArray(x) ? mix3(x, y, t) : x + (y - x) * t);
  return {
    top: mix3(lin(a.top), lin(b.top), t), hor: mix3(lin(a.hor), lin(b.hor), t), fog: mix3(lin(a.fog), lin(b.fog), t),
    sun: L(a.sun, b.sun), amb: L(a.amb, b.amb), gnd: L(a.gnd, b.gnd), exp: L(a.exp, b.exp),
    gain: L(a.gain, b.gain), lift: L(a.lift, b.lift), sat: L(a.sat, b.sat),
  };
};
export const WEATHERS = ["clear", "cloudy", "rain", "fog", "snow"];

// hour 0..24, weather name, time (s), ox (world x of the origin)
export function makeEnv(hour, weather, time, ox) {
  const elev = 62 * Math.sin(Math.PI * (hour - 6) / 12);
  const az = Math.PI * (hour - 6) / 12;
  const er = elev * Math.PI / 180;
  const k = lerpKey(elev);
  let sunDir = [Math.cos(az) * Math.cos(er), Math.sin(er), Math.sin(az) * Math.cos(er) * 0.9 + 0.12];
  const l = Math.hypot(...sunDir); sunDir = sunDir.map((x) => x / l);
  const moonDir = (() => { const v = [-0.45, 0.55, 0.62]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
  const day = smooth(-4, 3, elev);
  const night = smooth(2, -10, elev);
  const env = {
    sunDir: day > 0.02 ? sunDir : moonDir, sunCol: k.sun.slice(), sunVis: day,
    skyTop: k.top, skyHor: k.hor, skyGround: mix3(k.gnd, [0.02, 0.025, 0.02], 0.5), fogCol: k.fog,
    ambSky: k.amb.slice(), ambGround: k.gnd.slice(), fogDen: 1 / 3200, fogFall: 0.012, night, wet: 0, snow: 0,
    time, cloud: 0.22, cloudDark: 0, cloudOff: [time * 0.004 + ox / 1500 * 0.9, time * 0.0015], stars: smooth(-5, -14, elev),
    moonDir, exposure: k.exp, wind: 0.6, shadowK: 1, castShadows: day > 0.05 || night > 0.6,
    lamp: [LY.lampP, LY.lampH, 0, LY.lampZ + LY.lampArm], lampZ2: LY.lampZ - LY.lampArm, lampCol: lin("#ffd9a8"),
    grade: { gain: k.gain, lift: k.lift, sat: k.sat }, elev, hour, weather, rain: 0, snowfall: 0, flash: 0,
    headlights: 0, lampsOn: 0,
  };
  // weather
  const grey = (c, t, g = 0.5) => mix3(c, [g * (c[0] + c[1] + c[2]) / 3, g * (c[0] + c[1] + c[2]) / 3, g * (c[0] + c[1] + c[2]) / 3].map((x) => x * 2), t);
  if (weather === "cloudy") {
    env.cloud = 0.78; env.cloudDark = 0.25; env.sunCol = env.sunCol.map((x) => x * 0.35); env.shadowK = 0.45;
    env.ambSky = env.ambSky.map((x) => x * 1.25); env.skyTop = grey(env.skyTop, 0.6); env.skyHor = grey(env.skyHor, 0.5);
    env.fogDen *= 1.6; env.grade.sat *= 0.9; env.wind = 1.2;
  } else if (weather === "rain") {
    env.cloud = 0.97; env.cloudDark = 0.65; env.sunCol = env.sunCol.map((x) => x * 0.1); env.shadowK = 0.12;
    env.ambSky = env.ambSky.map((x) => x * 0.85); env.skyTop = grey(env.skyTop, 0.85, 0.4); env.skyHor = grey(env.skyHor, 0.8, 0.45);
    env.fogCol = grey(env.fogCol, 0.8, 0.45); env.fogDen *= 4.5; env.wet = 1; env.rain = 1; env.grade.sat *= 0.72; env.wind = 2.2;
    env.exposure *= 1.15;
    // lightning: deterministic flashes
    const ph = time % 9.0, seed = Math.floor(time / 9.0);
    if (h1(seed, 3) > 0.45 && ph < 0.35) env.flash = (ph < 0.08 || (ph > 0.16 && ph < 0.22)) ? 1.6 * (1 - ph * 2) : 0;
  } else if (weather === "fog") {
    env.cloud = 0.6; env.cloudDark = 0.2; env.sunCol = env.sunCol.map((x) => x * 0.3); env.shadowK = 0.3;
    env.fogCol = mix3(env.fogCol, lin("#b9c0c6").map((x) => x * Math.max(0.05, day * 0.9 + 0.05)), 0.75);
    env.fogDen = 1 / 105; env.fogFall = 0.03; env.wet = 0.3; env.grade.sat *= 0.78; env.ambSky = env.ambSky.map((x) => x * 1.1);
  } else if (weather === "snow") {
    env.cloud = 0.9; env.cloudDark = 0.25; env.sunCol = env.sunCol.map((x) => x * 0.25); env.shadowK = 0.3;
    env.ambSky = env.ambSky.map((x) => x * 1.3); env.skyTop = grey(env.skyTop, 0.8, 0.6); env.skyHor = grey(env.skyHor, 0.7, 0.6);
    env.fogCol = grey(env.fogCol, 0.7, 0.62); env.fogDen *= 5; env.snow = 1; env.snowfall = 1; env.wet = 0.35; env.grade.sat *= 0.85;
    env.exposure *= 0.92;
  }
  env.lampsOn = Math.max(smooth(3, -3, elev), (weather === "rain" || weather === "fog" || weather === "snow") ? smooth(25, 5, elev) * 0.8 : 0);
  env.lamp[2] = 7.5 * env.lampsOn;
  env.headlights = Math.max(smooth(6, -2, elev), weather !== "clear" && weather !== "cloudy" ? 1 : 0);
  if (env.flash) { env.ambSky = env.ambSky.map((x) => x + env.flash * 0.8); }
  return env;
}

// ============================================================================ world
export class World {
  constructor(R, atlas, opts = {}) {
    this.R = R; this.atlas = atlas;
    const mk = (g) => R.mesh(g);
    const inst = (mesh, cap) => R.inst(mesh, cap);
    const uv = atlas.uv;
    this.M = {
      plane: mk(planeGeo(-0.5, 0.5, -0.5, 0.5)),
      box: mk(boxGeo(1, 1, 1)),
      ballast: mk(new Geo().add(extrudeXY([[-3.6, 0], [3.6, 0], [2.0, 0.38], [-2.0, 0.38]], 1, { color: "#77716a", spec: -1, shine: -1, glow: 0, flag: 0 }), M4.model(0, 0, 0, Math.PI / 2))),
      gantryA: mk(MD.gantryGeo(LY.ourR + 1.0, LY.ourL - 0.6, [{ z: 0, w: 3.4, h: 1.28, uv: uv.sign_a }, { z: -3.6, w: 3.4, h: 1.28, uv: uv.sign_b }])),
      gantryB: mk(MD.gantryGeo(LY.ourR + 1.0, LY.ourL - 0.6, [{ z: 0, w: 3.4, h: 1.28, uv: uv.sign_c }, { z: -3.6, w: 3.4, h: 1.28, uv: uv.sign_a }])),
      gantryV: mk(MD.gantryGeo(LY.ourR + 1.0, LY.ourL - 0.6, [{ z: -1.8, w: 4.6, h: 1.15, uv: uv.vms }])),
      speed: mk(MD.signPostGeo(uv.speed110, 1.0, 2.2)),
      ads: [0, 1, 2, 3].map((i) => mk(MD.billboardGeo(uv[`ad_${i}`]))),
      barn: mk(MD.barnGeo()), silo: mk(MD.siloGeo()), house: mk(MD.houseGeo()),
      balloon: mk(MD.balloonGeo()),
      mountFar: mk(MD.mountainGeo(6000, -1, -2300, -4600, 820, 7)),
      mountBack: mk(MD.mountainGeo(6000, 1, 1900, 3800, 480, 3)),
      railL: mk(boxGeo(1, 0.16, 0.08, { color: "#8b8f94", spec: 0.9, shine: 90, glow: 0, flag: 0 })),
      wireLong: mk(boxGeo(1, 0.02, 0.02, { color: "#2a2b2d", spec: 0.3, shine: 20, glow: 0, flag: 0 })),
    };
    this.km = new Map();      // km sign meshes by number
    const G = (geo, cap) => inst(mk(geo), cap);
    this.I = {
      lamp: G(MD.lampGeo(), 64), barrier: G(MD.barrierGeo(), 512), glare: G(MD.glareGeo(), 512),
      rail: G(MD.guardrailGeo(), 1024), deli: G(MD.delineatorGeo(), 128), stud: G(MD.studGeo(), 512),
      dash: inst(this.M.plane, 512), sleeper: G(boxGeo(0.25, 0.14, 2.6, { color: "#9c968c", spec: 0.05, shine: 8, glow: 0, flag: 0 }), 1500),
      fpost: G(MD.postGeo(1.35, 0.06), 700), ppole: G(new Geo().add(MD.postGeo(10, 0.14)).add(boxGeo(0.14, 0.14, 2.6, MAT_WOOD), M4.model(0, 9.4, 0))
        .add(MD.cylGeo(0.06, 0.06, 0.3, 6, true, { color: "#cfd6da", spec: 0.7, shine: 60, glow: 0, flag: 0 }), M4.model(0, 9.5, -1.1))
        .add(MD.cylGeo(0.06, 0.06, 0.3, 6, true, { color: "#cfd6da", spec: 0.7, shine: 60, glow: 0, flag: 0 }), M4.model(0, 9.5, 0))
        .add(MD.cylGeo(0.06, 0.06, 0.3, 6, true, { color: "#cfd6da", spec: 0.7, shine: 60, glow: 0, flag: 0 }), M4.model(0, 9.5, 1.1)), 64),
      wire: inst(this.M.wireLong, 1400),
      mast: G(new Geo().add(boxAt(-0.15, 0, -0.15, 0.15, 7.2, 0.15, { color: "#8d969e", spec: 0.6, shine: 50, glow: 0, flag: 0 }))
        .add(MD.segGeo([0, 6.6, 0], [0, 6.6, 3.6], 0.05, { color: "#8d969e", spec: 0.6, shine: 50, glow: 0, flag: 0 }))
        .add(MD.segGeo([0, 7.1, 0], [0, 6.6, 3.0], 0.035, { color: "#8d969e", spec: 0.6, shine: 50, glow: 0, flag: 0 })), 80),
      pine0: G(MD.pineGeo(1), 600), pine1: G(MD.pineGeo(5), 600), broad0: G(MD.broadTreeGeo(2), 500), broad1: G(MD.broadTreeGeo(9), 500),
      autumn: G(MD.broadTreeGeo(4, true), 200), poplar: G(MD.poplarGeo(3), 500), bush0: G(MD.bushGeo(1), 600), bush1: G(MD.bushGeo(6), 600),
      rock: G(MD.rockGeo(2), 200), tuft: G(MD.tuftGeo(1), 2600),
      tower: G(MD.turbineTowerGeo(), 40), rotor: G(MD.rotorGeo(), 40),
      bldg: G(MD.buildingGeo(), 420), antenna: G(MD.antennaGeo(), 30), bird: G(MD.birdGeo(), 60),
    };
    this.base = null; this.fillWin = null;
    this.vmsCtx = (() => { const c = document.createElement("canvas"); c.width = atlas.vms.w; c.height = atlas.vms.h; return c; })();
    this.vmsLast = "";
    // traffic
    const L = 4.5;
    const tStyles = ["sedan", "hatch", "suv"];
    this.T = {};
    for (const st of tStyles) {
      const car = MD.buildCar(st, st === "hatch" ? 4.1 : st === "suv" ? 4.7 : 4.6, { interior: false, plate: uv.plate_t0 });
      this.T[st] = {
        car, body: inst(mk(car.body), 16), glass: inst(mk(car.glass), 16), wheel: inst(mk(car.wheel), 64),
      };
    }
    const tr = MD.buildTruck(uv);
    this.truck = { tr, body: inst(mk(tr.body), 8), wheel: inst(mk(tr.wheel), 120) };
    const train = MD.buildTrain(uv);
    this.train = { t: train, loco: mk(train.loco), coach: inst(mk(train.coach), 12), bogie: inst(mk(train.bogie), 30) };
    const palette = ["#d8dde3", "#1f2329", "#9aa3ad", "#8c1d18", "#1e3f7a", "#e6e6e6", "#3d4a3a", "#b88a3a", "#5a5f66", "#f2f2f2", "#2a6f8f", "#6b2d5c"];
    this.traffic = [];
    for (let i = 0; i < 12; i++) {
      const slow = h1(i, 1) < 0.55, truck = slow && h1(i, 2) < 0.4;
      this.traffic.push({
        style: truck ? "truck" : tStyles[Math.floor(h1(i, 3) * 3)], z: slow ? LY.oncSlow : LY.oncFast,
        v: truck ? 22 + h1(i, 4) * 2 : slow ? 25 + h1(i, 4) * 3 : 30 + h1(i, 4) * 4,
        x0: i * 137 + h1(i, 5) * 90, paint: lin(palette[i % palette.length]),
      });
    }
  }

  // ---------------------------------------------------------------- static fill
  fill(ox, cx, q) {
    const I = this.I;
    for (const g of Object.values(I)) g.clear();
    const base = ox; this.base = base;
    const x0 = ox + cx - 700, x1 = ox + cx + 1300;
    this.fillWin = [ox + cx - 400, ox + cx + 900];
    const P = (xw) => xw - base;
    const dens = q.veg ?? 1;
    // lamps, barrier, glare screens
    for (let k = Math.floor(x0 / 50); k * 50 < x1; k++) I.lamp.push(P(k * 50), 0, LY.lampZ, 0);
    for (let k = Math.floor(x0 / 4); k * 4 < x1; k++) {
      I.barrier.push(P(k * 4 + 2), 0, LY.barrierZ);
      I.glare.push(P(k * 4 + 2), 0, LY.barrierZ);
      I.rail.push(P(k * 4 + 2), 0, LY.railNear, 0);
      I.rail.push(P(k * 4 + 2), 0, LY.railFar, Math.PI);
    }
    for (let k = Math.floor(x0 / 50); k * 50 < x1; k++) {
      I.deli.push(P(k * 50 + 25), 0, LY.ourR + 0.25, 0);
      I.deli.push(P(k * 50 + 25), 0, LY.oncL + 0.3, Math.PI);
    }
    for (let k = Math.floor(x0 / 12); k * 12 < x1; k++) {
      const x = P(k * 12);
      I.dash.push(x + 2, 0.009, -1.8, 0, 4.0, 1, 0.13, 0, 1, 1, 1, 0);
      I.dash.push(x + 2, 0.009, LY.oncFast - 1.8, 0, 4.0, 1, 0.13, 0, 1, 1, 1, 0);
      I.stud.push(x + 6, 0.0, -1.8, 0, 1, 1, 1, 0, 1, 1, 1, 0);
      I.stud.push(x + 6, 0.0, 1.85, 0, 1, 1, 1, 0, 1, 0.55, 0.1, 2);
      I.stud.push(x + 6, 0.0, -5.45, 0, 1, 1, 1, 0, 1, 0.55, 0.1, 2);
      I.stud.push(x + 6, 0.0, LY.oncFast - 1.8, 0, 1, 1, 1, 0, 1, 1, 1, 0);
    }
    // fence + power line
    for (let k = Math.floor(x0 / 3); k * 3 < x1; k++) I.fpost.push(P(k * 3), 0, LY.fenceZ, 0, 1, 0.9 + h1(k, 9) * 0.2, 1);
    for (let k = Math.floor(x0 / 45); k * 45 < x1; k++) {
      I.ppole.push(P(k * 45), 0, LY.powerZ, 0, 1, 1, 1, h1(k, 7) * 0.03 - 0.015);
      for (const dz of [-1.1, 0, 1.1]) {        // sagging wires: 6 segments per span
        const n = 6;
        for (let s = 0; s < n; s++) {
          const ta = s / n, tb = (s + 1) / n, sag = (t) => 9.62 - 1.1 * 4 * t * (1 - t);
          const xa = k * 45 + ta * 45, xb = k * 45 + tb * 45, ya = sag(ta), yb = sag(tb);
          I.wire.push(P((xa + xb) / 2), (ya + yb) / 2, LY.powerZ + dz, 0, Math.hypot(xb - xa, yb - ya), 1, 1, Math.atan2(yb - ya, xb - xa));
        }
      }
    }
    // railway: sleepers near the window, catenary masts
    for (let k = Math.floor((ox + cx - 300) / 0.7); k * 0.7 < ox + cx + 720; k++) I.sleeper.push(P(k * 0.7), 0.38, LY.trackZ);
    for (let k = Math.floor(x0 / 50); k * 50 < x1; k++) I.mast.push(P(k * 50 + 10), 0, LY.trackZ - 3.6, 0);
    // vegetation
    const tree = (x, z, s, hh) => {
      const r = h1(hh, 11);
      const g = r < 0.28 ? I.pine0 : r < 0.5 ? I.pine1 : r < 0.68 ? I.broad0 : r < 0.84 ? I.broad1 : r < 0.9 ? I.autumn : I.poplar;
      g.push(P(x), 0, z, h1(hh, 12) * 6.28, s, s * (0.85 + h1(hh, 13) * 0.35), s, 0, 0.85 + h1(hh, 14) * 0.3, 0.85 + h1(hh, 15) * 0.3, 0.8 + h1(hh, 16) * 0.3, 2);
    };
    for (let k = Math.floor(x0 / 9); k * 9 < x1; k++) {
      // far verge bushes between guardrail and fence
      if (h1(k, 20) < 0.35 * dens) (h1(k, 21) < 0.5 ? I.bush0 : I.bush1).push(P(k * 9 + h1(k, 22) * 8), 0, -21.5 - h1(k, 23) * 4.5, h1(k, 24) * 6, 0.7 + h1(k, 25) * 0.6, 0.7 + h1(k, 25) * 0.5, 0.7 + h1(k, 25) * 0.6, 0, 1, 1, 1, 0);
      // windbreak poplars along the field edge before the railway
      if (h1(k, 26) < 0.75 * dens) I.poplar.push(P(k * 9 + h1(k, 27) * 3), 0, -64 - h1(k, 28) * 1.5, 0, 0.9 + h1(k, 29) * 0.4, 0.9 + h1(k, 29) * 0.5, 0.9 + h1(k, 29) * 0.4, 0, 0.9, 1.0, 0.9, 2);
    }
    // forests behind the railway: clustered by a slow noise of x
    for (let k = Math.floor(x0 / 7); k * 7 < x1; k++) {
      const cluster = 0.5 + 0.5 * Math.sin(k * 7 * 0.011 + 1.3) * Math.sin(k * 7 * 0.0047 + 0.4);
      for (let j = 0; j < 3; j++) {
        const hh = k * 3 + j;
        if (h1(hh, 30) < cluster * 0.9 * dens) tree(k * 7 + h1(hh, 31) * 7, -82 - h1(hh, 32) * 120 - j * 10, 0.9 + h1(hh, 33) * 0.7, hh);
      }
      // near side: only far behind the camera line (never between camera and cars)
      if (h1(k, 34) < 0.45 * dens) tree(k * 7 + h1(k, 35) * 6, 46 + h1(k, 36) * 90, 0.9 + h1(k, 37) * 0.6, k + 9000);
      if (h1(k, 38) < 0.4 * dens) (h1(k, 39) < 0.5 ? I.bush0 : I.bush1).push(P(k * 7 + h1(k, 40) * 6), 0, 9 + h1(k, 41) * 30, h1(k, 42) * 6, 0.5 + h1(k, 43) * 0.4, 0.45 + h1(k, 43) * 0.3, 0.5 + h1(k, 43) * 0.4, 0, 1, 1, 1, 0);
      if (h1(k, 44) < 0.06) I.rock.push(P(k * 7), 0, -23 - h1(k, 45) * 3, h1(k, 46) * 6, 0.6 + h1(k, 47), 0.6 + h1(k, 47) * 0.6, 0.6 + h1(k, 47));
    }
    // grass tufts along the verges
    const nt = Math.floor(1500 * dens);
    for (let i = 0; i < nt; i++) {
      const xw = ox + cx - 160 + (i / nt) * 780, k = Math.floor(xw * 3);
      const near = h1(k, 50) < 0.5;
      I.tuft.push(P(xw + h1(k, 51)), 0, near ? LY.ourR + 0.4 + h1(k, 52) * 8 : LY.oncL - 0.6 - h1(k, 52) * 7, h1(k, 53) * 6, 1, 0.7 + h1(k, 54) * 0.8, 1, 0, 0.8 + h1(k, 55) * 0.4, 0.9 + h1(k, 55) * 0.2, 0.7, 2);
    }
    // wind turbines and city (wide windows)
    for (let k = Math.floor((ox + cx - 1800) / 230); k * 230 < ox + cx + 2600; k++) {
      if (h1(k, 60) < 0.45) continue;
      const x = P(k * 230 + h1(k, 61) * 120), z = -430 - h1(k, 62) * 260;
      I.tower.push(x, 0, z, 0);
    }
    for (let k = Math.floor((ox + cx - 3200) / 40); k * 40 < ox + cx + 3600; k++) {
      const dens2 = 0.5 + 0.5 * Math.sin(k * 40 / 1300 + 0.7);
      if (h1(k, 70) > dens2 * 0.95) continue;
      const hgt = 18 + h1(k, 71) ** 2.5 * 160 * dens2, w = 18 + h1(k, 72) * 26;
      const x = P(k * 40 + h1(k, 73) * 10), z = -1500 - h1(k, 74) * 380;
      const shade = 0.55 + h1(k, 75) * 0.5;
      I.bldg.push(x, 0, z, 0, w, hgt, w * (0.7 + h1(k, 76) * 0.6), 0, shade * 0.95, shade, shade * 1.05, 2);
      if (hgt > 120 && h1(k, 77) < 0.5) I.antenna.push(x, hgt, z, 0);
    }
  }

  // ---------------------------------------------------------------- per frame
  // ctx: { ox, cx, t, now, env, q, traffic, R, live: {...}, lists }
  update(ctx) {
    const { ox, cx, t, now, env, q } = ctx;
    if (!this.fillWin || ox + cx < this.fillWin[0] + 0 || ox + cx > this.fillWin[1] - 500 || this.qKey !== JSON.stringify(q)) {
      this.fill(ox, cx, q); this.qKey = JSON.stringify(q);
    }
    const off = this.base - ox;               // instance base -> relative
    const T0 = M4.model(off, 0, 0);
    const L = ctx.lists;
    const I = this.I;
    const night = env.night, lampsOn = env.lampsOn;
    const g8 = (o) => { const a = new Float32Array(8); for (const [k, v] of Object.entries(o)) a[k] = v; return a; };
    const snowable = 1;

    // ------------- ground
    const span = 6400, gx = cx;
    const gp = (z0, z1, mat, y = 0) => L.ground.push({ mesh: this.M.plane, model: M4.model(gx, y, (z0 + z1) / 2, 0, 0, span, 1, Math.abs(z1 - z0)), mat });
    gp(LY.ourR, 3200, { color: "#56683f", kind: 2, flags: snowable });
    gp(LY.ourL, LY.ourR, { color: "#5d636b", kind: 1 });
    gp(LY.medL, LY.ourL, { color: "#8d8a84", kind: 3, flags: snowable }, 0.004);
    gp(LY.oncL, LY.medL, { color: "#5d636b", kind: 1 });
    gp(LY.fenceZ, LY.oncL, { color: "#55673e", kind: 2, flags: snowable });
    gp(-63, LY.fenceZ, { color: "#6a6a40", kind: 4, flags: snowable });
    gp(-76, -63, { color: "#55673e", kind: 2, flags: snowable });
    gp(-440, -76, { color: "#6a6a40", kind: 4, flags: snowable });
    gp(-3200, -440, { color: "#4f6139", kind: 2, flags: snowable });
    // painted lines (solid) + dashes + rumble
    const lineMat = { color: "#e9e9e2", kind: 9, spec: 0.1 }, yel = { color: "#e7b416", kind: 9, spec: 0.1 };
    const line = (z, w, mat) => L.opaque.push({ mesh: this.M.plane, model: M4.model(gx, 0.008, z, 0, 0, span * 0.5, 1, w), mat, cast: false });
    line(1.88, 0.15, lineMat); line(-5.45, 0.15, yel); line(LY.medL - 1.05, 0.15, yel); line(LY.oncSlow - 1.85, 0.15, lineMat);
    L.opaque.push({ group: I.dash, model: T0, mat: lineMat, cast: false });
    // ballast + rails + contact wire
    L.opaque.push({ mesh: this.M.ballast, model: M4.model(gx, 0, LY.trackZ, 0, 0, span * 0.4, 1, 1), mat: { color: "#77716a", kind: 7 }, cast: false });
    for (const dz of [-0.72, 0.72]) L.opaque.push({ mesh: this.M.railL, model: M4.model(gx, 0.52, LY.trackZ + dz, 0, 0, 1600, 1, 1), mat: { spec: 0.9, shine: 90, refl: 0.8 }, cast: false });
    L.opaque.push({ mesh: this.M.wireLong, model: M4.model(gx, 6.6, LY.trackZ, 0, 0, 1600, 1, 1), mat: {}, cast: false });
    for (const y of [0.45, 0.85, 1.25]) L.opaque.push({ mesh: this.M.wireLong, model: M4.model(gx, y, LY.fenceZ, 0, 0, 1600, 1, 1), mat: { color: "#6d6f71" }, cast: false });

    // ------------- instanced furniture
    const glowLamp = g8({ 1: 16 * lampsOn });
    const studGlow = g8({ 1: 0.6 + 5.5 * Math.max(night, env.headlights * 0.6) });
    L.opaque.push({ group: I.lamp, model: T0, mat: { spec: 0.6, shine: 50, glow: glowLamp, flags: snowable } });
    L.opaque.push({ group: I.barrier, model: T0, mat: { color: "#b9b6ae", kind: 3, flags: snowable } });
    L.opaque.push({ group: I.glare, model: T0, mat: { flags: snowable } });
    L.opaque.push({ group: I.rail, model: T0, mat: { kind: 0, flags: snowable } });
    L.opaque.push({ group: I.deli, model: T0, mat: { glow: g8({ 4: 0.4 + 4 * Math.max(night, env.headlights * 0.5) }) }, cast: false });
    L.opaque.push({ group: I.stud, model: T0, mat: { glow: studGlow }, cast: false });
    L.opaque.push({ group: I.fpost, model: T0, mat: { flags: snowable } });
    L.opaque.push({ group: I.ppole, model: T0, mat: { flags: snowable } });
    L.opaque.push({ group: I.wire, model: T0, mat: {}, cast: false });
    L.opaque.push({ group: I.sleeper, model: T0, mat: { kind: 3 }, cast: false });
    L.opaque.push({ group: I.mast, model: T0, mat: {} });
    for (const k of ["pine0", "pine1", "broad0", "broad1", "autumn", "poplar", "bush0", "bush1", "rock"])
      L.opaque.push({ group: I[k], model: T0, mat: { flags: snowable, spec: 0.05 } });
    L.opaque.push({ group: I.tuft, model: T0, mat: { flags: snowable }, noCull: true, cast: false });
    L.opaque.push({ group: I.tower, model: T0, mat: { glow: g8({ 2: 3 + 30 * night * (Math.sin(now * 3) > 0.6 ? 1 : 0.05) }) }, cast: false });
    L.opaque.push({ group: I.bldg, model: T0, mat: { color: "#8d949c", kind: 5, flags: snowable }, cast: false });
    L.opaque.push({ group: I.antenna, model: T0, mat: { glow: g8({ 2: 2 + 40 * night * (Math.sin(now * 2.2 + 1) > 0.7 ? 1 : 0.05) }) }, cast: false });

    // rotors (spin with time)
    I.rotor.clear();
    for (let i = 0; i < I.tower.n; i++) {
      const o = i * 16, d = I.tower.data;
      I.rotor.push(d[o], 82.25, d[o + 2] + 2.6, 0, 1, 1, 1, now * (0.9 + 0.3 * h1(i, 63)) + i, 1, 1, 1, 0);
    }
    L.opaque.push({ group: I.rotor, model: T0, mat: {}, cast: false });

    // gantries, signs, km markers, billboards, farms (individual draws)
    const xs = ox + cx;
    for (let k = Math.floor((xs - 500) / 900); k * 900 < xs + 900; k++) {
      const xa = k * 900 + 300 - ox, xv = k * 900 + 750 - ox;
      L.opaque.push({ mesh: k % 2 ? this.M.gantryA : this.M.gantryB, model: M4.model(xa, 0, 0), mat: { glow: g8({}), flags: snowable } });
      L.opaque.push({ mesh: this.M.gantryV, model: M4.model(xv, 0, 0), mat: { flags: snowable } });
      ctx.vmsVisible = true;
    }
    for (let k = Math.floor((xs - 500) / 1500); k * 1500 < xs + 900; k++)
      L.opaque.push({ mesh: this.M.speed, model: M4.model(k * 1500 + 620 - ox, 0, LY.ourR + 0.9), mat: {} });
    for (let k = Math.floor((xs - 500) / 1000); k * 1000 < xs + 900; k++) {
      const n = ((k % 100) + 100) % 100;
      if (!this.km.has(n)) this.km.set(n, this.R.mesh(MD.signPostGeo(this.atlas.uv[`km${n}`], 0.55, 1.3)));
      L.opaque.push({ mesh: this.km.get(n), model: M4.model(k * 1000 - ox, 0, LY.ourR + 0.8), mat: {} });
    }
    for (let k = Math.floor((xs - 900) / 700); k * 700 < xs + 1400; k++) {
      if (h1(k, 80) < 0.35) continue;
      L.opaque.push({ mesh: this.M.ads[Math.floor(h1(k, 81) * 4)], model: M4.model(k * 700 + 200 - ox, 0, -24.5, -0.32), mat: { glow: g8({ 1: 18 * night }) } });
    }
    for (let k = Math.floor((xs - 1500) / 600); k * 600 < xs + 2000; k++) {
      if (h1(k, 90) < 0.4) continue;
      const fx = k * 600 + h1(k, 91) * 200 - ox, fz = -110 - h1(k, 92) * 120;
      L.opaque.push({ mesh: this.M.barn, model: M4.model(fx, 0, fz, h1(k, 93) * 0.4 - 0.2), mat: { flags: snowable } });
      L.opaque.push({ mesh: this.M.silo, model: M4.model(fx + 14, 0, fz - 4), mat: { flags: snowable } });
      L.opaque.push({ mesh: this.M.house, model: M4.model(fx - 26, 0, fz + 6, 0.1), mat: { glow: g8({ 7: 3.5 * night }), flags: snowable } });
    }
    // mountains (periodic)
    for (const [mesh, P] of [[this.M.mountFar, 6000], [this.M.mountBack, 6000]]) {
      const base0 = -wrap(ox, 0, P) - P / 2;
      for (const dx of [0, P]) L.opaque.push({ mesh, model: M4.model(base0 + dx, 0, 0), mat: { kind: 8, flags: snowable }, cast: false });
    }
    // birds and balloons (daytime)
    I.bird.clear();
    if (env.sunVis > 0.3 && env.weather !== "rain" && env.weather !== "snow") {
      for (let f = 0; f < 3; f++) {
        const fx = wrap(t * 9 + f * 700, -400, 900) + cx, fy = 38 + f * 14, fz = -60 - f * 70;
        for (let b = 0; b < 9; b++) {
          const row = Math.ceil(b / 2), side = b % 2 ? 1 : -1;
          const flap = Math.sin(now * 7 + b * 0.7 + f);
          I.bird.push(fx - row * 2.2, fy + Math.sin(now + b) * 0.3, fz + side * row * 1.8, 0, 1.6, 1, 1.6 * (0.55 + 0.45 * Math.abs(flap)), 0);
        }
      }
      for (let b = 0; b < 2; b++) {
        const bx = wrap(t * 1.5 + b * 1300 - ox * 0.0, -900, 1500) + cx;
        L.opaque.push({ mesh: this.M.balloon, model: M4.model(bx, 120 + b * 60 + Math.sin(now * 0.2 + b) * 4, -380 - b * 300, now * 0.05), mat: {}, cast: false });
      }
    }
    L.opaque.push({ group: I.bird, model: M4.ident(), mat: {}, cast: false, noCull: true });

    // ------------- oncoming traffic + trucks
    if (ctx.traffic) this.trafficFrame(ctx);
    // ------------- train
    this.trainFrame(ctx);
    // light sprites for lamps / studs at night
    if (lampsOn > 0.02) {
      for (let k = Math.floor((xs - 300) / 50); k * 50 < xs + 700; k++) {
        const x = k * 50 - ox;
        for (const z of [LY.lampZ + LY.lampArm + 0.05, LY.lampZ - LY.lampArm - 0.05]) {
          ctx.glow(x, LY.lampH - 0.12, z, 0.85, [1.0, 0.78, 0.5], 0.32 * lampsOn, 1);
          if (env.wet > 0.2) ctx.streak(x, z, [1.0, 0.75, 0.45], 0.35 * lampsOn * env.wet);
        }
      }
    }
    // the train and the rest of the groups must be uploaded
    L.groups.push(...Object.values(I), ...Object.values(this.T).flatMap((s) => [s.body, s.glass, s.wheel]), this.truck.body, this.truck.wheel, this.train.coach, this.train.bogie);
  }

  trafficFrame(ctx) {
    const { ox, cx, t, now, env } = ctx;
    const L = ctx.lists;
    for (const s of Object.values(this.T)) { s.body.clear(); s.glass.clear(); s.wheel.clear(); }
    this.truck.body.clear(); this.truck.wheel.clear();
    const head = env.headlights;
    const spots = [];
    for (const v of this.traffic) {
      const xw = v.x0 * 7 - v.v * t;
      const x = wrap(xw - ox, cx - 800, cx + 1100);
      const z = v.z;
      if (v.style === "truck") {
        const tr = this.truck.tr;
        this.truck.body.push(x, 0, z, Math.PI, 1, 1, 1, 0, ...v.paint, 1);
        for (const ax of tr.axles) for (const sgn of [1, -1])
          this.truck.wheel.push(x - ax, tr.wr, z - sgn * tr.track, Math.PI, 1, 1, sgn, -(xw / tr.wr));
        if (head > 0.05) { for (const sgn of [1, -1]) ctx.glow(x - 0.05, 1.15, z + sgn * 0.9, 1.6, [1, 0.95, 0.85], 0.9 * head, 4); }
        spots.push({ x, z, d: Math.abs(x - cx) });
      } else {
        const S = this.T[v.style], car = S.car;
        S.body.push(x, 0, z, Math.PI, 1, 1, 1, 0, ...v.paint, 1);
        S.glass.push(x, 0, z, Math.PI, 1, 1, 1, 0, 1, 1, 1, 0);
        for (const ax of car.axles) for (const sgn of [1, -1])
          S.wheel.push(x - ax, car.wr, z - sgn * car.track, Math.PI, 1, 1, sgn, -(xw / car.wr));
        if (head > 0.05) for (const p of car.lights.head) ctx.glow(x - p[0], p[1], z - p[2], 1.3, [1, 0.95, 0.85], 0.9 * head, 4);
        for (const p of car.lights.tail) ctx.glow(x - p[0], p[1], z - p[2], 0.6, [1, 0.08, 0.04], 0.35 * Math.max(head, 0.15), 1);
        spots.push({ x, z, d: Math.abs(x - cx) });
      }
    }
    const glowT = new Float32Array(8); glowT[1] = 14 * head; glowT[2] = 1.5 + 4 * head; glowT[5] = 6; glowT[4] = 0;
    for (const s of Object.values(this.T)) {
      L.opaque.push({ group: s.body, model: M4.ident(), mat: { spec: 0.8, shine: 80, refl: 1.0, glow: glowT } });
      L.opaque.push({ group: s.wheel, model: M4.ident(), mat: { glow: new Float32Array(8) }, noCull: true });
      L.glass.push({ group: s.glass, model: M4.ident(), mat: { alpha: 0.55, flags: 2, spec: 1, shine: 160, refl: 1 }, dist: 1e9 });
    }
    L.opaque.push({ group: this.truck.body, model: M4.ident(), mat: { spec: 0.5, shine: 50, glow: glowT } });
    L.opaque.push({ group: this.truck.wheel, model: M4.ident(), mat: {}, noCull: true });
    // headlight spots of the two nearest oncoming vehicles
    if (head > 0.05) {
      spots.sort((a, b) => a.d - b.d);
      for (const s of spots.slice(0, 2)) ctx.spot([s.x - 0.1, 0.7, s.z], [-0.995, -0.08, 0.04], 10 * head, 0.9);
    }
  }

  trainFrame(ctx) {
    const { ox, cx, t, env } = ctx;
    const L = ctx.lists, tr = this.train;
    tr.coach.clear(); tr.bogie.clear();
    const xf = wrap(38 * t + 2200 - ox, cx - 1400, cx + 1800);
    const yb = 0.52;
    L.opaque.push({ mesh: tr.loco, model: M4.model(xf, yb, LY.trackZ), mat: { color: "#1d4f91", spec: 0.6, shine: 60, refl: 0.8, glow: g8b(env) } });
    for (const x of [xf - 4, xf - tr.t.Ll + 4]) tr.bogie.push(x, yb - 0.1, LY.trackZ);
    for (let i = 0; i < 6; i++) {
      const x = xf - tr.t.Ll - 0.6 - i * (tr.t.Lc + 0.6);
      tr.coach.push(x, yb, LY.trackZ, 0, 1, 1, 1, 0, 1, 1, 1, 0);
      for (const bx of [x - 3.5, x - tr.t.Lc + 3.5]) tr.bogie.push(bx, yb - 0.1, LY.trackZ);
    }
    L.opaque.push({ group: tr.coach, model: M4.ident(), mat: { color: "#d7dde3", spec: 0.6, shine: 60, glow: g8b(env, 7) } });
    L.opaque.push({ group: tr.bogie, model: M4.ident(), mat: {}, cast: false });
    if (env.headlights > 0.05 || env.night > 0.1) ctx.glow(xf + 0.1, 1.45, LY.trackZ, 2.4, [1, 0.95, 0.85], 1.0, 4);
  }

  // live text on the VMS gantries
  updateVMS(lines) {
    const key = lines.join("|");
    if (key === this.vmsLast) return;
    this.vmsLast = key;
    const c = this.vmsCtx, a = this.atlas.vms;
    MD.drawVMS(c.getContext("2d"), c.width, c.height, lines);
    this.R.updateAtlas(a.x, a.y, c);
  }
}
const MAT_WOOD = { color: "#5e4632", spec: 0.05, shine: 6, glow: 0, flag: 0 };
function g8b(env, grp = 1) { const a = new Float32Array(8); a[1] = 10 * env.headlights; a[2] = 3; a[7] = 5 * Math.max(env.night, 0.15); if (grp === 7) a[7] = 4 * Math.max(env.night, 0.1); return a; }
