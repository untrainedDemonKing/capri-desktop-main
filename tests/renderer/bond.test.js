'use strict';

// Her bond with you (bond.js): what she picks up from how you write and how you take her answers,
// her notebook (what the model writes, cleaned), how close she gets, and her swearing tolerance.
//   npm run test:bond

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { rendererFile } = require('../helpers/source');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(rendererFile(file)).href);

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

// ---- the two of you: trust, days in a row, quarrels, absence ----

test('days in a row are counted, a missed day starts the run over, and the longest is kept', async () => {
  const bond = await load('bond.js');
  const { b } = newBond(bond);
  const day = (y, m, d) => { b.clock = () => new Date(y, m - 1, d, 12, 0, 0); };
  day(2026, 3, 1); b.observe('привет');
  day(2026, 3, 1); b.observe('ещё раз');
  assert.equal(b.data.rel.streak, 1, 'the same day is the same day');
  day(2026, 3, 2); b.observe('привет');
  day(2026, 3, 3); b.observe('привет');
  assert.equal(b.data.rel.streak, 3);
  day(2026, 3, 6); b.observe('я вернулся');
  assert.equal(b.data.rel.streak, 1, 'two days missed: a new run');
  assert.equal(b.data.rel.best, 3, 'the longest is kept');
  assert.equal(b.data.days, 4);
  assert.equal(bond.daysBetween('2026-02-28', '2026-03-01'), 1, 'across the end of a month');
  assert.equal(bond.daysBetween('2025-12-31', '2026-01-02'), 2, 'and of a year');
});

test('a quarrel made up after builds trust, being cruel loses it, and being open and kind adds a little', async () => {
  const bond = await load('bond.js');
  const rel = () => ({ trust: 0.3, fights: 0, makeups: 0, streak: 0, best: 0, affection: 0.1 });
  const a = bond.trustFrom(rel(), ['insult'], { reaction: 'rage' });
  assert.equal(a.fights, 1);
  assert.ok(a.trust < 0.3);
  const b = bond.trustFrom(a, ['apology'], { reaction: 'forgive' });
  assert.equal(b.makeups, 1);
  assert.ok(b.trust > 0.3, 'a made-up quarrel is worth more than it cost');
  const c = bond.trustFrom(rel(), ['cheer']);
  assert.ok(c.trust > 0.3);
  const d = bond.trustFrom(rel(), ['userSad']);
  assert.ok(d.trust > 0.3);
  const e = rel();
  for (let i = 0; i < 100; i++) bond.trustFrom(e, ['insult'], { reaction: 'rage' });
  assert.equal(e.trust, 0, 'it does not go below nothing');
  const f = rel();
  for (let i = 0; i < 200; i++) bond.trustFrom(f, ['thanks', 'cheer'], null);
  assert.equal(f.trust, 1);
});

test('the quarrels you made up after and the days in a row count toward how close she gets; someone she does not trust or like does not get close', async () => {
  const bond = await load('bond.js');
  assert.equal(bond.effectiveTalks({ talks: 100 }), 100, 'nothing extra for a plain count');
  assert.equal(bond.effectiveTalks({ talks: 100, rel: { makeups: 2, streak: 8 } }), 100 + 12 + 20);
  assert.equal(bond.effectiveTalks({ talks: 100, rel: { makeups: 99, streak: 40 } }), 100 + 30 + 60, 'both are capped');
  // 70 messages is not friends yet (80), but with two make-ups and a week in a row it is
  assert.equal(bond.levelOf({ talks: 70, days: 4 }), 1);
  assert.equal(bond.levelOf({ talks: 70, days: 4, rel: { makeups: 2, streak: 8, trust: 0.5, affection: 0.2 } }), 2);
  // however much they type
  const lots = { talks: 700, days: 40 };
  assert.equal(bond.levelOf({ ...lots, rel: { trust: 0.5, affection: 0.3 } }), 4);
  assert.equal(bond.levelOf({ ...lots, rel: { trust: 0.12, affection: 0.3 } }), 2, 'little trust: friends at most');
  assert.equal(bond.levelOf({ ...lots, rel: { trust: 0.5, affection: -0.3 } }), 2, 'and she does not like them');
  assert.equal(bond.levelOf({ ...lots, rel: { trust: 0.03, affection: 0.3 } }), 1);
  assert.equal(bond.levelOf({ ...lots, rel: { trust: 0.5, affection: -0.6 } }), 1);
  assert.equal(bond.levelOf(lots), 4, 'a saved bond from before this has none of it: nothing is taken away');
  const p = bond.progressOf({ talks: 70, days: 4, rel: { makeups: 2, streak: 8 } });
  assert.equal(p.level, 2);
  const q = bond.progressOf({ talks: 70, days: 4 });
  assert.equal(q.needTalks, 10);
});

test('what her mind is told of the two of you: the run, the make-ups, trust, and an absence', async () => {
  const bond = await load('bond.js');
  const d = { talks: 120, days: 9, rel: { trust: 0.8, fights: 2, makeups: 2, streak: 9, best: 9, affection: 0.5 } };
  const text = bond.relationHints(d, 0).join(' ');
  assert.match(text, /9 days in a row \(their longest run\)/);
  assert.match(text, /fallen out 2 times and made up 2/);
  assert.match(text, /You trust the user/);
  assert.match(bond.relationHints({ talks: 20, rel: { trust: 0.1 } }, 0).join(' '), /do not really trust/);
  assert.deepEqual(bond.relationHints({ talks: 20, rel: { trust: 0.4, streak: 1 } }, 0), []);
  assert.match(bond.relationHints(d, 20).join(' '), /20 days when they started this chat: say you noticed/);
  assert.match(bond.relationHints(d, 4).join(' '), /away for 4 days/);
  assert.match(bond.relationHints(d, 2).join(' '), /a couple of days/);
  assert.doesNotMatch(bond.relationHints(d, 1).join(' '), /days when they started/);
});

test('the gap is known when she starts, goes into her first answer, and is then forgotten; her summary mentions the run', async () => {
  const bond = await load('bond.js');
  const saved = { talks: 90, days: 5, lastDay: '2026-03-01', met: '2026-02-01', rel: { trust: 0.5, fights: 1, makeups: 1, streak: 4, best: 4, affection: 0.3 } };
  const { b } = newBond(bond, saved);
  b.clock = () => new Date(2026, 2, 8, 12);
  await b.start();
  assert.equal(b.gap, 7);
  assert.match(b.context('привет').join(' '), /away for 7 days/);
  b.observe('привет, я вернулся');
  assert.match(b.context('привет').join(' '), /away for 7 days/, 'still, until she has answered');
  b.forgetGap();
  assert.doesNotMatch(b.context('привет').join(' '), /away for/);
  assert.equal(b.data.rel.streak, 1);
  b.data.rel.streak = 5;
  assert.match(b.summary(), /5 дн. подряд|5 days in a row/);
  const fresh = newBond(bond).b;
  await fresh.start();
  assert.equal(fresh.gap, 0, 'a first run has no gap');
});

test('a saved bond keeps what is between you, safely; forgetting wipes it', async () => {
  const bond = await load('bond.js');
  const d = bond.normalize({ rel: { trust: 7, fights: -3, makeups: 'x', streak: 4, best: 9, affection: -5 } });
  assert.equal(d.rel.trust, 1);
  assert.equal(d.rel.fights, 0);
  assert.equal(d.rel.makeups, 0);
  assert.equal(d.rel.streak, 4);
  assert.equal(d.rel.affection, -1);
  assert.deepEqual(bond.normalize(null).rel, { trust: 0.3, fights: 0, makeups: 0, streak: 0, best: 0, affection: 0.1 });
  const { b, host } = newBond(bond, { talks: 50, rel: { trust: 0.9, makeups: 3 } });
  await b.start();
  b.forget();
  assert.equal(host.saved.rel.makeups, 0);
  assert.equal(host.saved.rel.trust, 0.3);
});

test('what she felt about your message reaches the bond: a quarrel counts, a make-up counts', async () => {
  const bond = await load('bond.js');
  const mood = await load('mood.js');
  const host = { saved: null, bondLoad: async () => null, bondSave: (d) => { host.saved = d; }, bondReflect: null };
  const heart = { mood: new mood.Mood({ storage: null, now: 0 }) };
  const b = new bond.Bond({ host, brain: { lang: 'ru', custom: {} }, heart });
  const say = (text, now) => { const felt = heart.mood.feel(text, now); b.observe(text, felt.tags, felt); return felt; };
  assert.equal(say('ты тупая железяка, заткнись', 1000).reaction, 'rage');
  assert.equal(b.data.rel.fights, 1);
  say('прости', 5000);
  assert.equal(say('прости меня, пожалуйста', 9000).reaction, 'forgive');
  assert.equal(b.data.rel.makeups, 1);
  assert.ok(b.data.rel.affection <= 0.1, 'and how she feels about you is kept with it');
});
