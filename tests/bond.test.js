'use strict';

// Her bond with you (bond.js): what she picks up from how you write and how you take her answers,
// her notebook (what the model writes, cleaned), how close she gets, and her swearing tolerance.
//   npm run test:bond

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

function newBond(bond, saved = null) {
  const host = { saved: null, bondLoad: async () => saved, bondSave: (d) => { host.saved = d; }, bondReflect: null };
  const b = new bond.Bond({ host, brain: { lang: 'ru', custom: {} }, heart: null });
  return { b, host };
}

test('plain asks change how she talks, at once; "короче" as a filler word does not', async () => {
  const bond = await load('bond.js');
  const { b } = newBond(bond);
  b.observe('давай покороче');
  assert.ok(b.data.tune.short > 0.4);
  const before = b.data.tune.short;
  b.observe('короче, я вчера ходил в кино и там было круто');
  assert.equal(b.data.tune.short, before);
  b.observe('без сленга, пожалуйста');
  assert.ok(b.data.tune.slang < -0.4);
  b.observe('не шути так, мне не до смеха');
  assert.ok(b.data.tune.tease < -0.4);
  b.observe('а подробнее?');
  assert.ok(b.data.tune.short < before);
  assert.match(bond.tuneHints(b.data.tune).join(' '), /slang/);
});

test('she leans toward what you liked in her last answer, and away from what you did not', async () => {
  const bond = await load('bond.js');
  const { b } = newBond(bond);
  for (let i = 0; i < 6; i++) {
    b.replied('Норм, чумба. Взламываю лёд.', 'smug'); // short, slang, teasing
    b.observe('ахаха ору', ['laughing']);
  }
  assert.ok(b.data.tune.short > 0.3 && b.data.tune.slang > 0.3 && b.data.tune.tease > 0.3, JSON.stringify(b.data.tune));
  for (let i = 0; i < 10; i++) {
    b.replied('Слушай, чумба, это всё очень длинная история про корпов, спутник и Найт-Сити, и я расскажу её целиком, со всеми подробностями, отступлениями, лирикой и сносками, потому что мне так хочется, а ты слушай внимательно и не перебивай.', 'calm');
    b.observe('бред какой-то, скучно');
  }
  assert.ok(b.data.tune.short > 0.6, 'long answers he found boring push her shorter');
  assert.ok(bond.feedback('спасибо, круто', ['thanks']) > 0);
  assert.ok(bond.feedback('не так', []) < 0);
  assert.equal(bond.feedback('ок', []), 0);
});

test('how you write: short messages, swearing, "вы", laughter', async () => {
  const bond = await load('bond.js');
  const s = { n: 0, words: 0, emoji: 0, swear: 0, formal: 0.5, laugh: 0, ask: 0, hostile: 0, warm: 0 };
  for (const t of ['бля, привет', 'ахах', 'а вы кто?', 'да блин', 'ну вы даёте', 'пиздец ахах']) bond.observeStyle(s, t, /ахах/.test(t) ? ['laughing'] : []);
  assert.equal(s.n, 6);
  assert.ok(s.words < 4);
  assert.ok(s.swear > 0.3);
  assert.ok(s.formal > 0.6);
  const hints = bond.styleHints(s).join(' ');
  assert.match(hints, /very short messages/);
  assert.match(hints, /swear casually/);
  assert.match(hints, /formally/);
});

test('her notebook: lenient JSON, nothing sensitive, merged without duplicates', async () => {
  const bond = await load('bond.js');
  const notes = bond.parseNotes('<think>{"x":1}</think>```json\n{"facts":["учится на программиста","пароль от почты qwerty","телефон 8 999 123 45 67","kirill@mail.ru"],"likes":["синтвейв"],"dislikes":["понедельники"],"style":"коротко","us":"друзья"}\n```');
  assert.deepEqual(notes.facts, ['учится на программиста']);
  assert.equal(bond.parseNotes('no json here'), null);
  const merged = bond.mergeNotes({ facts: ['живёт в Москве', 'Учится на программиста'], likes: ['кофе'], dislikes: ['спорт'], style: 'старое', us: '' }, { facts: ['учится на программиста', 'есть кот'], likes: ['спорт'], dislikes: ['кофе'], style: '', us: 'друзья' });
  assert.deepEqual(merged.facts, ['учится на программиста', 'есть кот', 'живёт в Москве']);
  assert.deepEqual(merged.likes, ['спорт']);
  assert.deepEqual(merged.dislikes, ['кофе']);
  assert.equal(merged.style, 'старое');
  assert.equal(merged.us, 'друзья');
});

test('she gets closer with time, not with rudeness; a level-up is reported once', async () => {
  const bond = await load('bond.js');
  assert.equal(bond.levelOf({ talks: 5, days: 1 }), 0);
  assert.equal(bond.levelOf({ talks: 20, days: 1 }), 1);
  assert.equal(bond.levelOf({ talks: 100, days: 5 }), 2);
  assert.equal(bond.levelOf({ talks: 300, days: 12 }), 3);
  assert.equal(bond.levelOf({ talks: 900, days: 40 }), 4);
  assert.equal(bond.levelOf({ talks: 900, days: 40, style: { n: 50, hostile: 0.4 } }), 1);
  const { b } = newBond(bond, { talks: 79, days: 3, lastDay: '2000-01-01', met: '2000-01-01' });
  await b.start();
  assert.equal(b.data.level, 1);
  assert.equal(b.observe('привет'), 2);
  assert.equal(b.observe('как дела'), 0);
});

test('a reflection writes her notebook through the host, every few messages, never with Claude Code', async () => {
  const bond = await load('bond.js');
  const { b, host } = newBond(bond);
  let calls = 0;
  host.bondReflect = async ({ messages }) => {
    calls += 1;
    assert.equal(messages[0].role, 'system');
    assert.match(messages[1].content, /User: я люблю синтвейв/);
    return { ok: true, text: '{"facts":[],"likes":["синтвейв"],"dislikes":[],"style":"","us":""}' };
  };
  const history = [];
  for (let i = 0; i < 7; i++) {
    history.push({ role: 'user', content: 'я люблю синтвейв' }, { role: 'assistant', content: 'О, неон.' });
    b.observe('я люблю синтвейв');
  }
  assert.equal(await b.reflect(history), false, 'not yet: 7 messages');
  assert.equal(await b.reflect(history, { closing: true }), true, 'the chat closing: enough');
  assert.equal(calls, 1);
  assert.deepEqual(b.data.notes.likes, ['синтвейв']);
  assert.equal(b.data.pending, 0);
  b.agent = true;
  for (let i = 0; i < 10; i++) b.observe('ещё');
  b.triedAt = -Infinity;
  assert.equal(await b.reflect(history), false);
  assert.equal(calls, 1);
  assert.match(b.context().join('\n'), /they like: синтвейв/);
});

test('"что ты обо мне знаешь" and "забудь всё обо мне" are understood; forgetting wipes and saves', async () => {
  const bond = await load('bond.js');
  assert.ok(bond.ABOUT_ME.test('Капри, что ты обо мне знаешь?'));
  assert.ok(bond.ABOUT_ME.test('what do you know about me'));
  assert.ok(bond.FORGET_ME.test('забудь всё, что знаешь обо мне'));
  assert.ok(!bond.FORGET_ME.test('забудь этот разговор'));
  const { b, host } = newBond(bond);
  b.observe('привет');
  assert.match(b.context('что ты обо мне знаешь?').join('\n'), /asks what you know about them/);
  b.forget();
  assert.equal(b.data.talks, 0);
  assert.equal(host.saved.talks, 0);
});

test('swearing that is just how you talk stops making her huff', async () => {
  const { Mood } = await load('mood.js');
  const storage = { getItem: () => null, setItem() {} };
  const m = new Mood({ storage });
  assert.equal(m.feel('бля, опять дождь').reaction, 'huff');
  const used = new Mood({ storage });
  used.tolerance = 0.8;
  const felt = used.feel('бля, опять дождь');
  assert.equal(felt.reaction, null);
  assert.ok(felt.tags.includes('rude'), 'the tag stays, for bond.js');
  assert.ok(used.feel('ты тупая дура').reaction, 'an insult is still an insult');
});

test('a saved bond that is broken or from elsewhere loads safely', async () => {
  const bond = await load('bond.js');
  const d = bond.normalize({ talks: 'lots', tune: { short: 9, slang: 'x' }, hours: [1, 2], notes: { facts: ['a', 5, null, 'a'] }, style: { words: -3 } });
  assert.equal(d.talks, 0);
  assert.equal(d.tune.short, 1);
  assert.equal(d.tune.slang, 0);
  assert.equal(d.hours.length, 24);
  assert.deepEqual(d.notes.facts, ['a']);
  assert.equal(d.style.words, 0);
  assert.equal(bond.normalize(null).level, 0);
});
