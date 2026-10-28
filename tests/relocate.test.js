'use strict';

// Moving what she fetched to the folder in use (src/main/relocate.js): renamed on the same disk, copied beside and put in
// place on another, looked at before the old one goes, put back when it does not work or when she is stopped, and
// only what is hers. And a folder moved by hand being found again.
//   node --test tests/relocate.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dl = require('../src/main/downloads.js');
const { Cleanup } = require('../src/main/cleanup.js');
const { createInstalled } = require('../src/main/installed.js');
const { Relocate, copyTree } = require('../src/main/relocate.js');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-move-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;
const fresh = (name = 'w') => { const d = path.join(base, `${name}${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const put = (file, bytes = 10) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes, 7)); };
const tree = (dir) => {
  const out = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = path.join(rel, e.name); if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r); } };
  try { walk(dir, ''); } catch { /* not there */ }
  return out.sort();
};

// a PC: her data folder, an old Capri folder (marked) with everything of hers in it, a new one to move to
function world({ fsx = fs, busy = '', free = 500 * 1024 ** 3, sameDisk, hers = ['piper', 'chatterbox', 'node', 'ollama'], oldMarked = true, tools } = {}) {
  const root = fresh('pc');
  const userData = path.join(root, 'userdata');
  const oldRoot = path.join(root, 'C', 'Capri');
  const newRoot = path.join(root, 'D', 'Capri');
  fs.mkdirSync(userData, { recursive: true });
  if (oldMarked) dl.make(oldRoot); else fs.mkdirSync(oldRoot, { recursive: true });
  dl.make(newRoot);
  const state = { cfg: { dataDir: newRoot, piperDir: '', chatterboxDir: '', ollamaDir: '' }, saved: [], stops: 0, after: 0, path: [] };
  if (hers.includes('piper')) { put(path.join(oldRoot, 'piper', 'piper', 'piper'), 50); put(path.join(oldRoot, 'piper', 'voices', 'ru.onnx'), 300); state.cfg.piperDir = path.join(oldRoot, 'piper'); }
  if (hers.includes('chatterbox')) {
    put(path.join(oldRoot, 'chatterbox', 'venv', 'bin', 'python3'), 20); put(path.join(oldRoot, 'chatterbox', 'venv', 'pyvenv.cfg'), 5);
    put(path.join(oldRoot, 'chatterbox', 'venv', 'lib', 'a.bin'), 400); put(path.join(oldRoot, 'chatterbox', 'huggingface', 'hub', 'm.bin'), 800);
    state.cfg.chatterboxDir = path.join(oldRoot, 'chatterbox');
  }
  if (hers.includes('ollama')) { put(path.join(oldRoot, 'ollama', 'ollama.exe'), 60); put(path.join(oldRoot, 'ollama', 'models', 'blobs', 'b1'), 900); state.cfg.ollamaDir = path.join(oldRoot, 'ollama'); }
  const installed = createInstalled({ file: path.join(userData, 'installed.json') });
  if (hers.includes('node')) { put(path.join(oldRoot, 'node', 'node-v22', 'node.exe'), 40); installed.record('node', { dir: path.join(oldRoot, 'node', 'node-v22'), onPath: true }); }
  const save = (patch) => { state.saved.push(patch); Object.assign(state.cfg, patch); };
  const folder = dl.createFolder({ cfg: () => state.cfg, save, userData, pickDir: async () => null, openPath: () => '', diskOf: () => ({ free }), fsx });
  const cleanup = new Cleanup({
    userData, home: path.join(root, 'home'), platform: 'linux', env: {}, settle: 0, fsx,
    cfg: () => state.cfg, save, installed,
    ollamaApi: { list: async () => [], remove: async () => {} },
    ollamaHost: { status: () => ({}), stop() {} }, chatterbox: { stop() {} },
    piper: { stop() {}, defaultDir: () => folder.sub('piper') },
    nodeTools: {}, provision: { running: false }, run: async () => ({ ok: true }),
  });
  const calls = { check: [] };
  const move = new Relocate({
    cleanup, folder, cfg: () => state.cfg, save, installed, fsx, settle: 0, diskOf: () => ({ free }),
    busy: () => busy, stop: () => { state.stops++; }, after: () => { state.after++; },
    nodeTools: { removeFromUserPath: (d) => state.path.push(['remove', d]), addToUserPath: (d) => { state.path.push(['add', d]); return { ok: true }; } },
    tools: tools || {
      findPython: (d) => (fs.existsSync(path.join(d, 'venv', 'bin', 'python3')) ? path.join(d, 'venv', 'bin', 'python3') : null),
      hasChatterbox: (py) => { calls.check.push(py); return true; },
    },
    ...(sameDisk ? { sameDisk } : {}),
  });
  return { move, state, cleanup, folder, installed, oldRoot, newRoot, userData, root, calls };
}
const finish = async (w) => { await w.move.job; return w.move.snapshot(); };

test('copyTree: files, folders, links as links, big ones in pieces with the bytes counted; a signal that has fired ends it', async () => {
  const from = fresh('src');
  put(path.join(from, 'a', 'one.txt'), 100);
  put(path.join(from, 'a', 'b', 'two.txt'), 200);
  put(path.join(from, 'big.bin'), 33 * 1048576);
  fs.symlinkSync('a/one.txt', path.join(from, 'link'));
  const to = path.join(fresh('dst'), 'copy');
  let bytes = 0;
  await copyTree(from, to, { onBytes: (k) => { bytes += k; } });
  assert.deepEqual(tree(to), ['a/b/two.txt', 'a/one.txt', 'big.bin', 'link']);
  assert.equal(fs.lstatSync(path.join(to, 'link')).isSymbolicLink(), true);
  assert.equal(fs.statSync(path.join(to, 'big.bin')).size, 33 * 1048576);
  assert.equal(bytes, 100 + 200 + 33 * 1048576);
  await assert.rejects(() => copyTree(from, path.join(fresh('dst'), 'x'), { signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('what is hers and not in the folder in use is listed (cheaply), with where each goes; what is not hers is not', () => {
  const w = world();
  assert.deepEqual(w.move.candidates(), ['chatterbox', 'piper', 'ollama', 'node']);
  const places = Object.fromEntries(w.move.places().map((p) => [p.kind, p]));
  assert.equal(places.chatterbox.to, path.join(w.newRoot, 'chatterbox'));
  assert.equal(places.node.from, path.join(w.oldRoot, 'node'), 'the folder "node", not the one with the program in it');
  assert.equal(places.ollama.to, path.join(w.newRoot, 'ollama'));
  const yours = world({ oldMarked: false });
  assert.deepEqual(yours.move.candidates(), [], 'folders in a place that was not made for her are yours');
  const there = world();
  there.state.cfg.dataDir = there.oldRoot;
  assert.deepEqual(there.move.candidates(), [], 'what is in the folder in use already stays');
});

test('on one disk it is renamed: everything is in the new place, the old folder goes, her settings point there, her programs are stopped and started again', async () => {
  const w = world();
  const before = ['chatterbox', 'node', 'ollama', 'piper'].map((k) => tree(path.join(w.oldRoot, k)).length);
  assert.deepEqual(await w.move.start(), { ok: true });
  assert.equal(w.move.snapshot().running, true);
  const end = await finish(w);
  assert.equal(end.ok, true, JSON.stringify(end));
  assert.deepEqual(end.moved, ['chatterbox', 'piper', 'ollama', 'node']);
  assert.deepEqual(['chatterbox', 'node', 'ollama', 'piper'].map((k) => tree(path.join(w.newRoot, k)).length), before);
  assert.ok(fs.existsSync(path.join(w.newRoot, 'chatterbox', 'huggingface', 'hub', 'm.bin')));
  assert.ok(fs.existsSync(path.join(w.newRoot, 'ollama', 'models', 'blobs', 'b1')), 'the models went with Ollama');
  assert.equal(fs.existsSync(w.oldRoot), false, 'the old Capri folder, empty but for her mark, went');
  assert.equal(w.state.cfg.chatterboxDir, path.join(w.newRoot, 'chatterbox'));
  assert.equal(w.state.cfg.ollamaDir, path.join(w.newRoot, 'ollama'));
  assert.equal(w.state.cfg.piperDir, '', 'Piper in the default place of the folder in use needs no naming');
  assert.deepEqual(w.state.path, [['remove', path.join(w.oldRoot, 'node')], ['add', path.join(w.newRoot, 'node', 'node-v22')]]);
  assert.equal(w.installed.get().node.dir, path.join(w.newRoot, 'node', 'node-v22'));
  assert.equal(w.installed.get().ollama.dir, path.join(w.newRoot, 'ollama'));
  assert.equal(w.state.stops, 1);
  assert.equal(w.state.after, 1);
  assert.equal(w.move.candidates().length, 0, 'nothing is left to move');
  assert.deepEqual(w.state.saved.filter((s) => 'dataDir' in s), []);
});

test('on another disk it is copied beside, put in place, and only then is the old one removed; the bar counts the bytes', async () => {
  const hold = { rename: 0 };
  const exdev = { ...fs, renameSync: (a, b) => { if (!String(a).endsWith('.part')) { hold.rename++; throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); } return fs.renameSync(a, b); } };
  const w = world({ fsx: exdev });
  const seen = [];
  w.move.on('change', (s) => seen.push(s));
  await w.move.start();
  const end = await finish(w);
  assert.equal(end.ok, true, JSON.stringify(end));
  assert.ok(hold.rename >= 4, 'a rename was tried for each, and did not do');
  assert.deepEqual(tree(path.join(w.newRoot, 'chatterbox')).length, 4);
  assert.deepEqual(fs.readdirSync(w.newRoot).filter((f) => f.endsWith('.part')), [], 'no half copy is left');
  assert.equal(fs.existsSync(w.oldRoot), false);
  assert.equal(end.done, end.total, 'the bar ends full');
  assert.ok(seen.some((s) => s.kind === 'ollama'), 'the one being moved is told');
  assert.equal(w.state.cfg.ollamaDir, path.join(w.newRoot, 'ollama'));
});

test('stopped in the middle of a copy: the copy goes, the old folder is as it was, her settings are as they were', async () => {
  let files = 0;
  const w0 = {};
  const slow = { ...fs, renameSync: (a, b) => { if (!String(a).endsWith('.part')) throw Object.assign(new Error('x'), { code: 'EXDEV' }); return fs.renameSync(a, b); } };
  slow.promises = { ...fs.promises, copyFile: async (a, b) => { if (++files === 3) w0.move.cancel(); return fs.promises.copyFile(a, b); } };
  const w = world({ fsx: slow, hers: ['chatterbox', 'piper'] });
  w0.move = w.move;
  const oldFiles = tree(path.join(w.oldRoot, 'chatterbox'));
  await w.move.start();
  assert.equal(w.move.snapshot().stopping || w.move.snapshot().running, true);
  const end = await finish(w);
  assert.equal(end.cancelled, true);
  assert.equal(end.failed.length, 0, 'a stop is not a failure');
  assert.deepEqual(tree(path.join(w.oldRoot, 'chatterbox')), oldFiles, 'nothing was taken from the old one');
  assert.equal(fs.existsSync(path.join(w.newRoot, 'chatterbox')), false);
  assert.deepEqual(fs.readdirSync(w.newRoot).filter((f) => f !== dl.MARK), [], 'and no half copy is left');
  assert.equal(w.state.cfg.chatterboxDir, path.join(w.oldRoot, 'chatterbox'));
  assert.equal(w.state.after, 1, 'her programs are started again all the same');
  assert.equal(w.move.snapshot().ok, false);
});

test('a folder that does not work in its new place is put back: the renamed one renamed back, the copy removed', async () => {
  const broken = { findPython: (d) => (d.startsWith(path.join(base)) && !d.includes(`${path.sep}D${path.sep}`) && fs.existsSync(path.join(d, 'venv', 'bin', 'python3')) ? path.join(d, 'venv', 'bin', 'python3') : null), hasChatterbox: () => true };
  const w = world({ hers: ['chatterbox'], tools: broken });
  await w.move.start();
  const end = await finish(w);
  assert.equal(end.ok, false);
  assert.equal(end.failed[0].kind, 'chatterbox');
  assert.match(end.failed[0].error, /did not work/);
  assert.equal(tree(path.join(w.oldRoot, 'chatterbox')).length, 4, 'back where it was');
  assert.equal(fs.existsSync(path.join(w.newRoot, 'chatterbox')), false);
  assert.equal(w.state.cfg.chatterboxDir, path.join(w.oldRoot, 'chatterbox'));
  // and one whose package is gone in the new place: the same
  const noPackage = world({ hers: ['chatterbox'], tools: { findPython: (d) => path.join(d, 'venv', 'bin', 'python3'), hasChatterbox: (py) => py.includes(`${path.sep}C${path.sep}`) } });
  await noPackage.move.start();
  const end2 = await finish(noPackage);
  assert.equal(end2.failed.length, 1);
  assert.equal(tree(path.join(noPackage.oldRoot, 'chatterbox')).length, 4);
});

test('what cannot go: nothing to move, something lying in the place already, no room on the other disk, something else going on', async () => {
  const none = world({ hers: [] });
  assert.deepEqual(await none.move.start(), { ok: false, error: 'nothing' });
  const taken = world({ hers: ['piper'] });
  put(path.join(taken.newRoot, 'piper', 'yours.txt'));
  assert.deepEqual(await taken.move.start(), { ok: false, error: 'taken' });
  assert.deepEqual(tree(path.join(taken.oldRoot, 'piper')).length, 2, 'untouched');
  const half = world({ hers: ['piper', 'node'] });
  put(path.join(half.newRoot, 'piper', 'yours.txt'));
  const plan = await half.move.plan();
  assert.deepEqual(plan.conflicts.map((c) => c.kind), ['piper']);
  assert.deepEqual(plan.items.map((i) => i.kind), ['node']);
  await half.move.start();
  const end = await finish(half);
  assert.deepEqual(end.moved, ['node']);
  assert.deepEqual(end.skipped, ['piper'], 'the one that could not go is said');
  const tight = world({ free: 1000, sameDisk: () => false, hers: ['ollama'] });
  const p = await tight.move.plan();
  assert.equal(p.enough, false);
  assert.ok(p.need > 900);
  assert.deepEqual(await tight.move.start(), { ok: false, error: 'space', need: p.need, free: 1000 });
  const same = world({ free: 1000, sameDisk: () => true, hers: ['ollama'] });
  assert.equal((await same.move.plan()).enough, true, 'on one disk a rename takes no room');
  const busy = world({ busy: 'preparing' });
  assert.deepEqual(await busy.move.start(), { ok: false, error: 'preparing' });
});

test('one move at a time, and "Stop" with nothing going on does nothing', async () => {
  const w = world({ hers: ['piper'] });
  w.move.cancel();
  assert.equal(w.move.snapshot().cancelled, false);
  await w.move.start();
  assert.equal((await w.move.start()).error, 'busy');
  await finish(w);
  assert.equal(w.move.busy, false);
});

test('a folder moved by hand is found again: her settings name where it was, the folder in use has it', () => {
  const w = world({ hers: [] });
  put(path.join(w.newRoot, 'chatterbox', 'venv', 'bin', 'python3'));
  put(path.join(w.newRoot, 'ollama', 'ollama.exe'));
  put(path.join(w.newRoot, 'piper', 'piper', 'piper'));
  Object.assign(w.state.cfg, { chatterboxDir: path.join(w.root, 'gone', 'chatterbox'), ollamaDir: path.join(w.root, 'gone', 'ollama'), piperDir: path.join(w.root, 'gone', 'piper') });
  assert.deepEqual(w.move.adopt().sort(), ['chatterbox', 'ollama', 'piper']);
  assert.equal(w.state.cfg.chatterboxDir, path.join(w.newRoot, 'chatterbox'));
  assert.equal(w.state.cfg.ollamaDir, path.join(w.newRoot, 'ollama'));
  assert.equal(w.state.cfg.piperDir, '');
  assert.deepEqual(w.move.adopt(), [], 'once is enough');
  // a name that is there is left alone, and so is nothing named
  const fine = world({ hers: ['piper'] });
  const before = { ...fine.state.cfg };
  assert.deepEqual(fine.move.adopt(), []);
  assert.deepEqual(fine.state.cfg, before);
  const empty = world({ hers: [] });
  assert.deepEqual(empty.move.adopt(), []);
});

test('the Capri folder she leaves goes when nothing but her mark is left in it; one with something of yours stays', async () => {
  const w = world({ hers: ['piper'] });
  put(path.join(w.oldRoot, 'my-notes.txt'));
  await w.move.start();
  await finish(w);
  assert.ok(fs.existsSync(path.join(w.oldRoot, 'my-notes.txt')));
  assert.equal(fs.existsSync(path.join(w.oldRoot, 'piper')), false);
});
