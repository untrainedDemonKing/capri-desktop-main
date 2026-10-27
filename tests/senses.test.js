'use strict';

// Her senses and her hands: reading commands off your messages (hands.js), making sense of what the
// vision model says (eyes.js), cleaning up a transcript (ears.js), and matching a messenger name
// (control.js).
//   npm run test:senses

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

async function newHands({ hands = true, type = true } = {}) {
  const { Hands } = await load('hands.js');
  const h = new Hands({ brain: { lang: 'ru' } });
  h.enabled = hands;
  h.canType = type;
  return h;
}

test('she reads who and what to write, in a few phrasings', async () => {
  const h = await newHands();
  assert.deepEqual(h.parse('капри, открой телеграм и напиши маме, скоро буду дома'),
    { kind: 'message', app: 'телеграм', chat: 'маме', message: 'скоро буду дома' });
  assert.deepEqual(h.parse('напиши в телеграме Паша: привет как дела'),
    { kind: 'message', app: 'телеграме', chat: 'Паша', message: 'привет как дела' });
  assert.deepEqual(h.parse('telegram, write to Mom: on my way'),
    { kind: 'message', app: 'telegram', chat: 'Mom', message: 'on my way' });
  assert.equal(h.parse('напиши жене в вотсапе что я задержусь').chat, 'жене');
});

test('she reads window commands and a show-desktop', async () => {
  const h = await newHands();
  assert.deepEqual(h.parse('сверни окно хрома'), { kind: 'window', op: 'minimize', name: 'хрома' });
  assert.deepEqual(h.parse('разверни телеграм'), { kind: 'window', op: 'maximize', name: 'телеграм' });
  assert.deepEqual(h.parse('восстанови окно спотифай'), { kind: 'window', op: 'restore', name: 'спотифай' });
  assert.equal(h.parse('переключись на vs code').op, 'focus');
  assert.deepEqual(h.parse('покажи рабочий стол'), { kind: 'desktop' });
});

test('she doesn\'t grab a message out of ordinary talk', async () => {
  const h = await newHands();
  assert.equal(h.parse('привет как дела'), null);
  assert.equal(h.parse('что нового?'), null);
});

test('the settings gate her hands', async () => {
  assert.equal((await newHands({ hands: false })).parse('сверни хром'), null);
  const noType = await newHands({ type: false });
  assert.equal(noType.parse('напиши маме в телеграм привет'), null); // no typing
  assert.equal(noType.parse('сверни хром').op, 'minimize');          // but windows still ok
});

test('her AI\'s message tag is read, and only with the setting on', async () => {
  const h = await newHands();
  assert.deepEqual(h.parse && h.parseTag('sure [[msg: discord | general | hello team]]'),
    { kind: 'message', app: 'discord', chat: 'general', message: 'hello team' });
  const off = await newHands({ type: false });
  assert.equal(off.parseTag('[[msg: discord | general | hi]]'), null);
});

test('she makes sense of what the vision model says', async () => {
  const { parse } = await load('eyes.js');
  assert.deepEqual(parse('{"scene":"a YouTube video","mood":"happy","line":"О, смотришь видосы"}'),
    { scene: 'a YouTube video', mood: 'happy', line: 'О, смотришь видосы' });
  // some models wrap it in a code fence or add words
  const o = parse('```json\n{"scene":"code","mood":"smug","line":"кодишь"}\n```');
  assert.equal(o.scene, 'code');
  // no JSON at all: the whole thing becomes the line
  assert.equal(parse('Looks like a game.').line, 'Looks like a game.');
});

test('she drops whisper\'s hallucinated filler', async () => {
  const { clean } = await load('ears.js');
  assert.equal(clean('Продолжение следует...'), '');
  assert.equal(clean('Субтитры сделал DimaTorzok'), '');
  assert.equal(clean('Thank you.'), '');
  assert.equal(clean('  ♪♪  '), '');
  assert.equal(clean('капри открой спотифай'), 'капри открой спотифай');
});

test('a messenger is matched by name and alias', async () => {
  const control = require('../src/main/control.js');
  assert.equal(control.appKey('телеграм'), 'telegram');
  assert.equal(control.appKey('в телеге'), 'telegram');
  assert.equal(control.appKey('Discord'), 'discord');
  assert.equal(control.appKey('вотсап'), 'whatsapp');
  assert.equal(control.appKey('почта'), null);
});
