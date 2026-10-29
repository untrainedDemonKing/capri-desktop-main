'use strict';

// Her first prompt and what is taken off an answer that came out like an assistant's (src/renderer/js/persona.js, chat.js).
//   node --test tests/persona.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', name)).href);

test('her prompt is in the language she answers in, and names the habits it is there to stop', async () => {
  const { core, reminder } = await load('persona.js');
  const ru = core('ru', { we: '"мы" in Russian', assistant: 'Claude Code' }).join('\n');
  assert.match(ru, /Ты — Капри/);
  assert.match(ru, /Сначала суть/, 'the answer first');
  assert.match(ru, /Вопросов почти нет/, 'almost no questions');
  assert.match(ru, /чем помочь/, 'and it names the question that is a habit');
  assert.match(ru, /Мнение у тебя всегда есть/);
  assert.match(ru, /Не повторяйся/);
  assert.match(ru, /Без markdown/);
  assert.match(ru, /ПРИМЕРЫ МАНЕРЫ/, 'examples of the manner');
  assert.match(ru, /присматриваешь за Claude Code/);
  assert.match(ru, /Если спросят, кто ты/, 'who she is');
  assert.doesNotMatch(ru, /You are Capri|The point first/, 'no English prompt in the Russian one');
  const en = core('en', { assistant: '' }).join('\n');
  assert.match(en, /You are Capri/);
  assert.match(en, /The point first/);
  assert.match(en, /Almost no questions/);
  assert.match(en, /how can I help/);
  assert.match(en, /keeps? them company|keep them company/);
  assert.doesNotMatch(en, /keep an eye on/, 'she watches nothing when nothing is watched');
  const agent = core('ru', { agent: true }).join('\n');
  assert.match(agent, /Под капотом ты Claude Code/);
  assert.doesNotMatch(agent, /Если спросят, кто ты/);
  assert.match(reminder('ru'), /без вопроса в конце/);
  assert.match(reminder('en'), /no question at the end/);
  assert.deepEqual(core('xx', {}), core('en', {}), 'another language reads the English');
});

test('the whole prompt: the language is the last thing said, after the reminder; the habits are named in the language of the answer', async () => {
  const { Chat } = await load('chat.js');
  const build = (lang, text) => {
    const chat = Object.create(Chat.prototype);
    chat.brain = { assistant: 'claude', lang, watching: false, context: () => '', custom: {} };
    chat.apps = [];
    chat.agent = false;
    return chat.persona(text).split('\n');
  };
  const ru = build('en', 'Привет, расскажи что-нибудь');
  assert.match(ru.at(-1), /^Ещё раз: весь ответ по-русски/);
  assert.match(ru.at(-2), /^Помни: суть первой фразой/);
  assert.ok(ru.some((l) => /Вопросов почти нет/.test(l)));
  const en = build('ru', 'tell me something about yourself');
  assert.match(en.at(-1), /^Once more: the whole answer in English/);
  assert.ok(en.some((l) => /Almost no questions/.test(l)));
  assert.ok(!en.some((l) => /Вопросов почти нет/.test(l)));
});

test('a "sure!" at the start and a stock question or sign-off at the end are taken off an answer', async () => {
  const { tidy } = await load('persona.js');
  assert.equal(tidy('Конечно! Это просто DNS. Чем ещё могу помочь?'), 'Это просто DNS.');
  assert.equal(tidy('Сижу в углу экрана, считаю пиксели. А ты как?'), 'Сижу в углу экрана, считаю пиксели.');
  assert.equal(tidy('Фигово, да. Я тут. Хочешь поговорить об этом?'), 'Фигово, да. Я тут.');
  assert.equal(tidy('Отличный вопрос! Берёшь pipe и всё. Что у тебя на уме?'), 'Берёшь pipe и всё.');
  assert.equal(tidy('Sure! I am fine, mostly. How about you?'), 'I am fine, mostly.');
  assert.equal(tidy('Great question, it is a phone book. What else is on your mind?'), 'It is a phone book.');
  assert.equal(tidy('Use the pipe, it is quicker. Let me know if you need anything else.'), 'Use the pipe, it is quicker.');
  assert.equal(tidy('Бери второй вариант. Дай знать, если что-то не получится.'), 'Бери второй вариант.');
  assert.equal(tidy('[[mood: happy]] Конечно, да, рада. Правда рада.'), '[[mood: happy]] Да, рада. Правда рада.', 'her tag stays in front');
});

test('what is a real question, or all there is, stays', async () => {
  const { tidy } = await load('persona.js');
  assert.equal(tidy('Какой из двух? Тот, что слева?'), 'Какой из двух? Тот, что слева?');
  assert.equal(tidy('А ты как?'), 'А ты как?', 'an answer is never emptied');
  assert.equal(tidy('Конечно.'), 'Конечно.');
  assert.equal(tidy('Хочешь, найду это в браузере? Скажи только слово.'), 'Хочешь, найду это в браузере? Скажи только слово.');
  assert.equal(tidy('Закрыть Spotify, или пусть играет?'), 'Закрыть Spotify, или пусть играет?', 'a question about the thing in hand');
  assert.equal(tidy(''), '');
  assert.equal(tidy('Привет, чумба.'), 'Привет, чумба.');
});

test('while the answer comes in, an opening "sure!" is not shown, not even for a moment', async () => {
  const { unopened } = await load('persona.js');
  assert.equal(unopened('Конечно! Д', { coming: true }), '', 'not more than the opening yet: nothing');
  assert.equal(unopened('Конечно! Это просто', { coming: true }), 'Это просто');
  assert.equal(unopened('Конечно, ', { coming: true }), '');
  assert.equal(unopened('Конечно!', { coming: false }), 'Конечно!', 'the whole answer that is only that stays');
  assert.equal(unopened('Хорошо, что зашёл.', { coming: true }), 'Хорошо, что зашёл.', 'not every "хорошо" is an opening');
  assert.equal(unopened('Sure, here it is: use the pipe.', { coming: true }), 'Here it is: use the pipe.');
});

test('her answer on screen and in her memory is the tidied one', async () => {
  const { Chat } = await load('chat.js');
  const shown = [];
  const quiet = new Proxy(function noop() {}, { get: (_, key) => (key === 'then' ? undefined : quiet), apply: () => quiet });
  const chat = new Chat({
    capri: quiet,
    panel: { setChatBusy() {}, setActions() {}, chatTurn() {}, setFace() {}, stream: (t) => shown.push(t), say() {}, hide() {}, setTicker() {} },
    voice: quiet,
    host: { onChatDelta() {}, chatRemember() {}, chatSend: async () => ({ ok: true, text: '[[mood: calm]] Конечно! Это телефонная книга интернета. Чем ещё могу помочь?' }) },
    brain: { lang: 'ru', assistant: 'claude', watching: false, context: () => '', custom: {}, t: { chat: {} } },
  });
  chat.open = true;
  chat.agent = false;
  chat.apps = [];
  chat.asked = () => null;
  chat.listApps = () => {};
  chat.after = () => null;
  await chat.send('Что такое DNS?');
  assert.equal(shown.at(-1), 'Это телефонная книга интернета.');
  assert.equal(chat.history.at(-1).content, 'Это телефонная книга интернета.');
});
