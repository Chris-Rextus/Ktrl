// Ktrl test page: live run, live parameters, all config parameters, tests/batch.
// Talks to server/app.py: REST for commands, one WebSocket for data.

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ http
async function call(method, url, body) {
  const r = await fetch(url, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    throw new Error(msg);
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
  setTimeout(() => el.remove(), bad ? 7000 : 3000);
}
async function safe(fn) {
  try { return await fn(); } catch (e) { toast(e.message, true); return null; }
}
function log(line) {
  const el = $("console");
  el.textContent += line + "\n";
  if (el.textContent.length > 50000) el.textContent = el.textContent.slice(-40000);
  el.scrollTop = el.scrollHeight;
}

// ------------------------------------------------------------------ tabs
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".tab-page").forEach((p) =>
    p.classList.toggle("active", p.id === "tab-" + b.dataset.tab));
  if (b.dataset.tab === "live") resizeCanvases();
}));

// ------------------------------------------------------------------ config
let config = null;                       // {path, sections: {sec: {key: {value, type, comment, choices}}}}
const PRESET_DESC = {
  T0: "Linearity: set speed 30 → 30.5 m/s at 5 s, no leader (40 s)",
  S1: "Cruise step: set speed 20 → 30 m/s at 5 s, no leader (60 s)",
  S2: "Steady following at 25 m/s (60 s)",
  S3: "Leader brakes −1 m/s² from 10 s, 30 → 20 m/s (60 s)",
  S4: "Leader accelerates to 30 m/s, target lost at 40 s, set speed 28 (80 s)",
  S5: "Leader brakes −3 m/s² to a standstill (40 s)",
  S6: "Cut-in 20 m ahead at 10 s, leader at 22 m/s (40 s)",
  custom: "Uses the [scenario] fields in the Parameters tab",
};
const cfgVal = (sec, key, def) => config?.sections?.[sec]?.[key]?.value ?? def;

async function loadConfig() {
  config = await GET("/api/config");
  buildParamsForm();
  syncRunPanel();
  syncLiveControls();
}

// ------------------------------------------------------------------ run panel
function syncRunPanel() {
  const sel = $("sel-preset");
  const p = config.sections.scenario.preset;
  const choices = p.choices || ["T0", "S1", "S2", "S3", "S4", "S5", "S6", "custom"];
  sel.innerHTML = "";
  for (const c of choices) sel.add(new Option(c, c, false, c === p.value));
  $("preset-desc").textContent = PRESET_DESC[p.value] || "";
  $("chk-endless").checked = cfgVal("simulation", "endless", "false") === "true";
  const rf = cfgVal("runtime", "realtime_factor", cfgVal("simulation", "realtime_factor", "1"));
  $("sel-speed").value = String(+rf);
}

$("sel-preset").addEventListener("change", (e) => safe(async () => {
  await PUT("/api/config", { changes: { scenario: { preset: e.target.value } } });
  $("preset-desc").textContent = PRESET_DESC[e.target.value] || "";
  toast(`Scenario ${e.target.value} saved - press Start or Restart`);
  await loadConfig();
}));
$("chk-endless").addEventListener("change", (e) => safe(async () => {
  await PUT("/api/config", { changes: { simulation: { endless: e.target.checked } } });
  toast(e.target.checked ? "Endless on - press Start or Restart" : "Endless off");
  await loadConfig();
}));
$("sel-speed").addEventListener("change", (e) =>
  safe(() => PUT("/api/runtime", { realtime_factor: +e.target.value })));

$("btn-start").addEventListener("click", () => safe(() => POST("/api/run/start", { fast: false })));
$("btn-stop").addEventListener("click", () => safe(() => POST("/api/run/stop")));
$("btn-restart").addEventListener("click", () => safe(() => POST("/api/run/restart")));
$("btn-pause").addEventListener("click", () =>
  safe(() => PUT("/api/runtime", { pause: status.state !== "paused" })));

// ------------------------------------------------------------------ live controls
// Each .slider div becomes: label, number box, range, optional "from scenario" box.
// Changes go to [runtime] (applied within 0.1 s by the simulator).
const sliders = {};
const lastSent = {};                     // avoid sending the same value twice

function sendRuntime(key, value) {
  if (lastSent[key] === value) return;
  lastSent[key] = value;
  if (key === "grade") return safe(() => PUT("/api/runtime", { beta: Math.atan(value / 100) }));
  return safe(() => PUT("/api/runtime", { [key]: value }));
}

document.querySelectorAll(".slider").forEach((div) => {
  const d = div.dataset;
  div.innerHTML = `
    <div class="top"><span>${d.label}</span>
      <span><input type="number" min="${d.min}" max="${d.max}" step="${d.step}"> ${d.unit}</span></div>
    <input type="range" min="${d.min}" max="${d.max}" step="${d.step}">
    ${d.scenario ? '<label class="scn"><input type="checkbox"> from scenario</label>' : ""}`;
  const num = div.querySelector("input[type=number]");
  const rng = div.querySelector("input[type=range]");
  const scn = div.querySelector(".scn input");
  const s = { div, num, rng, scn, key: d.key };
  sliders[d.key] = s;

  const set = (v) => { num.value = v; rng.value = v; };
  s.set = set;
  rng.addEventListener("input", () => { num.value = rng.value; });
  rng.addEventListener("change", () => commit(+rng.value));
  num.addEventListener("change", () => {
    const v = Math.min(+d.max, Math.max(+d.min, +num.value));
    set(v); commit(v);
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
  const rt = (k) => {
    const v = cfgVal("runtime", k);
    return v === undefined ? undefined : v;
  };
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
  $("gap-hint").textContent = `Target grows with speed: d_ref = ${d0} + ${h}·v → ` +
    `${(d0 + h * 20).toFixed(0)} m at 20 m/s, ${(d0 + h * 30).toFixed(0)} m at 30 m/s`;
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
  toast("Live controls reset to the scenario and [controller] values");
}));

// ------------------------------------------------------------------ parameters tab
// One form field per config key (all sections except [runtime]).
const edits = {};                        // {section: {key: value}}

function buildParamsForm() {
  const form = $("params-form");
  form.innerHTML = "";
  $("params-path").textContent = config.path;
  for (const [sec, keys] of Object.entries(config.sections)) {
    if (sec === "runtime") continue;
    const g = document.createElement("div");
    g.className = "group";
    g.innerHTML = `<h2>[${sec}]</h2>`;
    for (const [key, f] of Object.entries(keys)) g.appendChild(paramRow(sec, key, f));
    form.appendChild(g);
  }
  updateDirty();
}

function paramRow(sec, key, f) {
  const row = document.createElement("div");
  row.className = "prow";
  const pending = edits[sec]?.[key];
  let input;
  if (f.type === "choice") {
    input = document.createElement("select");
    for (const c of f.choices) input.add(new Option(c, c, false, c === (pending ?? f.value)));
  } else if (f.type === "bool") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = (pending ?? f.value) === true || (pending ?? f.value) === "true";
  } else {
    input = document.createElement("input");
    input.value = pending ?? f.value;
  }
  row.innerHTML = `<label title="${sec}.${key}">${key}</label>`;
  row.appendChild(input);
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = f.comment || "";
  hint.title = f.comment || "";
  row.appendChild(hint);
  if (pending !== undefined) row.classList.add("dirty");

  input.addEventListener(f.type === "bool" || f.type === "choice" ? "change" : "input", () => {
    let v = f.type === "bool" ? input.checked : input.value.trim();
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

function updateDirty() {
  const n = Object.values(edits).reduce((a, s) => a + Object.keys(s).length, 0);
  $("params-dirty").textContent = n ? `${n} unsaved change${n > 1 ? "s" : ""}` : "no changes";
  ["btn-discard", "btn-validate", "btn-save", "btn-save-restart"].forEach((id) => ($(id).disabled = !n));
}
function showResult(text, bad) {
  const el = $("params-result");
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("bad", bad);
}

$("btn-discard").addEventListener("click", () => {
  for (const k of Object.keys(edits)) delete edits[k];
  $("params-result").classList.add("hidden");
  buildParamsForm();
});
$("btn-validate").addEventListener("click", () => safe(async () => {
  const r = await POST("/api/config/validate", { changes: edits });
  showResult(r.ok ? "OK - the simulator accepts these values.\n\n" + r.output : r.output, !r.ok);
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

// ------------------------------------------------------------------ jobs tab
const PRESETS = ["T0", "S1", "S2", "S3", "S4", "S5", "S6"];
for (const p of PRESETS) {
  const l = document.createElement("label");
  l.className = "check";
  l.innerHTML = `<input type="checkbox" value="${p}" checked> ${p}`;
  $("batch-presets").appendChild(l);
}
async function runJob(btn, url, body) {
  btn.disabled = true;
  $("job-output").textContent = "running...";
  try {
    const r = await POST(url, body);
    $("job-output").textContent = `${r.command}\nexit code ${r.returncode} in ${r.seconds} s\n\n${r.output}`;
  } catch (e) {
    $("job-output").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}
$("btn-tests").addEventListener("click", (e) => runJob(e.target, "/api/tests"));
$("btn-batch").addEventListener("click", (e) => {
  const chosen = [...document.querySelectorAll("#batch-presets input:checked")].map((i) => i.value);
  runJob(e.target, "/api/batch", { presets: chosen.length === PRESETS.length ? [] : chosen });
});

// ------------------------------------------------------------------ live data (WebSocket)
let columns = [], rows = [], meta = {}, status = {};
const col = (name) => columns.indexOf(name);
const MAX_ROWS = 30000;                   // 10 min at 50 Hz

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { $("conn").textContent = "connected"; $("conn").className = "pill ok"; };
  ws.onclose = () => {
    $("conn").textContent = "disconnected"; $("conn").className = "pill bad";
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case "snapshot": columns = m.columns; rows = m.rows; meta = m.meta; showStatus(m.status); break;
      case "header": columns = m.columns; rows = []; meta = m.meta; log(`[run] new run ${m.run_id}`); break;
      case "rows":
        for (const r of m.rows) rows.push(r);
        if (rows.length > MAX_ROWS * 1.1) rows.splice(0, rows.length - MAX_ROWS);
        break;
      case "status": showStatus(m); break;
      case "console": log(`[${m.source}] ${m.line}`); break;
      case "console_history": m.lines.forEach(log); break;
      case "error": log("[error] " + m.message); break;
    }
  };
}

function showStatus(s) {
  if (!s || !s.state) return;
  status = s;
  const dur = +s.duration > 0 ? ` / ${(+s.duration).toFixed(0)} s` : " (endless)";
  $("state").textContent = `${s.state} · run ${s.run_id} · t = ${(+s.t).toFixed(1)} s${dur} · ${s.realtime_factor}×`;
  $("state").className = "pill" + (s.state === "running" ? " ok" : s.state === "error" ? " bad" : "");
  $("btn-pause").textContent = s.state === "paused" ? "Resume" : "Pause";
}

// ------------------------------------------------------------------ drawing
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const COLORS = {};

function resizeCanvases() {
  for (const c of document.querySelectorAll("canvas")) {
    const w = c.clientWidth;
    if (w > 0 && c.width !== Math.round(w * devicePixelRatio)) {
      c.width = Math.round(w * devicePixelRatio);
      c.height = Math.round(+c.getAttribute("height") * devicePixelRatio);
      c.style.height = c.getAttribute("height") + "px";
    }
  }
}
window.addEventListener("resize", resizeCanvases);

function drawRoad(last) {
  const c = $("road"), g = c.getContext("2d"), k = devicePixelRatio;
  g.setTransform(k, 0, 0, k, 0, 0);
  const W = c.width / k, H = c.height / k;
  g.clearRect(0, 0, W, H);
  const lanes = ["ice", "ev"].filter((p) => col(p + "_x") >= 0);
  if (!lanes.length) return;
  const L = +(meta.L_veh || 4.5);
  const span = 160, sc = W / span;                                   // 160 m visible
  const ref = Math.min(...lanes.map((p) => last[col(p + "_x")])) - 25;
  g.font = "12px system-ui";

  lanes.forEach((p, i) => {
    const y = 55 + i * 85;
    g.fillStyle = "#e9e8e3"; g.fillRect(0, y - 22, W, 44);
    g.strokeStyle = "#fff"; g.setLineDash([12, 12]); g.lineDashOffset = (ref * sc) % 24;
    g.beginPath(); g.moveTo(0, y + 22); g.lineTo(W, y + 22); g.stroke(); g.setLineDash([]);

    const xe = last[col(p + "_x")], xl = last[col(p + "_lead_x")];
    const leadOn = last[col(p + "_lead_on")] > 0.5;
    const d = last[col(p + "_d")], dref = last[col(p + "_d_ref")];
    const mode = last[col(p + "_mode")] > 0.5 ? "FOLLOW (distance)" : "CRUISE (speed)";

    // target distance marker (where the ego front bumper should be)
    if (leadOn && dref > 0) {
      const xt = (xl - L - dref - ref) * sc;
      g.strokeStyle = COLORS.lead; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(xt, y - 22); g.lineTo(xt, y + 22); g.stroke(); g.setLineDash([]);
    }
    // gap bar
    if (leadOn) {
      const tooClose = dref > 0 && d < 0.8 * dref;
      g.fillStyle = tooClose ? "rgba(179,38,30,.25)" : "rgba(47,111,181,.15)";
      g.fillRect((xe - ref) * sc, y - 4, Math.max(0, d) * sc, 8);
    }
    // cars (x = front bumper)
    const brake = last[col(p + "_F_b")] > 50;
    g.fillStyle = p === "ice" ? COLORS.ice : COLORS.ev;
    g.fillRect((xe - L - ref) * sc, y - 9, L * sc, 18);
    if (brake) { g.fillStyle = "#ff3b30"; g.fillRect((xe - L - ref) * sc - 2, y - 9, 3, 18); }
    if (leadOn) {
      g.fillStyle = COLORS.lead;
      g.fillRect((xl - L - ref) * sc, y - 9, L * sc, 18);
    }
    g.fillStyle = "#22221f";
    g.fillText(`${p.toUpperCase()}  v = ${last[col(p + "_v")].toFixed(1)} m/s` +
      (leadOn ? `   d = ${d.toFixed(1)} m (target ${dref.toFixed(1)} m)` : "   no car ahead") +
      `   ${mode}`, 8, y - 28);
  });
}

function drawChart(id, series, yLabelMin, yLabelMax) {
  const c = $(id), g = c.getContext("2d"), k = devicePixelRatio;
  g.setTransform(k, 0, 0, k, 0, 0);
  const W = c.width / k, H = c.height / k, padL = 40, padT = 24, padB = 18;
  g.clearRect(0, 0, W, H);
  if (!rows.length) return;
  const t1 = rows[rows.length - 1][0], t0 = Math.max(rows[0][0], t1 - 30);  // last 30 s
  let lo = Infinity, hi = -Infinity;
  let start = rows.length - 1;
  while (start > 0 && rows[start - 1][0] >= t0) start--;
  for (const s of series) {
    const ci = col(s.name); if (ci < 0) continue;
    for (let i = start; i < rows.length; i++) {
      const v = rows[i][ci]; if (v == null) continue;
      if (s.onlyIf && rows[i][col(s.onlyIf)] < 0.5) continue;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  }
  if (!isFinite(lo)) return;
  if (yLabelMin !== undefined) lo = Math.min(lo, yLabelMin);
  if (yLabelMax !== undefined) hi = Math.max(hi, yLabelMax);
  const pad = (hi - lo) * 0.1 || 1;
  lo = yLabelMin === 0 && lo >= 0 ? 0 : lo - pad;          // distances start at 0
  hi += pad;
  const X = (t) => padL + (t - t0) / Math.max(t1 - t0, 1e-6) * (W - padL - 8);
  const Y = (v) => padT + (hi - v) / (hi - lo) * (H - padT - padB);

  g.strokeStyle = "#ecebe6"; g.fillStyle = "#6b6a64"; g.font = "11px system-ui"; g.lineWidth = 1;
  for (let j = 0; j <= 3; j++) {
    const v = lo + (hi - lo) * j / 3, y = Y(v);
    g.beginPath(); g.moveTo(padL, y); g.lineTo(W - 8, y); g.stroke();
    g.fillText(v.toFixed(Math.abs(hi - lo) < 5 ? 2 : 0), 4, y + 4);
  }
  g.fillText(`${t0.toFixed(0)} s`, padL, H - 4);
  g.fillText(`${t1.toFixed(1)} s`, W - 50, H - 4);

  for (const s of series) {
    const ci = col(s.name); if (ci < 0) continue;
    g.strokeStyle = s.color; g.lineWidth = s.width || 1.5; g.setLineDash(s.dash ? [5, 4] : []);
    g.beginPath();
    let pen = false;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i], v = r[ci];
      if (v == null || (s.onlyIf && r[col(s.onlyIf)] < 0.5)) { pen = false; continue; }
      pen ? g.lineTo(X(r[0]), Y(v)) : g.moveTo(X(r[0]), Y(v)); pen = true;
    }
    g.stroke();
  }
  g.setLineDash([]);
}

function draw() {
  requestAnimationFrame(draw);
  if (!$("tab-live").classList.contains("active") || !rows.length || !columns.length) return;
  const last = rows[rows.length - 1];
  drawRoad(last);
  const lanes = ["ice", "ev"].filter((p) => col(p + "_x") >= 0);
  const colorOf = (p) => (p === "ice" ? COLORS.ice : COLORS.ev);
  drawChart("ch-speed", [
    { name: (lanes[0] || "ice") + "_lead_v", color: COLORS.lead, onlyIf: (lanes[0] || "ice") + "_lead_on" },
    { name: (lanes[0] || "ice") + "_v_set", color: COLORS.lead, dash: true, width: 1 },
    ...lanes.map((p) => ({ name: p + "_v", color: colorOf(p) })),
  ]);
  drawChart("ch-dist", [
    ...lanes.map((p) => ({ name: p + "_d_ref", color: colorOf(p), dash: true, width: 1, onlyIf: p + "_target" })),
    ...lanes.map((p) => ({ name: p + "_d", color: colorOf(p), onlyIf: p + "_lead_on" })),
  ], 0);
  drawChart("ch-acc", [
    ...lanes.map((p) => ({ name: p + "_a_des", color: colorOf(p), dash: true, width: 1 })),
    ...lanes.map((p) => ({ name: p + "_a", color: colorOf(p) })),
  ], -1, 1);
}

// ------------------------------------------------------------------ start
COLORS.ice = css("--ice"); COLORS.ev = css("--ev"); COLORS.lead = css("--lead");
resizeCanvases();
safe(loadConfig);
connect();
draw();