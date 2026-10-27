'use strict';

// The parts of her chat (src/renderer/js/chat.js) that read what you and her model write: what you ask
// for plainly (the music keys), how her answer is cleaned for the bubble, and her chat opening once.
//   node --test tests/chat.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

test('her answer is cleaned of markdown, and of nothing else', async () => {
  const { clean } = await load('chat.js');
  assert.equal(clean('**Привет**, *чумба*! Это `код` и _акцент_.'), 'Привет, чумба! Это код и акцент.');
  assert.equal(clean('# Заголовок\n* пункт\n- не трогаем'), 'Заголовок\nпункт\n- не трогаем');
  // what is only text stays text
  assert.equal(clean('Пиши на C# и F#, my_var_name, 2*3 и 2 * 3 * 4, snake_case'), 'Пиши на C# и F#, my_var_name, 2*3 и 2 * 3 * 4, snake_case');
  // her tags and her thoughts never show; half a bold while the answer comes in doesn't either
  assert.equal(clean('[[mood: smug]] Ну привет. [[open: Spotify]]'), 'Ну привет.');
  assert.equal(clean('<think>хм</think>Ладно'), 'Ладно');
  assert.equal(clean('Это **жирн'), 'Это жирн');
  assert.equal(clean('[[mood: ha'), '');
});

test('"next", "pause" and "go on" in talk are not the music keys; asking for the music is', async () => {
  const { Chat } = await load('chat.js');
  const ask = (text, playing = false) => Chat.prototype.asked.call({
    hands: null,
    askedToClose: () => null,
    mediaAsked: Chat.prototype.mediaAsked,
    life: { media: { playing } },
  }, text);
  // said in talk
  assert.equal(ask('продолжай'), null, '"go on" is not the play key');
  assert.equal(ask('давай следующий вопрос про код'), null);
  assert.equal(ask('what is next for me'), null, 'nothing playing: just talk');
  // said to her about the music
  assert.deepEqual(ask('следующий'), { kind: 'media', action: 'next' });
  assert.deepEqual(ask('пауза'), { kind: 'media', action: 'pause' });
  assert.deepEqual(ask('what is next for me', true), { kind: 'media', action: 'next' }, 'with music playing, in a few words');
  assert.deepEqual(ask('включи следующую песню'), { kind: 'media', action: 'next' });
  assert.deepEqual(ask('продолжи музыку'), { kind: 'media', action: 'play' });
  // the volume doesn't need the music
  assert.deepEqual(ask('сделай громче'), { kind: 'media', action: 'volup' });
});

test('her chat opens once however many times it is asked', async () => {
  const { Chat } = await load('chat.js');
  let begun = 0;
  let release;
  const chat = Object.create(Chat.prototype);
  chat.begin = () => { begun += 1; return new Promise((r) => { release = r; }); };
  const a = chat.start();
  const b = chat.start();
  assert.equal(a, b, 'the same opening');
  assert.equal(begun, 1);
  release();
  await a;
  chat.start(); // once it is done, a new one is a new one
  assert.equal(begun, 2);
  release();
});

test('what you say with your voice while she is still answering is sent once she is done', async () => {
  const { Chat } = await load('chat.js');
  const sent = [];
  const chat = Object.create(Chat.prototype);
  Object.assign(chat, { later: '', open: true, turn: 0, send: (t) => sent.push(t) });
  chat.say('раз');
  assert.deepEqual(sent, ['раз'], 'she is free: said at once');
  chat.turn = 123; // she is answering
  chat.say('два');
  chat.say('три');
  assert.deepEqual(sent, ['раз'], 'not thrown at her mid-answer');
  assert.equal(chat.later, 'два три');
  chat.turn = 0;
  chat.sayLater();
  assert.equal(chat.later, '');
  await new Promise((r) => setTimeout(r, 760));
  assert.deepEqual(sent, ['раз', 'два три']);
  // her chat was shut meanwhile: nothing is said into the void
  chat.later = 'поздно';
  chat.open = false;
  chat.sayLater();
  await new Promise((r) => setTimeout(r, 760));
  assert.deepEqual(sent, ['раз', 'два три']);
});
