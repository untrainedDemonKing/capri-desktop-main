'use strict';

// Getting her mind (Ollama) and her voice (Chatterbox or Piper) ready by herself, by the PC she is on
// (src/main/setup/provision.js), with stand-ins for what is slow or far: the look at the PC, the Ollama program and its
// model fetch, the Python tools, the voice servers. The real pieces together are in tests/main/prepare.e2e.test.js.
//   node --test tests/main/provision.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { Provision, pickInstalled, sameModel, bytes } = require('../../src/main/setup/provision.js');
const hardware = require('../../src/main/setup/hardware.js');

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

test('an installed model that is the one wanted: the same name, or the same with a variant after it', () => {
  assert.equal(sameModel(['gemma3:4b'], 'gemma3:4b'), 'gemma3:4b');
  assert.equal(sameModel(['gemma3:4b-it-q4_K_M'], 'gemma3:4b'), 'gemma3:4b-it-q4_K_M');
  assert.equal(sameModel(['gemma3:12b'], 'gemma3:1b'), null, '1b is not 12b');
  assert.equal(sameModel(['gemma3:4b'], 'gemma3:1b'), null);
  assert.equal(sameModel([], 'gemma3:4b'), null);
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
    whisperFound: true, whisperModel: 'ggml-small-q5_1.bin', whisperInstalls: 0, whisperChecks: 0, whisperFetches: [], whisperInstallFails: '', whisperModelFails: '', whisperCheckFails: '', recorded: [],
    installed: [], piperFound: false, piperVoice: '', piperInstallFails: '', piperVoiceFails: '', piperCheckFails: '', piperInstalls: 0, voiceFetches: [],
    nodeFound: true, nodeOld: false, nodeInstalls: [], nodeFails: '', nodePath: [], tuned: [], hardwareCalls: [], hw: { ram: 32 * GB, vram: 8 * GB }, hardwareFails: false, cudaCalls: [], pips: [], torchHasCuda: true,
    ...(overrides.state || {}),
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
    pipActivity: require('../../src/main/voice/chatterbox-setup.js').pipActivity,
    torchStatus: () => ({ version: '2.6.0', audio: '2.6.0', cuda: state.torchHasCuda }),
    hasNvidia: async () => false,
    cudaTorchArgs: (torch, gpu) => { state.cudaCalls.push(gpu); return state.cudaNone ? null : ['install', '--force-reinstall', 'torch==cuda']; },
  };
  const realPip = tools.pip;
  tools.pip = async (py, args, onLine) => { state.pips.push(args); return realPip(py, args, onLine); };
  const piper = {
    locate: () => (state.piperFound ? { exe: '/p/piper', dir: '/p', root: '/p' } : null),
    voices: () => (state.piperVoice ? [{ key: state.piperVoice }] : []),
    voiceFor: () => (state.piperVoice ? { key: state.piperVoice } : null),
    install: async ({ onProgress }) => {
      if (state.piperInstallFails) throw new Error(state.piperInstallFails);
      for (const done of [1, 2, 3, 4]) {
        onProgress({ completed: done * 5e6, total: 2e7 });
        await new Promise((r) => setTimeout(r, 3));
      }
      state.piperFound = true;
      state.piperInstalls++;
      return { exe: '/p/piper', dir: '/p', root: '/p' };
    },
    fetchVoice: async (_cfg, lang, { onProgress }) => {
      state.voiceFetches.push(lang);
      if (state.piperVoiceFails) throw new Error(state.piperVoiceFails);
      for (const done of [1, 2]) {
        onProgress({ completed: done * 3e7, total: 6e7 });
        await new Promise((r) => setTimeout(r, 3));
      }
      state.piperVoice = lang === 'ru' ? 'ru_RU-irina-medium' : 'en_US-amy-medium';
      return { key: state.piperVoice, onnx: '/p/voices/x.onnx' };
    },
    check: async () => { if (state.piperCheckFails) throw new Error(state.piperCheckFails); },
    status: () => ({ phase: state.piperCheckFails ? 'failed' : 'ready', voice: state.piperVoice, exe: '/p/piper', log: ['piper log'] }),
  };
  // her ears (whisper.cpp): there already unless a test says otherwise
  const whisperModel = () => (state.whisperModel ? { name: state.whisperModel, file: `/w/models/${state.whisperModel}`, bytes: 190e6 } : null);
  const whisper = {
    locate: () => (state.whisperFound ? { exe: '/w/whisper-server', dir: '/w', root: '/w' } : null),
    models: () => (state.whisperModel ? [whisperModel()] : []),
    modelFor: () => whisperModel(),
    install: async ({ onProgress }) => {
      if (state.whisperInstallFails) throw new Error(state.whisperInstallFails);
      for (const done of [1, 2, 3]) {
        onProgress({ completed: done * 5e6, total: 1.5e7 });
        await new Promise((r) => setTimeout(r, 3));
      }
      state.whisperFound = true;
      state.whisperInstalls++;
      return { exe: '/w/whisper-server', dir: '/w', root: '/w' };
    },
    fetchModel: async (_cfg, tier, { onProgress }) => {
      state.whisperFetches.push(tier);
      if (state.whisperModelFails) throw new Error(state.whisperModelFails);
      for (const done of [1, 2]) {
        onProgress({ completed: done * 6e7, total: 1.2e8 });
        await new Promise((r) => setTimeout(r, 3));
      }
      state.whisperModel = tier === 'base' ? 'ggml-base-q5_1.bin' : tier === 'turbo' ? 'ggml-large-v3-turbo-q5_0.bin' : 'ggml-small-q5_1.bin';
      return { file: `/w/models/${state.whisperModel}` };
    },
    check: async () => { state.whisperChecks++; if (state.whisperCheckFails) throw new Error(state.whisperCheckFails); },
    status: () => ({ phase: state.whisperCheckFails ? 'failed' : 'ready', model: state.whisperModel, exe: '/w/whisper-server', error: state.whisperCheckFails, log: ['whisper log'] }),
  };
  const nodeTools = {
    findNode: async () => (state.nodeFound ? { exe: 'C:\\nodejs\\node.exe', version: '22.1.0', where: 'path' } : state.nodeOld ? { tooOld: '16.0.0' } : null),
    install: async ({ dir, arch, onProgress }) => {
      if (state.nodeFails) throw new Error(state.nodeFails);
      for (const done of [1, 2, 3]) { onProgress({ completed: done * 1e7, total: 3e7 }); await new Promise((r) => setTimeout(r, 3)); }
      state.nodeInstalls.push({ dir, arch });
      state.nodeFound = true;
      return { exe: path.join(dir, 'node.exe'), dir, version: '24.22.1' };
    },
    addToUserPath: (dir) => { state.nodePath.push(dir); return { ok: true }; },
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
    ollamaHost, chatterbox, piper, whisper, ollamaApi: api, tools, nodeTools, record: (kind, value) => state.recorded.push([kind, value]), nodeDir: () => path.join(tmp, 'userdata', 'node'), platform: overrides.platform || 'win32',
    installOllama: overrides.installOllama === undefined ? async () => { state.installed.push('ollama'); state.ollamaFound = true; return { ok: true }; } : overrides.installOllama,
    downloadOllama: null,
    installPython: async () => { state.installed.push('python'); state.systemPython = { cmd: 'python3', pre: [], version: '3.11.4' }; return { ok: true }; },
    roots: () => [path.join(tmp, 'roots')],
    defaultDir: () => path.join(tmp, 'userdata', `chatterbox-${++worlds}`),
    hardware: async (opts) => {
      state.hardwareCalls.push(opts);
      if (state.hardwareFails) throw new Error('powershell is not there');
      return state.hw;
    },
    tune: (tuning, id) => state.tuned.push({ ...tuning, id }),
    onModelsChanged: async () => {},
    ...(overrides.deps || {}),
  });
  return { p, cfg, saved, state, piper };
}
// (the steps of her ears are asked for by the tests of her ears: `states(p, true)`)
const states = (p, ears = false) => Object.fromEntries(p.steps.filter((s) => ears || s.group !== 'ears').map((s) => [s.id, s.state]));

// (a test that fails must not leave its folder next to her for the next one to find)
test.afterEach(() => {
  // (every folder a test made: each one makes the one it needs)
  let left = [];
  try {
    left = fs.readdirSync(path.join(tmp, 'roots')).filter((n) => /^Chatterbox-/.test(n));
  } catch { /* no test has made the place yet */ }
  for (const name of left) fs.rmSync(path.join(tmp, 'roots', name), { recursive: true, force: true });
});

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
  assert.deepEqual(states(p), {
    scan: 'done', node: 'done', 'ollama-find': 'done', 'ollama-run': 'done', 'ollama-model': 'done', 'cb-find': 'done', 'cb-python': 'done', 'cb-package': 'done', 'cb-model': 'done',
    'pp-find': 'skipped', 'pp-voice': 'skipped', 'pp-run': 'skipped',
  });
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
  assert.ok(p.steps.filter((s) => !['scan', 'node'].includes(s.id)).every((s) => s.state === 'skipped'));
  assert.equal(p.step('scan').state, 'done', 'she looks at the PC all the same');
  assert.deepEqual(p.plan, { ollama: false, chatterbox: false, piper: false, whisper: false, node: true, adopt: false, engine: 'elevenlabs' });
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
  assert.equal(w.p.snapshot().stopping, true, 'it says at once that it is stopping');
  await run;
  assert.equal(w.p.ok, false);
  assert.equal(w.p.step('ollama-model').state, 'stopped', 'a stop is not a failure');
  assert.equal(w.p.snapshot().cancelled, true);
  assert.equal(w.p.snapshot().stopping, false);
  assert.equal(w.p.running, false);
  assert.ok(!w.p.steps.some((s) => s.state === 'failed'));
});

// a program that runs until it is ended: what pip, an installer or a download is, to "Stop"
const endless = (signal, result = { ok: false, cancelled: true, tail: [] }) => new Promise((resolve) => signal?.addEventListener('abort', () => setTimeout(() => resolve(result), 5), { once: true }));
const waitFor = async (what, cond, ms = 2000) => {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`never happened: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};
const within = (ms, promise) => Promise.race([promise, new Promise((_r, reject) => setTimeout(() => reject(new Error(`still going after ${ms} ms`)), ms))]);

test('stopping while pip fetches the package ends pip at once and leaves the step stopped; trying again goes on', async () => {
  const w = world({ cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-Stop') }, state: { hasPackage: false, ollamaRunning: true, cbProgress: [0.5] } });
  const seen = [];
  w.p.d.tools.pip = async (_py, _args, onLine, opts) => {
    seen.push(opts);
    onLine('Downloading torch-2.6.0-cp311-win_amd64.whl (2.5 GB)');
    return endless(opts.signal);
  };
  const run = w.p.run();
  await waitFor('pip begun', () => w.p.step('cb-package').state === 'running' && seen.length);
  w.p.cancel();
  await within(1000, run);
  assert.ok(seen[0].signal.aborted, 'pip was given the signal that was fired');
  assert.equal(w.p.step('cb-package').state, 'stopped');
  assert.equal(w.p.step('cb-model').state, 'pending', 'nothing after it was begun');
  assert.equal(w.state.cbPhase, 'off', 'the voice server was not started');
  assert.ok(!w.p.steps.some((s) => s.state === 'failed'));
  assert.equal(w.p.snapshot().cancelled, true);
  // and again
  w.p.d.tools.pip = async () => { w.state.hasPackage = true; return { ok: true, tail: [] }; };
  await w.p.retry();
  assert.equal(w.p.step('cb-package').state, 'done');
  assert.equal(w.p.snapshot().cancelled, false, 'a new run starts not stopped');
  fs.rmSync(path.join(tmp, 'roots', 'Chatterbox-Stop'), { recursive: true, force: true });
});

test('stopping works even when the installer under it does not listen: Python, and Ollama\'s three ways', async () => {
  const stubborn = () => new Promise(() => {}); // never answers, never hears the signal
  const w = world({ cfg: { ttsEngine: 'chatterbox' }, state: { hasPackage: false, ollamaRunning: true, systemPython: null } });
  w.p.d.installPython = stubborn;
  let run = w.p.run();
  await waitFor('Python being installed', () => w.p.step('cb-python').state === 'running');
  w.p.cancel();
  await within(1000, run);
  assert.equal(w.p.step('cb-python').state, 'stopped');

  const o = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaFound: false }, installOllama: stubborn });
  run = o.p.run();
  await waitFor('Ollama being installed', () => o.p.step('ollama-find').state === 'running');
  o.p.cancel();
  await within(1000, run);
  assert.equal(o.p.step('ollama-find').state, 'stopped');
  assert.equal(o.p.step('ollama-run').state, 'pending', 'the next way of installing was not tried');
});

test('stopping while the voice model loads ends the voice server, so that the download does not go on behind it', async () => {
  const w = world({ cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-Load') }, state: { ollamaRunning: true, cbProgress: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] } });
  let stops = 0;
  w.p.d.chatterbox.stop = () => { stops++; w.state.cbPhase = 'off'; };
  const run = w.p.run();
  await waitFor('the model loading', () => w.p.step('cb-model').state === 'running');
  w.p.cancel();
  await within(1000, run);
  assert.equal(w.p.step('cb-model').state, 'stopped');
  assert.ok(stops >= 1, 'the server was ended');
  fs.rmSync(path.join(tmp, 'roots', 'Chatterbox-Load'), { recursive: true, force: true });
});

test('a stop with nothing going on does nothing; one during the first look leaves nothing begun', async () => {
  const idle = world({});
  idle.p.cancel();
  assert.equal(idle.p.snapshot().cancelled, false);
  const w = world({ cfg: { ttsEngine: 'openai' }, deps: { hardware: async () => { await new Promise((r) => setTimeout(r, 40)); return { ram: 32 * GB, vram: 8 * GB }; } } });
  const run = w.p.run();
  await new Promise((r) => setTimeout(r, 5));
  w.p.cancel();
  await within(1000, run);
  assert.equal(w.p.finished, true);
  assert.equal(w.p.ok, false);
  assert.ok(w.p.steps.filter((s) => s.id !== 'scan').every((s) => s.state === 'pending'), 'what was not begun waits');
});

test('with a folder picked for everything: Ollama comes first as the zip into it, pip works in its temp folder, Node.js too, and the work files are cleared away after', async () => {
  const work = path.join(tmp, 'picked', 'Capri', 'temp');
  const order = [];
  const calls = { ensure: 0, clean: 0, pip: [] };
  const w = world({
    cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-Picked') },
    state: { ollamaFound: false, hasPackage: false, nodeFound: false },
    installOllama: async () => { order.push('winget'); return { ok: false }; },
    deps: {
      downloadOllama: async () => { order.push('installer'); return { ok: false }; },
      downloadOllamaZip: async () => { order.push('zip'); w.state.ollamaFound = true; return { ok: true, dir: path.join(tmp, 'picked', 'Capri', 'ollama') }; },
      preferZip: () => true,
      tempDir: () => work,
      cleanTemp: () => { calls.clean++; },
      ensureRoot: () => { calls.ensure++; },
    },
  });
  w.p.d.tools.pip = async (_py, _args, _onLine, opts) => { calls.pip.push(opts); w.state.hasPackage = true; return { ok: true, tail: [] }; };
  w.p.d.nodeTools.install = async ({ dir, tmp: at, onProgress }) => { calls.node = at; onProgress({ completed: 1, total: 1 }); w.state.nodeFound = true; return { exe: path.join(dir, 'node.exe'), dir, version: '24.0.0' }; };
  await w.p.run();
  assert.deepEqual(order, ['zip'], 'the zip first, and the others not needed');
  assert.deepEqual(calls.pip[0].env, { TEMP: work, TMP: work, TMPDIR: work });
  assert.equal(calls.node, work);
  assert.equal(calls.ensure, 1);
  assert.equal(calls.clean, 1);
  assert.equal(w.p.step('ollama-find').state, 'done');
  // without a folder picked: the usual order, and the system's own temp
  const o2 = [];
  const plain = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaFound: false }, installOllama: async () => { o2.push('winget'); return { ok: false }; }, deps: { downloadOllama: async () => { o2.push('installer'); return { ok: false }; }, downloadOllamaZip: async () => { o2.push('zip'); return { ok: false }; } } });
  await plain.p.run();
  assert.deepEqual(o2, ['winget', 'installer', 'zip']);
  fs.rmSync(path.join(tmp, 'roots', 'Chatterbox-Picked'), { recursive: true, force: true });
});

test('the package of the voice has a bar over everything pip fetches: the packages, then the torch for the card, never going back, and words that say what it is on', async () => {
  const w = world({
    cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-Bar') },
    state: { hasPackage: false, ollamaRunning: true, torchHasCuda: false },
    deps: { hardware: async () => ({ ram: 32 * GB, vram: 12 * GB, gpu: { name: 'NVIDIA GeForce RTX 4070', vram: 12 * GB, driver: '560.94' } }) },
  });
  const seen = [];
  w.p.on('change', () => { const s = w.p.step('cb-package'); if (s.state === 'running') seen.push({ progress: s.progress, detail: s.detail }); });
  const lines = async (onLine, list) => { for (const l of list) { onLine(l); await new Promise((r) => setTimeout(r, 1)); } };
  w.p.d.tools.preparePip = async () => ({ raw: true });
  w.p.d.tools.pip = async (_py, args, onLine) => {
    w.state.pips.push(args);
    if (args.includes('--force-reinstall')) {
      await lines(onLine, ['Downloading torch-2.6.0+cu124-cp311-cp311-win_amd64.whl (2.5 GB)', 'Progress 0 of 2500000000', 'Progress 1250000000 of 2500000000', 'Progress 2500000000 of 2500000000', 'Installing collected packages: torch', 'Successfully installed torch-2.6.0+cu124']);
      w.state.torchHasCuda = true;
      return { ok: true, tail: [] };
    }
    await lines(onLine, ['Collecting chatterbox-tts', 'Downloading chatterbox_tts-0.1.4-py3-none-any.whl (1.3 MB)', 'Progress 0 of 1300000', 'Progress 1300000 of 1300000', 'Collecting torch==2.6.0', 'Downloading torch-2.6.0-cp311-cp311-win_amd64.whl (204.2 MB)', 'Progress 0 of 204200000', 'Progress 102100000 of 204200000', 'Progress 204200000 of 204200000', 'Installing collected packages: torch, chatterbox-tts', 'Successfully installed chatterbox-tts-0.1.4']);
    w.state.hasPackage = true;
    return { ok: true, tail: [] };
  };
  await w.p.run();
  assert.equal(w.p.step('cb-package').state, 'done');
  const bars = seen.map((s) => s.progress).filter((p) => p !== null);
  assert.ok(bars.length >= 4, `the bar moved (${bars.length} steps)`);
  for (let i = 1; i < bars.length; i++) assert.ok(bars[i] >= bars[i - 1] - 1e-9, `never back: ${bars[i - 1]} then ${bars[i]}`);
  assert.ok(bars.some((p) => p > 0.3 && p < 0.6), 'the packages are only a part: the torch for the card is still to come');
  assert.ok(bars.some((p) => p > 0.8), 'and it goes on to the end over both');
  assert.ok(Math.max(...bars) <= 1);
  const words = seen.map((s) => s.detail);
  assert.ok(words.some((d) => /Downloading torch: .* of .*\(\d+%\)/.test(d)), `it says what it is on: ${words.find((d) => /torch/.test(d))}`);
  assert.ok(words.some((d) => /Installing what was downloaded/.test(d)), 'and that it is unpacking');
  assert.ok(w.state.pips[0].includes('--progress-bar') && w.state.pips[0].includes('raw'), 'pip is asked for its progress in lines');
  assert.ok(w.state.pips[1].includes('--progress-bar') && w.state.pips[1].includes('--force-reinstall'), 'also the one for the card');
});

test('a pip that cannot say how far it is still gets a bar by the files it has got, and the words it always had', async () => {
  const w = world({ cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-Old') }, state: { hasPackage: false, ollamaRunning: true } });
  const seen = [];
  w.p.on('change', () => { const s = w.p.step('cb-package'); if (s.state === 'running') seen.push({ progress: s.progress, detail: s.detail }); });
  w.p.d.tools.preparePip = async () => ({ raw: false });
  w.p.d.tools.pip = async (_py, args, onLine) => {
    w.state.pips.push(args);
    for (const l of ['Collecting chatterbox-tts', 'Downloading chatterbox_tts-0.1.4-py3-none-any.whl (1.3 MB)', 'Downloading torch-2.6.0-cp311-cp311-win_amd64.whl (204.2 MB)', 'Installing collected packages: torch']) { onLine(l); await new Promise((r) => setTimeout(r, 1)); }
    w.state.hasPackage = true;
    return { ok: true, tail: [] };
  };
  await w.p.run();
  assert.equal(w.p.step('cb-package').state, 'done');
  assert.ok(!w.state.pips[0].includes('--progress-bar'), 'an old pip is not given an option it does not know');
  assert.ok(seen.some((s) => /Installing Chatterbox: torch \(204.2 MB\)/.test(s.detail)));
});

test('the model of the voice has a bar over its whole download (not file by file), and when it is all there it says it is loading', async () => {
  const w = world({ cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-Model') }, state: { ollamaRunning: true } });
  const seen = [];
  w.p.on('change', () => { const s = w.p.step('cb-model'); if (s.state === 'running') seen.push({ progress: s.progress, detail: s.detail, bar: s.heavy || s.bar }); });
  let tick = 0;
  const walk = [[0.1, 0.32e9], [0.4, 1.3e9], [0.7, 2.2e9], [null, 3.3e9]];
  w.p.d.chatterbox.status = () => {
    const [progress, bytes_] = walk[Math.min(tick++ >> 3, walk.length - 1)];
    const ready = tick > 40;
    return { phase: ready ? 'ready' : 'starting', error: '', progress, bytes: bytes_, expect: 3.2e9, device: 'cuda', log: ['loading'] };
  };
  w.p.d.chatterbox.sync = async () => {};
  await w.p.run();
  assert.equal(w.p.step('cb-model').state, 'done');
  assert.ok(seen.every((s) => s.bar), 'a bar is shown the whole time');
  assert.equal(w.p.attention, true, 'a download of the model is long: the window is worth showing');
  assert.ok(seen.some((s) => s.progress === 0.4 && /Fetching the voice model: 1.2 GB of ~3.0 GB \(40%\)/.test(s.detail)), `bytes and percent: ${seen.find((s) => s.progress === 0.4)?.detail}`);
  assert.ok(seen.some((s) => s.progress === null && /Loading the voice model/.test(s.detail)), 'then it is loading into memory');
});

test('one bar over the whole voice: Python, the packages, the torch for the card and the model, never going back, with the percent in words', async () => {
  const w = world({
    cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-All') },
    state: { hasPackage: false, ollamaRunning: true, torchHasCuda: false },
    deps: { hardware: async () => ({ ram: 32 * GB, vram: 12 * GB, gpu: { name: 'NVIDIA GeForce RTX 4070', vram: 12 * GB, driver: '560.94' } }) },
  });
  const seen = [];
  w.p.on('change', (snap) => { if (snap.overall) seen.push(snap.overall); });
  const lines = async (onLine, list) => { for (const l of list) { onLine(l); await new Promise((r) => setTimeout(r, 1)); } };
  w.p.d.tools.preparePip = async () => ({ raw: true });
  w.p.d.tools.pip = async (_py, args, onLine) => {
    if (args.includes('--force-reinstall')) {
      await lines(onLine, ['Downloading torch-2.6.0+cu124-cp311-cp311-win_amd64.whl (2.5 GB)', 'Progress 0 of 2500000000', 'Progress 1250000000 of 2500000000', 'Progress 2500000000 of 2500000000', 'Installing collected packages: torch']);
      w.state.torchHasCuda = true;
      return { ok: true, tail: [] };
    }
    await lines(onLine, ['Downloading torch-2.6.0-cp311-cp311-win_amd64.whl (204.2 MB)', 'Progress 0 of 204200000', 'Progress 102100000 of 204200000', 'Progress 204200000 of 204200000', 'Installing collected packages: torch, chatterbox-tts']);
    w.state.hasPackage = true;
    return { ok: true, tail: [] };
  };
  let tick = 0;
  const walk = [[0.1, 0.32e9], [0.4, 1.3e9], [0.7, 2.2e9], [null, 3.3e9]];
  w.p.d.chatterbox.status = () => {
    const [progress, bytes_] = walk[Math.min(tick++ >> 3, walk.length - 1)];
    return { phase: tick > 40 ? 'ready' : 'starting', error: '', progress, bytes: bytes_, expect: 3.2e9, device: 'cuda', log: ['loading'] };
  };
  w.p.d.chatterbox.sync = async () => {};
  await w.p.run();
  assert.equal(w.p.step('cb-model').state, 'done');
  assert.ok(seen.length > 20, `the bar is there all through (${seen.length} updates)`);
  assert.equal(seen[0].group, 'voice');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].fraction >= seen[i - 1].fraction - 1e-9, `never back: ${seen[i - 1].fraction} then ${seen[i].fraction}`);
  assert.ok(seen[0].fraction < 0.1, `it starts at the start: ${seen[0].fraction}`);
  assert.ok(seen.some((o) => o.fraction > 0.3 && o.fraction < 0.5), 'the packages and the torch are about a third to a half of it');
  assert.ok(seen.some((o) => o.fraction > 0.5 && o.fraction < 0.9), 'the model is the rest');
  assert.ok(Math.max(...seen.map((o) => o.fraction)) <= 0.99, 'never full before it is all done');
  assert.ok(seen.every((o) => /^The voice is \d+% ready/.test(o.label)), seen[0].label);
  assert.equal(w.p.snapshot().overall, null, 'when it is all done there is nothing left to show');
});

test('about how long is left comes from the speed over the last seconds, and is not said before there is a speed to go by', () => {
  const w = world({ cfg: { ttsEngine: 'chatterbox' } });
  const p = w.p;
  p.plan = { chatterbox: true };
  p.step('cb-python').state = 'done';
  p.step('cb-package').state = 'running';
  p.step('cb-model').state = 'pending';
  const t0 = 1_000_000;
  assert.match(p.overall(t0).label, /^The voice is 1% ready, working out how long is left/, 'the first moments: no speed yet');
  p.parts.package = 0.25;
  assert.match(p.overall(t0 + 4000).label, /working out/, 'four seconds are too few');
  p.parts.package = 0.5;
  // (0.35 GB of the 4.2 GB in 20 seconds: 17.5 MB/s, 3.85 GB to go)
  assert.equal(p.overall(t0 + 20000).label, 'The voice is 9% ready, about 4 min left');
  assert.ok(p.overall(t0 + 20000).fraction > 0.08);
  // later: the speed of the last 45 seconds only (it got faster)
  p.parts.package = 1;
  const late = p.overall(t0 + 80000);
  assert.match(late.label, /about \d+ min left/);
  // nothing running: nothing shown
  p.step('cb-package').state = 'done';
  p.step('cb-model').state = 'done';
  assert.equal(p.overall(t0 + 90000), null);
  // no voice of this kind to get
  p.plan = { chatterbox: false };
  assert.equal(p.overall(t0), null);
  const ru = world({ cfg: { ttsEngine: 'chatterbox' }, deps: { lang: () => 'ru' } });
  ru.p.plan = { chatterbox: true };
  ru.p.step('cb-python').state = 'done';
  ru.p.step('cb-package').state = 'running';
  ru.p.overall(t0);
  ru.p.parts.package = 0.5;
  assert.equal(ru.p.overall(t0 + 20000).label, 'Голос готов на 9%, осталось около 4 мин');
});

test('a model is made to answer one word once: the engine of Ollama that is not whole is told as that, with the way out; the check is written down and not made at every start', async () => {
  const broken = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaRunning: true, models: ['gemma3:4b'] } });
  broken.p.d.ollamaApi.probe = async () => ({ ok: false, engine: true, error: "error starting llama-server: llama-server binary not found (checked: C:\\Users\\x\\AppData\\Local\\Programs\\Ollama\\lib\\ollama\\llama-server.exe)" });
  await broken.p.run();
  const step = broken.p.step('ollama-model');
  assert.equal(step.state, 'failed');
  assert.match(step.error, /not installed whole/);
  assert.match(step.error, /llama-server/);
  assert.deepEqual(step.actions, ['repair-ollama', 'retry']);
  assert.ok(step.log[0].includes('llama-server binary not found'), 'what Ollama said is in the details');
  assert.equal(broken.cfg.mindChecked, undefined, 'a failed check is not written down');
  assert.equal(broken.p.ok, false);

  let probes = 0;
  const good = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaRunning: true, models: ['gemma3:4b'] } });
  good.p.d.ollamaApi.probe = async () => { probes++; return { ok: true }; };
  await good.p.run();
  assert.equal(good.p.step('ollama-model').state, 'done');
  assert.equal(probes, 1);
  assert.match(good.cfg.mindChecked, /\|gemma3:4b$/);
  await good.p.run();
  assert.equal(probes, 1, 'the second start does not ask the model again');
  good.cfg.chatModel = 'gemma3:4b';
  good.cfg.wantModel = '';
  // another model: it is checked
  good.state.models.push('qwen2.5:7b');
  good.cfg.chatModel = 'qwen2.5:7b';
  await good.p.run();
  assert.equal(probes, 2);

  const slow = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaRunning: true, models: ['gemma3:4b'] } });
  slow.p.d.ollamaApi.probe = async () => ({ ok: false, slow: true, error: 'timeout' });
  await slow.p.run();
  assert.equal(slow.p.step('ollama-model').state, 'done', 'a slow load is no failure');
  assert.equal(slow.cfg.mindChecked, undefined, 'but is not written down either');

  const other = world({ cfg: { ttsEngine: 'openai' }, state: { ollamaRunning: true, models: ['gemma3:27b'] } });
  other.p.d.ollamaApi.probe = async () => ({ ok: false, error: 'model requires more system memory (20.1 GiB) than is available (12.0 GiB)' });
  await other.p.run();
  assert.equal(other.p.step('ollama-model').state, 'failed');
  assert.match(other.p.step('ollama-model').error, /gemma3:27b does not answer: model requires more system memory/);
  assert.deepEqual(other.p.step('ollama-model').actions, ['retry']);
});

test('repairing Ollama: it is put in again over the old one (the installer first, her own zip first when it is hers), its programs are ended first, and the check is made again', async () => {
  const order = [];
  const killed = [];
  const mkw = (cfg = {}) => {
    const w = world({
      cfg: { ttsEngine: 'openai', mindChecked: 'x|gemma3:4b', ...cfg }, state: { ollamaRunning: true, models: ['gemma3:4b'] },
      installOllama: async () => { order.push('winget'); return { ok: false }; },
      deps: {
        downloadOllama: async () => { order.push('installer'); return { ok: true }; },
        downloadOllamaZip: async () => { order.push('zip'); return { ok: true, dir: '/capri/ollama' }; },
        killOllama: async () => { killed.push(true); },
      },
    });
    w.p.d.ollamaApi.probe = async () => { order.push('probe'); return { ok: true }; };
    return w;
  };
  const w = mkw();
  await w.p.run({ repairOllama: true });
  assert.deepEqual(order, ['installer', 'probe'], 'the installer, over the one there; then the model is asked again');
  assert.equal(killed.length, 1);
  assert.equal(w.p.step('ollama-find').state, 'done');
  assert.equal(w.p.step('ollama-model').state, 'done');
  assert.match(w.cfg.mindChecked, /gemma3:4b$/);
  assert.notEqual(w.cfg.mindChecked, 'x|gemma3:4b', 'written anew');
  assert.equal(w.p.repair, false, 'and it is over');

  order.length = 0;
  const hers = mkw({ ollamaDir: '/capri/ollama' });
  await hers.p.run({ repairOllama: true });
  assert.deepEqual(order, ['zip', 'probe'], 'hers is a zip in her folder: fetched again there');
  assert.equal(hers.cfg.ollamaDir, '/capri/ollama');

  // a mind that is a service of the cloud: a repair is asked for, so it is done all the same
  order.length = 0;
  const cloud = mkw({ provider: 'openai', chatModel: 'gpt-4o' });
  await cloud.p.run({ repairOllama: true });
  assert.ok(order.includes('installer'));
  assert.equal(cloud.cfg.chatModel, 'gpt-4o', 'her settings are left as they are');
  assert.equal(cloud.cfg.provider, 'openai');

  // still without its engine after it: said, and no second "repair"
  const still = mkw();
  still.p.d.ollamaApi.probe = async () => ({ ok: false, engine: true, error: 'llama-server binary not found' });
  await still.p.run({ repairOllama: true });
  assert.equal(still.p.step('ollama-model').state, 'failed');
  assert.match(still.p.step('ollama-model').error, /still without its engine/);
  assert.ok(!still.p.step('ollama-model').actions.includes('repair-ollama'));
});

// a PC with an NVIDIA card and a Chatterbox folder whose environment has no package yet: the package, then the torch for the card
function cardWorld(extra = {}) {
  const w = world({
    cfg: { ttsEngine: 'chatterbox', chatterboxDir: readyFolder('Chatterbox-Card') },
    state: { hasPackage: false, ollamaRunning: true, torchHasCuda: false },
    deps: { hardware: async () => ({ ram: 32 * GB, vram: 12 * GB, gpu: { name: 'NVIDIA GeForce RTX 4070', vram: 12 * GB, driver: '560.94' } }) },
    ...extra,
  });
  w.p.d.tools.pip = async (_py, args) => {
    w.state.pips.push(args);
    if (args.includes('--force-reinstall')) w.state.torchHasCuda = true;
    else w.state.hasPackage = true;
    return { ok: true, tail: [] };
  };
  return w;
}

test('after the torch for the card the versions are looked at: torch and torchaudio of one version, the card seen, what pip finds wrong kept for the report', async () => {
  const bad = cardWorld();
  bad.p.d.tools.torchStatus = () => ({ version: '2.7.1', audio: '2.6.0', cuda: bad.state.torchHasCuda });
  await bad.p.run();
  assert.equal(bad.p.step('cb-package').state, 'failed');
  assert.match(bad.p.step('cb-package').error, /torch \(2\.7\.1\) and torchaudio \(2\.6\.0\) of different versions/);
  assert.equal(bad.p.step('cb-model').state, 'pending', 'the voice is not started on it');

  const blind = cardWorld();
  blind.p.d.tools.torchStatus = () => ({ version: '2.6.0', audio: '2.6.0', cuda: false });
  blind.p.d.tools.pipCheck = () => ['chatterbox-tts 0.1.4 has requirement torch==2.6.0, but you have torch 2.7.1+cu128.'];
  await blind.p.run();
  assert.equal(blind.p.step('cb-package').state, 'done', 'a card that is not seen is no failure: the voice is slow');
  assert.deepEqual(blind.p.step('cb-package').log, ['chatterbox-tts 0.1.4 has requirement torch==2.6.0, but you have torch 2.7.1+cu128.'], 'what pip found is in the report');
  assert.match(blind.p.report(), /has requirement torch==2\.6\.0/);
});

test('the voice is made to say a line once; a voice that loads and does not speak is told as that; the next start does not do it again', async () => {
  let spoken = 0;
  let torchLooks = 0;
  const w = cardWorld();
  w.p.d.tools.torchStatus = () => { torchLooks++; return { version: '2.6.0', audio: '2.6.0', cuda: w.state.torchHasCuda }; };
  w.p.d.chatterbox.check = async () => { spoken++; };
  await w.p.run();
  assert.equal(w.p.step('cb-model').state, 'done');
  assert.equal(spoken, 1);
  assert.ok(w.cfg.voiceChecked, 'written down');
  const looks = torchLooks;
  assert.ok(looks >= 2, 'the torch was looked at (before and after the build for the card)');
  w.state.cbPhase = 'off';
  await w.p.run();
  assert.equal(spoken, 1, 'not again');
  assert.equal(torchLooks, looks, 'and the torch is not looked at (it takes a while to load) at every start');

  const mute = cardWorld();
  mute.p.d.chatterbox.check = async () => { throw new Error('CUDA error: no kernel image is available for execution on the device'); };
  await mute.p.run();
  assert.equal(mute.p.step('cb-model').state, 'failed');
  assert.match(mute.p.step('cb-model').error, /did not speak: CUDA error: no kernel image/);
  assert.deepEqual(mute.p.step('cb-model').actions, ['retry', 'choose-chatterbox']);
  assert.ok(!mute.cfg.voiceChecked, 'a failure is not written down');
});

test('pip given a signal ends the program and everything it started, and answers cancelled at once', async () => {
  const cp = require('node:child_process');
  const setup = require('../../src/main/voice/chatterbox-setup.js');
  let child;
  const spawn = (_cmd, _args, opts) => {
    child = cp.spawn(process.execPath, ['-e', 'setInterval(() => console.log("Downloading torch-2.6.0 (2.5 GB)"), 20)'], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    return child;
  };
  const ac = new AbortController();
  const lines = [];
  const started = Date.now();
  const res = setup.pip('python', ['install', 'x'], (l) => lines.push(l), { spawn, signal: ac.signal });
  while (!lines.length) await new Promise((r) => setTimeout(r, 10));
  ac.abort();
  const out = await within(2000, res);
  assert.equal(out.cancelled, true);
  assert.equal(out.ok, false);
  assert.ok(Date.now() - started < 2000);
  await new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once('exit', r)));
  assert.ok(child.killed || child.signalCode, 'the program is gone');
  const after = lines.length;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(lines.length, after, 'and says nothing more');
  // already stopped before it began: not even started
  let started2 = false;
  const never = await setup.pip('python', [], null, { spawn: () => { started2 = true; }, signal: AbortSignal.abort() });
  assert.equal(never.cancelled, true);
  assert.equal(started2, false);
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

// ---- by the PC she is on ----

const pc = (o = {}) => hardware.make({ disk: { path: '', free: 300 * GB, total: 500 * GB }, ...o });
const nvidia = (name, vram, extra = {}) => ({ name: `NVIDIA GeForce ${name}`, vram: vram * GB, driver: '552.22', compute: 8.6, ...extra });

test('she looks at the PC first, and says what it is and what profile it got, with what that costs to fetch', async () => {
  const { p, state } = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai' }, state: { hw: pc({ ram: 15.9 * GB, cpu: { name: 'Intel(R) Core(TM) i5-12400F CPU', threads: 12 }, gpus: [nvidia('RTX 3060', 12)] }) } });
  const seen = [];
  p.on('change', (s) => seen.push(s));
  await p.run();
  assert.equal(p.step('scan').state, 'done');
  assert.match(p.step('scan').detail, /Core i5-12400F.*memory 15\.9 GB.*graphics card: RTX 3060 12\.0 GB.*profile “Strong”/);
  const snap = p.snapshot();
  assert.equal(snap.profile.id, 'strong');
  assert.equal(snap.profile.auto, true);
  assert.deepEqual([snap.profile.mind.model, snap.profile.voice.engine, snap.profile.voice.device], ['gemma3:4b', 'chatterbox', 'cuda']);
  assert.ok(snap.profile.download.total > 10 * GB);
  assert.equal(snap.pc.gpu.vram, 12 * GB);
  assert.equal(snap.pc.threads, 12);
  assert.ok(seen.some((s) => s.steps.find((x) => x.id === 'scan').state === 'running' && !s.pc), 'the window hears of the look before its result');
  assert.deepEqual(state.hardwareCalls, [{ force: false }]);
  assert.deepEqual(state.tuned.map((t) => t.numCtx), [8192], 'how she asks Ollama is set by the profile');
  assert.deepEqual(state.tuned.map((t) => t.id), ['strong'], 'and she is told which profile it is, to know what a measurement was made for');
  await p.run({ rescan: true });
  assert.deepEqual(state.hardwareCalls[1], { force: true }, 'asked to look again, she does not take the last look');
  assert.match(p.report(), /pc: .* ram 16 GB, gpu NVIDIA GeForce RTX 3060 12 GB, driver 552\.22/);
  assert.match(p.report(), /profile: strong \(by herself\), mind ollama gemma3:4b, voice chatterbox\/cuda/);
});

test('a plain PC (16 GB, no card): the 4B model and the Piper voice; no Python, no Chatterbox', async () => {
  const { p, cfg, state } = world({ state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true } });
  const changes = [];
  p.on('change', (s) => changes.push(s));
  await p.run();
  assert.equal(p.ok, true, JSON.stringify(states(p)));
  assert.deepEqual(state.pulls, ['gemma3:4b']);
  assert.equal(cfg.chatModel, 'gemma3:4b');
  assert.deepEqual(['cb-find', 'cb-python', 'cb-package', 'cb-model'].map((id) => p.step(id).state), ['skipped', 'skipped', 'skipped', 'skipped'], 'none of Chatterbox');
  assert.deepEqual(['pp-find', 'pp-voice', 'pp-run'].map((id) => p.step(id).state), ['done', 'done', 'done']);
  assert.equal(state.piperInstalls, 1, 'the program was fetched');
  assert.deepEqual(state.voiceFetches, ['en'], 'and the voice of the language she speaks');
  assert.equal(cfg.ttsEngine, 'piper');
  assert.equal(cfg.provisioned, true);
  assert.equal(p.attention, true, 'a fetch happened: the window was worth showing');
  assert.match(p.step('pp-run').detail, /The voice works \(en_US-amy-medium\)/);
  const bar = changes.map((c) => c.steps.find((s) => s.id === 'pp-find')).filter((s) => s.state === 'running' && s.progress !== null).map((s) => s.progress);
  assert.ok(bar.length >= 3 && bar[bar.length - 1] === 1, `the program's bar went up: ${bar}`);
  assert.ok(changes.some((c) => /Fetching a voice: \d+ MB of \d+ MB/.test(c.steps.find((s) => s.id === 'pp-voice').detail)));
  assert.equal(p.snapshot().plan.piper, true);
  assert.equal(p.snapshot().profile.download.total, 0, 'after all of it is fetched the plan has nothing left to fetch');
});

test('the second start on a plain PC: the program and the voice are there, nothing is fetched, and the window stays shut', async () => {
  const { p, state, cfg } = world({ cfg: { ttsEngine: 'piper', provisioned: true, chatModel: 'gemma3:4b' }, state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'], piperFound: true, piperVoice: 'en_US-amy-medium' } });
  await p.run();
  assert.equal(p.ok, true);
  assert.equal(p.attention, false);
  assert.deepEqual([state.piperInstalls, state.voiceFetches, state.pulls], [0, [], []]);
  assert.equal(cfg.ttsEngine, 'piper');
});

test('her language decides the voice she fetches', async () => {
  const w = world({ state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'] }, deps: { lang: () => 'ru' } });
  await w.p.run();
  assert.deepEqual(w.state.voiceFetches, ['ru']);
  assert.match(w.p.step('pp-run').detail, /ru_RU-irina-medium/);
});

test('a small PC (4 GB): the 1B model, which cannot see the screen, and the Piper voice', async () => {
  const { p, state, cfg } = world({ state: { hw: pc({ ram: 3.9 * GB, gpus: [{ name: 'Intel(R) UHD Graphics', vram: 1 * GB }] }), ollamaRunning: true } });
  await p.run();
  assert.equal(p.ok, true, JSON.stringify(states(p)));
  assert.deepEqual(state.pulls, ['gemma3:1b']);
  assert.equal(cfg.ttsEngine, 'piper');
  assert.equal(p.snapshot().profile.id, 'light');
  assert.ok(p.snapshot().profile.notes.includes('noEyes'));
  assert.deepEqual(state.tuned.map((t) => t.numCtx), [4096]); // (her prompt in Russian is long: the smallest memory holds it with room for the talk)
});

test('a PC that cannot carry local models: no Ollama, no download of a model; the mind is left for a cloud one, the voice is the lightest', async () => {
  const { p, state, cfg } = world({ state: { hw: pc({ arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' }, ram: 3 * GB }), ollamaFound: false } });
  await p.run();
  assert.equal(p.ok, true, JSON.stringify(states(p)));
  assert.deepEqual([state.installed, state.pulls], [[], []], 'nothing is installed and no model is fetched');
  assert.ok(['ollama-find', 'ollama-run', 'ollama-model'].every((id) => p.step(id).state === 'skipped'));
  assert.equal(p.snapshot().profile.id, 'cloud');
  assert.ok(p.snapshot().profile.notes.includes('os32'));
  assert.equal(p.snapshot().plan.ollama, false);
  assert.equal(cfg.ttsEngine, 'system', 'a 32-bit Windows has no Piper');
  assert.equal(cfg.provisioned, true, 'and it is settled: she does not look for a voice again on every start');
  // an Ollama that is already there on such a PC is still her mind (nobody asked for the cloud)
  const has = world({ state: { hw: pc({ ram: 3 * GB }), ollamaFound: true, ollamaRunning: true, models: ['gemma3:1b'] } });
  await has.p.run();
  assert.equal(has.p.step('ollama-model').state, 'done');
  // but if you ask for the cloud, it is the cloud
  const asked = world({ cfg: { profile: 'cloud' }, state: { hw: pc({ ram: 31 * GB }), ollamaFound: true, ollamaRunning: true, models: ['gemma3:4b'] } });
  await asked.p.run();
  assert.equal(asked.p.step('ollama-model').state, 'skipped');
});

test('a profile you ask for is given, with its own model, once; after that your choice of model stands', async () => {
  const w = world({ cfg: { profile: 'light', chatModel: 'gemma3:4b', ttsEngine: 'piper' }, state: { hw: pc({ ram: 31 * GB }), ollamaRunning: true, models: ['gemma3:4b'], piperFound: true, piperVoice: 'en_US-amy-medium' } });
  await w.p.run();
  assert.deepEqual(w.state.pulls, ['gemma3:1b'], 'the light profile fetches its own model, though a bigger one is there');
  assert.equal(w.cfg.chatModel, 'gemma3:1b');
  assert.equal(w.cfg.profileApplied, 'light');
  // then you pick another model in her menu: the next start does not undo it
  w.cfg.chatModel = 'gemma3:4b';
  await w.p.run();
  assert.equal(w.cfg.chatModel, 'gemma3:4b');
  assert.deepEqual(w.state.pulls, ['gemma3:1b']);
  // the profile asked for is in the plan whatever the PC would have picked
  assert.equal(w.p.snapshot().profile.id, 'light');
  assert.equal(w.p.snapshot().profile.auto, false);
  // a profile whose model is installed already is not fetched
  const have = world({ cfg: { profile: 'standard', ttsEngine: 'piper' }, state: { hw: pc({ ram: 8 * GB }), ollamaRunning: true, models: ['gemma3:4b-it-q4_K_M'], piperFound: true, piperVoice: 'en_US-amy-medium' } });
  await have.p.run();
  assert.deepEqual(have.state.pulls, []);
  assert.equal(have.cfg.chatModel, 'gemma3:4b-it-q4_K_M');
});

test('a Chatterbox folder that you put next to her stays her voice on a plain PC (and she says the voice will be slow)', async () => {
  const dir = readyFolder('Chatterbox-Given');
  const { p, cfg } = world({ state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'], hasPackage: true } });
  await p.run();
  assert.equal(cfg.ttsEngine, 'chatterbox');
  assert.equal(p.step('cb-model').state, 'done');
  assert.equal(p.step('pp-find').state, 'skipped');
  const notes = p.snapshot().profile.notes;
  assert.ok(notes.includes('folderWins') && notes.includes('slowVoice'), notes.join());
  // but if you pick the profile yourself, it is the profile's voice
  const asked = world({ cfg: { profile: 'standard' }, state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'], hasPackage: true } });
  await asked.p.run();
  assert.equal(asked.cfg.ttsEngine, 'piper');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a look at the PC that fails does not stop her: a usual PC is assumed', async () => {
  const { p } = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai' }, state: { hardwareFails: true } });
  await p.run();
  assert.equal(p.step('scan').state, 'done');
  assert.equal(p.ok, true);
  assert.ok(p.snapshot().profile.id);
});

test('Piper failing says where, with the buttons that help: no program, no voice, a voice that will not speak; and it goes on from there', async () => {
  const a = world({ state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'], piperInstallFails: 'api.github.com answered 503' } });
  await a.p.run();
  assert.equal(a.p.step('pp-find').state, 'failed');
  assert.match(a.p.step('pp-find').error, /Could not get Piper: api\.github\.com answered 503/);
  assert.deepEqual(a.p.step('pp-find').actions, ['retry', 'choose-piper']);
  assert.equal(a.p.step('pp-voice').state, 'pending');
  assert.equal(a.cfg.ttsEngine, 'system', 'she keeps the voice she had until the new one works');
  a.state.piperInstallFails = '';
  await a.p.retry();
  assert.equal(a.p.ok, true, JSON.stringify(states(a.p)));
  assert.equal(a.cfg.ttsEngine, 'piper');

  const b = world({ state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'], piperFound: true, piperVoiceFails: 'the voice library answered 503' } });
  await b.p.run();
  assert.equal(b.p.step('pp-voice').state, 'failed');
  assert.match(b.p.step('pp-voice').error, /Could not fetch a voice: the voice library answered 503/);

  const c = world({ state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'], piperFound: true, piperVoice: 'en_US-amy-medium', piperCheckFails: 'Failed to load model: invalid protobuf' } });
  await c.p.run();
  assert.equal(c.p.step('pp-run').state, 'failed');
  assert.match(c.p.step('pp-run').error, /Piper did not speak: Failed to load model/);
  assert.deepEqual(c.p.step('pp-run').log, ['piper log']);
  assert.equal(c.cfg.ttsEngine, 'system');

  const d = world({ cfg: { piperDir: '/nowhere' }, state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'] }, deps: { piper: { locate: () => null } } });
  await d.p.run();
  assert.match(d.p.step('pp-find').error, /There is no folder \/nowhere/);
  assert.deepEqual(d.p.step('pp-find').actions, ['retry', 'choose-piper']);
});

test('the card and its driver decide the torch: a card without its torch gets the build for its driver; one no build fits is left on the processor, said', async () => {
  const gpu = nvidia('RTX 3060', 12, { driver: '552.22' });
  const a = world({ state: { hw: pc({ ram: 15.9 * GB, gpus: [gpu] }), ollamaRunning: true, models: ['gemma3:4b'], hasPackage: true, torchHasCuda: false } });
  readyFolder('Chatterbox-Card');
  await a.p.run();
  assert.equal(a.state.cudaCalls.length, 1);
  assert.equal(a.state.cudaCalls[0].driver, '552.22', 'the build is chosen by the card\'s driver and capability');
  assert.ok(a.state.pips.some((args) => args.includes('torch==cuda')), 'and installed');
  assert.ok(a.state.pips.find((args) => args.includes('torch==cuda')).includes('--no-cache-dir'), 'without a pip cache: the build is gigabytes');
  const b = world({ state: { hw: pc({ ram: 15.9 * GB, gpus: [gpu] }), ollamaRunning: true, models: ['gemma3:4b'], hasPackage: true, torchHasCuda: false, cudaNone: true } });
  await b.p.run();
  assert.match(b.p.step('cb-package').detail, /without graphics-card support|installed/);
  assert.equal(b.state.pips.length, 0, 'no build fits: nothing is installed');
  // a PC with no card is not given a torch for one
  const c = world({ cfg: { ttsEngine: 'chatterbox', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'], hasPackage: true, torchHasCuda: false } });
  await c.p.run();
  assert.equal(c.state.cudaCalls.length, 0);
  fs.rmSync(path.join(tmp, 'roots', 'Chatterbox-Card'), { recursive: true, force: true });
});

test('Ollama that cannot be installed otherwise is fetched as a zip into a folder of hers, which she remembers', async () => {
  const w = world({
    state: { ollamaFound: false, hw: pc({ ram: 15.9 * GB }) }, installOllama: async () => ({ ok: false }),
    deps: { downloadOllamaZip: async (onLine) => { onLine('50%'); w.state.ollamaFound = true; return { ok: true, dir: '/userdata/ollama' }; } },
  });
  await w.p.run();
  assert.equal(w.cfg.ollamaDir, '/userdata/ollama');
  assert.equal(w.p.step('ollama-find').state, 'done');
});

test('Python\'s own installer next to her is found (the 3.11 one first, the right bits), for a PC with no winget', () => {
  const setup = require('../../src/main/setup/setup.js');
  const root = mk('py-installers');
  touch(path.join(root, 'python-3.12.4-amd64.exe'));
  touch(path.join(root, 'python-3.11.9-amd64.exe'));
  touch(path.join(root, 'python', 'python-3.10.11-amd64.exe'));
  touch(path.join(root, 'python-3.13.0-amd64.exe')); // too new for Chatterbox
  touch(path.join(root, 'notes.txt'));
  assert.equal(setup.findPythonInstaller([root]), path.join(root, 'python-3.11.9-amd64.exe'));
  fs.rmSync(path.join(root, 'python-3.11.9-amd64.exe'));
  assert.equal(setup.findPythonInstaller([root]), path.join(root, 'python-3.12.4-amd64.exe'));
  assert.equal(setup.findPythonInstaller([mk('py-nothing')]), null);
  assert.equal(setup.findPythonInstaller([path.join(tmp, 'not-a-folder')]), null);
  const inner = mk('py-installers2');
  touch(path.join(inner, 'installers', 'python-3.11.9-amd64.exe'));
  assert.equal(setup.findPythonInstaller([inner]), path.join(inner, 'installers', 'python-3.11.9-amd64.exe'), 'a folder called installers');
});

// ---- what you pick in her main menu ----

test('a model picked in her main menu that is there is taken; one that is not is fetched, and then it is the one she talks with', async () => {
  const there = world({ cfg: { provider: 'ollama', ttsEngine: 'openai', provisioned: true, wantModel: 'gemma3:12b', chatModel: 'gemma3:4b' }, state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b', 'gemma3:12b-it-q4_K_M'] } });
  await there.p.run();
  assert.deepEqual(there.state.pulls, [], 'it is there');
  assert.equal(there.cfg.chatModel, 'gemma3:12b-it-q4_K_M');
  assert.equal(there.cfg.wantModel, '', 'asked once');
  const fetch = world({ cfg: { provider: 'ollama', ttsEngine: 'openai', provisioned: true, wantModel: 'gemma3:1b', chatModel: 'gemma3:4b' }, state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, models: ['gemma3:4b'] } });
  await fetch.p.run();
  assert.deepEqual(fetch.state.pulls, ['gemma3:1b'], 'the one picked, though another is installed');
  assert.equal(fetch.cfg.chatModel, 'gemma3:1b');
  assert.equal(fetch.cfg.wantModel, '');
  // on a PC that would have taken a cloud mind, a model that was asked for is still Ollama's
  const weak = world({ cfg: { provider: 'ollama', ttsEngine: 'openai', provisioned: true, wantModel: 'gemma3:1b' }, state: { hw: pc({ ram: 3 * GB }), ollamaRunning: true, ollamaFound: true } });
  await weak.p.run();
  assert.equal(weak.p.step('ollama-model').state, 'done');
  assert.deepEqual(weak.state.pulls, ['gemma3:1b']);
});

test('a failed fetch of the picked model keeps the wish, so that "try again" goes on with it', async () => {
  const w = world({ cfg: { provider: 'ollama', ttsEngine: 'openai', provisioned: true, wantModel: 'gemma3:1b' }, state: { hw: pc({ ram: 15.9 * GB }), ollamaRunning: true, pullFails: 'dial tcp: no such host' } });
  await w.p.run();
  assert.equal(w.p.step('ollama-model').state, 'failed');
  assert.equal(w.cfg.wantModel, 'gemma3:1b');
  w.state.pullFails = '';
  await w.p.retry();
  assert.equal(w.p.ok, true);
  assert.equal(w.cfg.chatModel, 'gemma3:1b');
  assert.equal(w.cfg.wantModel, '');
});

test('the look at the PC for her main menu starts and fetches nothing', async () => {
  const w = world({ state: { hw: pc({ ram: 15.9 * GB, gpus: [nvidia('RTX 3060', 12)] }), ollamaRunning: true, models: ['gemma3:4b'], piperFound: true, piperVoice: 'en_US-amy-medium' } });
  const look = await w.p.preview();
  assert.equal(look.profile.id, 'strong');
  assert.equal(look.hw.gpu.vram, 12 * GB);
  assert.deepEqual(look.have.models, ['gemma3:4b']);
  assert.equal(look.have.piper, true);
  assert.deepEqual([w.state.pulls, w.state.installed, w.state.piperInstalls, w.state.tuned], [[], [], 0, []], 'nothing was done');
  assert.equal(w.p.running, false);
  assert.deepEqual(w.state.hardwareCalls, [{ force: false }]);
  await w.p.preview({ rescan: true });
  assert.deepEqual(w.state.hardwareCalls[1], { force: true });
  const broken = world({ state: { hardwareFails: true } });
  assert.ok((await broken.p.preview()).profile.id, 'a look that fails still gives a usual PC');
});

// ---- Node.js ----

test('Node.js is looked for first: if it is there, nothing is fetched; if not, the portable one is fetched into her folder and put on your PATH', async () => {
  const has = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }) } });
  await has.p.run();
  assert.equal(has.p.step('node').state, 'done');
  assert.match(has.p.step('node').detail, /Node\.js 22\.1\.0/);
  assert.deepEqual(has.state.nodeInstalls, []);
  assert.equal(has.p.attention, false, 'nothing long happened');

  const none = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }), nodeFound: false } });
  const changes = [];
  none.p.on('change', (s) => changes.push(s));
  await none.p.run();
  assert.equal(none.p.ok, true, JSON.stringify(states(none.p)));
  assert.equal(none.state.nodeInstalls.length, 1);
  assert.equal(none.state.nodeInstalls[0].arch, 'x64');
  assert.deepEqual(none.state.nodePath, [none.state.nodeInstalls[0].dir], 'on your PATH');
  assert.match(none.p.step('node').detail, /Installed Node\.js 24\.22\.1 .* added it to the PATH/);
  assert.equal(none.p.attention, true, 'a fetch: worth showing');
  assert.ok(changes.some((c) => /Fetching Node\.js: \d+ MB of \d+ MB/.test(c.steps.find((x) => x.id === 'node').detail)));
  assert.equal(none.p.snapshot().plan.node, true);
});

test('Node.js too old is replaced like a missing one; 32-bit Windows gets the 32-bit one; failing says why with a button to its page', async () => {
  const old = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }), nodeFound: false, nodeOld: true } });
  await old.p.run();
  assert.equal(old.state.nodeInstalls.length, 1);
  const x86 = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true }, state: { hw: pc({ arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' }, ram: 3 * GB }), nodeFound: false } });
  await x86.p.run();
  assert.equal(x86.state.nodeInstalls[0].arch, 'ia32');
  const arm = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true }, state: { hw: pc({ arch: 'arm64', ram: 16 * GB }), nodeFound: false } });
  await arm.p.run();
  assert.equal(arm.state.nodeInstalls[0].arch, 'arm64');
  const bad = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }), nodeFound: false, nodeFails: 'nodejs.org answered 503' } });
  await bad.p.run();
  assert.equal(bad.p.step('node').state, 'failed');
  assert.match(bad.p.step('node').error, /Could not install Node\.js: nodejs\.org answered 503/);
  assert.deepEqual(bad.p.step('node').actions, ['retry', 'open-node-site']);
  bad.state.nodeFails = '';
  await bad.p.retry();
  assert.equal(bad.p.step('node').state, 'done');
});

test('Node.js is left alone where she does not install it, and when you turned it off; the rest goes on either way', async () => {
  const lin = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true }, platform: 'linux', state: { hw: pc({ platform: 'linux', ram: 15.9 * GB }), nodeFound: false } });
  await lin.p.run();
  assert.equal(lin.p.step('node').state, 'skipped');
  assert.match(lin.p.step('node').detail, /get it from nodejs\.org/);
  assert.deepEqual(lin.state.nodeInstalls, []);
  assert.equal(lin.p.ok, true);
  const off = world({ cfg: { provider: 'anthropic', ttsEngine: 'openai', provisioned: true, autoNode: false }, state: { hw: pc({ ram: 15.9 * GB }), nodeFound: false } });
  await off.p.run();
  assert.equal(off.p.step('node').state, 'skipped');
  assert.deepEqual(off.state.nodeInstalls, []);
  assert.equal(off.p.snapshot().plan.node, false);
  const slow = world({ cfg: { provider: 'ollama', ttsEngine: 'openai', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }), nodeFound: false, nodeFails: 'down', ollamaRunning: true, models: ['gemma3:4b'] } });
  await slow.p.run();
  assert.equal(slow.p.step('ollama-model').state, 'done', 'a Node that cannot be fetched does not hold up her mind');
});

// ---- what she puts on this PC is written down, so that she can take exactly that off again (installed.js, cleanup.js) ----

test('what she installs is written down: Ollama and how, the model she pulled, Python, Node.js; what was there already is not', async () => {
  const notes = [];
  const fresh = world({
    cfg: { ttsEngine: 'chatterbox', provisioned: true }, state: { ollamaFound: false, hasPackage: false, cbProgress: [1], nodeFound: false, systemPython: null, hw: pc({ ram: 32 * GB, vram: 8 * GB }) },
    deps: { record: (kind, value) => notes.push([kind, value]) },
  });
  await fresh.p.run(); // (no Python yet: the installer brings one)
  const kinds = notes.map(([k]) => k);
  assert.ok(kinds.includes('node'), JSON.stringify(notes));
  assert.deepEqual(notes.find(([k]) => k === 'ollama')[1].how, 'winget');
  assert.deepEqual(notes.filter(([k]) => k === 'model').map(([, v]) => v), ['gemma3:4b']);
  assert.ok(kinds.includes('python'));

  // all of it there already: nothing is written down as hers
  const had = world({ cfg: { chatModel: 'gemma3:4b' }, state: { models: ['gemma3:4b'], ollamaRunning: true, hw: pc({ ram: 15.9 * GB }) }, deps: { record: (...a) => notes.push(['had', ...a]) } });
  await had.p.run();
  assert.deepEqual(notes.filter(([k]) => k === 'had'), []);
});

test('Ollama from the zip is written down as a zip; one installed with its own installer as that', async () => {
  const zipNotes = [];
  const zip = world({
    state: { ollamaFound: false, hw: pc({ ram: 15.9 * GB }) }, installOllama: async () => ({ ok: false }),
    deps: { downloadOllamaZip: async () => { zip.state.ollamaFound = true; return { ok: true, dir: '/userdata/ollama' }; }, record: (kind, value) => zipNotes.push([kind, value]) },
  });
  await zip.p.run();
  assert.deepEqual(zipNotes.find(([k]) => k === 'ollama')[1], { how: 'zip', dir: '/userdata/ollama' });
  const setupNotes = [];
  const inst = world({
    state: { ollamaFound: false, hw: pc({ ram: 15.9 * GB }) }, installOllama: async () => ({ ok: false }),
    deps: { downloadOllama: async () => { inst.state.ollamaFound = true; return { ok: true }; }, record: (kind, value) => setupNotes.push([kind, value]) },
  });
  await inst.p.run();
  assert.equal(setupNotes.find(([k]) => k === 'ollama')[1].how, 'installer');
});

test('a mind taken off the disk is not fetched again: autoMind off means no Ollama and no model, until she is told to', async () => {
  const w = world({ cfg: { autoMind: false, provider: 'ollama', ttsEngine: 'system', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }) } });
  await w.p.run();
  assert.equal(w.p.snapshot().plan.ollama, false);
  assert.deepEqual(w.state.pulls, []);
  assert.equal(w.p.step('ollama-model').state, 'skipped');
  // on again: the way it was
  const on = world({ cfg: { autoMind: true, provider: 'ollama', ttsEngine: 'system', provisioned: true }, state: { hw: pc({ ram: 15.9 * GB }) } });
  await on.p.run();
  assert.equal(on.p.snapshot().plan.ollama, true);
});

test('the Chatterbox folder she makes has its model\'s cache inside it, and pip is told not to keep a cache: all of it goes with the folder', async () => {
  const w = world({ cfg: { ttsEngine: 'chatterbox', provisioned: true }, state: { hasPackage: false, cbProgress: [1], hw: pc({ ram: 32 * GB, vram: 8 * GB }) } });
  await w.p.run();
  assert.ok(fs.existsSync(path.join(w.cfg.chatterboxDir, 'huggingface')), 'the cache folder is made (so the model is kept there)');
  assert.ok(w.state.pips.some((args) => args.includes('--no-cache-dir')), JSON.stringify(w.state.pips));
});

// ---- her ears: the recogniser of speech on this PC ----

const winPc = (o = {}) => pc({ platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'AMD64' }, ram: 16 * GB, ...o });

test('her ears are made ready with her mind and her voice: the program, the model that suits the PC, a check that it hears; and the recogniser on this PC is the one she uses from then on', async () => {
  const { p, state, cfg } = world({ cfg: { sttEngine: 'groq' }, state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], whisperFound: false, whisperModel: '' } });
  const changes = [];
  p.on('change', (s) => changes.push(s));
  await p.run();
  assert.equal(p.ok, true, JSON.stringify(states(p, true)));
  assert.deepEqual(['ws-find', 'ws-model', 'ws-run'].map((id) => p.step(id).state), ['done', 'done', 'done']);
  assert.equal(state.whisperInstalls, 1, 'the program was fetched');
  assert.deepEqual(state.whisperFetches, ['small'], 'and the model of the middle size, for a 16 GB PC');
  assert.deepEqual(state.recorded.filter(([k]) => k === 'whisper'), [['whisper', { dir: '/w' }]], 'written down as hers, so that she can take it off');
  assert.equal(cfg.whisperTier, 'small');
  assert.equal(cfg.earsChecked, '/w/whisper-server|/w/models/ggml-small-q5_1.bin', 'the check is written down');
  assert.equal(state.whisperChecks, 1);
  assert.equal(cfg.sttEngine, 'local', 'a cloud recogniser that had no key is not her ears');
  assert.match(p.step('ws-run').detail, /It hears and understands \(ggml-small-q5_1\.bin\)/);
  assert.equal(p.attention, true, 'a fetch happened: the window was worth showing');
  const bar = changes.map((c) => c.steps.find((x) => x.id === 'ws-find')).filter((x) => x.state === 'running' && x.progress !== null).map((x) => x.progress);
  assert.ok(bar.length >= 3 && bar.at(-1) === 1, `the program's bar went up: ${bar}`);
  assert.ok(changes.some((c) => /Fetching the speech model: \d+ MB of \d+ MB/.test(c.steps.find((x) => x.id === 'ws-model').detail)));
  assert.equal(p.snapshot().plan.whisper, true);
  assert.equal(p.snapshot().profile.download.total, 0, 'after all of it is fetched the plan has nothing left to fetch');
});

test('the second start: the program and the model are there, nothing is fetched, the window stays shut; a model of her own is taken as it is', async () => {
  const { p, state } = world({ cfg: { sttEngine: 'local', whisperTier: 'small', earsChecked: '/w/whisper-server|/w/models/ggml-small-q5_1.bin', ttsEngine: 'piper', provisioned: true, chatModel: 'gemma3:4b' }, state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], piperFound: true, piperVoice: 'en_US-amy-medium' } });
  await p.run();
  assert.equal(p.ok, true);
  assert.equal(p.attention, false);
  assert.deepEqual([state.whisperInstalls, state.whisperFetches], [0, []]);
  assert.deepEqual([state.whisperChecks, p.step('ws-run').state], [0, 'done'], 'the check was made once, the first time, and is not made at every start (a model of hundreds of megabytes)');
  const own = world({ cfg: { ttsEngine: 'piper', provisioned: true }, state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], piperFound: true, piperVoice: 'en_US-amy-medium', whisperModel: 'ggml-medium.bin' } });
  await own.p.run();
  assert.deepEqual(own.state.whisperFetches, [], 'a model that lies there is not fetched over');
  assert.match(own.p.step('ws-model').detail, /ggml-medium\.bin/);
});

test('the model is picked by the PC: a small one for 4 GB, a big one for a strong PC; a 32-bit Windows gets the small one too', async () => {
  const tier = async (hw) => {
    const w = world({ state: { hw, ollamaRunning: true, models: ['gemma3:1b', 'gemma3:4b'], whisperFound: false, whisperModel: '' } });
    await w.p.run();
    return w.state.whisperFetches[0];
  };
  assert.equal(await tier(winPc({ ram: 4 * GB })), 'base');
  assert.equal(await tier(winPc({ ram: 32 * GB, cpu: { name: '', cores: 12, threads: 24 } })), 'turbo');
  assert.equal(await tier(winPc({ arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' }, ram: 16 * GB })), 'base');
});

test('her ears are not prepared where they are not wanted: a cloud recogniser with its key, ears turned off, a system with no program of hers', async () => {
  const keyed = world({ cfg: { sttEngine: 'groq', apiKeys: { groq: 'sealed' } }, state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], whisperFound: false, whisperModel: '' } });
  await keyed.p.run();
  assert.equal(keyed.p.plan.whisper, false);
  assert.deepEqual(['ws-find', 'ws-model', 'ws-run'].map((id) => keyed.p.step(id).state), ['skipped', 'skipped', 'skipped']);
  assert.equal(keyed.state.whisperInstalls, 0);
  const off = world({ cfg: { autoEars: false }, state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], whisperFound: false, whisperModel: '' } });
  await off.p.run();
  assert.equal(off.p.plan.whisper, false, 'taken off, she does not fetch it again behind your back');
  const linux = world({ state: { hw: pc({ platform: 'linux', ram: 16 * GB }), ollamaRunning: true, models: ['gemma3:4b'], whisperFound: false, whisperModel: '' } });
  await linux.p.run();
  assert.equal(linux.p.plan.whisper, false);
  assert.equal(linux.p.ok, true);
});

test('her ears failing say where, with the buttons that help, and do not keep the rest back: her mind and voice are ready, the voice is tried', async () => {
  const finished = [];
  const down = world({ state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], whisperFound: false, whisperModel: '', whisperInstallFails: 'github.com answered 503 for whisper-bin-x64.zip' } });
  down.p.on('finish', (f) => finished.push(f));
  await down.p.run();
  assert.equal(down.p.step('ws-find').state, 'failed');
  assert.match(down.p.step('ws-find').error, /Could not get the speech recogniser: github\.com answered 503/);
  assert.deepEqual(down.p.step('ws-find').actions, ['retry', 'choose-whisper']);
  assert.equal(down.p.step('ws-model').state, 'pending', 'the steps after the failed one wait');
  assert.equal(down.p.ok, false);
  assert.equal(finished[0].ok, false);
  assert.equal(finished[0].core, true, 'her mind and her voice are ready all the same');
  // the model failing, then the check failing
  const model = world({ state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], whisperModel: '', whisperModelFails: 'huggingface.co answered 403' } });
  await model.p.run();
  assert.match(model.p.step('ws-model').error, /Could not fetch the speech model: huggingface\.co answered 403/);
  const check = world({ state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], whisperCheckFails: 'this processor lacks an instruction the program needs' } });
  await check.p.run();
  assert.equal(check.p.step('ws-run').state, 'failed');
  assert.match(check.p.step('ws-run').error, /did not start: this processor lacks an instruction/);
  assert.deepEqual(check.p.step('ws-run').log, ['whisper log'], 'the program\'s own lines come with it for the report');
  assert.match(check.p.report(), /whisper: .*"phase":"failed"/);
  // retrying goes on from there
  down.state.whisperInstallFails = '';
  await down.p.retry();
  assert.equal(down.p.ok, true, JSON.stringify(states(down.p, true)));
});

test('the folder named for her ears that is gone is told as that, with a button to pick another', async () => {
  const w = world({ cfg: { whisperDir: '/gone/whisper' }, state: { hw: winPc(), ollamaRunning: true, models: ['gemma3:4b'], whisperFound: false, whisperModel: '' } });
  await w.p.run();
  assert.equal(w.p.step('ws-find').state, 'failed');
  assert.match(w.p.step('ws-find').error, /The folder \/gone\/whisper is not there/);
  assert.deepEqual(w.p.step('ws-find').actions, ['retry', 'choose-whisper']);
  assert.equal(w.state.whisperInstalls, 0);
});
