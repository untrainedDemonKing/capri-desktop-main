'use strict';

// Getting her mind (Ollama) and her voice (Chatterbox) ready by herself (src/main/provision.js), with
// stand-ins for what is slow or far: the Ollama program and its model fetch, the Python tools, the voice
// server. The real pieces together are in tests/prepare.e2e.test.js.
//   node --test tests/provision.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { Provision, pickInstalled, chooseModel, bytes } = require('../src/main/provision.js');

const GB = 1024 ** 3;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-prov-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const mk = (...p) => { const d = path.join(tmp, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const touch = (f, t = '') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };

test('the model to talk with: yours, then the ones she likes, never an embedding or an eyes-only one if another can talk', () => {
  assert.equal(pickInstalled(['gemma3:4b', 'qwen2.5:7b'], 'gemma3:4b'), 'gemma3:4b', 'the one in her config, if there');
  assert.equal(pickInstalled(['mistral:7b', 'gemma3:4b', 'qwen2.5:7b']), 'qwen2.5:7b', 'else the best she likes');
  assert.equal(pickInstalled(['nomic-embed-text:latest', 'llava:7b', 'gemma3:4b']), 'gemma3:4b');
  assert.equal(pickInstalled(['nomic-embed-text:latest', 'llava:7b']), 'llava:7b', 'eyes only is still better than nothing');
  assert.equal(pickInstalled(['nomic-embed-text:latest']), null, 'an embedding cannot talk');
  assert.equal(pickInstalled([]), null);
  assert.equal(pickInstalled(['weird:1b']), 'weird:1b', 'a model she has not heard of');
  assert.equal(pickInstalled(['gemma3:4b'], 'gone:1b'), 'gemma3:4b', 'a config model that is not installed is not chosen');
});

test('the model to fetch fits the PC: a big card, a middling one, a small PC', () => {
  assert.equal(chooseModel({ ram: 32 * GB, vram: 24 * GB }), 'qwen2.5:7b');
  assert.equal(chooseModel({ ram: 32 * GB, vram: 8 * GB }), 'gemma3:4b', 'the voice wants the card too');
  assert.equal(chooseModel({ ram: 32 * GB, vram: 0 }), 'qwen2.5:7b', 'no card: the RAM decides');
  assert.equal(chooseModel({ ram: 16 * GB, vram: 0 }), 'gemma3:4b');
  assert.equal(chooseModel({ ram: 8 * GB, vram: 0 }), 'llama3.2');
  assert.equal(chooseModel({ ram: 16 * GB, vram: 4 * GB }), 'gemma3:4b');
  assert.equal(chooseModel(), 'llama3.2');
  assert.equal(bytes(3.3 * GB, 'ru'), '3.3 ГБ');
  assert.equal(bytes(200 * 1048576, 'en'), '200 MB');
});

// ---- stand-ins ----

let worlds = 0;
function world(overrides = {}) {
  const cfg = { provider: 'ollama', ttsEngine: 'system', voiceMode: 'chat', provisioned: false, chatModel: null, chatterboxDir: '', chatterboxUrl: '', ollamaDir: '', ...(overrides.cfg || {}) };
  const saved = [];
  const state = {
    ollamaRunning: false, ollamaFound: true, ollamaStartFails: '', models: [], pullFails: '', pulls: [],
    cbPhase: 'off', cbProgress: [], cbFails: '', hasPackage: true, pipFails: false, systemPython: { cmd: 'python3', pre: [], version: '3.11.4' },
    installed: [], ...(overrides.state || {}),
  };
  const ollamaHost = {
    versionFn: async () => (state.ollamaRunning ? '0.1' : ''),
    locate: async () => (state.ollamaFound ? { exe: '/o/ollama', dir: '/o', modelsDir: null, where: 'folder' } : null),
    ready: async () => {
      if (state.ollamaStartFails) throw Object.assign(new Error(state.ollamaStartFails), { code: 'exited' });
      state.ollamaRunning = true;
      return true;
    },
    stop() {},
    status: () => ({ phase: state.ollamaRunning ? 'ready' : 'off', modelsDir: '', log: ['line'] }),
  };
  const events = new EventEmitter();
  const chatterbox = Object.assign(events, {
    status: () => ({ phase: state.cbPhase, error: state.cbFails, progress: state.cbProgress[0] ?? null, device: 'cuda', log: ['loading'] }),
    async sync() {
      if (state.cbPhase === 'off') {
        state.cbPhase = 'starting';
        const steps = [...state.cbProgress];
        const tick = () => {
          if (state.cbFails) { state.cbPhase = 'failed'; return; }
          if (steps.length > 1) { steps.shift(); state.cbProgress = steps; setTimeout(tick, 20); return; }
          state.cbProgress = [];
          state.cbPhase = 'ready';
        };
        setTimeout(tick, 20);
      }
    },
    async restart() {
      state.cbPhase = 'off';
      state.cbFails = '';
      await this.sync();
    },
  });
  const tools = {
    hasChatterbox: () => state.hasPackage,
    findSystemPython: () => state.systemPython,
    createVenv: (_sys, dir) => { const py = path.join(dir, 'venv', 'bin', 'python3'); touch(py); touch(path.join(dir, 'venv', 'pyvenv.cfg')); state.hasPackage = false; return py; },
    installTarget: () => ({ args: ['chatterbox-tts'], label: 'x' }),
    pip: async (_py, _args, onLine) => {
      onLine?.('Collecting torch');
      onLine?.('Downloading torch-2.6.0-cp311-win_amd64.whl (2.5 GB)');
      if (state.pipFails) return { ok: false, tail: ['ERROR: no matching distribution'] };
      state.hasPackage = true;
      return { ok: true, tail: [] };
    },
    pipActivity: require('../src/main/chatterbox-setup.js').pipActivity,
    torchStatus: () => ({ version: '2.6.0', audio: '2.6.0', cuda: true }),
    hasNvidia: async () => false,
    cudaTorchArgs: () => [],
  };
  const api = {
    models: async () => [...state.models],
    pull: async (name, onProgress, signal) => {
      state.pulls.push(name);
      if (state.pullFails) throw new Error(state.pullFails);
      for (const done of [1, 2, 3, 4]) {
        if (signal?.aborted) throw new Error('aborted');
        onProgress({ completed: done * 1e8, total: 4e8 });
        await new Promise((r) => setTimeout(r, 5));
      }
      state.models.push(name);
    },
  };
  const p = new Provision({
    cfg: () => cfg,
    save: (patch) => { saved.push(patch); Object.assign(cfg, patch); },
    lang: () => 'en',
    ollamaHost, chatterbox, ollamaApi: api, tools,
    installOllama: overrides.installOllama === undefined ? async () => { state.installed.push('ollama'); state.ollamaFound = true; return { ok: true }; } : overrides.installOllama,
    downloadOllama: null,
    installPython: async () => { state.installed.push('python'); state.systemPython = { cmd: 'python3', pre: [], version: '3.11.4' }; return { ok: true }; },
    roots: () => [path.join(tmp, 'roots')],
    defaultDir: () => path.join(tmp, 'userdata', `chatterbox-${++worlds}`),
    hardware: async () => ({ ram: 32 * GB, vram: 8 * GB }),
    onModelsChanged: async () => {},
    ...(overrides.deps || {}),
  });
  return { p, cfg, saved, state };
}
const states = (p) => Object.fromEntries(p.steps.map((s) => [s.id, s.state]));

// a Chatterbox folder next to her with an environment that has the package
function readyFolder(name) {
  const dir = mk('roots', name);
  touch(path.join(dir, 'venv', 'bin', 'python3'));
  touch(path.join(dir, 'venv', 'pyvenv.cfg'), 'home = /usr/bin');
  return dir;
}

test('everything is there already: nothing is shown, nothing is fetched, her choices are made once', async () => {
  const dir = readyFolder('Chatterbox-Ready');
  const { p, saved, state, cfg } = world({ state: { ollamaRunning: true, models: ['gemma3:4b'], hasPackage: true, cbProgress: [] } });
  await p.run();
  assert.deepEqual(states(p), { 'ollama-find': 'done', 'ollama-run': 'done', 'ollama-model': 'done', 'cb-find': 'done', 'cb-python': 'done', 'cb-package': 'done', 'cb-model': 'done' });
  assert.equal(p.ok, true);
  assert.equal(p.attention, false, 'nothing long happened: the window stays shut');
  assert.deepEqual(state.pulls, []);
  assert.deepEqual(state.installed, []);
  assert.equal(cfg.ttsEngine, 'chatterbox', 'the first time she takes Chatterbox as her voice');
  assert.equal(cfg.provisioned, true);
  assert.equal(cfg.chatModel, 'gemma3:4b');
  assert.match(p.step('cb-find').detail, new RegExp(dir.replace(/[\\/]/g, '.')));
  assert.ok(saved.length >= 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a fresh PC: she installs Ollama, starts it, fetches a model, makes the folder, the environment, the package and the voice, and says how far she is', async () => {
  const { p, state, cfg } = world({ state: { ollamaFound: false, hasPackage: false, cbProgress: [0.2, 0.6, 1] } });
  const changes = [];
  p.on('change', (s) => changes.push(s));
  await p.run();
  assert.equal(p.ok, true, JSON.stringify(states(p)));
  assert.deepEqual(state.installed, ['ollama']);
  assert.deepEqual(state.pulls, ['gemma3:4b'], 'a model that fits 8 GB of card next to the voice');
  assert.equal(cfg.chatModel, 'gemma3:4b');
  assert.match(cfg.chatterboxDir, /userdata[\\/]chatterbox-\d+$/, 'the folder she made is remembered');
  assert.equal(cfg.ttsEngine, 'chatterbox');
  assert.equal(p.attention, true, 'long jobs were done: the window was worth showing');
  // the progress of the fetch went up, one step at a time
  const pulled = changes.map((c) => c.steps.find((s) => s.id === 'ollama-model')).filter((s) => s.state === 'running' && s.progress !== null).map((s) => s.progress);
  assert.ok(pulled.length >= 3 && pulled.every((v, i) => i === 0 || v >= pulled[i - 1]) && pulled[pulled.length - 1] === 1, `progress ${pulled}`);
  assert.match(changes.find((c) => c.steps.find((s) => s.id === 'ollama-model').progress === 0.5)?.steps.find((s) => s.id === 'ollama-model').detail || '', /gemma3:4b: \d+ MB of \d+ MB/);
  // what pip said shows on the step
  assert.ok(changes.some((c) => /torch/.test(c.steps.find((s) => s.id === 'cb-package').detail)));
  // the voice's own download is shown as a download
  assert.ok(changes.some((c) => /Fetching the voice model: \d+%/.test(c.steps.find((s) => s.id === 'cb-model').detail)));
});

test('what she is not using she does not prepare: Claude for the mind, ElevenLabs for the voice', async () => {
  const { p } = world({ cfg: { provider: 'anthropic', ttsEngine: 'elevenlabs', provisioned: true } });
  await p.run();
  assert.equal(p.ok, true);
  assert.ok(p.steps.every((s) => s.state === 'skipped'));
  assert.deepEqual(p.plan, { ollama: false, chatterbox: false, adopt: false });
  // and a voice she was given before is not taken from you the first time either
  const w = world({ cfg: { provider: 'ollama', ttsEngine: 'openai', provisioned: false }, state: { ollamaRunning: true, models: ['gemma3:4b'] } });
  await w.p.run();
  assert.equal(w.cfg.ttsEngine, 'openai');
  assert.equal(w.p.step('cb-find').state, 'skipped');
  assert.equal(w.p.step('ollama-model').state, 'done');
  // the voice she has picked herself before is looked after on every start
  const again = world({ cfg: { provider: 'anthropic', ttsEngine: 'chatterbox', provisioned: true }, state: { hasPackage: true } });
  readyFolder('Chatterbox-Again');
  await again.p.run();
  assert.equal(again.p.step('ollama-find').state, 'skipped');
  assert.equal(again.p.step('cb-model').state, 'done');
  fs.rmSync(path.join(tmp, 'roots', 'Chatterbox-Again'), { recursive: true, force: true });
});

test('a server of your own for the voice: nothing is installed', async () => {
  const { p, cfg } = world({ cfg: { provider: 'anthropic', ttsEngine: 'system', chatterboxUrl: 'http://127.0.0.1:8004/v1' } });
  await p.run();
  assert.equal(p.ok, true);
  assert.deepEqual(['cb-find', 'cb-python', 'cb-package'].map((id) => p.step(id).state), ['skipped', 'skipped', 'skipped']);
  assert.match(p.step('cb-model').detail, /your own server/);
  assert.equal(cfg.ttsEngine, 'chatterbox');
});

test('Ollama that cannot be found and cannot be installed: a clear failure with the buttons that help, and the voice goes on', async () => {
  const { p } = world({ state: { ollamaFound: false, cbProgress: [] }, installOllama: async () => ({ ok: false, error: 'no winget' }), cfg: { ttsEngine: 'chatterbox', provisioned: true } });
  readyFolder('Chatterbox-Alone');
  await p.run();
  assert.equal(p.ok, false);
  const f = p.step('ollama-find');
  assert.equal(f.state, 'failed');
  assert.match(f.error, /did not find Ollama/);
  assert.deepEqual(f.actions, ['retry', 'choose-ollama', 'open-ollama-site']);
  assert.equal(p.step('ollama-run').state, 'pending', 'what depends on it waits');
  assert.equal(p.step('cb-model').state, 'done', 'the other group is not held up by it');
  assert.equal(p.attention, true);
  // fixed (installed by hand), pressed "try again": goes through
  const w = world({ state: { ollamaFound: false }, installOllama: async () => ({ ok: false }), cfg: { ttsEngine: 'openai' } });
  await w.p.run();
  assert.equal(w.p.step('ollama-find').state, 'failed');
  w.state.ollamaFound = true;
  w.state.models = ['gemma3:4b'];
  await w.p.retry();
  assert.equal(w.p.ok, true, JSON.stringify(states(w.p)));
  fs.rmSync(path.join(tmp, 'roots', 'Chatterbox-Alone'), { recursive: true, force: true });
});

test('an Ollama that will not start says why, and the model fetch that fails says why and can be tried again', async () => {
  const a = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaStartFails: 'Error: bind: address already in use' } });
  await a.p.run();
  assert.equal(a.p.step('ollama-run').state, 'failed');
  assert.match(a.p.step('ollama-run').error, /address already in use/);
  assert.deepEqual(a.p.step('ollama-run').actions, ['retry', 'choose-ollama']);
  assert.deepEqual(a.p.step('ollama-run').log, ['line'], 'its last lines for the details');
  const b = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaRunning: true, pullFails: 'dial tcp: lookup registry.ollama.ai: no such host' } });
  await b.p.run();
  assert.equal(b.p.step('ollama-model').state, 'failed');
  assert.match(b.p.step('ollama-model').error, /Could not fetch the model gemma3:4b: dial tcp/);
  assert.equal(b.p.ok, false);
  b.state.pullFails = '';
  await b.p.retry();
  assert.equal(b.p.ok, true);
  assert.equal(b.cfg.chatModel, 'gemma3:4b');
});

test('the voice: no Python is installed with winget when it can; a wrong Python is said; pip failing is shown with its last lines; the voice failing too', async () => {
  // no Python at all: installed (the stand-in for winget), then the environment is made
  const a = world({ cfg: { provider: 'anthropic' }, state: { hasPackage: false, systemPython: null } });
  await a.p.run();
  assert.deepEqual(a.state.installed, ['python']);
  assert.equal(a.p.ok, true, JSON.stringify(states(a.p)));
  // a Python that is too new, and nothing can install another
  const b = world({ cfg: { provider: 'anthropic' }, state: { hasPackage: false, systemPython: { tooNew: '3.13.1' } }, deps: { installPython: null } });
  await b.p.run();
  const py = b.p.step('cb-python');
  assert.equal(py.state, 'failed');
  assert.match(py.error, /Python 3\.10–3\.12 is needed \(I found 3\.13\.1/);
  assert.ok(py.actions.includes('open-python-site'));
  // pip fails
  const c = world({ cfg: { provider: 'anthropic' }, state: { hasPackage: false, pipFails: true } });
  await c.p.run();
  assert.equal(c.p.step('cb-package').state, 'failed');
  assert.match(c.p.step('cb-package').error, /Could not install Chatterbox: ERROR: no matching distribution/);
  assert.deepEqual(c.p.step('cb-package').log, ['ERROR: no matching distribution']);
  // the voice server fails to load the model
  readyFolder('Chatterbox-Broken');
  const d = world({ cfg: { provider: 'anthropic', ttsEngine: 'chatterbox', provisioned: true }, state: { cbFails: 'RuntimeError: CUDA out of memory' } });
  await d.p.run();
  assert.equal(d.p.step('cb-model').state, 'failed');
  assert.match(d.p.step('cb-model').error, /did not start: RuntimeError: CUDA out of memory/);
  d.state.cbFails = '';
  await d.p.retry();
  assert.equal(d.p.step('cb-model').state, 'done');
  fs.rmSync(path.join(tmp, 'roots', 'Chatterbox-Broken'), { recursive: true, force: true });
});

test('stopping while a model is being fetched stops the fetch and says so', async () => {
  const w = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaRunning: true } });
  const run = w.p.run();
  await new Promise((r) => setTimeout(r, 8));
  w.p.cancel();
  await run;
  assert.equal(w.p.ok, false);
  assert.equal(w.p.step('ollama-model').state, 'failed');
  assert.equal(w.p.running, false);
});

test('the report says what is done and what failed, for pasting into a message', async () => {
  const w = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaFound: false }, installOllama: async () => ({ ok: false }) });
  await w.p.run();
  const text = w.p.report();
  assert.match(text, /\[failed\] ollama-find/);
  assert.match(text, /error: I did not find Ollama/);
  assert.match(text, /plan: \{"ollama":true/);
  assert.match(text, /ollama: \{"phase":"off"/);
});
