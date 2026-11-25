// view3d.js - the 3D window: one car (ICE or EV) and its leader on a divided
// highway, driven live by the simulation stream.
//
//   cameras   oblique (default), side, chase, driver, top, orbit, director
//   world     time of day (0-24 h, time-lapse), weather (clear, cloudy, rain,
//             fog, snow), traffic, train, turbines, city, mountains ...
//   cars      detailed bodies with interior, suspension pitch, spinning wheels,
//             brake-disc heat, lights (head, DRL, tail, brake, hazards),
//             crumple zones, airbag
//   effects   sparks, debris, smoke, tyre smoke, skid marks, exhaust, rain,
//             snow, headlight beams, wet reflections, bloom, lens flare
//   playback  live / pause / scrub / speed, slow-motion impact replay
//   overlays  gap band, target gate, radar fan + lock, labels, HUD, VMS signs
//
// Positions come from <lane>_x (ego front bumper) and <lane>_lead_x (leader
// front bumper); everything is drawn relative to the ego (floating origin).

import { M4, Renderer, lin, Geo, cylGeo, sphereGeo, boxGeo } from "./gl3d.js";
import * as MD from "./models3d.js";
import { World, makeEnv, LAYOUT } from "./world3d.js";
import { FX } from "./fx3d.js";
import { Sound } from "./audio3d.js";

const $ = (id) => document.getElementById(id);
const SCENARIOS = ["T0", "S1", "S2", "S3", "S4", "S5", "S6", "custom"];
const SCN_DESC = {
  T0: "Linearity: set speed 30 → 30.5 m/s, no leader", S1: "Cruise step 20 → 30 m/s, no leader",
  S2: "Steady following at 25 m/s", S3: "Leader brakes −1 m/s², 30 → 20 m/s",
  S4: "Leader accelerates, target lost at 40 s", S5: "Leader brakes −3 m/s² to a standstill",
  S6: "Cut-in 20 m ahead at 10 s", custom: "The [scenario] fields of the Parameters page",
};
const PAINT = { ice: "#e8732a", ev: "#1fae8a", lead: "#a3adb9" };
const NAME = { ice: "ICE", ev: "EV" };
const CAMS = [["oblique", "Oblique"], ["side", "Side"], ["chase", "Chase"], ["driver", "Driver"], ["top", "Top"], ["orbit", "Orbit"], ["director", "Director"]];
const TIMES = [["Dawn", 6.25], ["Noon", 12.5], ["Golden", 17.1], ["Sunset", 17.8], ["Dusk", 18.4], ["Night", 22]];
const WEATHER = [["clear", "Clear"], ["cloudy", "Cloudy"], ["rain", "Rain"], ["fog", "Fog"], ["snow", "Snow"]];
const QUALITY = {
  low: { msaa: 0, shadow: 0, bloom: false, scale: 0.7, veg: 0.35, parts: 0.35 },
  medium: { msaa: 2, shadow: 1024, bloom: true, scale: 0.9, veg: 0.7, parts: 0.6 },
  high: { msaa: 4, shadow: 2048, bloom: true, scale: 1, veg: 1, parts: 1 },
  ultra: { msaa: 8, shadow: 4096, bloom: true, scale: 1.3, veg: 1.35, parts: 1.4 },
};

let api = null, R = null, world = null, fx = null, sound = null, canvas = null, atlas = null;
const prefs = {
  plant: "ev", cam: "oblique", guides: true, radar: true, labels: true, hour: 16.6, weather: "clear",
  quality: "high", traffic: true, cinematic: false, sound: false, fps: true, timelapse: false, effects: true,
};
let CAR = null, carL = 0;
const cam = { eye: [-20, 8, 30], target: [0, 0.7, 0], fov: 38, ready: false, uYaw: 0, uPitch: 0, zoom: 1, shot: -1 };
let dispT = null, lastNow = 0, runKey = "", lastHud = 0, Lcar = 4.5;
let coll = null;                 // {t, v, start}
const pb = { mode: "live", t: 0, paused: false, speed: 1, t1: 0, hold: 0, start: 0 };
const carState = { ego: { af: 0, heat: 0 }, lead: { af: 0, heat: 0 } };
let fpsS = { n: 0, t0: 0, fps: 0 }, snapReq = false, uiHidden = false, lastVms = 0, misc = null;

// ============================================================================ DOM
const CSS = `
#view-3d.on { padding: 0; position: relative; overflow: hidden; }
.v3 { position: absolute; inset: 0; background: #0b0d10; }
.v3 canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; outline: none; }
.v3 canvas:active { cursor: grabbing; }
.v3-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.v3-tag { position: absolute; transform: translate(-50%, -100%); padding: 5px 9px; border-radius: 7px; white-space: nowrap;
  background: rgba(16,19,23,.74); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.13); color: #eef1f4;
  font: 600 12px Inter, system-ui, sans-serif; box-shadow: 0 4px 18px rgba(0,0,0,.35); }
.v3-tag i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
.v3-tag small { color: #a9b3bd; font-weight: 500; margin-left: 6px; }
.v3-tag.gap { background: rgba(16,19,23,.6); font-size: 11px; transform: translate(-50%, 0); }
.v3-tag.target { border-color: rgba(180,140,255,.6); color: #d9c8ff; font-size: 11px; transform: translate(-50%, 0); }
.v3-tag.lock { border-color: rgba(90,220,255,.7); color: #bff3ff; font-size: 10px; letter-spacing: .08em; padding: 3px 7px; }
.v3-pan { position: absolute; top: 14px; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px;
  background: color-mix(in srgb, var(--panel) 84%, transparent); backdrop-filter: blur(12px); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: var(--shadow); }
.v3-pan.left { left: 14px; width: 432px; } .v3-pan.right { right: 14px; width: 352px; }
.v3-pan h4 { margin: 0; display: flex; align-items: center; justify-content: space-between; font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted); font-weight: 800; cursor: pointer; user-select: none; }
.v3-pan h4 span { font-size: 14px; transition: transform .15s; }
.v3-pan.collapsed > :not(h4) { display: none; } .v3-pan.collapsed h4 span { transform: rotate(-90deg); }
.v3-row { display: flex; align-items: center; gap: 8px; }
.v3-lbl { width: 62px; flex: none; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 700; }
.v3-row select { flex: 1; min-width: 0; }
.v3-desc { font-size: 12px; color: var(--text-2); margin: -2px 0 0 70px; }
.v3-toggles { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; }
.v3-help { font-size: 11px; color: var(--muted); }
.v3 .seg.small button { padding: 4px 8px; }
.v3-cams { display: grid; grid-template-columns: repeat(7, auto); }
.v3-time { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.v3-time input[type=range] { width: 100%; accent-color: #f0b35a; }
.v3-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.v3-chips button { padding: 2px 7px; font-size: 11px; border-radius: 6px; }
.v3-clock { font: 700 13px ui-monospace, monospace; color: var(--text); min-width: 112px; }
.v3-coll { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); padding: 12px 22px; border-radius: 12px; color: #fff;
  background: linear-gradient(90deg, #b3261e, #d9483f); box-shadow: 0 10px 40px rgba(180,30,20,.5); text-align: center;
  font: 800 20px Inter, system-ui, sans-serif; letter-spacing: .06em; animation: v3pulse 1.1s ease-in-out infinite; z-index: 3; }
.v3-coll small { display: block; font-size: 13px; font-weight: 500; letter-spacing: 0; opacity: .92; margin-top: 3px; }
.v3-coll button { margin-top: 8px; background: rgba(255,255,255,.16); color: #fff; border: 1px solid rgba(255,255,255,.35); }
@keyframes v3pulse { 50% { box-shadow: 0 10px 60px rgba(229,83,75,.9); } }
.v3-replay { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); padding: 6px 16px; border-radius: 999px;
  background: rgba(10,12,15,.72); color: #ffd166; font: 800 14px Inter, system-ui; letter-spacing: .3em; border: 1px solid rgba(255,209,102,.5); z-index: 4; }
.v3-replay i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #e5534b; margin-right: 10px; animation: v3blink 1s steps(2) infinite; }
@keyframes v3blink { 50% { opacity: .2; } }
.v3-flash { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 40%, rgba(229,40,30,.5));
  opacity: 0; transition: opacity .2s; }
.v3-pb { position: absolute; left: 14px; right: 14px; bottom: 112px; display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  background: color-mix(in srgb, var(--panel) 80%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--border); border-radius: 10px; }
.v3-pb input[type=range] { flex: 1; accent-color: var(--accent); }
.v3-pb .t { font: 600 12px ui-monospace, monospace; color: var(--text-2); min-width: 120px; text-align: center; }
.v3-pb .live { font-weight: 800; letter-spacing: .06em; }
.v3-pb .live.on { color: #fff; background: #d0352d; border-color: #d0352d; }
.v3-pb .stats { font: 500 11px ui-monospace, monospace; color: var(--muted); white-space: nowrap; }
.v3-hud { position: absolute; left: 14px; right: 14px; bottom: 14px; display: grid; grid-template-columns: 1.3fr 1fr 1.5fr 1.1fr 1.2fr 1fr 1.4fr;
  background: color-mix(in srgb, var(--panel) 86%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: var(--shadow); }
.v3-hud > div { padding: 10px 14px; border-right: 1px solid var(--border); min-width: 0; }
.v3-hud > div:last-child { border-right: none; }
.v3-hud .k { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
.v3-hud .v { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; margin-top: 2px; white-space: nowrap; }
.v3-hud .v small { font-size: 12px; color: var(--muted); font-weight: 500; margin-left: 3px; }
.v3-hud .s { font-size: 11px; color: var(--text-2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.v3-bar { height: 4px; border-radius: 4px; background: var(--panel-3); margin-top: 6px; overflow: hidden; }
.v3-bar i { display: block; height: 100%; width: 0; transition: width .15s; }
.v3-empty { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); padding: 16px 22px; border-radius: 12px; text-align: center;
  background: color-mix(in srgb, var(--panel) 88%, transparent); border: 1px solid var(--border); color: var(--text-2); max-width: 420px; }
.v3-empty b { color: var(--text); display: block; font-size: 16px; margin-bottom: 4px; }
.v3 .hidden { display: none !important; }
.v3.noui .v3-pan, .v3.noui .v3-hud, .v3.noui .v3-pb, .v3.noui .v3-labels, .v3.noui .v3-coll { display: none !important; }
.v3-uihint { position: absolute; right: 16px; bottom: 16px; font-size: 11px; color: rgba(255,255,255,.55); display: none; }
.v3.noui .v3-uihint { display: block; }
@media (max-width: 1250px) { .v3-pan.left { width: 380px; } .v3-pan.right { width: 300px; } .v3-hud { grid-template-columns: repeat(4, 1fr); } .v3-hud > div:nth-child(n+5) { display: none; } }
`;

function buildDOM() {
  const st = document.createElement("style");
  st.textContent = CSS;
  document.head.appendChild(st);
  const seg = (id, items) => `<div class="seg small" id="${id}">${items.map(([v, l]) => `<button data-value="${v}">${l}</button>`).join("")}</div>`;
  $("view-3d").innerHTML = `
  <div class="v3" id="v3">
    <canvas id="v3-canvas" tabindex="0"></canvas>
    <div class="v3-flash" id="v3-flash"></div>
    <div class="v3-labels" id="v3-labels"></div>
    <div class="v3-pan left" id="v3-pl">
      <h4>Run &amp; camera <span>▾</span></h4>
      <div class="v3-row"><span class="v3-lbl">Plant</span>${seg("v3-plant", [["ice", "ICE · petrol"], ["ev", "EV · DC motor"]])}</div>
      <div class="v3-row"><span class="v3-lbl">Scenario</span><select id="v3-scn"></select>
        <button class="small primary" id="v3-run" title="Save the scenario and (re)start the run">▶ Run</button></div>
      <div class="v3-desc" id="v3-desc"></div>
      <div class="v3-row"><span class="v3-lbl">Camera</span>${seg("v3-cam", CAMS).replace('class="seg small"', 'class="seg small v3-cams"')}
        <button class="icon" id="v3-reset" title="Reset the camera (double-click the scene)">⟲</button></div>
      <div class="v3-row"><span class="v3-lbl">Overlay</span><div class="v3-toggles">
        <label class="switch"><input type="checkbox" id="v3-guides"><i></i>Gap &amp; target</label>
        <label class="switch"><input type="checkbox" id="v3-radar"><i></i>Radar</label>
        <label class="switch"><input type="checkbox" id="v3-showlabels"><i></i>Labels</label></div></div>
      <div class="v3-help">Drag to orbit · wheel to zoom · double-click to reset · H hides the UI · P saves a picture</div>
    </div>
    <div class="v3-pan right" id="v3-pr">
      <h4>Environment <span>▾</span></h4>
      <div class="v3-row"><span class="v3-lbl">Time</span><div class="v3-time">
        <div class="v3-row"><input type="range" id="v3-hour" min="0" max="24" step="0.05"><span class="v3-clock" id="v3-clock"></span></div>
        <div class="v3-chips">${TIMES.map(([l, h]) => `<button class="small" data-hour="${h}">${l}</button>`).join("")}
          <button class="small" id="v3-lapse" title="Time-lapse">⏩</button></div></div></div>
      <div class="v3-row"><span class="v3-lbl">Weather</span>${seg("v3-weather", WEATHER)}</div>
      <div class="v3-row"><span class="v3-lbl">Quality</span>${seg("v3-quality", [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["ultra", "Ultra"]])}
        <button class="icon" id="v3-photo" title="Save a picture (P)">📷</button></div>
      <div class="v3-row"><span class="v3-lbl">World</span><div class="v3-toggles">
        <label class="switch"><input type="checkbox" id="v3-traffic"><i></i>Traffic</label>
        <label class="switch"><input type="checkbox" id="v3-effects"><i></i>Effects</label>
        <label class="switch"><input type="checkbox" id="v3-cine"><i></i>Cinematic</label>
        <label class="switch"><input type="checkbox" id="v3-sound"><i></i>Sound</label>
        <label class="switch"><input type="checkbox" id="v3-fps"><i></i>Stats</label></div></div>
    </div>
    <div class="v3-coll hidden" id="v3-coll"></div>
    <div class="v3-replay hidden" id="v3-replay"><i></i>REPLAY · ¼ SPEED</div>
    <div class="v3-empty hidden" id="v3-empty"></div>
    <div class="v3-pb" id="v3-pb">
      <button class="icon" id="pb-start" title="Back to the start">⏮</button>
      <button class="icon" id="pb-play" title="Pause / play the 3D view">⏸</button>
      <input type="range" id="pb-scrub" min="0" max="1" step="0.001" value="1">
      <span class="t" id="pb-t">–</span>
      <select id="pb-speed" title="Playback speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
      <button class="small live on" id="pb-live" title="Follow the simulation">● LIVE</button>
      <button class="small hidden" id="pb-replay" title="Slow-motion replay of the impact">⟲ Replay impact</button>
      <span class="stats" id="v3-stats"></span>
    </div>
    <div class="v3-hud" id="v3-hud">
      <div><div class="k">Speed</div><div class="v" id="h-v">–</div><div class="s" id="h-v2"></div></div>
      <div><div class="k">Set speed</div><div class="v" id="h-vset">–</div><div class="s" id="h-vset2"></div></div>
      <div><div class="k">Gap · target</div><div class="v" id="h-d">–</div><div class="v3-bar"><i id="h-dbar"></i></div></div>
      <div><div class="k">Acceleration</div><div class="v" id="h-a">–</div><div class="s" id="h-brk"></div></div>
      <div><div class="k">Controller</div><div class="v" style="font-size:15px;margin-top:6px"><span class="badge" id="h-mode">–</span></div><div class="s" id="h-mode2"></div></div>
      <div><div class="k">Leader</div><div class="v" id="h-lv">–</div><div class="s" id="h-la"></div></div>
      <div><div class="k">Time</div><div class="v" id="h-t">–</div><div class="v3-bar"><i id="h-tbar" style="background:var(--accent)"></i></div></div>
    </div>
    <div class="v3-uihint">H shows the interface</div>
  </div>`;
  canvas = $("v3-canvas");
  const sel = $("v3-scn");
  for (const s of SCENARIOS) sel.add(new Option(s, s));
}

// ============================================================================ init
function save() { try { localStorage.setItem("ktrl.view3d.v2", JSON.stringify(prefs)); } catch { /* */ } }
function syncUI() {
  const segOn = (id, v) => document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.value === v));
  segOn("v3-plant", prefs.plant); segOn("v3-cam", prefs.cam); segOn("v3-weather", prefs.weather); segOn("v3-quality", prefs.quality);
  $("v3-guides").checked = prefs.guides; $("v3-radar").checked = prefs.radar; $("v3-showlabels").checked = prefs.labels;
  $("v3-traffic").checked = prefs.traffic; $("v3-effects").checked = prefs.effects; $("v3-cine").checked = prefs.cinematic;
  $("v3-sound").checked = prefs.sound; $("v3-fps").checked = prefs.fps;
  $("v3-hour").value = prefs.hour; $("v3-lapse").classList.toggle("on", prefs.timelapse);
  $("v3-stats").classList.toggle("hidden", !prefs.fps);
}
function clockText(h) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  const e = 62 * Math.sin(Math.PI * (h - 6) / 12);
  const name = e < -10 ? "night" : e < -3 ? "blue hour" : e < 2 ? (h < 12 ? "sunrise" : "sunset") : e < 12 ? "golden hour" : "day";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} · ${name}`;
}

export function init3D(a) {
  api = a;
  try { Object.assign(prefs, JSON.parse(localStorage.getItem("ktrl.view3d.v2") || "{}")); } catch { /* */ }
  buildDOM();
  try {
    R = new Renderer(canvas);
    atlas = MD.buildAtlas();
    R.setAtlas(atlas.canvas);
    world = new World(R, atlas);
    fx = new FX(R);
    sound = new Sound();
    buildCars(Lcar);
    const beam = new Geo().add(cylGeo(0, 1, 1, 18, false), M4.model(0, 0, 0, 0, -Math.PI / 2));
    misc = {
      beam: R.mesh(beam), box: R.mesh(boxGeo(1, 1, 1)),
      airbag: R.mesh(sphereGeo(0.32, 16, 10, { color: "#f2f2ee", spec: 0.2, shine: 20, glow: 0, flag: 0 })),
    };
  } catch (e) {
    R = null;
    $("v3-empty").classList.remove("hidden");
    $("v3-empty").innerHTML = `<b>3D is not available</b>${e.message}. Enable hardware acceleration (WebGL 2) in the browser. The other windows keep working.`;
    console.error(e);
  }
  syncUI();
  $("v3-clock").textContent = clockText(prefs.hour);
  // ---------------------------------------------------------------- controls
  document.querySelectorAll("#v3-plant button").forEach((b) => b.addEventListener("click", async () => {
    prefs.plant = b.dataset.value; save(); syncUI(); resetRunFx();
    const { columns } = api.getLive();
    if (columns.length && !columns.includes(`${prefs.plant}_x`)) {
      await api.safe(async () => {
        await api.PUT("/api/config", { changes: { simulation: { vehicle: "both" } } });
        await api.reload();
        await api.POST("/api/run/restart");
        api.toast(`${NAME[prefs.plant]} was not in this run: restarted with both vehicles`);
      });
    }
  }));
  const segBind = (id, key, after) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
    prefs[key] = b.dataset.value; save(); syncUI(); after?.();
  }));
  segBind("v3-cam", "cam", () => { cam.uYaw = 0; cam.uPitch = 0; cam.zoom = 1; });
  segBind("v3-weather", "weather");
  segBind("v3-quality", "quality");
  const chk = (id, key, after) => $(id).addEventListener("change", (e) => { prefs[key] = e.target.checked; save(); syncUI(); after?.(); });
  chk("v3-guides", "guides"); chk("v3-radar", "radar"); chk("v3-showlabels", "labels"); chk("v3-traffic", "traffic");
  chk("v3-effects", "effects"); chk("v3-cine", "cinematic"); chk("v3-fps", "fps");
  chk("v3-sound", "sound", () => { if (prefs.sound) sound?.start(); else sound?.stop(); });
  $("v3-reset").addEventListener("click", () => { cam.uYaw = 0; cam.uPitch = 0; cam.zoom = 1; });
  $("v3-hour").addEventListener("input", (e) => { prefs.hour = +e.target.value; $("v3-clock").textContent = clockText(prefs.hour); save(); });
  document.querySelectorAll("[data-hour]").forEach((b) => b.addEventListener("click", () => {
    prefs.hour = +b.dataset.hour; prefs.timelapse = false; save(); syncUI(); $("v3-clock").textContent = clockText(prefs.hour);
  }));
  $("v3-lapse").addEventListener("click", () => { prefs.timelapse = !prefs.timelapse; save(); syncUI(); });
  $("v3-photo").addEventListener("click", () => { snapReq = true; });
  document.querySelectorAll(".v3-pan h4").forEach((h) => h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed")));
  $("v3-scn").addEventListener("change", (e) => { $("v3-desc").textContent = SCN_DESC[e.target.value] || ""; });
  $("v3-run").addEventListener("click", () => api.safe(async () => {
    const preset = $("v3-scn").value;
    const changes = { scenario: { preset } };
    const veh = api.cfgVal("simulation", "vehicle", "both");
    if (veh !== "both" && veh !== prefs.plant) changes.simulation = { vehicle: "both" };
    await api.PUT("/api/config", { changes });
    await api.reload();
    await api.POST("/api/run/restart");
    resetRunFx(); pb.mode = "live";
    api.toast(`${preset} started · ${NAME[prefs.plant]}`);
  }));
  // playback
  const toReview = () => { if (pb.mode !== "review") { pb.mode = "review"; pb.t = dispT ?? 0; } };
  $("pb-play").addEventListener("click", () => { toReview(); pb.paused = !pb.paused; });
  $("pb-start").addEventListener("click", () => { toReview(); const { rows } = api.getLive(); pb.t = rows[0]?.[0] ?? 0; pb.paused = false; });
  $("pb-scrub").addEventListener("input", (e) => {
    toReview();
    const { rows } = api.getLive();
    if (!rows.length) return;
    const t0 = rows[0][0], t1 = rows[rows.length - 1][0];
    pb.t = t0 + (t1 - t0) * +e.target.value;
  });
  $("pb-speed").addEventListener("change", (e) => { pb.speed = +e.target.value; });
  $("pb-live").addEventListener("click", () => { pb.mode = "live"; pb.paused = false; });
  $("pb-replay").addEventListener("click", startReplay);
  // orbit / zoom
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    cam.uYaw += (e.clientX - drag[0]) * 0.006;
    cam.uPitch = Math.max(-0.6, Math.min(1.2, cam.uPitch + (e.clientY - drag[1]) * 0.005));
    drag = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.zoom = Math.max(0.12, Math.min(8, cam.zoom * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  canvas.addEventListener("dblclick", () => { cam.uYaw = 0; cam.uPitch = 0; cam.zoom = 1; });
  document.addEventListener("keydown", (e) => {
    if (!$("view-3d")?.classList.contains("on")) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
    if (e.key === "h" || e.key === "H") { uiHidden = !uiHidden; $("v3").classList.toggle("noui", uiHidden); }
    else if (e.key === "p" || e.key === "P") snapReq = true;
  });
  if (prefs.sound) { prefs.sound = false; syncUI(); }       // audio needs a click first
  window.__v3 = { cam, prefs };                               // console / test hook
}

function buildCars(L) {
  const mk = (style, plate, shirt) => {
    const c = MD.buildCar(style, L, { plate: atlas.uv[plate], shirt });
    return { c, body: R.mesh(c.body), glass: R.mesh(c.glass), inter: R.mesh(c.interior), wheel: R.mesh(c.wheel), chassis: R.mesh(c.chassis) };
  };
  CAR = { ev: mk("ev", "plate_ev", "#2d4f7c"), ice: mk("ice", "plate_ice", "#6b2d2d"), lead: mk("suv", "plate_lead", "#3d5a3d") };
  carL = L;
}
function resetRunFx() { coll = null; dispT = null; fx?.reset(); carState.ego = { af: 0, heat: 0 }; carState.lead = { af: 0, heat: 0 }; }
function startReplay() {
  if (!coll) return;
  pb.mode = "replay"; pb.t = coll.t - 4.0; pb.t1 = coll.t + 0.6; pb.speed = 0.25; pb.hold = 0; pb.start = performance.now() / 1000;
  coll = null; fx.reset();
}

// ============================================================================ sampling
let idxCache = { cols: null, idx: null };
function sample(now, dtw) {
  const { columns, rows, status, meta } = api.getLive();
  if (!rows.length) return { empty: true };
  if (idxCache.cols !== columns) idxCache = { cols: columns, idx: Object.fromEntries(columns.map((n, i) => [n, i])) };
  const idx = idxCache.idx, plant = prefs.plant;
  if (idx[`${plant}_x`] === undefined) return { missing: true };
  Lcar = +(meta?.L_veh || 4.5);
  const key = `${status?.run_id}|${rows[0][0]}|${plant}`;
  if (key !== runKey) { runKey = key; resetRunFx(); cam.ready = false; pb.mode = "live"; pb.paused = false; }
  const t0 = rows[0][0], tLast = rows[rows.length - 1][0];
  const running = status?.state === "running";
  const rate = running ? (+status.realtime_factor || 1e3) : 1e3;
  if (pb.mode === "live") {
    if (dispT === null || dispT > tLast || tLast - dispT > 0.6) dispT = Math.max(t0, tLast - 0.1);
    else dispT = Math.min(tLast, dispT + dtw * rate);
  } else if (pb.mode === "review") {
    if (!pb.paused) pb.t += dtw * pb.speed;
    pb.t = Math.max(t0, Math.min(tLast, pb.t));
    if (!pb.paused && pb.t >= tLast - 1e-6 && running) pb.mode = "live";
    dispT = pb.t;
  } else {
    pb.t += dtw * pb.speed;
    if (pb.t >= pb.t1) { pb.t = pb.t1; if (!pb.hold) pb.hold = now; if (now - pb.hold > 3.0) { pb.mode = "live"; pb.speed = +$("pb-speed").value; } }
    dispT = Math.max(t0, Math.min(tLast, pb.t));
  }
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m][0] <= dispT) lo = m; else hi = m; }
  const a = rows[lo], b = rows[hi];
  const f = b[0] > a[0] ? Math.max(0, Math.min(1, (dispT - a[0]) / (b[0] - a[0]))) : 1;
  const g = (k) => { const i = idx[`${plant}_${k}`]; if (i === undefined) return null; const va = a[i], vb = b[i]; return va == null || vb == null ? (vb ?? va) : va + (vb - va) * f; };
  const flag = (k) => { const i = idx[`${plant}_${k}`]; return i !== undefined && (f < 0.5 ? a[i] : b[i]) > 0.5; };
  return {
    t: dispT, t0, tLast, x: g("x"), v: g("v"), a: g("a"), d: g("d"), dref: g("d_ref"), vset: g("v_set"),
    leadX: g("lead_x"), leadV: g("lead_v"), leadA: g("lead_a"), Fb: g("F_b"), rpm: g("rpm"),
    target: flag("target"), leadOn: flag("lead_on"), follow: flag("mode"), collided: flag("collided"),
    duration: +status?.duration || +meta?.duration || 0, state: status?.state, running,
  };
}

// ============================================================================ frame
export function tick() {
  if (!$("view-3d")?.classList.contains("on")) { lastNow = 0; return; }
  if (!R) return;
  const q = QUALITY[prefs.quality] || QUALITY.high;
  R.quality = { msaa: q.msaa, shadow: q.shadow, bloom: q.bloom };
  const [W, H] = R.resize(q.scale);
  if (!W || !H) return;
  const now = performance.now() / 1000;
  const dtw = lastNow ? Math.min(0.1, now - lastNow) : 0.016;
  lastNow = now;
  if (prefs.timelapse) { prefs.hour = (prefs.hour + dtw * 0.35) % 24; $("v3-hour").value = prefs.hour; $("v3-clock").textContent = clockText(prefs.hour); }

  const s = sample(now, dtw);
  const live = !s.empty && !s.missing;
  const emp = $("v3-empty");
  emp.classList.toggle("hidden", live);
  if (s.empty) emp.innerHTML = "<b>No run yet</b>Choose a plant and a scenario, then press ▶ Run.";
  if (s.missing) emp.innerHTML = `<b>This run has no ${NAME[prefs.plant]}</b>Press ▶ Run to restart it with both vehicles.`;
  if (Math.abs(Lcar - carL) > 1e-6) buildCars(Lcar);
  const st = live ? s : { t: 0, x: 0, v: 0, a: 0, d: 0, dref: 0, leadOn: true, target: false, follow: false, collided: false, leadX: 40, leadV: 0, leadA: 0 };
  const plant = prefs.plant, L = Lcar;
  const leadFront = st.leadOn ? st.leadX - st.x : null;
  const leadRear = leadFront == null ? null : leadFront - L;

  // ------------------------------------------------ collision trigger / rewind
  const cl = api.getCollisions?.()[plant];
  if (live && st.collided && !coll) {
    coll = { t: cl?.t ?? st.t, v: cl?.v ?? (st.v - st.leadV), start: now };
    fx.boom(st.x, coll.v, lin(PAINT[plant]), lin(PAINT.lead), plant);
    if (prefs.sound) sound.crash(coll.v);
  } else if (coll && live && !st.collided) { coll = null; fx.reset(); }
  const cAge = coll ? now - coll.start : 1e9;

  // ------------------------------------------------ environment
  const env = makeEnv(prefs.hour, prefs.weather, now, st.x);
  env.spots = [];

  // ------------------------------------------------ camera
  const camOut = cameraFor(st, L, leadFront, now, dtw, W / H, cAge);
  const { eye, target, fov, view, proj, vp } = camOut;
  const invVP = M4.invert(vp);
  const camR = [view[0], view[4], view[8]], camU = [view[1], view[5], view[9]];
  const camC = { vp, view, proj, eye, worldX: ((st.x % 4000) + 4000) % 4000, invVP, right: camR, up: camU, target };

  // ------------------------------------------------ scene lists
  const lists = { ground: [], opaque: [], glass: [], mirror: [], flats: [], beams: [], partsAlpha: [], partsAdd: [], groups: [] };
  const E = eye;
  const ctx = {
    ox: st.x, cx: target[0], t: st.t, now, env, q: { veg: q.veg, parts: q.parts, fx: prefs.effects, weatherFx: true }, traffic: prefs.traffic, lists,
    glow: (x, y, z, size, col, alpha, mode = 1) => lists.partsAdd.push([x, y, z, size, col[0] * 3, col[1] * 3, col[2] * 3, alpha, 0, 0, 0, mode, 0]),
    streak: (x, z, col, alpha) => lists.partsAdd.push([x, 0.03, z, 0.18, col[0] * 2, col[1] * 2, col[2] * 2, alpha, 0, -30, 0, 3, 0]),
    spot: (p, d, I, c) => { const n = Math.hypot(...d); env.spots.push({ p, d: d.map((x) => x / n), i: I, cos: c }); },
  };
  world.update(ctx);

  // ------------------------------------------------ cars
  const egoCar = CAR[plant], leadCar = CAR.lead;
  const egoBrake = (st.Fb ?? 0) > 50 || st.a < -0.6;
  const leadBrake = (st.leadA ?? 0) < -0.3;
  const sE = carState.ego, sL = carState.lead;
  const k = 1 - Math.exp(-dtw * 5);
  sE.af += ((st.collided ? 0 : st.a) - sE.af) * k; sL.af += ((st.leadA ?? 0) - sL.af) * k;
  sE.heat = Math.max(0, sE.heat + dtw * ((st.Fb ?? 0) * Math.max(st.v, 0) / 2.4e5 - sE.heat * 0.12));
  sL.heat = Math.max(0, sL.heat + dtw * ((leadBrake ? -(st.leadA ?? 0) * 1600 : 0) * Math.max(st.leadV, 0) / 2.4e5 - sL.heat * 0.12));
  const hazard = coll && Math.floor(now * 1.6) % 2 === 0;
  const crush = coll ? Math.min(0.42, 0.06 + coll.v * 0.024) * Math.min(1, cAge * 12) : 0;
  drawCar(lists, ctx, egoCar, 0, PAINT[plant], { v: st.v, a: sE.af, brake: egoBrake, wx: st.x, heat: sE.heat, hazard, crumple: [crush, 0, L, 0], driver: true, env, now });
  if (st.leadOn) drawCar(lists, ctx, leadCar, leadFront, PAINT.lead, { v: st.leadV, a: sL.af, brake: leadBrake, wx: st.leadX, heat: sL.heat, hazard, crumple: [0, crush * 0.8, L, 0], env, now });
  // airbag
  if (coll && cAge < 4) {
    const s1 = Math.min(1, cAge / 0.05) * (cAge < 1.2 ? 1 : Math.max(0.35, 1 - (cAge - 1.2) * 0.25));
    const G = egoCar.c.G, sx = egoCar.c.X(G.A0 + 0.12);
    lists.opaque.push({ mesh: misc.airbag, model: M4.model(sx - crush, egoCar.c.beltOf(G.A0) + 0.25, -0.38, 0, 0, s1, s1 * 0.9, s1), mat: { flags: 0 } });
  }

  // ------------------------------------------------ guides, radar
  const lbl = [];
  const now2 = now;
  if (prefs.radar && live && !coll) {
    const dd = +(api.cfgVal("controller", "d_det", "150")) || 150;
    const hw = dd * Math.tan(7 * Math.PI / 180);
    lists.flats.push({ model: M4.model(dd / 2 + 0.2, 0.025, 0, 0, 0, dd / 2, hw, 1, -Math.PI / 2), color: st.target ? "#45d4ff" : "#7b8cff", alpha: 0.7, mode: 5, additive: true, param: [(now2 * 0.55) % 1, dd / 25, 0, 0] });
    if (st.target && leadRear != null) {      // lock-on bracket on the leader's tail
      const xr = leadRear - 0.06, pulse = 0.6 + 0.4 * Math.sin(now2 * 8);
      const brk = { color: "#45d4ff", emissive: "#45d4ff", spec: 0 };
      const P = (x, y, z, sx, sy, sz) => lists.opaque.push({ mesh: misc.box, model: M4.model(x, y, z, 0, 0, sx, sy, sz), mat: { ...brk, emissiveLin: lin("#45d4ff").map((c) => c * 4 * pulse) }, cast: false });
      for (const z of [-1.15, 1.15]) for (const y of [0.18, 1.72]) { P(xr, y, z, 0.03, 0.03, 0.35); P(xr, y + (y < 1 ? 0.15 : -0.15), z, 0.03, 0.33, 0.03); }
      lbl.push({ x: xr, y: 1.95, z: 0, cls: "lock", html: "RADAR LOCK" });
    }
  }
  if (prefs.guides && live && leadRear != null && leadRear > 0.05) {
    const ratio = st.target && st.dref > 0 ? st.d / st.dref : 2;
    const col = ratio < 0.5 ? "#e5534b" : ratio < 0.95 ? "#e3b341" : "#4fc3a1";
    lists.flats.push({ model: M4.model(leadRear / 2, 0.03, 0, 0, 0, leadRear / 2, 0.95, 1, -Math.PI / 2), color: col, alpha: 0.42, mode: 6, k: 1.6, param: [(now2 * 1.4) % 1, leadRear / 2.2, 0, 0] });
    if (st.target && st.dref > 0) {
      const xt = leadRear - st.dref;
      const gate = { color: "#b48cff", emissive: "#7b4dff" };
      lists.opaque.push({ mesh: misc.box, model: M4.model(xt, 0.03, 0, 0, 0, 0.22, 0.02, 3.4), mat: gate, cast: false });
      for (const z of [-1.7, 1.7]) lists.opaque.push({ mesh: misc.box, model: M4.model(xt, 0.85, z, 0, 0, 0.08, 1.7, 0.08), mat: { color: "#c7aaff", emissive: "#6b3df0" }, cast: false });
      lists.opaque.push({ mesh: misc.box, model: M4.model(xt, 1.7, 0, 0, 0, 0.08, 0.08, 3.4), mat: { color: "#c7aaff", emissive: "#6b3df0" }, cast: false });
      lists.flats.push({ model: M4.model(xt, 0.85, 0, Math.PI / 2, 0, 1.7, 0.85, 1), color: "#8f62ff", alpha: 0.14, mode: 1, additive: true });
      lbl.push({ x: xt, y: 0.05, z: -2.0, cls: "target", html: `target d_ref ${st.dref.toFixed(1)} m` });
    }
    lbl.push({ x: leadRear / 2, y: 0.05, z: 1.3, cls: "gap", html: `gap ${Math.max(0, st.d).toFixed(1)} m · ${(st.v > 0.5 ? st.d / st.v : 0).toFixed(1)} s` });
  }
  if (live && prefs.labels) {
    lbl.push({ x: -L / 2, y: 2.25, z: 0, html: `<i style="background:${PAINT[plant]}"></i>${NAME[plant]} ${(st.v * 3.6).toFixed(0)} km/h<small>${st.v.toFixed(1)} m/s</small>` });
    if (st.leadOn) lbl.push({ x: leadFront - L / 2, y: 2.45, z: 0, html: `<i style="background:${PAINT.lead}"></i>Leader ${(st.leadV * 3.6).toFixed(0)} km/h<small>${st.leadV.toFixed(1)} m/s</small>` });
  }

  // ------------------------------------------------ effects
  const fxCars = [{ id: "ego", xw: st.x, z: 0, v: st.v, a: st.collided ? 0 : st.a, frontAxle: egoCar.c.axles[0], rearAxle: egoCar.c.axles[1], track: egoCar.c.track, exhaust: egoCar.c.lights.exhaust, collided: st.collided }];
  if (st.leadOn) fxCars.push({ id: "lead", xw: st.leadX, z: 0, v: st.leadV, a: st.leadA ?? 0, frontAxle: leadCar.c.axles[0], rearAxle: leadCar.c.axles[1], track: leadCar.c.track, exhaust: leadCar.c.lights.exhaust, collided: st.collided });
  fx.step(dtw, { env, q: ctx.q, cars: live ? fxCars : [] });
  fx.emit({ ox: st.x, env, cam: { eye, target }, q: ctx.q, lists, now });

  // ------------------------------------------------ VMS text
  if (now - lastVms > 0.5 && live) {
    lastVms = now;
    world.updateVMS(coll ? ["COLLISION AHEAD", "LANE CLOSED"] : st.target
      ? [`ACC · ${st.follow ? "DISTANCE" : "SPEED"} LOOP`, `GAP ${Math.max(0, st.d).toFixed(1)} M  ${(st.v > 0.5 ? st.d / st.v : 0).toFixed(1)} S`]
      : ["ACC · SPEED LOOP", `SET ${((st.vset ?? 0) * 3.6).toFixed(0)} KM/H`]);
  }

  // ------------------------------------------------ post
  const sunP = M4.apply(vp, eye[0] + env.sunDir[0] * 3000, eye[1] + env.sunDir[1] * 3000, eye[2] + env.sunDir[2] * 3000);
  const sunUV = [sunP[0] * 0.5 + 0.5, sunP[1] * 0.5 + 0.5];
  const onScr = sunP[3] > 0 && sunUV[0] > -0.1 && sunUV[0] < 1.1 && sunUV[1] > -0.1 && sunUV[1] < 1.1 ? 1 : 0;
  const hit = coll ? (cAge < 0.6 ? 1 - cAge / 0.6 * 0.6 : 0.25 + 0.15 * Math.sin(now * 5)) : 0;
  const post = {
    bloom: 0.055 + env.night * 0.03 + (env.weather === "fog" ? 0.03 : 0), threshold: 1.0,
    vignette: prefs.cinematic ? 0.6 : 0.32, grain: prefs.cinematic ? 0.035 : 0.012, ca: prefs.cinematic ? 0.0028 : 0.0012,
    letter: prefs.cinematic ? 0.095 : 0, flare: onScr * env.sunVis * (1 - env.cloud * 0.95) * 0.9, sunScr: sunUV,
    flareCol: env.sunCol.map((c) => Math.min(1, c / 3)), sat: env.grade.sat, lift: env.grade.lift, gain: env.grade.gain, hit,
  };
  const shadow = prefs.cam === "driver" ? { center: [30, 0, 0], half: 48, ox: st.x } : { center: [target[0], 0, target[2] * 0.3], half: Math.max(24, Math.min(110, camOut.dist * 0.8)), ox: st.x };
  R.render({ cam: camC, env, shadow: env.castShadows ? shadow : null, post, ...lists });
  if (snapReq) { snapReq = false; savePicture(); }

  // ------------------------------------------------ sound
  if (prefs.sound) sound.update({ plant, v: st.v, a: st.a, rpm: st.rpm, collided: !!coll, rain: env.rain });

  // ------------------------------------------------ DOM: collision, replay, labels, HUD
  $("v3-flash").style.opacity = coll ? (cAge < 0.5 ? 1 : 0.35 + 0.25 * Math.sin(now * 6)) : 0;
  const cb = $("v3-coll");
  const showBanner = coll && pb.mode !== "replay";
  cb.classList.toggle("hidden", !showBanner);
  if (showBanner) {
    const html = `⚠ COLLISION<small>${NAME[plant]} hit the car ahead at t = ${coll.t.toFixed(2)} s · closing speed ${coll.v.toFixed(1)} m/s (${(coll.v * 3.6).toFixed(0)} km/h) · lane stopped</small><button class="small" id="v3-coll-replay">⟲ Replay impact in slow motion</button>`;
    if (cb.dataset.html !== html) { cb.innerHTML = html; cb.dataset.html = html; $("v3-coll-replay").addEventListener("click", startReplay); }
  }
  $("v3-replay").classList.toggle("hidden", pb.mode !== "replay");
  $("pb-replay").classList.toggle("hidden", !(coll || cl) || pb.mode === "replay");
  if (!coll && cl && pb.mode !== "replay") $("pb-replay").onclick = () => { coll = { t: cl.t, v: cl.v, start: now }; startReplay(); };
  else $("pb-replay").onclick = null;
  drawLabels(lbl, vp, W, H);
  fpsS.n++;
  if (now - fpsS.t0 > 0.5) { fpsS.fps = fpsS.n / (now - fpsS.t0); fpsS.n = 0; fpsS.t0 = now; }
  if (now - lastHud > 0.1) { lastHud = now; hud(live ? st : null); playbar(live ? st : null); }
}

// ============================================================================ camera
const VFOV = 38;
function cameraFor(st, L, leadFront, now, dt, aspect, cAge) {
  const mode = pb.mode === "replay" ? "replay" : prefs.cam;
  const showLead = leadFront != null && leadFront < 400;
  const back = -L - 3, front = showLead ? leadFront + 3 : 16;
  const mid = (back + front) / 2;
  const fitDist = (span, fov) => {
    const hf = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * aspect);
    return Math.max(10, (span / 2) / Math.tan(hf / 2) * 1.1);
  };
  let yaw, pitch, dist, target, fov = VFOV, eye = null, snap = false;
  const span = front - back + 6;
  const dir = (y, p) => [-Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  let m = mode;
  if (m === "director") {
    const shots = ["oblique", "front", "wheel", "heli", "chase", "driver", "rear"];
    const idx = Math.floor(now / 7) % shots.length;
    m = coll && cAge < 6 ? "impact" : shots[idx];
  }
  switch (m) {
    case "side": yaw = 0; pitch = 0.07; target = [mid, 0.8, 0]; dist = fitDist(span, fov); break;
    case "top": yaw = 0.02; pitch = 1.33; target = [mid, 0, -1]; dist = Math.max(fitDist(span, fov), span / 2 / Math.tan(fov * Math.PI / 360)); break;
    case "chase": yaw = Math.PI / 2 - 0.08; pitch = 0.14; target = [1.5, 1.15, 0]; dist = 10.5; fov = 50; break;
    case "orbit": yaw = 0.5 + now * 0.14; pitch = 0.3 + 0.08 * Math.sin(now * 0.21); target = [mid, 0.7, 0]; dist = fitDist(span, fov) * 1.05; break;
    case "front": yaw = -Math.PI / 2 + 0.38; pitch = 0.07; target = [mid, 0.8, 0]; dist = Math.max(14, fitDist(span, fov) * 0.75); fov = 34; break;
    case "wheel": yaw = 0.16; pitch = 0.015; target = [-L / 2, 0.55, 0]; dist = 7.5; fov = 44; break;
    case "heli": yaw = 0.95; pitch = 0.72; target = [mid, 0, 0]; dist = fitDist(span, fov) * 1.35; break;
    case "rear": yaw = Math.PI / 2 + 0.3; pitch = 0.06; target = [mid * 0.6, 0.8, 0]; dist = 10 + span * 0.15; fov = 42; break;
    case "impact": yaw = 0.85 + cAge * 0.12; pitch = 0.13; target = [0.2, 0.7, 0]; dist = 7.5; fov = 40; break;
    case "replay": {
      const tt = now - pb.start;
      yaw = 0.25 + tt * 0.08; pitch = 0.13 + 0.04 * Math.sin(tt * 0.5); target = [mid, 0.7, 0]; fov = 40; dist = fitDist(span, fov) * 0.95; break;
    }
    case "driver": {
      const c = CAR[prefs.plant].c, G = c.G;
      const p = carState.ego.af * 0.006;
      eye = [c.X(G.A0 + 0.22) + 0.0, c.beltOf(G.A0) + 0.43 + p * 0.5, -0.36];
      const yw = cam.uYaw * 0.6, pt = -0.04 + cam.uPitch * 0.4 + p;
      target = [eye[0] + Math.cos(yw) * 30, eye[1] + Math.sin(pt) * 30, eye[2] + Math.sin(yw) * 30];
      fov = 62; snap = true; dist = 0; break;
    }
    default: yaw = 0.5; pitch = 0.27; target = [mid, 0.7, 0]; dist = fitDist(span, fov); break;
  }
  if (cam.focus && !eye) target = [cam.focus === "lead" && leadFront != null ? leadFront - L / 2 : -L / 2, 0.75, 0];
  if (!eye) {
    yaw += cam.uYaw; pitch = Math.max(0.0, Math.min(1.5, pitch + cam.uPitch));
    dist *= cam.zoom;
    const d = dir(yaw, pitch);
    eye = [target[0] + d[0] * dist, target[1] + d[1] * dist, target[2] + d[2] * dist];
    if (eye[1] < 0.25) eye[1] = 0.25;
  }
  // smoothing (fly between modes)
  const kk = snap ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 4.5);
  if (!cam.ready) { cam.eye = eye.slice(); cam.target = target.slice(); cam.fov = fov; cam.ready = true; }
  for (let i = 0; i < 3; i++) { cam.eye[i] += (eye[i] - cam.eye[i]) * kk; cam.target[i] += (target[i] - cam.target[i]) * kk; }
  cam.fov += (fov - cam.fov) * kk;
  let E = cam.eye.slice();
  if (coll && cAge < 0.9) { const sh = (1 - cAge / 0.9) * 0.3; E = E.map((v) => v + (Math.random() - 0.5) * sh); }
  const view = M4.lookAt(E, cam.target, [0, 1, 0]);
  const near = prefs.cam === "driver" && pb.mode !== "replay" ? 0.05 : 0.3;
  const proj = M4.perspective(cam.fov * Math.PI / 180, aspect, near, 9500);
  return { eye: E, target: cam.target.slice(), fov: cam.fov, view, proj, vp: M4.mul(proj, view), dist: Math.hypot(E[0] - cam.target[0], E[1] - cam.target[1], E[2] - cam.target[2]) };
}

// ============================================================================ car drawing
function drawCar(lists, ctx, car, xf, paint, s) {
  const c = car.c, L = c.L, env = s.env, now = s.now;
  const pitch = Math.max(-0.045, Math.min(0.035, s.a * 0.0065));
  const bounce = Math.sin(now * 13 + xf) * Math.min(0.006, s.v * 0.0002);
  const body = M4.mul(M4.model(xf - L / 2, 0.5 + bounce, 0, 0, pitch), M4.model(L / 2, -0.5, 0));
  const head = env.headlights;
  const glow = new Float32Array(8);
  glow[1] = 0.4 + head * 11; glow[2] = s.brake ? 18 : 1.2 + 3.5 * head; glow[3] = s.brake ? 18 : 0;
  glow[4] = s.hazard ? 16 : 0; glow[5] = 5; glow[6] = Math.min(6, s.heat * 6); glow[7] = 0;
  const mat = { color: paint, spec: 0.9, shine: 120, refl: 1.0, glow, crumple: s.crumple };
  const gw = new Float32Array(8); gw[6] = glow[6];
  lists.opaque.push({ mesh: car.body, model: body, mat });
  lists.mirror.push({ mesh: car.body, model: body, mat });
  lists.opaque.push({ mesh: car.inter, model: body, mat: { glow, crumple: s.crumple }, cast: false });
  lists.opaque.push({ mesh: car.chassis, model: M4.model(xf, 0, 0), mat: {} });
  lists.glass.push({ mesh: car.glass, model: body, mat: { alpha: 0.62, flags: 2, spec: 1, shine: 200, refl: 1, crumple: s.crumple }, dist: (xf - L / 2) * 0 + 1 });
  const spin = -(s.wx / c.wr) % (Math.PI * 2);
  for (const ax of c.axles) for (const sgn of [1, -1]) {
    const m = M4.model(xf + ax, c.wr, sgn * c.track, 0, spin, 1, 1, sgn);
    lists.opaque.push({ mesh: car.wheel, model: m, mat: { glow: gw } });
    lists.mirror.push({ mesh: car.wheel, model: m, mat: { glow: gw } });
  }
  // contact shadow
  lists.flats.push({ model: M4.model(xf - L / 2, 0.014, 0, 0, 0, L * 0.62, c.hw * 1.05, 1, -Math.PI / 2), color: "#000000", alpha: 0.55, mode: 0 });
  // lights: spots, beams, glows, reflections
  for (const p of c.lights.head) {
    const x = xf + p[0], y = p[1], z = p[2];
    if (head > 0.05) {
      ctx.spot([x, y, z], [1, -0.07, z * 0.02], 15 * head, 0.9);
      lists.beams.push({ mesh: misc.beam, model: M4.mul(M4.model(x + 0.05, y, z, -z * 0.02, -0.07), M4.model(0, 0, 0, 0, 0, 26, 3.2, 3.2)), color: "#fff3dc", alpha: (0.03 + 0.1 * (env.fogDen * 160)) * head, mode: 3, additive: true });
      ctx.glow(x + 0.08, y, z, 0.9, [1, 0.96, 0.88], 0.8 * head, 4);
      if (env.wet > 0.2) ctx.streak(x + 1.2, z, [1, 0.95, 0.85], 0.25 * head * env.wet);
    }
  }
  for (const p of c.lights.tail) {
    const x = xf + p[0], y = p[1], z = p[2];
    const a = s.brake ? 0.9 : 0.2 * head;
    if (a > 0.02) {
      ctx.glow(x - 0.05, y, z, s.brake ? 0.9 : 0.5, [1, 0.06, 0.03], a, 1);
      if (env.wet > 0.2) ctx.streak(x - 1.0, z, [1, 0.1, 0.05], a * 0.4 * env.wet);
    }
    if (s.hazard) ctx.glow(x - 0.05, y - 0.06, z * 1.05, 0.45, [1, 0.5, 0.05], 0.85, 1);
  }
  if (s.hazard) for (const p of c.lights.head) ctx.glow(xf + p[0] + 0.05, p[1] - 0.05, p[2] * 1.15, 0.4, [1, 0.5, 0.05], 0.85, 1);
}

function drawLabels(list, vp, W, H) {
  const host = $("v3-labels");
  if (!prefs.labels && !list.some((l) => l.cls === "lock")) { host.innerHTML = ""; return; }
  while (host.children.length < list.length) host.appendChild(document.createElement("div"));
  while (host.children.length > list.length) host.lastChild.remove();
  list.forEach((l, i) => {
    const el = host.children[i];
    const [x, y, , w] = M4.apply(vp, l.x, l.y, l.z);
    el.className = "v3-tag " + (l.cls || "");
    if (el.dataset.html !== l.html) { el.innerHTML = l.html; el.dataset.html = l.html; }
    el.style.display = w > 0 && Math.abs(x) < 1.2 && Math.abs(y) < 1.2 ? "" : "none";
    el.style.left = `${(x * 0.5 + 0.5) * W}px`;
    el.style.top = `${(-y * 0.5 + 0.5) * H}px`;
  });
}

function playbar(st) {
  const pl = $("pb-play"), live = $("pb-live");
  pl.textContent = pb.mode === "review" && pb.paused ? "▶" : "⏸";
  live.classList.toggle("on", pb.mode === "live");
  if (st && document.activeElement !== $("pb-scrub")) {
    const span = Math.max(1e-6, st.tLast - st.t0);
    $("pb-scrub").value = (st.t - st.t0) / span;
  }
  $("pb-t").textContent = st ? `${st.t.toFixed(2)} / ${st.tLast.toFixed(1)} s` : "–";
  if (prefs.fps) {
    const T = R.targets;
    $("v3-stats").textContent = `${fpsS.fps.toFixed(0)} fps · ${R.stats.draws} draws · ${(R.stats.tris / 1e6).toFixed(2)} M tris · ${R.canvas.width}×${R.canvas.height}${T?.float ? " HDR" : ""}${T?.samples ? ` MSAA×${T.samples}` : ""}`;
  }
}

function hud(st) {
  const set = (id, v) => { const e = $(id); if (e.innerHTML !== v) e.innerHTML = v; };
  const sel = $("v3-scn");
  if (document.activeElement !== sel) {
    const p = api.cfgVal("scenario", "preset", "S3");
    if (sel.value !== p) sel.value = p;
    $("v3-desc").textContent = SCN_DESC[sel.value] || "";
  }
  if (!st) { for (const id of ["h-v", "h-vset", "h-d", "h-a", "h-lv", "h-t"]) set(id, "–"); return; }
  set("h-v", `${(st.v * 3.6).toFixed(0)}<small>km/h</small>`);
  set("h-v2", `${st.v.toFixed(2)} m/s${st.rpm != null && prefs.plant === "ice" ? ` · ${st.rpm.toFixed(0)} rpm` : ""}`);
  const vs = st.vset ?? 0;
  set("h-vset", `${(vs * 3.6).toFixed(0)}<small>km/h</small>`);
  set("h-vset2", `${vs.toFixed(1)} m/s · error ${(vs - st.v).toFixed(2)}`);
  if (st.leadOn) {
    const ratio = st.target && st.dref > 0 ? st.d / st.dref : null;
    set("h-d", `${Math.max(0, st.d).toFixed(1)}<small>m</small>${st.target ? `<small>/ ${st.dref.toFixed(1)} m</small>` : ""}`);
    const bar = $("h-dbar");
    bar.style.width = ratio == null ? "100%" : `${Math.min(100, ratio * 50)}%`;
    bar.style.background = ratio == null ? "var(--muted)" : ratio < 0.5 ? "var(--bad)" : ratio < 0.95 ? "var(--warn)" : "var(--ok)";
    set("h-lv", `${(st.leadV * 3.6).toFixed(0)}<small>km/h</small>`);
    set("h-la", `${(st.leadA ?? 0).toFixed(2)} m/s²${(st.leadA ?? 0) < -0.3 ? " · braking" : ""}`);
  } else {
    set("h-d", "—<small>no car ahead</small>"); $("h-dbar").style.width = "0";
    set("h-lv", "—"); set("h-la", "");
  }
  set("h-a", `${st.a >= 0 ? "+" : ""}${st.a.toFixed(2)}<small>m/s²</small>`);
  set("h-brk", (st.Fb ?? 0) > 50 ? `<span style="color:var(--bad)">● brakes ${(st.Fb / 1000).toFixed(1)} kN</span>` : "brakes off");
  const mode = $("h-mode");
  mode.textContent = st.collided ? "COLLISION" : st.follow ? "distance loop" : "speed loop";
  mode.className = "badge " + (st.collided ? "bad" : st.follow ? "accent" : "ok");
  set("h-mode2", st.target ? "target detected" : st.leadOn ? "leader out of radar range" : "no target");
  set("h-t", `${st.t.toFixed(1)}<small>s</small>`);
  $("h-tbar").style.width = st.duration > 0 ? `${Math.min(100, 100 * st.t / st.duration)}%` : "100%";
}

function savePicture() {
  try {
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `ktrl_3d_${prefs.plant}_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      api.toast("Picture saved");
    }, "image/png");
  } catch (e) { api.toast(`Could not save the picture: ${e.message}`, true); }
}
