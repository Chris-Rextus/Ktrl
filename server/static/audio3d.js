// audio3d.js - procedural sound for the 3D view (Web Audio, no samples):
// ICE engine with gears, EV motor whine + inverter, wind, tyres, brake squeal,
// rain ambience and a crash (thump, crunch, glass). Starts muted; the browser
// only allows audio after a click.

export class Sound {
  constructor() { this.ctx = null; this.on = false; this.gear = 1; }
  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; this.master.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.1); return; }
    const C = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = C; this.on = true;
    const master = C.createGain(); master.gain.value = 0.55;
    const comp = C.createDynamicsCompressor();
    master.connect(comp); comp.connect(C.destination);
    this.master = master;
    const noiseBuf = C.createBuffer(1, C.sampleRate * 2, C.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.6 + b * 3; }
    this.noiseBuf = noiseBuf;
    const noise = (type, freq, q, gain) => {
      const s = C.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = C.createGain(); g.gain.value = gain;
      s.connect(f); f.connect(g); g.connect(master); s.start();
      return { f, g };
    };
    const osc = (type, freq, gain, filt) => {
      const o = C.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = C.createGain(); g.gain.value = gain;
      if (filt) { o.connect(filt); filt.connect(g); } else o.connect(g);
      g.connect(master); o.start();
      return { o, g };
    };
    // ICE: firing frequency + harmonics through a low-pass
    const lp = C.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; lp.Q.value = 3;
    const eng = C.createGain(); eng.gain.value = 0; eng.connect(master);
    const lp2 = C.createGain(); lp.connect(lp2); lp2.connect(eng);
    this.ice = { lp, eng, o: [1, 2, 0.5, 3].map((m, i) => { const o = C.createOscillator(); o.type = i === 2 ? "square" : "sawtooth"; o.frequency.value = 40 * m; const g = C.createGain(); g.gain.value = [0.5, 0.25, 0.3, 0.1][i]; o.connect(g); g.connect(lp); o.start(); return { o, m }; }) };
    // EV: motor whine + inverter
    this.ev = { whine: osc("sine", 200, 0), inv: osc("triangle", 2400, 0), sub: osc("sine", 70, 0) };
    this.wind = noise("bandpass", 700, 0.6, 0);
    this.tyre = noise("lowpass", 260, 0.8, 0);
    this.rain = noise("highpass", 1800, 0.5, 0);
    this.squeal = osc("sine", 3100, 0);
  }
  stop() { if (this.ctx) { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); } this.on = false; }

  // s: {plant, v, a, brake (0..1), rain, collided}
  update(s) {
    if (!this.ctx || !this.on) return;
    const C = this.ctx, t = C.currentTime, T = (p, v, tc = 0.08) => p.setTargetAtTime(v, t, tc);
    const v = Math.max(0, s.v), thr = Math.max(0, Math.min(1, s.a / 2.5));
    const dead = s.collided ? 0 : 1;
    if (s.plant === "ice") {
      const ratios = [0, 3.6, 2.2, 1.5, 1.15, 0.92, 0.76], fd = 3.4, wr = 0.33;
      let rpm = (v / wr) * ratios[this.gear] * fd * 60 / (2 * Math.PI);
      if (rpm > 5200 && this.gear < 6) this.gear++;
      if (rpm < 1700 && this.gear > 1) this.gear--;
      rpm = Math.max(850, (v / wr) * ratios[this.gear] * fd * 60 / (2 * Math.PI));
      const f = rpm / 60 * 2;                     // 4-cylinder firing frequency
      for (const o of this.ice.o) T(o.o.frequency, f * o.m, 0.05);
      T(this.ice.lp.frequency, 300 + thr * 1800 + rpm * 0.15);
      T(this.ice.eng.gain, dead * (0.12 + thr * 0.22 + rpm / 40000));
      T(this.ev.whine.g.gain, 0); T(this.ev.inv.g.gain, 0); T(this.ev.sub.g.gain, 0);
    } else {
      T(this.ice.eng.gain, 0);
      T(this.ev.whine.o.frequency, 160 + v * 34); T(this.ev.whine.g.gain, dead * (0.02 + Math.abs(s.a) * 0.03 + v * 0.0012));
      T(this.ev.inv.o.frequency, 2200 + v * 40); T(this.ev.inv.g.gain, dead * (0.004 + Math.abs(s.a) * 0.006));
      T(this.ev.sub.o.frequency, 50 + v * 3); T(this.ev.sub.g.gain, dead * 0.03);
    }
    T(this.wind.g.gain, dead * Math.min(0.5, v * v / 2200)); T(this.wind.f.frequency, 400 + v * 22);
    T(this.tyre.g.gain, dead * Math.min(0.35, v / 90));
    T(this.squeal.g.gain, dead * (s.a < -5.5 && v > 2 ? Math.min(0.06, (-s.a - 5.5) * 0.03) : 0), 0.04);
    T(this.squeal.o.frequency, 3000 + Math.sin(t * 30) * 60, 0.01);
    T(this.rain.g.gain, s.rain ? 0.12 : 0, 0.4);
  }
  crash(v) {
    if (!this.ctx || !this.on) return;
    const C = this.ctx, t = C.currentTime, k = Math.min(1.5, 0.4 + v / 12);
    const src = (dur, type, f0, f1, gain, q = 1) => {
      const s = C.createBufferSource(); s.buffer = this.noiseBuf;
      const f = C.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = C.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05);
    };
    src(0.9, "lowpass", 2500, 120, 0.9 * k);           // crunch
    src(1.6, "bandpass", 900, 200, 0.4 * k, 2);
    for (let i = 0; i < 9; i++) {                       // glass tinkles
      const s = C.createBufferSource(); s.buffer = this.noiseBuf;
      const f = C.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 5000 + Math.random() * 4000;
      const g = C.createGain(); const t0 = t + 0.05 + Math.random() * 0.7;
      g.gain.setValueAtTime(0, t); g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t0 + 0.2);
    }
    const o = C.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const g = C.createGain(); g.gain.setValueAtTime(1.2 * k, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.8);
  }
}
