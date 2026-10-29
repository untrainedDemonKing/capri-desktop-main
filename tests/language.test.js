'use strict';

// She answers, and reads her answer, in the language you speak to her in (tongue.js, chat.js, speech.js), whatever her
// menus are set to: a small model drifts into the English of her prompt and of her earlier answers otherwise.
//   node --test tests/language.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', name)).href);

test('which language a text is in: the one most of its words are in, her menus\' when it cannot tell', async () => {
  const { languageOf } = await load('tongue.js');
  assert.equal(languageOf('Привет, как дела?', 'en'), 'ru');
  assert.equal(languageOf('hello, how are you today', 'ru'), 'en');
  assert.equal(languageOf('открой Spotify', 'en'), 'ru', 'a Russian with one English word in it is still speaking Russian');
  assert.equal(languageOf('Привет, чумба! Что нового, nova?', 'en'), 'ru', 'her Night City slang in Latin letters changes nothing');
  assert.equal(languageOf('Hey choom, привет', 'ru'), 'en', 'more English words than Russian ones');
  assert.equal(languageOf('ok', 'ru'), 'ru', 'one word of Latin letters says nothing: the menus decide');
  assert.equal(languageOf('hi', 'en'), 'en');
  assert.equal(languageOf('Spotify', 'ru'), 'ru');
  assert.equal(languageOf('', 'ru'), 'ru');
  assert.equal(languageOf('   ... 123 !!', 'en'), 'en', 'no letters');
  assert.equal(languageOf('[[music: synthwave]] https://youtube.com/watch?v=abc', 'ru'), 'ru', 'her tags and links are no language');
  assert.equal(languageOf('Look at https://example.com/привет now', 'ru'), 'en', '(the link does not count, the two words do)');
  assert.equal(languageOf(undefined, 'en'), 'en');
});

function chatWith(lang, host = {}) {
  return import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'chat.js')).href).then(({ Chat }) => {
    const quiet = new Proxy(function noop() {}, { get: (_, key) => (key === 'then' ? undefined : quiet), apply: () => quiet });
    const sent = [];
    const chat = new Chat({
      capri: quiet,
      panel: quiet,
      voice: quiet,
      host: { onChatDelta() {}, chatRemember() {}, chatSend: async (req) => { sent.push(req); return { ok: true, text: 'Ответ.' }; }, ...host },
      brain: { lang, assistant: 'claude', watching: false, context: () => '', custom: {}, t: { chat: {} } },
    });
    chat.open = true;
    chat.agent = false;
    chat.apps = [];
    chat.asked = () => null;
    chat.listApps = () => {};
    chat.after = () => null;
    return { chat, sent };
  });
}

test('her prompt names the language of your message first and last, not the one of her menus', async () => {
  const { chat } = await chatWith('en');
  const ru = chat.persona('Привет, как дела?');
  assert.match(ru.split('\n')[0], /^ЯЗЫК: отвечай только по-русски/);
  assert.match(ru.split('\n').at(-1), /^Ещё раз: весь ответ по-русски/);
  const en = chat.persona('hello, how are you today');
  assert.match(en.split('\n')[0], /^Language: answer in English only/);
  assert.match(en.split('\n').at(-1), /^Once more: the whole answer in English/);

  const menusRu = (await chatWith('ru')).chat;
  assert.match(menusRu.persona('hello, how are you today').split('\n')[0], /^Language: answer in English only/, 'you write English to a Russian menu: English back');
  assert.match(menusRu.persona('ok').split('\n')[0], /^ЯЗЫК:/, 'too short to tell: the menus\' language');
  assert.match(menusRu.persona().split('\n')[0], /^ЯЗЫК:/);
});

test('the note on your message sits where the model writes, and stays out of what she remembers', async () => {
  const { chat, sent } = await chatWith('en');
  chat.history = [{ role: 'user', content: 'hello there my friend' }, { role: 'assistant', content: 'Hey, choom. Good to see you.' }];
  await chat.send('Привет, как дела?');
  const messages = sent[0].messages;
  assert.equal(messages[0].role, 'system');
  const last = messages.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content, 'Привет, как дела?\n\n[Ответь по-русски.]');
  assert.equal(messages.at(-3).content, 'hello there my friend', 'earlier messages are as they were');
  assert.equal(chat.history.find((m) => m.content.includes('Привет, как дела?')).content, 'Привет, как дела?', 'her memory of the talk has no note in it');
  assert.ok(chat.history.every((m) => !/Ответь по-русски/.test(m.content)));

  const english = await chatWith('ru');
  await english.chat.send('what is the weather like today');
  assert.equal(english.sent[0].messages.at(-1).content, 'what is the weather like today\n\n[Reply in English.]');
});

test('a note a model repeats at the start of its answer is not shown', async () => {
  const { clean } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'chat.js')).href);
  assert.equal(clean('[Ответь по-русски.] Привет, чумба.'), 'Привет, чумба.');
  assert.equal(clean('[Reply in English.]\nHey, choom.'), 'Hey, choom.');
  assert.equal(clean('Привет [Ответь по-русски.]'), 'Привет [Ответь по-русски.]', '(only at the start)');
});

test('she tells the model which language to answer in, and what room that takes', async () => {
  const { chat, sent } = await chatWith('en');
  await chat.send('Привет, как дела?');
  assert.equal(sent[0].lang, 'ru', 'main.js sizes the answer by it (Russian takes twice the room)');
  const english = await chatWith('ru');
  await english.chat.send('what is the weather like today');
  assert.equal(english.sent[0].lang, 'en');
});

test('an English answer to Russian words is said again in Russian, with her tags kept; the first one is never shown', async () => {
  const shown = [];
  const calls = [];
  let deltas = () => {};
  const { chat, sent } = await chatWith('ru', {
    onChatDelta: (fn) => { deltas = fn; },
    chatSend: async (req) => {
      calls.push(req);
      if (calls.length > 1) return { ok: true, text: 'Чумба, у меня всё отлично, спасибо, что спросил!' };
      // (it comes in pieces, as it does from the model)
      for (const text of ['[[mood: happy]] Hey choom, ', 'I am doing great, ', 'thanks for asking! ', '[[music: synthwave]]']) deltas({ id: req.id, text });
      return { ok: true, text: '[[mood: happy]] Hey choom, I am doing great, thanks for asking! [[music: synthwave]]' };
    },
  });
  chat.panel = { setChatBusy() {}, setActions() {}, chatTurn() {}, setFace() {}, stream: (text) => shown.push(text), say() {}, hide() {}, setTicker() {} };
  await chat.send('Привет, как дела?');
  assert.equal(calls.length, 2, 'one more go, in Russian');
  assert.match(calls[1].messages[0].content, /Переведи сообщение на русский/);
  assert.equal(calls[1].messages[1].content, 'Hey choom, I am doing great, thanks for asking!', 'her tags are not given to the translation');
  assert.equal(calls[1].lang, 'ru');
  assert.deepEqual(shown, ['Чумба, у меня всё отлично, спасибо, что спросил!'], 'only the Russian one is shown (the English one is held back)');
  const kept = chat.history.at(-1).content;
  assert.match(kept, /^Чумба/);
  void sent;
});

test('a Russian answer that starts with a word of her slang shows from its first Russian word, and a short English one at the end', async () => {
  const shown = [];
  let deltas = () => {};
  let said = 'Choom, привет! Рада тебя видеть.';
  const { chat } = await chatWith('ru', {
    onChatDelta: (fn) => { deltas = fn; },
    chatSend: async (req) => {
      for (const text of said.match(/\S+\s*/g)) deltas({ id: req.id, text });
      return { ok: true, text: said };
    },
  });
  chat.panel = { setChatBusy() {}, setActions() {}, chatTurn() {}, setFace() {}, stream: (text) => shown.push(text), say() {}, hide() {}, setTicker() {} };
  await chat.send('Привет, как дела?');
  assert.equal(shown[0], 'Choom, привет!', 'nothing before the first Russian word, then everything so far');
  shown.length = 0;
  said = 'Choom!';
  await chat.send('Привет, как дела?');
  assert.deepEqual(shown, ['Choom!'], 'two words are no answer in another language: shown when it is whole');
});

test('a Russian answer, an English one you asked for, and an agent are left as they are', async () => {
  const run = async (lang, said, asked, agent = false) => {
    const calls = [];
    const { chat } = await chatWith(lang, { chatSend: async (req) => { calls.push(req); return { ok: true, text: said }; } });
    chat.agent = agent;
    await chat.send(asked);
    return calls.length;
  };
  assert.equal(await run('ru', 'Всё отлично, чумба, а у тебя?', 'Привет, как дела?'), 1);
  assert.equal(await run('ru', 'Hello! It is pronounced like this.', 'Как по-английски сказать «привет»?'), 1, 'you asked for English');
  assert.equal(await run('ru', 'Sure, here is the translation of that text.', 'Переведи это на английский'), 1);
  assert.equal(await run('ru', 'Hey choom, doing great, thanks.', 'Привет, как дела?', true), 1, 'Claude Code answers as it does');
  assert.equal(await run('en', 'Hey choom, doing great, thanks.', 'hello how are you today'), 1);
  assert.equal(await run('ru', 'Ок.', 'Привет, как дела?'), 1, 'too short to tell');
});

test('her answer is read in the language it is written in', async () => {
  const { Speech } = await load('speech.js');
  const asked = [];
  const speech = new Speech({ voice: { speaking: false }, host: { ttsSpeak: async (req) => { asked.push(req); return { ok: false, error: 'x' }; } } });
  speech.engine = 'chatterbox';
  speech.lang = 'ru';
  speech.current = {};
  await speech.cloud('Hey choom, it is good to see you again.', 'calm', speech.current);
  await speech.cloud('Привет, чумба, рада тебя видеть.', 'calm', speech.current);
  speech.lang = 'en';
  await speech.cloud('Привет, чумба, рада тебя видеть.', 'calm', speech.current);
  await speech.cloud('Ok', 'calm', speech.current);
  assert.deepEqual(asked.map((a) => a.lang), ['en', 'ru', 'ru', 'en'], 'by the words, and the menus\' language when it is too short to tell');
});
