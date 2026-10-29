'use strict';

// Just enough of the wav format to take a speech file of any rate (Piper makes 22 kHz) to the 16 kHz, 16 bit, mono that the
// recogniser is given.

function read(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a wav file');
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === 'data') {
      if (!fmt) throw new Error('wav without a format');
      if (fmt.bits !== 16 || fmt.format !== 1) throw new Error(`wav of ${fmt.bits} bits (format ${fmt.format}): only 16-bit PCM is handled`);
      const end = Math.min(buf.length, at + 8 + size);
      const count = Math.floor((end - at - 8) / 2 / fmt.channels);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(at + 8 + i * 2 * fmt.channels); // (the first channel)
      return { rate: fmt.rate, channels: fmt.channels, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('wav without sound');
}

function write(samples, rate) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(samples[i], 44 + i * 2);
  return out;
}

function to16k(buf) {
  const { rate, samples } = read(buf);
  if (rate === 16000) return write(samples, 16000);
  const n = Math.floor((samples.length * 16000) / rate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * rate) / 16000;
    const a = Math.floor(pos);
    const b = Math.min(samples.length - 1, a + 1);
    out[i] = Math.round(samples[a] + (samples[b] - samples[a]) * (pos - a));
  }
  return write(out, 16000);
}

// the loudest sample, as a share of full scale (0 to 1): a speech file that is all quiet is a failed one
function peak(buf) {
  const { samples } = read(buf);
  let p = 0;
  for (const s of samples) p = Math.max(p, Math.abs(s));
  return p / 32768;
}

module.exports = { read, write, to16k, peak };
