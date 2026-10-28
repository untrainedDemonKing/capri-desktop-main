'use strict';

// Getting her mind (Ollama) and her voice (Chatterbox or Piper) ready by herself, by the PC she is on
// (src/main/provision.js), with stand-ins for what is slow or far: the look at the PC, the Ollama program and its
// model fetch, the Python tools, the voice servers. The real pieces together are in tests/prepare.e2e.test.js.
//   node --test tests/provision.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { Provision, pickInstalled, sameModel, bytes } = require('../src/main/provision.js');
const hardware = require('../src/main/hardware.js');

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
    pipActivity: require('../src/main/chatterbox-setup.js').pipActivity,
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
    ollamaHost, chatterbox, piper, ollamaApi: api, tools, nodeTools, nodeDir: () => path.join(tmp, 'userdata', 'node'), platform: overrides.platform || 'win32',
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
  assert.deepEqual(p.plan, { ollama: false, chatterbox: false, piper: false, node: true, adopt: false, engine: 'elevenlabs' });
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
  assert.deepEqual(state.tuned.map((t) => t.numCtx), [3072]);
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
  const setup = require('../src/main/setup.js');
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
