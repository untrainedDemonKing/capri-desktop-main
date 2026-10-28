'use strict';

// Ollama found, started and kept by her (src/main/ollama-host.js), against a stand-in `ollama` program
// (tests/fixtures/fake-ollama.js: the real server's answers for what she asks, canned).
//   node --test tests/ollama-host.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { OllamaHost, findExe, findModelsDir } = require('../src/main/ollama-host.js');
const ollama = require('../src/main/ollama.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-ol-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const mk = (...parts) => {
  const dir = path.join(tmp, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const touch = (file, text = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const posix = process.platform !== 'win32';

// a folder like the ones people have: the program in a folder, the models beside it
function installFake(root, models) {
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const exe = path.join(root, 'bin', 'ollama');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-ollama.js'), exe);
  fs.chmodSync(exe, 0o755);
  fs.mkdirSync(path.join(root, 'models', 'blobs'), { recursive: true });
  for (const m of models) {
    const [n, t = 'latest'] = m.split(':');
    touch(path.join(root, 'models', 'manifests', 'registry.ollama.ai', 'library', n, t), '{}');
  }
  return exe;
}

test('the program and the models are found in a folder, a few folders deep', () => {
  const win = mk('win', 'Ollama');
  touch(path.join(win, 'ollama app.exe'));
  touch(path.join(win, 'ollama.exe'));
  assert.equal(findExe(win, { platform: 'win32' }), path.join(win, 'ollama.exe'), 'not the tray program');
  const nested = mk('nested', 'ollama-portable');
  touch(path.join(nested, 'app', 'bin', 'ollama.exe'));
  assert.equal(findExe(nested, { platform: 'win32' }), path.join(nested, 'app', 'bin', 'ollama.exe'));
  assert.equal(findExe(mk('nothing', 'ollama'), { platform: 'win32' }), null);
  touch(path.join(mk('lin', 'ollama'), 'ollama'));
  assert.equal(findExe(path.join(tmp, 'lin', 'ollama'), { platform: 'linux' }), path.join(tmp, 'lin', 'ollama', 'ollama'));
  // the models: the folder with manifests and blobs
  const m = mk('mods', 'ollama');
  mk('mods', 'ollama', 'models', 'blobs');
  mk('mods', 'ollama', 'models', 'manifests');
  assert.equal(findModelsDir(m), path.join(m, 'models'));
  assert.equal(findModelsDir(mk('mods', 'empty')), null);
  const same = mk('mods2', 'm');
  mk('mods2', 'm', 'blobs');
  mk('mods2', 'm', 'manifests');
  assert.equal(findModelsDir(same), same, 'the folder itself may be the models');
});

test('where Ollama is: the folder named, one next to her, the PATH, the usual place, in that order', async () => {
  const roots = mk('locate', 'roots');
  const near = mk('locate', 'roots', 'My-Ollama');
  touch(path.join(near, 'bin', 'ollama'));
  mk('locate', 'roots', 'My-Ollama', 'data', 'blobs');
  mk('locate', 'roots', 'My-Ollama', 'data', 'manifests');
  const host = new OllamaHost({ platform: 'linux', roots: () => [roots], whichFn: async () => '/usr/bin/ollama', places: () => [] });
  let got = await host.locate({});
  assert.equal(got.exe, path.join(near, 'bin', 'ollama'));
  assert.equal(got.where, 'folder');
  assert.equal(got.modelsDir, path.join(near, 'data'), 'its own models go with it');
  // one that was named wins over the one beside her
  const named = mk('locate', 'named');
  touch(path.join(named, 'ollama'));
  got = await host.locate({ ollamaDir: named });
  assert.equal(got.exe, path.join(named, 'ollama'));
  assert.equal(got.where, 'config');
  // a named folder with no Ollama in it is not replaced by another
  assert.equal(await host.locate({ ollamaDir: mk('locate', 'bare') }), null);
  assert.equal(await host.locate({ ollamaDir: path.join(tmp, 'gone') }), null);
  // nothing next to her: the PATH
  const onPath = new OllamaHost({ platform: 'linux', roots: () => [mk('locate', 'none')], whichFn: async () => '/usr/bin/ollama', places: () => [] });
  got = await onPath.locate({});
  assert.deepEqual([got.exe, got.where], ['/usr/bin/ollama', 'path']);
  // nothing on the PATH: the usual place, if it is there
  const usual = touch(path.join(tmp, 'usual', 'ollama'));
  const place = new OllamaHost({ platform: 'linux', roots: () => [], whichFn: async () => null, places: () => [path.join(tmp, 'nope'), usual] });
  got = await place.locate({});
  assert.deepEqual([got.exe, got.where], [usual, 'installed']);
  const nowhere = new OllamaHost({ platform: 'linux', roots: () => [], whichFn: async () => null, places: () => [] });
  assert.equal(await nowhere.locate({}), null);
});

test('she starts the Ollama of the folder with its own models, waits for it, and stops it with herself', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('run', 'Ollama-Portable');
  installFake(root, ['gemma3:4b', 'qwen2.5:7b']);
  const port = await freePort();
  process.env.OLLAMA_HOST = `127.0.0.1:${port}`;
  const log = path.join(tmp, 'run.jsonl');
  process.env.FAKE_OLLAMA_LOG = log;
  const host = new OllamaHost({ roots: () => [path.dirname(root)], pollMs: 100 });
  const phases = [];
  host.on('change', (s) => phases.push(s.phase));
  try {
    assert.equal(await ollama.version(), '', 'nothing answers yet');
    await host.sync({});
    assert.equal(host.status().phase, 'starting');
    assert.equal(host.status().exe, path.join(root, 'bin', 'ollama'));
    assert.equal(host.status().modelsDir, path.join(root, 'models'));
    assert.equal(await host.ready({}, 15000), true);
    assert.equal(host.status().ours, true);
    assert.deepEqual(phases, ['starting', 'ready']);
    // it is her folder's models she sees: the stand-in lists what is in OLLAMA_MODELS
    assert.deepEqual((await ollama.models()).sort(), ['gemma3:4b', 'qwen2.5:7b']);
    // asking again changes nothing
    await host.sync({});
    assert.equal(host.status().phase, 'ready');
  } finally {
    host.stop();
  }
  assert.equal(host.status().phase, 'off');
  let alive = true;
  for (let i = 0; i < 60 && alive; i++) {
    alive = Boolean(await ollama.version());
    if (alive) await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(alive, false, 'her Ollama went with her');
  delete process.env.OLLAMA_HOST;
  delete process.env.FAKE_OLLAMA_LOG;
});

test('an Ollama that already answers is used and left running; none to be found is a clear failure', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('already', 'Ollama');
  const exe = installFake(root, ['llama3.2']);
  const port = await freePort();
  process.env.OLLAMA_HOST = `127.0.0.1:${port}`;
  const cp = require('node:child_process');
  const other = cp.spawn(exe, ['serve'], { env: { ...process.env, OLLAMA_MODELS: path.join(root, 'models') }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && !(await ollama.version()); i++) await new Promise((r) => setTimeout(r, 100));
    let spawned = 0;
    const host = new OllamaHost({ roots: () => [], spawn: () => { spawned++; throw new Error('should not start'); }, whichFn: async () => null, places: () => [] });
    await host.sync({});
    assert.equal(spawned, 0);
    assert.equal(host.status().phase, 'ready');
    assert.equal(host.status().ours, false, 'not hers: she does not stop it');
    host.stop();
    assert.ok(await ollama.version(), 'it is still running');
  } finally {
    other.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
  // nothing answers and there is no Ollama anywhere
  const none = new OllamaHost({ roots: () => [], whichFn: async () => null, places: () => [] });
  await none.sync({});
  assert.equal(none.status().phase, 'failed');
  assert.equal(none.status().code, 'noexe');
  await assert.rejects(() => none.ready({}, 100), (e) => e.code === 'noexe');
  const lost = new OllamaHost({ roots: () => [], whichFn: async () => null, places: () => [] });
  await lost.sync({ ollamaDir: path.join(tmp, 'gone') });
  assert.match(lost.status().error, /no Ollama in/i);
  delete process.env.OLLAMA_HOST;
});

test('a program that dies at once is a failure with its last words, not a wait', { skip: !posix && 'a script' }, async () => {
  const root = mk('dies', 'Ollama');
  const exe = touch(path.join(root, 'ollama'), '#!/bin/sh\necho "Error: listen tcp 127.0.0.1:1: bind: permission denied" >&2\nexit 1\n');
  fs.chmodSync(exe, 0o755);
  process.env.OLLAMA_HOST = `127.0.0.1:${await freePort()}`;
  const host = new OllamaHost({ roots: () => [path.dirname(root)], pollMs: 50 });
  await host.sync({});
  for (let i = 0; i < 60 && host.status().phase === 'starting'; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(host.status().phase, 'failed');
  assert.match(host.status().error, /permission denied/);
  host.stop();
  delete process.env.OLLAMA_HOST;
});

test('ollama.once answers in one go, and ollama.version says "" when nothing answers', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('once', 'Ollama');
  const exe = installFake(root, ['gemma3:4b']);
  const port = await freePort();
  process.env.OLLAMA_HOST = `127.0.0.1:${port}`;
  assert.equal(await ollama.version(), '');
  const cp = require('node:child_process');
  const server = cp.spawn(exe, ['serve'], { env: { ...process.env, OLLAMA_MODELS: path.join(root, 'models') }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && !(await ollama.version()); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await ollama.version(), '0.0.0-fake');
    const text = await ollama.once({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'что на картинке?' }] }, AbortSignal.timeout(5000));
    assert.match(text, /Ты спросил: «что на картинке\?»/);
    await assert.rejects(() => ollama.once({ model: 'no-such', messages: [{ role: 'user', content: 'x' }] }, AbortSignal.timeout(5000)), /not found/);
  } finally {
    server.kill();
    delete process.env.OLLAMA_HOST;
  }
});

test('the profile of the PC: Ollama is started with its settings (but what you set yourself stands), and she asks with its context and keep-alive', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('tuned', 'Ollama-Portable');
  installFake(root, ['gemma3:4b']);
  const port = await freePort();
  process.env.OLLAMA_HOST = `127.0.0.1:${port}`;
  const log = path.join(tmp, 'tuned.jsonl');
  process.env.FAKE_OLLAMA_LOG = log;
  process.env.OLLAMA_NUM_PARALLEL = '7'; // yours
  delete process.env.OLLAMA_MAX_LOADED_MODELS;
  const host = new OllamaHost({ roots: () => [path.dirname(root)], pollMs: 100 });
  host.setEnv({ OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1' });
  ollama.tune({ numCtx: 2048, keepAlive: '10m' });
  try {
    await host.sync({});
    await host.ready({}, 15000);
    await ollama.once({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'hi' }] });
    await ollama.chat({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'hello' }] }, () => {});
    ollama.warm('gemma3:4b');
    await new Promise((r) => setTimeout(r, 300));
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const chat = lines.filter((l) => l.url === '/api/chat');
    assert.equal(chat.length, 2);
    for (const l of chat) assert.deepEqual([l.options.num_ctx, l.keepAlive], [2048, '10m'], 'the same context every time: another would load the model again');
    assert.equal(lines.find((l) => l.url === '/api/generate').options.num_ctx, 2048, 'and the warm-up too');
    assert.deepEqual([lines[0].env.maxLoaded, lines[0].env.parallel], ['1', '7'], 'the profile\'s setting is used, yours is not overridden');
    // no profile: no context of hers (Ollama\'s own), the usual keep-alive
    ollama.tune({});
    await ollama.once({ model: 'gemma3:4b', messages: [{ role: 'user', content: 'again' }] });
    const last = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).pop();
    assert.deepEqual([last.options.num_ctx, last.keepAlive], [undefined, '15m']);
  } finally {
    host.stop();
    ollama.tune({});
    delete process.env.OLLAMA_HOST;
    delete process.env.FAKE_OLLAMA_LOG;
    delete process.env.OLLAMA_NUM_PARALLEL;
  }
});
