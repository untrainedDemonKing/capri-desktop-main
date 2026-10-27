'use strict';

// Her own voice (src/renderer/js/voice-phones.js, voice-synth.js): text to sounds, then sounds to a
// waveform, with no model and no service. The sound itself is measured, not listened to: how high her
// pitch sits, where the formants of each vowel are, where the hiss of "с" and "ш" is, how the moods differ.
//   node --test tests/voice.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

// ---- measuring ----

// pitch: autocorrelation over 40 ms windows, only where there is a clear voice
function pitches(x, sr) {
  const n = Math.round(0.04 * sr);
  const hop = Math.round(0.01 * sr);
  const out = [];
  for (let i = 0; i + n < x.length; i += hop) {
    let mean = 0;
    for (let k = 0; k < n; k++) mean += x[i + k];
    mean /= n;
    let e = 0;
    for (let k = 0; k < n; k++) e += (x[i + k] - mean) ** 2;
    if (Math.sqrt(e / n) < 0.02) continue;
    let best = 0;
    let lag = 0;
    for (let l = Math.floor(sr / 450); l <= Math.floor(sr / 70); l++) {
      let c = 0;
      for (let k = 0; k + l < n; k++) c += (x[i + k] - mean) * (x[i + k + l] - mean);
      if (c > best) { best = c; lag = l; }
    }
    if (lag && best / e > 0.45) out.push(sr / lag);
  }
  return out;
}
const median = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];

// the formants of a steady stretch: peaks of a linear-prediction envelope
function formants(x, sr, order = 14) {
  const n = x.length;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = (x[i] - (i ? 0.97 * x[i - 1] : 0)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const r = new Float64Array(order + 1);
  for (let l = 0; l <= order; l++) for (let i = 0; i + l < n; i++) r[l] += w[i] * w[i + l];
  r[0] *= 1.0001;
  // Levinson-Durbin
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const next = a.slice();
    for (let j = 1; j < i; j++) next[j] = a[j] + k * a[i - j];
    next[i] = k;
    a.set(next);
    err *= 1 - k * k;
  }
  const env = [];
  for (let f = 100; f <= 4500; f += 10) {
    let re = 0;
    let im = 0;
    for (let j = 0; j <= order; j++) {
      re += a[j] * Math.cos((2 * Math.PI * f * j) / sr);
      im -= a[j] * Math.sin((2 * Math.PI * f * j) / sr);
    }
    env.push([f, 1 / Math.hypot(re, im)]);
  }
  const peaks = [];
  for (let i = 1; i < env.length - 1; i++) if (env[i][1] > env[i - 1][1] && env[i][1] > env[i + 1][1]) peaks.push(env[i][0]);
  return peaks;
}

// where the energy sits (spectral centroid) over a stretch
function centroid(x, sr) {
  const n = 1024;
  let num = 0;
  let den = 0;
  for (let start = 0; start + n <= x.length; start += n / 2) {
    for (let k = 1; k < n / 2; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i += 1) {
        const v = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
        re += v * Math.cos((2 * Math.PI * k * i) / n);
        im -= v * Math.sin((2 * Math.PI * k * i) / n);
      }
      const p = re * re + im * im;
      num += p * ((k * sr) / n);
      den += p;
    }
    if (start > 0) break; // two windows are plenty
  }
  return num / (den || 1);
}
const middle = (x, sr, from, len) => x.subarray(Math.floor(x.length * from), Math.floor(x.length * from) + Math.round(len * sr));
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / (x.length || 1));

// ---- the rules: text to sounds ----

const spell = (phrases) => phrases.map((p) => p.words.map((w) => w.phones.map((q) => q.p).join(' ')).join(' | ')).join(' // ');

test('Russian spelling becomes sounds: softness, voicing, endings, prepositions', async () => {
  const { phonemize } = await load('voice-phones.js');
  const ru = (t) => spell(phonemize(t, 'ru'));
  assert.equal(ru('привет'), "p r' i v' e t", 'р and в are soft before и and е, п stays hard before р');
  assert.equal(ru('дуб'), 'd u p', 'a voiced б at the end is said п');
  assert.equal(ru('ложка'), 'l o S k a', 'ж before к is ш');
  assert.equal(ru('сказка'), 's k a s k a', 'з before к is с');
  assert.equal(ru('в доме'), "v d o m' e", 'a preposition and its word are one');
  assert.equal(ru('к друзьям'), "g d r u z' j a m", 'к before a voiced sound is г');
  assert.equal(ru('что'), 'S t o', 'что is said "што"');
  assert.match(ru('учиться'), /ts a$/, '-ться is said "ца"');
  assert.match(ru('жизнь'), /^Z y z.* n'$/, 'и after ж is ы; ь softens');
  assert.equal(ru('чай'), 'tC a j', 'ч is always soft and й is a glide');
  assert.equal(ru('яблоко').split(' ')[0], 'j', 'я at the start is "ja"');
  assert.equal(ru('юбка'), 'j u p k a');
  assert.equal(ru('ёлка'), 'j o l k a', 'ё at the start is "jo"');
  const vanna = phonemize('ванна', 'ru')[0].words[0].phones;
  assert.equal(vanna.filter((q) => q.p === 'n').length, 1, 'a doubled letter is one sound...');
  assert.ok(vanna.find((q) => q.p === 'n').long, '...held longer');
});

test('words that are laughs, numbers and mixed scripts', async () => {
  const { phonemize } = await load('voice-phones.js');
  const laugh = phonemize('Ахаха! Ну ты даёшь', 'ru');
  assert.ok(laugh[0].words[0].laugh >= 2, 'a laugh is a laugh');
  assert.equal(spell(phonemize('12', 'ru')), spell(phonemize('двенадцать', 'ru')), 'twelve is read as the word');
  assert.equal(spell(phonemize('3', 'en')), spell(phonemize('three', 'en')), 'and in English too');
  const mixed = phonemize('Привет, Claude!', 'ru');
  assert.equal(mixed[1].words[0].phones[0].p, 'k', 'a Latin word in Russian text is read as English');
  assert.deepEqual(phonemize('', 'ru'), []);
  assert.deepEqual(phonemize('  ...  ', 'ru'), []);
  assert.equal(phonemize('Привет?', 'ru')[0].end, '?');
});

test('every language gives sounds for its own words', async () => {
  const { phonemize, VOWELS } = await load('voice-phones.js');
  const text = { ru: 'Привет, как дела?', en: 'Hey, Claude needs your permission.', es: '¿Cómo estás? Muy bien, gracias.', pt: 'Olá, tudo bem? Eu sou a Capri.', fr: 'Bonjour, je suis Capri. Ça va ?' };
  for (const [lang, t] of Object.entries(text)) {
    const phrases = phonemize(t, lang);
    const phones = phrases.flatMap((p) => p.words.flatMap((w) => w.phones));
    assert.ok(phones.length >= 8, `${lang}: ${phones.length} sounds`);
    assert.ok(phones.some((p) => VOWELS.has(p.p.replace(/[~']/g, ''))), `${lang}: has vowels`);
    assert.ok(phrases.every((p) => p.words.every((w) => w.laugh || w.phones.some((q) => q.stress) || w.phones.length)), `${lang}: stress or tiny word`);
  }
  const es = spell(phonemize('bien gracias', 'es'));
  assert.match(es, /^b j e n/, 'a weak vowel before a strong one is a glide');
});

// ---- the sound ----

test('she speaks: a plausible, finite, repeatable waveform in a young female range', async () => {
  const { synthesize, SYNTH_RATE } = await load('voice-synth.js');
  const a = synthesize('Привет, я Капри. Ну что, чумба?', { lang: 'ru' });
  assert.equal(a.sampleRate, SYNTH_RATE);
  assert.ok(a.duration > 1.5 && a.duration < 5, `duration ${a.duration}`);
  assert.ok(a.samples.every(Number.isFinite), 'no NaN');
  const peak = a.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.5 && peak <= 1, `peak ${peak}`);
  assert.ok(rms(a.samples) > 0.05, 'not a whisper');
  const f0 = median(pitches(a.samples, a.sampleRate));
  assert.ok(f0 > 190 && f0 < 290, `median pitch ${Math.round(f0)} Hz`);
  const b = synthesize('Привет, я Капри. Ну что, чумба?', { lang: 'ru' });
  assert.deepEqual(Array.from(a.samples.slice(0, 2000)), Array.from(b.samples.slice(0, 2000)), 'the same text sounds the same');
  assert.equal(a.samples.length, b.samples.length);
});

test('her moods sound different: pitch, range and pace', async () => {
  const { synthesize, MOOD_NAMES } = await load('voice-synth.js');
  assert.ok(MOOD_NAMES.includes('angry') && MOOD_NAMES.includes('shy') && MOOD_NAMES.length >= 11);
  const say = (mood) => {
    const r = synthesize('Ну что, чумба, опять взламываешь лёд? Я бы на твоём месте не стала.', { lang: 'ru', mood });
    const p = pitches(r.samples, r.sampleRate);
    return { f0: median(p), dur: r.duration, spread: [...p].sort((x, y) => x - y)[Math.floor(p.length * 0.9)] - [...p].sort((x, y) => x - y)[Math.floor(p.length * 0.1)] };
  };
  const calm = say('calm');
  const happy = say('happy');
  const sad = say('sad');
  const angry = say('angry');
  const shy = say('shy');
  assert.ok(sad.f0 < calm.f0 && calm.f0 < happy.f0, `pitch sad ${sad.f0 | 0} < calm ${calm.f0 | 0} < happy ${happy.f0 | 0}`);
  assert.ok(shy.f0 > calm.f0, 'shy is higher than calm');
  assert.ok(angry.f0 < calm.f0, 'angry is lower');
  assert.ok(happy.spread > sad.spread, 'a happy tune moves more than a sad one');
  assert.ok(sad.dur > calm.dur && calm.dur > happy.dur, `pace sad ${sad.dur.toFixed(1)} > calm ${calm.dur.toFixed(1)} > happy ${happy.dur.toFixed(1)}`);
  assert.ok(happy.f0 < 330 && sad.f0 > 150, 'nobody squeaks or growls');
});

test('rate and pitch controls do what they say', async () => {
  const { synthesize } = await load('voice-synth.js');
  const slow = synthesize('Всё хорошо, не переживай.', { lang: 'ru', rate: 0.8 });
  const fast = synthesize('Всё хорошо, не переживай.', { lang: 'ru', rate: 1.6 });
  assert.ok(slow.duration > fast.duration * 1.6, `${slow.duration.toFixed(2)} vs ${fast.duration.toFixed(2)}`);
  const low = median(pitches(synthesize('Ааа', { lang: 'ru', pitch: 0.8 }).samples, 22050));
  const high = median(pitches(synthesize('Ааа', { lang: 'ru', pitch: 1.25 }).samples, 22050));
  assert.ok(high > low * 1.35, `${Math.round(low)} -> ${Math.round(high)} Hz`);
});

test('vowels are where their formants should be (so "и" and "у" and "а" are told apart)', async () => {
  const { synthesize } = await load('voice-synth.js');
  // a high voice has widely spaced harmonics, so a low LPC order lumps F1 and F2 of an open vowel together:
  // order 16 over 100 ms separates them
  const f = (ch) => {
    const r = synthesize(ch + ch + ch, { lang: 'ru', mood: 'calm' });
    return formants(middle(r.samples, r.sampleRate, 0.4, 0.1), r.sampleRate, 16);
  };
  const within = (hz, lo, hi) => hz >= lo && hz <= hi;
  const a = f('а');
  const i = f('и');
  const u = f('у');
  assert.ok(a.some((p) => within(p, 650, 950)) && a.some((p) => within(p, 1150, 1700)), `а: ${a.slice(0, 4)}`); // targets F1 ~810, F2 ~1450
  assert.ok(i.some((p) => within(p, 250, 500)) && i.some((p) => within(p, 2200, 2900)), `и: ${i.slice(0, 4)}`); // ~340 and ~2600
  assert.ok(u.some((p) => within(p, 300, 500)) && !u.some((p) => within(p, 1800, 2500)), `у: ${u.slice(0, 4)}`);
  assert.ok(a[0] > i[0] + 250, `а opens wider than и: F1 ${a[0]} vs ${i[0]}`);
  assert.ok(i.find((p) => p > 1800) > a.find((p) => p > 1000) + 700, 'и has its F2 far above а');
});

test('hissing sounds hiss where they should: "с" high, "ш" lower, and louder than silence but not than a vowel', async () => {
  const { synthesize } = await load('voice-synth.js');
  const say = (t) => synthesize(t, { lang: 'ru' });
  const s = say('с');
  const sh = say('ш');
  const a = say('а');
  const cs = centroid(middle(s.samples, s.sampleRate, 0.3, 0.05), s.sampleRate);
  const csh = centroid(middle(sh.samples, sh.sampleRate, 0.3, 0.05), sh.sampleRate);
  assert.ok(cs > 5200, `с centroid ${Math.round(cs)} Hz`);
  assert.ok(csh > 2000 && csh < 4800, `ш centroid ${Math.round(csh)} Hz`);
  assert.ok(cs > csh + 1200, 'с is higher than ш');
  assert.ok(rms(s.samples) > 0.02, 'audible');
  assert.ok(rms(a.samples) > rms(s.samples) * 1.2, 'a vowel is louder than its hiss');
});

test('every language, every mood: finite sound, and a text with no sounds is silence, not a crash', async () => {
  const { synthesize, MOOD_NAMES } = await load('voice-synth.js');
  const lines = { ru: 'Ну привет, чумба.', en: 'Hey, Claude needs your permission.', es: 'Muy bien, gracias.', pt: 'Olá, tudo bem?', fr: 'Bonjour, je suis Capri.' };
  for (const [lang, text] of Object.entries(lines)) {
    const r = synthesize(text, { lang });
    assert.ok(r.duration > 0.8 && r.samples.every(Number.isFinite), lang);
  }
  for (const mood of MOOD_NAMES) {
    const r = synthesize('Хм, ладно. Давай попробуем ещё раз!', { lang: 'ru', mood });
    assert.ok(r.duration > 1 && r.samples.every(Number.isFinite), mood);
    assert.ok(r.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) <= 1, `${mood} stays in range`);
  }
  for (const nothing of ['', '   ', '...', '😀', '— — —']) assert.equal(synthesize(nothing, { lang: 'ru' }).samples.length, 0, JSON.stringify(nothing));
  assert.equal(synthesize('Ахаха!', { lang: 'ru', mood: 'laugh' }).samples.every(Number.isFinite), true, 'a laugh');
  const weird = synthesize('Тест №5: 100% готово & проверено (почти)!', { lang: 'ru' });
  assert.ok(weird.duration > 2 && weird.samples.every(Number.isFinite));
});

test('it is cheap: a long answer is made in well under its own length, and a WAV can be written', async () => {
  const { synthesize, toWav } = await load('voice-synth.js');
  const text = 'Ну что, чумба, опять взламываешь лёд? Я бы на твоём месте не стала. Хотя… ладно, давай! '.repeat(6).slice(0, 600);
  const t0 = performance.now();
  const r = synthesize(text, { lang: 'ru', mood: 'smug' });
  const ms = performance.now() - t0;
  assert.ok(r.duration > 20, `${r.duration.toFixed(1)} s of speech`);
  assert.ok(ms < r.duration * 1000 * 0.3, `made in ${Math.round(ms)} ms`);
  const wav = toWav(r.samples.subarray(0, 4410), r.sampleRate);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(wav.length, 44 + 4410 * 2);
});

test('her voice engine in the speech chain: made here, played at the pace it was made at, falls back when it cannot', async () => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  const { Speech } = await load('speech.js');
  const played = [];
  const ctx = {
    state: 'running',
    createBuffer: (ch, len, rate) => ({ ch, len, rate, copyToChannel(data) { this.data = data; } }),
  };
  const voice = { wakeUp: () => ctx, speaking: false, master: {} };
  const speech = new Speech({ voice, host: { ttsSpeak: async () => { throw new Error('a service must not be asked'); } } });
  speech.configure({ voiceMode: 'all', ttsEngine: 'capri', lang: 'ru', ttsRate: 1.2 });
  speech.play = async (c, buffer, mood, token, opts) => { played.push({ buffer, mood, opts }); };
  const token = {};
  speech.current = token;
  assert.equal(await speech.own('Привет, чумба.', 'happy', token), true);
  assert.equal(played.length, 1);
  assert.equal(played[0].buffer.rate, 22050);
  assert.ok(played[0].buffer.len > 22050 * 0.6, 'a second or so of speech');
  assert.equal(played[0].opts.rate, 1, 'the pace is in the sound already, not in playback');
  assert.equal(played[0].mood, 'happy');
  // nothing to say in it (only a symbol): false, so the system voice takes over
  assert.equal(await speech.own('…', 'calm', token), false);
  // cut off while it was being made: true, nothing played
  speech.current = null;
  assert.equal(await speech.own('Привет', 'calm', token), true);
  assert.equal(played.length, 1);
});
