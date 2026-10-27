// Her own voice, step two: sounds to a waveform. A formant synthesizer in plain JavaScript, built the
// way speech synthesizers were before neural ones (Klatt's): a buzz of glottal pulses, run through a
// chain of resonators that move from sound to sound (the formants), plus shaped noise for hissing
// sounds and bursts for stops. No model, no recording, no service: the numbers below are all of it, so
// it is small, works offline, and costs a few milliseconds a second of speech.
//
// Her voice is her own invention, young, quick and teasing, a little digital (a glitch now and then,
// and the "many minds" chorus speech.js puts on every voice), and it changes with her mood: pitch,
// range, pace, breathiness, roughness.
//
// synthesize(text, { lang, mood, rate, pitch, seed }) -> { samples: Float32Array, sampleRate, duration }

import { phonemize, VOWELS } from './voice-phones.js';

export const SYNTH_RATE = 22050;
const FRAME = 5;                          // ms per control frame
const SR = SYNTH_RATE;
const FRAME_SAMPLES = Math.round((FRAME / 1000) * SR);

// ---------- what each sound is made of ----------

// vowels: F1, F2, F3 (Hz, a male voice: scaled up for hers), loudness, length (ms)
const VOW = {
  a: [700, 1250, 2600, 1.0, 95], e: [480, 1900, 2550, 0.95, 90], E: [560, 1750, 2500, 0.97, 90], i: [290, 2250, 3000, 0.8, 85],
  I: [400, 1950, 2600, 0.85, 70], o: [480, 900, 2450, 0.95, 95], O: [600, 1000, 2450, 0.97, 95], u: [320, 800, 2350, 0.78, 90],
  U: [420, 1000, 2400, 0.82, 70], y: [350, 1500, 2400, 0.82, 85], '@': [500, 1450, 2500, 0.8, 60], V: [640, 1250, 2500, 0.95, 80],
  Q: [680, 1600, 2500, 1.0, 90], A: [700, 1100, 2550, 1.0, 100], 2: [400, 1500, 2300, 0.85, 90], 9: [520, 1500, 2300, 0.9, 90],
  Y: [290, 1750, 2150, 0.8, 85],
};
const SCHWA = [500, 1450, 2500];

// where the formants start from at a consonant: [F1, F2, F3] for a hard one, and a soft (palatalised) one
const LOCUS = {
  lab: [[200, 800, 2300], [210, 1750, 2600]],
  alv: [[220, 1700, 2600], [220, 2100, 2900]],
  pal: [[230, 1900, 2500], [230, 2250, 2900]],
  vel: null, // follows the next vowel
  l: [[360, 1100, 2500], [300, 2000, 2800]],
  r: [[400, 1300, 1900], [330, 1900, 2500]],
};
// noise for hissing sounds: [centre Hz, bandwidth Hz, loudness]
const HISS = {
  s: [6800, 2600, 0.62], z: [6600, 2600, 0.3], S: [2900, 1800, 0.66], Z: [2800, 1800, 0.34], C: [4400, 2200, 0.6],
  f: [6000, 5000, 0.14], v: [5500, 5000, 0.07], x: [2600, 2600, 0.34], T: [6000, 5000, 0.12], D: [5500, 5000, 0.07], h: [1500, 3000, 0.0],
};
// bursts of stops: [centre, bandwidth, loudness]
const BURST = {
  p: [1400, 2500, 0.34], b: [1200, 2500, 0.22], t: [4300, 2600, 0.52], d: [4000, 2600, 0.34], k: [2200, 1600, 0.5], g: [2000, 1600, 0.34],
};
const PLACE = { p: 'lab', b: 'lab', m: 'lab', f: 'lab', v: 'lab', t: 'alv', d: 'alv', n: 'alv', s: 'alv', z: 'alv', S: 'pal', Z: 'pal', C: 'pal', J: 'pal', k: 'vel', g: 'vel', x: 'vel', N: 'vel' };
const NOTCH = { m: 1000, n: 1500, J: 1900, N: 2000 };

// ---------- her moods in her voice ----------
// f0: middle of her pitch (Hz), range: how much the tune moves, rate: pace, breath: air in the voice,
// rough: roughness, bright: sparkle in the high end, glitch: how often she stutters digitally
const MOODS = {
  calm: { f0: 218, range: 1.0, rate: 1.0, breath: 0.22, rough: 0.12, bright: 0.2, glitch: 0.1, gain: 1 },
  happy: { f0: 240, range: 1.35, rate: 1.1, breath: 0.2, rough: 0.1, bright: 0.45, glitch: 0.08, gain: 1.05 },
  laugh: { f0: 250, range: 1.55, rate: 1.14, breath: 0.4, rough: 0.2, bright: 0.4, glitch: 0.2, gain: 1.05 },
  angry: { f0: 196, range: 0.8, rate: 1.12, breath: 0.05, rough: 0.5, bright: 0.65, glitch: 0.32, gain: 1.12 },
  annoyed: { f0: 204, range: 0.7, rate: 0.96, breath: 0.1, rough: 0.28, bright: 0.25, glitch: 0.14, gain: 1 },
  sad: { f0: 192, range: 0.65, rate: 0.86, breath: 0.45, rough: 0.12, bright: 0.0, glitch: 0.06, gain: 0.88 },
  shy: { f0: 258, range: 1.1, rate: 0.95, breath: 0.6, rough: 0.08, bright: 0.1, glitch: 0.1, gain: 0.9 },
  smug: { f0: 206, range: 1.4, rate: 0.93, breath: 0.2, rough: 0.14, bright: 0.3, glitch: 0.14, gain: 1 },
  surprised: { f0: 262, range: 1.6, rate: 1.1, breath: 0.28, rough: 0.1, bright: 0.5, glitch: 0.1, gain: 1.05 },
  dreamy: { f0: 214, range: 0.8, rate: 0.88, breath: 0.42, rough: 0.06, bright: 0.05, glitch: 0.08, gain: 0.9 },
  bored: { f0: 196, range: 0.5, rate: 0.86, breath: 0.3, rough: 0.3, bright: 0.0, glitch: 0.06, gain: 0.9 },
};

// a small deterministic random source: the same text sounds the same
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------- from sounds to a timeline ----------

// One piece of the timeline: how long, where the formants head for, how loud each source is.
// kinds: v (vowel or voiced), n (nasal), h (hiss and noise), s (silence)
function seg(dur, o) {
  return { dur, f: SCHWA, b: [90, 130, 190], av: 0, af: 0, ah: 0, ff: 4000, fb: 3000, nz: 0, trill: 0, burst: false, ...o };
}

function expand(phrases, mood, rate, fs) {
  const segs = [];
  const marks = []; // { word, start segment } for the glitches and the tune
  const scale = (ms) => ms / rate;
  const flat = [];
  phrases.forEach((phrase, pi) => {
    phrase.words.forEach((word, wi) => {
      if (word.laugh) {
        flat.push({ laugh: word.laugh, pi, wi, wordEnd: true, phraseEnd: wi === phrase.words.length - 1 });
        return;
      }
      word.phones.forEach((ph, k) => flat.push({ ph, pi, wi, wordStart: k === 0, wordEnd: k === word.phones.length - 1, phraseEnd: wi === phrase.words.length - 1 && k === word.phones.length - 1 }));
    });
  });
  const vowelOf = (i) => {
    for (let j = i; j < flat.length; j++) {
      const q = flat[j].ph?.p;
      if (!q) continue;
      const base = q.replace(/[~']/g, '');
      if (VOW[base] && !'wj'.includes(base)) return VOW[base];
      if (flat[j].wordEnd && j > i) break;
    }
    return null;
  };
  const female = (f) => [f[0] * fs, f[1] * fs, f[2] * fs];
  let lastPhrase = -1;
  flat.forEach((u, i) => {
    if (u.pi !== lastPhrase) {
      lastPhrase = u.pi;
    }
    const phrase = phrases[u.pi];
    const startIdx = segs.length;
    if (u.laugh) {
      for (let k = 0; k < u.laugh; k++) {
        const amp = Math.pow(0.86, k);
        segs.push(seg(scale(60), { kind: 'h', ah: 0.55 * amp, f: female(VOW.a), b: [140, 160, 220], ff: 1500, fb: 3000, laugh: true }));
        segs.push(seg(scale(95 - k * 3), { kind: 'v', av: 0.95 * amp, ah: 0.25, f: female(VOW.a), b: [110, 130, 200], laugh: true, accent: k === 0 }));
      }
      if (u.phraseEnd) endPhrase(phrase);
      marks.push({ pi: u.pi, wi: u.wi, seg: startIdx, end: segs.length });
      return;
    }
    const raw = u.ph.p;
    const short = raw.endsWith('~') || Boolean(u.ph.short);
    const soft = raw.endsWith("'");
    const sym = raw.replace(/[~']/g, '');
    const next = flat[i + 1]?.ph?.p?.replace(/[~']/g, '');
    const nextIsVowel = next && VOWELS.has(next);
    const lengthen = (ms) => (u.ph.long ? ms * 1.55 : ms) * (u.phraseEnd ? 1.25 : 1);
    if (VOWELS.has(sym)) {
      const [f1, f2, f3, amp, len] = VOW[sym];
      let f = female([f1, f2, f3]);
      if (!u.ph.stress && !short) f = f.map((x, k) => x * 0.88 + female(SCHWA)[k] * 0.12);
      const dur = len * (u.ph.stress ? 1.28 : short ? 0.5 : 0.82) * (u.phraseEnd ? 1.35 : 1) * (u.ph.long ? 1.4 : 1);
      segs.push(seg(scale(dur), { kind: 'v', av: amp * (u.ph.stress ? 1.12 : 0.92), ah: 0, f, b: [95, 115, 175], accent: Boolean(u.ph.stress), vowel: true }));
    } else if (sym === 'j' || sym === 'w') {
      const f = sym === 'j' ? female([280, 2250, 3000]) : female([300, 700, 2300]);
      segs.push(seg(scale(short ? 35 : 55), { kind: 'v', av: 0.55, f, b: [100, 130, 200] }));
    } else if (sym === 'm' || sym === 'n' || sym === 'J' || sym === 'N') {
      const place = LOCUS[PLACE[sym]] || LOCUS.alv;
      const loc = female(place[soft || sym === 'J' ? 1 : 0]);
      const dur = short ? 38 : lengthen(66);
      segs.push(seg(scale(dur), { kind: 'n', av: short ? 0.42 : 0.5, f: [250 * fs, loc[1], loc[2]], b: [90, 260, 320], nz: NOTCH[sym] * fs }));
      if (soft && !nextIsVowel) segs.push(seg(scale(26), { kind: 'v', av: 0.3, f: female([280, 2200, 2900]), b: [100, 130, 200] }));
    } else if (sym === 'l') {
      const place = LOCUS.l;
      const loc = female(place[soft ? 1 : 0]);
      segs.push(seg(scale(lengthen(64)), { kind: 'v', av: 0.6, f: loc, b: [110, 170, 230] }));
      if (soft && !nextIsVowel) segs.push(seg(scale(26), { kind: 'v', av: 0.3, f: female([280, 2200, 2900]), b: [100, 130, 200] }));
    } else if (sym === 'r') {
      const loc = female(LOCUS.r[soft ? 1 : 0]);
      segs.push(seg(scale(lengthen(82)), { kind: 'v', av: 0.62, f: loc, b: [120, 180, 250], trill: 1 }));
      if (soft && !nextIsVowel) segs.push(seg(scale(26), { kind: 'v', av: 0.3, f: female([280, 2200, 2900]), b: [100, 130, 200] }));
    } else if (sym === 'R') {
      const loc = female(LOCUS.r[0]);
      segs.push(seg(scale(34), { kind: 'v', av: 0.55, f: loc, b: [120, 180, 250], trill: 0.7 }));
    } else if ('pbtdkg'.includes(sym) && sym.length === 1) {
      pushStop(sym, soft, u, i, false);
    } else if (sym === 'ts' || sym === 'tS' || sym === 'tC' || sym === 'dZ' || sym === 'dz') {
      const stop = sym[0];
      const fric = sym.slice(1);
      pushStop(stop, soft || fric === 'C', u, i, true);
      pushHiss(fric, soft || fric === 'C', u, i, 0.8);
    } else if (HISS[sym]) {
      pushHiss(sym, soft, u, i, 1);
    }
    function pushStop(s, isSoft, uu, ii, affricate) {
      const voiced = 'bdg'.includes(s);
      const place = PLACE[s];
      let loc;
      if (place === 'vel') {
        const nv = vowelOf(ii + 1);
        const f2 = nv ? Math.min(2300, Math.max(900, nv[1] * 0.95)) : 1500;
        loc = female([220, f2, nv ? Math.min(nv[2], f2 + 700) : 2400]);
      } else loc = female(LOCUS[place][isSoft ? 1 : 0]);
      const close = scale((voiced ? 52 : 44) * (uu.ph.long ? 1.4 : 1));
      segs.push(seg(close, { kind: voiced ? 'v' : 's', av: voiced ? 0.14 : 0, f: loc, b: [120, 200, 300] }));
      const [bf, bw, ba] = BURST[s];
      segs.push(seg(scale(affricate ? 6 : 11), { kind: 'h', af: ba * (isSoft ? 0.9 : 1), ff: bf * fs * (isSoft ? 1.15 : 1), fb: bw, f: loc, b: [120, 200, 300], burst: true, av: voiced ? 0.1 : 0 }));
      if (!affricate) {
        const vot = voiced ? 5 : 24;
        segs.push(seg(scale(vot), { kind: 'h', ah: voiced ? 0.1 : 0.55, f: loc, b: [110, 150, 220], ff: bf * fs, fb: 3000, av: voiced ? 0.35 : 0 }));
        if (isSoft && !(flat[ii + 1]?.ph && VOWELS.has(flat[ii + 1].ph.p.replace(/[~']/g, '')))) segs.push(seg(scale(26), { kind: 'v', av: 0.3, f: female([280, 2200, 2900]), b: [100, 130, 200] }));
      }
    }
    function pushHiss(s, isSoft, uu, ii, durScale) {
      const [hf, hb, ha] = HISS[s];
      const voiced = 'zZvD'.includes(s);
      const nv = vowelOf(ii + 1);
      const f = nv ? female([nv[0] * 0.6, nv[1], nv[2]]) : female(SCHWA);
      const dur = ({ s: 100, S: 105, C: 120, x: 82, f: 82, T: 80, h: 70 })[s] || 66;
      if (s === 'h') {
        segs.push(seg(scale(lengthen(dur)), { kind: 'h', ah: 0.6, f: nv ? female(nv) : female(SCHWA), b: [120, 150, 220], ff: 1500, fb: 3000 }));
        return;
      }
      segs.push(seg(scale(lengthen(dur) * durScale), {
        kind: voiced ? 'v' : 'h', av: voiced ? 0.3 : 0, af: ha * (isSoft && 'sx'.includes(s) ? 0.9 : 1), ff: hf * fs * (isSoft && 'sx'.includes(s) ? 1.12 : 1), fb: hb, f, b: [120, 170, 240],
      }));
    }
    if (u.phraseEnd) endPhrase(phrase);
    marks.push({ pi: u.pi, wi: u.wi, seg: startIdx, end: segs.length, wordEnd: u.wordEnd });
  });
  function endPhrase(phrase) {
    const pause = { '.': 430, '!': 400, '?': 450, '…': 620, ',': 230 }[phrase.end] ?? 120;
    segs.push(seg(scale(pause), { kind: 's', pause: true, endMark: phrase.end }));
  }
  return { segs, marks };
}

// ---------- the tune ----------

// F0 (Hz) for every frame: where her pitch sits and moves. Stressed vowels get an accent, a phrase starts
// high and settles, and its closing mark sets the end: a fall for '.', a rise for '?', and so on.
function tune(segs, frames, voice, rate) {
  const f0 = new Float32Array(frames).fill(voice.f0);
  const starts = [];
  let t = 0;
  for (const s of segs) {
    starts.push(t);
    t += Math.max(1, Math.round(s.dur / FRAME));
  }
  // phrase spans (between pauses)
  let phraseStart = 0;
  const spans = [];
  segs.forEach((s, i) => {
    if (s.pause) {
      spans.push({ from: phraseStart, to: i, mark: s.endMark });
      phraseStart = i + 1;
    }
  });
  if (phraseStart < segs.length) spans.push({ from: phraseStart, to: segs.length, mark: '' });
  const base = voice.f0;
  for (const span of spans) {
    const a = starts[span.from] ?? 0;
    const b = (starts[span.to] ?? frames);
    const len = Math.max(1, b - a);
    const accents = [];
    for (let i = span.from; i < span.to; i++) if (segs[i].accent) accents.push(starts[i] + Math.round((segs[i].dur / FRAME) / 2));
    // no stressed vowel in the phrase: accent the last vowel
    if (!accents.length) {
      for (let i = span.to - 1; i >= span.from; i--) if (segs[i].vowel) { accents.push(starts[i] + 2); break; }
    }
    const excl = span.mark === '!';
    const range = voice.range;
    for (let fr = a; fr < b && fr < frames; fr++) {
      const x = (fr - a) / len; // 0..1 through the phrase
      let v = 1 + 0.12 * range * (1 - x) - 0.09 * range * x; // starts high, settles
      for (let k = 0; k < accents.length; k++) {
        const d = (fr - accents[k]) * FRAME;
        // rise-fall bump, a touch earlier before the vowel's middle; the first accent is the strongest
        const h = (0.22 + (excl ? 0.09 : 0)) * range * (k === 0 ? 1.15 : k === accents.length - 1 ? 1.0 : 0.85);
        v += h * Math.exp(-((d + 12) * (d + 12)) / (2 * 75 * 75));
      }
      // the end of the phrase
      const tail = Math.max(0, 1 - ((b - fr) * FRAME) / 260); // the last 260 ms
      if (span.mark === '?') v += tail * tail * 0.5 * range;
      else if (span.mark === '.' || span.mark === '!') v -= tail * 0.16 * Math.min(1.2, range + 0.2);
      else if (span.mark === ',') v += tail * 0.06 * range;
      else if (span.mark === '…') v -= tail * 0.1;
      f0[fr] = base * v;
    }
  }
  // smooth the tune a little (about 25 ms)
  const out = new Float32Array(frames);
  const w = 3;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(frames - 1, i + w); j++) { sum += f0[j]; n++; }
    out[i] = sum / n;
  }
  return out;
}

// ---------- the sound ----------

function resonator(f, bw) {
  const T = 1 / SR;
  const c = -Math.exp(-2 * Math.PI * bw * T);
  const b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T);
  return [1 - b - c, b, c];
}

function render(segs, voice, rand, opts) {
  // frame count and the per-frame control tracks
  const frameCount = segs.reduce((n, s) => n + Math.max(1, Math.round(s.dur / FRAME)), 0) + 6;
  const f0 = tune(segs, frameCount, voice, opts.rate);
  const track = (n) => new Float32Array(n);
  const F1 = track(frameCount); const F2 = track(frameCount); const F3 = track(frameCount);
  const B1 = track(frameCount); const B2 = track(frameCount); const B3 = track(frameCount);
  const AV = track(frameCount); const AF = track(frameCount); const AH = track(frameCount);
  const FF = track(frameCount); const FB = track(frameCount); const NZ = track(frameCount);
  const TR = track(frameCount); const BU = track(frameCount); const LA = track(frameCount);
  // smoothing the controls toward each segment's targets (the formants glide from sound to sound)
  let cf = [500, 1450, 2500];
  let cb = [90, 130, 190];
  let av = 0; let af = 0; let ah = 0; let ff = 4000; let fb = 3000; let nz = 0;
  const kForm = 1 - Math.exp(-FRAME / 13);
  const kAmp = 1 - Math.exp(-FRAME / 4.5);
  let fr = 0;
  for (const s of segs) {
    const n = Math.max(1, Math.round(s.dur / FRAME));
    for (let k = 0; k < n; k++, fr++) {
      const sharp = s.burst; // a burst is a click: no smoothing
      for (let j = 0; j < 3; j++) {
        cf[j] += (s.f[j] - cf[j]) * kForm * (s.kind === 'v' && !s.vowel ? 1.3 : 1);
        cb[j] += (s.b[j] - cb[j]) * 0.5;
      }
      const ka = sharp ? 1 : kAmp;
      av += (s.av - av) * (s.kind === 's' ? Math.min(1, ka * 1.6) : ka);
      af += (s.af - af) * (sharp ? 1 : Math.min(1, ka * 1.3));
      ah += (s.ah - ah) * ka;
      ff += (s.ff - ff) * 0.6;
      fb += (s.fb - fb) * 0.6;
      nz += (s.nz - nz) * 0.5;
      F1[fr] = cf[0]; F2[fr] = cf[1]; F3[fr] = cf[2];
      B1[fr] = cb[0]; B2[fr] = cb[1]; B3[fr] = cb[2];
      AV[fr] = av; AF[fr] = af * (sharp ? Math.exp(-k * 0.55) : 1); AH[fr] = ah; FF[fr] = ff; FB[fr] = fb; NZ[fr] = nz;
      TR[fr] = s.trill; BU[fr] = sharp ? 1 : 0; LA[fr] = s.laugh ? 1 : 0;
    }
  }
  const total = fr * FRAME_SAMPLES;
  const out = new Float32Array(total);
  const fs = opts.fs;
  // fixed upper formants (a younger, smaller voice has them higher)
  const [a4, b4, c4] = resonator(3500 * fs, 260);
  const [a5, b5, c5] = resonator(4600 * fs, 330);
  const oq = 0.5 + voice.breath * 0.3; // how open the voice box is (open = breathy)
  const tp = oq * 0.62;
  let phase = 0;
  let curF0 = voice.f0;
  let jitter = 1;
  let shimmer = 1;
  let y11 = 0; let y12 = 0; let y21 = 0; let y22 = 0; let y31 = 0; let y32 = 0; let y41 = 0; let y42 = 0; let y51 = 0; let y52 = 0;
  let n1 = 0; let n2 = 0; let hx1 = 0; let hx2 = 0; // noise filter memory
  let z1 = 0; let z2 = 0; // notch
  let lp = 0;
  let trillPhase = 0;
  let a1 = 0; let b1 = 0; let c1 = 0; let a2 = 0; let b2 = 0; let c2 = 0; let a3 = 0; let b3 = 0; let c3 = 0;
  let nb0 = 0; let nb2 = 0; let na1 = 0; let na2 = 0;
  let zb0 = 1; let zb1 = 0; let zb2 = 0; let za1 = 0; let za2 = 0;
  const rough = voice.rough;
  const breath = voice.breath;
  let vib = 0;
  for (let i = 0; i < total; i++) {
    const f = Math.min(frameCount - 2, Math.floor(i / FRAME_SAMPLES));
    const u = (i - f * FRAME_SAMPLES) / FRAME_SAMPLES;
    const lerp = (arr) => arr[f] + (arr[f + 1] - arr[f]) * u;
    if (i % 24 === 0) {
      // new filter settings every ~1 ms
      [a1, b1, c1] = resonator(lerp(F1), lerp(B1));
      [a2, b2, c2] = resonator(lerp(F2), lerp(B2));
      [a3, b3, c3] = resonator(lerp(F3), lerp(B3));
      const fc = Math.min(SR / 2 - 200, Math.max(300, lerp(FF)));
      const q = Math.max(0.4, fc / Math.max(200, lerp(FB)));
      const w0 = (2 * Math.PI * fc) / SR;
      const alpha = Math.sin(w0) / (2 * q);
      const a0 = 1 + alpha;
      nb0 = alpha / a0; nb2 = -alpha / a0; na1 = (-2 * Math.cos(w0)) / a0; na2 = (1 - alpha) / a0;
      const nzf = lerp(NZ);
      if (nzf > 100) {
        const wn = (2 * Math.PI * nzf) / SR;
        const al = Math.sin(wn) / (2 * 2.2);
        const a0n = 1 + al;
        zb0 = 1 / a0n; zb1 = (-2 * Math.cos(wn)) / a0n; zb2 = 1 / a0n; za1 = (-2 * Math.cos(wn)) / a0n; za2 = (1 - al) / a0n;
      } else { zb0 = 1; zb1 = 0; zb2 = 0; za1 = 0; za2 = 0; }
    }
    // the pitch: the tune, a slow wobble, a little vibrato on long sounds, jitter
    if (i % 110 === 0) vib = (rand() - 0.5) * 0.012;
    const target = lerp(f0) * opts.pitch * (1 + vib + 0.006 * Math.sin((2 * Math.PI * 5.4 * i) / SR));
    curF0 += (target - curF0) * 0.02;
    const av = Math.max(0, lerp(AV));
    const laugh = lerp(LA);
    const f0Now = curF0 * jitter * (laugh ? 1 - 0.1 * Math.min(1, (i % (SR * 0.155)) / (SR * 0.155)) : 1);
    phase += f0Now / SR;
    let glottal = 0;
    if (phase >= 1) {
      phase -= 1;
      jitter = 1 + (rand() - 0.5) * (0.006 + rough * 0.03);
      shimmer = 1 + (rand() - 0.5) * (0.05 + rough * 0.35);
      // creaky roughness: now and then a pulse is skipped or doubled in a rough voice
      if (rough > 0.25 && rand() < (rough - 0.2) * 0.12) shimmer *= 0.45;
    }
    // the pulse of air through the voice box (the shape that matters is its sudden close)
    if (phase < tp) glottal = (Math.PI / (2 * tp)) * Math.sin((Math.PI * phase) / tp);
    else if (phase < oq) glottal = -(Math.PI / (2 * (oq - tp))) * Math.sin((Math.PI / 2) * ((phase - tp) / (oq - tp)));
    glottal *= 0.55 * shimmer;
    // r: the tongue taps the roof of the mouth about 28 times a second
    let trill = 1;
    const tr = lerp(TR);
    if (tr > 0) {
      trillPhase += 28 / SR;
      const p = trillPhase % 1;
      trill = 1 - 0.85 * tr * Math.exp(-((p - 0.5) * (p - 0.5)) / (2 * 0.12 * 0.12));
    }
    // sources
    const noise = rand() * 2 - 1;
    const aspiration = noise * (lerp(AH) + breath * 0.07 * av + 0.012 * av + rough * 0.05 * av);
    const voicedSrc = glottal * av * trill + aspiration;
    // the formant chain
    let y = a1 * voicedSrc + b1 * y11 + c1 * y12; y12 = y11; y11 = y;
    y = a2 * y + b2 * y21 + c2 * y22; y22 = y21; y21 = y;
    y = a3 * y + b3 * y31 + c3 * y32; y32 = y31; y31 = y;
    y = a4 * y + b4 * y41 + c4 * y42; y42 = y41; y41 = y;
    y = a5 * y + b5 * y51 + c5 * y52; y52 = y51; y51 = y;
    // nasals: a notch in the spectrum
    if (zb1 !== 0 || zb2 !== 0) {
      const w = y - za1 * z1 - za2 * z2;
      const yn = zb0 * w + zb1 * z1 + zb2 * z2;
      z2 = z1; z1 = w;
      y = yn;
    }
    // hissing sounds and bursts: noise through a band
    const hissIn = rand() * 2 - 1;
    const hy = nb0 * hissIn + nb2 * hx2 - na1 * n1 - na2 * n2; // a second-order band filter
    hx2 = hx1; hx1 = hissIn;
    n2 = n1; n1 = hy;
    const af = lerp(AF);
    // (the chain's output runs about 30 times the noise band's: the first is scaled down to meet it)
    let s = y * 0.3 + hy * af * 1.8 * (1 + 0.15 * (rand() - 0.5));
    // a bit of sparkle in the high end (more when she is excited or sharp)
    lp += (s - lp) * 0.35;
    s += (s - lp) * voice.bright * 0.9;
    out[i] = s;
  }
  return { out, frameCount };
}

// ---------- the digital edge: a stutter now and then ----------

function glitch(out, marks, segs, voice, rand) {
  if (voice.glitch <= 0.01) return out;
  // word ends, in samples
  const starts = [];
  let t = 0;
  for (const s of segs) {
    starts.push(t);
    t += Math.max(1, Math.round(s.dur / FRAME)) * FRAME_SAMPLES;
  }
  const spots = marks.filter((m) => m.wordEnd && segs[m.end - 1] && !segs[m.end - 1].pause);
  const result = [];
  let cursor = 0;
  for (const m of spots) {
    if (rand() > voice.glitch * 0.45) continue;
    const at = (starts[m.end - 1] ?? 0) + Math.round(((segs[m.end - 1].dur / FRAME) * FRAME_SAMPLES) * 0.7);
    if (at < cursor + SR * 0.2 || at > out.length - SR * 0.1) continue;
    result.push(at);
    cursor = at;
  }
  if (!result.length) return out;
  const pieces = [];
  let from = 0;
  for (const at of result) {
    pieces.push(out.subarray(from, at));
    const grain = Math.round(SR * (0.022 + rand() * 0.02));
    const g = out.subarray(at - grain, at);
    const kind = rand();
    if (kind < 0.6) {
      // a stutter: the last grain again, quieter, twice
      for (let k = 0; k < 2; k++) {
        const c = new Float32Array(g.length);
        for (let i = 0; i < g.length; i++) c[i] = g[i] * (0.8 - k * 0.25) * Math.min(1, i / 40) * Math.min(1, (g.length - i) / 40);
        pieces.push(c);
      }
    } else {
      // a bitcrush: the grain thinned to a few levels, held for a few samples
      const c = new Float32Array(g.length * 2);
      for (let i = 0; i < c.length; i += 4) {
        const v = Math.round((g[Math.min(g.length - 1, i >> 1)] ?? 0) * 6) / 6;
        for (let k = 0; k < 4 && i + k < c.length; k++) c[i + k] = v * 0.7 * Math.min(1, i / 60) * Math.min(1, (c.length - i) / 60);
      }
      pieces.push(c);
    }
    from = at;
  }
  pieces.push(out.subarray(from));
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const merged = new Float32Array(total);
  let o = 0;
  for (const p of pieces) { merged.set(p, o); o += p.length; }
  return merged;
}

// ---------- the whole thing ----------

export function synthesize(text, { lang = 'ru', mood = 'calm', rate = 1, pitch = 1, seed } = {}) {
  const base = MOODS[mood] || MOODS.calm;
  const voice = { ...base };
  const phrases = phonemize(text, lang);
  if (!phrases.length) return { samples: new Float32Array(0), sampleRate: SR, duration: 0 };
  const speed = Math.max(0.5, Math.min(2, rate)) * base.rate * 1.15; // she is quick
  const fs = 1.16; // a young woman's vocal tract: formants about 16% above a man's
  const rand = rng(seed ?? hash(`${text}|${mood}`));
  const { segs, marks } = expand(phrases, mood, speed, fs);
  while (segs.length && segs[segs.length - 1].pause) segs.pop(); // no silence at the end
  const { out } = render(segs, voice, rand, { rate: speed, fs, pitch: Math.max(0.5, Math.min(2, pitch)) });
  let samples = glitch(out, marks, segs, voice, rand);
  // level: a gentle limiter, then loudness by mood
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0 ? (0.82 / peak) * base.gain : 1;
  samples = samples.map((v) => Math.tanh(v * gain * 1.25) / Math.tanh(1.25));
  // a short fade at both ends (no click)
  const fade = Math.min(200, Math.floor(samples.length / 4));
  for (let i = 0; i < fade; i++) {
    samples[i] *= i / fade;
    samples[samples.length - 1 - i] *= i / fade;
  }
  return { samples, sampleRate: SR, duration: samples.length / SR };
}

export const MOOD_NAMES = Object.keys(MOODS);

// a 16-bit mono WAV of the samples (tools/voice-demo.mjs, and anywhere a file is wanted)
export function toWav(samples, sampleRate = SR) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return bytes;
}
