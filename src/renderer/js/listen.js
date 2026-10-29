// How she tells your turn from the noise around you, and what she sends to be written down (ears.js uses these; they
// need no microphone, so they are plain functions and a small machine that tests can walk through).

export const FRAME_MS = 40;       // how often the level is looked at
export const PRE_ROLL_MS = 800;   // what was said just before she was sure you were speaking: it is kept, so that no first word is lost
export const TAIL_MS = 550;       // how much of the quiet after the last word goes along (a long silence makes Whisper invent words)
export const TARGET_RATE = 16000; // what speech recognition wants
const SEED_FRAMES = 25;           // a second of frames

// The machine that follows the level, frame by frame, and says when your turn starts, ends, or was only noise.
//   base      the level (RMS) below which nothing counts: her menu's sensitivity
//   the noise around is learned: a room with a loud fan or a mic with its gain up raises the line to 2.5 times the quiet
//   that is heard (a steady hum is taken for the quiet in the first second after the mic is opened, and in a minute at
//   most later), so that it is not taken for a voice; the line never goes below `base`
// Events from push(): 'start' (a voice that lasts), 'end' (you spoke, then went quiet), 'drop' (it was only a noise, or
// you pressed to talk and said nothing).
export class TurnDetector {
  constructor({ base = 0.012, hangMs = 1000, minSpeechMs = 280, startMs = 120, maxMs = 20000, patienceMs = 5000 } = {}) {
    Object.assign(this, { base, hangMs, minSpeechMs, startMs, maxMs, patienceMs });
    this.floor = 0;       // the noise around you, as heard
    this.seed = [];       // the first second after the mic was opened: what the noise around is, to start from
    this.voiced = false;  // the last frame was a voice (a voice goes on until it falls well below the line: no flicker)
    this.inTurn = false;
    this.single = false;  // the turn was begun by pressing the button: you may take a moment to start
    this.candidate = 0;   // how long a voice has been there, before it is sure
    this.voicedMs = 0;    // how much of the turn was voice
    this.silentMs = 0;    // how long it has been quiet since
    this.startedAt = 0;
    this.lastVoiceAt = 0;
    this.last = 0;
  }

  // the level above which a sound is a voice now
  get threshold() {
    return Math.max(this.base, this.floor * 2.5);
  }

  // A turn begun by hand (press to talk): the recording is on, whether or not there is a voice yet.
  begin(now, { single = false } = {}) {
    this.inTurn = true;
    this.single = single;
    this.startedAt = now - this.candidate;
    this.voicedMs = this.candidate;
    this.silentMs = 0;
    this.candidate = 0;
    this.lastVoiceAt = this.voicedMs ? now : 0;
  }

  reset() {
    this.inTurn = false;
    this.voiced = false;
    this.candidate = 0;
    this.last = 0;
  }

  // The mic was just opened: its first second tells what the room sounds like.
  calibrate() {
    this.seed = [];
    this.floor = 0;
    this.reset();
  }

  // (a steady level that is never below the line is a hum: the quiet is that; else the quietest moments are)
  learnSeed(rms) {
    this.seed.push(rms);
    if (this.seed.length !== SEED_FRAMES) return;
    const sorted = [...this.seed].sort((a, b) => a - b);
    const steady = sorted[0] > this.base * 0.8 && sorted[Math.floor(sorted.length / 2)] / sorted[0] < 2.5;
    this.floor = Math.max(this.floor, steady ? sorted[Math.floor(sorted.length / 2)] * 0.9 : sorted[2]);
  }

  // One look at the level. `deaf`: she is talking (or her voice has not died away): nothing counts, nothing is learned.
  push(rms, now, { deaf = false } = {}) {
    const dt = this.last ? Math.min(100, Math.max(1, now - this.last)) : FRAME_MS;
    this.last = now;
    if (deaf) {
      this.candidate = 0;
      this.voiced = false;
      if (!this.inTurn) return null;
      return this.follow(false, dt, now);
    }
    const on = this.threshold;
    const voiced = rms > (this.voiced ? on * 0.55 : on);
    this.voiced = voiced;
    // the noise around: down quickly, up slowly (and much more slowly while you speak: a long sentence must not raise the line over itself)
    this.floor += (rms - this.floor) * (rms > this.floor ? (this.inTurn ? 0.0004 : 0.004) : 0.08);
    if (this.seed.length < SEED_FRAMES) this.learnSeed(rms);
    if (this.inTurn) return this.follow(voiced, dt, now);
    if (this.seed.length < SEED_FRAMES) return null; // (the first second after the mic was opened is for learning the room: no turn starts in it)
    if (!voiced) {
      this.candidate = Math.max(0, this.candidate - dt);
      return null;
    }
    this.candidate += dt;
    if (this.candidate < this.startMs) return null;
    this.begin(now);
    return 'start';
  }

  follow(voiced, dt, now) {
    if (voiced) {
      this.voicedMs += dt;
      this.silentMs = 0;
      this.lastVoiceAt = now;
    } else this.silentMs += dt;
    const elapsed = now - this.startedAt;
    let event = null;
    if (elapsed >= this.maxMs) event = this.voicedMs >= this.minSpeechMs ? 'end' : 'drop';
    else if (this.voicedMs >= this.minSpeechMs && this.silentMs >= this.hangMs) event = 'end';
    else if (this.voicedMs === 0 && this.single && elapsed >= this.patienceMs) event = 'drop'; // (pressed, and nothing said)
    else if (this.voicedMs < this.minSpeechMs && this.voicedMs > 0 && this.silentMs >= 700) event = 'drop'; // (a click, a cough)
    else if (this.voicedMs === 0 && !this.single && this.silentMs >= 700) event = 'drop';
    if (event) {
      this.inTurn = false;
      this.voiced = false;
    }
    return event;
  }
}

// A list of chunks of samples (Float32Array) as one.
export function joinSamples(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// The same samples at another rate (what is said is for the ears of a recogniser: 16 kHz is all it needs, and a third of the bytes).
export function resample(samples, from, to = TARGET_RATE) {
  if (!from || from <= to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = i * ratio;
    const b = Math.min(samples.length, (i + 1) * ratio);
    let sum = 0;
    let n = 0;
    for (let j = Math.floor(a); j < Math.ceil(b); j++) {
      sum += samples[j];
      n += 1;
    }
    out[i] = n ? sum / n : 0; // (the mean of what falls in the new sample: also a low-pass, so that nothing folds back)
  }
  return out;
}

// What is said, made louder when it is quiet (a mic with a low gain: recognisers do worse on it), never more than 6 times and never clipped.
export function lift(samples, goal = 0.6) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak <= 0.002 || peak >= goal * 0.5) return samples;
  const gain = Math.min(6, goal / peak);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

// 16-bit mono WAV, as an ArrayBuffer.
export function encodeWav(samples, rate = TARGET_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return buffer;
}

// A turn as it goes to be written down: the pre-roll and what was said, the quiet after the last word cut short, brought to
// 16 kHz and lifted if it is faint. `chunks`: what was heard, from the pre-roll on; `keep`: how many seconds of it to
// send (up to the last word and a short tail); `rate`: the rate it was heard at.
export function turnAudio(chunks, rate, keepSeconds) {
  let samples = joinSamples(chunks);
  if (Number.isFinite(keepSeconds)) samples = samples.subarray(0, Math.max(0, Math.min(samples.length, Math.round(keepSeconds * rate))));
  samples = lift(resample(samples, rate));
  return { wav: encodeWav(samples, Math.min(rate, TARGET_RATE)), seconds: samples.length / Math.min(rate, TARGET_RATE) };
}
