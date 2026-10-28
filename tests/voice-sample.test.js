'use strict';

// The recording she can be given as her voice (src/main/voice-sample.js): what is taken, what is refused and why, what is
// only warned about, and the one voice she keeps. And the way it reaches Chatterbox (tts.js).
//   node --test tests/voice-sample.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSample, readWav, judge, MAX_BYTES } = require('../src/main/voice-sample.js');
const tts = require('../src/main/tts.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-sample-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = () => {
  const dir = path.join(tmp, `case${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, voices: path.join(dir, 'voices'), sample: createSample({ dir: path.join(dir, 'voices') }) };
};

// a WAV of `seconds` of a tone at `level` (0..1): 16-bit mono 16 kHz by default, or float
function wav({ seconds = 6, level = 0.4, rate = 16000, bits = 16, float = false, channels = 1, clip = 0 } = {}) {
  const frames = Math.round(seconds * rate);
  const width = bits / 8;
  const data = Buffer.alloc(frames * channels * width);
  for (let i = 0; i < frames; i++) {
    let v = Math.sin((2 * Math.PI * 220 * i) / rate) * level;
    if (clip && i % Math.round(1 / clip) === 0) v = 1;
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * width;
      if (float) data.writeFloatLE(v, at);
      else if (bits === 16) data.writeInt16LE(Math.round(v * 32767), at);
      else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), at, 3);
      else if (bits === 8) data[at] = Math.round(v * 127) + 128;
      else data.writeInt32LE(Math.round(v * 2147483647), at);
    }
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(float ? 3 : 1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * width, 28);
  head.writeUInt16LE(channels * width, 32);
  head.writeUInt16LE(bits, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const put = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

test('a WAV is read for its length and loudness, in the formats people have', () => {
  const a = readWav(wav({ seconds: 6, level: 0.5 }));
  assert.equal(a.seconds, 6);
  assert.equal(a.rate, 16000);
  assert.ok(Math.abs(a.peak - 0.5) < 0.01 && a.rms > 0.3 && a.rms < 0.4, JSON.stringify(a));
  for (const spec of [{ bits: 8 }, { bits: 24 }, { bits: 32 }, { bits: 32, float: true }, { bits: 16, channels: 2, rate: 44100 }]) {
    const r = readWav(wav({ seconds: 3, ...spec }));
    assert.ok(r && Math.abs(r.seconds - 3) < 0.01 && r.peak > 0.3, JSON.stringify(spec));
  }
  // not a wav, a compressed one, a truncated header
  assert.equal(readWav(Buffer.from('ID3 not a wav at all, an mp3 maybe..............................')), null);
  const adpcm = wav();
  adpcm.writeUInt16LE(2, 20);
  assert.equal(readWav(adpcm), null, 'ADPCM is not read');
  assert.equal(readWav(wav().subarray(0, 30)), null);
  // a stream's size field can be wrong: what is there is what counts
  const streamed = wav({ seconds: 4 });
  streamed.writeUInt32LE(0xffffffff, 40);
  assert.equal(readWav(streamed).seconds, 4);
});

test('what is wrong with a recording: refused when nothing can be copied from it, warned about when it will only be worse', () => {
  const j = (o) => judge(readWav(wav(o)));
  assert.deepEqual(j({ seconds: 8 }), { reject: '', warn: [] });
  assert.equal(j({ seconds: 1 }).reject, 'short');
  assert.equal(j({ seconds: 8, level: 0 }).reject, 'silent');
  assert.deepEqual(j({ seconds: 3.5 }).warn, ['shortish']);
  assert.deepEqual(j({ seconds: 40 }).warn, ['long']);
  assert.deepEqual(j({ seconds: 8, level: 0.04 }).warn, ['quiet']);
  assert.deepEqual(j({ seconds: 8, clip: 0.05 }).warn, ['clipped']);
  assert.deepEqual(judge(null), { reject: '', warn: [] }, 'a format that is not looked into is taken as it is');
});

test('she takes a recording as her voice: copied into her folder as capri.wav, with its length', () => {
  const { sample, voices, dir } = fresh();
  assert.deepEqual(sample.status(), { has: false, name: '', ext: '', bytes: 0, seconds: null, warn: [], lang: '', file: '' });
  assert.equal(sample.current(), '');
  const src = put(path.join(dir, 'Моя запись (1).WAV'), wav({ seconds: 9 }));
  const res = sample.use(src);
  assert.equal(res.ok, true);
  assert.equal(res.name, 'capri');
  assert.equal(res.seconds, 9);
  assert.equal(res.file, path.join(voices, 'capri.wav'));
  assert.deepEqual(fs.readFileSync(res.file), fs.readFileSync(src), 'a copy of it');
  assert.ok(fs.existsSync(src), 'and yours stays where it was');
  assert.equal(sample.current(), 'capri');
  assert.deepEqual(fs.readdirSync(voices), ['capri.wav'], 'no half-written file left');
});

test('one voice: a new recording replaces the old, whatever its format; taking it away leaves nothing', () => {
  const { sample, voices, dir } = fresh();
  assert.equal(sample.use(put(path.join(dir, 'a.wav'), wav())).ok, true);
  const mp3 = put(path.join(dir, 'b.mp3'), Buffer.concat([Buffer.from('ID3'), Buffer.alloc(5000, 7)]));
  const res = sample.use(mp3);
  assert.equal(res.ok, true);
  assert.equal(res.ext, '.mp3');
  assert.equal(res.seconds, null, 'only a wav is looked into');
  assert.deepEqual(fs.readdirSync(voices), ['capri.mp3'], 'the wav is gone');
  assert.deepEqual(sample.remove(), { has: false, name: '', ext: '', bytes: 0, seconds: null, warn: [], lang: '', file: '' });
  assert.deepEqual(fs.readdirSync(voices), []);
  assert.equal(sample.remove().has, false, 'taking away nothing is nothing');
});

test('what she refuses, and says why; the voice she has stays', () => {
  const { sample, voices, dir } = fresh();
  assert.equal(sample.use(put(path.join(dir, 'good.wav'), wav())).ok, true);
  const before = fs.readFileSync(path.join(voices, 'capri.wav'));
  const no = (file, error) => assert.deepEqual(sample.use(file), { ok: false, error }, error);
  no(path.join(dir, 'nowhere.wav'), 'missing');
  no(dir, 'missing');
  no(put(path.join(dir, 'x.m4a'), 'abc'), 'format');
  no(put(path.join(dir, 'x.txt'), 'abc'), 'format');
  no(put(path.join(dir, 'empty.wav'), ''), 'empty');
  no(put(path.join(dir, 'broken.wav'), 'RIFF....WAVE nothing else'), 'wav');
  no(put(path.join(dir, 'short.wav'), wav({ seconds: 1 })), 'short');
  no(put(path.join(dir, 'quiet.wav'), wav({ level: 0 })), 'silent');
  const huge = path.join(dir, 'huge.flac');
  fs.writeFileSync(huge, '');
  fs.truncateSync(huge, MAX_BYTES + 1);
  no(huge, 'big');
  assert.deepEqual(fs.readFileSync(path.join(voices, 'capri.wav')), before, 'none of it touched hers');
  assert.deepEqual(fs.readdirSync(voices), ['capri.wav']);
  // a recording that is not nice is still taken, with a word of warning
  const warned = sample.use(put(path.join(dir, 'low.wav'), wav({ seconds: 4, level: 0.04 })));
  assert.equal(warned.ok, true);
  assert.deepEqual(warned.warn, ['shortish', 'quiet']);
});

test('the language spoken in a recording is kept beside it when it is known, and goes with it', () => {
  const { sample, voices, dir } = fresh();
  const src = put(path.join(dir, 'a.wav'), wav());
  assert.equal(sample.use(src, { spoken: 'en' }).lang, 'en');
  assert.deepEqual(fs.readdirSync(voices).sort(), ['capri.json', 'capri.wav']);
  assert.equal(sample.lang(), 'en');
  // another recording with nothing said about it: not known any more (it is not the same voice)
  assert.equal(sample.use(src).lang, '');
  assert.deepEqual(fs.readdirSync(voices), ['capri.wav']);
  // nonsense in the note, or a language she does not speak: not known
  sample.use(src, { spoken: 'fr' });
  assert.equal(sample.lang(), '');
  sample.use(src, { spoken: 'ru' });
  fs.writeFileSync(path.join(voices, 'capri.json'), '{not json');
  assert.equal(sample.lang(), '');
  sample.use(src, { spoken: 'ru' });
  sample.remove();
  assert.deepEqual(fs.readdirSync(voices), [], 'the note goes with the recording');
});

test('a recording that came with her is taken once, only when she has none of her own, with what is spoken in it', () => {
  const { sample, voices, dir } = fresh();
  const bundled = path.join(dir, 'resources', 'voice-default');
  assert.equal(sample.useBundled(bundled), null, 'no such folder');
  put(path.join(bundled, 'capri.wav'), wav({ seconds: 8 }));
  fs.writeFileSync(path.join(bundled, 'capri.json'), JSON.stringify({ lang: 'en' }));
  const res = sample.useBundled(bundled);
  assert.equal(res.ok, true);
  assert.deepEqual([res.seconds, res.lang], [8, 'en']);
  assert.ok(fs.existsSync(path.join(voices, 'capri.wav')));
  // one of her own is not replaced
  sample.use(put(path.join(dir, 'mine.wav'), wav({ seconds: 6 })), { spoken: 'ru' });
  assert.deepEqual(sample.useBundled(bundled), { ok: false, error: 'has' });
  assert.equal(sample.status().seconds, 6);
  // a bad one that came with her is refused like any
  sample.remove();
  put(path.join(bundled, 'capri.wav'), wav({ seconds: 0.5 }));
  assert.deepEqual(sample.useBundled(bundled), { ok: false, error: 'short' });
});

test('the recording is looked through once, not at every look, and again when it changes', () => {
  const { sample, voices, dir } = fresh();
  let reads = 0;
  const fsx = { ...fs, readFileSync: (...a) => { if (String(a[0]).endsWith('.wav')) reads++; return fs.readFileSync(...a); } };
  const counted = createSample({ dir: voices, fsx });
  counted.use(put(path.join(dir, 'a.wav'), wav({ seconds: 6 })));
  const before = reads;
  for (let i = 0; i < 20; i++) assert.equal(counted.status().seconds, 6);
  assert.equal(reads, before, 'twenty looks, no new read');
  fs.writeFileSync(path.join(voices, 'capri.wav'), wav({ seconds: 9 }));
  assert.equal(counted.status().seconds, 9, 'a changed file is looked at again');
  assert.ok(sample);
});

test('the folder is asked for when it is needed (her data folder is known only once the app is ready)', () => {
  const { dir } = fresh();
  let asked = 0;
  const sample = createSample({ dir: () => { asked++; return path.join(dir, 'late'); } });
  assert.equal(asked, 0);
  assert.equal(sample.status().has, false);
  assert.ok(asked > 0);
});

test('Chatterbox is told to speak with the recording she was given; a name in her settings is for when she has none', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(Buffer.from('RIFFxxxxWAVE'), { status: 200 });
  };
  try {
    const say = (cfg, sample, sampleLang = '') => tts.speak({ ttsEngine: 'chatterbox', ...cfg }, {}, { text: 'Привет', mood: 'calm', lang: 'ru', base: 'http://127.0.0.1:1/v1', sample, sampleLang });
    await say({}, '');
    await say({}, 'capri');
    await say({ ttsVoice: 'anna' }, '');
    await say({ ttsVoice: 'anna' }, 'capri');
    assert.deepEqual(seen.map((b) => b.voice), [undefined, 'capri', 'anna', 'capri']);
    assert.ok(seen.every((b) => b.exaggeration !== undefined && b.cfg_weight !== undefined), 'her mood still goes with it');
    // a recording in another language than she speaks: no pull towards its own delivery (it carries its accent over)
    seen.length = 0;
    await say({}, 'capri', 'en');   // she speaks Russian, the recording is English
    await say({}, 'capri', 'ru');   // the same language
    await say({}, 'capri', '');     // not known
    await say({}, '', 'en');        // no recording
    assert.deepEqual(seen.map((b) => b.cfg_weight === 0), [true, false, false, false]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
