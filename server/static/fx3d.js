// fx3d.js - effects for the 3D view: collision (sparks, debris, flash,
// shockwave, smoke, electric arcs), tyre smoke, skid marks, exhaust, rain with
// splashes, snow. Particles live in world coordinates (x along the road) and
// are converted to the floating origin when drawn.
//
// Particle record for the renderer: [x, y, z, size, r, g, b, a, vx, vy, vz, mode(+rot), dist]
//   modes: 0 smoke, 1 glow, 2 spark streak, 3 rain, 4 star flare, 5 snow, 6 ground ring

import { M4, boxGeo, lin } from "./gl3d.js";

const h1 = (i, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7 + 0.5) * 43758.5453; return v - Math.floor(v); };
const wrap = (v, a, b) => { const p = b - a; return ((((v - a) % p) + p) % p) + a; };

export class FX {
  constructor(R) {
    this.R = R;
    this.debrisMesh = R.mesh(boxGeo(1, 1, 1));
    this.debrisG = R.inst(this.debrisMesh, 160);
    this.skidMesh = R.mesh((() => { const g = boxGeo(1, 0.001, 1); return g; })());
    this.skidG = R.inst(this.skidMesh, 2400);
    this.reset();
  }
  reset() {
    this.parts = [];        // dynamic particles {x,y,z,vx,vy,vz,life,max,size,grow,col,alpha,mode,drag,g,bounce}
    this.debris = [];
    this.skids = [];        // {x0, x1, z, a}
    this.skidOpen = {};     // key -> {x0, z}
    this.impact = null;
    this.smokeAcc = 0; this.exhAcc = 0; this.tsAcc = 0; this.arcT = 0;
  }

  // ------------------------------------------------------------------ impact
  // x: world x of the contact point; v: closing speed; paints: linear rgb
  boom(x, v, egoPaint, leadPaint, plant) {
    const k = Math.min(1.6, 0.4 + v / 12);
    this.impact = { x, v, t: 0, plant, egoPaint, leadPaint };
    for (let i = 0; i < 160 * k; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 5.5 * k;
      this.parts.push({ x: x + (Math.random() - 0.5) * 0.3, y: 0.35 + Math.random() * 0.7, z: (Math.random() - 0.5) * 1.6,
        vx: Math.cos(a) * s * 0.7 + v * 0.2, vy: 1 + Math.random() * 4.5 * k, vz: Math.sin(a) * s * 0.8,
        life: 0.25 + Math.random() * 0.65, size: 0.025 + Math.random() * 0.025, col: Math.random() < 0.5 ? [1.0, 0.75, 0.3] : [1.0, 0.45, 0.12],
        alpha: 1, mode: 2, g: 9.8, bounce: 0.35, drag: 0.4, k: 8 });
    }
    // flash + shock ring
    this.parts.push({ x, y: 0.8, z: 0, vx: 0, vy: 0, vz: 0, life: 0.35, size: 2.0, grow: 6, col: [1, 0.8, 0.55], alpha: 1, mode: 1, g: 0, k: 6 });
    this.parts.push({ x, y: 0.03, z: 0, vx: 0, vy: 0, vz: 0, life: 0.9, size: 0.5, grow: 14, col: [1, 0.85, 0.7], alpha: 0.8, mode: 6, g: 0, k: 3 });
    // dust burst
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ x: x + (Math.random() - 0.5), y: 0.2 + Math.random() * 0.5, z: (Math.random() - 0.5) * 1.8, vx: Math.cos(a) * 2 + v * 0.1, vy: 0.4 + Math.random(), vz: Math.sin(a) * 2,
        life: 1.2 + Math.random() * 1.2, size: 0.35 + Math.random() * 0.4, grow: 1.0, col: [0.5, 0.48, 0.45], alpha: 0.2, mode: 0, g: -0.1, drag: 1.5 });
    }
    // debris chunks: paint, black plastic, glass
    const cols = [egoPaint, leadPaint, lin("#15171a"), lin("#9fc6e8"), lin("#dfe4ea")];
    for (let i = 0; i < 46 * Math.min(1.3, k); i++) {
      const c = cols[i % cols.length], glass = c === cols[3];
      const s = glass ? 0.03 + Math.random() * 0.05 : 0.05 + Math.random() * 0.18;
      this.debris.push({ x: x + (Math.random() - 0.5) * 0.4, y: 0.5 + Math.random() * 0.5, z: (Math.random() - 0.5) * 1.6,
        vx: (Math.random() - 0.2) * 5 * k + v * 0.35, vy: 1.5 + Math.random() * 4.5 * k, vz: (Math.random() - 0.5) * 6 * k,
        yaw: Math.random() * 6, roll: Math.random() * 6, wy: (Math.random() - 0.5) * 20, wr: (Math.random() - 0.5) * 20,
        sx: s * (0.6 + Math.random()), sy: s * 0.25, sz: s * (0.6 + Math.random()), col: c, rest: false });
    }
  }

  // ------------------------------------------------------------------ per frame
  // cars: [{xw, v, a, brake, paint, style, exhaust:[[x,y,z]], rearAxle, frontAxle, track, collided, wr}]
  step(dt, ctx) {
    dt = Math.min(dt, 0.05);
    const { env, q } = ctx;
    const P = this.parts;
    // emitters
    for (const c of ctx.cars) {
      // exhaust (ICE): idle + throttle
      if (c.exhaust && !c.collided && q.fx) {
        this.exhAcc += dt * (6 + Math.max(0, c.a) * 14) * (env.snow > 0 || env.night > 0.5 ? 1.6 : 1);
        while (this.exhAcc > 1) {
          this.exhAcc -= 1;
          for (const e of c.exhaust) P.push({ x: c.xw + e[0], y: e[1], z: e[2], vx: -1.2 + Math.random() * 0.6, vy: 0.25 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4,
            life: 0.9 + Math.random() * 0.8, size: 0.08, grow: 1.6, col: [0.62, 0.63, 0.65], alpha: 0.18 + (env.snow ? 0.15 : 0), mode: 0, g: -0.2, drag: 1.2 });
        }
      }
      // tyre smoke under very hard braking
      const decel = -c.a;
      if (decel > 6.0 && c.v > 2 && q.fx && !c.collided) {
        this.tsAcc += dt * (decel - 5.5) * 10;
        while (this.tsAcc > 1) {
          this.tsAcc -= 1;
          for (const ax of [c.frontAxle, c.rearAxle]) for (const sgn of [1, -1])
            P.push({ x: c.xw + ax, y: 0.1, z: c.z + sgn * c.track, vx: c.v * 0.15 + (Math.random() - 0.5), vy: 0.3 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.8,
              life: 0.9 + Math.random() * 1.0, size: 0.22, grow: 1.5, col: [0.78, 0.78, 0.8], alpha: 0.14, mode: 0, g: -0.15, drag: 1.4 });
        }
      }
      // skid marks
      for (const ax of [c.frontAxle, c.rearAxle]) for (const sgn of [1, -1]) {
        const key = `${c.id}${ax}${sgn}`, x = c.xw + ax, z = c.z + sgn * c.track;
        if (decel > 4.8 && c.v > 1.0 && !c.collided) {
          const o = this.skidOpen[key];
          if (!o) this.skidOpen[key] = { x0: x, z };
          else if (x - o.x0 > 0.6) { this.skids.push({ x0: o.x0, x1: x, z, a: Math.min(0.85, 0.25 + (decel - 4.8) * 0.18) }); this.skidOpen[key] = { x0: x, z }; }
        } else delete this.skidOpen[key];
      }
    }
    if (this.skids.length > 2300) this.skids.splice(0, this.skids.length - 2300);

    // after the impact: smoke / fire / arcs from the ego front
    const im = this.impact;
    if (im) {
      im.t += dt;
      const ego = ctx.cars.find((c) => c.id === "ego");
      if (ego) {
        this.smokeAcc += dt * (im.plant === "ice" ? 4 : 2.5);
        while (this.smokeAcc > 1) {
          this.smokeAcc -= 1;
          const dark = im.plant === "ice" ? 0.18 + Math.random() * 0.1 : 0.55 + Math.random() * 0.2;
          P.push({ x: ego.xw - 0.8 + Math.random() * 0.6, y: 0.9, z: (Math.random() - 0.5) * 0.9, vx: 0.2 + (env.wind - 0.6) * 0.6, vy: 0.9 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.3,
            life: 2.5 + Math.random() * 1.5, size: 0.3, grow: 0.55, col: [dark, dark, dark * 1.02], alpha: im.plant === "ice" ? 0.32 : 0.16, mode: 0, g: -0.15, drag: 0.4 });
        }
        if (im.plant === "ice" && Math.random() < dt * 14)
          P.push({ x: ego.xw - 0.35 + Math.random() * 0.3, y: 0.55 + Math.random() * 0.2, z: (Math.random() - 0.5) * 0.8, vx: 0, vy: 0.8, vz: 0,
            life: 0.25 + Math.random() * 0.25, size: 0.22 + Math.random() * 0.2, grow: -0.5, col: [1.0, 0.45, 0.1], alpha: 0.9, mode: 1, g: -1, k: 6 });
        if (im.plant === "ev") {
          this.arcT -= dt;
          if (this.arcT <= 0) {
            this.arcT = 0.35 + Math.random() * 0.9;
            for (let i = 0; i < 26; i++) {
              const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 4;
              P.push({ x: ego.xw - 0.4, y: 0.45 + Math.random() * 0.3, z: (Math.random() - 0.5) * 1.2, vx: Math.cos(a) * s, vy: 1 + Math.random() * 3, vz: Math.sin(a) * s,
                life: 0.2 + Math.random() * 0.35, size: 0.02, col: [0.45, 0.75, 1.0], alpha: 1, mode: 2, g: 9.8, bounce: 0.3, drag: 0.5, k: 12 });
            }
            P.push({ x: ego.xw - 0.4, y: 0.6, z: 0, vx: 0, vy: 0, vz: 0, life: 0.12, size: 1.4, col: [0.5, 0.75, 1.0], alpha: 1, mode: 1, g: 0, k: 14 });
          }
        }
      }
    }

    // integrate
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) { P.splice(i, 1); continue; }
      const dr = Math.exp(-(p.drag || 0) * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - (p.g || 0) * dt;
      p.vx += (env.wind - 0.6) * 0.3 * dt * (p.mode === 0 ? 1 : 0);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.bounce && p.y < 0.02) { p.y = 0.02; p.vy = -p.vy * p.bounce; p.vx *= 0.6; p.vz *= 0.6; }
      if (p.grow) p.size = Math.max(0.01, p.size + p.grow * dt);
      if (p.max === undefined) p.max = p.life + dt;
    }
    if (P.length > 2400) P.splice(0, P.length - 2400);
    // debris
    for (const d of this.debris) {
      if (d.rest) continue;
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.yaw += d.wy * dt; d.roll += d.wr * dt;
      if (d.y < d.sy / 2 + 0.005) {
        d.y = d.sy / 2 + 0.005; d.vy = -d.vy * 0.3; d.vx *= 0.55; d.vz *= 0.55; d.wy *= 0.6; d.wr *= 0.5;
        if (Math.abs(d.vy) < 0.4 && Math.hypot(d.vx, d.vz) < 0.3) { d.rest = true; d.roll = Math.round(d.roll / Math.PI) * Math.PI; }
      }
    }
  }

  // ------------------------------------------------------------------ output
  emit(ctx) {
    const { ox, env, cam, q, lists } = ctx;
    const A = lists.partsAlpha, D = lists.partsAdd;
    const E = cam.eye;
    const push = (arr, x, y, z, s, c, a, vx, vy, vz, mode) => {
      arr.push([x, y, z, s, c[0], c[1], c[2], a, vx, vy, vz, mode, (x - E[0]) ** 2 + (y - E[1]) ** 2 + (z - E[2]) ** 2]);
    };
    for (const p of this.parts) {
      const life = p.max ? p.life / p.max : 1;
      const a = p.alpha * (p.mode === 0 ? Math.min(1, life * 1.6) * Math.min(1, (1 - life) * 6 + 0.2) : Math.min(1, life * 2.5));
      const k = p.k || 1;
      const col = [p.col[0] * k, p.col[1] * k, p.col[2] * k];
      const rot = (h1(p.size * 1000 + p.x, 1) * 0.999);
      if (p.mode === 0) push(A, p.x - ox, p.y, p.z, p.size, mixLight(p.col, env), a, 0, 0, 0, 0 + rot);
      else if (p.mode === 6) push(D, p.x - ox, p.y, p.z, p.size, col, a, 0, 0, 0, 6);
      else push(D, p.x - ox, p.y, p.z, p.size, col, a, p.mode === 2 ? p.vx : 0, p.mode === 2 ? p.vy : 0, p.mode === 2 ? p.vz : 0, p.mode);
    }
    // weather
    const tx = cam.target[0], tz = cam.target[2], now = ctx.now;
    if (env.rain > 0 && q.weatherFx) {
      const n = Math.floor(1700 * q.parts);
      for (let i = 0; i < n; i++) {
        const hx = h1(i, 1), hz = h1(i, 2), hy = h1(i, 3);
        const x = tx + wrap(hx * 70 - ox, -35, 35), z = tz + (hz - 0.5) * 50;
        const y = 20 - ((hy + now * 0.52) % 1) * 20;
        push(A, x, y, z, 0.008, [0.62, 0.66, 0.72].map((v) => v * (0.5 + env.ambSky[1] * 2 + env.lampsOn * 0.5)), 0.5, -1.5, -9.5, 0.6, 3);
      }
      const ns = Math.floor(260 * q.parts);
      for (let i = 0; i < ns; i++) {
        const ph = (h1(i, 7) + now * 2.2) % 1;
        const x = tx + wrap(h1(i, 5) * 60 - ox + Math.floor(now * 2.2 + h1(i, 7)) * 13.7, -30, 30), z = tz + (h1(i, 6) - 0.5) * 30;
        push(A, x, 0.03, z, 0.05 + ph * 0.12, [0.8, 0.82, 0.86], 0.35 * (1 - ph), 0, 0, 0, 6);
      }
    }
    if (env.snowfall > 0 && q.weatherFx) {
      const n = Math.floor(2400 * q.parts);
      for (let i = 0; i < n; i++) {
        const hx = h1(i, 11), hz = h1(i, 12), hy = h1(i, 13);
        const x = tx + wrap(hx * 80 - ox + Math.sin(now * 0.7 + i) * 0.8, -40, 40), z = tz + (hz - 0.5) * 60 + Math.cos(now * 0.6 + i * 1.3) * 0.6;
        const y = 22 - ((hy + now * 0.06) % 1) * 22;
        push(A, x, y, z, 0.03 + h1(i, 14) * 0.03, [0.95, 0.96, 1.0].map((v) => v * (0.4 + env.ambSky[1] * 1.6 + env.lampsOn * 0.4)), 0.85, 0, 0, 0, 5);
      }
    }
    // skid marks and debris (instanced, world -> relative)
    const SG = this.skidG; SG.clear();
    for (const s of this.skids) {
      const xa = s.x0 - ox, xb = s.x1 - ox;
      if (xb < -400 || xa > 600) continue;
      SG.push((xa + xb) / 2, 0.006, s.z, 0, xb - xa + 0.05, 1, 0.21, 0, 0.12, 0.12, 0.12, 2, s.a);
    }
    const DG = this.debrisG; DG.clear();
    for (const d of this.debris) DG.push(d.x - ox, d.y, d.z, d.yaw, d.sx, d.sy, d.sz, d.roll, d.col[0], d.col[1], d.col[2], 1);
    lists.groups.push(SG, DG);
    if (SG.n) lists.glass.push({ group: SG, model: M4.ident(), mat: { color: "#202020", alpha: 0.999, spec: 0.1, shine: 10 }, dist: 1e12 });
    if (DG.n) lists.opaque.push({ group: DG, model: M4.ident(), mat: { spec: 0.9, shine: 90, refl: 1 }, noCull: true });
  }
}
// smoke takes the ambient light level (so it is dark at night)
function mixLight(c, env) {
  const l = Math.min(1.4, 0.25 + env.ambSky[1] * 1.4 + env.sunCol[1] * 0.18 + env.lampsOn * 0.25);
  return [c[0] * l, c[1] * l, c[2] * l];
}
