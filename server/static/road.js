// Top-down "block car" road viewer: one road per vehicle (ICE, EV), each with
// its own leader. x in the output is the FRONT bumper of each car.
//
// Camera: "follow" keeps the ego car at a fixed place on screen with a fixed
// span; "fit" zooms so that the ego and its leader are both visible.

import { LANE_NAME } from "./signals.js";

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// x0: screen x of the rear bumper, len: car length in px, yc: centre line
function drawCar(g, x0, len, yc, w, body, braking) {
  g.fillStyle = "rgba(0,0,0,.28)";
  roundRect(g, x0 + 2, yc - w / 2 + 3, len, w, 5); g.fill();
  g.fillStyle = body;
  roundRect(g, x0, yc - w / 2, len, w, 5); g.fill();
  // cabin / windshield (front is to the right)
  g.fillStyle = "rgba(0,0,0,.30)";
  roundRect(g, x0 + len * 0.30, yc - w / 2 + 3, len * 0.42, w - 6, 3); g.fill();
  g.fillStyle = "rgba(255,255,255,.22)";
  roundRect(g, x0 + len * 0.62, yc - w / 2 + 4, len * 0.08, w - 8, 2); g.fill();
  // headlights
  g.fillStyle = "rgba(255,248,214,.9)";
  g.fillRect(x0 + len - 2, yc - w / 2 + 2, 2, 4);
  g.fillRect(x0 + len - 2, yc + w / 2 - 6, 2, 4);
  // brake lights
  g.fillStyle = braking ? "#ff3b30" : "rgba(120,20,20,.8)";
  g.fillRect(x0, yc - w / 2 + 2, 2.5, 5);
  g.fillRect(x0, yc + w / 2 - 7, 2.5, 5);
  if (braking) {
    g.fillStyle = "rgba(255,59,48,.25)";
    g.beginPath(); g.arc(x0, yc, w * 0.7, Math.PI / 2, Math.PI * 1.5); g.fill();
  }
}

export function drawRoad(canvas, { columns, row, meta, lanes, span = 160, camera = "follow", collisions = {} }) {
  const dpr = devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = css("--road-bg");
  g.fillRect(0, 0, W, H);

  const idx = Object.fromEntries(columns.map((n, i) => [n, i]));
  const shown = lanes.filter((l) => idx[l + "_x"] !== undefined);
  if (!row || !shown.length) {
    g.fillStyle = css("--muted"); g.font = "13px Inter, system-ui";
    g.fillText("No run yet: press Start", 16, 26);
    return;
  }
  const val = (l, s) => { const i = idx[`${l}_${s}`]; return i === undefined ? null : row[i]; };
  const L = +(meta?.L_veh || 4.5);

  // ---- camera: one scale for all roads so they can be compared, but each road
  // follows its own car (a lane stopped by a collision must not drag the other)
  let pxPerM = W / span;
  const back = camera === "fit" ? L + 15 : span * 0.28;   // metres behind the ego front
  if (camera === "fit") {
    let need = 60;
    for (const l of shown) {
      const ahead = val(l, "lead_on") > 0.5 ? val(l, "lead_x") - val(l, "x") + 15 : 30;
      need = Math.max(need, back + ahead);
    }
    pxPerM = W / need;
  }

  const laneH = H / shown.length;
  const roadW = Math.min(64, laneH * 0.52);
  const carW = Math.min(26, roadW * 0.46);
  g.textBaseline = "alphabetic";

  shown.forEach((l, k) => {
    const ref = val(l, "x") - back;                        // world x at the left edge
    const SX = (x) => (x - ref) * pxPerM;
    const yc = laneH * k + laneH * 0.58;
    const top = yc - roadW / 2, bot = yc + roadW / 2;
    const color = css("--" + l), lead = css("--lead-car");

    // road
    g.fillStyle = css("--asphalt");
    g.fillRect(0, top, W, roadW);
    g.fillStyle = css("--road-edge");
    g.fillRect(0, top - 2, W, 2); g.fillRect(0, bot, W, 2);
    // moving lane dashes (world-anchored: 3 m dash, 9 m period)
    g.strokeStyle = css("--road-dash"); g.lineWidth = 2; g.setLineDash([3 * pxPerM, 6 * pxPerM]);
    g.lineDashOffset = (ref % 9) * pxPerM;
    g.beginPath(); g.moveTo(0, top + 0.5); g.lineTo(W, top + 0.5); g.stroke();
    g.setLineDash([]);
    // distance marks every 10 m, labels every 50 m
    g.fillStyle = css("--muted"); g.font = "10px Inter, system-ui"; g.textAlign = "center";
    for (let m = Math.ceil(ref / 10) * 10; SX(m) < W; m += 10) {
      const x = SX(m);
      g.fillRect(x, bot + 3, 1, m % 50 === 0 ? 6 : 3);
      if (m % 50 === 0 && pxPerM * 50 > 40) g.fillText(`${m.toFixed(0)} m`, x, bot + 17);
    }
    g.textAlign = "left";

    const xe = val(l, "x"), v = val(l, "v");
    const leadOn = val(l, "lead_on") > 0.5, target = val(l, "target") > 0.5;
    const xl = val(l, "lead_x"), d = val(l, "d"), dref = val(l, "d_ref");
    const follow = val(l, "mode") > 0.5;
    const coll = collisions[l];

    // gap band between ego front and leader rear, coloured by how close we are
    if (leadOn && d != null) {
      const ratio = target && dref > 0 ? d / dref : 2;
      g.fillStyle = ratio < 0.5 ? css("--bad-a") : ratio < 0.95 ? css("--warn-a") : css("--ok-a");
      g.fillRect(SX(xe), yc - 3, Math.max(0, d) * pxPerM, 6);
    }
    // target position of the ego front bumper (d = d_ref)
    if (leadOn && target && dref > 0) {
      const xt = SX(xl - L - dref);
      g.strokeStyle = css("--target"); g.lineWidth = 1.5; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(xt, top - 4); g.lineTo(xt, bot + 4); g.stroke(); g.setLineDash([]);
      g.fillStyle = css("--target"); g.font = "600 10px Inter, system-ui";
      g.fillText("d_ref", xt + 4, bot - 5);
    }
    // cars
    if (leadOn) drawCar(g, SX(xl - L), L * pxPerM, yc, carW, lead, val(l, "lead_a") < -0.3);
    drawCar(g, SX(xe - L), L * pxPerM, yc, carW, color, val(l, "F_b") > 50);

    // labels
    g.font = "600 12px Inter, system-ui"; g.fillStyle = css("--text");
    const egoLabel = `${LANE_NAME[l]}  ${v.toFixed(1)} m/s · ${(v * 3.6).toFixed(0)} km/h`;
    const lx = Math.max(6, Math.min(W - g.measureText(egoLabel).width - 6, SX(xe - L)));
    g.fillText(egoLabel, lx, top - 8);
    if (leadOn) {
      // leader speed, on the road just ahead of the leader
      g.font = "11px Inter, system-ui"; g.fillStyle = css("--road-text");
      const t = `leader ${val(l, "lead_v").toFixed(1)} m/s`;
      const x = Math.min(W - g.measureText(t).width - 6, SX(xl) + 8);
      if (SX(xl - L) < W) g.fillText(t, x, yc + 4);
    }

    // HUD: lane name, loop in use, distance numbers
    const hud = [
      { text: follow ? "DISTANCE LOOP" : "SPEED LOOP", bg: follow ? css("--target") : css("--accent") },
    ];
    let hx = W - 8;
    const hy = coll ? 26 : 0;                          // below the red strip
    g.font = "700 10px Inter, system-ui";
    for (const h of hud) {
      const w = g.measureText(h.text).width + 14;
      hx -= w;
      g.fillStyle = h.bg; roundRect(g, hx, laneH * k + 8 + hy, w, 18, 9); g.fill();
      g.fillStyle = "#fff"; g.fillText(h.text, hx + 7, laneH * k + 21 + hy);
      hx -= 6;
    }
    g.font = "12px Inter, system-ui"; g.fillStyle = css("--text-2");
    const info = leadOn
      ? `d = ${d.toFixed(1)} m` + (target ? `   target ${dref.toFixed(1)} m   e_s = ${(d - dref).toFixed(1)} m` : "   (out of radar range)")
      : "no car ahead";
    g.textAlign = "right";
    g.fillText(info, hx - 6, laneH * k + 21 + hy);
    g.textAlign = "left";
    // collision: red tint over the lane, impact mark, red strip at the top of the lane
    if (coll) {
      g.fillStyle = "rgba(229,83,75,.13)";
      g.fillRect(0, laneH * k, W, laneH);
      const xi = SX(xe);
      g.strokeStyle = css("--bad"); g.lineWidth = 2;
      for (let a = 0; a < 8; a++) {                   // burst at the contact point
        const ang = a * Math.PI / 4;
        g.beginPath();
        g.moveTo(xi + Math.cos(ang) * 6, yc + Math.sin(ang) * 6);
        g.lineTo(xi + Math.cos(ang) * 14, yc + Math.sin(ang) * 14);
        g.stroke();
      }
      const text = `⚠ COLLISION  ${LANE_NAME[l]} hit the car ahead at t = ${coll.t.toFixed(2)} s, ` +
        `closing speed ${coll.v.toFixed(1)} m/s (${(coll.v * 3.6).toFixed(0)} km/h)` +
        (coll.stopped ? "  ·  lane stopped" : "  ·  simulation continued");
      g.fillStyle = css("--bad");
      g.fillRect(0, laneH * k, W, 22);
      g.fillStyle = "#fff"; g.font = "700 12px Inter, system-ui";
      g.fillText(text, 10, laneH * k + 15);
    }
    if (k < shown.length - 1) {
      g.fillStyle = css("--border"); g.fillRect(0, laneH * (k + 1), W, 1);
    }
  });
}
