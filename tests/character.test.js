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
  // she does not turn calm at the word: forgiven, she is still sore (annoyed), and cools off from there
  assert.equal(m.mood, 'annoyed');
  m.tick(9000 + 25 * 1000);
  assert.equal(m.mood, 'annoyed', 'half a minute on she is still a little sore');
  m.tick(9000 + 3 * MIN);
  assert.equal(m.mood, 'calm', 'and in a few minutes she is calm');
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

test('a mood is entered at one level and left at a lower one, so that it does not flicker at its edge', async () => {
  const { moodOf } = await load('mood.js');
  const v = (anger) => ({ anger, joy: 0.1, sad: 0, shy: 0, bored: 0 });
  assert.equal(moodOf(v(0.5), 'calm').mood, 'annoyed', 'not angry yet');
  assert.equal(moodOf(v(0.5), 'angry').mood, 'angry', 'but not out of it yet either');
  assert.equal(moodOf(v(0.4), 'angry').mood, 'annoyed', 'out of it below 0.45');
  assert.equal(moodOf(v(0.18), 'annoyed').mood, 'annoyed', 'annoyed from 0.22, and still annoyed at 0.18');
  assert.equal(moodOf(v(0.18), 'calm').mood, 'calm');
  assert.equal(moodOf(v(0.1), 'annoyed').mood, 'calm');
  // what she is in is kept unless another is clearly stronger
  assert.equal(moodOf({ anger: 0, joy: 0.5, sad: 0, shy: 0.48, bored: 0 }, 'happy').mood, 'happy');
  assert.equal(moodOf({ anger: 0, joy: 0.4, sad: 0, shy: 0.6, bored: 0 }, 'happy').mood, 'shy', 'clearly stronger: it takes over');
});

test('after a quarrel she goes angry, annoyed, calm: one way, with no flicker, and over a minute or two', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  assert.equal(m.feel('ты тупая железяка, заткнись', 1000).mood, 'angry');
  const seen = [];
  for (let t = 2000; t <= 15 * MIN; t += 1000) {
    m.tick(t);
    if (seen.at(-1) !== m.mood) seen.push(m.mood);
  }
  assert.deepEqual(seen, ['angry', 'annoyed', 'calm'], seen.join(' > '));
  // (the feeling itself falls on its own half-life; what she SHOWS falls slower, so the middle step is there)
  const n = new Mood({ storage: null, now: 0 });
  n.feel('ты тупая железяка, заткнись', 0);
  assert.equal(n.cooling, false, 'still just angry');
  n.feel('прости меня, пожалуйста, прости', 20 * 1000); // she is talked round: what she feels drops, what she shows follows slowly
  n.tick(30 * 1000);
  assert.ok(n.state().values.anger > n.v.anger, 'she shows more than she feels while she cools off');
  assert.equal(n.cooling, true);
  assert.match(n.describe(30 * 1000), /cooling off/);
  n.tick(10 * MIN);
  assert.equal(n.cooling, false);
});

test('a rise shows at once, a fall slowly, and the mood label follows what is shown', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  m.feel('ты дура', 0);
  assert.ok(m.state().values.anger >= m.v.anger - 1e-9, 'it rises at once');
  const before = m.state().values.anger;
  m.apply({ anger: -0.3 });
  m.tick(5000);
  assert.ok(m.state().values.anger < before && m.state().values.anger > m.v.anger + 0.05, 'and what is shown falls slower than what is felt');
});

test('an ordinary friendly word in the middle of a quarrel cools her a little, and more the closer you are', async () => {
  const { Mood } = await load('mood.js');
  const cold = new Mood({ storage: null, now: 0 });
  cold.affection = 0;
  const close = new Mood({ storage: null, now: 0 });
  close.affection = 0.8;
  for (const m of [cold, close]) m.feel('ты тупая железяка, заткнись', 0);
  const start = cold.v.anger;
  const talk = ['а какая сегодня погода', 'расскажи про космос', 'что поесть вечером', 'какой фильм посмотреть', 'как работает git', 'сколько воды пить в день'];
  for (let i = 0; i < 6; i++) {
    cold.feel(talk[i], 20000 + i * 20000); // (twenty seconds apart: that is talking, not flooding her)
    close.feel(talk[i], 20000 + i * 20000);
  }
  assert.ok(cold.v.anger < start - 0.1, `she cools: ${start} to ${cold.v.anger}`);
  assert.ok(close.v.anger < cold.v.anger - 0.1, `and faster with somebody she is fond of: ${close.v.anger}`);
  // while an insult in the middle of it does the opposite
  const before = cold.v.anger;
  cold.feel('ты тупая', 200000);
  assert.ok(cold.v.anger > before + 0.3);
});

test('she reads how you take her answers and how you are: disagreeing, agreeing, good news, being fed up, brushing it off, missing her', async () => {
  const { classify, reactionTo, Mood } = await load('mood.js');
  const tags = (text) => classify(text).tags;
  assert.ok(tags('ты не права, это не так').includes('disagree'));
  assert.ok(tags('you are wrong about that').includes('disagree'));
  assert.ok(tags('ты права').includes('agree'));
  assert.ok(tags('именно').includes('agree'));
  assert.ok(tags('exactly!').includes('agree'));
  assert.ok(!tags('точно не знаю').includes('agree'), 'a "точно" in the middle of a sentence is not agreeing');
  assert.ok(tags('ура, у меня получилось!').includes('cheer'));
  assert.ok(tags('я сдал экзамен').includes('cheer'));
  assert.ok(tags('it worked, finally').includes('cheer'));
  assert.ok(tags('опять не работает, бесит').includes('frustrated'));
  assert.ok(tags('это так достало').includes('frustrated'));
  assert.ok(!tags('ты меня бесишь').includes('frustrated'), 'being fed up with HER is an insult, not this');
  assert.ok(tags('ты меня бесишь').includes('insult'));
  assert.ok(tags('ладно').includes('dismiss'));
  assert.ok(tags('ну такое').includes('dismiss'));
  assert.ok(!tags('ладно, давай попробуем').includes('dismiss'), 'only when that is all that is said');
  assert.ok(tags('я скучал по тебе').includes('miss'));
  assert.ok(tags('i missed you').includes('miss'));
  const calm = { anger: 0, joy: 0.2, sad: 0, shy: 0, bored: 0 };
  assert.equal(reactionTo(['cheer'], calm, calm), 'giggle');
  assert.equal(reactionTo(['frustrated'], calm, calm), 'care');
  assert.equal(reactionTo(['agree'], calm, calm), 'smug');
  assert.equal(reactionTo(['miss'], calm, calm), 'shy');
  assert.equal(reactionTo(['disagree'], calm, calm), 'huff');
  // and what they do to her
  const m = new Mood({ storage: null, now: 0 });
  const joy = m.v.joy;
  m.feel('ура, получилось!', 0);
  assert.ok(m.v.joy > joy + 0.15, 'good news makes her happy too');
  const k = new Mood({ storage: null, now: 0 });
  k.feel('ты не права', 0);
  assert.ok(k.v.anger > 0.05, 'being told she is wrong stings a little');
});

test('what you said last is in what her mind is told, for a few minutes: she answers to it', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  m.feel('опять не работает, бесит', 0);
  assert.match(m.describe(1000), /fed up with something \(not with you\)/);
  m.feel('ура, получилось!', 5000);
  assert.match(m.describe(6000), /good news/);
  assert.doesNotMatch(m.describe(6000), /fed up/);
  assert.doesNotMatch(m.describe(6000 + 5 * MIN), /good news/, 'and it wears off');
  m.feel('ты не права', 10000);
  assert.match(m.describe(11000), /think you were wrong/);
});

test('the mind is told how strong the mood is, and how she feels about you', async () => {
  const { Mood } = await load('mood.js');
  const m = new Mood({ storage: null, now: 0 });
  m.apply({ anger: 0.9 });
  m.changed(0);
  assert.match(m.describe(0), /FURIOUS/);
  const mild = new Mood({ storage: null, now: 0 });
  mild.apply({ anger: 0.25 });
  mild.changed(0);
  assert.match(mild.describe(0), /a little irritated/);
  mild.affection = -0.6;
  assert.match(mild.describe(0), /do not trust the user/);
  mild.affection = 0.25;
  assert.match(mild.describe(0), /warming to the user/);
  mild.affection = 0.7;
  assert.match(mild.describe(0), /very fond/);
});

test('an event can be scaled: a long absence is missed more than a short one', async () => {
  const { Mood } = await load('mood.js');
  const a = new Mood({ storage: null, now: 0 });
  const b = new Mood({ storage: null, now: 0 });
  a.event('longAway', 0, 1);
  b.event('longAway', 0, 3);
  assert.ok(b.v.sad > a.v.sad * 2.5);
  for (const name of ['morning', 'batteryLow', 'charging', 'offline', 'online', 'longSession']) {
    const m = new Mood({ storage: null, now: 0 });
    const before = { ...m.v };
    m.event(name, 0);
    assert.notDeepEqual(m.v, before, name);
  }
});
