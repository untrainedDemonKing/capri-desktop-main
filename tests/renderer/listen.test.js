'use strict';

// How she listens (src/renderer/js/senses/listen.js, ears.js) and what she asks a recogniser (src/main/voice/stt.js): your turn told from the
// noise, the first word kept, a turn sent as 16 kHz speech, and what the recogniser says tidied.
//   node --test tests/renderer/listen.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { rendererFile } = require('../helpers/source');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (name) => import(pathToFileURL(rendererFile(name)).href);
const stt = require('../../src/main/voice/stt.js');

// frames of 40 ms: [level, how many]
function walk(detector, plan, { deaf = () => false, from = 1000 } = {}) {
  const events = [];
  let now = from;
  for (const [level, count] of plan) {
    for (let i = 0; i < count; i++) {
      now += 40;
      const e = detector.push(level, now, { deaf: deaf(now) });
      if (e) events.push({ e, at: now });
    }
  }
  return events;
}

test('your turn starts when a voice lasts, ends after a quiet, and a sentence with pauses in it is one turn', async () => {
  const { TurnDetector } = await load('listen.js');
  const d = new TurnDetector({ base: 0.012 });
  const events = walk(d, [[0.002, 30], [0.06, 20], [0.003, 12], [0.07, 25], [0.002, 40]]); // 0.5 s pause is not the end
  assert.deepEqual(events.map((x) => x.e), ['start', 'end']);
  assert.ok(events[0].at <= 1000 + 40 * (30 + 4), 'it starts within a few frames of the voice');
  assert.ok(events[1].at >= 1000 + 40 * (30 + 20 + 12 + 25 + 24), 'and ends only after a second of quiet');
});

test('a click or a cough is not a turn: too short to start, or dropped when nothing came of it', async () => {
  const { TurnDetector } = await load('listen.js');
  const click = new TurnDetector({ base: 0.012 });
  assert.deepEqual(walk(click, [[0.002, 30], [0.2, 2], [0.002, 60]]), [], 'two frames: not even a start');
  const cough = new TurnDetector({ base: 0.012 });
  assert.deepEqual(walk(cough, [[0.002, 30], [0.1, 5], [0.002, 60]]).map((x) => x.e), ['start', 'drop'], 'a start (it could be a word), then dropped when it was not one');
  const word = new TurnDetector({ base: 0.012 });
  assert.deepEqual(walk(word, [[0.002, 30], [0.08, 8], [0.002, 60]]).map((x) => x.e), ['start', 'end'], 'a short word ("да") is a turn');
});

test('a voice flickering around the line does not cut the word in pieces (it goes on until it falls well below)', async () => {
  const { TurnDetector } = await load('listen.js');
  const d = new TurnDetector({ base: 0.012 });
  const flicker = [];
  for (let i = 0; i < 40; i++) flicker.push([i % 2 ? 0.011 : 0.03, 1]); // above the line, a little below it, above...
  assert.deepEqual(walk(d, [[0.002, 30], ...flicker, [0.002, 40]]).map((x) => x.e), ['start', 'end']);
});

test('a loud room is learned: a steady hum above the line is not a voice, and speech over it is', async () => {
  const { TurnDetector } = await load('listen.js');
  const d = new TurnDetector({ base: 0.012 });
  // the mic is opened in a room with a hum at 0.02 (above the old fixed line): after the first second it is the quiet
  const events = walk(d, [[0.02, 50], [0.02, 100]]);
  assert.deepEqual(events, [], 'the hum is no turn, not even in the first second (the room is being learned)');
  assert.ok(d.threshold > 0.04, `the line is above the hum: ${d.threshold}`);
  const after = walk(d, [[0.02, 25], [0.1, 20], [0.02, 40]], { from: 20000 });
  assert.deepEqual(after.map((x) => x.e), ['start', 'end'], 'a voice over the hum is a turn, and the hum alone is not');
  // a quiet room stays at the menu's line (never below it)
  const quiet = new TurnDetector({ base: 0.012 });
  walk(quiet, [[0.002, 100]]);
  assert.equal(quiet.threshold, 0.012);
  // a mic opened while someone is speaking is not taught that speech is the quiet
  const talking = new TurnDetector({ base: 0.012 });
  const mixed = [];
  for (let i = 0; i < 25; i++) mixed.push([i % 4 === 0 ? 0.004 : 0.08, 1]);
  walk(talking, mixed);
  assert.ok(talking.threshold < 0.03, `speech over a quiet room: the line stays low (${talking.threshold})`);
});

test('a long sentence does not raise the line over itself', async () => {
  const { TurnDetector } = await load('listen.js');
  const d = new TurnDetector({ base: 0.012 });
  const events = walk(d, [[0.003, 40], [0.06, 400], [0.003, 40]]); // sixteen seconds of voice
  assert.deepEqual(events.map((x) => x.e), ['start', 'end']);
  assert.ok(events[1].at - events[0].at > 16000, 'one turn, not cut in the middle');
});

test('a turn is never longer than twenty seconds, and she does not listen while she talks', async () => {
  const { TurnDetector } = await load('listen.js');
  const d = new TurnDetector({ base: 0.012 });
  const events = walk(d, [[0.003, 30], [0.06, 600]]); // twenty-four seconds of voice: the first twenty are one turn
  assert.deepEqual(events.map((x) => x.e).slice(0, 2), ['start', 'end']);
  assert.ok(events[1].at - events[0].at <= 20100);
  const deaf = new TurnDetector({ base: 0.012 });
  assert.deepEqual(walk(deaf, [[0.003, 30], [0.08, 40], [0.003, 30]], { deaf: () => true }), [], 'her own voice is no turn');
});

test('pressed to talk: a moment to start is allowed, and nothing said is dropped after five seconds', async () => {
  const { TurnDetector } = await load('listen.js');
  const slow = new TurnDetector({ base: 0.012 });
  slow.begin(1000, { single: true });
  assert.deepEqual(walk(slow, [[0.002, 40], [0.07, 15], [0.002, 40]]).map((x) => x.e), ['end'], 'a second of quiet first, then speech');
  const nothing = new TurnDetector({ base: 0.012 });
  nothing.begin(1000, { single: true });
  const events = walk(nothing, [[0.002, 200]]);
  assert.deepEqual(events.map((x) => x.e), ['drop']);
  assert.ok(events[0].at >= 1000 + 5000);
});

test('what is sent: 16 kHz, a WAV header that says so, the tail cut, and faint speech lifted', async () => {
  const { turnAudio, encodeWav, resample, lift } = await load('listen.js');
  const rate = 48000;
  const chunk = (seconds, level) => new Float32Array(Math.round(seconds * rate)).fill(level);
  const { wav, seconds } = turnAudio([chunk(0.6, 0.001), chunk(1, 0.05), chunk(1, 0.001)], rate, 0.6 + 1 + 0.45);
  assert.ok(Math.abs(seconds - 2.05) < 0.01, `the long quiet after the last word is cut: ${seconds}`);
  const view = new DataView(wav);
  const text = (at) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at + i)));
  assert.equal(text(0), 'RIFF');
  assert.equal(text(8), 'WAVE');
  assert.equal(view.getUint32(24, true), 16000, 'the rate in the header');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(40, true), wav.byteLength - 44, 'the length of the data');
  // faint speech (peak 0.05) is made louder, loud speech is left alone
  const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak(lift(new Float32Array([0.05, -0.05, 0.02]))) > 0.25);
  assert.equal(peak(lift(new Float32Array([0.5, -0.4]))), 0.5);
  assert.ok(Math.abs(peak(lift(new Float32Array([0.0005, 0]))) - 0.0005) < 1e-7, 'silence is not made into noise');
  // 48 kHz to 16 kHz keeps a tone's level (the mean of three samples)
  assert.ok(Math.abs(peak(resample(new Float32Array(480).fill(0.4), 48000)) - 0.4) < 1e-6);
  assert.equal(resample(new Float32Array(480), 48000).length, 160);
  assert.equal(resample(new Float32Array(100), 16000).length, 100, '16 kHz stays');
  assert.equal(encodeWav(new Float32Array([1, -1, 0, 2]), 16000).byteLength, 44 + 8, 'beyond full scale is cut, not wrapped');
});

// ---- the whole of it in Ears, with a stand-in microphone ----

function stage() {
  const sent = [];
  const states = [];
  let rmsNow = 0.002;
  let workletOnMessage = null;
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }), enumerateDevices: async () => [] } },
  });
  globalThis.AudioWorkletNode = class {
    constructor() { this.port = {}; workletOnMessage = this.port; }
    connect() {}
    disconnect() {}
  };
  globalThis.AudioContext = class {
    constructor(opts) { this.sampleRate = opts?.sampleRate || 48000; this.audioWorklet = { addModule: async () => {} }; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    createAnalyser() {
      return {
        fftSize: 0,
        // a square wave of the level asked for: its RMS is that level
        getByteTimeDomainData(data) { for (let i = 0; i < data.length; i++) data[i] = Math.round(128 + (i % 2 ? 1 : -1) * rmsNow * 128); },
      };
    }
    close() { return Promise.resolve(); }
  };
  return {
    sent,
    states,
    level: (v) => { rmsNow = v; },
    hear: (samples) => workletOnMessage.onmessage({ data: samples }),
    restore() {
      if (real) Object.defineProperty(globalThis, 'navigator', real);
      else delete globalThis.navigator;
      delete globalThis.AudioContext;
      delete globalThis.AudioWorkletNode;
    },
  };
}

test('in conversation mode what was said just before the voice was sure is kept, and a turn goes as one WAV', async (t) => {
  const { Ears } = await load('ears.js');
  const s = stage();
  t.after(() => s.restore());
  const transcripts = [];
  const ears = new Ears({
    host: { transcribe: async (req) => { s.sent.push(req); return { ok: true, text: 'Привет, Капри.' }; } },
    capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'ru' }, speech: {},
  });
  ears.onTranscript = (text) => transcripts.push(text);
  ears.onState = (st) => s.states.push(st);
  ears.configure({ ears: true, converse: true, lang: 'ru', langSetting: 'auto', micSensitivity: 0.4 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ears.lang, '', 'auto: no language is told');
  assert.equal(ears.hint, 'ru');
  assert.ok(ears.capture, 'the samples of the mic are tapped');
  const tenth = (v) => new Float32Array(1600).fill(v); // a tenth of a second at 16 kHz
  const hear = (level, tenths) => { for (let i = 0; i < tenths; i++) s.hear(tenth(level)); };
  hear(0.002, 15);  // a second and a half of quiet room
  hear(0.08, 12);   // 1.2 s of your voice
  assert.equal(ears.recording, true, 'the turn started');
  hear(0.002, 14);  // and the quiet after
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.sent.length, 1, 'one turn sent');
  const req = s.sent[0];
  assert.equal(req.mime, 'audio/wav');
  assert.equal(req.hint, 'ru');
  const view = new DataView(req.audio);
  assert.equal(view.getUint32(24, true), 16000);
  const n = (req.audio.byteLength - 44) / 2;
  const at = (i) => view.getInt16(44 + i * 2, true) / 0x7fff;
  const loud = [];
  for (let i = 0; i < n; i++) if (Math.abs(at(i)) > 0.05) loud.push(i);
  // all of the 1.2 s is there, from its first sample (the voice was sure only 0.12 s in: what came before it was kept)
  assert.ok(loud.length >= 16000 * 1.19 && loud.length <= 16000 * 1.21, `the whole of what was said: ${(loud.length / 16000).toFixed(2)} s`);
  assert.ok(loud[0] / 16000 > 0.3 && loud[0] / 16000 < 0.9, `with the quiet before it kept (${(loud[0] / 16000).toFixed(2)} s)`);
  assert.ok(n / 16000 < loud[0] / 16000 + 1.2 + 0.7, `the long quiet at the end was cut (${(n / 16000).toFixed(2)} s)`);
  assert.deepEqual(transcripts, ['Привет, Капри.']);
  ears.configure({ ears: false });
});

test('a slow moment of the PC does not cost the first word: the turn is told from the samples, in order, not from when the timer ran', async (t) => {
  const { Ears } = await load('ears.js');
  const s = stage();
  t.after(() => s.restore());
  const ears = new Ears({ host: { transcribe: async (req) => { s.sent.push(req); return { ok: true, text: 'ok then' }; } }, capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'en' }, speech: {} });
  ears.configure({ ears: true, converse: true, lang: 'en', langSetting: 'en' });
  await new Promise((r) => setTimeout(r, 20));
  const tenth = (v) => new Float32Array(1600).fill(v);
  for (let i = 0; i < 15; i++) s.hear(tenth(0.002));
  // the window was busy for two seconds: nothing was looked at, and then everything came at once (the analyser is not asked at all here)
  for (let i = 0; i < 20; i++) s.hear(tenth(0.08));
  for (let i = 0; i < 14; i++) s.hear(tenth(0.002));
  await new Promise((r) => setTimeout(r, 30));
  const view = new DataView(s.sent[0].audio);
  const n = (s.sent[0].audio.byteLength - 44) / 2;
  let loud = 0;
  for (let i = 0; i < n; i++) if (Math.abs(view.getInt16(44 + i * 2, true) / 0x7fff) > 0.05) loud += 1;
  assert.ok(loud >= 16000 * 1.99, `two seconds of voice, none lost: ${(loud / 16000).toFixed(2)} s`);
  ears.configure({ ears: false });
});

test('a noise in conversation mode sends nothing, and she does not hear herself', async (t) => {
  const { Ears } = await load('ears.js');
  const s = stage();
  t.after(() => s.restore());
  const ears = new Ears({ host: { transcribe: async (req) => { s.sent.push(req); return { ok: true, text: 'x' }; } }, capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'ru' }, speech: {} });
  ears.configure({ ears: true, converse: true, lang: 'ru', langSetting: 'ru' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ears.lang, 'ru', 'the language you picked is told');
  const tenth = (v) => new Float32Array(1600).fill(v);
  const hear = (level, tenths) => { for (let i = 0; i < tenths; i++) s.hear(tenth(level)); };
  hear(0.002, 15);
  hear(0.1, 2); // a cough
  hear(0.002, 15);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.sent.length, 0, 'a cough is not sent');
  assert.equal(ears.recording, false);
  ears.heardSelf(true); // she talks
  hear(0.08, 15);
  ears.heardSelf(false);
  hear(0.002, 15);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.sent.length, 0, 'her own voice is not a turn');
  assert.equal(ears.recording, false);
  ears.configure({ ears: false });
});

test('where the samples of the mic cannot be had, the level of the analyser tells the turns, as before', async (t) => {
  const { Ears } = await load('ears.js');
  const s = stage();
  t.after(() => s.restore());
  globalThis.AudioContext = class {
    constructor() { this.sampleRate = 48000; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData(data) { for (let i = 0; i < data.length; i++) data[i] = Math.round(128 + (i % 2 ? 1 : -1) * 0.002 * 128); } }; }
    close() { return Promise.resolve(); }
  };
  delete globalThis.AudioWorkletNode;
  const ears = new Ears({ host: { transcribe: async () => ({ ok: true, text: 'x' }) }, capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'en' }, speech: {} });
  ears.configure({ ears: true, converse: true, lang: 'en', langSetting: 'en' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ears.capture, null, 'no samples');
  ears.vad(); // (it does not fail: the meter works)
  assert.ok(ears.level >= 0);
  ears.configure({ ears: false });
});

// ---- what is asked of the recogniser ----

function server(replies) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const form = init.body;
    calls.push({ url, language: form.get('language'), prompt: form.get('prompt'), format: form.get('response_format'), name: form.get('file').name, auth: init.headers.authorization });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (typeof reply === 'function') return reply(calls.length);
    if ('ok' in reply) return reply; // (a whole response)
    return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  return { calls, fetchFn };
}
const cfg = { sttEngine: 'groq' };
const keys = { groq: 'k' };
const audio = Buffer.from('RIFFxxxx');

test('the recogniser is asked for what she expects to hear (her name, the apps), in the language told, as a WAV', async () => {
  const s = server([{ text: 'Открой Спотифай', language: 'russian', segments: [{ text: 'Открой Спотифай', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 }] }]);
  const text = await stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: s.fetchFn });
  assert.equal(text, 'Открой Спотифай');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].language, 'ru');
  assert.match(s.calls[0].prompt, /Капри/);
  assert.equal(s.calls[0].format, 'verbose_json');
  assert.equal(s.calls[0].name, 'speech.wav');
  assert.equal(s.calls[0].auth, 'Bearer k');
});

test('with "auto": nothing is told; a language she does not speak is asked again in the one of her menus', async () => {
  const s = server([{ text: 'Відкрий Спотіфай', language: 'ukrainian', segments: [] }, { text: 'Открой Спотифай', language: 'russian', segments: [] }]);
  const text = await stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: '', hint: 'ru' }, { fetch: s.fetchFn });
  assert.equal(text, 'Открой Спотифай');
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].language, null, 'the first time none is told');
  assert.match(s.calls[0].prompt, /Capri/, 'and both languages are in what she expects');
  assert.match(s.calls[0].prompt, /Капри/);
  assert.equal(s.calls[1].language, 'ru', 'the second time the one of her menus');
  // English heard: no second go
  const en = server([{ text: 'Open Spotify', language: 'english', segments: [] }]);
  assert.equal(await stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: '', hint: 'ru' }, { fetch: en.fetchFn }), 'Open Spotify');
  assert.equal(en.calls.length, 1);
});

test('what the recogniser made up for a noise is dropped: pieces it was sure were not speech, and repeating ones', async () => {
  const s = server([{
    text: 'Привет. Продолжение следует... Субтитры сделал DimaTorzok',
    language: 'russian',
    segments: [
      { text: 'Привет.', avg_logprob: -0.15, no_speech_prob: 0.02, compression_ratio: 1.1 },
      { text: 'Продолжение следует...', avg_logprob: -1.4, no_speech_prob: 0.8, compression_ratio: 1 },
      { text: 'да да да да да да да да да да', avg_logprob: -0.3, no_speech_prob: 0.1, compression_ratio: 3.1 },
    ],
  }]);
  assert.equal(await stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: s.fetchFn }), 'Привет.');
  assert.equal(stt.spoken({ text: ' plain ' }), 'plain', 'an answer without pieces is its text');
});

test('a hiccup is tried once more; a refused key and a missing key are not; a server that knows only plain answers gets them', async () => {
  const flaky = server([(n) => (n === 1 ? { ok: false, status: 503, text: async () => 'busy' } : { ok: true, status: 200, json: async () => ({ text: 'ok then' }) })]);
  const realTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => realTimeout(fn, Math.min(ms, 5), ...a);
  try {
    assert.equal(await stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: flaky.fetchFn }), 'ok then');
    assert.equal(flaky.calls.length, 2);
    const refused = server([{ ok: false, status: 401, text: async () => '{"error":{"message":"bad key"}}' }]);
    await assert.rejects(stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: refused.fetchFn }), (e) => e.code === 'badkey');
    assert.equal(refused.calls.length, 1, 'not tried again');
    // (a cloud service with no key saved is not asked at all: the recogniser on this PC answers, or tells it is not there yet)
    await assert.rejects(stt.transcribe(cfg, {}, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: refused.fetchFn }), (e) => e.code === 'nolocal');
    assert.equal(refused.calls.length, 1, 'and the cloud was not asked');
    const plain = server([(n) => (n === 1 ? { ok: false, status: 400, text: async () => 'unknown response_format' } : { ok: true, status: 200, json: async () => ({ text: 'plain answer' }) })]);
    assert.equal(await stt.transcribe({ sttEngine: 'custom', sttUrl: 'http://127.0.0.1:1/v1' }, {}, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: plain.fetchFn }), 'plain answer');
    assert.equal(plain.calls[1].format, 'json');
    assert.equal(plain.calls[1].prompt, null, 'and without what it may not know');
  } finally {
    global.setTimeout = realTimeout;
  }
});

test('an answer that is not JSON is asked for again in the plain form, and if it is still none, it is said so (not taken for "you said nothing")', async () => {
  const notJson = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } };
  const recovers = server([notJson, { ok: true, status: 200, json: async () => ({ text: 'plain words' }) }]);
  assert.equal(await stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: recovers.fetchFn }), 'plain words');
  assert.equal(recovers.calls[1].format, 'json');
  const hopeless = server([notJson]);
  await assert.rejects(stt.transcribe(cfg, keys, { audio, mime: 'audio/wav', lang: 'ru' }, { fetch: hopeless.fetchFn }), (e) => e.code === 'badanswer');
});

test('no recogniser on this PC: she says she sets it up and asks for it once; while it is fetched the line comes once a minute; other failures are told as they are', async () => {
  const { Ears } = await load('ears.js');
  const said = [];
  let installs = 0;
  const ears = Object.create(Ears.prototype);
  Object.assign(ears, { panel: { say: (m) => said.push(m) }, host: { sttInstall: async () => { installs++; return { ok: true }; } }, brain: { lang: 'ru' } });
  ears.trouble({ ok: false, code: 'nolocal', installing: false });
  assert.equal(installs, 1, 'it is fetched');
  assert.match(said[0].line, /Ставлю, это один раз/);
  ears.trouble({ ok: false, code: 'nolocal', installing: false });
  assert.equal(installs, 1, 'and asked for once, not at every phrase');
  ears.trouble({ ok: false, code: 'nolocal', installing: true });
  ears.trouble({ ok: false, code: 'nolocal', installing: true });
  ears.trouble({ ok: false, code: 'nolocal', installing: true });
  assert.deepEqual(said.map((m) => /ещё ставится/.test(m.line)), [false, false, true], 'while it is being fetched: one line, not one for each thing you say');
  said.length = 0;
  ears.trouble({ ok: false, code: 'exited', error: 'the program stopped (code 1)' });
  assert.match(said[0].line, /не запустилось/);
  assert.equal(said[0].quote, 'the program stopped (code 1)');
  ears.trouble({ ok: false, code: 'nokey' });
  assert.match(said[1].line, /нужен ключ/);
  ears.trouble({ ok: false, error: 'fetch failed' });
  assert.match(said[2].line, /Не разобрала/);
});

test('the words a recogniser says for a noise are not sent on as yours, and yours are', async () => {
  const { clean } = await load('ears.js');
  for (const marker of ['[BLANK_AUDIO]', '[Music]', '(музыка)', '*кашель*', '[ Silence ]', '[Аплодисменты] [Музыка]']) assert.equal(clean(marker), '', marker);
  for (const mine of ['(смеётся) привет', 'Открой [Chrome]']) assert.equal(clean(mine), mine, mine);
  for (const junk of ['Продолжение следует...', 'Субтитры сделал DimaTorzok', 'Спасибо за просмотр!', 'Thanks for watching!', '...', '', 'you', 'Подписывайтесь на канал']) assert.equal(clean(junk), '', junk);
  for (const mine of ['Открой YouTube', 'ок', 'okay', 'да', 'Thank you, Capri']) assert.equal(clean(mine), mine, mine);
});
