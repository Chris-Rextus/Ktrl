// gl3d.js - WebGL 2 renderer for the Ktrl 3D view (no external library).
//
//   pipeline : shadow map (sun) -> HDR scene (MSAA) -> resolve -> bloom chain
//              -> composite (exposure, ACES, grading, lens flare, vignette,
//              grain, chromatic aberration, letterbox)
//   scene    : procedural sky (gradient, sun, moon, stars, clouds), lit meshes
//              with per-vertex materials and emissive groups, instancing,
//              sun shadows (PCF), environment reflections, analytic street
//              lamps, headlight spots, height fog, wet-road mirror, particles,
//              light beams, flat decals.
//   geometry : Geo builder with materials, primitives, lathe, loft, merge.

// ============================================================================ math
export const M4 = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  },
  lookAt(e, t, u) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  // translation * rotY(ry) * rotX(rx) * rotZ(rz) * scale
  model(tx, ty, tz, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, rx = 0) {
    const cy = Math.cos(ry), sy_ = Math.sin(ry), cz = Math.cos(rz), sz_ = Math.sin(rz), cx = Math.cos(rx), sx_ = Math.sin(rx);
    const Rz = [cz, sz_, 0, -sz_, cz, 0, 0, 0, 1];
    const Rx = [1, 0, 0, 0, cx, sx_, 0, -sx_, cx];
    const Ry = [cy, 0, -sy_, 0, 1, 0, sy_, 0, cy];
    const m3 = (a, b) => {
      const o = new Array(9);
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
      return o;
    };
    const R = m3(m3(Ry, Rx), Rz);
    return new Float32Array([R[0] * sx, R[1] * sx, R[2] * sx, 0, R[3] * sy, R[4] * sy, R[5] * sy, 0,
      R[6] * sz, R[7] * sz, R[8] * sz, 0, tx, ty, tz, 1]);
  },
  // inverse-transpose of the upper 3x3 (normals)
  normal(m) {
    const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    const det = a * A + b * B + c * C || 1e-12;
    // cofactor matrix / det, stored column-major as the inverse-transpose
    return new Float32Array([A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det]);
  },
  det3(m) {
    return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  },
  invert(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    det = det ? 1 / det : 0;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
  apply(m, x, y, z) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
            (m[2] * x + m[6] * y + m[10] * z + m[14]) / w, w];
  },
};

// ============================================================================ colour
const hex = (c) => { const v = parseInt(c.replace("#", ""), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
export const rgb = (c) => (Array.isArray(c) || c instanceof Float32Array ? c : hex(c));
export const lin = (c) => rgb(c).map((x) => Math.pow(x, 2.2));      // sRGB -> linear
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ============================================================================ geometry
// Triangle soup with per-vertex material:
//   col = [r, g, b, own]  own = 0 -> paint colour (uniform / instance), 1 -> rgb
//   mat = [spec, shine, glowGroup, flag]  spec/shine < 0 -> uniform values;
//         flag 1 = textured from the atlas (uv), 2 = vegetation (wind sway)
export class Geo {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.mat = []; this.uv = [];
    this.m = { c: [1, 1, 1], own: 0, spec: -1, shine: -1, glow: 0, flag: 0 };
  }
  set(o = {}) {
    const m = this.m;
    if ("color" in o) { if (o.color == null) { m.own = 0; m.c = [1, 1, 1]; } else { m.c = lin(o.color); m.own = 1; } }
    if ("spec" in o) m.spec = o.spec;
    if ("shine" in o) m.shine = o.shine;
    if ("glow" in o) m.glow = o.glow;
    if ("flag" in o) m.flag = o.flag;
    return this;
  }
  paint(o = {}) { this.m = { c: [1, 1, 1], own: 0, spec: -1, shine: -1, glow: 0, flag: 0 }; return this.set(o); }
  v(p, n, uv) {
    const m = this.m;
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]);
    this.col.push(m.c[0], m.c[1], m.c[2], m.own); this.mat.push(m.spec, m.shine, m.glow, m.flag);
    this.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
  }
  tri(a, b, c, n, ua, ub, uc) {
    if (!n) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-12) return;
      n = [n[0] / l, n[1] / l, n[2] / l];
    }
    this.v(a, n, ua); this.v(b, n, ub); this.v(c, n, uc);
  }
  triN(a, b, c, na, nb, nc) { this.v(a, na); this.v(b, nb); this.v(c, nc); }
  quad(a, b, c, d, n, uvs) {      // counter-clockwise seen from outside
    this.tri(a, b, c, n, uvs?.[0], uvs?.[1], uvs?.[2]); this.tri(a, c, d, n, uvs?.[0], uvs?.[2], uvs?.[3]);
  }
  // triangle with outward orientation relative to an inside point
  triOut(a, b, c, inside) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const cx = (a[0] + b[0] + c[0]) / 3 - inside[0], cy = (a[1] + b[1] + c[1]) / 3 - inside[1], cz = (a[2] + b[2] + c[2]) / 3 - inside[2];
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) this.tri(a, c, b); else this.tri(a, b, c);
  }
  // overwrite the material of every vertex
  recolor(o) {
    const t = new Geo(); t.set(o); const m = t.m;
    for (let i = 0; i < this.col.length; i += 4) {
      if ("color" in o) { this.col[i] = m.c[0]; this.col[i + 1] = m.c[1]; this.col[i + 2] = m.c[2]; this.col[i + 3] = m.own; }
      if ("spec" in o) this.mat[i] = m.spec;
      if ("shine" in o) this.mat[i + 1] = m.shine;
      if ("glow" in o) this.mat[i + 2] = m.glow;
      if ("flag" in o) this.mat[i + 3] = m.flag;
    }
    return this;
  }
  // append another geometry transformed by a model matrix
  add(g, mtx) {
    const nm = mtx ? M4.normal(mtx) : null;
    const flip = mtx && M4.det3(mtx) < 0;
    const n = g.pos.length / 3;
    for (let t = 0; t < n; t += 3) {
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) {
        const i = t + k;
        let x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
        let nx = g.nor[i * 3], ny = g.nor[i * 3 + 1], nz = g.nor[i * 3 + 2];
        if (mtx) {
          const X = mtx[0] * x + mtx[4] * y + mtx[8] * z + mtx[12], Y = mtx[1] * x + mtx[5] * y + mtx[9] * z + mtx[13], Z = mtx[2] * x + mtx[6] * y + mtx[10] * z + mtx[14];
          x = X; y = Y; z = Z;
          const NX = nm[0] * nx + nm[3] * ny + nm[6] * nz, NY = nm[1] * nx + nm[4] * ny + nm[7] * nz, NZ = nm[2] * nx + nm[5] * ny + nm[8] * nz;
          const l = Math.hypot(NX, NY, NZ) || 1; nx = NX / l; ny = NY / l; nz = NZ / l;
        }
        this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
        for (let c = 0; c < 4; c++) { this.col.push(g.col[i * 4 + c]); this.mat.push(g.mat[i * 4 + c]); }
        this.uv.push(g.uv[i * 2], g.uv[i * 2 + 1]);
      }
    }
    return this;
  }
}

// ---------------------------------------------------------------- primitives
const withMat = (g, mat) => (mat ? g.recolor(mat) : g);

export function boxGeo(w, h, d, mat) {
  const g = new Geo(), x = w / 2, y = h / 2, z = d / 2;
  g.quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  g.quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  g.quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  g.quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  g.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0]);
  g.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [0, -1, 0]);
  return withMat(g, mat);
}
// axis-aligned box from corners
export function boxAt(x0, y0, z0, x1, y1, z1, mat) {
  const b = boxGeo(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), mat);
  return new Geo().add(b, M4.model((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
}
// frustum along +Y from 0 to h; smooth sides
export function cylGeo(r0, r1, h, seg = 12, caps = true, mat, smooth = true) {
  const g = new Geo(), slope = (r0 - r1) / h;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p00 = [r0 * c0, 0, r0 * s0], p01 = [r0 * c1, 0, r0 * s1], p10 = [r1 * c0, h, r1 * s0], p11 = [r1 * c1, h, r1 * s1];
    if (smooth) {
      const nl = Math.hypot(1, slope);
      const n0 = [c0 / nl, slope / nl, s0 / nl], n1 = [c1 / nl, slope / nl, s1 / nl];
      g.triN(p00, p11, p01, n0, n1, n1);
      if (r1 > 0) g.triN(p00, p10, p11, n0, n0, n1);
    } else {
      g.tri(p00, p11, p01);
      if (r1 > 0) g.tri(p00, p10, p11);
    }
    if (caps) {
      if (r1 > 0) g.tri([0, h, 0], p11, p10, [0, 1, 0]);
      g.tri([0, 0, 0], p00, p01, [0, -1, 0]);
    }
  }
  return withMat(g, mat);
}
export const coneGeo = (r, h, seg = 10, mat, smooth = false) => cylGeo(r, 0, h, seg, true, mat, smooth);

export function sphereGeo(r, ws = 16, hs = 10, mat, sy = 1) {
  const g = new Geo();
  const P = (i, j) => {
    const th = (j / hs) * Math.PI, ph = (i / ws) * 2 * Math.PI;
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    return [[n[0] * r, n[1] * r * sy, n[2] * r], n];
  };
  for (let j = 0; j < hs; j++)
    for (let i = 0; i < ws; i++) {
      const [a, na] = P(i, j), [b, nb] = P(i + 1, j), [c, nc] = P(i + 1, j + 1), [d, nd] = P(i, j + 1);
      if (j > 0) g.triN(a, b, c, na, nb, nc);
      if (j < hs - 1) g.triN(a, c, d, na, nc, nd);
    }
  return withMat(g, mat);
}

// low-poly jittered icosphere (flat shaded): tree crowns, bushes, rocks
export function icoGeo(r, jitter = 0.15, seed = 1, mat, sy = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const l = Math.hypot(...p); return p.map((x) => x / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // one subdivision
  const cache = new Map();
  const mid = (a, b) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (cache.has(k)) return cache.get(k);
    const p = V[a].map((x, i) => (x + V[b][i]) / 2), l = Math.hypot(...p);
    V.push(p.map((x) => x / l)); cache.set(k, V.length - 1); return V.length - 1;
  };
  const F2 = [];
  for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  F = F2;
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  V = V.map((p) => { const k = r * (1 + (rnd() - 0.5) * 2 * jitter); return [p[0] * k, p[1] * k * sy, p[2] * k]; });
  const g = new Geo();
  for (const [a, b, c] of F) g.triOut(V[a], V[b], V[c], [0, 0, 0]);
  return withMat(g, mat);
}

// surface of revolution around Z: profile [[r, z], ...]
export function latheZ(prof, seg = 24, mat, smooth = true) {
  const g = new Geo();
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    for (let k = 0; k + 1 < prof.length; k++) {
      const [ra, za] = prof[k], [rb, zb] = prof[k + 1];
      const A = [ra * c0, ra * s0, za], B = [ra * c1, ra * s1, za], C = [rb * c1, rb * s1, zb], D = [rb * c0, rb * s0, zb];
      if (smooth) {
        // profile normal: perpendicular to (dr, dz) in the (r, z) plane
        const dr = rb - ra, dz = zb - za, l = Math.hypot(dr, dz) || 1;
        let nr = dz / l, nz = -dr / l;
        const N = (c, s) => [nr * c, nr * s, nz];
        if (ra > 1e-6) g.triN(A, B, C, N(c0, s0), N(c1, s1), N(c1, s1));
        if (rb > 1e-6) g.triN(A, C, D, N(c0, s0), N(c1, s1), N(c0, s0));
        if (ra <= 1e-6) g.triN(A, C, D, N(c0, s0), N(c1, s1), N(c0, s0));
      } else {
        if (ra > 1e-6) g.tri(A, B, C);
        if (rb > 1e-6 || ra <= 1e-6) g.tri(A, C, D);
      }
    }
  }
  return withMat(g, mat);
}

// flat plane in XZ facing up, centred
export function planeGeo(x0, x1, z0, z1, mat) {
  const g = new Geo();
  g.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  return withMat(g, mat);
}
// unit quad in XY (sprites, decals)
export function quadGeo() {
  const g = new Geo();
  g.quad([-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 0, 1]);
  return g;
}
// convex polygon in XY extruded along Z (depth d, centred)
export function extrudeXY(poly, d, mat, capMat) {
  const g = new Geo(), z = d / 2;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    g.triOut([a[0], a[1], z], [b[0], b[1], z], [b[0], b[1], -z], [cx, cy, 0]);
    g.triOut([a[0], a[1], z], [b[0], b[1], -z], [a[0], a[1], -z], [cx, cy, 0]);
  }
  if (mat) g.recolor(mat);
  const caps = new Geo();
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    caps.triOut([cx, cy, z], [a[0], a[1], z], [b[0], b[1], z], [cx, cy, 0]);
    caps.triOut([cx, cy, -z], [b[0], b[1], -z], [a[0], a[1], -z], [cx, cy, 0]);
  }
  if (capMat || mat) caps.recolor(capMat || mat);
  return g.add(caps);
}
// prism (4 sides) between two points: wires, struts, rails
export function segGeo(a, b, r, mat) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
  const box = boxGeo(L, r * 2, r * 2, mat);
  const yaw = Math.atan2(-d[2], d[0]), pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  return new Geo().add(box, M4.model((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, yaw, pitch));
}
// loft through stations (arrays of points with the same count); closed rings.
// faceMat(i, k) -> material object or null for the default; returns {geo}
export function loftGeo(stations, faceMat, target = null, closed = true) {   // faceMat may return false to skip
  const g = target || new Geo();
  for (let i = 0; i + 1 < stations.length; i++) {
    const A = stations[i], B = stations[i + 1], n = A.length;
    const cA = A.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
    const cB = B.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
    const inside = [(cA[0] + cB[0]) / 2, (cA[1] + cB[1]) / 2, (cA[2] + cB[2]) / 2];
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const k2 = (k + 1) % n;
      const m = faceMat ? faceMat(i, k) : null;
      if (m === false) continue;
      const tg = m?.geo || g;
      tg.paint(m || {});
      tg.triOut(A[k], A[k2], B[k2], inside);
      tg.triOut(A[k], B[k2], B[k], inside);
    }
  }
  return g;
}
export function capGeo(ring, mat, target) {
  const g = target || new Geo(), n = ring.length;
  const c = ring.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
  g.paint(mat || {});
  // orientation: away from the reference point passed as ring.inside
  const inside = ring.inside || [c[0], c[1], c[2]];
  for (let k = 0; k < n; k++) g.triOut(c, ring[k], ring[(k + 1) % n], inside);
  return g;
}

// ============================================================================ shaders
const COMMON = `
uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyHor, uSkyGround, uFogCol, uAmbSky, uAmbGround;
uniform float uFogDen, uFogFall, uSunVis, uNight, uWet, uTime, uCloud, uDirect, uExposure;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
vec3 skyGrad(vec3 d){
  float h = max(d.y, 0.0);
  vec3 c = mix(uSkyHor, uSkyTop, pow(h, 0.5));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (0.035 * pow(sd, 3.0) + 0.16 * pow(sd, 18.0) + 0.5 * pow(sd, 200.0)) * uSunVis;
  return c;
}
vec3 envRefl(vec3 r){
  if (r.y < 0.0) return mix(uSkyHor * 0.6, uSkyGround, smoothstep(0.0, -0.35, r.y));
  return skyGrad(r);
}
vec3 applyFog(vec3 col, vec3 p, vec3 cam){
  vec3 dv = p - cam; float dist = length(dv);
  float hm = max(0.0, 0.5 * (p.y + cam.y));
  float f = 1.0 - exp(-dist * uFogDen * exp(-hm * uFogFall));
  vec3 fc = uFogCol + uSunCol * 0.12 * pow(max(dot(dv / max(dist, 1e-3), uSunDir), 0.0), 8.0) * uSunVis;
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 outCol(vec3 c){ return uDirect > 0.5 ? pow(aces(c * uExposure), vec3(1.0 / 2.2)) : c; }
`;

const LIT_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol; layout(location=3) in vec4 aMat;
layout(location=4) in vec4 iA; layout(location=5) in vec4 iB; layout(location=6) in vec4 iC; layout(location=7) in vec2 aUV;
layout(location=8) in vec4 iD;
uniform mat4 uModel, uVP, uLightVP; uniform mat3 uNM;
uniform vec4 uCrumple; uniform float uTime, uWind, uNBias;
out vec3 vPos; out vec3 vNor; out vec4 vCol; out vec4 vMat; out vec4 vTint; out vec4 vExtra; out vec2 vUV; out vec4 vLS; out vec3 vLocal;
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main(){
  vec3 p = aPos, n = aNor;
  if (uCrumple.x > 0.0) {            // front crush (x = 0 is the front bumper)
    float t = smoothstep(-1.15, 0.0, p.x);
    p.x -= uCrumple.x * t * t * (0.55 + 0.45 * smoothstep(0.2, 0.9, p.y));
    p.y += uCrumple.x * t * 0.25 * smoothstep(0.5, 1.0, p.y);
    p += (vec3(h13(p * 7.3), h13(p * 11.1 + 3.0), h13(p * 5.7 + 7.0)) - 0.5) * 0.16 * uCrumple.x * t;
  }
  if (uCrumple.y > 0.0) {            // rear crush (x = -L)
    float t = smoothstep(-uCrumple.z + 0.9, -uCrumple.z, p.x);
    p.x += uCrumple.y * t * t;
    p += (vec3(h13(p * 6.1), h13(p * 9.7 + 1.0), h13(p * 4.3 + 5.0)) - 0.5) * 0.12 * uCrumple.y * t;
  }
  vLocal = p;
  if (aMat.w > 1.5 && aMat.w < 2.5) {   // vegetation sway
    float s = sin(uTime * 1.6 + iA.x * 0.31 + iA.z * 0.17) * uWind * max(p.y, 0.0) * 0.018;
    p.x += s; p.z += s * 0.5;
  }
  p *= iB.xyz; n /= iB.xyz;
  float cr = cos(iB.w), sr = sin(iB.w);
  p.xy = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr); n.xy = vec2(n.x * cr - n.y * sr, n.x * sr + n.y * cr);
  float cy = cos(iA.w), sy = sin(iA.w);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z) + iA.xyz;
  n = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
  vec4 w = uModel * vec4(p, 1.0);
  vPos = w.xyz; vNor = normalize(uNM * n);
  vCol = aCol; vMat = aMat; vTint = iC; vExtra = iD; vUV = aUV;
  vLS = uLightVP * vec4(w.xyz + vNor * uNBias, 1.0);
  gl_Position = uVP * w;
}`;

const LIT_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPos; in vec3 vNor; in vec4 vCol; in vec4 vMat; in vec4 vTint; in vec4 vExtra; in vec2 vUV; in vec4 vLS; in vec3 vLocal;
uniform vec3 uColor, uEmissive, uCam;
uniform float uSpec, uShine, uAlpha, uWorldX, uRefl, uSnow, uMirror;
uniform int uKind, uFlags;
uniform float uGlow[8]; uniform vec3 uGlowCol[8];
uniform sampler2DShadow uShadowMap; uniform sampler2D uAtlas;
uniform float uShadowOn, uShadowBias, uShadowK; uniform vec2 uShadowTexel;
uniform vec4 uSpotPos[8]; uniform vec4 uSpotDir[8]; uniform int uSpotN;
uniform vec4 uLamp; uniform float uLampZ2; uniform vec3 uLampCol;
${COMMON}
out vec4 o;
float shadowAt(vec4 ls){
  vec3 p = ls.xyz / ls.w * 0.5 + 0.5;
  if (p.z > 1.0 || p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    s += texture(uShadowMap, vec3(p.xy + vec2(float(i), float(j)) * uShadowTexel * 1.3, p.z - uShadowBias));
  vec2 e = abs(p.xy - 0.5) * 2.0;
  return mix(s / 9.0, 1.0, smoothstep(0.82, 1.0, max(e.x, e.y)));
}
void main(){
  vec3 N = normalize(vNor);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vPos);
  vec3 paint = (vTint.w > 0.5 && vTint.w < 1.5) ? vTint.rgb : uColor;
  vec3 base = mix(paint, vCol.rgb, vCol.a);
  if (vTint.w > 1.5) base *= vTint.rgb;
  float spec = vMat.x < 0.0 ? uSpec : vMat.x;
  float shine = vMat.y < 0.0 ? uShine : vMat.y;
  float refl = uRefl;
  vec3 kEm = vec3(0.0);
  float wetK = 0.0;
  vec2 wp = vec2(vPos.x + uWorldX, vPos.z);
  if (vMat.w > 0.5 && vMat.w < 1.5) {
    vec4 t = texture(uAtlas, vUV);
    base *= pow(t.rgb, vec3(2.2));
    kEm += pow(t.rgb, vec3(2.2)) * vExtra.y;
  }
  if (uKind == 1) {                         // asphalt
    float n1 = vnoise(wp * vec2(0.06, 0.25)), n2 = vnoise(wp * 2.7), n3 = hash12(floor(wp * 85.0));
    base *= 0.72 + 0.3 * n1 + 0.14 * n2 + 0.16 * (n3 - 0.5);
    float lz = mod(vPos.z + 1.8, 3.6) - 1.8;
    float track = exp(-pow((abs(lz) - 0.82) / 0.32, 2.0));
    base *= 1.0 - 0.16 * track;
    float cr = smoothstep(0.035, 0.0, abs(vnoise(wp * vec2(0.45, 0.9)) - 0.5)) * step(0.62, vnoise(wp * 0.07 + 9.1));
    base *= 1.0 - 0.4 * cr;
    float pt = smoothstep(0.7, 0.72, vnoise(wp * vec2(0.03, 0.12) + 3.7));
    base *= mix(1.0, 0.78, pt);
    spec = 0.05 + 0.05 * track; shine = 10.0; refl = 0.25;
    if (uWet > 0.0) {
      float puddle = smoothstep(0.52, 0.68, fbm(wp * 0.11)) * (1.0 - 0.6 * track);
      wetK = uWet * (0.5 + 0.5 * puddle);
      base *= mix(1.0, 0.45, uWet);
      spec = mix(spec, 0.9, wetK); shine = mix(shine, 220.0, wetK); refl = 1.0;
      N = normalize(N + vec3(vnoise(wp * 9.0 + uTime * 2.0) - 0.5, 0.0, vnoise(wp * 9.0 - uTime * 2.3) - 0.5) * 0.05 * uWet * puddle);
    }
    if (uSnow > 0.0) base = mix(base, vec3(0.62, 0.64, 0.68), uSnow * (1.0 - track) * (0.45 + 0.4 * vnoise(wp * 0.8)));
  } else if (uKind == 2) {                  // grass
    float g1 = fbm(wp * 0.035), g2 = vnoise(wp * 0.7), g3 = hash12(floor(wp * 22.0));
    base = mix(base, base * vec3(1.35, 1.12, 0.55), smoothstep(0.42, 0.78, g1));
    base = mix(base, base * vec3(0.68, 0.86, 0.62), smoothstep(0.45, 0.85, g2) * 0.6);
    base *= 0.82 + 0.32 * g3;
    spec = 0.03; shine = 8.0; refl = 0.1;
  } else if (uKind == 3) {                  // concrete
    float sx = abs(fract((vPos.x + uWorldX) / 4.0) - 0.5);
    base *= 0.86 + 0.16 * vnoise(wp * 2.3 + vPos.y * 1.7) + 0.08 * hash12(floor(vec2(wp.x, vPos.y) * 60.0));
    base *= mix(1.0, 0.55, smoothstep(0.488, 0.5, sx));
    base *= 1.0 - 0.18 * smoothstep(0.55, 0.9, vnoise(vec2(wp.x * 2.0, vPos.y * 0.6)));
    spec = 0.06; shine = 14.0; refl = 0.2;
  } else if (uKind == 4) {                  // fields: parcels of crops in rows
    vec2 cell = floor(vec2(wp.x / 160.0, wp.y / 60.0));
    float h = hash12(cell);
    vec3 crop = h < 0.3 ? vec3(0.42, 0.33, 0.1) : h < 0.55 ? vec3(0.12, 0.22, 0.05) : h < 0.78 ? vec3(0.2, 0.13, 0.07) : vec3(0.3, 0.3, 0.07);
    float rows = 0.5 + 0.5 * sin(wp.y * 6.2832 / (h < 0.55 ? 0.8 : 1.4));
    base = crop * (0.72 + 0.32 * rows) * (0.85 + 0.3 * vnoise(wp * 0.15)) * (0.9 + 0.2 * hash12(floor(wp * 15.0)));
    vec2 fe = abs(fract(vec2(wp.x / 160.0, wp.y / 60.0)) - 0.5);
    base = mix(base, vec3(0.1, 0.16, 0.05), smoothstep(0.492, 0.5, max(fe.x, fe.y)));
    spec = 0.03; shine = 8.0; refl = 0.08;
  } else if (uKind == 5) {                  // building facades with windows
    vec2 f = abs(N.x) > 0.5 ? vec2(vPos.z, vPos.y) : vec2(vPos.x + uWorldX, vPos.y);
    vec2 cell = floor(f / vec2(3.2, 3.6)), fr = fract(f / vec2(3.2, 3.6));
    float win = step(0.18, fr.x) * step(fr.x, 0.82) * step(0.25, fr.y) * step(fr.y, 0.8) * step(0.5, 1.0 - abs(N.y));
    float bid = hash12(floor(vec2(vPos.x + uWorldX, vPos.z) / 37.0));
    base *= 0.85 + 0.3 * bid;
    if (win > 0.5) {
      base = vec3(0.04, 0.05, 0.06); spec = 0.7; shine = 90.0; refl = 0.8;
      float lit = step(hash12(cell + bid * 91.0), 0.42);
      kEm += vec3(1.0, 0.72, 0.4) * lit * uNight * 2.2 * (0.6 + 0.4 * hash12(cell * 3.1));
    } else { spec = 0.05; shine = 12.0; refl = 0.15; }
  } else if (uKind == 6) {                  // galvanised steel
    base *= 0.82 + 0.22 * vnoise(vec2(wp.x * 3.0, vPos.y * 25.0));
    spec = 0.55; shine = 40.0; refl = 0.55;
  } else if (uKind == 7) {                  // ballast / gravel
    base *= 0.55 + 0.6 * hash12(floor(wp * 38.0)) * (0.7 + 0.3 * vnoise(wp * 4.0));
    spec = 0.04; refl = 0.05;
  } else if (uKind == 8) {                  // mountains
    float slope = 1.0 - N.y;
    vec3 grassC = vec3(0.07, 0.11, 0.045), rock = vec3(0.17, 0.16, 0.15), snowC = vec3(0.82, 0.86, 0.92);
    float hn = vPos.y + vnoise(wp * 0.006) * 140.0;
    base = mix(grassC, rock, clamp(smoothstep(0.35, 0.6, slope) + smoothstep(140.0, 320.0, hn), 0.0, 1.0));
    base = mix(base, snowC, smoothstep(420.0, 520.0, hn) * smoothstep(0.75, 0.35, slope));
    spec = 0.04; refl = 0.05;
  } else if (uKind == 9) {                  // road paint
    base *= 0.85 + 0.15 * hash12(floor(wp * 40.0));
    base = mix(base, vec3(0.08), smoothstep(0.6, 0.85, vnoise(wp * vec2(0.4, 3.0))) * 0.35);
    spec = mix(0.08, 0.9, uWet); shine = mix(16.0, 180.0, uWet); refl = 0.4;
    kEm += base * uNight * 0.06;          // retroreflective beads
  }
  if ((uFlags & 1) != 0 && uSnow > 0.0)   // snow settles on upward faces
    base = mix(base, vec3(0.86, 0.89, 0.94), smoothstep(0.45, 0.85, N.y) * uSnow * (0.75 + 0.25 * vnoise(wp * 1.3)));

  // ---------------------------------------------------------------- lighting
  float NdL = dot(N, uSunDir);
  float sh = uShadowOn > 0.5 ? mix(1.0, shadowAt(vLS), uShadowK) : 1.0;
  float diff = max(NdL, 0.0) * sh;
  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
  vec3 col = base * (amb + uSunCol * diff);
  vec3 H = normalize(uSunDir + V);
  float nspec = (shine + 8.0) / 25.0;
  col += uSunCol * pow(max(dot(N, H), 0.0), shine) * nspec * spec * diff;
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  if (uMirror < 0.5 || uKind != 1) col += envRefl(reflect(-V, N)) * fres * spec * refl;
  // street lamps: periodic along x, two rows (analytic)
  if (uLamp.z > 0.0) {
    float wx = vPos.x + uWorldX;
    float k0 = floor(wx / uLamp.x + 0.5);
    for (int j = -1; j <= 1; j++) {
      float lx = (k0 + float(j)) * uLamp.x - uWorldX;
      for (int s = 0; s < 2; s++) {
        vec3 lp = vec3(lx, uLamp.y, s == 0 ? uLamp.w : uLampZ2);
        vec3 Lv = lp - vPos; float d2 = dot(Lv, Lv); vec3 Ld = Lv * inversesqrt(d2);
        float att = uLamp.z / (1.0 + d2 * 0.03) * smoothstep(2600.0, 500.0, d2) * smoothstep(0.15, 0.75, Ld.y);
        float nl = max(dot(N, Ld), 0.0);
        col += uLampCol * att * (base * nl + spec * pow(max(dot(N, normalize(Ld + V)), 0.0), shine) * nspec * 0.6);
      }
    }
  }
  // spot lights (headlights)
  for (int i = 0; i < 8; i++) {
    if (i >= uSpotN) break;
    vec3 Lv = uSpotPos[i].xyz - vPos; float d2 = dot(Lv, Lv); vec3 Ld = Lv * inversesqrt(d2);
    float cd = dot(-Ld, uSpotDir[i].xyz);
    float cone = smoothstep(uSpotDir[i].w, uSpotDir[i].w + 0.08, cd);
    float att = uSpotPos[i].w / (1.0 + d2 * 0.012) * cone;
    float nl = max(dot(N, Ld), 0.0);
    col += vec3(1.0, 0.93, 0.82) * att * (base * nl + spec * pow(max(dot(N, normalize(Ld + V)), 0.0), shine) * nspec);
  }
  // emissive
  int g = int(vMat.z + 0.5);
  float gi = g > 0 ? uGlow[g] : 0.0;
  vec3 ec = (uGlowCol[g].r >= 0.0 ? uGlowCol[g] : vCol.rgb) * (vTint.w > 1.5 ? vTint.rgb : vec3(1.0));
  col += ec * gi + uEmissive + kEm + base * vExtra.y * (vMat.w > 0.5 && vMat.w < 1.5 ? 0.0 : 1.0);
  col = applyFog(col, vPos, uCam);
  float alpha = uAlpha * vExtra.x;
  if ((uFlags & 2) != 0) alpha = mix(uAlpha, 1.0, clamp(fres * 2.2, 0.0, 1.0));     // glass
  if (uKind == 1 && uMirror > 0.5) alpha = 1.0 - wetK * 0.62 * (0.35 + 0.65 * pow(1.0 - NdV, 1.5));
  o = vec4(outCol(col), alpha);
}`;

const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 o; void main(){ o = vec4(1.0); }`;

const FS_TRI_VS = `#version 300 es
out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform mat4 uInvVP; uniform vec3 uCam, uMoonDir; uniform float uStars, uCloudDark, uFlash; uniform vec2 uCloudOff;
${COMMON}
out vec4 o;
void main(){
  vec4 a = uInvVP * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(a.xyz / a.w - uCam);
  bool below = d.y < 0.0;
  vec3 dd = vec3(d.x, abs(d.y), d.z);
  vec3 c = skyGrad(dd);
  float sd = dot(dd, uSunDir);
  c += uSunCol * smoothstep(0.99962, 0.99985, sd) * 22.0 * uSunVis * (1.0 - uCloud * 0.85);
  float md = dot(dd, uMoonDir);
  float moon = smoothstep(0.99955, 0.99975, md);
  c += vec3(0.85, 0.9, 1.0) * moon * 2.5 * uNight + vec3(0.25, 0.3, 0.4) * pow(max(md, 0.0), 300.0) * 0.4 * uNight;
  if (uStars > 0.0) {
    vec3 sp = dd * 260.0; vec3 ip = floor(sp);
    float hs = hash13(ip);
    if (hs > 0.993) {
      vec3 fp = fract(sp) - 0.5;
      float tw = 0.65 + 0.35 * sin(uTime * (2.0 + hs * 9.0) + hs * 80.0);
      c += vec3(0.8, 0.88, 1.0) * smoothstep(0.22, 0.0, length(fp)) * uStars * tw * smoothstep(0.02, 0.25, dd.y) * (1.0 - uCloud);
    }
  }
  if (uCloud > 0.0 && dd.y > 0.003) {
    vec2 cp = dd.xz / (dd.y + 0.06) * 0.9 + uCloudOff;
    float n = fbm(cp * 1.3) * 0.65 + fbm(cp * 3.7 + 11.0) * 0.35;
    float cov = smoothstep(1.02 - uCloud, 1.32 - uCloud * 0.75, n);
    float thick = smoothstep(0.45, 1.0, n);
    float sunSide = pow(max(dot(normalize(vec3(dd.x, 0.0, dd.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 2.0);
    vec3 lit = uAmbSky * 1.15 + uSunCol * (0.28 + 0.4 * sunSide) * uSunVis;
    vec3 cc = mix(lit, lit * 0.42 * (1.0 - uCloudDark) + uAmbGround * 0.3, thick);
    cc += uSunCol * pow(max(sd, 0.0), 10.0) * 0.6 * uSunVis * (1.0 - thick);
    c = mix(c, cc, cov * smoothstep(0.003, 0.12, dd.y) * 0.97);
  }
  c = mix(c, uFogCol, (1.0 - smoothstep(0.0, 0.14, dd.y)) * clamp(uFogDen * 900.0, 0.0, 0.95));
  c += vec3(0.75, 0.8, 1.0) * uFlash;
  if (below) c *= 0.82;
  o = vec4(outCol(c), 1.0);
}`;

const FLAT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uModel, uVP;
out vec3 vLocal; out vec3 vW;
void main(){ vLocal = aPos; vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; gl_Position = uVP * w; }`;
const FLAT_FS = `#version 300 es
precision highp float;
in vec3 vLocal; in vec3 vW;
uniform vec4 uColor; uniform int uMode; uniform vec4 uParam; uniform vec3 uCam;
${COMMON}
out vec4 o;
void main(){
  float a = uColor.a; vec2 uv = vLocal.xy; float r = length(uv);
  if (uMode == 0) a *= smoothstep(1.0, 0.0, r) * smoothstep(1.0, 0.55, r);        // contact shadow
  else if (uMode == 2) a *= pow(smoothstep(1.0, 0.0, r), 2.0);                    // glow
  else if (uMode == 3) {                                                          // light beam (cone along +x)
    float x = clamp(vLocal.x, 0.0, 1.0);
    float rr = length(vLocal.yz) / max(x, 0.02);
    a *= pow(1.0 - x, 1.6) * smoothstep(1.0, 0.2, rr) * smoothstep(0.0, 0.05, x);
  }
  else if (uMode == 4) a *= smoothstep(0.1, 0.0, abs(r - 0.88)) * smoothstep(1.0, 0.7, r) + 0.25 * smoothstep(0.9, 0.0, r) * uParam.y;   // ring
  else if (uMode == 5) {                                                          // radar fan, x in [-1,1] -> range
    float x = vLocal.x * 0.5 + 0.5, y = vLocal.y;
    float inside = step(abs(y), x + 0.02);
    float edge = smoothstep(0.06, 0.0, abs(abs(y) - x)) * 0.9;
    float sweep = smoothstep(0.0, 0.03, fract(x * 1.0 - uParam.x)) * smoothstep(0.18, 0.0, fract(x * 1.0 - uParam.x)) ;
    float rings = smoothstep(0.012, 0.0, abs(fract(x * uParam.y) - 0.5) - 0.488);
    a *= inside * (0.035 * (1.0 - x) + edge * 0.28 + sweep * 0.3 + rings * 0.16) * smoothstep(1.0, 0.85, x) * smoothstep(0.0, 0.04, x);
  }
  else if (uMode == 6) {                                                          // gap band with moving chevrons
    float x = vLocal.x, y = vLocal.y;
    float chev = smoothstep(0.35, 0.5, fract((x * uParam.y) - abs(y) * 0.8 - uParam.x)) * smoothstep(0.85, 0.6, fract((x * uParam.y) - abs(y) * 0.8 - uParam.x));
    a *= (0.35 + 0.65 * chev) * smoothstep(1.0, 0.75, abs(y));
  }
  vec3 col = uColor.rgb;
  float dist = length(vW - uCam);
  a *= exp(-dist * uFogDen * 0.6);
  o = vec4(outCol(col), a);
}`;

const PART_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=4) in vec4 iP; layout(location=5) in vec4 iC; layout(location=6) in vec4 iV;
uniform mat4 uVP; uniform vec3 uCamPos, uCamRight, uCamUp;
out vec2 vUV; out vec4 vCol; flat out int vMode; out float vSeed; out vec3 vW;
void main(){
  vec3 c = iP.xyz; float s = iP.w;
  int mode = int(floor(iV.w)); float rot = fract(iV.w) * 6.2832;
  vec3 right = uCamRight, up = uCamUp; float lenK = 1.0;
  vec3 vel = iV.xyz;
  if (mode == 2 || mode == 3) {
    vec3 vd = normalize(uCamPos - c);
    vec3 u2 = vel - dot(vel, vd) * vd; float l = length(u2);
    if (l > 1e-4) { up = u2 / l; right = normalize(cross(up, vd)); lenK = 1.0 + l * 0.05 / max(s, 0.004); }
  } else if (mode == 6) {                // flat on the ground
    right = vec3(1.0, 0.0, 0.0); up = vec3(0.0, 0.0, 1.0);
  } else {
    float cr = cos(rot), sr = sin(rot);
    vec3 r2 = right * cr + up * sr; up = -right * sr + up * cr; right = r2;
  }
  vec3 p = c + right * aPos.x * s + up * aPos.y * s * lenK;
  vW = p;
  gl_Position = uVP * vec4(p, 1.0);
  vUV = aPos.xy; vCol = iC; vMode = mode; vSeed = fract(iV.w * 97.13 + iP.x * 0.37);
}`;
const PART_FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec4 vCol; flat in int vMode; in float vSeed; in vec3 vW;
uniform vec3 uCamPos;
${COMMON}
out vec4 o;
void main(){
  float r = length(vUV); float a;
  if (vMode == 0) {                 // smoke puff
    float n = vnoise(vUV * 2.5 + vSeed * 40.0) * 0.6 + vnoise(vUV * 5.0 - vSeed * 13.0) * 0.4;
    a = smoothstep(1.0, 0.15, r) * (0.55 + 0.6 * n);
  }
  else if (vMode == 1) a = exp(-r * r * 4.5);                                 // glow
  else if (vMode == 2) a = smoothstep(1.0, 0.0, abs(vUV.x)) * smoothstep(1.0, 0.3, abs(vUV.y)); // spark streak
  else if (vMode == 3) a = smoothstep(1.0, 0.0, abs(vUV.x)) * (1.0 - abs(vUV.y)) * 0.9;        // rain
  else if (vMode == 4) a = exp(-r * r * 9.0) * 1.4 + exp(-abs(vUV.y) * 40.0) * exp(-abs(vUV.x) * 2.2) * 0.7 + exp(-abs(vUV.x) * 40.0) * exp(-abs(vUV.y) * 3.5) * 0.25;  // star flare
  else if (vMode == 5) a = smoothstep(1.0, 0.6, r) * (0.7 + 0.3 * hash12(floor(vUV * 3.0 + vSeed * 9.0)));  // snow flake
  else a = smoothstep(0.12, 0.0, abs(r - 0.8)) * smoothstep(1.0, 0.7, r);   // ground ring
  if (vMode == 1 || vMode == 4) a *= smoothstep(1.0, 0.7, max(abs(vUV.x), abs(vUV.y)));
  float dist = length(vW - uCamPos);
  a *= vCol.a * exp(-dist * uFogDen * 0.5);
  o = vec4(outCol(vCol.rgb), a);
}`;

// ----------------------------------------------------------------- post
const PRE_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThresh;
out vec4 o;
void main(){
  vec3 c = vec3(0.0);
  c += texture(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb; c += texture(uSrc, vUV + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUV + uTexel * vec2(-1.0, 1.0)).rgb;  c += texture(uSrc, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  c = min(c, vec3(60.0));
  float b = max(c.r, max(c.g, c.b));
  float w = smoothstep(uThresh, uThresh * 2.0 + 0.4, b);
  o = vec4(c * w, 1.0);
}`;
const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel;
out vec4 o;
void main(){
  vec3 c = texture(uSrc, vUV).rgb * 4.0;
  c += texture(uSrc, vUV - uTexel).rgb; c += texture(uSrc, vUV + uTexel).rgb;
  c += texture(uSrc, vUV + vec2(uTexel.x, -uTexel.y)).rgb; c += texture(uSrc, vUV - vec2(uTexel.x, -uTexel.y)).rgb;
  o = vec4(c / 8.0, 1.0);
}`;
const UP_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uK;
out vec4 o;
void main(){
  vec2 h = uTexel;
  vec3 c = texture(uSrc, vUV + vec2(-h.x * 2.0, 0.0)).rgb;
  c += texture(uSrc, vUV + vec2(-h.x, h.y)).rgb * 2.0;
  c += texture(uSrc, vUV + vec2(0.0, h.y * 2.0)).rgb;
  c += texture(uSrc, vUV + vec2(h.x, h.y)).rgb * 2.0;
  c += texture(uSrc, vUV + vec2(h.x * 2.0, 0.0)).rgb;
  c += texture(uSrc, vUV + vec2(h.x, -h.y)).rgb * 2.0;
  c += texture(uSrc, vUV + vec2(0.0, -h.y * 2.0)).rgb;
  c += texture(uSrc, vUV + vec2(-h.x, -h.y)).rgb * 2.0;
  o = vec4(c / 12.0 * uK, 1.0);
}`;
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform float uExposure, uBloomK, uVignette, uGrain, uTime, uCA, uLetter, uFlare, uSat, uHit;
uniform vec3 uLift, uGain; uniform vec2 uSunScr, uRes; uniform vec3 uFlareCol;
out vec4 o;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 uv = vUV;
  vec2 dc = uv - 0.5;
  vec3 c;
  float ca = uCA + uHit * 0.006;
  if (ca > 0.0) {
    vec2 off = dc * ca;
    c = vec3(texture(uScene, uv + off).r, texture(uScene, uv).g, texture(uScene, uv - off).b);
  } else c = texture(uScene, uv).rgb;
  c += texture(uBloom, uv).rgb * uBloomK;
  if (uFlare > 0.0) {
    float asp = uRes.x / uRes.y;
    vec2 s = uSunScr; vec2 axis = vec2(0.5) - s;
    for (int i = 1; i <= 5; i++) {
      float k = float(i) * 0.38 - 0.25;
      vec2 gp = s + axis * (1.0 + k);
      float rad = 0.018 + 0.03 * fract(float(i) * 0.618);
      float d = length((uv - gp) * vec2(asp, 1.0));
      vec3 tint = mix(uFlareCol, vec3(0.4, 0.7, 1.0), fract(float(i) * 0.37));
      c += tint * smoothstep(rad, rad * 0.4, d) * 0.06 * uFlare;
    }
    float dsun = length((uv - s) * vec2(asp, 1.0));
    c += uFlareCol * (exp(-abs(uv.y - s.y) * 110.0) * exp(-abs(uv.x - s.x) * 2.5) * 0.25 + exp(-dsun * 9.0) * 0.18) * uFlare;
  }
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = c * uGain + uLift * (1.0 - c);
  float vig = smoothstep(1.15, 0.3, length(dc * vec2(uRes.x / uRes.y, 1.0) * 0.9));
  c *= mix(1.0, vig, uVignette);
  c = mix(c, c * vec3(1.25, 0.6, 0.55), uHit * smoothstep(0.25, 0.9, length(dc) * 1.4));
  c += (hash12(uv * uRes + fract(uTime * 7.31) * 911.0) - 0.5) * uGrain;
  if (abs(uv.y - 0.5) > 0.5 - uLetter) c = vec3(0.0);
  o = vec4(c, 1.0);
}`;

// ============================================================================ GL helpers
function compile(gl, vs, fs, name) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      throw new Error(`${name} ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader: ${log}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const key = info.name.replace(/\[0\]$/, "");
    u[key] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
  }
  return { p, u, name };
}

// ============================================================================ renderer
export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: true, stencil: false,
      preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL 2 is not available in this browser");
    this.gl = gl; this.canvas = canvas;
    this.floatOK = !!gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("OES_texture_float_linear");
    this.aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    this.P = {
      lit: compile(gl, LIT_VS, LIT_FS, "lit"),
      depth: compile(gl, LIT_VS, DEPTH_FS, "depth"),
      sky: compile(gl, FS_TRI_VS, SKY_FS, "sky"),
      flat: compile(gl, FLAT_VS, FLAT_FS, "flat"),
      part: compile(gl, PART_VS, PART_FS, "particles"),
      pre: compile(gl, FS_TRI_VS, PRE_FS, "bloom-pre"),
      down: compile(gl, FS_TRI_VS, DOWN_FS, "bloom-down"),
      up: compile(gl, FS_TRI_VS, UP_FS, "bloom-up"),
      comp: compile(gl, FS_TRI_VS, COMP_FS, "composite"),
    };
    this.emptyVao = gl.createVertexArray();          // fullscreen passes (attribute 0 bound to avoid emulation warnings)
    gl.bindVertexArray(this.emptyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(9), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // generic attribute values for meshes without colours / instances
    gl.vertexAttrib4f(2, 1, 1, 1, 0);
    gl.vertexAttrib4f(3, -1, -1, 0, 0);
    gl.vertexAttrib4f(4, 0, 0, 0, 0);
    gl.vertexAttrib4f(5, 1, 1, 1, 0);
    gl.vertexAttrib4f(6, 1, 1, 1, 0);
    gl.vertexAttrib4f(7, 0, 0, 0, 0);
    gl.vertexAttrib4f(8, 1, 0, 0, 0);
    this.quadMesh = this.mesh(quadGeo());
    this.partInst = this.particleGroup(6000);
    this.quality = { msaa: 4, shadow: 2048, bloom: true, scale: 1 };
    this.targets = null;
    this.stats = { draws: 0, tris: 0 };
    // 1x1 white atlas until one is supplied
    this.atlas = this.texture(null);
    this.whiteGlow = new Float32Array(8);
  }

  // ------------------------------------------------------------ resources
  mesh(geo) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = {};
    const buf = (data, loc, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      bufs[loc] = [b, size];
    };
    buf(geo.pos, 0, 3); buf(geo.nor, 1, 3);
    if (geo.col?.length) { buf(geo.col, 2, 4); buf(geo.mat, 3, 4); buf(geo.uv, 7, 2); }
    gl.bindVertexArray(null);
    return { vao, count: geo.pos.length / 3, bufs };
  }
  // instanced group: 16 floats per instance  iA(x,y,z,yaw) iB(sx,sy,sz,roll) iC(tint rgb, mode) iD(alpha, glow, -, -)
  inst(mesh, cap) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [loc, [b, size]] of Object.entries(mesh.bufs)) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(+loc);
      gl.vertexAttribPointer(+loc, size, gl.FLOAT, false, 0, 0);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, cap * 64, gl.DYNAMIC_DRAW);
    [[4, 0], [5, 16], [6, 32], [8, 48]].forEach(([loc, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, off);
      gl.vertexAttribDivisor(loc, 1);
    });
    gl.bindVertexArray(null);
    const data = new Float32Array(cap * 16);
    const grp = {
      vao, mesh, buf: ib, cap, n: 0, data, count: mesh.count, dirty: true, instanced: true,
      clear() { this.n = 0; this.dirty = true; return this; },
      // x y z yaw | sx sy sz roll | r g b mode | alpha glow
      push(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, roll = 0, r = 1, g = 1, b = 1, mode = 0, alpha = 1, glow = 0) {
        if (this.n >= this.cap) return;
        const o = this.n++ * 16, d = this.data;
        d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw;
        d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = sz; d[o + 7] = roll;
        d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = mode;
        d[o + 12] = alpha; d[o + 13] = glow; d[o + 14] = 0; d[o + 15] = 0;
        this.dirty = true;
      },
    };
    return grp;
  }
  particleGroup(cap) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const [b] = this.quadMesh.bufs[0];
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, cap * 48, gl.DYNAMIC_DRAW);
    [[4, 0], [5, 16], [6, 32]].forEach(([loc, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 48, off);
      gl.vertexAttribDivisor(loc, 1);
    });
    gl.bindVertexArray(null);
    return { vao, buf: ib, cap, data: new Float32Array(cap * 12) };
  }
  upload(g) {
    if (!g.dirty || !g.n) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.data, 0, g.n * 16);
    g.dirty = false;
  }
  texture(src, opts = {}) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (src && opts.mip !== false) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  setAtlas(canvas) { this.atlas = this.texture(canvas); }
  updateAtlas(x, y, canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // ------------------------------------------------------------ uniforms
  set(prog, name, v) {
    const info = prog.u[name];
    if (!info) return;
    const gl = this.gl, l = info.loc;
    switch (info.type) {
      case gl.FLOAT: info.size > 1 ? gl.uniform1fv(l, v) : gl.uniform1f(l, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(l, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(l, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(l, v); break;
      case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: case gl.SAMPLER_2D_SHADOW:
        info.size > 1 ? gl.uniform1iv(l, v) : gl.uniform1i(l, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, v); break;
      default: break;
    }
  }
  setEnv(prog, env, direct) {
    const s = (n, v) => this.set(prog, n, v);
    s("uSunDir", env.sunDir); s("uSunCol", env.sunCol); s("uSkyTop", env.skyTop); s("uSkyHor", env.skyHor);
    s("uSkyGround", env.skyGround); s("uFogCol", env.fogCol); s("uAmbSky", env.ambSky); s("uAmbGround", env.ambGround);
    s("uFogDen", env.fogDen); s("uFogFall", env.fogFall); s("uSunVis", env.sunVis); s("uNight", env.night);
    s("uWet", env.wet); s("uTime", env.time); s("uCloud", env.cloud); s("uDirect", direct ? 1 : 0); s("uExposure", env.exposure);
  }

  // ------------------------------------------------------------ targets
  resize(scale = 1) {
    const dpr = Math.min(devicePixelRatio || 1, 2) * scale, c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return [c.clientWidth, c.clientHeight];
  }
  freeTargets(t = this.targets) {
    const gl = this.gl;
    if (!t) return;
    for (const x of t.textures) gl.deleteTexture(x);
    for (const x of t.rbs) gl.deleteRenderbuffer(x);
    for (const x of t.fbs) gl.deleteFramebuffer(x);
    this.targets = null;
  }
  makeTargets(w, h) {
    const gl = this.gl, q = this.quality;
    this.freeTargets();
    const T = { w, h, textures: [], rbs: [], fbs: [], mips: [], samples: 0, post: true };
    const tex = (tw, th, float) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      T.textures.push(t);
      return t;
    };
    const fbFor = (t) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      T.fbs.push(f);
      return f;
    };
    const tryBuild = (float, samples) => {
      const fmt = float ? gl.RGBA16F : gl.RGBA8;
      T.float = float;
      T.sceneTex = tex(w, h, float);
      T.sceneFB = fbFor(T.sceneTex);
      const depth = gl.createRenderbuffer(); T.rbs.push(depth);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
      T.samples = 0;
      if (samples > 0) {
        const msFB = gl.createFramebuffer(); T.fbs.push(msFB);
        gl.bindFramebuffer(gl.FRAMEBUFFER, msFB);
        const c = gl.createRenderbuffer(), d = gl.createRenderbuffer(); T.rbs.push(c, d);
        gl.bindRenderbuffer(gl.RENDERBUFFER, c);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
        gl.bindRenderbuffer(gl.RENDERBUFFER, d);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) { T.msFB = msFB; T.samples = samples; }
      }
      // bloom chain
      let mw = w, mh = h;
      for (let i = 0; i < 6; i++) {
        mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
        const t = tex(mw, mh, float);
        T.mips.push({ t, fb: fbFor(t), w: mw, h: mh });
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
      }
      return true;
    };
    const samples = Math.min(q.msaa, this.maxSamples);
    let ok = false;
    try { ok = tryBuild(this.floatOK, samples); } catch { ok = false; }
    if (!ok) {
      this.freeTargets(T);
      Object.assign(T, { textures: [], rbs: [], fbs: [], mips: [] });
      try { ok = tryBuild(false, 0); } catch { ok = false; }
    }
    if (!ok) { T.post = false; this.freeTargets(T); Object.assign(T, { textures: [], rbs: [], fbs: [], mips: [] }); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = T;
  }
  makeShadow(size) {
    const gl = this.gl;
    if (this.shadow?.size === size) return;
    if (this.shadow) { gl.deleteTexture(this.shadow.tex); gl.deleteFramebuffer(this.shadow.fb); }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadow = ok ? { tex: t, fb, size } : null;
  }

  // ------------------------------------------------------------ frame
  // scene = { cam: {vp, view, proj, eye, worldX, invVP, right, up}, env, shadow: {center, half, ox},
  //           mirror: [items], ground: [items], opaque: [items], glass: [items], flats: [..], beams: [..],
  //           partsAlpha: [[...12]], partsAdd: [...], post: {...} }
  render(scene) {
    const gl = this.gl, c = this.canvas, q = this.quality;
    const W = c.width, H = c.height;
    if (!this.targets || this.targets.w !== W || this.targets.h !== H || this.targets.q !== JSON.stringify(q)) {
      this.makeTargets(W, H); this.targets.q = JSON.stringify(q);
    }
    const T = this.targets;
    const env = scene.env, cam = scene.cam;
    if (!this.shadow) this.makeShadow(q.shadow || 256);
    this.stats = { draws: 0, tris: 0 };
    const direct = !T.post;
    for (const g of scene.groups || []) this.upload(g);

    // ---------------- shadow pass
    let lightVP = M4.ident(), shadowOn = 0, texel = [0, 0];
    if (q.shadow > 0 && scene.shadow) {
      this.makeShadow(q.shadow);
      if (this.shadow) {
        const S = this.shadow, sh = scene.shadow, hs = sh.half;
        const up = Math.abs(env.sunDir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
        const lv = M4.lookAt([env.sunDir[0] * 400, env.sunDir[1] * 400, env.sunDir[2] * 400], [0, 0, 0], up);
        const tx = S.size, tex = (2 * hs) / tx;
        const cl = M4.apply(lv, sh.center[0], sh.center[1], sh.center[2]);
        const offx = lv[0] * sh.ox, offy = lv[1] * sh.ox;     // world-anchored texel grid
        const sx = Math.round((cl[0] + offx) / tex) * tex - offx, sy = Math.round((cl[1] + offy) / tex) * tex - offy;
        const zc = -cl[2];
        const proj = M4.ortho(sx - hs, sx + hs, sy - hs, sy + hs, zc - 350, zc + 350);
        lightVP = M4.mul(proj, lv);
        gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
        gl.viewport(0, 0, S.size, S.size);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
        const P = this.P.depth;
        gl.useProgram(P.p);
        this.set(P, "uVP", lightVP); this.set(P, "uLightVP", lightVP); this.set(P, "uTime", env.time); this.set(P, "uWind", env.wind);
        this.set(P, "uNBias", 0);
        for (const it of scene.opaque) if (it.cast !== false) this.drawItem(P, it, true);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        shadowOn = 1; texel = [1 / S.size, 1 / S.size];
      }
    }

    // ---------------- main pass target
    const mainFB = direct ? null : (T.samples ? T.msFB : T.sceneFB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mainFB);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    {
      const P = this.P.sky;
      gl.useProgram(P.p);
      this.setEnv(P, env, direct);
      this.set(P, "uInvVP", cam.invVP); this.set(P, "uCam", cam.eye); this.set(P, "uMoonDir", env.moonDir);
      this.set(P, "uStars", env.stars); this.set(P, "uCloudDark", env.cloudDark); this.set(P, "uCloudOff", env.cloudOff);
      this.set(P, "uFlash", env.flash || 0);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);

    // lit program setup
    const L = this.P.lit;
    gl.useProgram(L.p);
    this.setEnv(L, env, direct);
    this.set(L, "uVP", cam.vp); this.set(L, "uCam", cam.eye); this.set(L, "uWorldX", cam.worldX || 0);
    this.set(L, "uLightVP", lightVP); this.set(L, "uShadowOn", shadowOn); this.set(L, "uShadowTexel", texel);
    this.set(L, "uShadowBias", 0.0006); this.set(L, "uNBias", scene.shadow ? (2 * scene.shadow.half / (q.shadow || 1024)) * 1.2 : 0.05);
    this.set(L, "uShadowK", env.shadowK ?? 1);
    this.set(L, "uWind", env.wind); this.set(L, "uSnow", env.snow);
    const spots = env.spots || [];
    const sp = new Float32Array(32), sd = new Float32Array(32);
    spots.slice(0, 8).forEach((s, i) => { sp.set([s.p[0], s.p[1], s.p[2], s.i], i * 4); sd.set([s.d[0], s.d[1], s.d[2], s.cos], i * 4); });
    this.set(L, "uSpotPos", sp); this.set(L, "uSpotDir", sd); this.set(L, "uSpotN", Math.min(8, spots.length));
    this.set(L, "uLamp", env.lamp); this.set(L, "uLampZ2", env.lampZ2); this.set(L, "uLampCol", env.lampCol);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shadowOn ? this.shadow.tex : null);
    this.set(L, "uShadowMap", 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    this.set(L, "uAtlas", 2);
    gl.activeTexture(gl.TEXTURE0);
    if (!shadowOn) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadow?.tex || null); gl.activeTexture(gl.TEXTURE0); }

    const wetMirror = env.wet > 0.05 && scene.mirror?.length;
    this.set(L, "uMirror", wetMirror ? 1 : 0);
    // mirrored objects below the road (seen through the wet asphalt)
    if (wetMirror) {
      const flipY = M4.model(0, 0, 0, 0, 0, 1, -1, 1);
      for (const it of scene.mirror) this.drawItem(L, { ...it, model: M4.mul(flipY, it.model || M4.ident()), mirrored: true }, false);
    }
    gl.enable(gl.CULL_FACE);
    for (const it of scene.ground)
      this.drawItem(L, wetMirror && it.mat?.kind === 1 ? { ...it, blendRoad: true, writeDepth: true } : it, false);
    for (const it of scene.opaque) this.drawItem(L, it, false);
    this.set(L, "uMirror", 0);

    // flats (contact shadows, decals, guides) - depth test, no write
    this.drawFlats(scene.flats || [], cam, env, direct);
    // glass (sorted far to near)
    const glass = (scene.glass || []).slice().sort((a, b) => (b.dist || 0) - (a.dist || 0));
    gl.useProgram(L.p);
    for (const it of glass) this.drawItem(L, it, false);
    // particles
    this.drawParticles(scene.partsAlpha || [], false, cam, env, direct);
    this.drawFlats(scene.beams || [], cam, env, direct);
    this.drawParticles(scene.partsAdd || [], true, cam, env, direct);
    gl.depthMask(true); gl.disable(gl.BLEND);

    if (direct) return;
    // ---------------- resolve + post
    if (T.samples) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.msFB);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.sceneFB);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.emptyVao);
    const post = scene.post || {};
    const bloomOn = q.bloom && T.mips.length;
    if (bloomOn) {
      const m0 = T.mips[0];
      let P = this.P.pre;
      gl.useProgram(P.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, m0.fb); gl.viewport(0, 0, m0.w, m0.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.sceneTex);
      this.set(P, "uSrc", 0); this.set(P, "uTexel", [0.5 / W, 0.5 / H]); this.set(P, "uThresh", T.float ? (post.threshold ?? 1.0) : 0.8);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      P = this.P.down; gl.useProgram(P.p); this.set(P, "uSrc", 0);
      for (let i = 1; i < T.mips.length; i++) {
        const src = T.mips[i - 1], dst = T.mips[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.t);
        this.set(P, "uTexel", [0.5 / src.w, 0.5 / src.h]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      P = this.P.up; gl.useProgram(P.p); this.set(P, "uSrc", 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = T.mips.length - 1; i > 0; i--) {
        const src = T.mips[i], dst = T.mips[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.t);
        this.set(P, "uTexel", [0.5 / src.w, 0.5 / src.h]); this.set(P, "uK", 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }
    // composite to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const P = this.P.comp;
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.sceneTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomOn ? T.mips[0].t : T.sceneTex);
    this.set(P, "uScene", 0); this.set(P, "uBloom", 1);
    const s = (n, v) => this.set(P, n, v);
    s("uExposure", env.exposure); s("uBloomK", bloomOn ? (post.bloom ?? 0.06) : 0); s("uVignette", post.vignette ?? 0.35);
    s("uGrain", post.grain ?? 0.015); s("uTime", env.time); s("uCA", post.ca ?? 0.0015); s("uLetter", post.letter ?? 0);
    s("uFlare", post.flare ?? 0); s("uSunScr", post.sunScr || [0.5, 0.5]); s("uFlareCol", post.flareCol || [1, 0.8, 0.6]);
    s("uSat", post.sat ?? 1.0); s("uLift", post.lift || [0, 0, 0]); s("uGain", post.gain || [1, 1, 1]); s("uRes", [W, H]);
    s("uHit", post.hit ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  // item = { mesh | group, model, mat: {color, emissive, spec, shine, alpha, kind, flags, glow[8], crumple[4], refl}, noCull }
  drawItem(P, it, depthOnly) {
    const gl = this.gl, mat = it.mat || {};
    const g = it.group;
    if (g && !g.n) return;
    const model = it.model || IDENT;
    this.set(P, "uModel", model);
    this.set(P, "uCrumple", mat.crumple || ZERO4);
    if (!depthOnly) {
      this.set(P, "uNM", M4.normal(model));
      this.set(P, "uColor", mat.colorLin || (mat.color ? lin(mat.color) : ONE3));
      this.set(P, "uEmissive", mat.emissive ? (mat.emissiveLin || lin(mat.emissive)) : ZERO3);
      this.set(P, "uSpec", mat.spec ?? 0.15); this.set(P, "uShine", mat.shine ?? 24); this.set(P, "uRefl", mat.refl ?? 0.6);
      this.set(P, "uAlpha", (mat.alpha ?? 1) * (it.mirrored ? 1 : 1)); this.set(P, "uKind", mat.kind ?? 0);
      this.set(P, "uFlags", mat.flags ?? 0);
      this.set(P, "uGlow", mat.glow || ZERO8);
      this.set(P, "uGlowCol", mat.glowCol || GLOWCOL);
    }
    const blend = !depthOnly && ((mat.alpha ?? 1) < 1 || (mat.flags & 2) || (mat.kind === 1 && it.blendRoad));
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); if (!it.writeDepth) gl.depthMask(false); }
    const flip = M4.det3(model) < 0;
    if (flip) gl.frontFace(gl.CW);
    if (it.noCull) gl.disable(gl.CULL_FACE);
    if (g) {
      gl.bindVertexArray(g.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, g.count, g.n);
      this.stats.tris += g.count / 3 * g.n;
    } else {
      gl.bindVertexArray(it.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
      this.stats.tris += it.mesh.count / 3;
    }
    this.stats.draws++;
    if (it.noCull) gl.enable(gl.CULL_FACE);
    if (flip) gl.frontFace(gl.CCW);
    if (blend) { gl.disable(gl.BLEND); gl.depthMask(true); }
  }

  // flats: {mesh?, model, color, alpha, mode, additive, param}
  drawFlats(list, cam, env, direct) {
    if (!list.length) return;
    const gl = this.gl, P = this.P.flat;
    gl.useProgram(P.p);
    this.setEnv(P, env, direct);
    this.set(P, "uVP", cam.vp); this.set(P, "uCam", cam.eye);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    for (const f of list) {
      gl.blendFunc(gl.SRC_ALPHA, f.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      this.set(P, "uModel", f.model);
      const c = f.colorLin || lin(f.color);
      this.set(P, "uColor", [c[0] * (f.k ?? 1), c[1] * (f.k ?? 1), c[2] * (f.k ?? 1), f.alpha]);
      this.set(P, "uMode", f.mode ?? 0);
      this.set(P, "uParam", f.param || ZERO4);
      const m = f.mesh || this.quadMesh;
      gl.bindVertexArray(m.vao);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
      this.stats.draws++;
    }
    gl.enable(gl.CULL_FACE); gl.depthMask(true); gl.disable(gl.BLEND);
  }

  // particles: array of [x, y, z, size, r, g, b, a, vx, vy, vz, mode+rot]
  drawParticles(list, additive, cam, env, direct) {
    if (!list.length) return;
    const gl = this.gl, P = this.P.part, G = this.partInst;
    const n = Math.min(list.length, G.cap);
    if (!additive) list.sort((a, b) => b[12] - a[12]);   // far to near (index 12 = distance, set by caller)
    for (let i = 0; i < n; i++) {
      const p = list[i], o = i * 12;
      for (let k = 0; k < 12; k++) G.data[o + k] = p[k];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, G.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, G.data, 0, n * 12);
    gl.useProgram(P.p);
    this.setEnv(P, env, direct);
    this.set(P, "uVP", cam.vp); this.set(P, "uCamPos", cam.eye); this.set(P, "uCamRight", cam.right); this.set(P, "uCamUp", cam.up);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(G.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    this.stats.draws++;
    gl.enable(gl.CULL_FACE); gl.depthMask(true); gl.disable(gl.BLEND);
  }

  // read the canvas into a PNG right after a frame
  snapshot() { return this.canvas.toDataURL("image/png"); }
}

const IDENT = M4.ident();
// emissive colour per glow group (-1 = use the vertex colour): 6 = hot brake disc, 7 = warm interior light
export const GLOWCOL = new Float32Array([-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1.0, 0.22, 0.02, 1.0, 0.62, 0.3]);
const ZERO3 = [0, 0, 0], ONE3 = [1, 1, 1], ZERO4 = [0, 0, 0, 0], ZERO8 = new Float32Array(8);
