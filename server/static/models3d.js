// models3d.js - procedural models for the 3D view: detailed cars (EV fastback,
// ICE sport sedan, leader SUV, traffic), wheels, trucks, train, vegetation,
// highway furniture, farms, wind turbines, city, mountains, and the texture
// atlas (licence plates, road signs, billboards, VMS panel).
//
// Car frame: x = 0 at the front bumper, the car extends to x = -L; y up from
// the road; z across (+z is the right-hand side when driving towards +x).

import { Geo, M4, boxGeo, boxAt, cylGeo, coneGeo, sphereGeo, icoGeo, latheZ, extrudeXY, segGeo, loftGeo, capGeo, planeGeo } from "./gl3d.js";

// ============================================================================ materials
export const MAT = {
  paint: { color: null, spec: -1, shine: -1, glow: 0, flag: 0 },
  trim: { color: "#16181b", spec: 0.3, shine: 30, glow: 0, flag: 0 },
  gloss: { color: "#0d0f12", spec: 0.9, shine: 110, glow: 0, flag: 0 },
  chrome: { color: "#dfe4ea", spec: 1.0, shine: 140, glow: 0, flag: 0 },
  alu: { color: "#b9c0c8", spec: 0.85, shine: 90, glow: 0, flag: 0 },
  gun: { color: "#3b4046", spec: 0.8, shine: 80, glow: 0, flag: 0 },
  rubber: { color: "#141516", spec: 0.06, shine: 6, glow: 0, flag: 0 },
  glass: { color: "#0f171f", spec: 1.0, shine: 180, glow: 0, flag: 0 },
  head: { color: "#eef3fa", spec: 1.0, shine: 140, glow: 1, flag: 0 },
  drl: { color: "#e4ecff", spec: 0.7, shine: 90, glow: 5, flag: 0 },
  tail: { color: "#a8120c", spec: 0.85, shine: 100, glow: 2, flag: 0 },
  brake3: { color: "#c0150e", spec: 0.6, shine: 60, glow: 3, flag: 0 },
  ind: { color: "#ff8b14", spec: 0.7, shine: 80, glow: 4, flag: 0 },
  rev: { color: "#dcdcdc", spec: 0.7, shine: 80, glow: 0, flag: 0 },
  grille: { color: "#0c0d10", spec: 0.4, shine: 40, glow: 0, flag: 0 },
  under: { color: "#0a0b0c", spec: 0.04, shine: 4, glow: 0, flag: 0 },
  seat: { color: "#22252a", spec: 0.12, shine: 10, glow: 0, flag: 0 },
  dash: { color: "#191b1f", spec: 0.25, shine: 20, glow: 0, flag: 0 },
  screen: { color: "#5ab8ff", spec: 0.7, shine: 90, glow: 5, flag: 0 },
  skin: { color: "#c8987a", spec: 0.12, shine: 12, glow: 0, flag: 0 },
  disc: { color: "#8f9499", spec: 0.75, shine: 70, glow: 6, flag: 0 },
  plate: { color: "#ffffff", spec: 0.35, shine: 40, glow: 0, flag: 1 },
  white: { color: "#e9ebee", spec: 0.3, shine: 30, glow: 0, flag: 0 },
  wood: { color: "#5e4632", spec: 0.05, shine: 6, glow: 0, flag: 0 },
};
const m = (base, over) => ({ ...base, ...over });

// ============================================================================ atlas
// One 2048x2048 canvas with every texture; uv(name) -> [u0, v0, u1, v1]
export function buildAtlas() {
  const S = 2048, cv = document.createElement("canvas");
  cv.width = S; cv.height = S;
  const g = cv.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, S, S);
  const uv = {};
  let sx = 0, sy = 0, rowH = 0;
  const alloc = (name, w, h) => {
    if (sx + w > S) { sx = 0; sy += rowH + 4; rowH = 0; }
    const r = { x: sx, y: sy, w, h };
    uv[name] = [(sx + 1) / S, (sy + 1) / S, (sx + w - 1) / S, (sy + h - 1) / S];
    sx += w + 4; rowH = Math.max(rowH, h);
    return r;
  };
  const F = "Inter, 'Helvetica Neue', Arial, sans-serif";
  const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };

  // Mercosul licence plates
  const plate = (name, text) => {
    const r = alloc(name, 320, 104);
    g.fillStyle = "#fbfbfb"; round(r.x, r.y, r.w, r.h, 10); g.fill();
    g.strokeStyle = "#1b1b1b"; g.lineWidth = 4; round(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 9); g.stroke();
    g.fillStyle = "#0b3d91"; g.fillRect(r.x + 4, r.y + 4, r.w - 8, 22);
    g.fillStyle = "#fff"; g.font = `700 15px ${F}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("BRASIL", r.x + r.w / 2, r.y + 15);
    g.fillStyle = "#009b3a"; g.fillRect(r.x + r.w - 34, r.y + 8, 22, 15);
    g.fillStyle = "#fedf00"; g.beginPath(); g.moveTo(r.x + r.w - 23, r.y + 9); g.lineTo(r.x + r.w - 13, r.y + 15.5); g.lineTo(r.x + r.w - 23, r.y + 22); g.lineTo(r.x + r.w - 33, r.y + 15.5); g.fill();
    g.fillStyle = "#111"; g.font = `800 54px ${F}`;
    g.fillText(text, r.x + r.w / 2, r.y + 66);
  };
  plate("plate_ev", "KTR0E26"); plate("plate_ice", "KTR1C34"); plate("plate_lead", "LDR2A26");
  for (let i = 0; i < 6; i++) plate(`plate_t${i}`, ["BRA2E19", "SPO4F21", "RIO9G33", "MGS1H08", "PRN7K55", "SCA3M12"][i]);

  // speed limit 110
  {
    const r = alloc("speed110", 256, 256);
    g.fillStyle = "#fff"; g.beginPath(); g.arc(r.x + 128, r.y + 128, 124, 0, 7); g.fill();
    g.strokeStyle = "#d21f1f"; g.lineWidth = 30; g.beginPath(); g.arc(r.x + 128, r.y + 128, 105, 0, 7); g.stroke();
    g.fillStyle = "#111"; g.font = `800 92px ${F}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("110", r.x + 128, r.y + 136);
    g.font = `700 22px ${F}`; g.fillText("km/h", r.x + 128, r.y + 192);
  }
  // green highway signs
  const sign = (name, lines, arrow) => {
    const r = alloc(name, 768, 288);
    g.fillStyle = "#0a6b3b"; round(r.x, r.y, r.w, r.h, 22); g.fill();
    g.strokeStyle = "#f4f4f4"; g.lineWidth = 8; round(r.x + 12, r.y + 12, r.w - 24, r.h - 24, 16); g.stroke();
    g.fillStyle = "#fff"; g.textAlign = "left"; g.textBaseline = "middle";
    lines.forEach((l, i) => { g.font = `${i === 0 ? 800 : 600} ${i === 0 ? 58 : 40}px ${F}`; g.fillText(l, r.x + 48, r.y + 82 + i * 72); });
    if (arrow) {
      g.save(); g.translate(r.x + r.w - 110, r.y + r.h / 2);
      g.beginPath(); g.moveTo(-30, 40); g.lineTo(-30, -10); g.lineTo(-55, -10); g.lineTo(0, -70); g.lineTo(55, -10); g.lineTo(30, -10); g.lineTo(30, 40); g.closePath();
      g.fill(); g.restore();
    }
  };
  sign("sign_a", ["KTRL Proving Ground", "ACC test track · lane 1", "Hierarchical controller"], true);
  sign("sign_b", ["Mesh 1 · speed loop", "Mesh 2 · distance loop", "switch when d ≤ d_ref"], true);
  sign("sign_c", ["São Paulo  82 km", "Campinas  24 km", "Ktrl Labs  3 km"], false);
  // billboards
  const ad = (name, bg, fg, title, sub, accent) => {
    const r = alloc(name, 768, 256);
    const grd = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1]);
    g.fillStyle = grd; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = accent; g.fillRect(r.x, r.y + r.h - 22, r.w, 22);
    g.fillStyle = fg; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.font = `900 78px ${F}`; g.fillText(title, r.x + 40, r.y + 112);
    g.font = `600 34px ${F}`; g.fillText(sub, r.x + 44, r.y + 172);
  };
  ad("ad_0", ["#1d2a44", "#3b5ba5"], "#ffffff", "KTRL", "Adaptive Cruise Control · EV & ICE", "#5ab8ff");
  ad("ad_1", ["#f6f1e7", "#e6d9c2"], "#1d1d1d", "Keep 2 seconds", "the distance loop does it for you", "#e5534b");
  ad("ad_2", ["#0f3b2e", "#1f7a58"], "#ffffff", "Mesh 1 + Mesh 2", "speed and distance, one controller", "#ffd166");
  ad("ad_3", ["#3a1450", "#8d2b88"], "#ffffff", "ZERO EMISSIONS", "DC motor · regen braking · 0 g CO₂", "#4fc3a1");
  // trailer logo
  {
    const r = alloc("trailer", 1024, 256);
    g.fillStyle = "#f3f4f6"; g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = "#1d2a44"; g.fillRect(r.x, r.y + 190, r.w, 40);
    g.fillStyle = "#5ab8ff"; g.fillRect(r.x, r.y + 232, r.w, 12);
    g.fillStyle = "#1d2a44"; g.font = `900 120px ${F}`; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillText("KTRL", r.x + 50, r.y + 150);
    g.font = `700 44px ${F}`; g.fillText("LOGISTICS · keeps its distance", r.x + 380, r.y + 140);
  }
  // km numbers
  for (let k = 0; k < 100; k++) {
    const r = alloc(`km${k}`, 96, 64);
    g.fillStyle = "#0a6b3b"; g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = "#fff"; g.lineWidth = 3; g.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 13px ${F}`; g.fillText("KM", r.x + 48, r.y + 18);
    g.font = `800 28px ${F}`; g.fillText(String(k), r.x + 48, r.y + 42);
  }
  // VMS panel (rewritten live)
  const vms = alloc("vms", 512, 128);
  // windows strip of train coaches
  {
    const r = alloc("coach", 512, 64);
    g.fillStyle = "#cfd5dc"; g.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < 8; i++) { g.fillStyle = "#1a242e"; g.fillRect(r.x + 12 + i * 62, r.y + 10, 48, 40); }
  }
  return { canvas: cv, uv, vms };
}

// draw the variable-message sign (amber LED text)
export function drawVMS(ctx, w, h, lines) {
  ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#0e0e0e";
  for (let y = 3; y < h; y += 6) for (let x = 3; x < w; x += 6) ctx.fillRect(x, y, 3, 3);
  ctx.fillStyle = "#ffb627"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "700 40px 'Courier New', monospace";
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length > 1 ? 0.5 : 0)) * 48));
}

// textured quad facing +x or -x (licence plates, signs)
function texQuad(g, x, y0, y1, w, uvr, facing, yoff = 0) {
  const [u0, v0, u1, v1] = uvr;
  g.paint(MAT.plate);
  if (facing > 0) g.quad([x, y0, w / 2 + yoff], [x, y0, -w / 2 + yoff], [x, y1, -w / 2 + yoff], [x, y1, w / 2 + yoff], [1, 0, 0], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
  else g.quad([x, y0, -w / 2 + yoff], [x, y0, w / 2 + yoff], [x, y1, w / 2 + yoff], [x, y1, -w / 2 + yoff], [-1, 0, 0], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
}
// textured quad in the XY plane facing +z (z fixed)
function texQuadZ(g, x0, x1, y0, y1, z, uvr, facing = 1) {
  const [u0, v0, u1, v1] = uvr;
  g.paint(MAT.plate);
  if (facing > 0) g.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
  else g.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], [0, 0, -1], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
}

// ============================================================================ cars
const lerpTab = (tab, s) => {
  if (s <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (s <= tab[i][0]) {
    const [s0, y0] = tab[i - 1], [s1, y1] = tab[i];
    const t = (s - s0) / (s1 - s0), e = t * t * (3 - 2 * t);
    return y0 + (y1 - y0) * (0.35 * t + 0.65 * e);
  }
  return tab[tab.length - 1][1];
};

const STYLES = {
  ev: {
    hw: 0.93, wr: 0.345, bot: 0.17, axF: 0.192, axR: 0.79, ch: 0.075,
    top: [[0, 0.55], [0.015, 0.65], [0.05, 0.73], [0.12, 0.79], [0.26, 0.855], [0.62, 0.9], [0.8, 0.935], [0.93, 0.945], [0.975, 0.9], [1, 0.6]],
    gh: { A0: 0.27, A1: 0.45, B: 0.535, C1: 0.64, C0: 0.935, roof: 1.43, glassRoof: true, cpillar: 0.88 },
    cladding: false, spoiler: false, exhaust: false, rails: false, lightbar: true, rim: "aero",
  },
  ice: {
    hw: 0.92, wr: 0.34, bot: 0.15, axF: 0.188, axR: 0.8, ch: 0.07,
    top: [[0, 0.54], [0.02, 0.67], [0.06, 0.77], [0.27, 0.875], [0.66, 0.925], [0.8, 0.965], [0.95, 0.975], [0.985, 0.92], [1, 0.65]],
    gh: { A0: 0.29, A1: 0.46, B: 0.555, C1: 0.68, C0: 0.835, roof: 1.39, glassRoof: false, cpillar: 0.73 },
    cladding: false, spoiler: true, exhaust: true, rails: false, lightbar: false, rim: "sport",
  },
  suv: {
    hw: 0.96, wr: 0.37, bot: 0.24, axF: 0.19, axR: 0.8, ch: 0.08,
    top: [[0, 0.7], [0.02, 0.85], [0.06, 0.95], [0.24, 1.02], [0.7, 1.06], [0.95, 1.08], [0.99, 1.02], [1, 0.76]],
    gh: { A0: 0.25, A1: 0.39, B: 0.5, C1: 0.88, C0: 0.955, roof: 1.72, glassRoof: false, cpillar: 0.86, B2: 0.72 },
    cladding: true, spoiler: false, exhaust: true, rails: true, lightbar: false, rim: "six",
  },
  sedan: {
    hw: 0.9, wr: 0.33, bot: 0.17, axF: 0.19, axR: 0.8, ch: 0.07,
    top: [[0, 0.56], [0.02, 0.68], [0.06, 0.77], [0.27, 0.86], [0.66, 0.91], [0.8, 0.95], [0.95, 0.96], [0.985, 0.9], [1, 0.64]],
    gh: { A0: 0.29, A1: 0.46, B: 0.555, C1: 0.68, C0: 0.84, roof: 1.41, glassRoof: false, cpillar: 0.73 },
    cladding: false, spoiler: false, exhaust: false, rails: false, lightbar: false, rim: "six",
  },
  hatch: {
    hw: 0.88, wr: 0.32, bot: 0.17, axF: 0.2, axR: 0.83, ch: 0.07,
    top: [[0, 0.58], [0.02, 0.7], [0.07, 0.79], [0.28, 0.87], [0.7, 0.92], [0.93, 0.96], [0.98, 0.93], [1, 0.68]],
    gh: { A0: 0.3, A1: 0.47, B: 0.57, C1: 0.86, C0: 0.97, roof: 1.47, glassRoof: false, cpillar: 0.86 },
    cladding: true, spoiler: false, exhaust: false, rails: false, lightbar: false, rim: "six",
  },
};

// returns { body, glass, interior, wheel, wheelL?, chassis, axles:[xf,xr], wr, track, lights }
export function buildCar(style, L, opts = {}) {
  const S = STYLES[style], k = L / 4.5;
  const X = (s) => -s * L;
  const hwOf = (s) => S.hw * (1 - 0.11 * (1 - smoothstep(0, 0.1, s)) - 0.09 * smoothstep(0.9, 1, s));
  const wr = S.wr * Math.min(1.08, Math.max(0.92, k));
  const Ra = wr + 0.055;
  const axles = [-S.axF * L, -S.axR * L];
  const botOf = (s) => {
    const x = X(s);
    let b = S.bot;
    for (const ax of axles) {
      const dx = x - ax;
      if (Math.abs(dx) < Ra) b = Math.max(b, wr + Math.sqrt(Ra * Ra - dx * dx) * 0.98);
    }
    return b;
  };
  // stations
  const ss = new Set();
  for (let s = 0; s <= 1.0001; s += 0.02) ss.add(+s.toFixed(4));
  for (const ax of axles) for (let a = -1; a <= 1.0001; a += 0.125) ss.add(+(-(ax + a * Ra) / L).toFixed(5));
  [0.004, 0.012, 0.988, 0.996].forEach((s) => ss.add(s));
  const stations = [...ss].filter((s) => s >= 0 && s <= 1).sort((a, b) => a - b);

  const body = new Geo(), glass = new Geo(), inter = new Geo();
  const ring = (s) => {
    const x = X(s), top = lerpTab(S.top, s), bot = Math.min(botOf(s), top - 0.06), hw = hwOf(s);
    const c = Math.min(S.ch, (top - bot) * 0.3);
    const sideTop = top - c, sideLow = Math.min(bot + 0.13, sideTop - 0.02);
    return [[x, bot, hw - 0.06], [x, sideLow, hw], [x, sideTop, hw], [x, top, hw - c * 1.3],
            [x, top, -hw + c * 1.3], [x, sideTop, -hw], [x, sideLow, -hw], [x, bot, -hw + 0.06]];
  };
  const rings = stations.map(ring);
  const lowMat = S.cladding ? MAT.trim : MAT.paint;
  const G0 = S.gh;
  loftGeo(rings, (i, k2) => {
    const sm = (stations[i] + stations[i + 1]) / 2;
    if (k2 === 3 && sm > G0.A0 + 0.01 && sm < G0.C0 - 0.01) return MAT.dash;
    return k2 === 7 ? MAT.under : k2 === 0 || k2 === 6 ? lowMat : MAT.paint;
  }, body);
  const inside = [-L / 2, 0.55, 0];
  const r0 = rings[0].slice(); r0.inside = inside; capGeo(r0, MAT.paint, body);
  const r1 = rings[rings.length - 1].slice(); r1.inside = inside; capGeo(r1, MAT.paint, body);

  // ---------------------------------------------------------------- greenhouse
  const G = G0;
  const beltOf = (s) => lerpTab(S.top, s) - 0.004;
  const roofOf = (s) => {
    if (s <= G.A1) { const t = (s - G.A0) / (G.A1 - G.A0); return beltOf(G.A0) + (G.roof - beltOf(G.A0)) * t; }   // flat windshield
    if (s <= G.C1) return G.roof + 0.015 * Math.sin(((s - G.A1) / (G.C1 - G.A1)) * Math.PI);
    const t = (s - G.C1) / (G.C0 - G.C1);
    return G.roof + (beltOf(G.C0) - G.roof) * (style === "suv" ? t ** 1.6 : t);
  };
  const gs = new Set();
  for (let s = G.A0; s <= G.C0 + 1e-6; s += 0.03) gs.add(+s.toFixed(4));
  [G.A0, G.A1, G.B - 0.012, G.B + 0.012, G.C1, G.C0, G.cpillar, ...(G.B2 ? [G.B2 - 0.01, G.B2 + 0.01] : [])].forEach((s) => gs.add(+s.toFixed(4)));
  const gst = [...gs].filter((s) => s >= G.A0 && s <= G.C0).sort((a, b) => a - b);
  const grings = gst.map((s) => {
    const x = X(s), b = beltOf(s), r = Math.max(b + 0.001, roofOf(s)), wb = hwOf(s) - 0.075;
    const wt = wb - (style === "suv" ? 0.12 : 0.17);
    return [[x, b, wb], [x, r, wt], [x, r, -wt], [x, b, -wb]];
  });
  const glassM = { ...MAT.glass, geo: glass };
  loftGeo(grings, (i, k2) => {
    const sm = (gst[i] + gst[i + 1]) / 2;
    if (k2 === 3) return false;
    if (k2 === 1) {                                            // top: windshield, roof, rear glass
      if (sm < G.A1 - 0.005) return glassM;
      if (sm > G.C1 + 0.005) return glassM;
      return G.glassRoof ? MAT.gloss : MAT.paint;
    }
    if (Math.abs(sm - G.B) < 0.012 || (G.B2 && Math.abs(sm - G.B2) < 0.01)) return MAT.gloss;     // B pillar
    if (sm > G.cpillar) return MAT.paint;                                                        // C pillar
    return glassM;
  }, body);
  // pillars and frames
  const gr0 = grings[0], grA1 = grings[gst.indexOf(+G.A1.toFixed(4))] || grings[1];
  const grC1 = grings[gst.indexOf(+G.C1.toFixed(4))] || grings[grings.length - 2], grC0 = grings[grings.length - 1];
  const pillar = G.glassRoof ? MAT.gloss : MAT.paint;
  for (const sgn of [1, -1]) {
    const p = (pt) => [pt[0], pt[1], pt[2] * sgn > 0 ? pt[2] : pt[2]];
    const A0 = sgn > 0 ? gr0[0] : gr0[3], A1 = sgn > 0 ? grA1[1] : grA1[2];
    const C1 = sgn > 0 ? grC1[1] : grC1[2], C0 = sgn > 0 ? grC0[0] : grC0[3];
    body.add(segGeo(p(A0), p(A1), 0.04, pillar));
    body.add(segGeo(p(A1), p(C1), 0.03, pillar));
    if (G.cpillar >= G.C0 - 0.01) body.add(segGeo(p(C1), p(C0), 0.04, pillar));
    // belt-line chrome strip
    body.add(segGeo([A0[0], A0[1] + 0.01, A0[2] + 0.01 * sgn], [C0[0], C0[1] + 0.01, C0[2] + 0.01 * sgn], 0.012, style === "ev" ? MAT.gloss : MAT.chrome));
  }
  // windshield wipers
  for (const z of [-0.25, 0.35]) body.add(segGeo([X(G.A0) - 0.05, beltOf(G.A0) + 0.03, z], [X(G.A0) - 0.12, beltOf(G.A0) + 0.06, z - 0.5], 0.01, MAT.trim));

  // ---------------------------------------------------------------- details
  const hwF = hwOf(0.02), topF = lerpTab(S.top, 0.03), topR = lerpTab(S.top, 0.985);
  const lights = { head: [], tail: [], ind: [] };
  // front: headlamps, DRL, grille, intake, fog, plate, badge
  for (const sgn of [1, -1]) {
    const z = sgn * (hwF - 0.3);
    if (style === "ev") {
      body.add(boxGeo(0.2, 0.06, 0.4, MAT.head), M4.model(-0.09, topF - 0.05, z, sgn * 0.12));
      body.add(boxGeo(0.12, 0.025, 0.5, MAT.drl), M4.model(-0.05, topF - 0.005, z * 0.95, sgn * 0.1));
    } else if (style === "suv") {
      body.add(boxGeo(0.14, 0.12, 0.34, MAT.head), M4.model(-0.05, topF - 0.1, z, sgn * 0.08));
      body.add(boxGeo(0.1, 0.03, 0.36, MAT.drl), M4.model(-0.03, topF - 0.02, z, sgn * 0.08));
    } else {
      body.add(boxGeo(0.2, 0.09, 0.42, MAT.head), M4.model(-0.08, topF - 0.08, z, sgn * 0.15));
      body.add(boxGeo(0.14, 0.022, 0.42, MAT.drl), M4.model(-0.06, topF - 0.025, z, sgn * 0.15));
      body.add(cylGeo(0.05, 0.05, 0.04, 12, true, MAT.head), M4.model(0.0, 0.3, sgn * (hwF - 0.22), 0, -Math.PI / 2));
    }
    body.add(boxGeo(0.06, 0.04, 0.1, MAT.ind), M4.model(-0.05, topF - 0.12, sgn * (hwF - 0.08)));
    lights.head.push([0.02, topF - 0.07, z]);
  }
  if (style === "ev") {
    body.add(boxGeo(0.04, 0.02, hwF * 1.25, MAT.drl), M4.model(-0.07, topF + 0.015, 0));
    body.add(boxAt(-0.05, 0.22, -0.55, 0.012, 0.3, 0.55, MAT.grille));
  } else if (style === "suv") {
    body.add(boxAt(-0.05, 0.4, -0.55, 0.015, 0.68, 0.55, MAT.grille));
    for (let i = 0; i < 4; i++) body.add(boxAt(-0.04, 0.44 + i * 0.065, -0.54, 0.022, 0.452 + i * 0.065, 0.54, MAT.chrome));
    body.add(boxAt(-0.04, 0.25, -0.7, 0.02, 0.33, 0.7, MAT.alu));
  } else {
    body.add(boxAt(-0.05, 0.3, -0.48, 0.015, 0.5, 0.48, MAT.grille));
    body.add(boxAt(-0.05, 0.5, -0.5, 0.02, 0.515, 0.5, MAT.chrome));
    for (let i = 0; i < 3; i++) body.add(boxAt(-0.04, 0.34 + i * 0.05, -0.46, 0.018, 0.35 + i * 0.05, 0.46, MAT.gun));
    body.add(boxAt(-0.05, 0.2, -0.62, 0.01, 0.26, 0.62, MAT.grille));
  }
  texQuad(body, 0.022, 0.36, 0.475, 0.5, opts.plate || [0, 0, 1, 1], 1);
  body.add(cylGeo(0.05, 0.05, 0.02, 16, true, MAT.chrome), M4.model(0.0, lerpTab(S.top, 0) - 0.07, 0, 0, -Math.PI / 2));
  // rear: tail lamps, third brake, reverse, plate, exhaust, diffuser, spoiler
  const hwR = hwOf(0.985), xr = -L;
  if (S.lightbar) {
    body.add(boxGeo(0.05, 0.06, hwR * 2 - 0.1, MAT.tail), M4.model(xr + 0.01, topR - 0.07, 0));
    for (const sgn of [1, -1]) body.add(boxGeo(0.04, 0.03, 0.18, MAT.ind), M4.model(xr + 0.012, topR - 0.13, sgn * (hwR - 0.15)));
  } else if (style === "suv") {
    for (const sgn of [1, -1]) {
      body.add(boxGeo(0.08, 0.32, 0.16, MAT.tail), M4.model(xr + 0.02, topR - 0.12, sgn * (hwR - 0.1)));
      body.add(boxGeo(0.07, 0.06, 0.12, MAT.ind), M4.model(xr + 0.03, topR - 0.33, sgn * (hwR - 0.1)));
    }
  } else {
    for (const sgn of [1, -1]) {
      body.add(boxGeo(0.12, 0.11, 0.42, MAT.tail), M4.model(xr + 0.04, topR - 0.08, sgn * (hwR - 0.24), sgn * -0.12));
      body.add(boxGeo(0.06, 0.04, 0.12, MAT.ind), M4.model(xr + 0.025, topR - 0.15, sgn * (hwR - 0.16)));
      body.add(boxGeo(0.04, 0.04, 0.14, MAT.rev), M4.model(xr + 0.02, 0.4, sgn * 0.55));
    }
  }
  for (const sgn of [1, -1]) lights.tail.push([xr - 0.02, topR - 0.08, sgn * (hwR - 0.24)]);
  // third brake light on the roof edge / rear glass top
  const xC = X(G.C1 + (G.C0 - G.C1) * 0.08);
  body.add(boxGeo(0.05, 0.025, 0.45, MAT.brake3), M4.model(xC - 0.02, roofOf(G.C1 + (G.C0 - G.C1) * 0.08) - 0.03, 0));
  texQuad(body, xr - 0.012, 0.47, 0.585, 0.5, opts.plate || [0, 0, 1, 1], -1);
  if (S.exhaust) {
    body.add(boxAt(xr - 0.01, 0.18, -0.7, xr + 0.12, 0.3, 0.7, MAT.grille));
    for (const z of style === "ice" ? [-0.48, -0.36, 0.36, 0.48] : [-0.5]) body.add(cylGeo(0.042, 0.042, 0.14, 14, true, MAT.chrome), M4.model(xr + 0.06, 0.25, z, 0, Math.PI / 2));
    lights.exhaust = style === "ice" ? [[xr - 0.1, 0.25, -0.42], [xr - 0.1, 0.25, 0.42]] : [[xr - 0.1, 0.25, -0.5]];
  }
  if (S.spoiler) {
    body.add(boxGeo(0.24, 0.03, hwR * 2 - 0.2, MAT.gloss), M4.model(xr + 0.16, topR + 0.09, 0, 0, -0.08));
    for (const z of [-0.55, 0.55]) body.add(boxGeo(0.08, 0.09, 0.04, MAT.gloss), M4.model(xr + 0.18, topR + 0.04, z));
  }
  if (S.rails) for (const z of [-0.62, 0.62]) {
    body.add(segGeo([X(G.A1) - 0.1, G.roof + 0.06, z], [X(G.C1) + 0.1, G.roof + 0.06, z], 0.022, MAT.alu));
    for (const s of [G.A1 + 0.02, G.C1 - 0.02]) body.add(boxGeo(0.08, 0.06, 0.05, MAT.trim), M4.model(X(s), G.roof + 0.03, z));
  }
  // shark-fin antenna
  body.add(extrudeXY([[0, 0], [0.18, 0], [0.04, 0.07]], 0.05, MAT.gloss), M4.model(X(G.C1) + 0.05, roofOf(G.C1) - 0.005, 0, Math.PI));
  // mirrors
  for (const sgn of [1, -1]) {
    const s = G.A0 + 0.035, x = X(s), y = beltOf(s) + 0.1, z = sgn * (hwOf(s) + 0.1);
    body.add(boxGeo(0.11, 0.1, 0.2, MAT.paint), M4.model(x - 0.02, y, z));
    body.add(boxGeo(0.02, 0.07, 0.16, MAT.glass), M4.model(x - 0.08, y, z));
    body.add(boxGeo(0.06, 0.012, 0.05, MAT.ind), M4.model(x + 0.01, y - 0.045, z + sgn * 0.06));
    body.add(segGeo([x, y - 0.03, z - sgn * 0.08], [x + 0.02, y - 0.08, sgn * (hwOf(s) - 0.03)], 0.015, MAT.trim));
  }
  // door gaps and handles
  for (const sgn of [1, -1]) {
    for (const s of [G.A0 + 0.01, G.B, style === "hatch" ? G.C1 - 0.06 : G.cpillar - 0.02]) {
      const x = X(s), z = sgn * (hwOf(s) + 0.003);
      body.add(boxGeo(0.01, beltOf(s) - botOf(s) - 0.12, 0.006, MAT.gloss), M4.model(x, (beltOf(s) + botOf(s)) / 2 + 0.02, z));
    }
    for (const s of [G.B - 0.07, G.cpillar - 0.1]) {
      const x = X(s), z = sgn * (hwOf(s) + 0.012);
      body.add(boxGeo(0.16, 0.03, 0.02, style === "ev" ? MAT.gloss : MAT.chrome), M4.model(x, beltOf(s) - 0.09, z));
    }
  }
  if (style === "ev") {
    // charge port with a glow ring (left rear fender)
    const s = 0.86, x = X(s);
    body.add(boxGeo(0.14, 0.12, 0.01, MAT.gloss), M4.model(x, beltOf(s) - 0.08, -(hwOf(s) + 0.004)));
    body.add(boxGeo(0.04, 0.02, 0.012, MAT.screen), M4.model(x, beltOf(s) - 0.04, -(hwOf(s) + 0.006)));
  }
  if (style === "ice") {
    for (const sgn of [1, -1]) body.add(boxAt(axles[0] - Ra, 0.13, sgn * (S.hw - 0.04), axles[1] + Ra, 0.2, sgn * (S.hw + 0.025), MAT.gloss));
    // fuel flap
    body.add(boxGeo(0.14, 0.14, 0.008, MAT.paint), M4.model(X(0.84), beltOf(0.84) - 0.12, hwOf(0.84) + 0.003));
  }

  // ---------------------------------------------------------------- interior
  if (opts.interior !== false) {
    const zd = -0.38, sF = G.A0 + (G.C1 - G.A0) * 0.52, xF = X(sF), yb = beltOf(sF) - 0.45;
    inter.add(boxAt(X(G.A0 + 0.01), beltOf(G.A0) - 0.18, -hwOf(G.A0) + 0.12, X(G.A0 + 0.08), beltOf(G.A0) + 0.06, hwOf(G.A0) - 0.12, MAT.dash));
    if (style === "ev") inter.add(boxGeo(0.02, 0.2, 0.32, MAT.screen), M4.model(X(G.A0 + 0.085) - 0.01, beltOf(G.A0) + 0.12, 0.02, 0, 0.35));
    else inter.add(boxGeo(0.02, 0.08, 0.18, MAT.screen), M4.model(X(G.A0 + 0.085) - 0.01, beltOf(G.A0) + 0.02, 0.05, 0, 0.3));
    for (const z of [zd, -zd]) {
      inter.add(boxGeo(0.5, 0.14, 0.48, MAT.seat), M4.model(xF, yb + 0.08, z));
      inter.add(boxGeo(0.12, 0.6, 0.48, MAT.seat), M4.model(xF - 0.28, yb + 0.42, z, 0, 0.18));
      inter.add(boxGeo(0.1, 0.16, 0.26, MAT.seat), M4.model(xF - 0.36, yb + 0.82, z, 0, 0.18));
    }
    const sR = Math.min(G.C1, G.A0 + (G.C1 - G.A0) * 1.0), xR = X(sR) + 0.05;
    inter.add(boxGeo(0.45, 0.14, 1.4, MAT.seat), M4.model(xR, yb + 0.08, 0));
    inter.add(boxGeo(0.12, 0.55, 1.4, MAT.seat), M4.model(xR - 0.26, yb + 0.38, 0, 0, 0.22));
    // steering wheel (torus) and column
    const tor = [];
    for (let i = 0; i <= 12; i++) { const t = (i / 12) * Math.PI * 2; tor.push([0.18 + 0.022 * Math.cos(t), 0.022 * Math.sin(t)]); }
    const xs = X(G.A0 + 0.1);
    inter.add(latheZ(tor, 18, MAT.trim), M4.model(xs, beltOf(G.A0) + 0.02, zd, Math.PI / 2, 0, 1, 1, 1, 0.35));
    inter.add(segGeo([xs, beltOf(G.A0) + 0.02, zd], [xs + 0.18, beltOf(G.A0) - 0.04, zd], 0.025, MAT.trim));
    // driver
    const shirt = opts.shirt || "#3b5c8c";
    inter.add(boxGeo(0.24, 0.5, 0.4, { ...MAT.seat, color: shirt }), M4.model(xF - 0.16, yb + 0.47, zd, 0, 0.12));
    inter.add(sphereGeo(0.105, 12, 8, MAT.skin, 1.12), M4.model(xF - 0.18, yb + 0.88, zd));
    inter.add(sphereGeo(0.108, 12, 6, { ...MAT.seat, color: "#2b2118" }, 0.6), M4.model(xF - 0.2, yb + 0.93, zd));
    for (const dz of [-0.17, 0.17]) inter.add(segGeo([xF - 0.12, yb + 0.66, zd + dz], [xs - 0.03, beltOf(G.A0) + 0.05, zd + dz * 0.8], 0.04, { ...MAT.seat, color: shirt }));
  }

  // ---------------------------------------------------------------- wheels (local: axis z, outer face +z)
  const wd = 0.235, rIn = wr * 0.66;
  const wheel = new Geo();
  const tp = [[rIn - 0.005, -wd / 2], [wr - 0.06, -wd / 2 - 0.004], [wr - 0.012, -wd / 2 + 0.02], [wr, -wd / 2 + 0.05],
              [wr, wd / 2 - 0.05], [wr - 0.012, wd / 2 - 0.02], [wr - 0.06, wd / 2 + 0.004], [rIn - 0.005, wd / 2]];
  wheel.add(latheZ(tp, 30, MAT.rubber));
  // tread grooves
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    wheel.add(boxGeo(0.012, 0.01, wd - 0.08, MAT.under), M4.model(Math.cos(a) * (wr - 0.002), Math.sin(a) * (wr - 0.002), 0, 0, a));
  }
  wheel.add(latheZ([[rIn, wd / 2 - 0.01], [rIn, -wd / 2 + 0.02]], 30, MAT.gun));                  // barrel (inner face)
  wheel.add(latheZ([[rIn + 0.006, wd / 2 - 0.004], [rIn + 0.004, wd / 2 + 0.001], [rIn - 0.02, wd / 2 - 0.008]], 30, MAT.chrome)); // lip
  const face = wd / 2 - 0.035;
  const rim = S.rim, rimMat = rim === "sport" ? MAT.gun : MAT.alu;
  if (rim === "aero") {
    wheel.add(latheZ([[rIn - 0.015, face - 0.004], [rIn * 0.8, face], [rIn * 0.45, face + 0.008], [0.0, face + 0.012]], 30, MAT.alu));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      wheel.add(boxGeo(rIn * 0.5, 0.05, 0.006, MAT.gun), M4.model(Math.cos(a) * rIn * 0.55, Math.sin(a) * rIn * 0.55, face + 0.006, 0, a));
    }
  } else {
    const n = rim === "sport" ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      wheel.add(boxGeo(rIn - 0.04, rim === "sport" ? 0.028 : 0.05, 0.03, rimMat), M4.model(Math.cos(a) * rIn * 0.52, Math.sin(a) * rIn * 0.52, face, 0, a));
    }
    wheel.add(latheZ([[rIn - 0.01, face - 0.01], [rIn * 0.85, face + 0.004], [rIn * 0.82, face - 0.012]], 30, rimMat));
  }
  wheel.add(cylGeo(0.07, 0.065, 0.03, 16, true, rimMat), M4.model(0, 0, face + 0.005, 0, 0, 1, 1, 1, Math.PI / 2));
  wheel.add(cylGeo(0.035, 0.035, 0.012, 12, true, MAT.chrome), M4.model(0, 0, face + 0.035, 0, 0, 1, 1, 1, Math.PI / 2));
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; wheel.add(cylGeo(0.012, 0.012, 0.02, 6, true, MAT.chrome), M4.model(Math.cos(a) * 0.05, Math.sin(a) * 0.05, face + 0.02, 0, 0, 1, 1, 1, Math.PI / 2)); }
  // brake disc (rotates with the wheel)
  wheel.add(cylGeo(rIn * 0.82, rIn * 0.82, 0.026, 28, true, MAT.disc), M4.model(0, 0, face - 0.07, 0, 0, 1, 1, 1, Math.PI / 2));
  // chassis (does not pitch): calipers + underbody
  const chassis = new Geo();
  const track = S.hw - 0.115;
  const calMat = { ...MAT.paint, color: style === "ice" ? "#c3221a" : style === "ev" ? "#2c6fd6" : "#6b7076", spec: 0.6, shine: 60 };
  for (const ax of axles) for (const sgn of [1, -1]) {
    const a = Math.PI * 0.72;
    chassis.add(boxGeo(0.11, 0.13, 0.06, calMat), M4.model(ax + Math.cos(a) * rIn * 0.72, wr + Math.sin(a) * rIn * 0.72, sgn * (track + face - 0.06), 0, a - Math.PI / 2));
  }
  chassis.add(boxAt(-L + 0.4, wr - 0.12, -S.hw + 0.25, -0.4, wr - 0.05, S.hw - 0.25, MAT.under));
  return { body, glass, interior: inter, wheel, chassis, axles, wr, track, lights, L, hw: S.hw, style, beltOf, roofOf, G, X, hwOf };
}

function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------- truck (semi)
export function buildTruck(atlasUV) {
  const g = new Geo(), wheel = new Geo();
  const W = 2.5, Lc = 2.4, Lt = 13.4, gap = 0.6, wr = 0.52;
  // cab: x from 0 to -Lc
  g.add(boxAt(-Lc, 0.9, -W / 2, -0.15, 3.3, W / 2, MAT.paint));
  g.add(boxAt(-0.18, 0.95, -W / 2 + 0.05, 0.02, 1.7, W / 2 - 0.05, MAT.grille));
  g.add(boxAt(-0.16, 2.0, -W / 2 + 0.1, 0.0, 2.95, W / 2 - 0.1, MAT.glass));
  g.add(boxAt(-Lc + 0.1, 3.3, -W / 2 + 0.1, -0.5, 3.75, W / 2 - 0.1, MAT.paint));
  g.add(boxAt(-0.08, 0.5, -W / 2, 0.08, 0.9, W / 2, MAT.gun));
  for (const sgn of [1, -1]) {
    g.add(boxGeo(0.06, 0.2, 0.35, MAT.head), M4.model(0.02, 1.15, sgn * 0.9));
    g.add(boxGeo(0.06, 0.06, 0.1, MAT.ind), M4.model(0.02, 1.36, sgn * 1.12));
    g.add(boxAt(-1.3, 2.0, sgn * (W / 2) - 0.01, -0.35, 2.9, sgn * (W / 2) + 0.01, MAT.glass));
    g.add(boxGeo(0.08, 0.4, 0.18, MAT.trim), M4.model(-0.2, 2.3, sgn * (W / 2 + 0.28)));
    g.add(segGeo([-0.25, 2.1, sgn * W / 2], [-0.22, 2.2, sgn * (W / 2 + 0.25)], 0.02, MAT.trim));
  }
  for (const z of [-0.95, -0.6, 0.6, 0.95]) g.add(boxGeo(0.05, 0.05, 0.12, MAT.ind), M4.model(-0.4, 3.78, z));
  // chassis rails + fuel tank
  g.add(boxAt(-Lc - gap - Lt + 0.5, 0.75, -0.5, -0.3, 1.0, 0.5, MAT.under));
  g.add(cylGeo(0.3, 0.3, 1.2, 14, true, MAT.alu), M4.model(-1.2, 0.85, 0.85, 0, Math.PI / 2));
  // trailer
  const x0 = -Lc - gap, x1 = x0 - Lt;
  g.add(boxAt(x1, 1.25, -W / 2 - 0.03, x0, 4.0, W / 2 + 0.03, MAT.white));
  for (const sgn of [1, -1]) texQuadZ(g, x1 + 1, x0 - 1, 1.5, 3.8, sgn * (W / 2 + 0.035), atlasUV.trailer, sgn);
  g.add(boxAt(x1 - 0.02, 1.0, -W / 2, x1 + 0.2, 1.3, W / 2, MAT.gun));
  for (const sgn of [1, -1]) {
    g.add(boxGeo(0.05, 0.14, 0.3, MAT.tail), M4.model(x1 - 0.03, 1.15, sgn * 0.95));
    g.add(boxGeo(0.05, 0.08, 0.14, MAT.ind), M4.model(x1 - 0.03, 1.15, sgn * 0.65));
    for (let i = 0; i < 6; i++) g.add(boxGeo(0.06, 0.06, 0.04, MAT.ind), M4.model(x1 + 1.5 + i * 2.0, 1.4, sgn * (W / 2 + 0.04)));
  }
  // wheels (local, outer face +z)
  wheel.add(latheZ([[0.3, -0.16], [wr - 0.04, -0.165], [wr, -0.12], [wr, 0.12], [wr - 0.04, 0.165], [0.3, 0.16]], 20, MAT.rubber));
  wheel.add(cylGeo(0.3, 0.3, 0.02, 16, true, MAT.alu), M4.model(0, 0, 0.15, 0, 0, 1, 1, 1, Math.PI / 2));
  return { body: g, wheel, axles: [-0.6, -Lc + 0.15, -Lc - 0.95, x1 + 3.0, x1 + 1.7], wr, track: W / 2 - 0.2, L: Lc + gap + Lt, W };
}

// ---------------------------------------------------------------- train
export function buildTrain(atlasUV) {
  const loco = new Geo(), coach = new Geo();
  const W = 3.0, H = 4.1, Ll = 20, Lc = 22;
  // locomotive: nose profile (side) extruded across the width
  const prof = [[0, 1.0], [0, 2.1], [-1.2, 3.6], [-2.6, H], [-Ll, H], [-Ll, 1.0]];
  loco.add(extrudeXY(prof, W, MAT.paint));
  loco.add(boxGeo(1.43, 0.03, W - 0.4, MAT.glass), M4.model(-0.589, 2.872, 0, 0, 2.24));
  loco.add(boxAt(-Ll + 0.3, 1.0, -W / 2 - 0.01, -0.5, 1.55, W / 2 + 0.01, { ...MAT.paint, color: "#e3342f" }));
  loco.add(boxAt(-Ll + 0.3, 1.62, -W / 2 - 0.012, -1.0, 1.72, W / 2 + 0.012, { ...MAT.paint, color: "#f1f1f1" }));
  for (const sgn of [1, -1]) {
    loco.add(boxGeo(0.06, 0.18, 0.3, MAT.head), M4.model(0.02, 1.45, sgn * 0.95));
    loco.add(boxGeo(0.06, 0.1, 0.2, MAT.tail), M4.model(-Ll - 0.02, 1.45, sgn * 1.0));
  }
  loco.add(boxGeo(0.06, 0.2, 0.4, MAT.head), M4.model(-2.4, H - 0.15, 0));
  loco.add(boxAt(-Ll + 0.5, 0.45, -1.2, -0.5, 1.0, 1.2, MAT.under));
  // pantograph
  loco.add(segGeo([-8, H, 0], [-9.2, H + 1.1, 0], 0.04, MAT.alu));
  loco.add(segGeo([-9.2, H + 1.1, 0], [-8.2, H + 1.7, 0], 0.04, MAT.alu));
  loco.add(boxGeo(0.2, 0.05, 1.6, MAT.alu), M4.model(-8.2, H + 1.72, 0));
  // coach
  const cprof = [[0, 1.0], [0, 3.6], [-0.4, 4.0], [-Lc + 0.4, 4.0], [-Lc, 3.6], [-Lc, 1.0]];
  coach.add(extrudeXY(cprof, W, MAT.paint));
  for (const sgn of [1, -1]) {
    coach.paint(MAT.glass);
    const z = sgn * (W / 2 + 0.006);
    for (let i = 0; i < 9; i++) {
      const xa = -1.6 - i * 2.2, xb = xa - 1.6;
      const gq = boxAt(xb, 2.3, z - 0.004, xa, 3.25, z + 0.004, { ...MAT.glass, glow: 7 });
      coach.add(gq);
    }
    coach.add(boxAt(-Lc + 0.3, 1.9, z - 0.005, -0.3, 2.05, z + 0.005, { ...MAT.paint, color: "#e3342f" }));
    coach.add(boxAt(-0.9, 1.2, z - 0.005, -0.3, 3.5, z + 0.005, MAT.gloss));
    coach.add(boxAt(-Lc + 0.3, 1.2, z - 0.005, -Lc + 0.9, 3.5, z + 0.005, MAT.gloss));
  }
  coach.add(boxAt(-Lc + 0.3, 0.45, -1.2, -0.3, 1.0, 1.2, MAT.under));
  const bogie = new Geo();
  bogie.add(boxAt(-1.4, 0.3, -1.1, 1.4, 0.8, 1.1, MAT.under));
  for (const x of [-0.9, 0.9]) for (const z of [-0.72, 0.72]) bogie.add(cylGeo(0.45, 0.45, 0.14, 16, true, MAT.gun), M4.model(x, 0.45, z, 0, 0, 1, 1, 1, Math.PI / 2));
  return { loco, coach, bogie, Ll, Lc };
}

// ============================================================================ world props
export function pineGeo(seed) {
  const g = new Geo(), r = rnd(seed);
  g.add(cylGeo(0.22, 0.14, 2.6, 7, true, MAT.wood));
  const greens = ["#21401f", "#2b4c26", "#1c3a22", "#30502a"];
  for (let i = 0; i < 4; i++) {
    const c = coneGeo(2.4 - i * 0.48, 3.0 - i * 0.3, 9, { color: greens[(seed + i) % 4], spec: 0.05, shine: 8, glow: 0, flag: 2 });
    g.add(c, M4.model((r() - 0.5) * 0.2, 1.8 + i * 1.55, (r() - 0.5) * 0.2, r() * 3));
  }
  return g;
}
export function broadTreeGeo(seed, autumn = false) {
  const g = new Geo(), r = rnd(seed);
  g.add(cylGeo(0.26, 0.16, 3.0, 7, true, MAT.wood));
  g.add(segGeo([0, 2.4, 0], [0.8, 3.6, 0.4], 0.09, MAT.wood));
  g.add(segGeo([0, 2.2, 0], [-0.7, 3.4, -0.3], 0.09, MAT.wood));
  const cols = autumn ? ["#b5651d", "#c98a2b", "#8f3b1b"] : ["#3c6a2c", "#4b7a32", "#335f2a"];
  for (let i = 0; i < 4; i++) {
    const rad = 1.5 + r() * 0.9;
    g.add(icoGeo(rad, 0.22, seed * 7 + i, { color: cols[i % cols.length], spec: 0.06, shine: 10, glow: 0, flag: 2 }, 0.85),
      M4.model((r() - 0.5) * 2.0, 3.8 + r() * 1.6, (r() - 0.5) * 2.0));
  }
  return g;
}
export function poplarGeo(seed) {
  const g = new Geo();
  g.add(cylGeo(0.18, 0.1, 2.0, 6, true, MAT.wood));
  g.add(icoGeo(1.3, 0.12, seed, { color: "#355e2b", spec: 0.05, shine: 8, glow: 0, flag: 2 }, 3.2), M4.model(0, 5.4, 0));
  return g;
}
export function bushGeo(seed) {
  const g = new Geo(), r = rnd(seed);
  for (let i = 0; i < 3; i++) g.add(icoGeo(0.6 + r() * 0.4, 0.25, seed + i, { color: ["#3f6b2e", "#4d7a35", "#36592a"][i], spec: 0.05, shine: 8, glow: 0, flag: 2 }, 0.7), M4.model((r() - 0.5) * 1.2, 0.45, (r() - 0.5) * 1.2));
  return g;
}
export function rockGeo(seed) { return icoGeo(0.8, 0.35, seed, { color: "#7b7770", spec: 0.08, shine: 10, glow: 0, flag: 0 }, 0.6); }
export function tuftGeo(seed) {
  const g = new Geo(), r = rnd(seed);
  g.paint({ color: "#4f7a33", spec: 0.05, shine: 8, glow: 0, flag: 2 });
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI, h = 0.25 + r() * 0.3, w = 0.04, ca = Math.cos(a) * w, sa = Math.sin(a) * w, lx = (r() - 0.5) * 0.12;
    g.tri([lx - ca, 0, -sa], [lx + ca, 0, sa], [lx + (r() - 0.5) * 0.15, h, (r() - 0.5) * 0.15]);
  }
  return g;
}
// median lamp pole with two arms (light points at z = +-4.4 from the pole, y = 9.4)
export function lampGeo() {
  const g = new Geo();
  g.add(cylGeo(0.13, 0.08, 9.6, 10, true, MAT.alu));
  for (const sgn of [1, -1]) {
    const pts = [[0, 8.9, 0], [0, 9.5, sgn * 1.2], [0, 9.6, sgn * 3.0], [0, 9.6, sgn * 4.4]];
    for (let i = 0; i + 1 < pts.length; i++) g.add(segGeo(pts[i], pts[i + 1], 0.06, MAT.alu));
    g.add(boxAt(-0.25, 9.45, sgn * 4.0, 0.25, 9.62, sgn * 4.9, MAT.alu));
    g.add(boxAt(-0.2, 9.41, sgn * 4.08, 0.2, 9.45, sgn * 4.82, { color: "#fff1d6", spec: 0.5, shine: 40, glow: 1, flag: 0 }));
  }
  g.add(cylGeo(0.3, 0.25, 0.5, 10, true, MAT.alu));
  return g;
}
// New-Jersey barrier segment, 4 m along x
export function barrierGeo() {
  const prof = [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.18, 0.33], [0.08, 0.82], [-0.08, 0.82], [-0.18, 0.33], [-0.3, 0.08]];
  return new Geo().add(extrudeXY(prof, 4.0, { color: "#b9b6ae", spec: -1, shine: -1, glow: 0, flag: 1 * 0 }), M4.model(0, 0, 0, Math.PI / 2));
}
export function glareGeo() {          // anti-glare slats on top of the barrier
  const g = new Geo();
  for (let i = 0; i < 4; i++) g.add(boxGeo(0.06, 0.7, 0.32, { color: "#2d4a33", spec: 0.2, shine: 20, glow: 0, flag: 0 }), M4.model(-1.5 + i, 1.15, 0, 0.6));
  g.add(boxGeo(4.0, 0.05, 0.06, MAT.gun), M4.model(0, 0.86, 0));
  return g;
}
// guardrail: post + W-beam, 4 m along x (beam face toward -z, the road side when z > 0)
export function guardrailGeo() {
  const g = new Geo();
  const galv = { color: "#7f878e", spec: 0.85, shine: 70, glow: 0, flag: 0 };
  g.add(boxAt(-0.05, 0, 0.05, 0.05, 0.75, 0.2, MAT.gun));
  g.add(boxAt(-0.08, 0.45, -0.02, 0.08, 0.68, 0.06, MAT.gun));
  g.add(boxAt(-2.0, 0.45, -0.07, 2.0, 0.76, -0.04, galv));
  g.add(boxAt(-2.0, 0.53, -0.1, 2.0, 0.57, -0.07, galv));
  g.add(boxAt(-2.0, 0.64, -0.1, 2.0, 0.68, -0.07, galv));
  return g;
}
export function delineatorGeo() {
  const g = new Geo();
  g.add(boxAt(-0.05, 0, -0.06, 0.05, 1.1, 0.06, MAT.white));
  g.add(boxAt(-0.052, 0.82, -0.062, 0.052, 0.9, 0.062, MAT.grille));
  g.add(boxAt(-0.055, 0.92, -0.04, -0.05, 1.02, 0.04, { color: "#ff9a1f", spec: 0.9, shine: 90, glow: 4, flag: 0 }));
  return g;
}
export function studGeo() { return boxAt(-0.08, 0, -0.05, 0.08, 0.025, 0.05, { color: "#e8e8e8", spec: 0.9, shine: 80, glow: 1, flag: 0 }); }
export function postGeo(h = 1.3, r = 0.07) { return cylGeo(r, r, h, 8, true, MAT.wood); }
// overhead sign gantry spanning z0 .. z1 at x = 0, panels facing -x
export function gantryGeo(z0, z1, panels) {
  const g = new Geo(), steel = { color: "#9aa3ab", spec: 0.6, shine: 50, glow: 0, flag: 0 };
  for (const z of [z0, z1]) {
    for (const dx of [-0.35, 0.35]) g.add(segGeo([dx, 0, z], [dx, 7.4, z], 0.07, steel));
    for (let y = 0.8; y < 7.2; y += 1.2) g.add(segGeo([-0.35, y, z], [0.35, y + 0.6, z], 0.03, steel));
    g.add(boxAt(-0.6, 0, z - 0.6, 0.6, 0.35, z + 0.6, { color: "#a19e96", spec: 0.05, shine: 8, glow: 0, flag: 0 }));
  }
  for (const y of [6.2, 7.3]) for (const dx of [-0.35, 0.35]) g.add(segGeo([dx, y, z0], [dx, y, z1], 0.06, steel));
  for (let z = Math.min(z0, z1); z < Math.max(z0, z1); z += 1.1) g.add(segGeo([-0.35, 6.2, z], [0.35, 7.3, z + 0.55], 0.025, steel));
  for (const p of panels) {     // {z, w, h, uv, vms}
    g.add(boxAt(-0.5, 6.75 - p.h / 2 - 0.05, p.z - p.w / 2 - 0.05, -0.4, 6.75 + p.h / 2 + 0.05, p.z + p.w / 2 + 0.05, MAT.gun));
    texQuad(g, -0.51, 6.75 - p.h / 2, 6.75 + p.h / 2, p.w, p.uv, -1, p.z);
  }
  return g;
}
export function signPostGeo(uv, size = 1.0, h = 2.4) {
  const g = new Geo();
  g.add(cylGeo(0.05, 0.05, h, 8, true, MAT.alu));
  texQuad(g, -0.03, h - size * 0.1, h + size * 0.9, size, uv, -1);
  g.add(boxAt(0.0, h - size * 0.1, -size / 2, 0.03, h + size * 0.9, size / 2, MAT.gun));
  return g;
}
export function billboardGeo(uv) {        // faces +z, 12 x 4 m panel, 5 m high
  const g = new Geo();
  for (const x of [-3.5, 3.5]) g.add(boxAt(x - 0.2, 0, -0.2, x + 0.2, 5.2, 0.2, MAT.gun));
  g.add(boxAt(-6.2, 4.9, -0.25, 6.2, 9.1, -0.05, MAT.gun));
  texQuadZ(g, -6, 6, 5.05, 8.95, 0.0, uv, 1);
  g.add(boxAt(-6.2, 4.6, 0.1, 6.2, 4.7, 1.0, MAT.gun));
  for (const x of [-4, 0, 4]) g.add(boxAt(x - 0.15, 4.7, 0.8, x + 0.15, 4.9, 1.1, { color: "#fff6dd", spec: 0.5, shine: 40, glow: 1, flag: 0 }));
  return g;
}
export function barnGeo() {
  const g = new Geo();
  const red = { color: "#8e2a22", spec: 0.1, shine: 12, glow: 0, flag: 0 };
  g.add(extrudeXY([[-6, 0], [6, 0], [6, 5], [3.2, 7.6], [-3.2, 7.6], [-6, 5]], 16, red));
  const roofM = { color: "#3b3f44", spec: 0.3, shine: 30, glow: 0, flag: 0 };
  for (const sgn of [1, -1]) g.add(boxGeo(4.6, 0.2, 16.6, roofM), M4.model(sgn * 4.875, 6.3, 0, 0, sgn > 0 ? 2.38 : 0.762));
  g.add(boxAt(-3.4, 7.7, -8.3, 3.4, 7.9, 8.3, { color: "#3b3f44", spec: 0.3, shine: 30, glow: 0, flag: 0 }));
  g.add(boxAt(-2.2, 0, 8.01, 2.2, 4.2, 8.05, { color: "#e8e2d4", spec: 0.1, shine: 10, glow: 0, flag: 0 }));
  g.add(boxAt(-1.9, 0, 8.03, 1.9, 3.9, 8.07, { color: "#5a1d18", spec: 0.1, shine: 10, glow: 0, flag: 0 }));
  return g;
}
export function siloGeo() {
  const g = new Geo(), steel = { color: "#b8bec4", spec: 0.7, shine: 60, glow: 0, flag: 0 };
  g.add(cylGeo(2.4, 2.4, 13, 18, false, steel));
  g.add(sphereGeo(2.4, 18, 8, steel, 0.5), M4.model(0, 13, 0));
  for (let y = 2; y < 13; y += 2.2) g.add(cylGeo(2.43, 2.43, 0.12, 18, false, MAT.gun), M4.model(0, y, 0));
  return g;
}
export function houseGeo() {
  const g = new Geo();
  g.add(boxAt(-5, 0, -4, 5, 3.4, 4, { color: "#e7dccb", spec: 0.05, shine: 8, glow: 0, flag: 0 }));
  g.add(extrudeXY([[-5.6, 3.3], [5.6, 3.3], [0, 6.0]], 9.2, { color: "#7a3a28", spec: 0.1, shine: 12, glow: 0, flag: 0 }));
  for (const x of [-3, 0.2, 3]) g.add(boxAt(x - 0.6, 1.0, 4.0, x + 0.6, 2.3, 4.04, { color: "#2a3138", spec: 0.8, shine: 80, glow: 7, flag: 0 }));
  g.add(boxAt(-1.0, 0, 4.0, -0.1, 2.3, 4.06, { color: "#5b3a24", spec: 0.1, shine: 10, glow: 0, flag: 0 }));
  return g;
}
export function turbineTowerGeo() {
  const g = new Geo(), w = { color: "#eef0f2", spec: 0.4, shine: 40, glow: 0, flag: 0 };
  g.add(cylGeo(2.3, 1.3, 82, 16, false, w));
  g.add(boxAt(-2.0, 80.5, -6.5, 2.0, 84.0, 2.0, w));
  g.add(boxAt(-0.3, 84.0, -5.5, 0.3, 84.5, -4.9, { color: "#ff2a1a", spec: 0.5, shine: 40, glow: 2, flag: 0 }));
  return g;
}
export function rotorGeo() {        // rotates about z (faces +z)
  const g = new Geo(), w = { color: "#f1f3f5", spec: 0.45, shine: 40, glow: 0, flag: 0 };
  g.add(sphereGeo(1.6, 14, 8, w, 1.1), M4.model(0, 0, 0.8));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const blade = new Geo();
    blade.add(extrudeXY([[0, -0.9], [8, -1.6], [40, -0.6], [44, 0], [40, 0.3], [8, 0.6], [0, 0.6]], 0.35, w));
    g.add(blade, M4.model(0, 0, 0.6, 0, a));
  }
  return g;
}
export function buildingGeo() { return boxAt(-0.5, 0, -0.5, 0.5, 1, 0.5, { color: null, spec: -1, shine: -1, glow: 0, flag: 0 }); }
export function antennaGeo() {
  const g = new Geo();
  g.add(cylGeo(0.4, 0.1, 30, 6, true, MAT.alu));
  g.add(sphereGeo(0.6, 8, 6, { color: "#ff2a1a", spec: 0.5, shine: 40, glow: 2, flag: 0 }), M4.model(0, 30, 0));
  return g;
}
export function birdGeo() {
  const g = new Geo();
  g.paint({ color: "#1a1a1a", spec: 0.1, shine: 8, glow: 0, flag: 0 });
  g.tri([0.25, 0, 0], [-0.15, 0, 0.7], [-0.1, 0, 0]); g.tri([0.25, 0, 0], [-0.1, 0, 0], [-0.15, 0, -0.7]);
  g.tri([0.25, 0, 0], [-0.1, 0, 0], [-0.15, 0, 0.7]); g.tri([0.25, 0, 0], [-0.15, 0, -0.7], [-0.1, 0, 0]);
  return g;
}
export function balloonGeo() {
  const g = new Geo();
  const prof = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14, a = t * Math.PI; prof.push([Math.sin(a) * 9 * (1 - 0.35 * t * t) + (t > 0.85 ? 0 : 0), -Math.cos(a) * 10 + 10 + (t > 0.8 ? (t - 0.8) * 8 : 0)]); }
  const stripes = ["#e5534b", "#ffd166", "#4fc3a1", "#5ab8ff"];
  const seg = 16;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    g.paint({ color: stripes[i % 4], spec: 0.25, shine: 20, glow: 0, flag: 0 });
    for (let k = 0; k + 1 < prof.length; k++) {
      const [ra, ya] = prof[k], [rb, yb] = prof[k + 1];
      const A = [ra * Math.cos(a0), ya, ra * Math.sin(a0)], B = [ra * Math.cos(a1), ya, ra * Math.sin(a1)];
      const C = [rb * Math.cos(a1), yb, rb * Math.sin(a1)], D = [rb * Math.cos(a0), yb, rb * Math.sin(a0)];
      g.triOut(A, B, C, [0, 10, 0]); g.triOut(A, C, D, [0, 10, 0]);
    }
  }
  g.add(boxAt(-0.8, -3.5, -0.8, 0.8, -2.3, 0.8, MAT.wood));
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) g.add(segGeo([x, -2.3, z], [x * 2.5, 0.5, z * 2.5], 0.03, MAT.trim));
  return g;
}
// periodic mountain range: x in [0, P], rows of depth; side = -1 far (negative z), +1 behind
export function mountainGeo(P, side, z0, z1, hMax, seed) {
  const g = new Geo();
  const nx = 96, rows = 7;
  const r = rnd(seed);
  const ph = Array.from({ length: 12 }, () => r() * Math.PI * 2);
  const ks = [1, 2, 3, 5, 7, 11, 13, 17, 23, 29, 37, 47];
  const H = (x, t) => {
    let h = 0;
    ks.forEach((k, i) => { h += Math.abs(Math.sin((Math.PI * k * x) / P + ph[i])) ** 1.6 / (1 + i * 0.55); });
    h = h / 3.2;
    return hMax * h * Math.min(1, t * 1.6) * (0.55 + 0.45 * Math.sin(t * 2.4));
  };
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, z = z0 + (z1 - z0) * t;
    pts.push(Array.from({ length: nx + 1 }, (_, i) => { const x = (i / nx) * P; return [x, j === 0 ? -5 : H(x, t) - 5, z]; }));
  }
  g.paint({ color: "#2a3a26", spec: 0.04, shine: 8, glow: 0, flag: 0 });
  const inside = [P / 2, -500, z0 + (z1 - z0) * 0.5];
  for (let j = 0; j < rows; j++) for (let i = 0; i < nx; i++) {
    const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i + 1], d = pts[j + 1][i];
    g.triOut(a, b, c, inside); g.triOut(a, c, d, inside);
  }
  return g;
}
export function rnd(seed) {
  let s = (seed * 2654435761) % 4294967296;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
export { planeGeo, boxGeo, boxAt, cylGeo, segGeo };
