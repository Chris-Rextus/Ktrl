// Ktrl viewer: run control, live parameters, road + charts, all config
// parameters, tests and batch. Talks to server/app.py: REST for commands, one
// WebSocket (/ws) for the live data.

import { ChartGroup, ChartPanel } from "./charts.js";
import { drawRoad } from "./road.js";
import { DEFAULT_CHARTS, GROUP_ORDER, LANES, LANE_NAME, SIGNALS, sigInfo, signalsIn } from "./signals.js";

const $ = (id) => document.getElementById(id);

// The Analysis and Diagrams pages are loaded separately (loadPage below), so a
// missing or broken file only disables its own page instead of the whole viewer.
let redrawAll = () => {}, redrawDiagrams = () => {}, diagramsTick = () => {}, view3dTick = () => {};
async function loadPage(file, init) {
  try {
    init(await import(file));
  } catch (e) {
    console.error(e);
    toast(`${file} could not be loaded (${e.message}). Check that it is in server/static/.`, true);
    log(`[viewer] ${file} could not be loaded: ${e.message}`);
  }
}

// ================================================================== preferences
// Display preferences only (theme, layout, charts). Kept in this browser; the
// simulation parameters live in sim_config.txt.
const PREF_KEY = "ktrl.viewer.v1";
const prefs = Object.assign({
  theme: "dark", view: "plots", side: true, lanes: ["ice", "ev"],
  window: 30, cols: 2, camera: "follow", span: 160,
  charts: DEFAULT_CHARTS, acc: {},
}, (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } })());
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }

// ================================================================== http + feedback
async function call(method, url, body) {
  const r = await fetch(url, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    throw new Error(msg || `${r.status} ${r.statusText}`);
  }
  return data;
}
const GET = (u) => call("GET", u);
const POST = (u, b) => call("POST", u, b ?? {});
const PUT = (u, b) => call("PUT", u, b);

function toast(text, bad = false) {
  const el = document.createElement("div");
  el.textContent = text;
  if (bad) el.className = "bad";
  $("toast").appendChild(el);
  setTimeout(() => el.remove(), bad ? 7000 : 2800);
}
async function safe(fn) {
  try { return await fn(); } catch (e) { toast(e.message, true); return null; }
}

// ================================================================== console drawer
let consoleNew = 0;
function log(line) {
  const el = $("console");
  el.textContent += line + "\n";
  if (el.textContent.length > 60000) el.textContent = el.textContent.slice(-45000);
  el.scrollTop = el.scrollHeight;
  if (!$("console-drawer").classList.contains("open")) {
    consoleNew++;
    $("console-new").textContent = consoleNew;
    $("console-new").classList.remove("hidden");
  }
  $("status-msg").textContent = line.length > 140 ? line.slice(0, 140) + "…" : line;
}
function toggleConsole(open) {
  const d = $("console-drawer");
  const o = open ?? !d.classList.contains("open");
  d.classList.toggle("open", o);
  $("btn-console").firstChild.textContent = o ? "▾ Console " : "▴ Console ";
  if (o) { consoleNew = 0; $("console-new").classList.add("hidden"); $("console").scrollTop = 1e9; }
}
$("btn-console").addEventListener("click", () => toggleConsole());
$("btn-console-close").addEventListener("click", () => toggleConsole(false));
$("btn-console-clear").addEventListener("click", () => { $("console").textContent = ""; });

// ================================================================== theme
function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  liveGroup.dirty = true;
  batchGroup.dirty = true;
  roadDirty = true;
  redrawAll();
  redrawDiagrams();
  for (const m of liveGroup.markers) m.color = getComputedStyle(document.documentElement).getPropertyValue("--bad").trim();
}
$("btn-theme").addEventListener("click", () => {
  prefs.theme = prefs.theme === "dark" ? "light" : "dark";
  savePrefs(); applyTheme();
});

// ================================================================== views
// 3d / plots are the two main windows (with the live controls at the side);
// params / jobs are full-width pages.
const VIEWS = ["3d", "plots", "diagrams", "analysis", "params", "jobs"];
function showView(v) {
  if (!VIEWS.includes(v)) v = "plots";
  prefs.view = v; savePrefs();
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.id === "view-" + v));
  $("workspace").classList.toggle("with-side", prefs.side && (v === "3d" || v === "plots"));
  if (v === "plots") liveGroup.dirty = true;
  if (v === "jobs") { batchGroup.dirty = true; loadBatchList(); }
  if (v === "analysis") requestAnimationFrame(redrawAll);
  if (v === "diagrams") requestAnimationFrame(() => { redrawDiagrams(); diagramsTick(true); });
  roadDirty = true;
}
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
$("btn-side").addEventListener("click", () => {
  prefs.side = !prefs.side; savePrefs(); showView(prefs.view);
});

// keyboard shortcuts (not while typing)
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea, dialog") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === " ") { e.preventDefault(); togglePause(); }
  else if (e.key === "r" || e.key === "R") safe(() => POST("/api/run/restart"));
  else if (e.key === "c" || e.key === "C") $("btn-side").click();
  else if (e.key >= "1" && e.key <= "6") showView(VIEWS[+e.key - 1]);
  else if (e.key === "`") toggleConsole();
});

// ================================================================== config
let config = null;                       // {path, sections: {sec: {key: {value, type, comment, choices}}}}
const PRESET_DESC = {
  T0: "Linearity: set speed 30 → 30.5 m/s at 5 s, no leader (40 s)",
  S1: "Cruise step: set speed 20 → 30 m/s at 5 s, no leader (60 s)",
  S2: "Steady following at 25 m/s (60 s)",
  S3: "Leader brakes −1 m/s² from 10 s, 30 → 20 m/s (60 s)",
  S4: "Leader accelerates to 30 m/s, target lost at 40 s, set speed 28 (80 s)",
  S5: "Leader brakes −3 m/s² to a standstill (40 s)",
  S6: "Cut-in 20 m ahead at 10 s, leader at 22 m/s (40 s)",
  custom: "Uses the [scenario] fields of the Parameters page",
};
const cfgVal = (sec, key, def) => config?.sections?.[sec]?.[key]?.value ?? def;

async function loadConfig() {
  config = await GET("/api/config");
  buildParamsForm();
  buildRuntimeList();
  syncRunBar();
  syncLiveControls();
}

// ================================================================== run bar
function syncRunBar() {
  const sel = $("sel-preset");
  const p = config.sections.scenario.preset;
  const choices = p.choices || ["T0", "S1", "S2", "S3", "S4", "S5", "S6", "custom"];
  sel.innerHTML = "";
  for (const c of choices) sel.add(new Option(c, c, false, c === p.value));
  $("preset-desc").textContent = PRESET_DESC[p.value] || "";
  $("preset-desc").title = PRESET_DESC[p.value] || "";
  $("chk-endless").checked = cfgVal("simulation", "endless", "false") === "true";
  const rf = cfgVal("runtime", "realtime_factor", cfgVal("simulation", "realtime_factor", "1"));
  const s = $("sel-speed");
  if (![...s.options].some((o) => +o.value === +rf)) s.add(new Option(`${+rf}×`, String(+rf)));
  s.value = [...s.options].find((o) => +o.value === +rf).value;
}

$("sel-preset").addEventListener("change", (e) => safe(async () => {
  await PUT("/api/config", { changes: { scenario: { preset: e.target.value } } });
  toast(`Scenario ${e.target.value} saved: press Start or Restart`);
  await loadConfig();
}));
$("chk-endless").addEventListener("change", (e) => safe(async () => {
  await PUT("/api/config", { changes: { simulation: { endless: e.target.checked } } });
  toast(e.target.checked ? "Endless on: press Start or Restart" : "Endless off");
  await loadConfig();
}));
$("sel-speed").addEventListener("change", (e) =>
  safe(() => PUT("/api/runtime", { realtime_factor: +e.target.value })));

$("btn-start").addEventListener("click", () => safe(() => POST("/api/run/start", { fast: false })));
$("btn-fast").addEventListener("click", () => safe(async () => {
  if (cfgVal("simulation", "endless", "false") === "true") {
    toast("Endless runs are always in real time: turn Endless off for a fast run", true);
    return;
  }
  await POST("/api/run/start", { fast: true });
}));
$("btn-stop").addEventListener("click", () => safe(() => POST("/api/run/stop")));
$("btn-restart").addEventListener("click", () => safe(() => POST("/api/run/restart")));
$("btn-pause").addEventListener("click", togglePause);
function togglePause() {
  if (status.state !== "running" && status.state !== "paused") return;
  safe(() => PUT("/api/runtime", { pause: status.state !== "paused" }));
}

// ================================================================== live controls
// Each .slider div becomes: label, number box, range, optional "from scenario"
// box. Changes go to [runtime] and apply within 0.1 s.
const sliders = {};
const lastSent = {};                     // avoid sending the same value twice

function sendRuntime(key, value) {
  if (lastSent[key] === value) return;
  lastSent[key] = value;
  if (key === "grade") return safe(() => PUT("/api/runtime", { beta: Math.atan(value / 100) }));
  return safe(async () => {
    const r = await PUT("/api/runtime", { [key]: value });
    if (config) { config.sections.runtime = r.runtime; buildRuntimeList(); markOverrides(); }
  });
}

document.querySelectorAll(".slider").forEach((div) => {
  const d = div.dataset;
  div.innerHTML = `
    <div class="top"><span>${d.label}</span>
      <span><input type="number" min="${d.min}" max="${d.max}" step="${d.step}"> <span class="unit">${d.unit}</span></span></div>
    <input type="range" min="${d.min}" max="${d.max}" step="${d.step}">
    ${d.scenario ? '<label class="scn"><input type="checkbox"> from scenario</label>' : ""}`;
  const num = div.querySelector("input[type=number]");
  const rng = div.querySelector("input[type=range]");
  const scn = div.querySelector(".scn input");
  const s = { div, num, rng, scn, key: d.key };
  sliders[d.key] = s;

  const set = (v) => { num.value = v; rng.value = v; };
  s.set = set;
  rng.addEventListener("input", () => { num.value = rng.value; if (d.key === "h" || d.key === "d0") updateGapHint(); });
  rng.addEventListener("change", () => commit(+rng.value));
  num.addEventListener("change", () => {
    if (num.value === "" || !isFinite(+num.value)) { num.value = rng.value; return; }
    const v = +num.value;            // the box may go beyond the slider range
    rng.value = v; commit(v);
  });
  function commit(v) {
    if (scn) { scn.checked = false; div.classList.remove("from-scenario"); }
    sendRuntime(d.key, v);
    if (d.key === "h" || d.key === "d0") updateGapHint();
  }
  if (scn) scn.addEventListener("change", () => {
    div.classList.toggle("from-scenario", scn.checked);
    sendRuntime(d.key, scn.checked ? "scenario" : +rng.value);
  });
});

function syncLiveControls() {
  const rt = (k) => cfgVal("runtime", k);
  const ctrl = (k, def) => rt(k) ?? cfgVal("controller", k, def);
  sliders.d_set.set(+ctrl("d_set", 30));
  sliders.h.set(+ctrl("h", 1.8));
  sliders.d0.set(+ctrl("d0", 5));
  sliders.lambda.set(+ctrl("lambda", 0.4));
  sliders.k_p.set(+ctrl("k_p", 0.75));
  sliders.k_i.set(+ctrl("k_i", 0.1875));
  const beta = +(rt("beta") ?? cfgVal("environment", "beta", 0));
  sliders.grade.set(+(Math.tan(beta) * 100).toFixed(1));

  for (const [k, def] of [["v_set", cfgVal("scenario", "v_set", 30)], ["leader_accel", 0]]) {
    const v = rt(k);
    const fromScn = v === undefined || v === "scenario";
    sliders[k].set(fromScn ? +def : +v);
    sliders[k].scn.checked = fromScn;
    sliders[k].div.classList.toggle("from-scenario", fromScn);
  }
  setSpacingUI(ctrl("spacing", "time_gap"));
  updateGapHint();
  markOverrides();
}

// dot next to the sliders whose value is a live override
function markOverrides() {
  const rt = config?.sections?.runtime || {};
  for (const [k, s] of Object.entries(sliders)) {
    const key = k === "grade" ? "beta" : k;
    const v = rt[key]?.value;
    s.div.classList.toggle("changed", v !== undefined && v !== "scenario");
  }
}

function setSpacingUI(mode) {
  document.querySelectorAll("#seg-spacing button").forEach((b) =>
    b.classList.toggle("on", b.dataset.value === mode));
  $("box-fixed").style.display = mode === "fixed" ? "" : "none";
  $("box-gap").style.display = mode === "fixed" ? "none" : "";
}
document.querySelectorAll("#seg-spacing button").forEach((b) => b.addEventListener("click", () => {
  setSpacingUI(b.dataset.value);
  sendRuntime("spacing", b.dataset.value);
}));
function updateGapHint() {
  const h = +sliders.h.num.value, d0 = +sliders.d0.num.value;
  $("gap-hint").textContent = `d_ref = ${d0} + ${h}·v  →  ${(d0 + h * 20).toFixed(0)} m at 20 m/s, ` +
    `${(d0 + h * 30).toFixed(0)} m at 30 m/s`;
}

$("btn-reset-live").addEventListener("click", () => safe(async () => {
  // overrides back to the scenario; gains and distance back to the [controller] values
  for (const k of Object.keys(lastSent)) delete lastSent[k];
  const c = (k) => +cfgVal("controller", k);
  await PUT("/api/runtime", {
    v_set: "scenario", leader_accel: "scenario",
    d_set: c("d_set"), h: c("h"), d0: c("d0"), lambda: c("lambda"),
    k_p: c("k_p"), k_i: c("k_i"), spacing: cfgVal("controller", "spacing", "time_gap"),
    beta: +cfgVal("environment", "beta", 0),
  });
  await loadConfig();
  toast("Live controls back to the scenario and [controller] values");
}));

// accordion state
document.querySelectorAll("details.acc").forEach((d) => {
  if (prefs.acc[d.dataset.acc] === false) d.open = false;
  d.addEventListener("toggle", () => { prefs.acc[d.dataset.acc] = d.open; savePrefs(); });
});

// vehicles shown
function syncLanes() {
  document.querySelectorAll("#seg-lanes button").forEach((b) =>
    b.classList.toggle("on", prefs.lanes.includes(b.dataset.value)));
  liveGroup.lanes = prefs.lanes; batchGroup.lanes = LANES;
  liveGroup.dirty = true; roadDirty = true;
  renderReadoutsFrame();
}
document.querySelectorAll("#seg-lanes button").forEach((b) => b.addEventListener("click", () => {
  const l = b.dataset.value;
  const set = new Set(prefs.lanes);
  set.has(l) ? set.delete(l) : set.add(l);
  if (!set.size) return toast("Keep at least one vehicle shown", true);
  prefs.lanes = LANES.filter((x) => set.has(x));
  savePrefs(); syncLanes();
}));

// ================================================================== live data (WebSocket)
let columns = [], rows = [], meta = {}, status = {};
const MAX_ROWS = 30000;                   // 10 min at 50 Hz (same as the server)
let roadDirty = true;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const conn = $("conn");
  ws.onopen = () => { conn.className = "conn ok"; conn.lastChild.textContent = "connected"; };
  ws.onclose = () => {
    conn.className = "conn bad"; conn.lastChild.textContent = "reconnecting";
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case "snapshot":
        columns = m.columns; rows = m.rows; meta = m.meta; resetCollisions(); showStatus(m.status);
        newData(true); break;
      case "header":
        columns = m.columns; rows = []; meta = m.meta; resetCollisions();
        log(`[run] new run ${m.run_id}`);
        liveGroup.resetView(); newData(true); break;
      case "rows":
        for (const r of m.rows) rows.push(r);
        if (rows.length > MAX_ROWS * 1.1) rows.splice(0, rows.length - MAX_ROWS);
        newData(false); break;
      case "status": showStatus(m); break;
      case "console": log(`[${m.source}] ${m.line}`); break;
      case "console_history": m.lines.forEach(log); break;
      case "error": log("[error] " + m.message); break;
    }
  };
}

function newData(structural) {
  liveGroup.dirty = true; roadDirty = true; readoutsDirty = true;
  if (structural) renderReadoutsFrame();
  detectCollisions();
}

// ------------------------------------------------------------------ collisions
// From the <lane>_collided column: time of first contact and closing speed.
// The simulator freezes a lane at contact when simulation.on_collision =
// stop_lane (the default), so its values stay at the instant of impact.
let collisions = {};                      // {lane: {t, v, stopped}}
let collisionHidden = false;
function resetCollisions() {
  collisions = {}; collisionHidden = false;
  liveGroup.markers = [];
  showCollisionBanner();
}
function detectCollisions() {
  if (!rows.length) return;
  const idx = Object.fromEntries(columns.map((n, i) => [n, i]));
  const last = rows[rows.length - 1];
  let added = false;
  for (const l of LANES) {
    const ci = idx[`${l}_collided`];
    if (ci === undefined || collisions[l] || !(last[ci] > 0.5)) continue;
    let k = rows.length - 1;                       // first row with the flag set
    while (k > 0 && rows[k - 1][ci] > 0.5) k--;
    const r = rows[k];
    collisions[l] = {
      t: r[0],
      v: (r[idx[`${l}_v`]] ?? 0) - (r[idx[`${l}_lead_v`]] ?? 0),
      stopped: cfgVal("simulation", "on_collision", "stop_lane") !== "continue",
    };
    added = true;
  }
  if (!added) return;
  liveGroup.markers = Object.entries(collisions).map(([l, c]) =>
    ({ t: c.t, label: `${LANE_NAME[l]} collision`, color: getComputedStyle(document.documentElement).getPropertyValue("--bad").trim() }));
  liveGroup.dirty = true; roadDirty = true; readoutsDirty = true;
  showCollisionBanner();
}
function showCollisionBanner() {
  const lanes = Object.keys(collisions);
  $("collision-banner").classList.toggle("hidden", !lanes.length || collisionHidden);
  $("collision-text").innerHTML = lanes.map((l) => {
    const c = collisions[l];
    return `<div>COLLISION · ${LANE_NAME[l]} hit the car ahead at t = ${c.t.toFixed(2)} s` +
      `<small>closing speed ${c.v.toFixed(1)} m/s (${(c.v * 3.6).toFixed(0)} km/h) · ` +
      `${c.stopped ? "this lane is stopped" : "simulation continued (on_collision = continue)"}</small></div>`;
  }).join("");
}
$("btn-coll-hide").addEventListener("click", () => { collisionHidden = true; showCollisionBanner(); });
$("btn-coll-restart").addEventListener("click", () => safe(() => POST("/api/run/restart")));

function showStatus(s) {
  if (!s || !s.state) return;
  status = s;
  const st = $("st-state");
  st.textContent = s.state;
  st.className = "badge " + ({ running: "ok", paused: "warn", error: "bad", collision: "bad", done: "accent" }[s.state] || "");
  $("st-bar").parentElement.classList.toggle("bad", s.state === "collision" || /\S/.test(s.collided || ""));
  const dur = +s.duration;
  $("st-time").textContent = `t = ${(+s.t || 0).toFixed(1)} s` + (dur > 0 ? ` / ${dur.toFixed(0)} s` : " · endless");
  const bar = $("st-bar");
  bar.parentElement.classList.toggle("endless", !(dur > 0) && s.state === "running");
  bar.style.width = dur > 0 ? `${Math.min(100, 100 * (+s.t || 0) / dur)}%` : "0";
  const extra = [`run ${s.run_id ?? "–"}`, s.realtime_factor ? `${s.realtime_factor}×` : "fast"];
  if (+s.lag > 0.05) extra.push(`lag ${(+s.lag).toFixed(2)} s`);
  $("st-extra").textContent = extra.join(" · ");
  $("st-extra").title = s.message || "";
  $("btn-pause").textContent = s.state === "paused" ? "▶ Resume" : "❚❚ Pause";
  $("btn-pause").disabled = !(s.state === "running" || s.state === "paused");
}

// ================================================================== plots view
const liveGroup = new ChartGroup(() => ({ columns, rows }), { live: true });
const batchGroup = new ChartGroup(() => batchData, { live: false });
let batchData = { columns: [], rows: [] };

liveGroup.onViewChange = () => {
  $("btn-follow").classList.toggle("on", liveGroup.follow);
  $("btn-follow").textContent = liveGroup.follow ? "● Live" : "❚❚ Zoomed: back to live";
};

function buildCharts() {
  liveGroup.clear();
  const grid = $("chart-grid");
  grid.style.setProperty("--cols", prefs.cols);
  prefs.charts.forEach((spec, i) => {
    const p = new ChartPanel(grid, spec, {
      onEdit: (panel) => editChart(prefs.charts.indexOf(panel.spec), panel),
      onRemove: (panel) => {
        prefs.charts = prefs.charts.filter((s) => s !== panel.spec);
        savePrefs(); buildCharts();
      },
    });
    liveGroup.add(p);
    void i;
  });
}

function setSeg(id, value) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.value === String(value)));
}
document.querySelectorAll("#seg-window button").forEach((b) => b.addEventListener("click", () => {
  prefs.window = b.dataset.value === "Infinity" ? Infinity : +b.dataset.value;
  liveGroup.window = prefs.window; savePrefs(); setSeg("seg-window", b.dataset.value);
  liveGroup.resetView();
}));
document.querySelectorAll("#seg-cols button").forEach((b) => b.addEventListener("click", () => {
  prefs.cols = +b.dataset.value; savePrefs(); setSeg("seg-cols", prefs.cols);
  $("chart-grid").style.setProperty("--cols", prefs.cols); liveGroup.dirty = true;
}));
$("btn-follow").addEventListener("click", () => liveGroup.resetView());
$("btn-add-chart").addEventListener("click", () => editChart(-1));
$("btn-reset-layout").addEventListener("click", () => {
  prefs.charts = structuredClone(DEFAULT_CHARTS); prefs.cols = 2;
  savePrefs(); setSeg("seg-cols", 2); buildCharts();
});

// road camera
document.querySelectorAll("#seg-camera button").forEach((b) => b.addEventListener("click", () => {
  prefs.camera = b.dataset.value; savePrefs(); syncCamera();
}));
$("rng-span").addEventListener("input", (e) => { prefs.span = +e.target.value; savePrefs(); syncCamera(); });
function syncCamera() {
  setSeg("seg-camera", prefs.camera);
  $("rng-span").value = prefs.span;
  $("span-val").textContent = `${prefs.span} m`;
  $("span-box").style.opacity = prefs.camera === "fit" ? 0.4 : 1;
  roadDirty = true;
}

// CSV of the current run (what this browser holds)
$("btn-csv").addEventListener("click", () => {
  if (!rows.length) return toast("No data yet", true);
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(r.map((v) => (v == null ? "" : v)).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ktrl_run${status.run_id ?? ""}_${meta.scenario || "run"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// ------------------------------------------------------------------ chart editor
function editChart(index, panel, group = liveGroup) {
  const dlg = $("dlg-chart");
  const spec = index >= 0 ? (panel?.spec ?? prefs.charts[index]) : { title: "New chart", sigs: ["v"] };
  $("dlg-title").textContent = index >= 0 ? "Edit chart" : "Add a chart";
  $("dlg-name").value = spec.title;
  $("dlg-zero").checked = !!spec.zero;
  const have = signalsIn(group.source().columns);
  const known = have.length ? have : Object.keys(SIGNALS);
  const chosen = new Set(spec.sigs);
  const box = $("dlg-sigs");
  box.innerHTML = "";
  const groups = {};
  for (const s of known) (groups[sigInfo(s).group] ??= []).push(s);
  for (const gname of [...GROUP_ORDER, ...Object.keys(groups).filter((g) => !GROUP_ORDER.includes(g))]) {
    if (!groups[gname]) continue;
    const g = document.createElement("div");
    g.className = "sig-group";
    g.innerHTML = `<b>${gname}</b><div class="chips"></div>`;
    for (const s of groups[gname]) {
      const info = sigInfo(s);
      const c = document.createElement("span");
      c.className = "chip" + (chosen.has(s) ? " on" : "");
      c.title = info.label + (info.unit ? ` [${info.unit}]` : "");
      c.textContent = s + (info.unit ? `  ·  ${info.unit}` : "");
      c.addEventListener("click", () => {
        chosen.has(s) ? chosen.delete(s) : chosen.add(s);
        c.classList.toggle("on", chosen.has(s));
      });
      g.lastChild.appendChild(c);
    }
    box.appendChild(g);
  }
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok") return;
    if (!chosen.size) return toast("Choose at least one signal", true);
    const order = known.filter((s) => chosen.has(s));
    const next = { title: $("dlg-name").value.trim() || order.join(", "), sigs: order, zero: $("dlg-zero").checked };
    if (group === batchGroup) { panel.setSpec(next); return; }
    if (index >= 0) prefs.charts[index] = next; else prefs.charts.push(next);
    savePrefs(); buildCharts();
  };
  dlg.returnValue = "";
  dlg.showModal();
}

// ================================================================== 3D view readouts
let readoutsDirty = true;
const READOUT = [
  ["v", "speed", "m/s"], ["a", "accel.", "m/s²"], ["v_set", "set speed", "m/s"],
  ["d", "distance", "m"], ["d_ref", "target", "m"], ["e_s", "spacing err.", "m"],
  ["F_t", "traction", "N"], ["F_b", "brake", "N"], ["lead_v", "leader", "m/s"],
];
function renderReadoutsFrame() {
  const box = $("readouts");
  if (!box) return;                      // the 3D view replaced the readouts
  const lanes = prefs.lanes.filter((l) => columns.includes(l + "_v"));
  box.innerHTML = lanes.map((l) => `
    <div class="readout" data-lane="${l}">
      <div class="rh"><i style="background:var(--${l})"></i>${LANE_NAME[l]}
        <span class="badge" data-k="mode">–</span></div>
      <dl>${READOUT.map(([k, lbl, u]) => `<div><dt>${lbl} <small>${u}</small></dt><dd data-k="${k}">–</dd></div>`).join("")}</dl>
    </div>`).join("") || '<div class="readout muted">No data yet: press Start.</div>';
  readoutsDirty = true;
}
function updateReadouts() {
  if (!readoutsDirty || !rows.length) return;
  readoutsDirty = false;
  const last = rows[rows.length - 1];
  const idx = Object.fromEntries(columns.map((n, i) => [n, i]));
  document.querySelectorAll(".readout[data-lane]").forEach((el) => {
    const l = el.dataset.lane;
    const val = (k) => last[idx[`${l}_${k}`]];
    const leadOn = val("lead_on") > 0.5, target = val("target") > 0.5;
    for (const [k] of READOUT) {
      const dd = el.querySelector(`[data-k="${k}"]`);
      let v = val(k);
      if ((k === "d" || k === "lead_v") && !leadOn) v = null;
      if ((k === "d_ref" || k === "e_s") && !target) v = null;
      dd.textContent = v == null ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
    }
    const m = el.querySelector('[data-k="mode"]');
    const follow = val("mode") > 0.5;
    m.textContent = val("collided") > 0.5 ? "COLLISION" : follow ? "distance loop" : "speed loop";
    m.className = "badge " + (val("collided") > 0.5 ? "bad" : follow ? "accent" : "ok");
    el.classList.toggle("collided", val("collided") > 0.5);
  });
}

// ================================================================== parameters page
const edits = {};                        // {section: {key: value}}
const collapsed = new Set(JSON.parse(localStorage.getItem("ktrl.params.collapsed") || "[]"));

function buildParamsForm() {
  const form = $("params-form");
  form.innerHTML = "";
  $("params-path").textContent = config.path;
  for (const [sec, keys] of Object.entries(config.sections)) {
    if (sec === "runtime") continue;
    const card = document.createElement("div");
    card.className = "card psec" + (collapsed.has(sec) ? " collapsed" : "");
    card.dataset.sec = sec;
    card.innerHTML = `<div class="card-head"><h3>[${sec}]</h3><div class="spacer"></div>
      <span class="badge tiny hidden"></span><span class="muted">${collapsed.has(sec) ? "▸" : "▾"}</span></div>
      <div class="prows"></div>`;
    card.querySelector(".card-head").addEventListener("click", () => {
      card.classList.toggle("collapsed");
      card.querySelector(".card-head .muted").textContent = card.classList.contains("collapsed") ? "▸" : "▾";
      card.classList.contains("collapsed") ? collapsed.add(sec) : collapsed.delete(sec);
      try { localStorage.setItem("ktrl.params.collapsed", JSON.stringify([...collapsed])); } catch { /* */ }
    });
    const box = card.querySelector(".prows");
    for (const [key, f] of Object.entries(keys)) box.appendChild(paramRow(sec, key, f));
    form.appendChild(card);
  }
  filterParams();
  updateDirty();
}

// keys the live controls may override ([runtime] key -> [section] key)
const OVERRIDES = { controller: ["k_p", "k_i", "h", "lambda", "d0", "d_set", "spacing"],
                    environment: ["beta"], scenario: ["v_set"], simulation: ["realtime_factor"] };

function paramRow(sec, key, f) {
  const row = document.createElement("div");
  row.className = "prow";
  row.dataset.search = `${sec} ${key} ${f.comment || ""}`.toLowerCase();
  const pending = edits[sec]?.[key];
  let input;
  if (f.type === "choice") {
    input = document.createElement("select");
    for (const c of f.choices) input.add(new Option(c, c, false, c === (pending ?? f.value)));
  } else if (f.type === "bool") {
    const lbl = document.createElement("label");
    lbl.className = "switch";
    lbl.innerHTML = '<input type="checkbox"><i></i>';
    input = lbl.querySelector("input");
    input.checked = String(pending ?? f.value) === "true";
    row.innerHTML = `<label title="${sec}.${key}">${key}</label>`;
    row.appendChild(lbl);
  } else {
    input = document.createElement("input");
    input.value = pending ?? f.value;
    input.spellcheck = false;
  }
  if (f.type !== "bool") {
    row.innerHTML = `<label title="${sec}.${key}">${key}</label>`;
    row.appendChild(input);
  }
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = f.comment || "";
  hint.title = f.comment || "";
  row.appendChild(hint);
  if (pending !== undefined) row.classList.add("dirty");
  const rtKey = OVERRIDES[sec]?.includes(key) ? key : null;
  const rtv = rtKey ? config.sections.runtime?.[rtKey]?.value : undefined;
  if (rtv !== undefined && rtv !== "scenario") {
    row.classList.add("overridden");
    row.title = `Overridden live: [runtime] ${rtKey} = ${rtv}`;
  }

  input.addEventListener(f.type === "bool" || f.type === "choice" ? "change" : "input", () => {
    const v = f.type === "bool" ? input.checked : input.value.trim();
    const bad = f.type === "number" && (v === "" || !isFinite(Number(v)));
    row.classList.toggle("invalid", bad);
    const original = f.type === "bool" ? f.value === "true" : f.value;
    edits[sec] ??= {};
    if (String(v) === String(original)) delete edits[sec][key];
    else edits[sec][key] = v;
    if (!Object.keys(edits[sec]).length) delete edits[sec];
    row.classList.toggle("dirty", edits[sec]?.[key] !== undefined);
    updateDirty();
  });
  return row;
}

function filterParams() {
  const q = $("params-search").value.trim().toLowerCase();
  document.querySelectorAll(".psec").forEach((card) => {
    let n = 0;
    card.querySelectorAll(".prow").forEach((r) => {
      const hit = !q || r.dataset.search.includes(q);
      r.style.display = hit ? "" : "none";
      n += hit;
    });
    card.style.display = n ? "" : "none";
    if (q && n) card.classList.remove("collapsed");
  });
}
$("params-search").addEventListener("input", filterParams);

function updateDirty() {
  const n = Object.values(edits).reduce((a, s) => a + Object.keys(s).length, 0);
  const b = $("params-dirty");
  b.textContent = n ? `${n} unsaved change${n > 1 ? "s" : ""}` : "no changes";
  b.className = "badge" + (n ? " warn" : "");
  ["btn-discard", "btn-validate", "btn-save", "btn-save-restart"].forEach((id) => ($(id).disabled = !n));
  document.querySelectorAll(".psec").forEach((card) => {
    const k = Object.keys(edits[card.dataset.sec] || {}).length;
    const badge = card.querySelector(".card-head .badge");
    badge.textContent = k; badge.classList.toggle("hidden", !k); badge.classList.toggle("warn", !!k);
  });
}
function showResult(text, bad) {
  const el = $("params-result");
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("bad", bad);
  el.classList.toggle("good", !bad);
}

$("btn-discard").addEventListener("click", () => {
  for (const k of Object.keys(edits)) delete edits[k];
  $("params-result").classList.add("hidden");
  buildParamsForm();
});
$("btn-validate").addEventListener("click", () => safe(async () => {
  const r = await POST("/api/config/validate", { changes: edits });
  showResult(r.ok ? "OK: the simulator accepts these values.\n\n" + r.output : r.output, !r.ok);
}));
async function save(restart) {
  try {
    const r = await PUT("/api/config", { changes: edits, check: true });
    for (const k of Object.keys(edits)) delete edits[k];
    showResult(r.message, false);
    await loadConfig();
    if (restart) { await POST("/api/run/restart"); toast("Saved and restarted"); }
    else toast("Saved");
  } catch (e) {
    showResult(e.message, true);
  }
}
$("btn-save").addEventListener("click", () => save(false));
$("btn-save-restart").addEventListener("click", () => save(true));

// ------------------------------------------------------------------ [runtime] overrides
const RT_FIXED = new Set(["pause", "stop", "restart_id"]);
function buildRuntimeList() {
  const box = $("runtime-list");
  const rt = config.sections.runtime || {};
  const keys = Object.keys(rt).filter((k) => !RT_FIXED.has(k));
  box.innerHTML = keys.length ? "" : '<span class="muted small">None: the run uses the values below.</span>';
  for (const k of keys) {
    const c = document.createElement("span");
    c.className = "chip on";
    let v = rt[k].value;
    if (k === "beta") v = `${v} rad (${(Math.tan(+v) * 100).toFixed(1)} %)`;
    c.innerHTML = `<b class="mono">${k}</b> = <span class="mono">${v}</span> <span class="x" title="Remove">✕</span>`;
    c.querySelector(".x").addEventListener("click", () => safe(async () => {
      delete lastSent[k === "beta" ? "grade" : k];
      await PUT("/api/runtime", { [k]: null });
      await loadConfig();
    }));
    box.appendChild(c);
  }
  $("btn-clear-runtime").disabled = !keys.length;
}
$("btn-clear-runtime").addEventListener("click", () => safe(async () => {
  const rt = config.sections.runtime || {};
  const body = Object.fromEntries(Object.keys(rt).filter((k) => !RT_FIXED.has(k)).map((k) => [k, null]));
  for (const k of Object.keys(lastSent)) delete lastSent[k];
  await PUT("/api/runtime", body);
  await loadConfig();
  toast("Live overrides cleared");
}));

// ================================================================== tests & batch page
const PRESETS = ["T0", "S1", "S2", "S3", "S4", "S5", "S6"];
for (const p of PRESETS) {
  const c = document.createElement("span");
  c.className = "chip on";
  c.dataset.value = p;
  c.textContent = p;
  c.title = PRESET_DESC[p];
  c.addEventListener("click", () => c.classList.toggle("on"));
  $("batch-presets").appendChild(c);
}
async function runJob(btn, url, body) {
  btn.disabled = true;
  const badge = $("job-badge");
  badge.textContent = "running…"; badge.className = "badge warn";
  $("job-output").textContent = "running…";
  try {
    const r = await POST(url, body);
    $("job-output").textContent = `${r.command}\nexit code ${r.returncode} in ${r.seconds} s\n\n${r.output}`;
    badge.textContent = r.returncode === 0 ? "all OK" : `failed (${r.returncode})`;
    badge.className = "badge " + (r.returncode === 0 ? "ok" : "bad");
    if (r.files) showBatchList(r);
  } catch (e) {
    $("job-output").textContent = e.message;
    badge.textContent = "error"; badge.className = "badge bad";
  } finally {
    btn.disabled = false;
  }
}
$("btn-tests").addEventListener("click", (e) => runJob(e.currentTarget, "/api/tests"));
$("btn-batch").addEventListener("click", (e) => {
  const chosen = [...document.querySelectorAll("#batch-presets .chip.on")].map((c) => c.dataset.value);
  if (!chosen.length) return toast("Choose at least one scenario", true);
  runJob(e.currentTarget, "/api/batch", { presets: chosen.length === PRESETS.length ? [] : chosen });
});

async function loadBatchList() { const r = await safe(() => GET("/api/batch")); if (r) showBatchList(r); }
$("btn-batch-refresh").addEventListener("click", loadBatchList);

function showBatchList(r) {
  $("batch-summary").textContent = r.summary || "No batch yet.";
  const failed = new Set();
  for (const line of (r.summary || "").split("\n")) {
    const m = line.match(/^(\S+)\s+(ice|ev)\s.*FAIL/);
    if (m) failed.add(`${m[1]}_${m[2]}.txt`);
  }
  const box = $("batch-files");
  box.innerHTML = "";
  for (const f of r.files) {
    const c = document.createElement("span");
    c.className = "chip" + (failed.has(f) ? " fail" : "") + (f === batchFile ? " on" : "");
    c.textContent = f.replace(".txt", "");
    c.title = failed.has(f) ? "criteria failed" : "";
    c.addEventListener("click", () => openBatchFile(f));
    box.appendChild(c);
  }
}

let batchFile = null;
const BATCH_CHARTS = [
  { title: "Speed", sigs: ["v", "v_set", "lead_v"] },
  { title: "Distance and target distance", sigs: ["d", "d_ref"], zero: true },
  { title: "Acceleration", sigs: ["a", "a_des"] },
];
async function openBatchFile(name) {
  const data = await safe(() => GET(`/api/batch/${name}`));
  if (!data) return;
  batchFile = name;
  batchData = { columns: data.columns, rows: data.rows };
  document.querySelectorAll("#batch-files .chip").forEach((c) => c.classList.toggle("on", c.textContent + ".txt" === name));
  $("batch-view-title").textContent = `Batch run: ${name.replace(".txt", "")}`;
  $("batch-view-hint").textContent = "drag to zoom · double-click for the whole run";
  if (!batchGroup.charts.length) {
    for (const spec of BATCH_CHARTS) {
      batchGroup.add(new ChartPanel($("batch-charts"), structuredClone(spec), {
        onEdit: (panel) => editChart(0, panel, batchGroup),
      }));
    }
  }
  batchGroup.resetView();
}

// ================================================================== render loop
function frame() {
  requestAnimationFrame(frame);
  if (prefs.view === "plots") {
    liveGroup.draw();
    if (roadDirty) {
      roadDirty = false;
      drawRoad($("road"), { columns, row: rows[rows.length - 1], meta, lanes: prefs.lanes,
                            span: prefs.span, camera: prefs.camera, collisions });
    }
  } else if (prefs.view === "3d") {
    view3dTick();
  } else if (prefs.view === "jobs") {
    batchGroup.draw();
  } else if (prefs.view === "diagrams") {
    diagramsTick();
  }
}
new ResizeObserver(() => { roadDirty = true; }).observe($("road"));

// ================================================================== start
applyTheme();
liveGroup.window = prefs.window;
setSeg("seg-window", prefs.window === Infinity || prefs.window === null ? "Infinity" : prefs.window);
if (prefs.window === null) { prefs.window = Infinity; liveGroup.window = Infinity; }   // JSON has no Infinity
setSeg("seg-cols", prefs.cols);
buildCharts();
syncCamera();
syncLanes();
liveGroup.onViewChange();
showView(prefs.view);
safe(loadConfig);
loadPage("./analysis.js", (m) => { redrawAll = m.redrawAll; m.initAnalysis({ POST, toast, cfgVal }); });
loadPage("./view3d.js", (m) => {
  view3dTick = m.tick;
  m.init3D({ getLive: () => ({ columns, rows, meta, status }), POST, PUT, toast, safe, cfgVal,
             reload: loadConfig, getCollisions: () => collisions });
});
loadPage("./diagrams.js", (m) => {
  redrawDiagrams = m.redrawDiagrams; diagramsTick = m.tick;
  m.initDiagrams({ getLive: () => ({ columns, rows, meta, status }) });
});
connect();
frame();
