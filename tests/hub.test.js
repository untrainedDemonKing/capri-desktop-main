'use strict';

// Her main menu, the main-process side (src/main/hub.js): what it tells the page (the PC, the models with what is
// there and what is heavy, the services and which are connected), what a choice would fetch, what pressing the
// button writes to her config, trying a key, and what closing the window without choosing means.
//   node --test tests/hub.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createHub, CLOUD } = require('../src/main/hub.js');
const profiles = require('../src/main/profiles.js');
const hardware = require('../src/main/hardware.js');

const GB = 1024 ** 3;

class FakeWindow extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.destroyed = false; this.sent = []; this.webContents = { send: (c, p) => this.sent.push([c, p]) }; FakeWindow.last = this; }
  removeMenu() {}
  loadURL(url) { this.url = url; }
  show() { this.shown = true; }
  focus() {}
  isMinimized() { return false; }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.emit('closed'); }
}

function world({ hw = hardware.make({ ram: 15.9 * GB, cpu: { name: 'Intel i5', threads: 8 }, disk: { path: '', free: 200 * GB, total: 500 * GB } }), have = { ollama: false, models: [], chatterbox: false, piper: false }, cfg = {}, connect, cleanup, uninstall, mind } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = { handle: (c, fn) => handlers.set(c, fn), on: (c, fn) => listeners.set(c, fn) };
  const config = { value: { hubDone: false, provider: 'ollama', ttsEngine: 'system', voiceMode: 'off', apiKeys: {}, customUrl: '', ...cfg }, load() { return this.value; } };
  const updates = [];
  const updateConfig = (patch) => { updates.push(patch); Object.assign(config.value, patch); return config.value; };
  const prov = new EventEmitter();
  Object.assign(prov, {
    running: false, job: null, runs: 0, cancels: 0, previews: 0,
    preview: async () => { prov.previews++; return { hw, have, profile: profiles.plan(hw, { have }) }; },
    snapshot: () => ({ running: prov.running, steps: [], plan: {} }),
    run() { prov.runs++; return Promise.resolve(); },
    cancel() { prov.cancels++; },
    report: () => 'the report',
  });
  const opened = [];
  const clipboard = { text: '', writeText(t) { this.text = t; } };
  const hub = createHub({
    BrowserWindow: FakeWindow, ipcMain, shell: { openExternal: (u) => opened.push(u) }, clipboard, provision: prov, config, updateConfig,
    lang: () => 'ru',
    connect: connect || (async ({ provider, key }) => (key === 'bad' ? { ok: false, error: 'invalid x-api-key' } : { ok: true, model: 'm1', provider })),
    saveVoiceKey: ({ engine, key }) => { updateConfig({ ttsEngine: engine, apiKeys: { ...config.value.apiKeys, [engine]: `enc:${key}` } }); return { ok: true }; },
    keyPages: { groq: 'https://console.groq.com/keys', gemini: 'https://aistudio.google.com/apikey' },
    voiceKeyPages: { openai: 'https://platform.openai.com/api-keys' },
    cleanup, uninstall, mind,
    protocolUrl: 'capri://app/src/renderer/hub.html',
  });
  return { hub, handlers, listeners, config, updates, prov, opened, clipboard, call: (c, ...a) => handlers.get(c)({}, ...a), fire: (c, ...a) => listeners.get(c)({}, ...a) };
}

test('what the page is told: this PC, the models (what is there, what is heavy), the services, what is set now', async () => {
  const w = world({ have: { ollama: true, models: ['gemma3:4b', 'qwen2.5:7b'], chatterbox: false, piper: false }, cfg: { provider: 'groq', apiKeys: { groq: 'enc:x' }, chatModel: 'gemma3:4b' } });
  const s = await w.call('hub:state');
  assert.equal(s.lang, 'ru');
  assert.equal(s.first, true, 'nothing chosen yet');
  assert.equal(s.pc.ram, 15.9 * GB);
  assert.equal(s.recommended.id, 'standard');
  assert.equal(s.recommended.mind.model, 'gemma3:4b');
  assert.equal(s.recommended.voice.engine, 'piper');
  const m = Object.fromEntries(s.models.map((x) => [x.model, x]));
  assert.equal(m['gemma3:4b'].have, true);
  assert.equal(m['gemma3:1b'].have, false);
  assert.equal(m['gemma3:12b'].heavy, true, 'too big for a processor');
  assert.equal(m['gemma3:4b'].heavy, false);
  assert.equal(m['gemma3:1b'].vision, false);
  assert.equal(m['gemma3:4b'].vision, true);
  assert.deepEqual(s.cloud.map((c) => c.id), CLOUD.map((c) => c.id));
  const groq = s.cloud.find((c) => c.id === 'groq');
  assert.deepEqual([groq.connected, groq.keySaved, groq.keyPage], [true, true, true], 'the one that answers her now, with its key');
  assert.equal(s.cloud.find((c) => c.id === 'gemini').connected, false);
  assert.equal(s.cloud.find((c) => c.id === 'pollinations').connected, false, 'a service with no key is connected only when it is the one she uses');
  assert.deepEqual(s.current, { provider: 'groq', chatModel: 'gemma3:4b', ttsEngine: 'system', customUrl: '' });
  assert.match(s.ui.title, /Главное меню/);
  assert.match(s.ui['profile-standard'], /Средний/, 'the page gets the preparation\'s lines too');
  assert.deepEqual(s.have.models, ['gemma3:4b', 'qwen2.5:7b']);
});

test('what a choice would fetch: the pieces with their sizes, what is there already, the room on the disk', async () => {
  const w = world();
  const p = await w.hub.preview({ mind: 'ollama', model: 'gemma3:4b', voice: 'piper' });
  assert.deepEqual(p.items.map((i) => [i.id, i.have]), [['ollama', false], ['model', false], ['piper', false]]);
  assert.equal(p.items[1].name, 'gemma3:4b');
  assert.ok(p.total > 5 * GB && p.ok);
  assert.equal(p.free, 200 * GB);
  const cloud = await w.hub.preview({ mind: 'cloud', voice: 'system' });
  assert.deepEqual(cloud.items, [], 'nothing to fetch for a service and the system voice');
  assert.equal(cloud.total, 0);
  const have = world({ have: { ollama: true, models: ['gemma3:4b-it-q4_K_M'], chatterbox: false, piper: true } });
  const done = await have.hub.preview({ mind: 'ollama', model: 'gemma3:4b', voice: 'piper' });
  assert.equal(done.total, 0, 'all of it is there');
  assert.ok(done.items.every((i) => i.have));
  const nonsense = await w.hub.preview({ mind: 'who knows', voice: 'what' });
  assert.deepEqual(nonsense.items, [], 'a choice she does not know is no choice');
});

test('warnings: Chatterbox on a plain PC is slow, a model too big for it is heavy, a disk without room', async () => {
  const w = world();
  assert.ok((await w.hub.preview({ mind: 'skip', voice: 'chatterbox' })).notes.includes('slowVoice'));
  assert.ok((await w.hub.preview({ mind: 'ollama', model: 'gemma3:27b', voice: 'piper' })).notes.includes('heavy'));
  assert.ok(!(await w.hub.preview({ mind: 'ollama', model: 'gemma3:4b', voice: 'piper' })).notes.includes('heavy'));
  const tight = world({ hw: hardware.make({ ram: 15.9 * GB, disk: { path: '', free: 2 * GB, total: 100 * GB } }) });
  const t = await tight.hub.preview({ mind: 'ollama', model: 'gemma3:4b', voice: 'piper' });
  assert.ok(t.notes.includes('diskShort'));
  assert.equal(t.ok, false);
  const card = world({ hw: hardware.make({ ram: 15.9 * GB, gpus: [{ name: 'NVIDIA GeForce RTX 3060', vram: 12 * GB }], disk: { path: '', free: 200 * GB, total: 500 * GB } }) });
  const c = await card.hub.preview({ mind: 'skip', voice: 'chatterbox' });
  assert.equal(c.device, 'cuda');
  assert.ok(!c.notes.includes('slowVoice'), 'on a card it is fine');
  assert.equal(c.items[0].bytes, profiles.SIZE.chatterboxCuda);
});

test('the button writes the choice to her config: a model that is there is taken, one that is not is asked of the preparation', async () => {
  const w = world({ have: { ollama: true, models: ['gemma3:4b-it-q4_K_M'], chatterbox: false, piper: false } });
  await w.call('hub:apply', { mind: 'ollama', model: 'gemma3:4b', voice: 'piper' });
  assert.deepEqual(w.updates[0], { hubDone: true, autoSetup: true, provider: 'ollama', autoMind: true, chatModel: 'gemma3:4b-it-q4_K_M', wantModel: '', ttsEngine: 'piper', provisioned: true, voiceMode: 'chat' });
  assert.equal(w.prov.runs, 1, 'and the preparation starts');
  const fetch = world();
  await fetch.call('hub:apply', { mind: 'ollama', model: 'gemma3:12b', voice: 'chatterbox' });
  assert.equal(fetch.updates[0].wantModel, 'gemma3:12b');
  assert.equal(fetch.updates[0].chatModel, undefined);
  assert.equal(fetch.updates[0].ttsEngine, 'chatterbox');
});

test('the mind in the cloud or "not now" leaves who answers her as it is; the voice is set; a voice already chosen keeps its mode', async () => {
  const w = world({ cfg: { provider: 'groq', voiceMode: 'all' } });
  await w.call('hub:apply', { mind: 'cloud', voice: 'system' });
  assert.deepEqual(w.updates[0], { hubDone: true, autoSetup: true, ttsEngine: 'system', provisioned: true });
  const skip = world({ cfg: { provider: 'ollama', ttsEngine: 'elevenlabs' } });
  await skip.call('hub:apply', { mind: 'skip' });
  assert.deepEqual(skip.updates[0], { hubDone: true, autoSetup: true }, 'a choice not made is left alone');
});

test('pressing the button while something is being fetched stops that first, then goes on', async () => {
  const w = world();
  w.prov.running = true;
  w.prov.job = Promise.resolve();
  await w.call('hub:apply', { mind: 'skip', voice: 'system' });
  assert.equal(w.prov.cancels, 1);
  assert.equal(w.prov.runs, 1);
});

test('a service is tried with its key and the answer is told with the new state of the list; a key page opens only for a service she knows', async () => {
  const w = world();
  w.config.value.provider = 'groq';
  const ok = await w.call('hub:connect', { provider: 'groq', key: 'gsk_x' });
  assert.equal(ok.ok, true);
  assert.equal(ok.model, 'm1');
  assert.ok(Array.isArray(ok.cloud));
  const bad = await w.call('hub:connect', { provider: 'groq', key: 'bad' });
  assert.deepEqual([bad.ok, bad.error], [false, 'invalid x-api-key']);
  w.fire('hub:keyPage', 'groq');
  w.fire('hub:keyPage', 'openai');
  w.fire('hub:keyPage', 'file:///etc/passwd');
  assert.deepEqual(w.opened, ['https://console.groq.com/keys', 'https://platform.openai.com/api-keys']);
  const key = await w.call('hub:voiceKey', { engine: 'openai', key: '  sk-1  ' });
  assert.equal(key.ok, true);
  assert.equal(w.config.value.apiKeys.openai, 'enc:sk-1', 'the key is cleaned of spaces');
});

test('the window: opened once, brought forward when asked again; its progress is the preparation\'s; the report is copied', async () => {
  const w = world();
  w.hub.show();
  const win = FakeWindow.last;
  assert.equal(win.url, 'capri://app/src/renderer/hub.html');
  assert.equal(w.hub.isOpen(), true);
  w.hub.show();
  assert.equal(FakeWindow.last, win, 'not a second window');
  w.prov.emit('change', { running: true, steps: [] });
  assert.deepEqual(win.sent.pop(), ['hub:change', { running: true, steps: [] }]);
  assert.equal(await w.call('hub:report'), 'the report');
  w.fire('hub:copy', 'text');
  assert.equal(w.clipboard.text, 'text');
  assert.equal((await w.call('hub:retry')), true);
  assert.equal(w.prov.runs, 1);
  await w.call('hub:stop');
  assert.equal(w.prov.cancels, 1);
});

test('her "Connect" button on the overlay (hub:show) opens the window, once', () => {
  const w = world();
  assert.equal(w.hub.isOpen(), false);
  w.fire('hub:show');
  assert.equal(w.hub.isOpen(), true);
  const win = FakeWindow.last;
  w.fire('hub:show');
  assert.equal(FakeWindow.last, win);
});

test('closing the main menu the first time without pressing anything is "not now": nothing is fetched behind your back from then on', () => {
  const closed = world();
  closed.hub.show();
  FakeWindow.last.close();
  assert.deepEqual(closed.updates, [{ hubDone: true, autoSetup: false }]);
  assert.equal(closed.hub.isOpen(), false);
  // the "skip" button is the same
  const skip = world();
  skip.hub.show();
  skip.fire('hub:skip');
  assert.deepEqual(skip.updates, [{ hubDone: true, autoSetup: false }]);
  // opened later (it was used before), closed: nothing changes
  const later = world({ cfg: { hubDone: true } });
  later.hub.show();
  FakeWindow.last.close();
  assert.deepEqual(later.updates, []);
});

test('after the button the window may be closed without it counting as "not now"', async () => {
  const w = world();
  w.hub.show();
  await w.call('hub:apply', { mind: 'skip', voice: 'system' });
  w.updates.length = 0;
  FakeWindow.last.close();
  assert.deepEqual(w.updates, [], 'nothing more is written');
  assert.equal(w.config.value.autoSetup, true);
});

test('Node.js in the main menu: a row in the plan when asked for, with whether it is there, and the choice kept in her config', async () => {
  const w = world({ have: { ollama: true, models: [], chatterbox: false, piper: false, node: false } });
  const p = await w.hub.preview({ mind: 'skip', voice: 'system', node: true });
  assert.deepEqual(p.items.map((i) => [i.id, i.have]), [['node', false]]);
  assert.ok(p.total > 0 && p.total < 100 * 1024 ** 2, 'a zip of some 30 MB');
  const without = await w.hub.preview({ mind: 'skip', voice: 'system', node: false });
  assert.deepEqual(without.items, []);
  const there = world({ have: { ollama: true, models: [], chatterbox: false, piper: false, node: true } });
  assert.equal((await there.hub.preview({ mind: 'skip', voice: 'system', node: true })).total, 0);
  assert.equal((await w.call('hub:state')).node.auto, true);
  await w.call('hub:apply', { mind: 'skip', voice: 'system', node: false });
  assert.equal(w.updates[0].autoNode, false);
  const on = world();
  await on.call('hub:apply', { mind: 'skip', voice: 'system', node: true });
  assert.equal(on.updates[0].autoNode, true);
  const none = world();
  await none.call('hub:apply', { mind: 'skip', voice: 'system' });
  assert.equal('autoNode' in none.updates[0], false, 'not told: left as it is');
});

test('the recommendations the page shows: the best model and its reasons, an alternative, the voice, and every model graded for this PC', async () => {
  const plain = await world().call('hub:state');
  assert.equal(plain.rec.mind.best, 'gemma3:4b');
  assert.deepEqual(plain.rec.mind.bestWhy, ['vision', 'ru-good', 'fitsRam']);
  assert.equal(plain.rec.mind.alt, null);
  assert.deepEqual([plain.rec.voice.engine, plain.rec.voice.chatterbox], ['piper', 'veryslow']);
  assert.equal(plain.models.length, 8, 'the gemma3 and the qwen2.5 ones');
  const rank = Object.fromEntries(plain.models.map((m) => [m.model, m.rank]));
  assert.deepEqual([rank['gemma3:4b'], rank['gemma3:1b'], rank['qwen2.5:7b'], rank['gemma3:27b']], ['best', 'ok', 'heavy', 'heavy']);
  assert.ok(plain.ui['recWhy-vision'] && plain.ui['recVoice-piper'] && plain.ui.recTitle, 'the words for them are sent too');
  const big = await world({ hw: hardware.make({ ram: 63 * GB, gpus: [{ name: 'NVIDIA GeForce RTX 4090', vram: 24 * GB }], disk: { path: '', free: 500 * GB, total: 1000 * GB } }) }).call('hub:state');
  assert.equal(big.rec.mind.best, 'gemma3:12b');
  assert.equal(big.rec.mind.alt, 'qwen2.5:14b');
  assert.deepEqual([big.rec.voice.engine, big.rec.voice.device], ['chatterbox', 'cuda']);
  assert.equal(big.models.find((m) => m.model === 'qwen2.5:14b').rank, 'alt');
});

// ---- what is on this PC, and taking it off ----

test('her menu\'s "More" tab opens the main menu at the part about what is on this PC: a place she knows, in a new window or the open one', () => {
  const w = world();
  w.fire('hub:show', 'manage');
  const win = FakeWindow.last;
  assert.equal(win.url, 'capri://app/src/renderer/hub.html#manage');
  w.fire('hub:show', 'manage');
  assert.equal(FakeWindow.last, win, 'the same window');
  assert.deepEqual(win.sent.pop(), ['hub:focus', 'manage'], 'taken to that part');
  const before = win.sent.length;
  w.fire('hub:show', 'somewhere else');
  assert.equal(win.sent.length, before, 'a place she does not know is ignored');
  const plain = world();
  plain.fire('hub:show');
  assert.equal(FakeWindow.last.url, 'capri://app/src/renderer/hub.html');
});

test('the list of what she put here comes from the cleanup, and without one it is empty', async () => {
  const inv = { items: [{ id: 'piper', kind: 'piper', bytes: 5, ours: true, removable: true }], ollamaUp: true, total: 5, count: 1 };
  const w = world({ cleanup: { inventory: async () => inv } });
  assert.deepEqual(await w.call('hub:inventory'), inv);
  const none = world();
  assert.deepEqual(await none.call('hub:inventory'), { items: [], ollamaUp: true, total: 0, count: 0 });
  assert.equal((await none.call('hub:remove', 'piper')).ok, false);
});

test('taking one thing off, or all of it: what the cleanup says goes back with the new list, and the look at the PC is made again', async () => {
  const calls = [];
  const after = { items: [], ollamaUp: true, total: 0, count: 0 };
  const cleanup = {
    inventory: async () => after,
    remove: async (id) => { calls.push(['remove', id]); return { ok: true, id, freed: 10 }; },
    removeAll: async () => { calls.push(['all']); return { ok: true, freed: 99, removed: ['piper'], failed: [], left: [] }; },
  };
  const w = world({ cleanup });
  await w.call('hub:state');
  await w.call('hub:state');
  assert.equal(w.prov.previews, 1, 'the look at the PC is kept for a moment');
  const one = await w.call('hub:remove', 'model:gemma3:4b');
  assert.deepEqual(calls, [['remove', 'model:gemma3:4b']]);
  assert.deepEqual([one.ok, one.freed, one.inventory], [true, 10, after]);
  await w.call('hub:state');
  assert.equal(w.prov.previews, 2, 'a new look after something was taken off');
  const all = await w.call('hub:removeAll');
  assert.deepEqual(calls.at(-1), ['all']);
  assert.deepEqual([all.ok, all.freed, all.removed, all.inventory], [true, 99, ['piper'], after]);
});

test('her own removal goes to the app\'s uninstall; without one there is none', async () => {
  const w = world({ uninstall: async () => ({ ok: true, freed: 7 }) });
  assert.deepEqual(await w.call('hub:uninstall'), { ok: true, freed: 7 });
  assert.deepEqual(await world().call('hub:uninstall'), { ok: false, error: 'missing' });
});

test('how her mind was fitted to this PC: told with the state, measured again on the button, and pushed to the page when it changes', async () => {
  const status = { provider: 'ollama', model: 'gemma3:4b', running: false, measured: true, tps: 18, speed: 'ok', onCard: 1, numCtx: 4096, maxCtx: 8192, chat: { temperature: 0.8, num_predict: 240 }, note: { temperature: 0.2, num_predict: 768 } };
  let measured = 0;
  const mind = { status: () => ({ ...status }), measure: async () => { measured++; status.tps = 30; status.speed = 'fast'; } };
  const w = world({ mind, cfg: { hubDone: true } });
  assert.equal((await w.call('hub:state')).tune.model, 'gemma3:4b', 'the page is told with the state');
  assert.equal((await w.call('hub:tune')).tps, 18);
  const again = await w.call('hub:retune');
  assert.equal(measured, 1);
  assert.deepEqual([again.tps, again.speed], [30, 'fast'], 'and the answer is the new one');
  // a window open: a change is pushed to it
  w.hub.show();
  const win = FakeWindow.last;
  w.hub.tuneChanged();
  assert.deepEqual(win.sent.filter(([c]) => c === 'hub:tune').map(([, p]) => p.speed), ['fast']);
  win.close();
  // no mind to ask (a hub made without one): nothing to show, nothing to break
  const bare = world({});
  assert.equal((await bare.call('hub:state')).tune, null);
  assert.equal(await bare.call('hub:tune'), null);
  assert.equal(await bare.call('hub:retune'), null);
  assert.doesNotThrow(() => bare.hub.tuneChanged());
});

test('the words of her main menu and of her preparation: Russian and English have the same lines, with the same blanks to fill', () => {
  for (const mod of ['../src/main/hub-lines.js', '../src/main/prepare-lines.js']) {
    const { LINES } = require(mod);
    assert.deepEqual(Object.keys(LINES.ru).sort(), Object.keys(LINES.en).sort(), `${mod}: the same lines`);
    for (const key of Object.keys(LINES.en)) {
      const blanks = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(blanks(LINES.ru[key]), blanks(LINES.en[key]), `${mod}: ${key} has the same blanks in both languages`);
    }
  }
});
