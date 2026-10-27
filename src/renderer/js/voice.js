// Capri's sounds, synthesized with Web Audio so nothing has to ship with the repo.
// Any file dropped in the custom sounds folder (tray > Son) named after a cue
// (teleport-out.mp3, done.wav, alert.ogg...) replaces the synth for that cue.

import { rand, pick } from './util.js';

// a minor-pentatonic set for the talking blips; three detuned voices = a chorus of minds
const BLIP_NOTES = [62, 65, 67, 69, 72, 74, 77, 79];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const NAP_MS = 20000; // this long with no sound: her audio goes to sleep (costs nothing until the next one)

export const CUES = [
  'teleport-out', 'teleport-in', 'done', 'alert', 'error', 'hello', 'blip', 'tick', 'star', 'land', 'rise', 'bolt', 'charge', 'possess',
  // her moods and her own little life (mood.js, life.js)
  'growl', 'rage', 'huff', 'giggle', 'laugh', 'sigh', 'sting', 'shy', 'startle', 'dizzy', 'yawn', 'skip', 'win', 'lose',
];
// her talking blips by mood: how far up or down they go (semitones), how harsh, how fast
const BLIP_MOOD = {
  angry: { shift: -5, wave: 'sawtooth', gap: 40 }, annoyed: { shift: -2, gap: 45 }, happy: { shift: 4, gap: 40 },
  sad: { shift: -4, gap: 75, soft: 0.7 }, shy: { shift: 7, gap: 55, soft: 0.6 }, bored: { shift: -2, gap: 70, soft: 0.8 },
};

export class Voice {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.7;
    this.custom = new Map(); // cue -> AudioBuffer
    this.lastBlip = 0;
    this.mood = 'calm'; // her mood (mood.js): her blips follow it
    this.speaking = false; // her voice is reading something out (speech.js): no blips over it
    this.sink = '';        // where her sounds go: an output device id, '' the system's default
    this.sinkError = '';   // why the device picked can't be used (it's unplugged, say)
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // soft clip so stacked cues never get harsh
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    this.master.connect(shaper).connect(ctx.destination);
    this.noise = this.makeNoise();
    if (this.sink) this.setSink(this.sink);
    return ctx;
  }

  // The speakers, headphones... there are: [{ id, label }], the system's default first. (Names only
  // show once the mic has been opened once: the browser keeps them back until then.)
  async outputs() {
    const all = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
    const outs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId && !['default', 'communications'].includes(d.deviceId));
    return [{ id: '', label: '' }, ...outs.map((d, i) => ({ id: d.deviceId, label: d.label || `#${i + 1}` }))];
  }

  // Can sound be sent to a chosen device here?
  get canPickOutput() {
    return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  }

  // Where her blips, cues and (a speech service's) voice come out. A device that's gone: the
  // default, and `sinkError` says so. (Windows' own voice, speech.js 'system', can't be redirected.)
  async setSink(id = '') {
    this.sink = String(id || '');
    this.sinkError = '';
    if (!this.ctx?.setSinkId) return true;
    try {
      await this.ctx.setSinkId(this.sink);
      return true;
    } catch (err) {
      this.sinkError = err.message || 'failed';
      if (this.sink) await this.ctx.setSinkId('').catch(() => {});
      return false;
    }
  }

  // A short sound, whatever the mute says, to hear where it comes out.
  test() {
    this.play('hello', { force: true });
  }

  // Her audio, running (a sound is about to play). A running AudioContext keeps the audio thread
  // ticking even in silence, so after a while with nothing to play it's put to sleep (napLater).
  wakeUp() {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    this.napLater();
    return ctx;
  }

  napLater() {
    clearTimeout(this.napTimer);
    this.napTimer = setTimeout(() => {
      // still talking (speech.js plays through this context): try again later
      if (this.speaking) return this.napLater();
      if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
      return undefined;
    }, NAP_MS);
  }

  configure({ muted, volume, audioOut }) {
    if (typeof muted === 'boolean') this.muted = muted;
    if (typeof audioOut === 'string' && audioOut !== this.sink) this.setSink(audioOut);
    if (typeof volume === 'number') {
      this.volume = volume;
      if (this.master) this.master.gain.value = volume;
    }
  }

  async loadCustom(list) {
    const ctx = this.ensure();
    this.custom.clear();
    for (const { name, url } of list) {
      if (!CUES.includes(name)) continue;
      try {
        const data = await (await fetch(url)).arrayBuffer();
        this.custom.set(name, await ctx.decodeAudioData(data));
      } catch (err) {
        console.warn('[capri] could not load sound', name, err);
      }
    }
  }

  play(cue, opts = {}) {
    if (this.muted && !opts.force) return;
    const ctx = this.wakeUp();
    const custom = this.custom.get(cue);
    if (custom) {
      const src = ctx.createBufferSource();
      src.buffer = custom;
      src.connect(this.master);
      src.start();
      return;
    }
    const fn = {
      'teleport-out': () => this.zap(false),
      'teleport-in': () => this.zap(true),
      done: () => this.done(),
      alert: () => this.alert(),
      error: () => this.error(),
      hello: () => this.hello(),
      blip: () => this.blip(opts.mood),
      tick: () => this.tick(),
      star: () => this.star(),
      land: () => this.land(),
      rise: () => this.rise(),
      bolt: () => this.bolt(opts.soft),
      charge: () => this.charge(),
      possess: () => this.possess(),
      growl: () => this.growl(opts.soft),
      rage: () => this.rage(),
      huff: () => this.huff(),
      giggle: () => this.giggle(),
      laugh: () => this.laugh(),
      sigh: () => this.sigh(),
      sting: () => this.sting(),
      shy: () => this.shy(),
      startle: () => this.startle(),
      dizzy: () => this.dizzy(),
      yawn: () => this.yawn(),
      skip: () => this.skip(),
      win: () => this.win(),
      lose: () => this.lose(),
    }[cue];
    fn?.();
  }

  makeNoise() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  env(gain, t, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  osc(type, freq, t, dur, peak, dest = this.master) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.env(g, t, 0.004, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noiseBurst(t, dur, peak, from, to, q = 2) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, peak, dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, rand(0, 0.5));
    src.stop(t + dur + 0.05);
  }

  // teleport: saw sweep + filtered noise, upward when leaving, downward when landing
  zap(arriving) {
    const t = this.ctx.currentTime;
    const o = this.osc('sawtooth', arriving ? 1600 : 180, t, 0.22, 0.12);
    o.frequency.exponentialRampToValueAtTime(arriving ? 140 : 2400, t + 0.2);
    this.noiseBurst(t, 0.2, 0.22, arriving ? 6000 : 400, arriving ? 500 : 7000, 3);
    // bit-crushy stutter
    for (let i = 0; i < 4; i++) this.osc('square', rand(800, 3200), t + 0.02 + i * 0.035, 0.02, 0.05);
    if (arriving) this.osc('triangle', 70, t + 0.16, 0.18, 0.3);
  }

  blip(mood = 'talk') {
    if (this.speaking) return; // her real voice is on
    const feel = BLIP_MOOD[this.mood] || {};
    const now = performance.now();
    if (now - this.lastBlip < (feel.gap || 45)) return;
    this.lastBlip = now;
    const t = this.ctx.currentTime;
    const base = pick(BLIP_NOTES) + (mood === 'alert' ? 5 : mood === 'error' ? -7 : 0) + (feel.shift || 0);
    const f = midi(base);
    const k = feel.soft || 1;
    this.osc(feel.wave || 'square', f, t, 0.035, 0.035 * k);
    this.osc('triangle', f * 1.498, t + 0.004, 0.03, 0.025 * k); // a fifth up
    this.osc('square', f * 0.501, t + 0.008, 0.03, 0.018 * k);   // an octave down, slightly off
  }

  // ---------- her moods ----------

  // a low, rough growl: a buzz shaken by a fast tremolo, through a closing filter
  growl(soft = false) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = soft ? 0.28 : 0.5;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(soft ? 78 : 68, t);
    o.frequency.linearRampToValueAtTime(soft ? 70 : 58, t + dur);
    const trem = ctx.createOscillator();
    trem.frequency.value = 27;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.5;
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    trem.connect(tremGain).connect(amp.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.03, soft ? 0.1 : 0.2, dur);
    o.connect(amp).connect(lp).connect(g).connect(this.master);
    o.start(t);
    trem.start(t);
    o.stop(t + dur + 0.1);
    trem.stop(t + dur + 0.1);
    if (!soft) this.noiseBurst(t, dur * 0.8, 0.05, 500, 220, 1.2);
  }

  // blowing up: a growl, a crash of noise, the pitch diving, a stutter of glitches
  rage() {
    const t = this.ctx.currentTime;
    this.growl();
    this.noiseBurst(t + 0.05, 0.35, 0.22, 3000, 300, 0.8);
    const o = this.osc('sawtooth', 420, t + 0.04, 0.4, 0.09);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.42);
    for (let i = 0; i < 6; i++) this.osc('square', rand(300, 2600), t + 0.1 + i * 0.045, 0.025, 0.05);
  }

  // a puff of air out of her nose
  huff() {
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.2, 0.16, 1400, 500, 1.4);
    this.osc('triangle', 180, t, 0.08, 0.05);
  }

  // a short giggle: four quick chirps, up and back down
  giggle() {
    const t = this.ctx.currentTime;
    [76, 79, 77, 74].forEach((n, i) => {
      const at = t + i * 0.085;
      const o = this.osc('triangle', midi(n), at, 0.06, 0.07);
      o.frequency.exponentialRampToValueAtTime(midi(n - 2), at + 0.06);
      this.osc('square', midi(n) * 1.01, at + 0.003, 0.04, 0.02);
    });
  }

  // a real laugh, with all her voices: "ha"s going down, each a little chord
  laugh() {
    const t = this.ctx.currentTime;
    [81, 79, 81, 77, 79, 74, 72].forEach((n, i) => {
      const at = t + i * 0.11;
      for (const [k, wave, peak] of [[1, 'square', 0.05], [1.012, 'square', 0.03], [0.5, 'triangle', 0.05]]) {
        const o = this.osc(wave, midi(n) * k, at, 0.075, peak);
        o.frequency.exponentialRampToValueAtTime(midi(n - 3) * k, at + 0.075);
      }
      this.noiseBurst(at, 0.05, 0.03, 2500, 1500, 3);
    });
  }

  // a long breath out
  sigh() {
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.75, 0.07, 1600, 280, 0.9);
    const o = this.osc('sine', 260, t + 0.05, 0.6, 0.03);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.6);
  }

  // stung: a glitch, then a falling tone
  sting() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.osc('square', rand(1500, 3200), t + i * 0.03, 0.02, 0.04);
    const o = this.osc('triangle', 660, t + 0.1, 0.5, 0.06);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.55);
  }

  // flustered: a little "eep", two soft high chirps going up
  shy() {
    const t = this.ctx.currentTime;
    [84, 88].forEach((n, i) => {
      const o = this.osc('sine', midi(n), t + i * 0.12, 0.1, 0.06);
      o.frequency.exponentialRampToValueAtTime(midi(n + 3), t + i * 0.12 + 0.1);
    });
  }

  // startled: a quick rising chirp
  startle() {
    const t = this.ctx.currentTime;
    const o = this.osc('square', 500, t, 0.12, 0.07);
    o.frequency.exponentialRampToValueAtTime(1600, t + 0.1);
    this.noiseBurst(t, 0.06, 0.08, 4000, 8000, 4);
  }

  // dizzy: a tone wobbling down
  dizzy() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.9);
    const vib = ctx.createOscillator();
    vib.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = 60;
    vib.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.02, 0.05, 0.9);
    o.connect(g).connect(this.master);
    o.start(t);
    vib.start(t);
    o.stop(t + 1);
    vib.stop(t + 1);
  }

  // a yawn: a slow slide up and back down, soft
  yawn() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(180, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.2);
    this.noiseBurst(t + 0.1, 0.9, 0.02, 900, 400, 1);
  }

  // skipping a track: a scratch and a quick drop
  skip() {
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.12, 0.14, 5000, 900, 2);
    const o = this.osc('sawtooth', 900, t + 0.05, 0.16, 0.06);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.2);
  }

  // a game won: a quick little fanfare
  win() {
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => this.osc('square', midi(n), t + i * 0.08, 0.1, 0.05));
    this.osc('triangle', midi(88), t + 0.32, 0.35, 0.06);
  }

  // a game lost: the arcade's sad descending buzz
  lose() {
    const t = this.ctx.currentTime;
    [67, 64, 61, 55].forEach((n, i) => this.osc('square', midi(n), t + i * 0.14, 0.13, 0.05));
  }

  tick() {
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.03, 0.06, 3000, 9000, 8);
  }

  // red lightning: a buzz under a crackle of tiny bursts (soft: the small hacking sparks)
  bolt(soft = false) {
    const t = this.ctx.currentTime;
    const k = soft ? 0.35 : 1;
    const o = this.osc('sawtooth', 62, t, 0.3 * k + 0.05, 0.08 * k);
    o.frequency.setValueAtTime(58, t + 0.05);
    for (let i = 0; i < (soft ? 3 : 8); i++) {
      this.noiseBurst(t + i * rand(0.02, 0.045), 0.025, 0.14 * k, rand(2500, 6000), rand(4000, 9000), 6);
    }
  }

  // charging up before the red light goes up: a buzz swelling and climbing, crackling more and more
  charge() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.66);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
    for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.08 + i * 0.09, 0.02, 0.04 + i * 0.016, 3000, 7000, 6);
  }

  // the window she took over laughs with all her voices: three falling chirps, each a detuned
  // chord, over a hiss
  possess() {
    const t = this.ctx.currentTime;
    [79, 76, 72].forEach((n, i) => {
      const at = t + i * 0.11;
      this.osc('square', midi(n), at, 0.07, 0.05);
      this.osc('square', midi(n) * 1.012, at + 0.004, 0.06, 0.035);
      this.osc('triangle', midi(n - 12), at + 0.008, 0.07, 0.04);
    });
    this.noiseBurst(t, 0.3, 0.05, 1200, 5000, 3);
  }

  // the launch into the victory pose: a quick upward whoosh
  rise() {
    const t = this.ctx.currentTime;
    const o = this.osc('sawtooth', 160, t, 0.2, 0.07);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.18);
    this.noiseBurst(t, 0.18, 0.12, 500, 6000, 2);
  }

  // touching down: a soft digital thump
  land() {
    const t = this.ctx.currentTime;
    const o = this.osc('triangle', 150, t, 0.14, 0.22);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    this.noiseBurst(t, 0.06, 0.08, 1800, 400, 1.5);
  }

  // the satellite: two soft, high pings and a shimmer
  star() {
    const t = this.ctx.currentTime;
    this.osc('sine', midi(93), t, 0.9, 0.05);
    this.osc('sine', midi(100), t + 0.14, 1.2, 0.035);
    this.noiseBurst(t + 0.05, 0.6, 0.015, 9000, 12000, 6);
  }

  hello() {
    const t = this.ctx.currentTime;
    [69, 76, 81].forEach((n, i) => this.osc('square', midi(n), t + i * 0.06, 0.07, 0.06));
    this.noiseBurst(t + 0.18, 0.08, 0.06, 2000, 8000, 5);
  }

  // bright arpeggio and a glitchy tail
  done() {
    const t = this.ctx.currentTime;
    [64, 68, 71, 75, 76].forEach((n, i) => {
      this.osc('triangle', midi(n + 12), t + i * 0.07, 0.28, 0.09);
      this.osc('square', midi(n), t + i * 0.07, 0.12, 0.035);
    });
    for (let i = 0; i < 7; i++) this.osc('square', rand(1200, 4200), t + 0.4 + i * 0.03, 0.018, 0.035);
  }

  alert() {
    const t = this.ctx.currentTime;
    for (let r = 0; r < 2; r++) {
      this.osc('square', 988, t + r * 0.28, 0.09, 0.07);
      this.osc('square', 740, t + r * 0.28 + 0.11, 0.11, 0.07);
    }
  }

  error() {
    const t = this.ctx.currentTime;
    const o = this.osc('sawtooth', 110, t, 0.32, 0.14);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
    this.noiseBurst(t, 0.25, 0.15, 900, 200, 1.2);
    for (let i = 0; i < 5; i++) this.noiseBurst(t + 0.05 + i * 0.05, 0.02, 0.12, 4000, 4000, 10);
  }
}
