'use strict';

// Her character: what she makes of your messages (mood.js), how long it lasts, her grudges across
// restarts, her colours asked for in her chat (themes.js), and what her voice reads out (speech.js).
//   npm run test:character

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// themes.js and speech.js import util.js, which asks the browser about reduced motion
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

const MIN = 60 * 1000;

test('reads what a message is to her, in Russian and English', async () => {
  const { classify } = await load('mood.js');
  const tags = (text) => classify(text).tags;
  assert.ok(tags('ты дура').includes('insult'));
  assert.ok(tags('заткнись уже').includes('insult'));
  assert.ok(tags("you're so stupid").includes('insult'));
  assert.ok(tags('ты просто программа').includes('justBot'));
  assert.ok(tags('Привет, Алиса').includes('wrongName'));
  assert.ok(tags('я тебя удалю').includes('threat'));
  assert.ok(tags('ты такая милая').includes('compliment'));
  assert.ok(tags('люблю тебя').includes('love'));
  assert.ok(tags('прости меня').includes('apology'));
  assert.ok(tags('ахахах').includes('laughing'));
  assert.ok(tags('расскажи шутку').includes('jokeAsk'));
  assert.ok(tags('мне грустно').includes('userSad'));
  assert.ok(tags('ПОЧЕМУ ТЫ МОЛЧИШЬ').includes('yell'));
  // things that aren't about her
  assert.deepEqual(tags('выключи звук'), []);
  assert.deepEqual(tags('дурацкая ошибка в коде'), []);
  assert.deepEqual(tags('открой спотифай'), []);
});

test('repeating yourself annoys her', async () => {
  const { classify } = await load('mood.js');
  const now = Date.now();
  assert.ok(classify('ты тут?', { recent: [{ text: 'ты тут?', at: now - 5000 }], now }).tags.includes('spam'));
});

test('an insult makes her angry, an apology calms her down, slowly', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  const r1 = m.feel('ты тупая железяка, заткнись', 1000);
  assert.equal(r1.mood, 'angry');
  assert.equal(r1.reaction, 'rage');
  assert.match(m.describe(1000), /ANGRY/);
  const r2 = m.feel('прости', 5000);
  assert.equal(r2.reaction, 'pout'); // one sorry isn't enough
  const r3 = m.feel('прости меня, пожалуйста', 9000);
  assert.equal(r3.reaction, 'forgive');
  assert.equal(m.mood, 'calm');
});

test('a grudge wears off on its own, in minutes', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  m.feel('ты дура, ненавижу тебя', 0);
  assert.notEqual(m.mood, 'calm');
  m.tick(20 * MIN);
  assert.ok(m.v.anger < 0.1);
});

test('compliments fluster her, poking her over and over makes her blow up', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  assert.equal(m.feel('ты такая милая', 0).reaction, 'shy');
  assert.equal(m.mood, 'shy');
  const pokes = [0, 300, 600, 900, 1200, 1500].map((t) => m.poke(10000 + t));
  assert.equal(pokes[3], 'huff');
  assert.equal(pokes[5], 'rage');
});

test('left alone, she gets bored', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  m.tick(30 * MIN);
  assert.equal(m.mood, 'bored');
  m.contact(30 * MIN);
  assert.notEqual(m.mood, 'bored');
});

test('she remembers being angry after a restart', async () => {
  const { Mood } = await load('mood.js');
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const now = Date.now();
  const before = new Mood({ storage, now });
  before.feel('ты дура, заткнись', now);
  const after = new Mood({ storage, now: now + 60000 });
  assert.ok(after.grudge);
  assert.notEqual(after.mood, 'calm');
});

test('the mood her AI answered with is read, and an unknown one ignored', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  assert.equal(m.answered('laugh', 0), 'laugh');
  assert.equal(m.answered('evil', 0), null);
});

test('recolouring is understood in her chat', async () => {
  const { askedTheme } = await load('themes.js');
  assert.equal(askedTheme('перекрасься в синий'), 'netrunner');
  assert.equal(askedTheme('стань розовой'), 'sakura');
  assert.equal(askedTheme('смени цвет на зелёный'), 'toxic');
  assert.equal(askedTheme('верни как было'), 'classic');
  assert.equal(askedTheme('turn purple'), 'violet');
  assert.equal(askedTheme('перекрасься под настроение'), 'mood');
  assert.equal(askedTheme('как дела?'), null);
});

test('Piper has no feelings to be told, so her mood moves its pace a little; the others are not touched', async () => {
  const { paceFor } = await load('speech.js');
  const moods = ['calm', 'happy', 'laugh', 'angry', 'annoyed', 'sad', 'shy', 'smug', 'surprised', 'dreamy', 'bored'];
  for (const mood of moods) {
    const pace = paceFor('piper', mood);
    assert.ok(pace >= 0.9 && pace <= 1.1, `${mood}: ${pace} is a nudge, not a tape running wrong`);
    for (const engine of ['chatterbox', 'openai', 'elevenlabs', 'custom', 'system']) assert.equal(paceFor(engine, mood), 1, `${engine} is told her mood instead`);
  }
  assert.ok(paceFor('piper', 'happy') > 1 && paceFor('piper', 'sad') < 1 && paceFor('piper', 'bored') < paceFor('piper', 'calm'));
  assert.equal(paceFor('piper', 'a mood nobody has'), 1);
});

test('her voice reads plain words only', async () => {
  const { speakable } = await load('speech.js');
  assert.equal(speakable('[[mood: angry]] Хмф. Смотри **сюда** https://x.com 😡'), 'Хмф. Смотри сюда');
  assert.ok(speakable('а'.repeat(2000)).length <= 601);
});
