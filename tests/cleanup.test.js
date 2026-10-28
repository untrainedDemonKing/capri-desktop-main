'use strict';

// Taking off what she put on this PC (src/main/cleanup.js, installed.js): the list with sizes, one thing at a time
// or all of it, only what is hers (her data folder, what she wrote down), her settings afterwards so that nothing is
// fetched again, and the guards.
//   npm run test:cleanup

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Cleanup, sizeOf, inside } = require('../src/main/cleanup.js');
const { createInstalled } = require('../src/main/installed.js');

const put = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
};

// a PC with her data folder, the user's home, and stand-ins for Ollama and the programs she stops
function world({ cfg = {}, models = null, win = false, ollamaUp = true, canStart = true, runOk = true, record = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-clean-'));
  const userData = path.join(root, 'userdata');
  const home = path.join(root, 'home');
  const outside = path.join(root, 'yours');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  put(path.join(userData, 'piper', 'voices', 'ru.onnx'), 1000);
  put(path.join(userData, 'chatterbox', 'venv', 'lib.bin'), 2000);
  put(path.join(userData, 'chatterbox', 'huggingface', 'hub', 'models--ResembleAI--chatterbox', 'w.bin'), 500);
  put(path.join(userData, 'node', 'node.exe'), 300);
  put(path.join(userData, 'ollama', 'ollama.exe'), 400);
  put(path.join(userData, 'ollama', 'models', 'blobs', 'b1'), 800);
  put(path.join(userData, 'config.json'), 50); // her own data: not in the list
  const state = {
    cfg: { provider: 'ollama', chatModel: 'gemma3:4b', ttsEngine: 'chatterbox', provisioned: true, chatterboxDir: path.join(userData, 'chatterbox'), ollamaDir: path.join(userData, 'ollama'), ...cfg },
    models: models || [{ name: 'gemma3:4b', size: 3300 }, { name: 'qwen2.5:7b', size: 4700 }],
    up: ollamaUp, canStart, runs: [], removedModels: [], stops: [], paths: [], saves: [], refreshed: 0,
  };
  const installed = createInstalled({ file: path.join(userData, 'installed.json') });
  for (const m of record.models || ['gemma3:4b']) installed.record('model', m);
  if (record.ollama) installed.record('ollama', record.ollama);
  if (record.python) installed.record('python');
  const cleanup = new Cleanup({
    userData, home, platform: win ? 'win32' : 'linux', env: { LOCALAPPDATA: path.join(home, 'AppData', 'Local') }, settle: 0,
    cfg: () => state.cfg,
    save: (patch) => { state.saves.push(patch); Object.assign(state.cfg, patch); },
    installed,
    ollamaApi: {
      list: async () => { if (!state.up) throw new Error('offline'); return state.models.map((m) => ({ ...m })); },
      remove: async (name) => { if (!state.up) throw new Error('offline'); state.removedModels.push(name); state.models = state.models.filter((m) => m.name !== name); },
    },
    ollamaHost: {
      versionFn: async () => (state.up ? '0.9' : ''),
      ready: async () => { if (!state.canStart) throw new Error('would not start'); state.up = true; },
      stop: () => state.stops.push('ollama'),
      status: () => ({ dir: path.join(outside, 'Ollama') }),
    },
    chatterbox: { stop: () => state.stops.push('chatterbox') },
    piper: { stop: () => state.stops.push('piper'), defaultDir: () => path.join(userData, 'piper') },
    nodeTools: { removeFromUserPath: (d) => state.paths.push(d) },
    provision: { running: false },
    onModelsChanged: async () => { state.refreshed++; },
    run: async (cmd, args) => { state.runs.push([path.basename(cmd), ...args]); return { ok: typeof runOk === 'function' ? runOk(cmd, args) : runOk }; },
  });
  return { cleanup, state, installed, userData, home, outside, root, exists: (...p) => fs.existsSync(path.join(userData, ...p)) };
}

test('sizeOf counts a folder and a file, and gives up counting when it takes too long', async () => {
  const w = world();
  assert.deepEqual(await sizeOf(path.join(w.userData, 'piper')), { bytes: 1000, partial: false });
  assert.equal((await sizeOf(path.join(w.userData, 'config.json'))).bytes, 50);
  assert.equal((await sizeOf(path.join(w.userData, 'nowhere'))).bytes, 0);
  assert.equal((await sizeOf(path.join(w.userData, 'chatterbox'), { budgetMs: -1 })).partial, true);
  assert.ok(inside('/a/b', '/a/b/c') && !inside('/a/b', '/a/b') && !inside('/a/b', '/a/bc') && !inside('/a/b', '/a/x/../c'));
});

test('installed.js: what she wrote down is kept across starts, forgotten, and a broken file is just empty', () => {
  const w = world({ record: { models: [] } });
  const file = w.installed.file;
  w.installed.record('model', 'gemma3:4b');
  w.installed.record('model', 'gemma3:4b');
  w.installed.record('ollama', { how: 'winget' });
  w.installed.record('nonsense', { a: 1 });
  const again = createInstalled({ file });
  assert.deepEqual(again.get().models, ['gemma3:4b']);
  assert.equal(again.get().ollama.how, 'winget');
  assert.ok(again.get().ollama.at > 0);
  assert.equal(again.get().nonsense, undefined);
  again.forget('model', 'gemma3:4b');
  again.forget('ollama');
  assert.deepEqual(createInstalled({ file }).get(), { models: [] });
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(createInstalled({ file }).get(), { models: [] });
});

test('the list: models (which are hers), Ollama in her folder, Piper, Chatterbox (with its model), Node; the total is only what is hers', async () => {
  const w = world();
  const inv = await w.cleanup.inventory();
  const by = Object.fromEntries(inv.items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(by).sort(), ['chatterbox', 'model:gemma3:4b', 'model:qwen2.5:7b', 'node', 'ollama', 'piper']);
  assert.equal(by['model:gemma3:4b'].ours, true, 'she pulled this one (written down)');
  assert.equal(by['model:qwen2.5:7b'].ours, false, 'this one is yours');
  assert.equal(by['model:qwen2.5:7b'].removable, true, 'but you can take it off, one at a time');
  assert.equal(by.piper.bytes, 1000);
  assert.equal(by.chatterbox.bytes, 2500);
  assert.equal(by.node.bytes, 300);
  assert.equal(by.ollama.bytes, 1200);
  assert.equal(by.ollama.how, 'zip');
  assert.ok([by.piper, by.chatterbox, by.node, by.ollama].every((i) => i.ours && i.removable));
  assert.equal(inv.total, 3300 + 1000 + 2500 + 300 + 1200);
  assert.equal(inv.ollamaUp, true);
  // her own data is not in the list
  assert.ok(!inv.items.some((i) => /config/.test(i.id)));
});

test('what is yours is shown but not hers: a Chatterbox folder next to her, an Ollama you installed', async () => {
  const w = world({ cfg: { chatterboxDir: '', ollamaDir: '' } });
  put(path.join(w.outside, 'chatterbox-main', 'venv', 'x'), 777);
  put(path.join(w.outside, 'Ollama', 'ollama.exe'), 111);
  w.state.cfg.chatterboxDir = path.join(w.outside, 'chatterbox-main');
  const inv = await w.cleanup.inventory();
  const cb = inv.items.find((i) => i.id === 'chatterbox');
  assert.deepEqual([cb.ours, cb.removable, cb.bytes], [false, false, 777]);
  const ol = inv.items.find((i) => i.id === 'ollama');
  assert.deepEqual([ol.ours, ol.removable], [false, false]);
  assert.deepEqual(await w.cleanup.remove('chatterbox'), { ok: false, id: 'chatterbox', error: 'not hers' });
  assert.deepEqual(await w.cleanup.remove('ollama'), { ok: false, id: 'ollama', error: 'not hers' });
  assert.ok(fs.existsSync(path.join(w.outside, 'chatterbox-main', 'venv', 'x')));
  assert.ok(fs.existsSync(path.join(w.outside, 'Ollama', 'ollama.exe')));
});

test('Ollama not answering: the models cannot be seen, the rest still can', async () => {
  const w = world({ ollamaUp: false });
  const inv = await w.cleanup.inventory();
  assert.equal(inv.ollamaUp, false);
  assert.ok(!inv.items.some((i) => i.kind === 'model'));
  assert.ok(inv.items.some((i) => i.id === 'piper'));
});

test('Piper: stopped, its folder gone, and the voice is the system\'s again (not fetched again)', async () => {
  const w = world({ cfg: { ttsEngine: 'piper' } });
  const res = await w.cleanup.remove('piper');
  assert.deepEqual([res.ok, res.freed], [true, 1000]);
  assert.ok(!w.exists('piper'));
  assert.ok(w.state.stops.includes('piper'));
  assert.equal(w.state.cfg.ttsEngine, 'system');
  assert.equal(w.state.cfg.provisioned, true, 'she does not "adopt" a new voice on the next start');
  // another voice stays as it is
  const v = world({ cfg: { ttsEngine: 'openai' } });
  await v.cleanup.remove('piper');
  assert.equal(v.state.cfg.ttsEngine, 'openai');
});

test('Chatterbox: stopped, the folder with its model gone, an older cache of its model too (and only that)', async () => {
  const w = world();
  fs.rmSync(path.join(w.userData, 'chatterbox', 'huggingface'), { recursive: true }); // (an older folder: its model is in the hub's default cache)
  const hub = path.join(w.home, '.cache', 'huggingface', 'hub');
  put(path.join(hub, 'models--ResembleAI--chatterbox', 'old.bin'), 900);
  put(path.join(hub, 'models--bert-base', 'keep.bin'), 100);
  const inv = await w.cleanup.inventory();
  assert.equal(inv.items.find((i) => i.id === 'chatterbox').bytes, 2000 + 900, 'the older cache counts');
  const res = await w.cleanup.remove('chatterbox');
  assert.equal(res.ok, true);
  assert.ok(!w.exists('chatterbox'));
  assert.ok(!fs.existsSync(path.join(hub, 'models--ResembleAI--chatterbox')));
  assert.ok(fs.existsSync(path.join(hub, 'models--bert-base', 'keep.bin')), 'a model of something else stays');
  assert.ok(w.state.stops.includes('chatterbox'));
  assert.equal(w.state.cfg.ttsEngine, 'system');
  assert.equal(w.state.cfg.chatterboxDir, '');
});

test('a model: taken off through Ollama, forgotten, and her model is another one; the last one off switches her mind off (not fetched again)', async () => {
  const w = world();
  const first = await w.cleanup.remove('model:gemma3:4b');
  assert.deepEqual([first.ok, first.freed], [true, 3300]);
  assert.deepEqual(w.state.removedModels, ['gemma3:4b']);
  assert.deepEqual(w.installed.get().models, []);
  assert.equal(w.state.cfg.chatModel, 'qwen2.5:7b');
  assert.equal(w.state.cfg.autoMind, undefined, 'one is left: she still has a mind');
  assert.ok(w.state.refreshed >= 1);
  // yours: one at a time, on your say
  const second = await w.cleanup.remove('model:qwen2.5:7b');
  assert.equal(second.ok, true);
  assert.equal(w.state.cfg.chatModel, '');
  assert.equal(w.state.cfg.autoMind, false);
  assert.deepEqual((await w.cleanup.inventory()).items.filter((i) => i.kind === 'model'), []);
});

test('a model with Ollama off: she starts it first; if it will not start, she says so and touches nothing', async () => {
  const w = world({ ollamaUp: false });
  w.state.canStart = false;
  await assert.rejects(() => w.cleanup.removeModel('gemma3:4b'), /Ollama is not running/);
  assert.deepEqual(w.state.removedModels, []);
  assert.deepEqual(w.installed.get().models, ['gemma3:4b'], 'still written down');
  w.state.canStart = true;
  await w.cleanup.removeModel('gemma3:4b');
  assert.deepEqual(w.state.removedModels, ['gemma3:4b']);
  assert.equal(w.state.up, true, 'she started it');
});

test('Node.js: out of the PATH and the folder gone; she does not fetch it again', async () => {
  const w = world();
  const res = await w.cleanup.remove('node');
  assert.equal(res.ok, true);
  assert.deepEqual(w.state.paths, [path.join(w.userData, 'node')]);
  assert.ok(!w.exists('node'));
  assert.equal(w.state.cfg.autoNode, false);
});

test('Ollama in her folder: her models first, then its folder; settings say no mind to fetch', async () => {
  const w = world();
  const res = await w.cleanup.remove('ollama');
  assert.equal(res.ok, true);
  assert.deepEqual(w.state.removedModels, ['gemma3:4b'], 'the one she pulled; yours stays');
  assert.ok(!w.exists('ollama'));
  assert.ok(w.state.stops.includes('ollama'));
  assert.equal(w.state.cfg.ollamaDir, '');
  assert.equal(w.state.cfg.autoMind, false);
  assert.equal(w.installed.get().ollama, undefined);
});

test('Ollama she installed the usual way (Windows): quit, then its own uninstaller, else winget; kept written down if that fails', async () => {
  const w = world({ win: true, cfg: { ollamaDir: '' }, record: { ollama: { how: 'installer' } } });
  const dir = path.join(w.home, 'AppData', 'Local', 'Programs', 'Ollama');
  put(path.join(dir, 'ollama.exe'), 500);
  put(path.join(dir, 'unins000.exe'), 100);
  const res = await w.cleanup.remove('ollama');
  assert.equal(res.ok, true, res.error);
  const names = w.state.runs.map((r) => r[0]);
  assert.deepEqual(names.slice(0, 2), ['taskkill', 'taskkill'], 'its tray app and the program are closed first');
  assert.ok(w.state.runs.some((r) => r[0] === 'unins000.exe' && r.includes('/VERYSILENT')));
  assert.equal(w.installed.get().ollama, undefined);

  // no uninstaller of its own: winget
  const v = world({ win: true, cfg: { ollamaDir: '' }, record: { ollama: { how: 'winget' } } });
  put(path.join(v.home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'), 500);
  assert.equal((await v.cleanup.remove('ollama')).ok, true);
  assert.ok(v.state.runs.some((r) => r[0] === 'winget' && r.includes('Ollama.Ollama') && r.includes('uninstall')));

  // nothing works: an error, and it is still written down as hers
  const f = world({ win: true, cfg: { ollamaDir: '' }, record: { ollama: { how: 'winget' } }, runOk: (cmd) => /taskkill/.test(cmd) });
  put(path.join(f.home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'), 500);
  const bad = await f.cleanup.remove('ollama');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /could not be uninstalled/);
  assert.equal(f.installed.get().ollama.how, 'winget');
});

test('Python she installed: through winget; it is not in the list unless she wrote it down', async () => {
  const w = world();
  assert.ok(!(await w.cleanup.inventory()).items.some((i) => i.id === 'python'));
  const v = world({ win: true, record: { python: true } });
  assert.ok((await v.cleanup.inventory()).items.some((i) => i.id === 'python'));
  assert.equal((await v.cleanup.remove('python')).ok, true);
  assert.ok(v.state.runs.some((r) => r[0] === 'winget' && r.includes('Python.Python.3.11')));
  assert.equal(v.installed.get().python, undefined);
  const f = world({ win: true, record: { python: true }, runOk: false });
  assert.equal((await f.cleanup.remove('python')).ok, false);
  assert.ok(f.installed.get().python, 'still hers');
});

test('all of it: in an order that works, what is yours stays, a failure does not stop the rest', async () => {
  const w = world({ win: true, record: { python: true } });
  const done = [];
  const orig = w.cleanup.removeDir.bind(w.cleanup);
  w.cleanup.removeDir = async (dir) => { done.push(path.basename(dir)); return orig(dir); };
  const res = await w.cleanup.removeAll();
  assert.equal(res.ok, true, JSON.stringify(res.failed));
  assert.deepEqual(res.removed, ['chatterbox', 'piper', 'model:gemma3:4b', 'ollama', 'node', 'python']);
  assert.deepEqual(done, ['chatterbox', 'piper', 'ollama', 'node']);
  assert.equal(res.freed, 2500 + 1000 + 3300 + 1200 + 300);
  assert.deepEqual(res.left, ['model:qwen2.5:7b'], 'the model you pulled yourself stays');
  assert.ok(w.exists('config.json'), 'her own settings are not part of it');
  assert.equal(w.state.cfg.ttsEngine, 'system');
  assert.equal(w.state.cfg.autoNode, false);
  assert.equal(w.state.cfg.autoMind, false);

  // one fails (Python): the rest is done, and it says what failed
  const f = world({ win: true, record: { python: true }, runOk: (cmd, args) => !args.includes('Python.Python.3.11') });
  const part = await f.cleanup.removeAll();
  assert.equal(part.ok, false);
  assert.deepEqual(part.failed.map((x) => x.id), ['python']);
  assert.ok(part.removed.includes('node') && part.removed.includes('piper'));
});

test('guards: not while something is being fetched or taken off, nothing outside her data folder, nothing unknown', async () => {
  const w = world();
  w.cleanup.d.provision.running = true;
  assert.deepEqual(await w.cleanup.remove('piper'), { ok: false, id: 'piper', error: 'preparing' });
  assert.equal((await w.cleanup.removeAll()).error, 'preparing');
  assert.ok(w.exists('piper'));
  w.cleanup.d.provision.running = false;
  w.cleanup.busy = true;
  assert.equal((await w.cleanup.remove('piper')).error, 'busy');
  w.cleanup.busy = false;
  assert.equal((await w.cleanup.remove('nothing')).error, 'missing');
  await assert.rejects(() => w.cleanup.removeDir(w.outside), /not hers/);
  await assert.rejects(() => w.cleanup.removeDir(w.userData), /not hers/, 'not her whole data folder either');
  await assert.rejects(() => w.cleanup.removeDir(path.join(w.userData, '..')), /not hers/);
});

test('all of it with Ollama not answering: it is woken up for the models she pulled', async () => {
  const w = world({ ollamaUp: false });
  const res = await w.cleanup.removeAll();
  assert.equal(res.ok, true, JSON.stringify(res.failed));
  assert.deepEqual(w.state.removedModels, ['gemma3:4b']);
  assert.equal(w.state.up, true, 'she started it');
  // and with nothing of hers to pull through Ollama, she does not wake it
  const none = world({ ollamaUp: false, record: { models: [] } });
  const woke = await none.cleanup.removeAll();
  assert.equal(none.state.up, false);
  assert.equal(woke.ok, true);
});

test('Ollama of hers that keeps its models in her folder: all of them are hers, they are counted once, and they go with it', async () => {
  const w = world();
  w.cleanup.d.ollamaHost.status = () => ({ dir: path.join(w.userData, 'ollama'), modelsDir: path.join(w.userData, 'ollama', 'models') });
  const inv = await w.cleanup.inventory();
  const by = Object.fromEntries(inv.items.map((i) => [i.id, i]));
  assert.equal(by['model:qwen2.5:7b'].ours, true, 'in her folder, so hers even if she did not write it down');
  assert.equal(by.ollama.bytes, 400, 'the program without the models folder (they are the models\' own lines)');
  const res = await w.cleanup.remove('ollama');
  assert.equal(res.ok, true);
  assert.deepEqual(w.state.removedModels.sort(), ['gemma3:4b', 'qwen2.5:7b']);
  assert.ok(!w.exists('ollama'));
});

test('an older Chatterbox folder (no cache inside) has its model in the hub\'s default cache and that goes with it; a newer one leaves that cache alone', async () => {
  const old = world();
  fs.rmSync(path.join(old.userData, 'chatterbox', 'huggingface'), { recursive: true });
  const hub = path.join(old.home, '.cache', 'huggingface', 'hub', 'models--ResembleAI--chatterbox');
  put(path.join(hub, 'w.bin'), 900);
  assert.equal((await old.cleanup.inventory()).items.find((i) => i.id === 'chatterbox').bytes, 2000 + 900);
  await old.cleanup.remove('chatterbox');
  assert.ok(!fs.existsSync(hub));
  const fresh = world();
  const mine = path.join(fresh.home, '.cache', 'huggingface', 'hub', 'models--ResembleAI--chatterbox');
  put(path.join(mine, 'w.bin'), 900);
  assert.equal((await fresh.cleanup.inventory()).items.find((i) => i.id === 'chatterbox').bytes, 2500, 'not counted: not hers');
  await fresh.cleanup.remove('chatterbox');
  assert.ok(fs.existsSync(mine), 'a cache outside her folder is left alone');
});

test('a list made a moment ago is reused by a removal (counting takes a while), and what is taken off makes the next one new', async () => {
  const w = world();
  let counts = 0;
  const list = w.cleanup.d.ollamaApi.list;
  w.cleanup.d.ollamaApi.list = async () => { counts++; return list(); };
  await w.cleanup.inventory({ fresh: true });
  const after = counts;
  assert.equal((await w.cleanup.remove('piper')).ok, true);
  assert.equal(counts, after, 'the removal did not count again');
  const next = await w.cleanup.inventory();
  assert.ok(counts > after, 'afterwards it is counted again');
  assert.ok(!next.items.some((i) => i.id === 'piper'));
  // and `fresh` always counts
  const before = counts;
  await w.cleanup.inventory({ fresh: true });
  assert.ok(counts > before);
});
