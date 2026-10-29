'use strict';

// Her hands on the mouse, the keys and the controls of a window (src/renderer/js/hands/hands-parse.js reads what you ask, hands.js does it through
// the host, src/main/system/control.js builds the scripts for Windows). The scripts themselves cannot run here (they are for Windows): what is
// tested is what is asked, what goes into them, and what never does.
//   node --test tests/renderer/hands-act.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { mainFile, rendererFile } = require('../helpers/source');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const control = require('../../src/main/system/control.js');
const load = (file) => import(pathToFileURL(rendererFile(file)).href);

test('the mouse is asked for plainly: where to, a click (right, double), the wheel', async () => {
  const { parseAct } = await load('hands-parse.js');
  const move = (target) => ({ kind: 'mouse', op: 'move', target });
  assert.deepEqual(parseAct('подвинь мышку в центр'), move('center'));
  assert.deepEqual(parseAct('передвинь курсор в левый верхний угол'), move('topleft'));
  assert.deepEqual(parseAct('Капри, наведи мышку в правый нижний угол пожалуйста'), move('bottomright'));
  assert.deepEqual(parseAct('move the mouse to the center'), move('center'));
  assert.deepEqual(parseAct('подвинь мышь в точку 500 300'), move({ x: 500, y: 300 }));
  assert.deepEqual(parseAct('подвинь мышку вверх'), move('top'));
  assert.deepEqual(parseAct('кликни'), { kind: 'mouse', op: 'click', button: 'left', double: false });
  assert.deepEqual(parseAct('щёлкни мышкой'), { kind: 'mouse', op: 'click', button: 'left', double: false });
  assert.deepEqual(parseAct('правый клик'), { kind: 'mouse', op: 'click', button: 'right', double: false });
  assert.deepEqual(parseAct('кликни правой кнопкой мыши'), { kind: 'mouse', op: 'click', button: 'right', double: false });
  assert.deepEqual(parseAct('двойной клик'), { kind: 'mouse', op: 'click', button: 'left', double: true });
  assert.deepEqual(parseAct('double click'), { kind: 'mouse', op: 'click', button: 'left', double: true });
  assert.deepEqual(parseAct('прокрути вниз'), { kind: 'mouse', op: 'scroll', clicks: -5 });
  assert.deepEqual(parseAct('прокрути вверх на 3'), { kind: 'mouse', op: 'scroll', clicks: 3 });
  assert.deepEqual(parseAct('scroll down 10'), { kind: 'mouse', op: 'scroll', clicks: -10 });
  assert.deepEqual(parseAct('пролистай вниз на 50'), { kind: 'mouse', op: 'scroll', clicks: -30 }, 'not more than thirty');
});

test('a control of a window is asked for by its name in quotes (or after "кнопку"), in a window named in a few words', async () => {
  const { parseAct } = await load('hands-parse.js');
  const press = (window, name) => ({ kind: 'element', action: 'press', window, name });
  assert.deepEqual(parseAct('нажми «Сохранить» в блокноте'), press('notepad', 'Сохранить'));
  assert.deepEqual(parseAct('нажми кнопку ОК в калькуляторе'), press('calc', 'ОК'));
  assert.deepEqual(parseAct('кликни на «Файл» в notepad'), press('notepad', 'Файл'));
  assert.deepEqual(parseAct('нажми кнопку Отправить в хроме'), press('chrome', 'Отправить'));
  assert.deepEqual(parseAct('press "Save" in notepad'), press('notepad', 'Save'));
  assert.deepEqual(parseAct('нажми на кнопку «Далее»'), press('', 'Далее'), 'no window said: she asks');
  assert.deepEqual(parseAct('наведи мышку на «Файл» в блокноте'), { kind: 'element', action: 'move', window: 'notepad', name: 'Файл' });
});

test('keys: a combination, in the window you name (Russian keys by place on the keyboard, "контрол с" is Ctrl+C)', async () => {
  const { parseAct, parseCombo, sayCombo } = await load('hands-parse.js');
  const keys = (window, mods, key) => ({ kind: 'keys', window, mods, key });
  assert.deepEqual(parseAct('нажми ctrl+s в блокноте'), keys('notepad', ['ctrl'], 's'));
  assert.deepEqual(parseAct('нажми ctrl shift s в блокноте'), keys('notepad', ['ctrl', 'shift'], 's'));
  assert.deepEqual(parseAct('нажми enter в хроме'), keys('chrome', [], 'enter'));
  assert.deepEqual(parseAct('нажми контрол с в блокноте'), keys('notepad', ['ctrl'], 'c'));
  assert.deepEqual(parseAct('нажми f5 в хроме'), keys('chrome', [], 'f5'));
  assert.deepEqual(parseAct('нажми стрелка вниз в блокноте'), keys('notepad', [], 'down'));
  assert.deepEqual(parseAct('press ctrl+c in notepad'), keys('notepad', ['ctrl'], 'c'));
  assert.deepEqual(parseAct('нажми ctrl+s'), keys('', ['ctrl'], 's'));
  assert.equal(parseCombo('ctrl+alt+shift+a+b'), null, 'one key to a combination');
  assert.equal(parseCombo('что-нибудь'), null);
  assert.equal(parseCombo(''), null);
  assert.equal(sayCombo({ mods: ['ctrl', 'shift'], key: 's' }), 'Ctrl+Shift+S');
  assert.equal(sayCombo({ mods: [], key: 'down' }), '↓');
});

test('text into a window; a message to a messenger has its own way (the chat, your yes)', async () => {
  const { parseAct } = await load('hands-parse.js');
  const type = (window, text) => ({ kind: 'type', window, text });
  assert.deepEqual(parseAct('напиши в блокноте: привет мир'), type('notepad', 'привет мир'));
  assert.deepEqual(parseAct('напиши в блокноте привет мир'), type('notepad', 'привет мир'));
  assert.deepEqual(parseAct('type in notepad: hello world'), type('notepad', 'hello world'));
  assert.equal(parseAct('напиши в блокноте: привет', { type: false }), null, 'typing is off');
  const { Hands } = await load('hands.js');
  const h = new Hands({ host: {}, capri: {}, panel: {}, voice: {}, brain: { lang: 'ru' } });
  h.configure({ hands: true });
  assert.equal(h.parse('напиши в телеграме Паша: привет').kind, 'message', 'a messenger: a message');
  assert.equal(h.parse('напиши в телеграме привет'), null, 'and never typed into it blind');
});

test('what is no request is none: no verb first, no name, a word that only sounds like one', async () => {
  const { parseAct } = await load('hands-parse.js');
  for (const text of ['нажми кнопку', 'нажми на меня', 'нажми', 'привет как дела', 'кликнуть бы куда-нибудь', 'вчера я нажал не туда', 'мышка сломалась', 'подвинь стул', 'прокрути это в голове', '']) {
    assert.equal(parseAct(text), null, text);
  }
});

test('names of windows: a program by its Russian name, a word of a title without its ending', async () => {
  const { windowName } = await load('hands-parse.js');
  assert.equal(windowName('блокноте'), 'notepad');
  assert.equal(windowName('окне Блокнот'), 'notepad');
  assert.equal(windowName('в хроме'), 'chrome');
  assert.equal(windowName('Telegram'), 'telegram');
  assert.equal(windowName('VS Code'), 'code');
  assert.equal(windowName('калькуляторе'), 'calc');
  assert.equal(windowName('Безымянный — Блокнот'), 'Безымянный — Блокнот', 'a title is left as it is');
  assert.equal(windowName('плеере'), 'плеер');
  assert.equal(windowName(''), '');
});

test('what her AI tags is read, and a tag for a combination she never presses is still read (control.js refuses it)', async () => {
  const { parseActTag } = await load('hands-parse.js');
  assert.deepEqual(parseActTag('Сейчас. [[click: Блокнот | Сохранить]]'), { kind: 'element', action: 'press', window: 'notepad', name: 'Сохранить' });
  assert.deepEqual(parseActTag('[[keys: notepad | ctrl+s]]'), { kind: 'keys', window: 'notepad', mods: ['ctrl'], key: 's' });
  assert.deepEqual(parseActTag('[[type: блокнот | привет | мир]]'), { kind: 'type', window: 'notepad', text: 'привет | мир' });
  assert.deepEqual(parseActTag('[[mouse: move | center]]'), { kind: 'mouse', op: 'move', target: 'center' });
  assert.deepEqual(parseActTag('[[mouse: click]]'), { kind: 'mouse', op: 'click', button: 'left', double: false });
  assert.deepEqual(parseActTag('[[mouse: rightclick]]'), { kind: 'mouse', op: 'click', button: 'right', double: false });
  assert.deepEqual(parseActTag('[[mouse: scroll | down 5]]'), { kind: 'mouse', op: 'scroll', clicks: -5 });
  assert.equal(parseActTag('[[mouse: move | nowhere]]'), null);
  assert.equal(parseActTag('[[type: x | y]]', { type: false }), null);
  assert.equal(parseActTag('[[click: Блокнот]]'), null);
  assert.equal(parseActTag('[[open: Spotify]]'), null);
});

// ---- control.js: what goes into the scripts ----

function stand() {
  const scripts = [];
  const real = control.runner.run;
  control.runner.run = async (script, timeout, opts = {}) => { scripts.push({ script, timeout, opts }); return 'ok'; };
  return { scripts, restore: () => { control.runner.run = real; } };
}

test('key combinations are built from a list of keys, and the ones she never presses are refused', () => {
  assert.equal(control.keysString({ mods: ['ctrl', 'shift'], key: 'S' }), '^+s');
  assert.equal(control.keysString({ mods: [], key: 'enter' }), '{ENTER}');
  assert.equal(control.keysString({ mods: ['alt'], key: 'f5' }), '%{F5}');
  assert.equal(control.keysString({ mods: ['ctrl'], key: 'pagedown' }), '^{PGDN}');
  assert.equal(control.keysString({ mods: ['ctrl'], key: 'space' }), '^ ');
  assert.throws(() => control.keysString({ mods: ['alt'], key: 'f4' }), (e) => e.code === 'denied', 'Alt+F4 closes windows: that is her closing flow, with a button');
  assert.throws(() => control.keysString({ mods: ['ctrl', 'shift'], key: 'esc' }), (e) => e.code === 'denied');
  for (const bad of [{ mods: ['win'], key: 'd' }, { mods: [], key: 'ab' }, { mods: [], key: '{ENTER}' }, { mods: [], key: '+' }, { mods: [], key: '%' }, { mods: [], key: '' }, { mods: 'ctrl', key: 's' }]) {
    assert.throws(() => control.keysString(bad), Error, JSON.stringify(bad));
  }
});

test('the mouse: a name from the list or two whole numbers go in as numbers; nothing else can', async () => {
  const s = stand();
  try {
    await control.moveMouse('center');
    assert.match(s.scripts[0].script, /\$x = \[int\]\(\$w \* 0\.5\); \$y = \[int\]\(\$h \* 0\.5\)/);
    assert.equal(s.scripts[0].opts.mouse, true, 'with the mouse helper');
    await control.moveMouse({ x: 500, y: 300 });
    assert.match(s.scripts[1].script, /\$x = 500; \$y = 300/);
    for (const bad of ['nowhere', '__proto__', 'center; calc', { x: '5; calc', y: 1 }, { x: 1.5, y: 2 }, { x: 1e9, y: 1 }, null, undefined, 7]) {
      await assert.rejects(control.moveMouse(bad), Error, JSON.stringify(bad));
    }
    assert.equal(s.scripts.length, 2, 'nothing was run for those');
    // the screen's edges are respected in the script
    assert.match(s.scripts[0].script, /\[Math\]::Min\(\$w - 1, \$x\)/);
    assert.match(s.scripts[0].script, /CapriMouse\]::Move/);
  } finally {
    s.restore();
  }
});

test('a click, the wheel: only the buttons she knows, and a few clicks of the wheel', async () => {
  const s = stand();
  try {
    await control.clickMouse({ button: 'right', double: true });
    assert.match(s.scripts[0].script, /Click\(\$true, \$true\)/);
    await control.clickMouse({});
    assert.match(s.scripts[1].script, /Click\(\$false, \$false\)/);
    await control.scrollMouse(-5);
    assert.match(s.scripts[2].script, /Wheel\(-5\)/);
    for (const bad of [{ button: 'middle' }, { button: '$true); calc; (' }]) await assert.rejects(control.clickMouse(bad), Error);
    for (const bad of [0, 31, -31, 1.5, '5); calc', NaN, null]) await assert.rejects(control.scrollMouse(bad), Error, String(bad));
    assert.equal(s.scripts.length, 3);
  } finally {
    s.restore();
  }
});

test('a control of a window: the names go in as base64 data, never as code; "press" presses it, "move" only moves the pointer', async () => {
  const s = stand();
  try {
    const name = '"; Remove-Item C:\\ -Recurse; "';
    await control.elementAction({ action: 'press', window: 'notepad', name });
    const script = s.scripts[0].script;
    assert.ok(!script.includes('Remove-Item'), 'what you said is not in the script as text');
    assert.ok(script.includes(Buffer.from(name).toString('base64')) && script.includes(Buffer.from('notepad').toString('base64')));
    assert.match(script, /UIAutomationClient/);
    assert.match(script, /InvokePattern/);
    assert.match(script, /throw 'noelement'/);
    assert.match(script, /throw 'interrupted'/, 'she stops when you take the mouse');
    await control.elementAction({ action: 'move', window: 'notepad', name: 'Файл' });
    assert.ok(!s.scripts[1].script.includes('InvokePattern'), 'move does not press');
    for (const bad of [{ action: 'delete', window: 'a', name: 'b' }, { action: 'press', window: '', name: 'b' }, { action: 'press', window: 'a', name: '' }, {}]) {
      await assert.rejects(control.elementAction(bad), Error, JSON.stringify(bad));
    }
    assert.equal(s.scripts.length, 2);
  } finally {
    s.restore();
  }
});

test('keys go to a window that is in front, built from the list; text is not typed into her scripts as code', async () => {
  const s = stand();
  try {
    await control.pressKeys({ window: 'notepad', mods: ['ctrl'], key: 's' });
    const script = s.scripts[0].script;
    assert.ok(script.includes(Buffer.from('^s').toString('base64')), 'the keys, as data');
    assert.match(script, /Keys \$h \(Txt '/);
    assert.match(script, /throw 'nowindow'/);
    await assert.rejects(control.pressKeys({ window: 'notepad', mods: ['alt'], key: 'f4' }), (e) => e.code === 'denied');
    await assert.rejects(control.pressKeys({ window: '', mods: [], key: 'a' }), Error);
    assert.equal(s.scripts.length, 1);
  } finally {
    s.restore();
  }
});

test('the mouse helper is its own script, with the pointer eased and given up when you take hold of it', () => {
  const src = require('node:fs').readFileSync(mainFile('control.js'), 'utf8');
  assert.match(src, /SetProcessDPIAware/, 'the screen\'s own pixels');
  assert.match(src, /return "interrupted"/);
  assert.match(src, /\$\{mouse \? MOUSE_HELPER : ''\}/, 'only for a script that asks for it');
  assert.doesNotMatch(src.slice(src.indexOf('const HELPER = String.raw'), src.indexOf('const MOUSE_HELPER')), /CapriMouse/, 'the windows helper is untouched');
});

// ---- hands.js: what she does, and says ----

async function hands(host) {
  const { Hands } = await load('hands.js');
  const zaps = [];
  const h = new Hands({ host, capri: { head: () => ({ x: 1, y: 2 }), towardCenter: () => 1, zap: (...a) => zaps.push(a), react() {} }, panel: {}, voice: {}, brain: { lang: 'ru' } });
  h.configure({ hands: true });
  return { h, zaps };
}

test('she does what is asked and says what she did; a stop by you, a missing control or window, a refused combination are said plainly', async () => {
  const calls = [];
  const answers = { moveMouse: 'ok', clickMouse: true, scrollMouse: true, elementAction: 'Сохранить', pressKeys: true, typeInto: true };
  const host = {};
  for (const name of Object.keys(answers)) host[name] = async (...a) => { calls.push([name, ...a]); return typeof answers[name] === 'function' ? answers[name]() : answers[name]; };
  const { h, zaps } = await hands(host);
  const say = async (text) => (await h.op(h.parse(text))).line;
  assert.equal(await say('подвинь мышку в центр'), 'Подвинула мышку в центр экрана.');
  assert.deepEqual(calls.at(-1), ['moveMouse', 'center']);
  assert.equal(await say('двойной клик'), 'Дважды кликнула.');
  assert.deepEqual(calls.at(-1), ['clickMouse', { button: 'left', double: true }]);
  assert.equal(await say('прокрути вниз на 3'), 'Прокрутила вниз.');
  assert.deepEqual(calls.at(-1), ['scrollMouse', -3]);
  assert.equal(await say('нажми «Сохранить» в блокноте'), 'Нажала «Сохранить» в «notepad».');
  assert.deepEqual(calls.at(-1), ['elementAction', { action: 'press', window: 'notepad', name: 'Сохранить' }]);
  assert.equal(await say('нажми ctrl+s в блокноте'), 'Нажала Ctrl+S в «notepad».');
  assert.deepEqual(calls.at(-1), ['pressKeys', { window: 'notepad', mods: ['ctrl'], key: 's' }]);
  assert.equal(await say('напиши в блокноте: привет'), 'Напечатала в «notepad».');
  assert.deepEqual(calls.at(-1), ['typeInto', 'привет', 'notepad']);
  assert.ok(zaps.length >= 6, 'a bolt off her fingers each time');
  // she needs a window
  const before = calls.length;
  assert.equal(await say('нажми ctrl+s'), 'В каком окне? Назови программу.');
  assert.equal(calls.length, before, 'and nothing is pressed');
  // you took the mouse
  answers.moveMouse = 'interrupted';
  assert.equal(await say('подвинь мышку в центр'), 'Ты взял мышку — я остановилась.');
  // what the PC says no to
  const err = (code, message = '') => async () => ({ error: { code, message } });
  host.elementAction = err('noelement');
  assert.equal(await say('нажми «Сохранить» в блокноте'), 'В «notepad» не вижу «Сохранить».');
  host.pressKeys = err('denied');
  assert.equal(await say('нажми alt+f4 в блокноте'), 'Это сочетание я не нажимаю.');
  host.clickMouse = err('off');
  assert.match(await say('кликни'), /Мышку мне не доверили/);
  host.scrollMouse = err('nowindow');
  assert.match(await say('прокрути вверх'), /Не нахожу окно/);
  host.typeInto = err('x', 'boom');
  assert.equal(await say('напиши в блокноте: привет'), 'Не вышло: boom');
});

test('the mouse has its own switch; typing has its own; windows and the rest stay as they were', async () => {
  const { Hands } = await load('hands.js');
  const make = (cfg) => { const h = new Hands({ host: {}, capri: {}, panel: {}, voice: {}, brain: { lang: 'en' } }); h.configure(cfg); return h; };
  const off = make({ hands: false });
  assert.equal(off.parse('кликни'), null, 'hands off: nothing');
  const noMouse = make({ hands: true, handsMouse: false });
  assert.equal(noMouse.parse('кликни'), null);
  assert.equal(noMouse.parse('нажми ctrl+s в блокноте'), null);
  assert.equal(noMouse.parse('нажми «Сохранить» в блокноте'), null);
  assert.equal(noMouse.parse('напиши в блокноте: привет').kind, 'type', 'typing is its own switch');
  assert.deepEqual(noMouse.parse('сверни окно хрома'), { kind: 'window', op: 'minimize', name: 'хрома' }, 'and windows too');
  const noType = make({ hands: true, handsType: false });
  assert.equal(noType.parse('напиши в блокноте: привет'), null);
  assert.equal(noType.parse('кликни').kind, 'mouse');
  assert.doesNotMatch(noMouse.powers().join('\n'), /mouse pointer/);
  assert.match(make({ hands: true }).powers().join('\n'), /\[\[click: WINDOW \| BUTTON NAME\]\]/);
  assert.doesNotMatch(noType.powers().join('\n'), /\[\[type:/);
});

test('a window she is told by its Russian name is looked for by the real one', async () => {
  const seen = [];
  const { h } = await hands({ windowOp: async (op, name) => { seen.push([op, name]); return 1; } });
  await h.op(h.parse('сверни окно хрома'));
  await h.op({ kind: 'window', op: 'focus', name: 'блокнот' });
  assert.deepEqual(seen, [['minimize', 'chrome'], ['focus', 'notepad']]);
});

// ---- from her chat ----

async function chatWith(hostExtra = {}, text = 'Сейчас. [[click: Блокнот | Сохранить]]') {
  const { Chat } = await load('chat.js');
  const { Hands } = await load('hands.js');
  const { linesFor } = await load('lines.js');
  const quiet = new Proxy(function noop() {}, { get: (_, key) => (key === 'then' ? undefined : quiet), apply: () => quiet });
  const lines = [];
  const actions = [];
  const done = [];
  const host = {
    onChatDelta() {}, chatRemember() {}, chatSend: async () => ({ ok: true, text }), findLaunch: async () => null,
    elementAction: async (r) => { done.push(['element', r]); return r.name; }, clickMouse: async (r) => { done.push(['click', r]); return true; },
    moveMouse: async (t) => { done.push(['move', t]); return 'ok'; }, pressKeys: async (r) => { done.push(['keys', r]); return true; }, typeInto: async (t, w) => { done.push(['type', t, w]); return true; },
    ...hostExtra,
  };
  const capri = { head: () => ({ x: 100, y: 200 }), towardCenter: () => 1, zap() {}, pulse() {}, react() {}, twitch() {} };
  const panel = { setChatBusy() {}, chatTurn() {}, setFace() {}, say() {}, hide() {}, setTicker() {}, stream: (t) => lines.push(t), setActions: (a, on) => actions.push({ a, on }) };
  const brain = { lang: 'ru', assistant: 'claude', watching: false, context: () => '', custom: {}, t: linesFor('ru', 'claude') };
  const chat = new Chat({ capri, panel, voice: quiet, host, brain });
  chat.hands = new Hands({ host, capri, panel, voice: quiet, brain });
  chat.hands.configure({ hands: true });
  chat.open = true;
  chat.agent = false;
  chat.apps = [];
  chat.listApps = () => {};
  return { chat, lines, actions, done, offered: () => actions.filter((x) => x.a.length) };
}

test('what you ask plainly is done at once; what her AI tags waits for a button that says what it will do', async () => {
  const a = await chatWith();
  await a.chat.send('нажми «Сохранить» в блокноте');
  assert.deepEqual(a.done, [['element', { action: 'press', window: 'notepad', name: 'Сохранить' }]], 'you said it yourself');
  assert.match(a.lines.at(-1), /Нажала «Сохранить»/);
  const b = await chatWith();
  await b.chat.send('нажми там сохранить');
  assert.deepEqual(b.done, [], 'the tag alone does nothing');
  assert.equal(b.offered().length, 1);
  assert.equal(b.offered()[0].a[0].label, 'Нажать «Сохранить» в «notepad»');
  await b.offered()[0].on('no');
  assert.deepEqual(b.done, []);
  await b.offered()[0].on('do');
  assert.deepEqual(b.done, [['element', { action: 'press', window: 'notepad', name: 'Сохранить' }]]);
  assert.match(b.lines.at(-1), /Нажала «Сохранить»/);
  // a tag in an answer to something that asked for nothing like it: ignored
  const c = await chatWith({}, 'Привет! [[mouse: click]]');
  await c.chat.send('как дела');
  assert.equal(c.offered().length, 0);
  assert.deepEqual(c.done, []);
});

test('the labels of the buttons say what will happen, for each kind', async () => {
  const { h } = await hands({});
  const label = (intent) => h.describe(intent);
  assert.equal(label({ kind: 'keys', window: 'notepad', mods: ['ctrl'], key: 's' }), 'Нажать Ctrl+S в «notepad»');
  assert.equal(label({ kind: 'type', window: 'notepad', text: 'привет мир' }), 'Напечатать в «notepad»: «привет мир»');
  assert.equal(label({ kind: 'type', window: 'notepad', text: 'очень длинный текст, который не поместится в кнопку' }), 'Напечатать в «notepad»: «очень длинный текст, ко…»');
  assert.equal(label({ kind: 'mouse', op: 'move', target: 'center' }), 'Подвинуть мышку в центр экрана');
  assert.equal(label({ kind: 'mouse', op: 'move', target: { x: 5, y: 6 } }), 'Подвинуть мышку в точку 5, 6');
  assert.equal(label({ kind: 'mouse', op: 'click', button: 'right', double: false }), 'Кликнуть правой');
  assert.equal(label({ kind: 'mouse', op: 'scroll', clicks: -5 }), 'Прокрутить вниз');
  assert.equal(label({ kind: 'element', action: 'move', window: 'notepad', name: 'Файл' }), 'Навести мышку на «Файл»');
});
