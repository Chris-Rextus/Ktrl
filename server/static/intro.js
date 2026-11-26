// Ktrl intro: the title screen shown when the viewer starts.
//
// The Ktrl logo is the Lorenz attractor. It is drawn here by a small
// self-contained WebGL2 renderer (HDR lines, dual-kawase bloom, procedural
// backdrop): a 60-time-unit trajectory that draws itself, light pulses running
// along it, and 24 live trajectories started 0.02 apart that drift apart
// (sensitive dependence on initial conditions). One Start button (or Enter):
// the button bursts, an iris opens on the app (Physics tab) and the attractor
// unwinds and flies into the top-bar logo.
//
// Exports
//   playIntro({ logo, onReveal, onDone })  show the intro; onReveal when the app
//                                          starts to show, onDone when it is gone
//   mountLogo(el, onClick)                 put the Lorenz logo in the top bar (+ favicon)

// ================================================================== Lorenz system
const SIG = 10, RHO = 28, BETA = 8 / 3, ZC = 24;   // world: X = x, Y = z − 24, Z = −y
const H_RIB = 0.003, N_RIB = 20000, LOGO_TU = 8, PAD = 13;

function rk4(s, h) {
  const x = s[0], y = s[1], z = s[2];
  const ax = SIG * (y - x), ay = x * (RHO - z) - y, az = x * y - BETA * z;
  let X = x + 0.5 * h * ax, Y = y + 0.5 * h * ay, Z = z + 0.5 * h * az;
  const bx = SIG * (Y - X), by = X * (RHO - Z) - Y, bz = X * Y - BETA * Z;
  X = x + 0.5 * h * bx; Y = y + 0.5 * h * by; Z = z + 0.5 * h * bz;
  const cx = SIG * (Y - X), cy = X * (RHO - Z) - Y, cz = X * Y - BETA * Z;
  X = x + h * cx; Y = y + h * cy; Z = z + h * cz;
  const dx = SIG * (Y - X), dy = X * (RHO - Z) - Y, dz = X * Y - BETA * Z;
  s[0] = x + h / 6 * (ax + 2 * bx + 2 * cx + dx);
  s[1] = y + h / 6 * (ay + 2 * by + 2 * cy + dy);
  s[2] = z + h / 6 * (az + 2 * bz + 2 * cz + dz);
}

// One long trajectory on the attractor; its first LOGO_TU time units are the logo.
let DATA = null;
function lorenz() {
  if (DATA) return DATA;
  const s = [0.1, 0, 0];
  for (let i = 0; i < 4000; i++) rk4(s, 0.005);          // transient
  const pts = new Float32Array(N_RIB * 4);
  for (let i = 0; i < N_RIB; i++) {
    pts[i * 4] = s[0]; pts[i * 4 + 1] = s[2] - ZC; pts[i * 4 + 2] = -s[1]; pts[i * 4 + 3] = i / (N_RIB - 1);
    rk4(s, H_RIB);
  }
  const nLogo = Math.round(LOGO_TU / H_RIB);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < nLogo; i++) {
    const X = pts[i * 4], Y = pts[i * 4 + 1];
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  }
  DATA = { pts, nLogo, sLogo: (nLogo - 1) / (N_RIB - 1), bb: { x0, x1, y0, y1 } };
  return DATA;
}

// SVG path of the logo (front view, x–z plane) in a 100 × 100 box.
function logoPath(step) {
  const D = lorenz(), { x0, x1, y0, y1 } = D.bb;
  const sc = (100 - 2 * PAD) / Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let d = "";
  for (let i = 0; i < D.nLogo; i += step) {
    d += (i ? "L" : "M") + (50 + (D.pts[i * 4] - cx) * sc).toFixed(1) + " " + (50 - (D.pts[i * 4 + 1] - cy) * sc).toFixed(1);
  }
  return d;
}
const GRAD = `<stop offset="0" stop-color="#4fd0ff"/><stop offset=".55" stop-color="#8fa8ff"/><stop offset="1" stop-color="#b98cff"/>`;
export function logoSVG(id = "lz-g") {
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${GRAD}</linearGradient></defs>` +
    `<path d="${logoPath(2)}" pathLength="1" fill="none" stroke="url(#${id})" stroke-width="1.15" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function faviconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" x2="1">${GRAD}</linearGradient></defs>` +
    `<rect width="100" height="100" rx="22" fill="#0b1020"/><path d="${logoPath(6)}" fill="none" stroke="url(#g)" stroke-width="3.2" stroke-linejoin="round"/></svg>`;
}

// ================================================================== styles
const CSS = `
@property --ia { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
#intro { position: fixed; inset: 0; z-index: 10000; overflow: hidden; background: #05070b; color: #dfe8ff;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  user-select: none; -webkit-user-select: none; --mx: 0; --my: 0; }
#intro.gl-on { background: transparent; }
#intro.leaving { pointer-events: none; }
#intro canvas.igl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#intro .iui { position: absolute; inset: 0; pointer-events: none; }
#intro .mono { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; }

/* ---- title */
#intro .ititle { position: absolute; left: 50%; top: 66.5%; text-align: center; white-space: nowrap;
  transform: translate(calc(-50% + var(--mx) * -7px), calc(-50% + var(--my) * 5px)); }
#intro h1 { margin: 0; font-weight: 200; font-size: clamp(40px, 7.4vh, 104px); line-height: 1; letter-spacing: .46em; padding-left: .46em; }
#intro h1 span { display: inline-block; color: var(--c);
  text-shadow: 0 0 18px color-mix(in srgb, var(--c) 65%, transparent), 0 0 52px color-mix(in srgb, var(--c) 35%, transparent);
  animation: i-let 1.3s cubic-bezier(.16,.84,.24,1) both; animation-delay: calc(1s + var(--i) * .1s); }
@keyframes i-let { from { opacity: 0; filter: blur(16px); transform: translateY(26px) scale(1.3); } }
#intro .isub { margin-top: 1.7vh; font-size: clamp(11px, 1.45vh, 15px); letter-spacing: .62em; padding-left: .62em; color: #a9bbdc;
  font-weight: 500; animation: i-fade 1.2s ease both 1.6s; }
#intro .idiv { margin: 1.5vh auto 0; display: flex; align-items: center; justify-content: center; gap: 10px;
  animation: i-grow 1.1s cubic-bezier(.2,.8,.2,1) both 1.8s; }
#intro .idiv i { height: 1px; width: 150px; background: linear-gradient(90deg, transparent, rgba(130,180,255,.75)); }
#intro .idiv i:last-child { transform: scaleX(-1); }
#intro .idiv b { width: 7px; height: 7px; transform: rotate(45deg); border: 1px solid #8fd0ff; box-shadow: 0 0 10px #5fc0ff; }
#intro .itag { margin-top: 1.4vh; font-size: clamp(11px, 1.3vh, 14px); color: #7f8fb0; letter-spacing: .08em;
  animation: i-fade 1.2s ease both 2s; }
@keyframes i-fade { from { opacity: 0; transform: translateY(8px); filter: blur(6px); } }
@keyframes i-grow { from { opacity: 0; transform: scaleX(.2); } }

/* ---- start button */
#intro .istart { position: absolute; left: 50%; top: 83%; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 18px; }
#intro .ib-wrap { position: relative; animation: i-btn 1.1s cubic-bezier(.2,.9,.25,1.15) both 2.25s; }
#intro .ib-wrap::before, #intro .ib-wrap::after { content: ""; position: absolute; top: 50%; width: min(16vw, 230px); height: 1px;
  background: linear-gradient(90deg, transparent, rgba(120,170,255,.6)); }
#intro .ib-wrap::before { right: calc(100% + 24px); }
#intro .ib-wrap::after { left: calc(100% + 24px); transform: scaleX(-1); }
@keyframes i-btn { from { opacity: 0; transform: scale(.7); filter: blur(12px); } }
#intro .ibtn { all: unset; box-sizing: border-box; position: relative; height: 64px; min-width: 272px; padding: 0 46px;
  border-radius: 999px; display: grid; place-items: center; cursor: pointer; isolation: isolate; pointer-events: auto;
  transition: transform .35s cubic-bezier(.2,.9,.3,1.4); -webkit-tap-highlight-color: transparent; }
#intro .ibtn .halo { position: absolute; inset: -12px; border-radius: inherit; z-index: -3; opacity: .5; filter: blur(20px);
  background: conic-gradient(from var(--ia), #3fd2ff, #6c7cff, #c46bff, #ff9d6b, #3fd2ff);
  animation: i-spin 4.5s linear infinite, i-breathe 2.8s ease-in-out infinite; transition: opacity .3s, inset .3s; }
#intro .ibtn .ring { position: absolute; inset: 0; border-radius: inherit; padding: 1.6px; z-index: -1;
  background: conic-gradient(from var(--ia), #3fd2ff, #6c7cff, #c46bff, #ff9d6b, #3fd2ff);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
  animation: i-spin 4.5s linear infinite; }
#intro .ibtn .glass { position: absolute; inset: 1.6px; border-radius: inherit; z-index: -2; overflow: hidden;
  background: radial-gradient(130% 150% at 50% -10%, rgba(92,128,210,.40), rgba(10,14,24,.9) 62%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 0 24px rgba(80,140,255,.22); }
#intro .ibtn .glass::after { content: ""; position: absolute; top: -20%; bottom: -20%; width: 38%; left: -50%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.24), transparent); transform: skewX(-18deg);
  animation: i-sweep 3.6s cubic-bezier(.4,0,.2,1) infinite 3.5s; }
@keyframes i-sweep { 0% { left: -50%; } 45%, 100% { left: 130%; } }
#intro .ibtn .lbl { display: flex; align-items: center; gap: 18px; font-size: 18px; font-weight: 600; letter-spacing: .55em;
  padding-left: .55em; color: #f1f6ff; text-shadow: 0 0 14px rgba(120,190,255,.75); }
#intro .ibtn .lbl svg { width: 12px; height: 14px; margin-left: -.3em; filter: drop-shadow(0 0 6px #6fd0ff); }
#intro .ibtn:hover { transform: scale(1.05); }
#intro .ibtn:hover .halo { opacity: .95; inset: -18px; }
#intro .ibtn:active { transform: scale(.96); transition-duration: .08s; }
#intro .ibtn:focus-visible .ring { padding: 2.6px; }
@keyframes i-spin { to { --ia: 360deg; } }
@keyframes i-breathe { 50% { filter: blur(28px); } }
#intro .ihint { font-size: 11px; letter-spacing: .42em; padding-left: .42em; color: #8798bb;
  animation: i-fade 1s ease both 3s, i-blink 2.4s ease-in-out infinite 4s; }
#intro .ihint kbd { font: inherit; color: #d3e4ff; border: 1px solid rgba(140,180,255,.35); border-radius: 4px;
  padding: 1px 1px 1px 6px; margin: 0 3px; }
@keyframes i-blink { 50% { opacity: .35; } }

/* ---- corners */
#intro .ihud { position: absolute; left: 28px; top: 24px; font-size: 12px; color: #8b9bbb; line-height: 1.55;
  animation: i-fade 1.2s ease both .7s; }
#intro .ihud .ht { font-size: 10.5px; letter-spacing: .32em; color: #b4c6ea; margin-bottom: 7px; display: flex; align-items: center; gap: 9px; }
#intro .ihud .ht i { width: 6px; height: 6px; border-radius: 50%; background: #5fd4ff; box-shadow: 0 0 8px #5fd4ff; animation: i-blink 1.6s infinite; }
#intro .ihud .eq { font-family: "Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman", serif; font-style: italic;
  font-size: 15.5px; color: #d6e2ff; line-height: 1.5; }
#intro .ihud .eq u { text-decoration: none; font-style: normal; }
#intro .ihud .pr { margin-top: 5px; }
#intro .ihud .lv { margin-top: 9px; font-size: 11px; color: #7c8db0; }
#intro .ihud .lv b { color: #cfe0ff; font-weight: 500; display: inline-block; min-width: 50px; }
#intro .iboot { position: absolute; left: 28px; bottom: 24px; font-size: 11px; color: #7d8db0; line-height: 1.8; }
#intro .iboot .bl { display: grid; grid-template-columns: 14px 118px 300px 64px; align-items: baseline;
  animation: i-type .45s steps(16, end) both; animation-delay: calc(.5s + var(--i) * .2s); }
@keyframes i-type { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
#intro .iboot .bk { color: #5fd4ff; }
#intro .iboot .bn { color: #b9c8e6; }
#intro .iboot .bd { color: #64759a; white-space: nowrap; overflow: hidden; }
#intro .iboot .bs { color: #6ff0b4; text-align: right; font-weight: 600; letter-spacing: .12em;
  animation: i-fade .3s ease both; animation-delay: calc(.9s + var(--i) * .2s); }
#intro .iboot .bs.warn { color: #ffc46b; }
#intro .iboot .bs.wait { color: #8fa0c4; }
#intro .ifoot { position: absolute; right: 28px; bottom: 24px; font-size: 11px; letter-spacing: .22em; color: #5f6e8e; text-align: right;
  line-height: 1.8; animation: i-fade 1.2s ease both 1.3s; }
#intro .itr { position: absolute; right: 24px; top: 22px; display: flex; gap: 10px; animation: i-fade 1s ease both 1.1s; }
#intro .iic { all: unset; pointer-events: auto; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  cursor: pointer; color: #b7c7e8; border: 1px solid rgba(130,170,255,.22); background: rgba(14,20,34,.55);
  backdrop-filter: blur(6px); transition: color .2s, border-color .2s, box-shadow .2s; }
#intro .iic:hover { color: #fff; border-color: rgba(130,190,255,.6); box-shadow: 0 0 14px rgba(90,170,255,.35); }
#intro .iic.off { color: #5d6a86; }
#intro .iic svg { width: 16px; height: 16px; }

@media (max-width: 1500px) { #intro .iboot .bl { grid-template-columns: 14px 118px 64px; } #intro .iboot .bd { display: none; } }
@media (max-width: 1100px) { #intro .ib-wrap::before, #intro .ib-wrap::after { display: none; } }
@media (max-width: 820px), (max-height: 560px) { #intro .iboot, #intro .ifoot { display: none; } }
@media (max-width: 640px) { #intro .ihud { display: none; } #intro .ibtn { min-width: 220px; } }

/* ---- leaving */
#intro.leaving h1 span { animation: i-let-out .6s cubic-bezier(.55,0,.75,.2) both; animation-delay: calc(var(--j) * .05s); }
@keyframes i-let-out { to { opacity: 0; filter: blur(14px); transform: translate(var(--lx), -44px) scale(.8); } }
#intro.leaving .isub, #intro.leaving .idiv, #intro.leaving .itag, #intro.leaving .ihint,
#intro.leaving .ihud, #intro.leaving .iboot, #intro.leaving .ifoot, #intro.leaving .itr { animation: i-out .42s ease both; }
@keyframes i-out { to { opacity: 0; transform: translateY(-10px); filter: blur(8px); } }
#intro.leaving .ib-wrap { animation: i-launch .62s cubic-bezier(.3,0,.5,1) both; }
@keyframes i-launch { 0% { transform: scale(1); } 22% { transform: scale(.93); }
  55% { transform: scale(1.12); opacity: 1; filter: brightness(1.9); } 100% { transform: scale(1.45); opacity: 0; filter: brightness(2.6) blur(8px); } }
#intro .iripple { position: absolute; width: 0; height: 0; pointer-events: none; }
#intro .iripple i { position: absolute; left: -70px; top: -70px; width: 140px; height: 140px; border-radius: 50%;
  border: 2px solid rgba(140,210,255,.9); box-shadow: 0 0 26px rgba(110,190,255,.8), inset 0 0 26px rgba(110,190,255,.5);
  animation: i-rip 1s cubic-bezier(.2,.7,.3,1) both; }
#intro .iripple i:nth-child(2) { animation-delay: .12s; border-color: rgba(200,160,255,.85); }
@keyframes i-rip { from { transform: scale(.35); opacity: 1; } to { transform: scale(7); opacity: 0; } }

/* ---- app entrance after Start */
.intro-in { animation: intro-in .9s cubic-bezier(.2,.75,.25,1) both; animation-delay: var(--d, 0s); }
@keyframes intro-in { from { opacity: 0; transform: translate(var(--dx, 0px), var(--dy, 10px)) scale(var(--sc, 1)); } }

/* ---- top-bar logo */
.brand .logo.lorenz { background: radial-gradient(120% 120% at 30% 20%, #1c2843, #0a0e18 70%); border: 1px solid rgba(120,160,255,.3);
  box-shadow: inset 0 0 8px rgba(80,140,255,.2); padding: 0; overflow: hidden; cursor: pointer; transition: opacity .45s ease; }
.brand .logo.lorenz svg { width: 100%; height: 100%; display: block; filter: drop-shadow(0 0 1.5px rgba(110,190,255,.85)); }
.brand .logo.lorenz path { stroke-dasharray: 1 0; }
.brand .logo.lorenz:hover path { animation: lz-trace 1.6s ease-in-out; }
@keyframes lz-trace { from { stroke-dasharray: 0 1; } to { stroke-dasharray: 1 0; } }
.brand .logo.lorenz.intro-hide { opacity: 0; transition: none; }
.brand .logo.lorenz.arrive { animation: lz-arrive 1.2s ease-out; }
@keyframes lz-arrive { 25% { box-shadow: 0 0 20px 3px rgba(100,180,255,.6), inset 0 0 10px rgba(120,190,255,.5); } }
`;
let cssDone = false;
function injectCSS() {
  if (cssDone) return;
  cssDone = true;
  const st = document.createElement("style");
  st.id = "intro-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

// ================================================================== top-bar logo
export function mountLogo(el, onClick) {
  injectCSS();
  if (el) {
    el.classList.add("lorenz");
    el.innerHTML = logoSVG("lz-brand");
    el.title = "Ktrl · click to replay the intro";
    if (onClick) el.addEventListener("click", onClick);
  }
  let link = document.querySelector("link[rel~='icon']");
  if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
  link.type = "image/svg+xml";
  link.href = "data:image/svg+xml," + encodeURIComponent(faviconSVG());
}

// ================================================================== markup
const BOOT = [
  ["Renderer", "WebGL2 · HDR glow · bloom", "gl"],
  ["Vehicle body", "m = 1940 kg · C<sub>x</sub> = 0.50 · r<sub>w</sub> = 0.30 m", ""],
  ["ICE plant §3", "throttle · manifold · engine · gearbox", ""],
  ["EV plant §4", "battery · converter · DC motor", ""],
  ["Lower level", "θ<sub>th</sub> map · i<sub>a</sub> loop · brakes", ""],
  ["Collision", "contact · impact · crumple", ""],
  ["Server link", "WebSocket /ws", "srv"],
];
const ICON_SND_ON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" fill="currentColor" fill-opacity=".25"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8" stroke-linecap="round"/></svg>`;
const ICON_SND_OFF = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" fill="currentColor" fill-opacity=".25"/><path d="M11 6l3.5 4M14.5 6L11 10" stroke-linecap="round"/></svg>`;
const ICON_FS = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>`;

function markup(sound) {
  const L = [["K", "#7fd6ff"], ["T", "#cfe6ff"], ["R", "#e2d9ff"], ["L", "#b597ff"]];
  const letters = L.map(([c, col], i) =>
    `<span style="--i:${i};--j:${Math.abs(i - 1.5) - 0.5};--lx:${((i - 1.5) * 30).toFixed(0)}px;--c:${col}">${c}</span>`).join("");
  const boot = BOOT.map(([n, d, k], i) =>
    `<div class="bl mono" style="--i:${i}"><span class="bk">›</span><span class="bn">${n}</span><span class="bd">${d}</span>` +
    `<span class="bs${k === "srv" ? " wait" : ""}" data-k="${k}">${k === "srv" ? "· · ·" : "OK"}</span></div>`).join("");
  return `
  <canvas class="igl"></canvas>
  <div class="iui">
    <div class="ihud">
      <div class="ht"><i></i>LORENZ ATTRACTOR</div>
      <div class="eq">ẋ <u>=</u> σ (y <u>−</u> x)<br>ẏ <u>=</u> x (ρ <u>−</u> z) <u>−</u> y<br>ż <u>=</u> x y <u>−</u> β z</div>
      <div class="pr mono">σ = 10 · ρ = 28 · β = 8/3</div>
      <div class="lv mono">t <b data-v="t">0.00</b> x <b data-v="x"></b> y <b data-v="y"></b> z <b data-v="z"></b></div>
      <div class="lv mono" style="margin-top:2px">24 trajectories · δ₀ = 0.02 → spread <b data-v="sp">0.02</b></div>
    </div>
    <div class="itr">
      <button class="iic${sound ? "" : " off"}" data-a="snd" title="Sound">${sound ? ICON_SND_ON : ICON_SND_OFF}</button>
      <button class="iic" data-a="fs" title="Full screen">${ICON_FS}</button>
    </div>
    <div class="ititle">
      <h1>${letters}</h1>
      <div class="isub">ADAPTIVE CRUISE CONTROL SIMULATOR</div>
      <div class="idiv"><i></i><b></b><i></i></div>
      <div class="itag">ICE &amp; EV plants · nonlinear longitudinal dynamics · collision physics</div>
    </div>
    <div class="istart">
      <div class="ib-wrap">
        <button class="ibtn" type="button" aria-label="Start">
          <span class="halo"></span><span class="glass"></span><span class="ring"></span>
          <span class="lbl"><svg viewBox="0 0 12 14"><path d="M1 1l10 6-10 6z" fill="#e9f4ff"/></svg>START</span>
        </button>
      </div>
      <div class="ihint">PRESS <kbd>ENTER</kbd></div>
    </div>
    <div class="iboot">${boot}</div>
    <div class="ifoot">KTRL · ACC SIMULATOR<br>BUILD 2026.11</div>
  </div>`;
}

// ================================================================== WebGL2 renderer
const PROJ = `
uniform mat4 uVP;
uniform vec2 uOrthoS;
uniform float uOrtho;
uniform vec4 uX;
uniform vec2 uRes;
vec3 toPx(vec3 p) {
  vec4 c = uVP * vec4(p, 1.0);
  vec2 n = mix(c.xy / max(c.w, 1e-3), p.xy * uOrthoS, uOrtho);
  n = n * uX.xy + uX.zw;
  return vec3((n * 0.5 + 0.5) * uRes, c.w);
}`;

// thick line segments, one instance per segment (p0 = point i, p1 = point i+1)
const SEG_VS = `#version 300 es
layout(location = 0) in vec2 aC;
layout(location = 1) in vec4 aA;
layout(location = 2) in vec4 aB;
${PROJ}
uniform float uW;
uniform int uMode;
uniform int uTN;
out float vSide; out float vS; out vec3 vP; out float vD;
flat out int vK; flat out float vKill;
void main() {
  vec3 a = toPx(aA.xyz), b = toPx(aB.xyz);
  vec2 d = b.xy - a.xy;
  float L = length(d);
  vec2 t = L > 1e-3 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  vec3 P = mix(a, b, aC.x);
  vec2 px = P.xy + n * aC.y * uW;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vSide = aC.y; vS = mix(aA.w, aB.w, aC.x); vP = mix(aA.xyz, aB.xyz, aC.x); vD = P.z;
  vK = gl_InstanceID / max(uTN, 1);
  vKill = (uMode == 1 && (aA.w > 1.5 || aB.w > 1.5)) ? 1.0 : 0.0;
}`;
const SEG_FS = `#version 300 es
precision highp float;
precision highp int;
in float vSide; in float vS; in vec3 vP; in float vD;
flat in int vK; flat in float vKill;
uniform int uMode;
uniform float uI, uReveal, uKeep, uPhase, uEnergy, uTrailA, uD0, uD1;
out vec4 o;
vec3 pal(vec3 p) {
  vec3 c = mix(vec3(0.20, 0.70, 1.00), vec3(0.66, 0.42, 1.00), smoothstep(-13.0, 13.0, p.x));
  c = mix(c, vec3(1.00, 0.62, 0.42), 0.5 * smoothstep(-9.0, -19.0, p.y));
  c = mix(c, vec3(0.86, 0.94, 1.00), 0.3 * smoothstep(12.0, 22.0, p.y));
  return c;
}
void main() {
  if (vKill > 0.5) discard;
  float prof = exp(-vSide * vSide * 3.2);
  float fog = 1.0 - 0.6 * smoothstep(uD0, uD1, vD);
  if (uMode == 0) {
    float lim = min(uReveal, uKeep);
    if (vS > lim) discard;
    vec3 c = pal(vP);
    float pb = 0.0;
    for (int i = 0; i < 7; i++) {
      float d = fract(fract(uPhase + float(i) / 7.0) - vS);
      pb += exp(-d * 220.0);
    }
    float tip = lim < 0.9999 ? exp(-(lim - vS) * 700.0) * 12.0 : 0.0;
    vec3 col = c * uI * (1.0 + 0.8 * uEnergy) + mix(c, vec3(1.0), 0.55) * (pb * (0.32 + 1.3 * uEnergy) + tip);
    o = vec4(col * prof * fog, 0.0);
  } else {
    int k = vK - 3 * (vK / 3);
    vec3 c = k == 0 ? vec3(0.45, 0.86, 1.0) : (k == 1 ? vec3(0.78, 0.58, 1.0) : vec3(1.0, 0.72, 0.48));
    float a = pow(max(1.0 - vS, 0.0), 1.7) * uTrailA;
    o = vec4(c * a * prof * fog * 1.3, 0.0);
  }
}`;
const PTS_VS = `#version 300 es
layout(location = 0) in vec4 aP;
layout(location = 1) in vec4 aC;
${PROJ}
uniform int uScreen;
uniform float uSize;
out vec4 vC;
void main() {
  vec2 px = aP.xy;
  if (uScreen == 0) px = toPx(aP.xyz).xy;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = max(uSize * aP.w, 1.0);
  vC = aC;
}`;
const PTS_FS = `#version 300 es
precision highp float;
in vec4 vC;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 9.0) + 0.22 * exp(-r2 * 2.5);
  o = vec4(vC.rgb * vC.a * g * (1.0 - r2), 0.0);
}`;
const FS_VS = `#version 300 es
layout(location = 0) in vec2 aP;
out vec2 vUv;
void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uT;
uniform vec2 uHp;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 s = texture(uT, vUv).rgb * 4.0;
  s += texture(uT, vUv - uHp).rgb + texture(uT, vUv + uHp).rgb;
  s += texture(uT, vUv + vec2(uHp.x, -uHp.y)).rgb + texture(uT, vUv - vec2(uHp.x, -uHp.y)).rgb;
  o = vec4(s / 8.0, 1.0);
}`;
const UP_FS = `#version 300 es
precision highp float;
uniform sampler2D uT, uAdd;
uniform vec2 uHp;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 s = texture(uT, vUv + vec2(-2.0 * uHp.x, 0.0)).rgb + texture(uT, vUv + vec2(2.0 * uHp.x, 0.0)).rgb;
  s += texture(uT, vUv + vec2(0.0, 2.0 * uHp.y)).rgb + texture(uT, vUv + vec2(0.0, -2.0 * uHp.y)).rgb;
  s += 2.0 * (texture(uT, vUv + uHp).rgb + texture(uT, vUv - uHp).rgb);
  s += 2.0 * (texture(uT, vUv + vec2(uHp.x, -uHp.y)).rgb + texture(uT, vUv + vec2(-uHp.x, uHp.y)).rgb);
  o = vec4(s / 12.0 + texture(uAdd, vUv).rgb, 1.0);
}`;
// final pass: procedural backdrop (sky, nebula, stars, road grid, HUD arcs),
// glow (scene + bloom, tone mapped), iris opening onto the app
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene, uBloom;
uniform vec2 uRes, uMouse, uCenter;
uniform float uTime, uRingR, uRingA, uIrisGlow, uFade, uGlowA, uEnergy, uBloomK, uHz, uScroll, uDpr;
uniform vec3 uIris;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
vec3 stars(vec2 p, float dens, float sz) {
  vec2 g = p * dens, id = floor(g), f = fract(g) - 0.5;
  float h = h21(id);
  vec2 off = (vec2(h21(id + 3.1), h21(id + 7.7)) - 0.5) * 0.7;
  float d = length(f - off);
  float tw = 0.6 + 0.4 * sin(uTime * (0.8 + 2.5 * h21(id + 1.3)) + h * 60.0);
  float b = smoothstep(sz, 0.0, d) * tw * smoothstep(0.92, 1.0, h);
  return mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.86, 0.72), h21(id + 9.1)) * b * 1.6;
}
vec3 bg(vec2 fc) {
  vec2 uv = fc / uRes;
  vec2 p = (fc - 0.5 * uRes) / uRes.y;
  vec2 q = p + uMouse * 0.012;
  vec3 col = mix(vec3(0.034, 0.044, 0.074), vec3(0.008, 0.010, 0.020), smoothstep(uHz, 1.0, uv.y));
  float n1 = fbm(q * 1.6 + vec2(uTime * 0.010, -uTime * 0.004));
  float n2 = fbm(q * 2.4 - vec2(uTime * 0.006, 0.0) + 5.3);
  col += vec3(0.045, 0.075, 0.17) * pow(n1, 2.6) * 1.1;
  col += vec3(0.11, 0.045, 0.15) * pow(n2, 3.6) * 1.0;
  vec2 hc = (fc - uCenter) / uRes.y;
  col += vec3(0.06, 0.10, 0.24) * exp(-dot(hc, hc) * 7.5) * (0.6 + 0.8 * uEnergy);
  float above = smoothstep(uHz, uHz + 0.10, uv.y);
  col += (stars(q + uMouse * 0.010, 46.0, 0.10) + 0.7 * stars(q + uMouse * 0.022 + 3.7, 95.0, 0.13)) * above;
  if (uv.y < uHz) {                       // road grid: eye 1.6 m, two lanes, scrolling
    float yy = uHz - uv.y;
    float z = 1.92 / yy;
    float X = p.x * z / 1.2;
    float Z = z + uScroll;
    vec2 gw = vec2(X / 3.6, Z / 6.0);
    vec2 fw = fwidth(gw);
    vec2 gd = abs(fract(gw - 0.5) - 0.5) / max(fw, vec2(1e-4));
    float grid = (1.0 - min(min(gd.x, gd.y), 1.0)) * (1.0 - smoothstep(0.2, 0.7, max(fw.x, fw.y)));
    float fade = exp(-z * 0.016) * smoothstep(0.0, 0.015, yy);
    float fx = fwidth(X), lw = 0.075;
    float solid = 1.0 - smoothstep(lw, lw + fx, abs(abs(X) - 5.4));
    float dash = (1.0 - smoothstep(lw, lw + fx, abs(abs(X) - 1.8))) * step(fract(Z / 12.0), 0.25);
    col += vec3(0.13, 0.26, 0.60) * grid * fade * 0.5;
    col += vec3(0.55, 0.70, 1.0) * (solid + dash) * fade * 0.45;
    col += vec3(0.05, 0.09, 0.20) * exp(-abs(p.x) * 2.5) * exp(-yy * 10.0) * 0.8;
  }
  float hd = abs(uv.y - uHz);
  col += vec3(0.20, 0.38, 0.85) * (exp(-hd * 300.0) * 0.28 + exp(-hd * 24.0) * 0.06);
  vec2 rc = fc - uCenter;
  float r = length(rc), ca = abs(rc.x) / max(r, 1e-3), ang = atan(rc.y, rc.x);
  float side = smoothstep(0.80, 0.86, ca);
  float arc1 = exp(-pow((r - uRingR) / (1.1 * uDpr), 2.0)) * side;
  float arc2 = exp(-pow((r - uRingR * 1.05) / (0.9 * uDpr), 2.0)) * smoothstep(0.90, 0.93, ca);
  float tk = step(fract(ang / 6.28318 * 90.0), 0.16) * step(abs(r - uRingR * 1.1), 5.0 * uDpr) * smoothstep(0.84, 0.88, ca);
  float run = step(0.8, fract(ang / 6.28318 * 3.0 + uTime * 0.05)) * exp(-pow((r - uRingR * 0.95) / (1.2 * uDpr), 2.0)) * side;
  col += vec3(0.36, 0.58, 1.0) * (arc1 * 0.16 + arc2 * 0.10 + tk * 0.12 + run * 0.22) * uRingA;
  vec2 vq = (uv - 0.5) * vec2(1.0, 1.15);
  col *= 1.0 - 0.75 * dot(vq, vq);
  return col;
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec3 g = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomK;
  g = (1.0 - exp(-g * 1.1)) * uGlowA;
  vec3 b = max(bg(fc) * uFade + (h21(fc + fract(uTime * 7.0) * 91.0) - 0.5) * (2.5 / 255.0), 0.0);
  float A = 1.0;
  if (uIris.z > 0.0) {
    float r = length(fc - uIris.xy);
    A = smoothstep(uIris.z - 1.5 * uDpr, uIris.z + 1.5 * uDpr, r);
    float w = 3.0 * uDpr + uIris.z * 0.02;
    g += vec3(0.42, 0.72, 1.0) * exp(-pow((r - uIris.z) / w, 2.0)) * uIrisGlow;
    g += vec3(0.30, 0.45, 1.0) * exp(-max(uIris.z - r, 0.0) / (w * 8.0)) * (1.0 - A) * uIrisGlow * 0.18;
  }
  g = clamp(g, 0.0, 1.0);
  float ga = max(g.r, max(g.g, g.b));
  o = vec4(b * A + g, A + ga * (1.0 - A));
}`;

function createGL(canvas, D, K, TN, MAXS) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
                                            stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  let hdr = !!gl.getExtension("EXT_color_buffer_float");

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  const pSeg = program(SEG_VS, SEG_FS), pPts = program(PTS_VS, PTS_FS);
  const pDown = program(FS_VS, DOWN_FS), pUp = program(FS_VS, UP_FS), pComp = program(FS_VS, COMP_FS);

  const buffer = (data, usage = gl.STATIC_DRAW) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return b;
  };
  const quad = buffer(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]));
  const ribbon = buffer(D.pts);
  const trailData = new Float32Array(K * TN * 4), trail = buffer(trailData, gl.DYNAMIC_DRAW);
  const headData = new Float32Array(K * 8), heads = buffer(headData, gl.DYNAMIC_DRAW);
  const sparkData = new Float32Array(MAXS * 8), sparks = buffer(sparkData, gl.DYNAMIC_DRAW);
  const tri = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));

  const segVao = (b) => {
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return v;
  };
  const ptsVao = (b) => {
    const v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    return v;
  };
  const vRibbon = segVao(ribbon), vTrail = segVao(trail), vHeads = ptsVao(heads), vSparks = ptsVao(sparks);
  const vTri = gl.createVertexArray();
  gl.bindVertexArray(vTri);
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // render targets: scene (full size) and the bloom chain (1/2 … 1/32)
  let W = 0, H = 0, scene = null, down = [], up = [];
  const target = (w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, fb, w, h, ok };
  };
  const free = (r) => { if (r) { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); } };
  function resize(w, h) {
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.width = w; canvas.height = h;
    free(scene); down.forEach(free); up.forEach(free);
    scene = target(w, h);
    if (!scene.ok && hdr) { hdr = false; free(scene); scene = target(w, h); }
    down = []; up = [];
    let lw = w, lh = h;
    for (let i = 0; i < 5; i++) {
      lw = Math.max(1, Math.ceil(lw / 2)); lh = Math.max(1, Math.ceil(lh / 2));
      down.push(target(lw, lh));
      if (i < 4) up.push(target(lw, lh));
    }
  }

  const tex = (unit, r) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, r.t); };
  const pass = (P, src, dst, add) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(P.p);
    tex(0, src); gl.uniform1i(P.u.uT, 0);
    if (add) { tex(1, add); gl.uniform1i(P.u.uAdd, 1); }
    gl.uniform2f(P.u.uHp, 1 / src.w, 1 / src.h);
    gl.bindVertexArray(vTri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const proj = (P, s) => {
    gl.uniformMatrix4fv(P.u.uVP, false, s.VP);
    gl.uniform2f(P.u.uOrthoS, s.orthoS[0], s.orthoS[1]);
    gl.uniform1f(P.u.uOrtho, s.ortho);
    gl.uniform4f(P.u.uX, s.X[0], s.X[1], s.X[2], s.X[3]);
    gl.uniform2f(P.u.uRes, W, H);
  };

  function render(s) {
    // --- glow scene (additive HDR)
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(pSeg.p);
    proj(pSeg, s);
    const u = pSeg.u;
    gl.uniform1f(u.uW, s.lineW);
    gl.uniform1f(u.uI, s.I);
    gl.uniform1f(u.uReveal, s.reveal);
    gl.uniform1f(u.uKeep, s.keep);
    gl.uniform1f(u.uPhase, s.phase);
    gl.uniform1f(u.uEnergy, s.energy);
    gl.uniform1f(u.uTrailA, s.trailA);
    gl.uniform1f(u.uD0, s.d0); gl.uniform1f(u.uD1, s.d1);
    gl.uniform1i(u.uMode, 0); gl.uniform1i(u.uTN, TN);
    gl.bindVertexArray(vRibbon);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, D.pts.length / 4 - 1);
    if (s.trailA > 0.002) {
      gl.bindBuffer(gl.ARRAY_BUFFER, trail); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.trail);
      gl.uniform1i(u.uMode, 1);
      gl.uniform1f(u.uW, s.lineW * 1.15);
      gl.bindVertexArray(vTrail);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, K * TN - 1);
    }
    gl.useProgram(pPts.p);
    proj(pPts, s);
    if (s.trailA > 0.002) {
      gl.bindBuffer(gl.ARRAY_BUFFER, heads); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.heads);
      gl.uniform1i(pPts.u.uScreen, 0); gl.uniform1f(pPts.u.uSize, s.headSize);
      gl.bindVertexArray(vHeads); gl.drawArrays(gl.POINTS, 0, K);
    }
    if (s.nSparks) {
      gl.bindBuffer(gl.ARRAY_BUFFER, sparks); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.sparks, 0, s.nSparks * 8);
      gl.uniform1i(pPts.u.uScreen, 1); gl.uniform1f(pPts.u.uSize, s.sparkSize);
      gl.bindVertexArray(vSparks); gl.drawArrays(gl.POINTS, 0, s.nSparks);
    }
    gl.disable(gl.BLEND);
    // --- bloom (dual kawase)
    pass(pDown, scene, down[0]);
    for (let i = 1; i < 5; i++) pass(pDown, down[i - 1], down[i]);
    pass(pUp, down[4], up[3], down[3]);
    for (let i = 2; i >= 0; i--) pass(pUp, up[i + 1], up[i], down[i]);
    // --- composite to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(pComp.p);
    const c = pComp.u;
    tex(0, scene); gl.uniform1i(c.uScene, 0);
    tex(1, up[0]); gl.uniform1i(c.uBloom, 1);
    gl.uniform2f(c.uRes, W, H);
    gl.uniform2f(c.uMouse, s.mouse[0], s.mouse[1]);
    gl.uniform2f(c.uCenter, s.center[0], s.center[1]);
    gl.uniform1f(c.uTime, s.time);
    gl.uniform1f(c.uRingR, s.ringR); gl.uniform1f(c.uRingA, s.ringA);
    gl.uniform3f(c.uIris, s.iris[0], s.iris[1], s.iris[2]); gl.uniform1f(c.uIrisGlow, s.irisGlow);
    gl.uniform1f(c.uFade, s.fade); gl.uniform1f(c.uGlowA, s.glowA); gl.uniform1f(c.uEnergy, s.energy);
    gl.uniform1f(c.uBloomK, s.bloomK); gl.uniform1f(c.uHz, s.hz); gl.uniform1f(c.uScroll, s.scroll); gl.uniform1f(c.uDpr, s.dpr);
    gl.bindVertexArray(vTri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
  function destroy() {
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* already gone */ }
  }
  return { resize, render, destroy, trailData, headData, sparkData, get hdr() { return hdr; } };
}

// ================================================================== small math
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function persp(fovy, asp, n, f) {
  const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
  return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0];
}
function lookAt(e) {   // looking at the origin, y up
  let z = [e[0], e[1], e[2]];
  let l = Math.hypot(...z); z = z.map((v) => v / l);
  let x = [z[2], 0, -z[0]];                         // up × z
  l = Math.hypot(...x); x = x.map((v) => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const d = (a) => a[0] * e[0] + a[1] * e[1] + a[2] * e[2];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -d(x), -d(y), -d(z), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

// ================================================================== sound (Start only: browsers allow audio after a click)
const PREF = "ktrl.intro.v1";
const loadPrefs = () => { try { return Object.assign({ sound: true }, JSON.parse(localStorage.getItem(PREF)) || {}); } catch { return { sound: true }; } };
const savePrefs = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* private mode */ } };

function startSound() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ac = new AC(), t0 = ac.currentTime + 0.02;
  const master = ac.createGain(); master.gain.value = 0.3;
  const comp = ac.createDynamicsCompressor();
  master.connect(comp); comp.connect(ac.destination);
  // shimmer delay
  const dl = ac.createDelay(1), fb = ac.createGain(), lp = ac.createBiquadFilter(), wet = ac.createGain();
  dl.delayTime.value = 0.19; fb.gain.value = 0.4; lp.type = "lowpass"; lp.frequency.value = 3400; wet.gain.value = 0.4;
  dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(master);
  const env = (g, a, peak, d, t = t0) => {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  // chord (A major add9, spread)
  [220, 277.18, 329.63, 440, 493.88, 659.25].forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = i % 2 ? "triangle" : "sine"; o.frequency.value = f; o.detune.value = (i - 2.5) * 5;
    env(g, 0.03 + i * 0.02, 0.09, 2.2);
    o.connect(g); g.connect(master); g.connect(dl);
    o.start(t0); o.stop(t0 + 2.5);
  });
  // rising whoosh
  const len = Math.floor(ac.sampleRate * 1.7), nb = ac.createBuffer(1, len, ac.sampleRate), ch = nb.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const ns = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain();
  ns.buffer = nb; bp.type = "bandpass"; bp.Q.value = 1.3;
  bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(5200, t0 + 0.85); bp.frequency.exponentialRampToValueAtTime(900, t0 + 1.6);
  env(ng, 0.45, 0.32, 1.1);
  ns.connect(bp); bp.connect(ng); ng.connect(master); ns.start(t0);
  // sub thump
  const so = ac.createOscillator(), sg = ac.createGain();
  so.frequency.setValueAtTime(120, t0); so.frequency.exponentialRampToValueAtTime(36, t0 + 0.45);
  env(sg, 0.01, 0.55, 0.55);
  so.connect(sg); sg.connect(master); so.start(t0); so.stop(t0 + 0.7);
  // sparkle
  [1318.5, 1760, 2217.5, 2637].forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), t = t0 + 0.2 + i * 0.07;
    o.type = "sine"; o.frequency.value = f;
    env(g, 0.005, 0.05, 0.45, t);
    o.connect(g); g.connect(master); g.connect(dl);
    o.start(t); o.stop(t + 0.6);
  });
  setTimeout(() => ac.close().catch(() => {}), 4000);
}

// ================================================================== the intro
let active = false;

export function playIntro(opt = {}) {
  if (active) return;
  active = true;
  injectCSS();
  const prefs = loadPrefs();
  const D = lorenz();
  const K = 24, TN = 72, MAXS = 120, SAMPLE = 0.008;
  const root = document.createElement("div");
  root.id = "intro";
  root.innerHTML = markup(prefs.sound);
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const canvas = q("canvas"), btn = q(".ibtn");
  const logo = opt.logo || null;
  logo?.classList.add("intro-hide");

  let G = null;
  try { G = createGL(canvas, D, K, TN, MAXS); } catch (e) { console.warn("[intro] WebGL2 setup failed:", e); }
  if (!G) {                                        // no WebGL2: no intro, straight to the app
    root.remove(); logo?.classList.remove("intro-hide"); active = false;
    document.getElementById("intro-cover")?.remove();
    opt.onReveal?.(); opt.onDone?.();
    return;
  }
  q('[data-k="gl"]').textContent = G.hdr ? "OK" : "OK · LDR";

  // ---------------------------------------------------------------- state
  const FOV = 30 * Math.PI / 180, DIST = 110, HALF = DIST * Math.tan(FOV / 2), CY = 0.23;
  let dpr = 1, W = 1, H = 1, k0 = 0.62;
  let T = 0, TL = 0, last = performance.now(), raf = 0, leaving = false, revealed = false, logoShown = false, first = true;
  let energy = 0, hover = 0, hoverOn = false, phase = 0, scroll = 0, ltime = 0, acc = 0, hudT = 0, spread = 0.02, cluster = 1 / K;
  const mouse = [0, 0], ms = [0, 0];
  let fly = null, irisC = [0, 0], irisMax = 1;

  // live trajectories: a tight cluster that separates (sensitive dependence)
  const i0 = Math.floor(N_RIB * 0.62) * 4;
  const start = [D.pts[i0], -D.pts[i0 + 2], D.pts[i0 + 1] + ZC];
  const com = [];
  for (let k = 0; k < K; k++) {
    const s = start.map((v) => v + (Math.random() - 0.5) * 0.04);
    const ring = new Float32Array(TN * 3);
    for (let j = 0; j < TN; j++) { ring[j * 3] = s[0]; ring[j * 3 + 1] = s[2] - ZC; ring[j * 3 + 2] = -s[1]; }
    com.push({ s, ring, head: 0 });
  }
  const sparks = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(2, Math.round(innerWidth * dpr)); H = Math.max(2, Math.round(innerHeight * dpr));
    G.resize(W, H);
    k0 = Math.min(0.62, 0.62 * (W / H) / 0.9);
  }
  resize();

  // ---------------------------------------------------------------- input
  const onMove = (e) => { mouse[0] = e.clientX / innerWidth * 2 - 1; mouse[1] = -(e.clientY / innerHeight * 2 - 1); };
  const onKey = (e) => {
    e.stopImmediatePropagation();                 // the viewer's shortcuts wait for the intro
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); if (!e.repeat) go(); }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", resize);
  btn.addEventListener("click", go);
  btn.addEventListener("pointerenter", () => { hoverOn = true; });
  btn.addEventListener("pointerleave", () => { hoverOn = false; });
  q('[data-a="snd"]').addEventListener("click", (e) => {
    prefs.sound = !prefs.sound; savePrefs(prefs);
    e.currentTarget.classList.toggle("off", !prefs.sound);
    e.currentTarget.innerHTML = prefs.sound ? ICON_SND_ON : ICON_SND_OFF;
  });
  q('[data-a="fs"]').addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  btn.focus({ preventScroll: true });

  // ---------------------------------------------------------------- Start
  function go() {
    if (leaving) return;
    leaving = true; TL = 0;
    const r = btn.getBoundingClientRect();
    const bx = r.left + r.width / 2, by = r.top + r.height / 2;
    irisC = [bx * dpr, H - by * dpr];
    irisMax = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - irisC[0], y - irisC[1]))) + 60 * dpr;
    fly = target();
    root.classList.add("leaving");
    const rip = document.createElement("div");
    rip.className = "iripple"; rip.style.left = bx + "px"; rip.style.top = by + "px";
    rip.innerHTML = "<i></i><i></i>";
    q(".iui").appendChild(rip);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, v = (250 + Math.random() * 900) * dpr, life = 0.45 + Math.random() * 0.7;
      const c = [[0.5, 0.85, 1], [0.75, 0.6, 1], [1, 0.75, 0.5], [1, 1, 1]][i % 4];
      sparks.push({ x: irisC[0] + Math.cos(a) * 40 * dpr, y: irisC[1] + Math.sin(a) * 12 * dpr,
                    vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.55, life, max: life, c });
    }
    if (prefs.sound) { try { startSound(); } catch { /* no audio */ } }
  }

  // where the logo ends: the top-bar logo, in canvas NDC (ortho front view)
  function target() {
    const el = logo?.querySelector("svg") || logo;
    let r = el?.getBoundingClientRect();
    if (!r || r.width < 2) r = { left: 14, top: 14, width: 28, height: 28 };
    const size = Math.min(r.width, r.height) * dpr;
    const { x0, x1, y0, y1 } = D.bb;
    const pxPerWorld = size * (100 - 2 * PAD) / 100 / Math.max(x1 - x0, y1 - y0);
    const asp = W / H;
    return {
      S: pxPerWorld * 2 * HALF / H,
      nb: [(x0 + x1) / 2 / (HALF * asp), (y0 + y1) / 2 / HALF],                     // bbox centre, ortho NDC
      P1: [(r.left + r.width / 2) * dpr / W * 2 - 1, 1 - (r.top + r.height / 2) * dpr / H * 2],
    };
  }

  // ---------------------------------------------------------------- app reveal
  function revealApp() {
    opt.onReveal?.();
    const items = [
      [".view.on .ph-stage", 0.05, "0px", "1.035"], [".view.on .ph-text", 0.18, "0px", "1", "26px"],
      [".view.on .ph-top", 0.3, "-8px"], [".runbar", 0.38, "-8px"], ["footer", 0.2, "8px"],
      ["#nav-main", 0.5, "-8px"], ["#nav-sub", 0.56, "-8px"], [".run-status", 0.6, "-8px"],
      ["#conn", 0.64, "-8px"], ["#btn-theme", 0.66, "-8px"], ["#btn-side", 0.68, "-8px"],
    ];
    if (!document.querySelector(".view.on .ph-stage")) items.push([".view.on", 0.05, "0px", "1.02"]);
    for (const [sel, d, dy, sc, dx] of items) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.style.setProperty("--d", d + "s");
      el.style.setProperty("--dy", dy || "10px");
      if (sc) el.style.setProperty("--sc", sc);
      if (dx) el.style.setProperty("--dx", dx);
      el.classList.add("intro-in");
      setTimeout(() => { el.classList.remove("intro-in"); ["--d", "--dy", "--sc", "--dx"].forEach((p) => el.style.removeProperty(p)); }, 1800);
    }
  }
  function finish() {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", resize);
    G.destroy();
    root.remove();
    active = false;
    opt.onDone?.();
  }

  // ---------------------------------------------------------------- simulation
  const toWorld = (s, o, j) => { o[j] = s[0]; o[j + 1] = s[2] - ZC; o[j + 2] = -s[1]; };
  function stepComets(dt) {
    let tu = 0.42 * (1 + 2.6 * energy + 0.6 * hover) * dt;
    ltime += tu;
    while (tu > 1e-9) {
      const h = Math.min(0.002, tu);
      for (const c of com) rk4(c.s, h);
      tu -= h; acc += h;
      if (acc >= SAMPLE) {
        acc -= SAMPLE;
        for (const c of com) { c.head = (c.head + 1) % TN; toWorld(c.s, c.ring, c.head * 3); }
      }
    }
    let mx = 0, my = 0, mz = 0, sp = 0;
    for (const c of com) { mx += c.s[0]; my += c.s[1]; mz += c.s[2]; }
    mx /= K; my /= K; mz /= K;
    for (const c of com) sp += (c.s[0] - mx) ** 2 + (c.s[1] - my) ** 2 + (c.s[2] - mz) ** 2;
    spread = Math.sqrt(sp / K);
    cluster = 1 / (1 + (K - 1) * Math.exp(-spread / 0.8));   // overlapping trails share one brightness
    const tr = G.trailData, hd = G.headData;
    for (let k = 0; k < K; k++) {
      const c = com[k];
      for (let j = 0; j < TN; j++) {
        const src = j === 0 ? -1 : ((c.head - j + 1 + TN) % TN) * 3, o = (k * TN + j) * 4;
        if (src < 0) toWorld(c.s, tr, o); else { tr[o] = c.ring[src]; tr[o + 1] = c.ring[src + 1]; tr[o + 2] = c.ring[src + 2]; }
        tr[o + 3] = j === TN - 1 ? 2 : j / (TN - 1);
      }
      const col = [[0.55, 0.9, 1], [0.82, 0.65, 1], [1, 0.78, 0.55]][k % 3];
      toWorld(c.s, hd, k * 8);
      hd[k * 8 + 3] = 1;
      hd[k * 8 + 4] = col[0]; hd[k * 8 + 5] = col[1]; hd[k * 8 + 6] = col[2]; hd[k * 8 + 7] = 1.6 * Math.max(cluster, 0.12);
    }
  }
  function stepSparks(dt) {
    let n = 0;
    const sd = G.sparkData;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= dt;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      const dr = Math.exp(-3.2 * dt);
      p.vx *= dr; p.vy = p.vy * dr - 260 * dpr * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (n < MAXS) {
        const a = p.life / p.max, o = n * 8;
        sd[o] = p.x; sd[o + 1] = p.y; sd[o + 2] = 0; sd[o + 3] = 0.35 + 0.65 * a;
        sd[o + 4] = p.c[0]; sd[o + 5] = p.c[1]; sd[o + 6] = p.c[2]; sd[o + 7] = 2.2 * a;
        n++;
      }
    }
    return n;
  }
  const fmt = (v, n = 2) => (v >= 0 ? " " : "") + v.toFixed(n);
  function hud() {
    const c = com[0].s, sp = spread;
    const set = (k, v) => { const el = q(`[data-v="${k}"]`); if (el) el.textContent = v; };
    set("t", ltime.toFixed(2)); set("x", fmt(c[0])); set("y", fmt(c[1])); set("z", fmt(c[2], 1));
    set("sp", sp < 1 ? sp.toFixed(3) : sp.toFixed(1));
    const srv = q('[data-k="srv"]'), conn = document.getElementById("conn");
    if (srv && conn) {
      const st = conn.classList.contains("ok") ? ["ONLINE", ""] : conn.classList.contains("bad") ? ["OFFLINE", "warn"] : ["· · ·", "wait"];
      if (srv.textContent !== st[0]) { srv.textContent = st[0]; srv.className = "bs " + st[1]; }
    }
  }

  // ---------------------------------------------------------------- frame
  const st = { orthoS: [0, 0], X: [0, 0, 0, 0], mouse: ms, center: [0, 0], iris: [0, 0, -1],
               trail: G.trailData, heads: G.headData, sparks: G.sparkData };
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // timeline in real time (in step with the CSS); window.__introStep (tests) forces a fixed step per frame
    const dtR = window.__introStep ?? Math.min(0.25, Math.max(0, (now - last) / 1000));
    const dt = Math.min(0.05, dtR);                                    // simulation: bounded step
    last = now;
    T += dtR;
    ms[0] += (mouse[0] - ms[0]) * Math.min(1, dt * 2.5);
    ms[1] += (mouse[1] - ms[1]) * Math.min(1, dt * 2.5);
    hover += ((hoverOn ? 1 : 0) - hover) * Math.min(1, dt * 6);

    let f = 0;
    if (leaving) {
      TL += dtR;
      energy = TL < 0.3 ? TL / 0.3 : Math.max(0, 1 - (TL - 0.3) / 0.7);
      f = easeIO(clamp01((TL - 0.3) / 0.95));
      if (!revealed && TL >= 0.26) { revealed = true; revealApp(); }
      if (!logoShown && TL >= 1.2) { logoShown = true; logo?.classList.remove("intro-hide"); logo?.classList.add("arrive"); setTimeout(() => logo?.classList.remove("arrive"), 1300); }
      if (TL >= 1.62) { finish(); return; }
    }
    phase += dt * 0.0075 * (1 + 3 * energy + 1.5 * hover);
    scroll += dt * (9 + 40 * energy + 6 * hover);
    if (T > 0.9) stepComets(dt);

    // camera: slow sway + mouse; settles to the front view for the logo
    const g = sstep(0, 0.75, f);
    const yaw = (0.62 * Math.sin(T * 0.11 + 0.4) + ms[0] * 0.28) * (1 - g);
    const pitch = (0.08 + 0.10 * Math.sin(T * 0.083 + 1.0) - ms[1] * 0.1) * (1 - g);
    const eye = [DIST * Math.sin(yaw) * Math.cos(pitch), DIST * Math.sin(pitch), DIST * Math.cos(yaw) * Math.cos(pitch)];
    st.VP = mul(persp(FOV, W / H, 10, 400), lookAt(eye));
    st.orthoS[0] = 1 / (HALF * W / H); st.orthoS[1] = 1 / HALF;
    st.ortho = sstep(0.15, 0.85, f);
    if (fly && f > 0) {                            // scale geometric, position along a slight arc
      const s = Math.exp(Math.log(k0) + (Math.log(fly.S) - Math.log(k0)) * f);
      const P0 = [fly.nb[0] * k0, fly.nb[1] * k0 + CY];
      const px = P0[0] + (fly.P1[0] - P0[0]) * f, py = P0[1] + (fly.P1[1] - P0[1]) * f + Math.sin(Math.PI * f) * 0.12;
      st.X[0] = s; st.X[1] = s; st.X[2] = px - fly.nb[0] * s; st.X[3] = py - fly.nb[1] * s;
    } else { st.X[0] = k0; st.X[1] = k0; st.X[2] = 0; st.X[3] = CY; }

    st.lineW = dpr * (1.2 - 0.35 * f);
    st.I = 0.3 * (1 - 0.3 * f);
    st.reveal = easeOut(clamp01((T - 0.3) / 2.6));
    st.keep = 1 - (1 - D.sLogo) * sstep(0.05, 0.8, f);
    st.phase = phase; st.energy = Math.max(energy, hover * 0.35);
    st.trailA = sstep(0.9, 1.8, T) * (1 - sstep(0, 0.45, f)) * Math.max(cluster, 0.12);
    st.headSize = 11 * dpr;
    st.d0 = DIST - 25; st.d1 = DIST + 25;
    st.nSparks = stepSparks(dt); st.sparkSize = 7 * dpr;
    st.time = T; st.dpr = dpr; st.hz = 0.27; st.scroll = scroll;
    st.center[0] = W / 2; st.center[1] = (CY * 0.5 + 0.5) * H;
    st.ringR = 0.27 * H;
    st.ringA = sstep(1.2, 2.6, T) * (leaving ? 1 - clamp01(TL / 0.4) : 1);
    st.fade = sstep(0, 1.3, T);
    st.glowA = leaving ? 1 - sstep(1.22, 1.52, TL) : 1;
    st.bloomK = 0.55 + 0.5 * energy;
    const ir = leaving ? easeIO(clamp01((TL - 0.28) / 0.95)) * irisMax : -1;
    st.iris[0] = irisC[0]; st.iris[1] = irisC[1]; st.iris[2] = ir > 0 ? ir : -1;
    st.irisGlow = leaving ? 1.3 * (1 - sstep(0.85, 1.3, TL)) : 0;

    G.render(st);
    window.__introTL = leaving ? TL : -T;
    if (first) {                                   // the canvas now covers the screen
      first = false;
      root.classList.add("gl-on");
      document.getElementById("intro-cover")?.remove();
    }
    root.style.setProperty("--mx", ms[0].toFixed(3));
    root.style.setProperty("--my", ms[1].toFixed(3));
    if ((hudT -= dt) <= 0) { hudT = 0.08; hud(); }
  }
  raf = requestAnimationFrame(frame);
}
