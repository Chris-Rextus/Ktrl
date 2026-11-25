// Small canvas plotting library for the Analysis page.
//
//   new XYPlot(host, {title, xlabel, ylabel, xlog, height})
//       .set(series, {vlines, hlines, yzero})       series: [{name, x, y, color, dash, width, dots}]
//   new Heatmap(host, {title, xlabel, ylabel, unit, height})
//       .set({x, y, z, mask, maskLabel, reverse, marker})   z row-major: z[iy*nx + ix]
//
// Colours may be CSS variables ("var(--ice)"). Plots redraw on resize and on
// redrawAll() (theme change). Hover shows a crosshair and the values.

const cssv = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const color = (c) => (c && c.startsWith("var(") ? cssv(c.slice(4, -1)) : c || cssv("--text"));
const live = new Set();
export function redrawAll() { for (const p of live) p.draw(); }

function niceStep(range, n) {
  const raw = range / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
export function fmt(v, digits = 3) {
  if (v == null || !isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
  return (+v.toPrecision(digits)).toString();
}
function tickFmt(v, step) {
  if (Math.abs(v) >= 1e5 || (step < 1e-3 && v !== 0)) return v.toExponential(1);
  return v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

class Base {
  constructor(host, opts) {
    this.o = { height: 260, ...opts };
    this.el = document.createElement("div");
    this.el.className = "aplot";
    this.el.innerHTML = `<div class="aplot-head"><b></b><span class="aplot-legend"></span></div>
      <div class="aplot-body" style="height:${this.o.height}px"><canvas></canvas><div class="chart-tip"></div></div>`;
    this.el.querySelector("b").textContent = this.o.title || "";
    host.appendChild(this.el);
    this.cv = this.el.querySelector("canvas");
    this.tip = this.el.querySelector(".chart-tip");
    this.hover = null;
    new ResizeObserver(() => this.draw()).observe(this.el);
    this.cv.addEventListener("mousemove", (e) => { this.hover = this.local(e); this.draw(); });
    this.cv.addEventListener("mouseleave", () => { this.hover = null; this.draw(); });
    live.add(this);
  }
  local(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  ctx() {
    const dpr = devicePixelRatio || 1, W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H || !this.el.isConnected) return null;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) {
      this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    }
    const g = this.cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = "11px Inter, system-ui";
    return { g, W, H };
  }
  showTip(html, x) {
    if (!html) { this.tip.style.display = "none"; return; }
    this.tip.innerHTML = html;
    this.tip.style.display = "block";
    const W = this.cv.clientWidth;
    this.tip.style.left = (x + 14 + this.tip.offsetWidth > W ? x - 14 - this.tip.offsetWidth : x + 14) + "px";
  }
  destroy() { live.delete(this); this.el.remove(); }
}

// ============================================================================ XY plot
export class XYPlot extends Base {
  set(series, extras = {}) {
    this.series = series.filter((s) => s && s.x && s.y);
    this.extras = extras;
    this.el.querySelector(".aplot-legend").innerHTML = this.series.filter((s) => s.name).map((s) => {
      const dash = s.dash?.length ? `border-top-style:${s.dash[0] <= 2 ? "dotted" : "dashed"}` : "";
      return `<span><i class="ln" style="border-color:${color(s.color)};${dash}"></i>${s.name}</span>`;
    }).join("");
    this.draw();
    return this;
  }
  draw() {
    const c = this.ctx();
    if (!c || !this.series) return;
    const { g, W, H } = c, o = this.o, ex = this.extras || {};
    const tx = o.xlog ? (v) => Math.log10(v) : (v) => v;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of this.series)
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i], y = s.y[i];
        if (x == null || y == null || !isFinite(x) || !isFinite(y) || (o.xlog && x <= 0)) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    for (const h of ex.hlines || []) if (isFinite(h.y)) { y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y); }
    if (!isFinite(x0)) { g.fillStyle = cssv("--muted"); g.fillText("no data", 12, 20); return; }
    if (ex.yzero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
    if (o.ymin !== undefined) y0 = Math.min(y0, o.ymin);
    if (o.ymax !== undefined) y1 = Math.max(y1, o.ymax);
    if (y1 - y0 < 1e-12) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.08; y1 += pad; if (!(ex.yzero && y0 === 0)) y0 -= pad;
    if (x1 === x0) { x0 -= 1; x1 += 1; }
    const L = 54, R = 12, T = 8, B = o.xlabel ? 34 : 22, pw = W - L - R, ph = H - T - B;
    const X = (v) => L + (tx(v) - tx(x0)) / (tx(x1) - tx(x0)) * pw;
    const Y = (v) => T + (y1 - v) / (y1 - y0) * ph;
    this.map = { X, Y, L, pw, x0, x1, tx };

    // grid + ticks
    g.strokeStyle = cssv("--grid"); g.fillStyle = cssv("--muted"); g.lineWidth = 1;
    const ys = niceStep(y1 - y0, 4);
    g.textAlign = "right";
    for (let k = Math.ceil(y0 / ys); k * ys <= y1; k++) {
      const y = Math.round(Y(k * ys)) + 0.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
      g.fillText(tickFmt(k * ys, ys), L - 6, y + 4);
    }
    g.textAlign = "center";
    if (o.xlog) {
      for (let e = Math.floor(Math.log10(x0)); e <= Math.ceil(Math.log10(x1)); e++)
        for (const m of [1, 2, 5]) {
          const v = m * Math.pow(10, e);
          if (v < x0 * 0.999 || v > x1 * 1.001) continue;
          const x = Math.round(X(v)) + 0.5;
          g.globalAlpha = m === 1 ? 1 : 0.5;
          g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
          g.globalAlpha = 1;
          g.fillText(fmt(v, 2), x, T + ph + 14);
        }
    } else {
      const xs = niceStep(x1 - x0, Math.max(2, Math.floor(pw / 80)));
      for (let k = Math.ceil(x0 / xs); k * xs <= x1 + 1e-12; k++) {
        const x = Math.round(X(k * xs)) + 0.5;
        g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
        g.fillText(tickFmt(k * xs, xs), x, T + ph + 14);
      }
    }
    if (o.xlabel) { g.fillStyle = cssv("--text-2"); g.fillText(o.xlabel, L + pw / 2, H - 4); }
    if (o.ylabel) {
      g.save(); g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2);
      g.fillStyle = cssv("--text-2"); g.fillText(o.ylabel, 0, 0); g.restore();
    }
    g.textAlign = "left";

    g.save();
    g.beginPath(); g.rect(L, T, pw, ph); g.clip();
    // reference lines
    for (const h of ex.hlines || []) {
      if (!isFinite(h.y)) continue;
      const y = Math.round(Y(h.y)) + 0.5;
      g.strokeStyle = color(h.color || "var(--muted)"); g.setLineDash(h.dash || [6, 4]); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]);
      if (h.label) { g.fillStyle = color(h.color || "var(--muted)"); g.fillText(h.label, L + 6, y - 4); }
    }
    (ex.vlines || []).forEach((v, k) => {
      if (!isFinite(v.x) || (o.xlog && v.x <= 0)) return;
      const x = Math.round(X(v.x)) + 0.5;
      g.strokeStyle = color(v.color || "var(--muted)"); g.setLineDash(v.dash || [6, 4]); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.setLineDash([]);
      if (v.label) { g.fillStyle = color(v.color || "var(--muted)"); g.fillText(v.label, x + 4, T + 12 + 13 * k); }
    });
    // series
    for (const s of this.series) {
      g.strokeStyle = color(s.color); g.lineWidth = s.width || 1.8; g.setLineDash(s.dash || []);
      g.beginPath();
      let pen = false;
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i], y = s.y[i];
        if (x == null || y == null || !isFinite(y) || (o.xlog && x <= 0)) { pen = false; continue; }
        pen ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); pen = true;
      }
      g.stroke(); g.setLineDash([]);
      if (s.dots) {
        g.fillStyle = color(s.color);
        for (let i = 0; i < s.x.length; i++) {
          if (s.y[i] == null || !isFinite(s.y[i])) continue;
          g.beginPath(); g.arc(X(s.x[i]), Y(s.y[i]), 2.6, 0, Math.PI * 2); g.fill();
        }
      }
      for (const m of s.marks || []) {          // individual markers, e.g. collisions
        if (m.y == null) continue;
        g.strokeStyle = color(m.color || s.color); g.lineWidth = 2;
        const px = X(m.x), py = Y(m.y);
        g.beginPath(); g.moveTo(px - 4, py - 4); g.lineTo(px + 4, py + 4);
        g.moveTo(px + 4, py - 4); g.lineTo(px - 4, py + 4); g.stroke();
      }
    }
    g.restore();

    // hover
    if (!this.hover || this.hover.x < L || this.hover.x > L + pw) { this.showTip(null); return; }
    const hx = this.hover.x;
    const xv = o.xlog ? Math.pow(10, tx(x0) + (hx - L) / pw * (tx(x1) - tx(x0))) : x0 + (hx - L) / pw * (x1 - x0);
    g.strokeStyle = cssv("--crosshair"); g.lineWidth = 1;
    g.beginPath(); g.moveTo(hx + 0.5, T); g.lineTo(hx + 0.5, T + ph); g.stroke();
    const lines = [`${o.xlabel || "x"} = <b>${fmt(xv, 4)}</b>`];
    for (const s of this.series) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < s.x.length; i++) {
        if (s.y[i] == null || !isFinite(s.y[i])) continue;
        const dd = Math.abs(X(s.x[i]) - hx);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (best < 0 || bd > 40) continue;
      g.fillStyle = color(s.color);
      g.beginPath(); g.arc(X(s.x[best]), Y(s.y[best]), 3.2, 0, Math.PI * 2); g.fill();
      if (s.name) lines.push(`<i style="background:${color(s.color)}"></i>${s.name} <b>${fmt(s.y[best], 4)}</b>`);
    }
    this.showTip(lines.join("<br>"), hx);
  }
}

// ============================================================================ heatmap
// Sequential colour ramp (dark blue -> teal -> yellow), readable in both themes.
const RAMP = [[38, 52, 110], [40, 110, 150], [42, 160, 140], [120, 200, 90], [245, 220, 70]];
function ramp(t) {
  t = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
  const c = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export class Heatmap extends Base {
  set(d) { this.d = d; this.draw(); return this; }
  draw() {
    const c = this.ctx();
    if (!c || !this.d) return;
    const { g, W, H } = c, o = this.o, { x, y, z, mask } = this.d;
    const nx = x.length, ny = y.length;
    let lo = Infinity, hi = -Infinity;
    for (const v of z) if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-12) hi = lo + 1;
    const L = 54, R = 70, T = 8, B = 34, pw = W - L - R, ph = H - T - B;
    const cw = pw / nx, ch = ph / ny;
    const val = (v) => (this.d.reverse ? 1 - (v - lo) / (hi - lo) : (v - lo) / (hi - lo));
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const v = z[iy * nx + ix];
        const px = L + ix * cw, py = T + (ny - 1 - iy) * ch;
        g.fillStyle = v == null || !isFinite(v) ? cssv("--panel-3") : ramp(val(v));
        g.fillRect(px, py, Math.ceil(cw), Math.ceil(ch));
        if (mask && mask[iy * nx + ix]) {           // hatched: e.g. collision
          g.save(); g.beginPath(); g.rect(px, py, cw, ch); g.clip();
          g.strokeStyle = "rgba(229,83,75,.95)"; g.lineWidth = 1.5;
          for (let k = -ch; k < cw; k += 6) { g.beginPath(); g.moveTo(px + k, py + ch); g.lineTo(px + k + ch, py); g.stroke(); }
          g.restore();
        }
      }
    // axes
    g.fillStyle = cssv("--muted"); g.textAlign = "center";
    const stepX = Math.max(1, Math.ceil(nx / Math.max(2, Math.floor(pw / 60))));
    for (let ix = 0; ix < nx; ix += stepX) g.fillText(fmt(x[ix], 3), L + (ix + 0.5) * cw, T + ph + 14);
    g.textAlign = "right";
    const stepY = Math.max(1, Math.ceil(ny / Math.max(2, Math.floor(ph / 22))));
    for (let iy = 0; iy < ny; iy += stepY) g.fillText(fmt(y[iy], 3), L - 6, T + (ny - 1 - iy + 0.5) * ch + 4);
    g.textAlign = "center"; g.fillStyle = cssv("--text-2");
    if (o.xlabel) g.fillText(o.xlabel, L + pw / 2, H - 4);
    if (o.ylabel) { g.save(); g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText(o.ylabel, 0, 0); g.restore(); }
    // config marker
    const mk = this.d.marker;
    if (mk && isFinite(mk.x) && isFinite(mk.y)) {
      const fx = (mk.x - x[0]) / ((x[nx - 1] - x[0]) || 1), fy = (mk.y - y[0]) / ((y[ny - 1] - y[0]) || 1);
      if (fx >= -0.05 && fx <= 1.05 && fy >= -0.05 && fy <= 1.05) {
        const px = L + cw / 2 + fx * (pw - cw), py = T + ph - ch / 2 - fy * (ph - ch);
        g.strokeStyle = "#fff"; g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, 6, 0, Math.PI * 2); g.stroke();
        g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(mk.label || "config", px + 9, py + 4);
      }
    }
    // colour bar
    const bx = L + pw + 14, bw = 12;
    for (let k = 0; k < ph; k++) { g.fillStyle = ramp(this.d.reverse ? k / ph : 1 - k / ph); g.fillRect(bx, T + k, bw, 1.5); }
    g.fillStyle = cssv("--muted"); g.textAlign = "left";
    g.fillText(fmt(hi), bx + bw + 4, T + 9);
    g.fillText(fmt(lo), bx + bw + 4, T + ph);
    if (o.unit) g.fillText(o.unit, bx + bw + 4, T + ph / 2 + 4);
    g.textAlign = "left";
    // hover
    const h = this.hover;
    if (!h || h.x < L || h.x > L + pw || h.y < T || h.y > T + ph) { this.showTip(null); return; }
    const ix = Math.min(nx - 1, Math.floor((h.x - L) / cw)), iy = ny - 1 - Math.min(ny - 1, Math.floor((h.y - T) / ch));
    g.strokeStyle = "#fff"; g.lineWidth = 1.5;
    g.strokeRect(L + ix * cw + 0.5, T + (ny - 1 - iy) * ch + 0.5, cw - 1, ch - 1);
    const v = z[iy * nx + ix];
    this.showTip(`${o.xlabel || "x"} = <b>${fmt(x[ix], 4)}</b><br>${o.ylabel || "y"} = <b>${fmt(y[iy], 4)}</b><br>` +
      `${o.zlabel || "value"} = <b>${fmt(v, 4)}</b> ${o.unit || ""}` +
      (mask && mask[iy * nx + ix] ? `<br><span style="color:var(--bad)">${this.d.maskLabel || "masked"}</span>` : ""), h.x);
  }
}
