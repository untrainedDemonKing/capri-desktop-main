'use strict';

// Her whole preparation with the real pieces and a stand-in for the two models: a fresh PC with an Ollama
// folder (a stand-in program that answers like Ollama) and nothing else; she makes the Chatterbox folder, a real
// Python environment in it, installs the package with the real pip (from a local wheel: no network), starts her
// real voice server around a stub model, fetches a model through the stand-in Ollama, and then a question is
// answered (Ollama's chat, streamed) and her answer is spoken (the voice server's wav).
//   node --test tests/prepare.e2e.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const cp = require('node:child_process');

const { Provision } = require('../src/main/provision.js');
const { Chatterbox } = require('../src/main/chatterbox.js');
const { OllamaHost } = require('../src/main/ollama-host.js');
const tools = require('../src/main/chatterbox-setup.js');
const ollama = require('../src/main/ollama.js');
const tts = require('../src/main/tts.js');

const posix = process.platform !== 'win32';
// A Python on this machine with numpy (the stub voice needs it; a real chatterbox-tts brings its own with torch).
// Chatterbox is built for 3.10 to 3.12, which the real search looks for: here whichever Python has numpy is used.
const python = (() => {
  for (const cmd of ['python3.11', 'python3.12', 'python3.10', 'python3', 'python']) {
    const r = cp.spawnSync(cmd, ['-c', 'import numpy, os; print(os.path.dirname(os.path.dirname(numpy.__file__)))'], { encoding: 'utf8' });
    if (r.status === 0) return { cmd, pre: [], numpyAt: r.stdout.trim() };
  }
  return null;
})();
const skip = (!posix && 'the stand-ins are scripts') || (!python && 'no Python with numpy here');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-e2e-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// a wheel of a stub "chatterbox-tts" (a tone for a voice): built by tests/fixtures/build-stub-wheel.py
function buildWheel(dir) {
  fs.mkdirSync(dir, { recursive: true });
  cp.execFileSync(python.cmd, [...python.pre, path.join(__dirname, 'fixtures', 'build-stub-wheel.py'), path.join(dir, 'chatterbox_tts-0.0.1-py3-none-any.whl')]);
  return dir;
}

// a folder like the ones people drop next to her
function ollamaFolder(root) {
  const dir = path.join(root, 'Ollama-Portable');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'models', 'blobs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'models', 'manifests'), { recursive: true });
  const exe = path.join(dir, 'bin', 'ollama');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-ollama.js'), exe);
  fs.chmodSync(exe, 0o755);
  return dir;
}

test('a fresh PC: she gets her mind and her voice ready by herself, a question is answered by the mind and the answer is spoken by the voice', { skip, timeout: 240000 }, async () => {
  const root = path.join(tmp, 'next-to-her');
  const userData = path.join(tmp, 'userdata');
  fs.mkdirSync(root, { recursive: true });
  ollamaFolder(root);
  const wheels = buildWheel(path.join(tmp, 'wheels'));
  const port = await freePort();
  const cbLog = path.join(tmp, 'chatterbox-calls.jsonl');
  const olLog = path.join(tmp, 'ollama-requests.jsonl');
  // (the stub wheel has no dependencies, so numpy is lent to the new environment from that Python)
  Object.assign(process.env, {
    PYTHONPATH: python.numpyAt, OLLAMA_HOST: `127.0.0.1:${port}`, FAKE_OLLAMA_LOG: olLog, CB_E2E_LOG: cbLog,
    PIP_NO_INDEX: '1', PIP_FIND_LINKS: wheels, PIP_DISABLE_PIP_VERSION_CHECK: '1',
  });
  const cfg = { provider: 'ollama', ttsEngine: 'system', voiceMode: 'chat', provisioned: false, chatModel: null, chatterboxDir: '', chatterboxUrl: '', ollamaDir: '', chatterboxDevice: 'cpu', hfEndpoint: '' };
  const saved = [];
  const roots = () => [root, userData];
  const chatterbox = new Chatterbox({ roots, pollMs: 100 });
  const ollamaHost = new OllamaHost({ roots, pollMs: 100, whichFn: async () => null, places: () => [] });
  const provision = new Provision({
    cfg: () => cfg,
    save: (patch) => { saved.push(patch); Object.assign(cfg, patch); },
    lang: () => 'ru',
    ollamaHost, chatterbox,
    tools: { ...tools, findSystemPython: () => ({ cmd: python.cmd, pre: python.pre, version: 'the one with numpy' }) },
    ollamaApi: { models: () => ollama.models(), pull: (name, onProgress, signal) => ollama.pull(name, onProgress, signal) },
    roots,
    defaultDir: () => path.join(userData, 'chatterbox'),
    hardware: async () => ({ ram: 16 * 1024 ** 3, vram: 0 }),
    onModelsChanged: async () => {},
  });
  const seen = [];
  provision.on('change', (s) => seen.push(s));
  try {
    await provision.run();
    const steps = Object.fromEntries(provision.steps.map((s) => [s.id, `${s.state}${s.error ? `: ${s.error}` : ''}`]));
    assert.equal(provision.ok, true, JSON.stringify(steps, null, 1));
    assert.deepEqual(Object.values(steps), ['done', 'done', 'done', 'done', 'done', 'done', 'done']);
    // the mind
    assert.equal(ollamaHost.status().ours, true);
    assert.equal(cfg.chatModel, 'gemma3:4b', 'a model that fits 16 GB of RAM with no card');
    assert.deepEqual(await ollama.models(), ['gemma3:4b']);
    assert.match(provision.step('ollama-find').detail, /Нашла: .*Ollama-Portable/);
    assert.ok(seen.some((s) => s.steps.find((x) => x.id === 'ollama-model').progress > 0.4 && s.steps.find((x) => x.id === 'ollama-model').progress < 1), 'the fetch showed its progress');
    assert.ok(seen.some((s) => /Скачиваю модель gemma3:4b: \d+ МБ из \d+ МБ/.test(s.steps.find((x) => x.id === 'ollama-model').detail)));
    // the voice: folder made, environment made, package installed with real pip, server up
    assert.equal(cfg.chatterboxDir, path.join(userData, 'chatterbox'));
    assert.ok(fs.existsSync(path.join(userData, 'chatterbox', 'venv', 'bin', 'python3')), 'a real environment');
    assert.equal(tools.hasChatterbox(path.join(userData, 'chatterbox', 'venv', 'bin', 'python3')), true, 'with the package in it');
    assert.equal(cfg.ttsEngine, 'chatterbox');
    assert.equal(cfg.provisioned, true);
    assert.equal(chatterbox.status().phase, 'ready');
    assert.ok(seen.some((s) => s.steps.find((x) => x.id === 'cb-package').heavy), 'the install was a long job');
    assert.equal(provision.attention, true);

    // a question: the mind answers (streamed), as her chat does it
    const pieces = [];
    const answer = await ollama.chat({ model: cfg.chatModel, messages: [{ role: 'user', content: 'Как тебя зовут?' }] }, (p) => pieces.push(p), AbortSignal.timeout(10000));
    assert.match(answer, /Ты спросил: «Как тебя зовут\?»/);
    assert.ok(pieces.length > 3, 'streamed in pieces');
    // and the answer is said: the voice server's wav, through the same call her overlay makes
    const base = await chatterbox.ready(cfg);
    const wav = await tts.speak(cfg, {}, { text: answer, mood: 'happy', lang: 'ru', base });
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.ok(wav.length > 20000, `${wav.length} bytes of her voice`);
    const calls = fs.readFileSync(cbLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls[0].language_id, 'ru');
    assert.ok(calls.map((c) => c.text).join(' ').includes('Ты спросил'), 'what she said is what the mind answered');
    assert.equal(calls[0].exaggeration, 0.7, 'a happy line');

    // the second start-up: everything is there, nothing is fetched or installed, no window is called for
    chatterbox.stop();
    ollamaHost.stop();
    const before = fs.readFileSync(olLog, 'utf8').split('\n').filter((l) => /"url":"\/api\/pull"/.test(l)).length;
    const again = new Provision({
      cfg: () => cfg, save: (p) => Object.assign(cfg, p), lang: () => 'ru', ollamaHost, chatterbox,
      ollamaApi: { models: () => ollama.models(), pull: () => { throw new Error('should not fetch'); } },
      roots, defaultDir: () => path.join(userData, 'chatterbox'), hardware: async () => ({ ram: 0, vram: 0 }), onModelsChanged: async () => {},
    });
    await again.run();
    assert.equal(again.ok, true, JSON.stringify(again.steps.map((s) => [s.id, s.state, s.error])));
    assert.equal(again.attention, false, 'a quiet start-up');
    assert.equal(fs.readFileSync(olLog, 'utf8').split('\n').filter((l) => /"url":"\/api\/pull"/.test(l)).length, before);
    assert.equal(ollamaHost.status().modelsDir, path.join(root, 'Ollama-Portable', 'models'), 'the folder\'s own models');
  } finally {
    chatterbox.stop();
    ollamaHost.stop();
    for (const k of ['PYTHONPATH', 'OLLAMA_HOST', 'FAKE_OLLAMA_LOG', 'CB_E2E_LOG', 'PIP_NO_INDEX', 'PIP_FIND_LINKS', 'PIP_DISABLE_PIP_VERSION_CHECK']) delete process.env[k];
  }
});
