'use strict';

// Getting what she lives on ready, by herself, when she starts: her mind (Ollama, with a model to talk with)
// and her voice (Chatterbox). Each is a few steps: find it (or install it), make it ready (a Python for the
// voice, its package), start it, load the model. Every step first looks whether it is done already, so a
// normal start-up costs a moment and nothing is shown; what takes long (an install, a download of a few GB)
// is told to the preparation window (prepare.js) with how far it is, and what fails says why, with the buttons
// that may help.
//
//   steps: ollama-find, ollama-run, ollama-model  |  cb-find, cb-python, cb-package, cb-model
//   a step is { id, group, state: 'pending' | 'running' | 'done' | 'failed' | 'skipped', progress (0..1 or
//   null), detail (what she says about it), error, heavy (a long job: worth showing), actions, log }

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { findFolder, findPython, pythonCandidates } = require('./chatterbox');
const tools = require('./chatterbox-setup');
const { text } = require('./prepare-lines');

const GB = 1024 ** 3;
const STEPS = [
  ['ollama-find', 'ollama'], ['ollama-run', 'ollama'], ['ollama-model', 'ollama'],
  ['cb-find', 'chatterbox'], ['cb-python', 'chatterbox'], ['cb-package', 'chatterbox'], ['cb-model', 'chatterbox'],
];
const CB_MODEL_WAIT = 20 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- which model to talk with ----

const NOT_FOR_TALKING = /embed|nomic|bge|minilm|rerank|granite-embedding/i;
const EYES_ONLY = /^(llava|bakllava|moondream|qwen2\.5vl)/i;
const PREFER = ['qwen2.5', 'gemma3', 'llama3.1', 'llama3.2', 'llama3', 'qwen3', 'mistral', 'phi'];

// The model of those installed she should talk with: the one in her config, else the best she likes, else any
// that can talk. null: none can.
function pickInstalled(models = [], wanted = null) {
  if (wanted && models.includes(wanted)) return wanted;
  const talkers = models.filter((m) => !NOT_FOR_TALKING.test(m));
  const chat = talkers.filter((m) => !EYES_ONLY.test(m));
  for (const prefix of PREFER) {
    const hit = chat.find((m) => m.toLowerCase().startsWith(prefix));
    if (hit) return hit;
  }
  return chat[0] || talkers[0] || null;
}

// The model to fetch when there is none: what this PC can carry next to the voice (which also wants the card)
function chooseModel({ ram = 0, vram = 0 } = {}) {
  if (vram >= 14 * GB || (!vram && ram >= 24 * GB)) return 'qwen2.5:7b';
  if (vram >= 6 * GB || ram >= 12 * GB) return 'gemma3:4b';
  return 'llama3.2';
}

// RAM, and the memory of an NVIDIA card if there is one
async function hardware({ execFile = cp.execFile } = {}) {
  const vram = await new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 6000 }, (err, out) => {
      if (err) return resolve(0);
      const mb = Math.max(0, ...String(out).split(/\r?\n/).map((l) => Number(l.trim()) || 0));
      return resolve(mb * 1024 * 1024);
    });
  });
  return { ram: os.totalmem(), vram };
}

const bytes = (n, lang) => {
  const unit = lang === 'ru' ? ['МБ', 'ГБ'] : ['MB', 'GB'];
  return n >= GB ? `${(n / GB).toFixed(1)} ${unit[1]}` : `${Math.max(1, Math.round(n / 1048576))} ${unit[0]}`;
};

class Provision extends EventEmitter {
  // deps: cfg() the config, save(patch) change it, lang(), ollamaHost, chatterbox, ollamaApi { models, pull },
  //       installOllama(onLine), installPython(onLine), roots(), defaultDir(), onModelsChanged(), hardware(), tools
  constructor(deps) {
    super();
    this.d = { hardware, tools, installOllama: null, downloadOllama: null, installPython: null, onModelsChanged: async () => {}, ...deps };
    this.plan = { ollama: false, chatterbox: false, adopt: false };
    this.running = false;
    this.finished = false;
    this.ok = false;
    this.attention = false; // something long is going on, or failed: the window is worth showing
    this.abort = null;
    this.cancelled = false;
    this.started = 0;
    this.job = null;
    this.reset();
  }

  t(key, args) {
    return text(this.d.lang(), key, args);
  }

  reset() {
    this.steps = STEPS.map(([id, group]) => ({ id, group, state: 'pending', progress: null, detail: '', error: '', heavy: false, actions: [], log: [] }));
  }

  step(id) {
    return this.steps.find((s) => s.id === id);
  }

  snapshot() {
    return {
      running: this.running, finished: this.finished, ok: this.ok, attention: this.attention, plan: this.plan,
      steps: this.steps.map((s) => ({ ...s, log: s.log.slice(-6) })),
    };
  }

  update(id, patch) {
    const s = this.step(id);
    Object.assign(s, patch);
    if (patch.heavy || patch.state === 'failed') this.attention = true;
    this.emit('change', this.snapshot());
  }

  begin(id, patch = {}) {
    this.update(id, { state: 'running', progress: null, error: '', actions: [], detail: '', heavy: false, ...patch });
  }

  done(id, detail = '') {
    this.update(id, { state: 'done', progress: null, detail, error: '', actions: [], heavy: false });
  }

  fail(id, error, actions = ['retry'], log = []) {
    this.update(id, { state: 'failed', progress: null, detail: '', error: String(error).slice(0, 400), actions, heavy: false, log });
    throw Object.assign(new Error(error), { step: id, handled: true });
  }

  skip(id, detail = '') {
    this.update(id, { state: 'skipped', progress: null, detail, error: '', actions: [], heavy: false });
  }

  // what she should get ready, from her config: her mind if Ollama is who answers; her voice if it is Chatterbox, or
  // if it is still the system's and she has not made up her mind about it (the first time: she takes Chatterbox)
  decide(cfg) {
    const adopt = !cfg.provisioned && (cfg.ttsEngine || 'system') === 'system';
    return { ollama: (cfg.provider || 'ollama') === 'ollama', chatterbox: cfg.ttsEngine === 'chatterbox' || adopt, adopt };
  }

  // Starts, or says it is on already. Resolves when everything wanted is ready or has failed.
  run() {
    if (this.job) return this.job;
    this.job = this.go().finally(() => { this.job = null; });
    return this.job;
  }

  async go() {
    const cfg = this.d.cfg();
    this.plan = this.decide(cfg);
    this.running = true;
    this.finished = false;
    this.ok = false;
    this.attention = false;
    this.cancelled = false;
    this.abort = new AbortController();
    this.started = Date.now();
    this.reset();
    for (const s of this.steps) if (!this.plan[s.group]) s.state = 'skipped';
    this.emit('change', this.snapshot());
    const jobs = [];
    if (this.plan.ollama) jobs.push(this.group(() => this.runOllama()));
    if (this.plan.chatterbox) jobs.push(this.group(() => this.runChatterbox()));
    await Promise.all(jobs);
    this.running = false;
    this.finished = true;
    this.ok = this.steps.every((s) => s.state === 'done' || s.state === 'skipped');
    if (this.cancelled) this.ok = false;
    this.emit('change', this.snapshot());
    this.emit('finish', { ok: this.ok, plan: this.plan, attention: this.attention });
  }

  // one group of steps: the first failure stops it, nothing else
  async group(fn) {
    try {
      await fn();
    } catch (err) {
      if (err.handled) return;
      // something nobody planned for: shown on the step that was running
      const running = this.steps.find((s) => s.state === 'running');
      if (running) this.update(running.id, { state: 'failed', error: String(err.message || err).slice(0, 400), actions: ['retry'], heavy: false, progress: null });
    }
  }

  // stops what is being fetched (the window's "skip", or her quitting)
  cancel() {
    this.cancelled = true;
    this.abort?.abort();
  }

  retry() {
    return this.run();
  }

  // ---- her mind ----

  async runOllama() {
    const { ollamaHost, ollamaApi } = this.d;
    const cfg = () => this.d.cfg();
    const lang = this.d.lang();
    // find it
    this.begin('ollama-find');
    if (await ollamaHost.versionFn()) {
      this.done('ollama-find', this.t('olRunning'));
    } else {
      let found = await ollamaHost.locate(cfg());
      if (!found && !String(cfg().ollamaDir || '').trim()) {
        // nowhere: get it (winget, else its own installer)
        const installs = [this.d.installOllama, this.d.downloadOllama].filter(Boolean);
        for (const install of installs) {
          this.begin('ollama-find', { heavy: true, detail: this.t('olInstalling', { line: '' }) });
          const res = await install((line) => this.update('ollama-find', { detail: this.t('olInstalling', { line: String(line).slice(0, 80) }) })).catch((err) => ({ ok: false, error: err.message }));
          if (res.ok) found = await ollamaHost.locate(cfg());
          if (found) break;
        }
      }
      if (!found) this.fail('ollama-find', this.t('olMissing'), ['retry', 'choose-ollama', 'open-ollama-site']);
      this.done('ollama-find', this.t('olFoundAt', { path: found.exe }));
    }
    // start it
    this.begin('ollama-run', { detail: this.t('olStarting') });
    try {
      if (ollamaHost.status().phase === 'failed') ollamaHost.stop(false);
      await ollamaHost.ready(cfg(), 90000);
    } catch (err) {
      this.fail('ollama-run', err.message, ['retry', 'choose-ollama'], ollamaHost.status().log);
    }
    this.done('ollama-run', this.t('olUp', { from: ollamaHost.status().modelsDir ? this.t('olFromFolder') : '' }));
    // a model to talk with
    this.begin('ollama-model');
    const models = await ollamaApi.models().catch(() => []);
    const have = pickInstalled(models, cfg().chatModel);
    if (have) {
      if (cfg().chatModel !== have && !models.includes(cfg().chatModel)) this.d.save({ chatModel: have });
      await this.d.onModelsChanged();
      this.done('ollama-model', this.t('olModelHave', { model: have }));
      return;
    }
    const target = this.d.chatModel || chooseModel(await this.d.hardware());
    this.begin('ollama-model', { heavy: true, progress: 0, detail: this.t('olPulling', { model: target }) });
    try {
      await ollamaApi.pull(target, (p) => {
        if (!p.total) return;
        this.update('ollama-model', {
          heavy: true, progress: Math.min(1, p.completed / p.total),
          detail: this.t('olPullingOf', { model: target, done: bytes(p.completed, lang), total: bytes(p.total, lang) }),
        });
      }, this.abort.signal);
    } catch (err) {
      if (this.cancelled) this.fail('ollama-model', this.t('olPullFailed', { model: target, error: 'cancelled' }), ['retry']);
      this.fail('ollama-model', this.t('olPullFailed', { model: target, error: err.message }), ['retry']);
    }
    const after = await ollamaApi.models().catch(() => []);
    const name = after.find((m) => m === target || m.startsWith(`${target.split(':')[0]}:`)) || target;
    this.d.save({ chatModel: name, provider: 'ollama' });
    await this.d.onModelsChanged();
    this.done('ollama-model', this.t('olModelHave', { model: name }));
  }

  // ---- her voice ----

  async runChatterbox() {
    const { chatterbox, tools: setup } = this.d;
    const cfg = () => this.d.cfg();
    const own = String(cfg().chatterboxUrl || '').trim();
    if (own) {
      for (const id of ['cb-find', 'cb-python', 'cb-package']) this.skip(id, '');
      this.begin('cb-model', { detail: this.t('cbLoading') });
      this.d.save({ ttsEngine: 'chatterbox', provisioned: true });
      await chatterbox.sync(cfg());
      this.done('cb-model', this.t('cbOwn', { url: own }));
      return;
    }
    // the folder
    this.begin('cb-find');
    let dir = findFolder(cfg(), this.d.roots());
    if (!dir) {
      if (String(cfg().chatterboxDir || '').trim()) this.fail('cb-find', this.t('cbFolderGone', { path: cfg().chatterboxDir }), ['retry', 'choose-chatterbox']);
      dir = this.d.defaultDir();
      fs.mkdirSync(dir, { recursive: true });
      this.d.save({ chatterboxDir: dir });
      this.done('cb-find', this.t('cbFolderNew', { path: dir }));
    } else {
      this.done('cb-find', this.t('cbFolderAt', { path: dir }));
    }
    // a Python for it: the folder's own, one of the system that already has the package, or a new environment
    this.begin('cb-python');
    let python = findPython(dir);
    if (!python) {
      const system = pythonCandidates(null).find(([cmd, pre]) => setup.hasChatterbox(cmd, { pre }));
      if (system) {
        this.done('cb-python', this.t('cbPythonAt', { path: system[0] }));
        python = null;
      } else {
        this.begin('cb-python', { heavy: true, detail: this.t('cbPythonMaking') });
        let sys = setup.findSystemPython();
        if ((!sys || sys.tooNew) && this.d.installPython) {
          this.update('cb-python', { detail: this.t('cbPythonInstalling', { line: '' }) });
          await this.d.installPython((line) => this.update('cb-python', { detail: this.t('cbPythonInstalling', { line: String(line).slice(0, 80) }) })).catch(() => ({ ok: false }));
          sys = setup.findSystemPython();
        }
        if (!sys || sys.tooNew) {
          this.fail('cb-python', this.t('cbNoPython', { found: sys?.tooNew ? this.t('cbFoundWrong', { version: sys.tooNew }) : '' }), ['retry', 'open-python-site', 'choose-chatterbox']);
        }
        try {
          this.update('cb-python', { detail: this.t('cbPythonMaking') });
          python = setup.createVenv(sys, dir);
        } catch (err) {
          this.fail('cb-python', err.message, ['retry', 'choose-chatterbox']);
        }
        this.done('cb-python', this.t('cbPythonAt', { path: python }));
      }
    } else {
      this.done('cb-python', this.t('cbPythonAt', { path: python }));
    }
    // the package, in it
    this.begin('cb-package');
    if (python && !setup.hasChatterbox(python)) {
      this.begin('cb-package', { heavy: true, detail: this.t('cbPackageInstalling', { what: 'chatterbox-tts' }) });
      const target = setup.installTarget(dir);
      const onLine = (line) => {
        const a = setup.pipActivity(line);
        if (a) this.update('cb-package', { detail: this.t('cbPackageInstalling', { what: `${a.what}${a.size ? ` (${a.size})` : ''}` }) });
      };
      const res = await setup.pip(python, ['install', ...target.args], onLine);
      if (!res.ok) this.fail('cb-package', this.t('cbPackageFailed', { error: res.tail.slice(-3).join(' ') }), ['retry'], res.tail);
    }
    if (python) await this.graphicsCard(python);
    this.done('cb-package', this.t('cbPackageHave'));
    // start it, and wait for the model
    this.begin('cb-model', { detail: this.t('cbLoading') });
    if (!cfg().ttsEngine || cfg().ttsEngine !== 'chatterbox') this.d.save({ ttsEngine: 'chatterbox', voiceMode: cfg().voiceMode === 'off' ? 'chat' : cfg().voiceMode, provisioned: true });
    if (chatterbox.status().phase === 'failed') await chatterbox.restart(cfg());
    else await chatterbox.sync(cfg());
    const until = Date.now() + CB_MODEL_WAIT;
    while (Date.now() < until) {
      if (this.cancelled) this.fail('cb-model', this.t('cbFailed', { error: 'cancelled' }), ['retry']);
      const st = chatterbox.status();
      if (st.phase === 'ready') {
        this.done('cb-model', this.t('cbReady', { device: st.device || 'cpu' }));
        return;
      }
      if (st.phase === 'failed') this.fail('cb-model', this.t('cbFailed', { error: st.error }), ['retry', 'choose-chatterbox'], st.log);
      if (st.progress !== null) this.update('cb-model', { heavy: true, progress: st.progress, detail: this.t('cbDownloading', { percent: Math.round(st.progress * 100) }) });
      else this.update('cb-model', { detail: st.log.length ? `${this.t('cbLoading')} ${st.log[st.log.length - 1].slice(0, 80)}` : this.t('cbLoading') });
      await sleep(400);
    }
    this.fail('cb-model', this.t('cbFailed', { error: 'timeout' }), ['retry'], chatterbox.status().log);
  }

  // an NVIDIA card and a torch that cannot use it: the same torch, built for the card (not fatal if it cannot be)
  async graphicsCard(python) {
    const { tools: setup } = this.d;
    const torch = setup.torchStatus(python);
    if (!torch || torch.cuda || !(await setup.hasNvidia())) return;
    this.update('cb-package', { heavy: true, detail: this.t('cbGpu') });
    const res = await setup.pip(python, setup.cudaTorchArgs(torch), () => {});
    if (!res.ok) this.update('cb-package', { detail: this.t('cbCpu') });
  }

  // ---- for the window and the bug reports ----

  report() {
    const lines = [`Capri preparation, ${new Date().toISOString()}`, `plan: ${JSON.stringify(this.plan)}`];
    for (const s of this.steps) {
      lines.push(`[${s.state}] ${s.id}${s.detail ? `: ${s.detail}` : ''}${s.error ? `\n    error: ${s.error}` : ''}`);
      for (const l of s.log || []) lines.push(`    | ${l}`);
    }
    const ol = this.d.ollamaHost?.status?.();
    const cb = this.d.chatterbox?.status?.();
    if (ol) lines.push(`ollama: ${JSON.stringify({ phase: ol.phase, exe: ol.exe, models: ol.modelsDir, error: ol.error })}`, ...ol.log.map((l) => `    | ${l}`));
    if (cb) lines.push(`chatterbox: ${JSON.stringify({ phase: cb.phase, dir: cb.dir, python: cb.python, device: cb.device, error: cb.error })}`, ...cb.log.map((l) => `    | ${l}`));
    lines.push(`os: ${process.platform} ${os.release()}, ram ${Math.round(os.totalmem() / GB)} GB`);
    return lines.join('\n');
  }
}

module.exports = { Provision, STEPS, pickInstalled, chooseModel, hardware, bytes };
