'use strict';

// The folder everything she fetches goes in (src/main/downloads.js): the "Capri" folder made in the place you pick,
// the places that are refused, the default, and taking off what lies in such a folder (src/main/cleanup.js).
//   node --test tests/downloads.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dl = require('../src/main/downloads.js');
const { Cleanup } = require('../src/main/cleanup.js');
const { createInstalled } = require('../src/main/installed.js');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-dl-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;
const fresh = (name = 'w') => { const d = path.join(base, `${name}${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const put = (file, bytes = 10) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes, 1)); };

test('the place you pick gets a folder "Capri" with her mark in it; a folder that is called so, or has the mark, is used as it is', () => {
  const disk = fresh('disk');
  const res = dl.choose(disk);
  assert.deepEqual(res, { ok: true, dir: path.join(disk, 'Capri') });
  assert.ok(fs.existsSync(path.join(disk, 'Capri', dl.MARK)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(disk, 'Capri', dl.MARK), 'utf8')).app, 'capri');
  assert.equal(dl.choose(path.join(disk, 'Capri')).dir, path.join(disk, 'Capri'), 'not Capri/Capri');
  assert.equal(dl.choose(path.join(disk, 'capri')).dir, path.join(disk, 'capri'), 'also by another case: Windows does not tell');
  const marked = path.join(fresh('marked'), 'Stuff');
  fs.mkdirSync(marked);
  fs.writeFileSync(path.join(marked, dl.MARK), '{}');
  assert.equal(dl.choose(marked).dir, marked, 'one she made already, under whatever name');
  assert.equal(dl.folderFor(disk), path.join(disk, 'Capri'));
});

test('places that will not do: not a place on a disk, her own program folder, a file, a place she cannot write to', () => {
  assert.deepEqual(dl.choose('relative/path'), { ok: false, error: 'relative' });
  assert.deepEqual(dl.choose(''), { ok: false, error: 'relative' });
  assert.deepEqual(dl.choose(undefined), { ok: false, error: 'relative' });
  const app = fresh('app');
  assert.deepEqual(dl.choose(app, { appDirs: [app] }), { ok: false, error: 'inApp' }, 'the Capri folder made in the program folder would go with the uninstaller');
  assert.deepEqual(dl.choose(path.join(app, 'sub'), { appDirs: [app] }), { ok: false, error: 'inApp' });
  assert.equal(dl.choose(fresh('elsewhere'), { appDirs: [app] }).ok, true);
  const file = path.join(fresh('f'), 'Capri');
  fs.writeFileSync(file, 'x');
  assert.deepEqual(dl.choose(file), { ok: false, error: 'notFolder' });
  const readOnly = { ...fs, mkdirSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  assert.deepEqual(dl.choose(path.join(base, 'denied'), { fsx: readOnly }), { ok: false, error: 'noWrite' });
  assert.equal(fs.existsSync(path.join(base, 'denied')), false);
});

test('the mark is written once, and the write test leaves nothing behind', () => {
  const dir = path.join(fresh('m'), 'Capri');
  dl.make(dir);
  const first = fs.readFileSync(path.join(dir, dl.MARK), 'utf8');
  dl.make(dir);
  assert.equal(fs.readFileSync(path.join(dir, dl.MARK), 'utf8'), first);
  assert.deepEqual(fs.readdirSync(dir), [dl.MARK]);
});

test('a folder is hers when a folder above it has the mark, wherever it is, and never the marked folder itself', () => {
  const dir = path.join(fresh('u'), 'Capri');
  dl.make(dir);
  put(path.join(dir, 'chatterbox', 'venv', 'x'));
  assert.equal(dl.underMark(path.join(dir, 'chatterbox')), true);
  assert.equal(dl.underMark(path.join(dir, 'chatterbox', 'venv', 'x')), true);
  assert.equal(dl.underMark(dir), false, 'the marked folder itself is not under its mark');
  assert.equal(dl.underMark(path.join(fresh('other'), 'chatterbox')), false);
  assert.equal(dl.underMark(''), false);
});

function folderWorld({ cfg = {}, busy = false, pick = null, userData = fresh('data') } = {}) {
  const state = { cfg: { dataDir: '', ...cfg }, saved: [], opened: [], left: [], busy };
  const folder = dl.createFolder({
    cfg: () => state.cfg,
    save: (patch) => { state.saved.push(patch); Object.assign(state.cfg, patch); },
    userData,
    pickDir: async () => pick,
    openPath: (d) => { state.opened.push(d); return ''; },
    appDirs: [path.join(base, 'program')],
    diskOf: () => ({ free: 50 * 1024 ** 3 }),
    busy: () => state.busy,
    leaving: (oldRoot) => state.left.push(oldRoot),
  });
  return { folder, state, userData };
}

test('by default everything goes in her data folder; with a folder picked, in the Capri folder, work files included', async () => {
  const w = folderWorld();
  assert.equal(w.folder.root(), w.userData);
  assert.equal(w.folder.sub('piper'), path.join(w.userData, 'piper'));
  assert.equal(w.folder.temp(), '', 'the system\'s own temp, as before');
  assert.equal(w.folder.custom(), false);
  assert.deepEqual(w.folder.info(), { dir: w.userData, custom: false, standard: w.userData, free: 50 * 1024 ** 3 });
  const disk = fresh('disk');
  const used = w.folder.use(disk);
  assert.equal(used.ok, true);
  assert.equal(used.dir, path.join(disk, 'Capri'));
  assert.equal(used.custom, true);
  assert.deepEqual(w.state.saved, [{ dataDir: path.join(disk, 'Capri') }]);
  assert.equal(w.folder.sub('chatterbox'), path.join(disk, 'Capri', 'chatterbox'));
  assert.equal(w.folder.sub('ollama'), path.join(disk, 'Capri', 'ollama'));
  assert.equal(w.folder.temp(), path.join(disk, 'Capri', 'temp'));
  assert.equal(w.folder.custom(), true);
  const back = w.folder.reset();
  assert.equal(back.ok, true);
  assert.equal(back.dir, w.userData);
  assert.equal(w.state.cfg.dataDir, '');
  assert.deepEqual(w.state.left, [w.userData, path.join(disk, 'Capri')], 'told which folder it leaves, each time, before the change');
});

test('the place is not changed while something is fetched or taken off; picking her own data folder is the default again; a place that will not do changes nothing', async () => {
  const w = folderWorld({ busy: true });
  assert.deepEqual(w.folder.use(fresh('d')), { ok: false, error: 'busy' });
  assert.deepEqual(w.folder.reset(), { ok: false, error: 'busy' });
  assert.deepEqual(await w.folder.choose(null), { ok: false, error: 'busy' });
  assert.deepEqual(w.state.saved, []);
  w.state.busy = false;
  assert.equal(w.folder.use(fresh('d')).ok, true);
  const bad = w.folder.use('relative');
  assert.deepEqual(bad, { ok: false, error: 'relative' });
  assert.equal(w.state.cfg.dataDir.endsWith('Capri'), true, 'the earlier choice stands');
  assert.equal(w.folder.use(w.userData).custom, false, 'her data folder picked: no folder of its own');
  assert.equal(w.state.cfg.dataDir, '');
});

test('the dialog: nothing picked changes nothing; a place picked is used', async () => {
  const none = folderWorld({ pick: null });
  assert.deepEqual(await none.folder.choose(null), { ok: false, error: 'canceled' });
  assert.deepEqual(none.state.saved, []);
  const disk = fresh('picked');
  const some = folderWorld({ pick: disk });
  const res = await some.folder.choose(null);
  assert.equal(res.ok, true);
  assert.equal(res.dir, path.join(disk, 'Capri'));
  some.folder.open();
  assert.deepEqual(some.state.opened, [path.join(disk, 'Capri')]);
});

test('the folder is made again with its mark when it was deleted meanwhile, and the work files are cleared away', () => {
  const disk = fresh('disk');
  const w = folderWorld();
  w.folder.use(disk);
  const dir = path.join(disk, 'Capri');
  put(path.join(dir, 'temp', 'torch.whl'), 100);
  w.folder.cleanTemp();
  assert.equal(fs.existsSync(path.join(dir, 'temp')), false);
  assert.ok(fs.existsSync(path.join(dir, dl.MARK)), 'only the work files go');
  fs.rmSync(dir, { recursive: true, force: true });
  w.folder.ensure();
  assert.ok(fs.existsSync(path.join(dir, dl.MARK)));
  const plain = folderWorld();
  plain.folder.ensure();
  plain.folder.cleanTemp();
  assert.deepEqual(fs.readdirSync(plain.userData), [], 'with the default, nothing is made or cleared');
});

// ---- taking off what lies in such a folder ----

function cleanupWorld({ dataDir = '' } = {}) {
  const root = fresh('c');
  const userData = path.join(root, 'userdata');
  const capri = dataDir === 'make' ? path.join(root, 'D', 'Capri') : dataDir;
  fs.mkdirSync(userData, { recursive: true });
  if (capri) dl.make(capri);
  const state = { cfg: { provider: 'ollama', ttsEngine: 'chatterbox', dataDir: capri, chatterboxDir: '', ollamaDir: '' }, stops: [], saves: [] };
  const mk = (where, ...parts) => put(path.join(where, ...parts), 100);
  const home = path.join(root, 'home');
  const cleanup = new Cleanup({
    userData, home, platform: 'linux', env: {}, settle: 0,
    cfg: () => state.cfg,
    save: (patch) => { state.saves.push(patch); Object.assign(state.cfg, patch); },
    installed: createInstalled({ file: path.join(userData, 'installed.json') }),
    ollamaApi: { list: async () => [], remove: async () => {} },
    ollamaHost: { versionFn: async () => '', ready: async () => {}, stop: () => {}, status: () => ({}) },
    chatterbox: { stop: () => state.stops.push('chatterbox') },
    piper: { stop: () => state.stops.push('piper'), defaultDir: () => path.join(state.cfg.dataDir || userData, 'piper') },
    nodeTools: { removeFromUserPath: () => {} },
    provision: { running: false },
    run: async () => ({ ok: true }),
  });
  return { cleanup, state, userData, capri, root, mk };
}

test('what lies in the Capri folder is hers: listed, taken off with its mark staying, and the empty folder goes after all of it', async () => {
  const w = cleanupWorld({ dataDir: 'make' });
  w.mk(w.capri, 'piper', 'voices', 'ru.onnx');
  w.mk(w.capri, 'chatterbox', 'venv', 'lib');
  w.mk(w.capri, 'node', 'node.exe');
  w.mk(w.capri, 'temp', 'half-a-download');
  w.state.cfg.chatterboxDir = path.join(w.capri, 'chatterbox');
  const inv = await w.cleanup.inventory({ fresh: true });
  const by = Object.fromEntries(inv.items.map((i) => [i.kind, i]));
  assert.equal(by.piper.ours, true);
  assert.equal(by.chatterbox.ours, true);
  assert.equal(by.node.ours, true);
  assert.equal(inv.count, 3);
  const res = await w.cleanup.removeAll();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(fs.existsSync(path.join(w.capri, 'chatterbox')), false);
  assert.equal(fs.existsSync(path.join(w.capri, 'piper')), false);
  assert.equal(fs.existsSync(path.join(w.capri, 'node')), false);
  assert.equal(fs.existsSync(w.capri), false, 'nothing is left in it but the mark and the work files: the folder goes');
  assert.ok(fs.existsSync(w.userData), 'her data folder is not touched');
});

test('a Capri folder with something of yours in it stays, with what is yours', async () => {
  const w = cleanupWorld({ dataDir: 'make' });
  w.mk(w.capri, 'piper', 'voices', 'ru.onnx');
  w.mk(w.capri, 'my-notes.txt');
  const res = await w.cleanup.removeAll();
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(path.join(w.capri, 'piper')), false);
  assert.ok(fs.existsSync(path.join(w.capri, 'my-notes.txt')));
  assert.ok(fs.existsSync(w.capri));
});

test('after the default is put back, what is in the earlier Capri folder is still hers to take off; a folder outside any marked one is not', async () => {
  const w = cleanupWorld({ dataDir: 'make' });
  w.mk(w.capri, 'chatterbox', 'venv', 'lib');
  w.state.cfg.chatterboxDir = path.join(w.capri, 'chatterbox');
  w.state.cfg.dataDir = ''; // (the default put back: the folder is not in her settings any more)
  const inv = await w.cleanup.inventory({ fresh: true });
  const cb = inv.items.find((i) => i.kind === 'chatterbox');
  assert.equal(cb.ours, true, 'the mark above it says that she made it');
  const yours = path.join(w.root, 'yours', 'chatterbox');
  w.mk(yours, 'venv', 'lib');
  w.state.cfg.chatterboxDir = yours;
  const other = (await w.cleanup.inventory({ fresh: true })).items.find((i) => i.kind === 'chatterbox');
  assert.equal(other.ours, false);
  assert.equal(other.removable, false);
  await assert.rejects(() => w.cleanup.removeDir(yours), /not hers to remove/);
  assert.ok(fs.existsSync(yours));
});

test('a folder is never removed that is the Capri folder itself', async () => {
  const w = cleanupWorld({ dataDir: 'make' });
  await assert.rejects(() => w.cleanup.removeDir(w.capri), /not hers to remove/);
  assert.ok(fs.existsSync(w.capri));
});
