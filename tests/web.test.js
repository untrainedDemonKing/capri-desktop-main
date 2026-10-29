'use strict';

// Straight requests to the web (src/renderer/js/web.js reads them, src/main/web.js builds and opens them).
//   node --test tests/web.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const web = require('../src/main/web.js');
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

test('a request for a search is read: the engine you named, or Google when you said "the internet" or "загугли"', async () => {
  const { parseWeb } = await load('web.js');
  const s = (engine, query) => ({ kind: 'search', engine, query });
  assert.deepEqual(parseWeb('загугли рецепт борща'), s('google', 'рецепт борща'));
  assert.deepEqual(parseWeb('Капри, пожалуйста, загугли погоду на завтра!'), s('google', 'погоду на завтра'));
  assert.deepEqual(parseWeb('найди в гугле как заварить чай'), s('google', 'как заварить чай'));
  assert.deepEqual(parseWeb('найди в яндексе погоду'), s('yandex', 'погоду'));
  assert.deepEqual(parseWeb('поищи в интернете лучшие наушники'), s('google', 'лучшие наушники'));
  assert.deepEqual(parseWeb('в интернете найди рецепт'), s('google', 'рецепт'));
  assert.deepEqual(parseWeb('найди рецепт борща в гугле'), s('google', 'рецепт борща'));
  assert.deepEqual(parseWeb('найди рецепт борща в интернете'), s('google', 'рецепт борща'));
  assert.deepEqual(parseWeb('найди мне в гугле курс доллара'), s('google', 'курс доллара'));
  assert.deepEqual(parseWeb('найди на карте кафе рядом'), s('maps', 'кафе рядом'));
  assert.deepEqual(parseWeb('найди в википедии квантовую запутанность'), s('wikipedia', 'квантовую запутанность'));
  assert.deepEqual(parseWeb('найди на гитхабе electron builder'), s('github', 'electron builder'));
  assert.deepEqual(parseWeb('найди в картинках рыжего кота'), s('images', 'рыжего кота'));
  assert.deepEqual(parseWeb('google best synthwave albums'), s('google', 'best synthwave albums'));
  assert.deepEqual(parseWeb('search bing for cheap flights'), s('bing', 'cheap flights'));
  assert.deepEqual(parseWeb('search the web for cheap flights'), s('google', 'cheap flights'));
  assert.deepEqual(parseWeb('look up the weather on the web'), s('google', 'the weather'));
  assert.deepEqual(parseWeb('find on duckduckgo privacy tools'), s('duckduckgo', 'privacy tools'));
});

test('a request for a video is read: a verb of playing plays the first one, a verb of looking shows the results', async () => {
  const { parseWeb } = await load('web.js');
  const v = (query) => ({ kind: 'video', query });
  const s = (query) => ({ kind: 'search', engine: 'youtube', query });
  assert.deepEqual(parseWeb('включи видео про котов'), v('котов'));
  assert.deepEqual(parseWeb('покажи мне ролик, где кот падает'), v('кот падает'));
  assert.deepEqual(parseWeb('включи Дудя на ютубе'), v('Дудя'));
  assert.deepEqual(parseWeb('включи на ютубе Дудя'), v('Дудя'));
  assert.deepEqual(parseWeb('поставь песню Цой на ютубе'), v('песню Цой'));
  assert.deepEqual(parseWeb('запусти трейлер Дюны'), v('Дюны'));
  assert.deepEqual(parseWeb('открой ютуб и включи lofi'), v('lofi'));
  assert.deepEqual(parseWeb('play a video about black holes'), v('black holes'));
  assert.deepEqual(parseWeb('watch the trailer of dune on youtube'), v('dune'));
  assert.deepEqual(parseWeb('найди видео про космос'), s('космос'));
  assert.deepEqual(parseWeb('найди обзор айфона на ютубе'), s('обзор айфона'));
  assert.deepEqual(parseWeb('найди на ютубе обзор айфона'), s('обзор айфона'));
  assert.deepEqual(parseWeb('открой ютуб и найди котиков'), s('котиков'));
  assert.deepEqual(parseWeb('search youtube for lofi beats'), s('lofi beats'));
  assert.deepEqual(parseWeb('open the youtube and search for cats'), s('cats'));
});

test('a sentence that only has such a word somewhere in it, or asks for nothing, is no request', async () => {
  const { parseWeb } = await load('web.js');
  for (const text of [
    'включи музыку Bad Bunny', 'найди ошибку в коде', 'включи видео', 'открой ютуб', 'привет, как дела', 'что такое dns в википедии', 'find me a recipe',
    'я вчера хотел найти в гугле одну штуку, но забыл', 'ты можешь включить свет', 'покажи мне', '', 'найди', 'загугли',
  ]) assert.equal(parseWeb(text), null, text);
});

test('what her AI tags is read: a search (in an engine, or Google), a video; anything else is nothing', async () => {
  const { parseWebTag } = await load('web.js');
  assert.deepEqual(parseWebTag('Сейчас найду. [[search: google | как заварить чай]]'), { kind: 'search', engine: 'google', query: 'как заварить чай' });
  assert.deepEqual(parseWebTag('[[search: рецепт борща]]'), { kind: 'search', engine: 'google', query: 'рецепт борща' });
  assert.deepEqual(parseWebTag('[[search: yandex|погода]]'), { kind: 'search', engine: 'yandex', query: 'погода' });
  assert.deepEqual(parseWebTag('[[mood: happy]] Включаю. [[video: лучшие моменты матча]]'), { kind: 'video', query: 'лучшие моменты матча' });
  assert.equal(parseWebTag('[[search: ]]'), null);
  assert.equal(parseWebTag('[[open: Spotify]]'), null);
  assert.equal(parseWebTag(''), null);
});

test('the address of a search is built from your words, encoded; an engine she does not know, or nothing to look for, is no address', () => {
  assert.equal(web.searchUrl('google', 'рецепт борща'), 'https://www.google.com/search?q=%D1%80%D0%B5%D1%86%D0%B5%D0%BF%D1%82%20%D0%B1%D0%BE%D1%80%D1%89%D0%B0');
  assert.equal(web.searchUrl('yandex', 'погода'), 'https://yandex.ru/search/?text=%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B0');
  assert.equal(web.searchUrl('YouTube', 'lofi beats'), 'https://www.youtube.com/results?search_query=lofi%20beats');
  assert.equal(web.searchUrl('wikipedia', 'dns', 'ru'), 'https://ru.wikipedia.org/w/index.php?search=dns');
  assert.equal(web.searchUrl('wikipedia', 'dns', 'en'), 'https://en.wikipedia.org/w/index.php?search=dns');
  assert.equal(web.searchUrl('github', 'a&b=c'), 'https://github.com/search?q=a%26b%3Dc', 'what you said cannot add to the address');
  assert.equal(web.searchUrl('maps', 'кафе'), 'https://www.google.com/maps/search/%D0%BA%D0%B0%D1%84%D0%B5');
  assert.equal(web.searchUrl('nothing', 'x'), null);
  assert.equal(web.searchUrl('google', '   '), null);
  assert.equal(web.searchUrl('google', 'x'.repeat(1000)).length < 400, true, 'and not longer than a search is');
});

const PAGE = (id, title) => `...{"contents":[{"adSlotRenderer":{"x":1}},{"videoRenderer":{"videoId":"${id}","thumbnail":{},"title":{"runs":[{"text":"${title}"}],"accessibility":{}},"longBylineText":{}}}]}...`;

test('the first video of the results page is found, with its title; a page without one is none', () => {
  assert.deepEqual(web.firstVideo(PAGE('dQw4w9WgXcQ', 'Never Gonna Give You Up')), { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up' });
  assert.deepEqual(web.firstVideo(PAGE('abc-DEF_123', 'Кот \\"падает\\" \\u0026 встаёт')), { id: 'abc-DEF_123', title: 'Кот "падает" & встаёт' });
  assert.equal(web.firstVideo('<html>nothing</html>'), null);
  assert.equal(web.firstVideo('"videoRenderer":{"videoId":"short"}'), null, 'an id is eleven characters');
  assert.equal(web.firstVideo(undefined), null);
});

test('a video is the page of the first result; when the results cannot be had, the page of results is opened instead', async () => {
  const seen = [];
  const ok = async (url, init) => { seen.push({ url, headers: init.headers }); return { ok: true, text: async () => PAGE('dQw4w9WgXcQ', 'Never Gonna Give You Up') }; };
  assert.deepEqual(await web.videoUrl('never gonna give you up', { fetch: ok }), { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Never Gonna Give You Up', exact: true });
  assert.equal(seen[0].url, 'https://www.youtube.com/results?search_query=never%20gonna%20give%20you%20up');
  assert.match(seen[0].headers['user-agent'], /Mozilla/);
  const down = async () => { throw new Error('offline'); };
  assert.deepEqual(await web.videoUrl('котики', { fetch: down }), { url: 'https://www.youtube.com/results?search_query=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8', title: '', exact: false });
  const odd = async () => ({ ok: true, text: async () => '<html>consent page</html>' });
  assert.equal((await web.videoUrl('котики', { fetch: odd })).exact, false, 'a page that is not the results');
  const broken = async () => ({ ok: false, text: async () => '' });
  assert.equal((await web.videoUrl('котики', { fetch: broken })).exact, false);
  assert.equal(await web.videoUrl('  ', { fetch: ok }), null);
});

test('only an https address of the sites she builds is ever handed to the browser', async () => {
  const opened = [];
  const opener = async (u) => { opened.push(u); };
  assert.equal(await web.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', opener), true);
  assert.equal(await web.open('https://www.google.com/search?q=x', opener), true);
  for (const bad of ['http://www.google.com/search?q=x', 'https://evil.example/www.google.com/', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'https://www.google.com.evil.example/search', '', null]) {
    assert.equal(await web.open(bad, opener), false, String(bad));
  }
  assert.deepEqual(opened, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.google.com/search?q=x']);
});

// ---- in her chat ----

async function chatWith(host = {}, lang = 'ru') {
  const { Chat } = await load('chat.js');
  const quiet = new Proxy(function noop() {}, { get: (_, key) => (key === 'then' ? undefined : quiet), apply: () => quiet });
  const lines = [];
  const actions = [];
  const panel = {
    setChatBusy() {}, chatTurn() {}, setFace() {}, say() {}, hide() {}, setTicker() {},
    stream: (t) => lines.push(t),
    setActions: (a, on) => { actions.push({ a, on }); },
  };
  const calls = [];
  const capri = { head: () => ({ x: 100, y: 200 }), towardCenter: () => 1, zap() {}, pulse() {}, react() {}, twitch() {} };
  const chat = new Chat({
    capri, panel, voice: quiet,
    host: {
      onChatDelta() {}, chatRemember() {}, chatSend: async () => ({ ok: true, text: 'Ответ.' }),
      webSearch: async (engine, query) => { calls.push(['search', engine, query]); return true; },
      webVideo: async (query) => { calls.push(['video', query]); return { ok: true, title: 'Never Gonna Give You Up', exact: true }; },
      findLaunch: async () => null,
      ...host,
    },
    brain: { lang, assistant: 'claude', watching: false, context: () => '', custom: {}, t: { chat: {} } },
  });
  const { linesFor } = await load('lines.js');
  chat.brain.t = linesFor(lang, 'claude');
  chat.open = true;
  chat.agent = false;
  chat.apps = [];
  chat.listApps = () => {};
  return { chat, lines, actions, calls };
}

test('"загугли ..." in her chat opens the search at once, and says where', async () => {
  const { chat, lines, calls } = await chatWith();
  await chat.send('загугли рецепт борща');
  assert.deepEqual(calls, [['search', 'google', 'рецепт борща']]);
  assert.match(lines.at(-1), /Ищу «рецепт борща»: Google/);
});

test('"включи ... на ютубе": the first video is played and named; when none could be picked the results are opened and she says so', async () => {
  const a = await chatWith();
  await a.chat.send('включи Дудя на ютубе');
  assert.deepEqual(a.calls, [['video', 'Дудя']]);
  assert.match(a.lines.at(-1), /Включаю: Never Gonna Give You Up\./);
  const b = await chatWith({ webVideo: async () => ({ ok: true, title: '', exact: false }) });
  await b.chat.send('включи видео про котов');
  assert.match(b.lines.at(-1), /открыла результаты по «котов» на YouTube/);
  const c = await chatWith({ webSearch: async () => false });
  await c.chat.send('найди в яндексе погоду');
  assert.match(c.lines.at(-1), /Не получилось открыть браузер/);
});

test('English works the same, and a message that merely has "find" in it opens nothing', async () => {
  const a = await chatWith({}, 'en');
  await a.chat.send('search youtube for lofi beats');
  assert.deepEqual(a.calls, [['search', 'youtube', 'lofi beats']]);
  assert.match(a.lines.at(-1), /Looking for “lofi beats” on YouTube/);
  const b = await chatWith();
  await b.chat.send('найди ошибку в моём коде, пожалуйста');
  assert.deepEqual(b.calls, []);
});

test('what her AI tags waits behind a button that says what it will do, and only when you asked for something like it', async () => {
  const offered = (w) => w.actions.filter((x) => x.a.length); // (each message first clears the buttons of the last)
  const a = await chatWith({ chatSend: async () => ({ ok: true, text: '[[mood: calm]] Сейчас гляну. [[search: yandex | курс доллара]]' }) });
  await a.chat.send('узнай курс доллара');
  assert.deepEqual(a.calls, [], 'nothing opens by itself');
  assert.equal(offered(a).length, 1);
  assert.equal(offered(a)[0].a[0].label, 'Искать «курс доллара»: Яндекс');
  assert.equal(offered(a)[0].a[1].id, 'no');
  await offered(a)[0].on('go');
  assert.deepEqual(a.calls, [['search', 'yandex', 'курс доллара']]);
  // a "no" does nothing
  const b = await chatWith({ chatSend: async () => ({ ok: true, text: 'Хорошо. [[video: лучшие моменты матча]]' }) });
  await b.chat.send('покажи что-нибудь прикольное');
  assert.equal(offered(b)[0].a[0].label, 'Включить «лучшие моменты матча»');
  await offered(b)[0].on('no');
  assert.deepEqual(b.calls, []);
  // a tag in an answer to something else is ignored
  const c = await chatWith({ chatSend: async () => ({ ok: true, text: 'Привет! [[search: google | что угодно]]' }) });
  await c.chat.send('как дела');
  assert.equal(offered(c).length, 0);
  assert.deepEqual(c.calls, []);
});

test('her mind is told of the tags, and that they wait for a button', async () => {
  const { chat } = await chatWith();
  const text = chat.powers().join('\n');
  assert.match(text, /\[\[search: ENGINE \| WHAT TO LOOK FOR\]\]/);
  assert.match(text, /\[\[video: WHAT TO PLAY\]\]/);
  assert.match(text, /never say it is already open/);
});
