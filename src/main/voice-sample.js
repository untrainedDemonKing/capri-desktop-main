'use strict';

// Her voice, if you give her one: a short recording of the voice she should speak with. Chatterbox (on this PC) takes it
// as the voice to copy (chatterbox-server.py, `voice`), so she sounds like the recording and not like the model's own.
// The file is copied into her data folder (voices/capri.wav) and stays on this PC: it goes to no service, and it goes
// with her when she is taken off.
//
// A recording that works: one voice, clean speech, no music or noise behind it, 5 to 30 seconds (the first 20 are used).
// WAV files are looked into (length, silence, clipping); the other formats Chatterbox reads (mp3, flac, ogg) are taken
// as they are. Use a voice you have the right to use: your own, or one whose owner agreed.

const fs = require('node:fs');
const path = require('node:path');

const NAME = 'capri'; // the name the voice server finds it by (chatterbox-server.py find_voice)
const EXTS = ['.wav', '.mp3', '.flac', '.ogg'];
const MAX_BYTES = 60 * 1024 * 1024;
const MIN_SECONDS = 2; // under this there is nothing to copy a voice from
const GOOD_SECONDS = [5, 30];
const READ_SECONDS = 30; // how much of a WAV is looked through for loudness

// A WAV file's numbers: { seconds, rate, channels, bits, peak, rms, clipped } (peak and rms 0..1), or null if it is not
// a WAV she can read (PCM 8-32 bit or float).
function readWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (id === 'fmt ' && size >= 16 && start + 16 <= buf.length) {
      let format = buf.readUInt16LE(start);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(start + 24); // (extensible: the real format is in the sub-format)
      fmt = { format, channels: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    } else if (id === 'data' && fmt) {
      data = { start, size: Math.min(size, buf.length - start) }; // (a stream's size field can be wrong or 0xFFFFFFFF)
      break;
    }
    pos = start + size + (size & 1);
  }
  if (!fmt || !data || !fmt.channels || !fmt.rate) return null;
  const { format, channels, rate, bits } = fmt;
  const supported = (format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && [32, 64].includes(bits));
  if (!supported) return null;
  const width = bits / 8;
  const frame = width * channels;
  const frames = Math.floor(data.size / frame);
  const read = (at) => {
    if (format === 3) return bits === 32 ? buf.readFloatLE(at) : buf.readDoubleLE(at);
    if (bits === 8) return (buf[at] - 128) / 128;
    if (bits === 16) return buf.readInt16LE(at) / 32768;
    if (bits === 24) return buf.readIntLE(at, 3) / 8388608;
    return buf.readInt32LE(at) / 2147483648;
  };
  // the loudness, from the first channel of up to the first READ_SECONDS (every few frames: enough to tell)
  const span = Math.min(frames, Math.floor(rate * READ_SECONDS));
  const stride = Math.max(1, Math.floor(span / 200000));
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  let n = 0;
  for (let i = 0; i < span; i += stride) {
    const v = Math.abs(read(data.start + i * frame));
    if (v > peak) peak = v;
    if (v >= 0.999) clipped++;
    sum += v * v;
    n++;
  }
  return { seconds: frames / rate, rate, channels, bits, peak, rms: n ? Math.sqrt(sum / n) : 0, clipped: n ? clipped / n : 0 };
}

// What is wrong with a recording, as codes: `reject` (cannot be used) and `warn` (can, but it will not be good).
function judge(info) {
  const warn = [];
  if (!info) return { reject: '', warn };
  if (info.seconds < MIN_SECONDS) return { reject: 'short', warn };
  if (info.rms < 0.002 || info.peak < 0.01) return { reject: 'silent', warn };
  if (info.seconds < GOOD_SECONDS[0]) warn.push('shortish');
  if (info.seconds > GOOD_SECONDS[1]) warn.push('long');
  if (info.peak < 0.08) warn.push('quiet');
  if (info.clipped > 0.005) warn.push('clipped');
  return { reject: '', warn };
}

// `dir`: the folder it lives in, or a function that gives it (her data folder is known only once the app is ready)
function createSample({ dir: dirOrFn, fsx = fs }) {
  const where = () => (typeof dirOrFn === 'function' ? dirOrFn() : dirOrFn);
  const fileFor = (ext) => path.join(where(), NAME + ext);
  const found = () => EXTS.map(fileFor).find((f) => fsx.existsSync(f)) || '';

  // { has, name, ext, bytes, seconds (WAV only, else null), warn: [codes], file }
  function status() {
    const file = found();
    if (!file) return { has: false, name: '', ext: '', bytes: 0, seconds: null, warn: [], file: '' };
    let info = null;
    const ext = path.extname(file);
    try {
      if (ext === '.wav') info = readWav(fsx.readFileSync(file));
    } catch {
      // unreadable: still hers, just not looked into
    }
    return { has: true, name: NAME, ext, bytes: fsx.statSync(file).size, seconds: info ? Math.round(info.seconds * 10) / 10 : null, warn: judge(info).warn, file };
  }

  function remove() {
    for (const ext of EXTS) fsx.rmSync(fileFor(ext), { force: true });
    return status();
  }

  // Takes a recording as her voice. { ok: true, ...status } or { ok: false, error: 'missing' | 'format' | 'empty' | 'big' | 'wav' | 'short' | 'silent' | 'copy' }.
  function use(src) {
    const from = String(src || '');
    const ext = path.extname(from).toLowerCase();
    let stat;
    try {
      stat = fsx.statSync(from);
    } catch {
      return { ok: false, error: 'missing' };
    }
    if (!stat.isFile()) return { ok: false, error: 'missing' };
    if (!EXTS.includes(ext)) return { ok: false, error: 'format' };
    if (!stat.size) return { ok: false, error: 'empty' };
    if (stat.size > MAX_BYTES) return { ok: false, error: 'big' };
    try {
      if (ext === '.wav') {
        const info = readWav(fsx.readFileSync(from));
        if (!info) return { ok: false, error: 'wav' }; // (compressed or broken: exported as 16-bit PCM it would do)
        const { reject } = judge(info);
        if (reject) return { ok: false, error: reject };
      }
      fsx.mkdirSync(where(), { recursive: true });
      const tmp = `${fileFor(ext)}.tmp`;
      fsx.copyFileSync(from, tmp);
      for (const other of EXTS) if (other !== ext) fsx.rmSync(fileFor(other), { force: true }); // (one voice: the new one replaces the old)
      fsx.renameSync(tmp, fileFor(ext));
    } catch {
      return { ok: false, error: 'copy' };
    }
    return { ok: true, ...status() };
  }

  return { status, use, remove, dir: where, name: NAME, current: () => (found() ? NAME : '') };
}

module.exports = { createSample, readWav, judge, NAME, EXTS, MAX_BYTES };
