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
  assert.equal(ru('привет'), "p r' I v' e t", 'р and в are soft before и and е, п stays hard before р, и before the stress is short');
  assert.equal(ru('дуб'), 'd u p', 'a voiced б at the end is said п');
  assert.equal(ru('ложка'), 'l o S k @', 'ж before к is ш');
  assert.equal(ru('сказка'), 's k a s k @', 'з before к is с');
  assert.equal(ru('в доме'), "v d o m' @", 'a preposition and its word are one');
  assert.equal(ru('к друзьям'), "g d r u z' j a m", 'к before a voiced sound is г');
  assert.equal(ru('что'), 'S t o', 'что is said "што"');
  assert.match(ru('учиться'), /ts @$/, '-ться is said "ца"');
  assert.match(ru('жизнь'), /^Z y z.* n'$/, 'и after ж is ы; ь softens');
  assert.equal(ru('чай'), 'tC a j', 'ч is always soft and й is a glide');
  assert.equal(ru('яблоко').split(' ')[0], 'j', 'я at the start is "ja"');
  assert.equal(ru('юбка'), 'j u p k @');
  assert.equal(ru('ёлка'), 'j o l k @', 'ё at the start is "jo"');
  const vanna = phonemize('ванна', 'ru')[0].words[0].phones;
  assert.equal(vanna.filter((q) => q.p === 'n').length, 1, 'a doubled letter is one sound...');
  assert.ok(vanna.find((q) => q.p === 'n').long, '...held longer');
});

test('Russian is said the way it is said: stress from a list and from endings, vowels reduced, dots on ё put back', async () => {
  const { phonemize, VOWELS } = await load('voice-phones.js');
  const word = (t) => phonemize(t, 'ru')[0].words[0].phones;
  const stressed = (t) => {
    let i = -1;
    let at = -1;
    for (const q of word(t)) if (VOWELS.has(q.p.replace(/[~']/g, ''))) { i++; if (q.stress) at = i; }
    return at;
  };
  const ru = (t) => word(t).map((q) => q.p).join(' ');
  // the words she says most: stress right (the way a person says them, not the way they are spelled)
  const known = { тебе: 1, меня: 1, дела: 1, привет: 1, сейчас: 1, хорошо: 2, говорить: 2, спасибо: 1, пожалуйста: 1, ничего: 2, человек: 2, глаза: 1, потому: 2, всегда: 1, который: 1, голос: 0, сервер: 0, микрофон: 2 };
  for (const [t, at] of Object.entries(known)) assert.equal(stressed(t), at, `${t}: stress on vowel ${at}`);
  // a word nobody told her about: by its ending, never nowhere and never off the word
  for (const t of ['программирование', 'перезагрузка', 'нейросеть', 'подключаться']) {
    const at = stressed(t);
    assert.ok(at >= 0 && at < word(t).filter((q) => VOWELS.has(q.p.replace(/[~']/g, ''))).length, `${t}: stress ${at}`);
  }
  // the vowels before and after the stress are not said as spelled
  assert.equal(ru('молоко'), 'm V l V k o', 'о before the stress is a short а');
  assert.equal(ru('хорошо'), 'x V r V S o');
  assert.equal(ru('человек'), "tC I l V v' e k", 'е before the stress is и');
  assert.equal(ru('на столе'), "n @ s t o l' @", 'a preposition is a mere "ъ", the end of the word too');
  assert.equal(ru('жена'), 'Z y n a', 'е after ж is ы');
  assert.ok(word('работа').some((q) => q.short), 'the vowels far from the stress are short');
  assert.ok(word('очень').every((q) => !q.stress || VOWELS.has(q.p)), 'the stress sits on a vowel');
  // ё typed as е
  assert.equal(ru('идет'), "I d' o t", 'идёт');
  assert.equal(ru('еще'), 'j I C o', 'ещё');
  assert.equal(stressed('нашел'), 1, 'нашёл');
  // a one-vowel little word has no stress, but a one-vowel word that means something has
  assert.equal(stressed('не'), -1);
  assert.equal(stressed('дом'), 0);
  assert.equal(stressed('что'), -1);
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
  assert.ok(peak > 0.3 && peak < 0.85, `peak ${peak}: loud enough, and far from clipping`);
  const level = rms(a.samples);
  assert.ok(level > 0.06 && level < 0.16, `speech-like level ${level.toFixed(3)} (RMS)`);
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

test('hissing sounds hiss where they should: "с" high, "ш" lower, quieter than the vowels around them', async () => {
  const { synthesize } = await load('voice-synth.js');
  const say = (t) => synthesize(t, { lang: 'ru' });
  const s = say('с');
  const sh = say('ш');
  const cs = centroid(middle(s.samples, s.sampleRate, 0.3, 0.05), s.sampleRate);
  const csh = centroid(middle(sh.samples, sh.sampleRate, 0.3, 0.05), sh.sampleRate);
  assert.ok(cs > 5200, `с centroid ${Math.round(cs)} Hz`);
  assert.ok(csh > 2000 && csh < 4800, `ш centroid ${Math.round(csh)} Hz`);
  assert.ok(cs > csh + 1200, 'с is higher than ш');
  // in a word: the hiss is heard (not lost) but sits well below the vowels, 10 to 22 dB
  const word = say('асаса');
  const sr = word.sampleRate;
  const win = Math.round(0.02 * sr);
  let loudest = 0;
  let hissiest = 0;
  for (let i = 0; i + win <= word.samples.length; i += win) {
    const w = word.samples.subarray(i, i + win);
    const level = rms(w);
    // share of the energy above ~3 kHz: a hiss has most of it there, a vowel a tenth
    let lo = 0;
    let hi = 0;
    let a = 0;
    let b = 0;
    for (let k = 0; k < w.length; k++) { a += (w[k] - a) * 0.55; b += (a - b) * 0.55; hi += (w[k] - b) ** 2; lo += w[k] ** 2; }
    const share = hi / (lo || 1);
    if (share < 0.2) loudest = Math.max(loudest, level);
    if (share > 0.5) hissiest = Math.max(hissiest, level);
  }
  assert.ok(hissiest > 0, 'a hiss is there');
  const gap = 20 * Math.log10(loudest / hissiest);
  assert.ok(gap > 10 && gap < 22, `the vowels are ${gap.toFixed(1)} dB above the hiss`);
});

test('her voice is soft, not harsh: no clipping, hiss comes in gradually, she takes a breath between sentences', async () => {
  const { synthesize, MOOD_NAMES } = await load('voice-synth.js');
  const env = (x, ms) => {
    const k = Math.round((ms / 1000) * 22050);
    const out = [];
    for (let i = 0; i + k <= x.length; i += k) out.push(rms(x.subarray(i, i + k)));
    return out;
  };
  // no mood goes near the top: a soft knee, and nearly nothing above 0.6
  for (const mood of MOOD_NAMES) {
    const r = synthesize('Ну что, чумба, опять взламываешь лёд? Я бы на твоём месте не стала!', { lang: 'ru', mood });
    const loud = r.samples.filter((v) => Math.abs(v) > 0.6).length / r.samples.length;
    assert.ok(loud < 0.01, `${mood}: ${(loud * 100).toFixed(2)}% of the samples above 0.6`);
    assert.ok(r.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) < 0.9, `${mood} peaks below 0.9`);
  }
  // a hiss starts over 20 ms or more (it used to start in 8), a vowel takes its time too
  for (const word of ['сссс', 'шшшш', 'ааа']) {
    const e = env(synthesize(word, { lang: 'ru' }).samples, 2);
    const top = Math.max(...e);
    const ms = (e.findIndex((v) => v > 0.9 * top) - e.findIndex((v) => v > 0.1 * top)) * 2;
    assert.ok(ms >= 20, `${word}: from 10% to 90% in ${ms} ms`);
  }
  // her breath: a quiet stretch (not silence, not speech) of 80 ms or more between two sentences, and none inside one
  const quietRun = (text) => {
    const e = env(synthesize(text, { lang: 'ru' }).samples, 20);
    let run = 0;
    let best = 0;
    for (const v of e) { run = v > 0.0008 && v < 0.012 ? run + 1 : 0; best = Math.max(best, run); }
    return best;
  };
  assert.ok(quietRun('Привет. Как дела? Всё хорошо.') >= 4, 'a breath between sentences');
  assert.ok(quietRun('Привет как дела у тебя сегодня') < 4, 'no breath in the middle of a sentence');
  // she does not wobble: the same vowel twice in a row is not a different pitch each time
  const { synthesize: syn } = await load('voice-synth.js');
  const f = pitches(syn('аааааа', { lang: 'ru', mood: 'calm' }).samples, 22050);
  const sorted = [...f].sort((x, y) => x - y);
  const spread = 12 * Math.log2(sorted[Math.floor(sorted.length * 0.9)] / sorted[Math.floor(sorted.length * 0.1)]);
  assert.ok(spread < 5, `a held vowel moves ${spread.toFixed(1)} semitones (10-90%)`);
});

test('she is quick and lively: a real pace, accents where the words matter, a pitch that moves', async () => {
  const { synthesize } = await load('voice-synth.js');
  const line = 'Ну что, чумба, опять взламываешь лёд? Я бы на твоём месте не стала.';
  const calm = synthesize(line, { lang: 'ru', mood: 'calm' });
  const letters = line.replace(/[^а-яё]/gi, '').length;
  const pace = letters / calm.duration;
  assert.ok(pace > 12 && pace < 17.5, `${pace.toFixed(1)} letters a second (a quick talker is 13 to 16)`);
  // the tune moves: about 6 semitones or more between the low and the high of it, nobody squeaks
  const p = pitches(calm.samples, calm.sampleRate).sort((x, y) => x - y);
  const span = 12 * Math.log2(p[Math.floor(p.length * 0.9)] / p[Math.floor(p.length * 0.1)]);
  assert.ok(span > 4.5, `her tune spans ${span.toFixed(1)} semitones`);
  assert.ok(p[p.length - 1] < 360, `the top of it is ${Math.round(p[p.length - 1])} Hz`);
  // a word in capitals is pressed: longer, and its tune is higher
  const plain = synthesize('Я не знаю', { lang: 'ru', mood: 'calm', seed: 7 });
  const shouted = synthesize('Я не ЗНАЮ', { lang: 'ru', mood: 'calm', seed: 7 });
  assert.ok(shouted.duration > plain.duration * 1.04, `${plain.duration.toFixed(2)} s to ${shouted.duration.toFixed(2)} s`);
  const top = (r) => Math.max(...pitches(r.samples, r.sampleRate));
  assert.ok(top(shouted) > top(plain) * 1.04, `${Math.round(top(plain))} Hz to ${Math.round(top(shouted))} Hz`);
  // little words get hardly any accent, so "я" and "не" do not lift the tune the way "знаю" does
  const weak = synthesize('я не', { lang: 'ru', mood: 'calm', seed: 7 });
  const full = synthesize('знаю', { lang: 'ru', mood: 'calm', seed: 7 });
  assert.ok(median(pitches(full.samples, full.sampleRate)) > median(pitches(weak.samples, weak.sampleRate)) * 1.0, 'content words carry the accent');
  // softness: 0 is crisp and bright, 1 is soft
  const crisp = synthesize('Привет, как дела у тебя сегодня', { lang: 'ru', soft: 0, seed: 3 });
  const soft = synthesize('Привет, как дела у тебя сегодня', { lang: 'ru', soft: 1, seed: 3 });
  assert.ok(centroid(crisp.samples.subarray(4000, 6048), crisp.sampleRate) > centroid(soft.samples.subarray(4000, 6048), soft.sampleRate), 'crisp is brighter than soft');
  const hf = (r) => { let a = 0; let e = 0; for (const v of r.samples) { a += (v - a) * 0.5; e += (v - a) ** 2; } return e / r.samples.length; };
  assert.ok(hf(crisp) > hf(soft) * 1.15, 'and has more of the high end');
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
