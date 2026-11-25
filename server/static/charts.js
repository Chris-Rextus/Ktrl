// Time-series chart panels drawn on <canvas>.
//
// A ChartGroup shares one time view (follow live / fixed range) and one hover
// time between its charts, so zoom and crosshair stay in sync.
//
//   drag on a chart      : zoom to that time range (stops following live)
//   double-click         : back to live follow (or the whole run for a file)
//   hover                : crosshair and values in every chart of the group

import { LANE_NAME, sigInfo } from "./signals.js";

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const DASHES = [[], [6, 4], [2, 3], [10, 3, 2, 3]];

// First row index with t >= t0 (rows sorted by time, column 0).
function lowerBound(rows, t0) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (rows[m][0] < t0) lo = m + 1; else hi = m;
  }
  return lo;
}

function niceStep(range, n) {
  const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

function fmt(v) {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(a >= 1 ? 2 : 3);
}

// tick label with as many decimals as the tick step needs
function tickFmt(v, step) {
  if (Math.abs(v) >= 1e5 || (step < 1e-3 && v !== 0)) return v.toExponential(1);
  return v.toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

export class ChartGroup {
  // source(): {columns, rows}; live: follow the newest data
  constructor(source, { live = true } = {}) {
    this.source = source;
    this.live = live;
    this.charts = [];
    this.window = 30;          // s visible when following (Infinity = whole run)
    this.follow = true;
    this.t0 = 0; this.t1 = 1;  // fixed range when !follow
    this.hoverT = null;
    this.lanes = ["ice", "ev"];
    this.markers = [];         // [{t, label, color}] vertical lines (collisions)
    this.dirty = true;
    this.onViewChange = () => {};
  }
  add(chart) { this.charts.push(chart); chart.group = this; this.dirty = true; }
  remove(chart) { this.charts = this.charts.filter((c) => c !== chart); }
  clear() { this.charts.forEach((c) => c.el.remove()); this.charts = []; }
  resetView() { this.follow = true; this.dirty = true; this.onViewChange(); }
  setRange(t0, t1) { this.follow = false; this.t0 = t0; this.t1 = t1; this.dirty = true; this.onViewChange(); }

  view() {
    const { rows } = this.source();
    if (!rows.length) return null;
    const first = rows[0][0], last = rows[rows.length - 1][0];
    if (!this.follow) return { t0: this.t0, t1: this.t1 };
    if (!this.live || !isFinite(this.window)) return { t0: first, t1: Math.max(last, first + 1e-3) };
    return { t0: Math.max(first, last - this.window), t1: Math.max(last, first + this.window * 0.02) };
  }

  draw(force = false) {
    if (!this.dirty && !force) return;
    this.dirty = false;
    const v = this.view();
    for (const c of this.charts) c.draw(v);
  }
}

export class ChartPanel {
  // spec: {title, sigs: [...], zero?}
  constructor(host, spec, { onEdit, onRemove } = {}) {
    this.spec = spec;
    this.el = document.createElement("div");
    this.el.className = "chart-card";
    this.el.innerHTML = `
      <div class="chart-head">
        <div class="chart-title"></div>
        <div class="chart-legend"></div>
        <div class="chart-tools">
          ${onEdit ? '<button class="icon" data-act="edit" title="Choose signals">✎</button>' : ""}
          <button class="icon" data-act="png" title="Save as PNG">⤓</button>
          ${onRemove ? '<button class="icon" data-act="remove" title="Remove chart">✕</button>' : ""}
        </div>
      </div>
      <div class="chart-body"><canvas></canvas><div class="chart-tip"></div><div class="chart-sel"></div></div>`;
    host.appendChild(this.el);
    this.canvas = this.el.querySelector("canvas");
    this.tip = this.el.querySelector(".chart-tip");
    this.sel = this.el.querySelector(".chart-sel");
    this.el.querySelector(".chart-title").textContent = spec.title;
    this.el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.act === "edit") onEdit?.(this);
      if (b.dataset.act === "remove") onRemove?.(this);
      if (b.dataset.act === "png") this.savePng();
    }));
    new ResizeObserver(() => { if (this.group) this.group.dirty = true; }).observe(this.el);
    this.bindMouse();
  }

  setSpec(spec) {
    this.spec = spec;
    this.el.querySelector(".chart-title").textContent = spec.title;
    if (this.group) this.group.dirty = true;
  }

  // series to draw, from the signals and the visible lanes
  series(columns) {
    const lanes = this.group.lanes.filter((l) => columns.some((c) => c.startsWith(l + "_")));
    const out = [];
    let styleIdx = 0;
    for (const s of this.spec.sigs) {
      const info = sigInfo(s);
      if (info.shared) {
        const lane = lanes.find((l) => columns.includes(`${l}_${s}`));
        if (lane) out.push({ sig: s, lane, col: `${lane}_${s}`, color: css("--lead"),
          dash: s === "v_set" ? [4, 4] : [], width: 1.4, shared: true });
        continue;
      }
      const dash = DASHES[styleIdx++ % DASHES.length];
      for (const l of lanes) {
        const c = `${l}_${s}`;
        if (columns.includes(c)) out.push({ sig: s, lane: l, col: c, color: css("--" + l), dash, width: dash.length ? 1.3 : 1.8 });
      }
    }
    return out;
  }

  draw(view) {
    const { columns, rows } = this.group.source();
    const c = this.canvas, dpr = devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const series = this.series(columns);
    this.renderLegend(series);
    this.layout = null;
    if (!view || !rows.length || !series.length) {
      g.fillStyle = css("--muted"); g.font = "12px Inter, system-ui";
      g.fillText(rows.length ? "no signal in this run" : "waiting for data…", 12, 22);
      return;
    }
    const idx = Object.fromEntries(columns.map((n, i) => [n, i]));
    const { t0, t1 } = view;
    const i0 = Math.max(0, lowerBound(rows, t0) - 1);
    const i1 = Math.min(rows.length, lowerBound(rows, t1) + 1);

    // y range
    const allStep = series.every((s) => sigInfo(s.sig).step);
    let lo = Infinity, hi = -Infinity;
    for (const s of series) {
      const ci = idx[s.col], wi = this.whenCol(s, idx);
      for (let i = i0; i < i1; i++) {
        const r = rows[i], v = r[ci];
        if (v == null || (wi >= 0 && r[wi] < 0.5)) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    if (allStep) { lo = -0.1; hi = 1.1; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (this.spec.zero && lo > 0) lo = 0;
    if (hi - lo < 1e-9) { const m = Math.abs(hi) * 0.05 || 0.5; lo -= m; hi += m; }
    else if (!allStep) { const p = (hi - lo) * 0.08; hi += p; if (!(this.spec.zero && lo === 0)) lo -= p; }

    const padL = 52, padR = 10, padT = 8, padB = 22;
    const pw = W - padL - padR, ph = H - padT - padB;
    const X = (t) => padL + (t - t0) / (t1 - t0) * pw;
    const Y = (v) => padT + (hi - v) / (hi - lo) * ph;
    this.layout = { padL, padR, pw, t0, t1, idx, series };

    // grid
    g.font = "11px Inter, system-ui"; g.lineWidth = 1;
    g.strokeStyle = css("--grid"); g.fillStyle = css("--muted");
    const ys = allStep ? 1 : niceStep(hi - lo, 4);
    for (let k = Math.ceil(lo / ys); k * ys <= hi + 1e-9; k++) {
      const v = k * ys;
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.textAlign = "right"; g.fillText(tickFmt(v, ys), padL - 6, y + 4);
    }
    const xs = niceStep(t1 - t0, Math.max(2, Math.floor(pw / 90)));
    g.textAlign = "center";
    for (let k = Math.ceil(t0 / xs); k * xs <= t1 + 1e-9; k++) {
      const t = k * xs;
      const x = Math.round(X(t)) + 0.5;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke();
      g.fillText(tickFmt(t, xs) + " s", x, H - 6);
    }
    g.textAlign = "left";

    // series (min/max per pixel column when there are many points)
    g.save();
    g.beginPath(); g.rect(padL, padT, pw, ph); g.clip();
    for (const s of series) {
      const ci = idx[s.col], wi = this.whenCol(s, idx), isStep = sigInfo(s.sig).step;
      g.strokeStyle = s.color; g.lineWidth = s.width; g.setLineDash(s.dash);
      g.beginPath();
      let pen = false, bx = -1, bmin = 0, bmax = 0, prevY = 0;
      const flush = () => {
        if (bx < 0) return;
        if (bmin !== bmax) { g.lineTo(bx, Y(bmin)); g.lineTo(bx, Y(bmax)); }
      };
      for (let i = i0; i < i1; i++) {
        const r = rows[i], v = r[ci];
        if (v == null || (wi >= 0 && r[wi] < 0.5)) { flush(); bx = -1; pen = false; continue; }
        const x = Math.round(X(r[0])), y = Y(v);
        if (!pen) { g.moveTo(x, y); pen = true; bx = x; bmin = bmax = v; prevY = y; continue; }
        if (x === bx) { if (v < bmin) bmin = v; if (v > bmax) bmax = v; continue; }
        flush();
        if (isStep) g.lineTo(x, prevY);
        g.lineTo(x, y); bx = x; bmin = bmax = v; prevY = y;
      }
      flush();
      g.stroke();
    }
    g.restore();
    g.setLineDash([]);

    // event markers (collisions)
    for (const m of this.group.markers) {
      if (m.t < t0 || m.t > t1) continue;
      const x = Math.round(X(m.t)) + 0.5;
      g.strokeStyle = m.color; g.lineWidth = 1.5; g.setLineDash([5, 3]);
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke(); g.setLineDash([]);
      g.fillStyle = m.color; g.font = "600 10px Inter, system-ui";
      g.fillText(m.label, Math.min(x + 4, W - padR - g.measureText(m.label).width), padT + 10);
    }

    // crosshair
    const ht = this.group.hoverT;
    if (ht != null && ht >= t0 && ht <= t1) {
      const x = Math.round(X(ht)) + 0.5;
      g.strokeStyle = css("--crosshair"); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke();
      const k = Math.min(rows.length - 1, lowerBound(rows, ht));
      const r = rows[k];
      const lines = [`t = ${r[0].toFixed(2)} s`];
      for (const s of series) {
        const v = r[idx[s.col]];
        const name = (s.shared ? "" : LANE_NAME[s.lane] + " ") + s.sig;
        lines.push(`<i style="background:${s.color}"></i>${name} <b>${v == null ? "–" : fmt(v)}</b> ${sigInfo(s.sig).unit}`);
        if (v != null) {
          g.fillStyle = s.color;
          g.beginPath(); g.arc(x, Y(v), 3, 0, Math.PI * 2); g.fill();
        }
      }
      this.tip.innerHTML = lines.join("<br>");
      this.tip.style.display = "block";
      const left = x + 12 + this.tip.offsetWidth > W ? x - 12 - this.tip.offsetWidth : x + 12;
      this.tip.style.left = left + "px";
    } else {
      this.tip.style.display = "none";
    }
  }

  whenCol(s, idx) {
    const w = sigInfo(s.sig).when;
    if (!w) return -1;
    return idx[`${s.lane}_${w}`] ?? -1;
  }

  renderLegend(series) {
    const key = series.map((s) => s.col + s.dash.join(",")).join("|");
    if (key === this.legendKey) return;
    this.legendKey = key;
    const seen = new Set();
    const items = [];
    for (const s of series) {
      if (seen.has(s.sig)) continue;
      seen.add(s.sig);
      const info = sigInfo(s.sig);
      const dash = s.dash.length ? `border-top-style:${s.dash[0] <= 2 ? "dotted" : "dashed"}` : "";
      items.push(`<span title="${info.label}${info.unit ? " [" + info.unit + "]" : ""}">` +
        `<i class="ln" style="border-color:${s.shared ? s.color : "var(--text-2)"};${dash}"></i>${s.sig}` +
        `${info.unit ? `<small>${info.unit}</small>` : ""}</span>`);
    }
    this.el.querySelector(".chart-legend").innerHTML = items.join("");
  }

  tAt(clientX) {
    const L = this.layout; if (!L) return null;
    const x = clientX - this.canvas.getBoundingClientRect().left;
    const f = (x - L.padL) / L.pw;
    return L.t0 + Math.min(1, Math.max(0, f)) * (L.t1 - L.t0);
  }

  bindMouse() {
    const cv = this.canvas;
    let dragX = null;
    cv.addEventListener("mousemove", (e) => {
      if (!this.group) return;
      this.group.hoverT = this.tAt(e.clientX);
      this.group.dirty = true;
      if (dragX != null) {
        const x = e.clientX - cv.getBoundingClientRect().left;
        this.sel.style.display = "block";
        this.sel.style.left = Math.min(x, dragX) + "px";
        this.sel.style.width = Math.abs(x - dragX) + "px";
      }
    });
    cv.addEventListener("mouseleave", () => {
      if (!this.group) return;
      this.group.hoverT = null; this.group.dirty = true;
    });
    cv.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragX = e.clientX - cv.getBoundingClientRect().left;
    });
    window.addEventListener("mouseup", (e) => {
      if (dragX == null) return;
      const x = e.clientX - cv.getBoundingClientRect().left;
      this.sel.style.display = "none";
      if (Math.abs(x - dragX) > 6) {
        const rect = cv.getBoundingClientRect();
        const a = this.tAt(rect.left + Math.min(x, dragX)), b = this.tAt(rect.left + Math.max(x, dragX));
        if (a != null && b > a) this.group.setRange(a, b);
      }
      dragX = null;
    });
    cv.addEventListener("dblclick", () => this.group?.resetView());
  }

  savePng() {
    const c = this.canvas;
    const out = document.createElement("canvas");
    out.width = c.width; out.height = c.height + 36 * (devicePixelRatio || 1);
    const g = out.getContext("2d"), k = devicePixelRatio || 1;
    g.fillStyle = css("--panel"); g.fillRect(0, 0, out.width, out.height);
    g.fillStyle = css("--text"); g.font = `${13 * k}px Inter, system-ui`;
    const sigs = this.spec.sigs.join(", ");
    g.fillText(`${this.spec.title}  (${sigs})`, 10 * k, 22 * k);
    g.drawImage(c, 0, 36 * k);
    const a = document.createElement("a");
    a.download = this.spec.title.replace(/[^\w-]+/g, "_") + ".png";
    a.href = out.toDataURL("image/png");
    a.click();
  }
}
