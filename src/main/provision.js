'use strict';

// Getting what she lives on ready, by herself, when she starts: first a look at this PC (hardware.js), from
// which a profile is picked (profiles.js: which model to talk with, which voice, how much to fetch), then her
// mind (Ollama, with a model) and her voice (Chatterbox on a good card, Piper on a plain PC, the system's on
// the smallest) made ready for that PC. Each is a few steps: find it (or install it), make it ready (a Python for
// Chatterbox, its package), start it, load the model. Every step first looks whether it is done already, so a
// normal start-up costs a moment and nothing is shown; what takes long (an install, a download of a few GB) is
// told to the preparation window (prepare.js) with how far it is, and what fails says why, with the buttons
// that may help.
//
//   steps: scan  |  node  |  ollama-find, ollama-run, ollama-model  |  cb-find, cb-python, cb-package, cb-model  |
//          pp-find, pp-voice, pp-run
//   a step is { id, group, state: 'pending' | 'running' | 'done' | 'failed' | 'skipped', progress (0..1 or
//   null), detail (what she says about it), error, heavy (a long job: worth showing), actions, log }

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { findFolder, findPython, pythonCandidates } = require('./chatterbox');
const tools = require('./chatterbox-setup');
const nodeTools = require('./node-check');
const hardwareLib = require('./hardware');
const profiles = require('./profiles');
const { text } = require('./prepare-lines');

const GB = 1024 ** 3;
const STEPS = [
  ['scan', 'pc'],
  ['node', 'tools'],
  ['ollama-find', 'ollama'], ['ollama-run', 'ollama'], ['ollama-model', 'ollama'],
  ['cb-find', 'voice'], ['cb-python', 'voice'], ['cb-package', 'voice'], ['cb-model', 'voice'],
  ['pp-find', 'voice'], ['pp-voice', 'voice'], ['pp-run', 'voice'],
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

// the installed model that is this one ("gemma3:4b" for "gemma3:4b", or "gemma3:4b-it-q4_K_M"; "llama3.2" is "llama3.2:latest")
const sameModel = (models, want) => models.find((m) => m === want || m.startsWith(`${want}-`) || (!want.includes(':') && m === `${want}:latest`)) || null;

const bytes = (n, lang) => {
  const unit = lang === 'ru' ? ['МБ', 'ГБ'] : ['MB', 'GB'];
  return n >= GB ? `${(n / GB).toFixed(1)} ${unit[1]}` : `${Math.max(1, Math.round(n / 1048576))} ${unit[0]}`;
};

class Provision extends EventEmitter {
  // deps: cfg() the config, save(patch) change it, lang(), ollamaHost, chatterbox, piper, ollamaApi { models, pull },
  //       installOllama(onLine), downloadOllama(onLine), installPython(onLine), roots(), defaultDir(), onModelsChanged(),
  //       hardware({ force }) a look at this PC, tune(tuning, profileId) what the profile says Ollama is told, tools,
  //       nodeTools, nodeDir() where she fetches Node.js to, platform, record(kind, value) writes down what she put on
  //       this PC (installed.js), so that she can take it off again (cleanup.js)
  constructor(deps) {
    super();
    this.d = { hardware: () => hardwareLib.scan(), tools, nodeTools, nodeDir: () => '', platform: process.platform, installOllama: null, downloadOllama: null, installPython: null, tune: null, piper: null, onModelsChanged: async () => {}, record: () => {}, ...deps };
    this.plan = { ollama: false, chatterbox: false, piper: false, node: false, adopt: false };
    this.hw = null; // the picture of this PC (hardware.js)
    this.have = {}; // what is on it already
    this.profile = null; // what it gets (profiles.js)
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
      pc: this.hw ? profiles.describe(this.hw) : null,
      profile: this.profile && {
        id: this.profile.id, auto: this.profile.auto, wanted: this.profile.wanted, mind: this.profile.mind, voice: this.profile.voice,
        notes: this.profile.notes, choices: this.profile.choices, disk: this.profile.disk,
        download: { items: this.profile.download.items, total: this.profile.download.total },
      },
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

  // what is on this PC already, so the plan counts only what is missing
  async inventory(cfg) {
    const { ollamaHost, ollamaApi, piper } = this.d;
    const have = { ollama: false, models: [], chatterbox: false, piper: false, node: false };
    try {
      have.ollama = Boolean(await ollamaHost.versionFn?.()) || Boolean(await ollamaHost.locate(cfg));
    } catch { /* not there */ }
    try {
      have.models = await ollamaApi.models();
    } catch { /* not answering */ }
    try {
      have.piper = Boolean(piper?.locate(cfg)) && Boolean(piper.voices(cfg).length);
    } catch { /* not there */ }
    try {
      const dir = findFolder(cfg, this.d.roots());
      have.chatterbox = Boolean(dir && findPython(dir));
    } catch { /* not there */ }
    try {
      const found = await this.d.nodeTools.findNode({ ours: this.d.nodeDir(), platform: this.d.platform });
      have.node = Boolean(found && !found.tooOld);
    } catch { /* not there */ }
    return have;
  }

  // What she should get ready. The profile says what this PC can carry; what you have set and what you have put
  // next to her wins over it: your own mind (a provider that is not Ollama), your own voice (an engine that
  // is not hers), a Chatterbox folder you put next to her.
  decide(cfg, prof, have = {}) {
    const adopt = !cfg.provisioned && (cfg.ttsEngine || 'system') === 'system';
    let engine = cfg.ttsEngine || 'system';
    if (adopt) {
      engine = prof.voice.engine;
      if (engine !== 'chatterbox' && (cfg.profile || 'auto') === 'auto' && have.chatterbox) engine = 'chatterbox'; // (the folder you put next to her)
    }
    // (an Ollama that is already there stays her mind on a PC that would have taken a cloud one, unless you asked for the cloud)
    // (and the model you picked in her main menu is Ollama's whatever the PC would have taken)
    // (and not a mind you have taken off the disk: it is not fetched again until you choose it in her main menu)
    const ollama = cfg.autoMind !== false && (cfg.provider || 'ollama') === 'ollama' && (prof.mind.kind === 'ollama' || (prof.auto && Boolean(have.ollama)) || Boolean(cfg.wantModel));
    return { ollama, chatterbox: engine === 'chatterbox', piper: engine === 'piper', node: cfg.autoNode !== false, adopt, engine };
  }

  // The look at the PC and what is on it, with the plan for it, and nothing started or fetched (her main menu
  // shows it before you choose). { rescan }: look again.
  async preview({ rescan = false } = {}) {
    const cfg = this.d.cfg();
    let hw;
    try {
      hw = hardwareLib.normalize(await this.d.hardware({ force: rescan }));
    } catch {
      hw = hardwareLib.normalize({ ram: os.totalmem() });
    }
    const have = await this.inventory(cfg);
    return { hw, have, profile: profiles.plan(hw, { choice: cfg.profile || 'auto', have }) };
  }

  // Starts, or says it is on already. Resolves when everything wanted is ready or has failed. { rescan }: look at
  // the PC again (the window's button), not at the last look.
  run(opts = {}) {
    if (this.job) return this.job;
    this.job = this.go(opts).finally(() => { this.job = null; });
    return this.job;
  }

  async go({ rescan = false } = {}) {
    this.running = true;
    this.finished = false;
    this.ok = false;
    this.attention = false;
    this.cancelled = false;
    this.abort = new AbortController();
    this.started = Date.now();
    this.reset();
    this.emit('change', this.snapshot());
    try {
      await this.scan({ rescan });
    } catch (err) {
      if (!err.handled) this.update('scan', { state: 'failed', error: String(err.message || err).slice(0, 400), actions: ['retry'] });
    }
    if (this.step('scan').state === 'done') {
      const cfg = this.d.cfg();
      this.plan = this.decide(cfg, this.profile, this.have);
      for (const s of this.steps) {
        if (s.id !== 'scan' && !this.wanted(s)) s.state = 'skipped';
      }
      this.emit('change', this.snapshot());
      const jobs = [];
      if (this.plan.node) jobs.push(this.group(() => this.runNode()));
      if (this.plan.ollama) jobs.push(this.group(() => this.runOllama()));
      if (this.plan.chatterbox) jobs.push(this.group(() => this.runChatterbox()));
      if (this.plan.piper) jobs.push(this.group(() => this.runPiper()));
      // (a voice that is the system's, or a mind that is a cloud one: nothing to get ready, but it is her voice from now on)
      if (!this.plan.chatterbox && !this.plan.piper && this.plan.adopt) this.d.save({ provisioned: true });
      await Promise.all(jobs);
    } else {
      for (const s of this.steps) if (s.id !== 'scan') s.state = 'skipped';
    }
    // (what was to be fetched is there now: the plan counts again what is still missing)
    if (this.profile && this.step('scan').state === 'done') {
      try {
        this.have = await this.inventory(this.d.cfg());
        this.profile = profiles.refresh(this.profile, this.have);
      } catch { /* the first count stands */ }
    }
    this.running = false;
    this.finished = true;
    this.ok = this.steps.every((s) => s.state === 'done' || s.state === 'skipped');
    if (this.cancelled) this.ok = false;
    this.emit('change', this.snapshot());
    this.emit('finish', { ok: this.ok, plan: this.plan, attention: this.attention, profile: this.profile?.id });
  }

  wanted(step) {
    if (step.group === 'tools') return this.plan.node;
    if (step.group === 'ollama') return this.plan.ollama;
    if (step.id.startsWith('cb-')) return this.plan.chatterbox;
    if (step.id.startsWith('pp-')) return this.plan.piper;
    return true;
  }

  // ---- the PC ----

  async scan({ rescan }) {
    const cfg = this.d.cfg();
    this.begin('scan');
    let hw;
    try {
      hw = hardwareLib.normalize(await this.d.hardware({ force: rescan }));
    } catch {
      // (a look that fails must not stop her: a usual PC is assumed)
      hw = hardwareLib.normalize({ ram: os.totalmem() });
    }
    this.hw = hw;
    this.have = await this.inventory(cfg);
    this.profile = profiles.plan(hw, { choice: cfg.profile || 'auto', have: this.have });
    // a Chatterbox folder next to her (that you put there) stays her voice on a plain PC; the profile is told, for its numbers and notes
    if (!cfg.provisioned && (cfg.ttsEngine || 'system') === 'system' && this.profile.auto && this.have.chatterbox && this.profile.voice.engine !== 'chatterbox') {
      this.profile = profiles.plan(hw, { choice: cfg.profile || 'auto', have: this.have, voice: 'chatterbox' });
    }
    this.d.tune?.(this.profile.tuning, this.profile.id);
    this.done('scan', this.t('scanLine', {
      cpu: hw.cpu.name ? hw.cpu.name.replace(/\((R|TM)\)|CPU|Processor/gi, '').replace(/\s+/g, ' ').trim() : '',
      ram: bytes(hw.ram, this.d.lang()),
      gpu: hw.gpu && !hw.gpu.integrated ? `${hw.gpu.name.replace(/NVIDIA GeForce |AMD Radeon |Intel\(R\) /g, '')}${hw.gpu.vram ? ` ${bytes(hw.gpu.vram, this.d.lang())}` : ''}` : this.t('scanNoGpu'),
      profile: this.t(`profile-${this.profile.id}`),
    }));
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

  // ---- Node.js ----

  // Node.js is not needed by the installed Capri, but by what she sets up beside herself (the hooks of Codex, running
  // from the sources). Looked for; if it is not there, the portable one is fetched into her folder and put on your PATH.
  async runNode() {
    const { nodeTools } = this.d;
    const lang = this.d.lang();
    this.begin('node');
    const found = await nodeTools.findNode({ ours: this.d.nodeDir(), platform: this.d.platform });
    if (found && !found.tooOld) {
      this.done('node', this.t('nodeHave', { version: found.version, path: found.exe }));
      return;
    }
    if (this.d.platform !== 'win32') {
      this.skip('node', this.t('nodeManual'));
      return;
    }
    const os64 = this.hw?.os.is64 !== false;
    const arch = this.hw?.os.arch === 'arm64' ? 'arm64' : os64 ? 'x64' : 'ia32';
    this.begin('node', { heavy: true, progress: 0, detail: this.t('nodeFetching') });
    let got;
    try {
      got = await nodeTools.install({
        dir: this.d.nodeDir(), arch, signal: this.abort.signal,
        onProgress: ({ completed, total }) => this.update('node', { heavy: true, progress: total ? Math.min(1, completed / total) : null, detail: this.t('nodeFetchingOf', { done: bytes(completed, lang), total: total ? bytes(total, lang) : '?' }) }),
      });
    } catch (err) {
      this.fail('node', this.t('nodeFailed', { error: this.cancelled ? 'cancelled' : err.message }), ['retry', 'open-node-site']);
    }
    const onPath = nodeTools.addToUserPath(got.dir);
    this.d.record('node', { dir: got.dir, onPath: onPath.ok });
    this.done('node', this.t(onPath.ok ? 'nodeInstalled' : 'nodeInstalledNoPath', { version: got.version, dir: got.dir }));
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
        // nowhere: get it (winget, else its own installer, else its zip)
        const installs = [['winget', this.d.installOllama], ['installer', this.d.downloadOllama], ['zip', this.d.downloadOllamaZip]].filter(([, fn]) => fn);
        for (const [how, install] of installs) {
          this.begin('ollama-find', { heavy: true, detail: this.t('olInstalling', { line: '' }) });
          const res = await install((line) => this.update('ollama-find', { detail: this.t('olInstalling', { line: String(line).slice(0, 80) }) }), this.abort.signal).catch((err) => ({ ok: false, error: err.message }));
          if (res.ok && res.dir) this.d.save({ ollamaDir: res.dir }); // (the zip is unpacked into a folder of hers)
          if (res.ok) found = await ollamaHost.locate(cfg());
          if (found) {
            this.d.record('ollama', { how, dir: res.dir || '' }); // hers: she can take it off again
            break;
          }
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
    // a model to talk with: the one you picked in her main menu, the one you asked for with a profile, else one
    // of those she has, else the profile's
    this.begin('ollama-model');
    const models = await ollamaApi.models().catch(() => []);
    const picked = String(cfg().wantModel || '').trim();
    if (picked) {
      const there = sameModel(models, picked);
      if (there) {
        this.d.save({ chatModel: there, wantModel: '', provider: 'ollama' });
        await this.d.onModelsChanged();
        this.done('ollama-model', this.t('olModelHave', { model: there }));
        return;
      }
    }
    // (a profile you have just asked for brings its own model; after that your choice of model in her menu stands)
    const reselect = (cfg().profile || 'auto') !== 'auto' && cfg().profileApplied !== cfg().profile;
    const asked = reselect && this.profile.mind.model;
    const have = picked ? null : asked ? sameModel(models, asked) : pickInstalled(models, cfg().chatModel); // (what you picked is fetched, though another is there)
    if (have) {
      if (cfg().chatModel !== have && (asked || !models.includes(cfg().chatModel))) this.d.save({ chatModel: have });
      if (reselect) this.d.save({ profileApplied: cfg().profile });
      await this.d.onModelsChanged();
      this.done('ollama-model', this.t('olModelHave', { model: have }));
      return;
    }
    const target = picked || this.d.chatModel || this.profile.mind.model || profiles.LADDER[1].model;
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
    const name = sameModel(after, target) || target;
    this.d.record('model', name); // hers: she can take it off again
    this.d.save({ chatModel: name, provider: 'ollama', ...(picked ? { wantModel: '' } : {}), ...(reselect ? { profileApplied: cfg().profile } : {}) });
    await this.d.onModelsChanged();
    this.done('ollama-model', this.t('olModelHave', { model: name }));
  }

  // ---- her voice: Chatterbox ----

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
      fs.mkdirSync(path.join(dir, 'huggingface'), { recursive: true }); // (the model is kept in there too: it goes with the folder)
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
        let installedPython = false;
        if ((!sys || sys.tooNew) && this.d.installPython) {
          this.update('cb-python', { detail: this.t('cbPythonInstalling', { line: '' }) });
          await this.d.installPython((line) => this.update('cb-python', { detail: this.t('cbPythonInstalling', { line: String(line).slice(0, 80) }) })).catch(() => ({ ok: false }));
          sys = setup.findSystemPython();
          installedPython = Boolean(sys && !sys.tooNew); // (hers: she put it on this PC)
        }
        if (!sys || sys.tooNew) {
          this.fail('cb-python', this.t('cbNoPython', { found: sys?.tooNew ? this.t('cbFoundWrong', { version: sys.tooNew }) : '' }), ['retry', 'open-python-site', 'choose-chatterbox']);
        }
        if (installedPython) this.d.record('python');
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
      const wheels = this.wheelhouse(dir);
      const res = await setup.pip(python, ['install', '--no-cache-dir', ...(wheels ? ['--find-links', wheels] : []), ...target.args], onLine); // (no cache: gigabytes of wheels would stay behind)
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

  // a folder of wheels next to the Chatterbox folder or in it (for a PC with no internet: `pip download chatterbox-tts` on another)
  wheelhouse(dir) {
    for (const base of [dir, path.dirname(dir), ...this.d.roots()]) {
      const wheels = path.join(base, 'wheels');
      try {
        if (fs.readdirSync(wheels).some((f) => f.endsWith('.whl'))) return wheels;
      } catch { /* none here */ }
    }
    return '';
  }

  // an NVIDIA card (the profile says there is one that can carry the voice) and a torch that cannot use it: the
  // same torch, built for the card and its driver (not fatal if it cannot be)
  async graphicsCard(python) {
    const { tools: setup } = this.d;
    const cfg = this.d.cfg();
    const wantsCard = this.profile?.voice.device === 'cuda' || cfg.chatterboxDevice === 'cuda';
    if (!wantsCard || cfg.chatterboxDevice === 'cpu') return;
    const torch = setup.torchStatus(python);
    if (!torch || torch.cuda) return;
    const args = setup.cudaTorchArgs(torch, this.hw?.gpu || {});
    if (!args) {
      this.update('cb-package', { detail: this.t('cbCpu') });
      return;
    }
    this.update('cb-package', { heavy: true, detail: this.t('cbGpu') });
    // (no cache here either: the build for the card is gigabytes)
    const uncached = args[0] === 'install' && !args.includes('--no-cache-dir') ? [args[0], '--no-cache-dir', ...args.slice(1)] : args;
    const res = await setup.pip(python, uncached, () => {});
    if (!res.ok) this.update('cb-package', { detail: this.t('cbCpu') });
  }

  // ---- her voice: Piper ----

  async runPiper() {
    const { piper } = this.d;
    const cfg = () => this.d.cfg();
    const lang = this.d.lang();
    // the program
    this.begin('pp-find');
    let loc = piper.locate(cfg());
    if (!loc) {
      if (String(cfg().piperDir || '').trim()) this.fail('pp-find', this.t('ppFolderGone', { path: cfg().piperDir }), ['retry', 'choose-piper']);
      this.begin('pp-find', { heavy: true, progress: 0, detail: this.t('ppFetching') });
      try {
        loc = await piper.install({
          signal: this.abort.signal,
          onProgress: ({ completed, total }) => this.update('pp-find', { heavy: true, progress: total ? Math.min(1, completed / total) : null, detail: this.t('ppFetchingOf', { done: bytes(completed, this.d.lang()), total: total ? bytes(total, this.d.lang()) : '?' }) }),
        });
      } catch (err) {
        this.fail('pp-find', this.t('ppFetchFailed', { error: this.cancelled ? 'cancelled' : err.message }), ['retry', 'choose-piper']);
      }
    }
    this.done('pp-find', this.t('ppFoundAt', { path: loc.exe }));
    // a voice for the language she speaks
    this.begin('pp-voice');
    let voice = piper.voiceFor(cfg(), lang);
    if (!voice) {
      this.begin('pp-voice', { heavy: true, progress: 0, detail: this.t('ppVoiceFetching') });
      try {
        voice = await piper.fetchVoice(cfg(), lang, {
          signal: this.abort.signal,
          onProgress: ({ completed, total }) => this.update('pp-voice', { heavy: true, progress: total ? Math.min(1, completed / total) : null, detail: this.t('ppVoiceFetchingOf', { done: bytes(completed, this.d.lang()), total: total ? bytes(total, this.d.lang()) : '?' }) }),
        });
      } catch (err) {
        this.fail('pp-voice', this.t('ppVoiceFailed', { error: this.cancelled ? 'cancelled' : err.message }), ['retry', 'choose-piper']);
      }
    }
    this.done('pp-voice', this.t('ppVoiceHave', { voice: voice.key }));
    // it works: a word is said to be sure
    this.begin('pp-run', { detail: this.t('ppChecking') });
    try {
      await piper.check(cfg(), lang);
    } catch (err) {
      this.fail('pp-run', this.t('ppFailed', { error: err.message }), ['retry', 'choose-piper'], piper.status().log);
    }
    if (cfg().ttsEngine !== 'piper') this.d.save({ ttsEngine: 'piper', voiceMode: cfg().voiceMode === 'off' ? 'chat' : cfg().voiceMode, provisioned: true });
    this.done('pp-run', this.t('ppReady', { voice: piper.status().voice }));
  }

  // ---- for the window and the bug reports ----

  report() {
    const lines = [`Capri preparation, ${new Date().toISOString()}`, `plan: ${JSON.stringify(this.plan)}`];
    if (this.hw) {
      const g = this.hw.gpu;
      lines.push(`pc: ${this.hw.os.platform} ${this.hw.os.arch} ${this.hw.os.is64 ? '64' : '32'}-bit, ${this.hw.cpu.name || '?'} (${this.hw.cpu.threads} threads), ram ${Math.round(this.hw.ram / GB)} GB, gpu ${g ? `${g.name} ${Math.round(g.vram / GB)} GB, driver ${g.driver || '?'}` : 'none'}, disk free ${Number.isFinite(this.hw.disk.free) ? Math.round(this.hw.disk.free / GB) : '?'} GB`);
    }
    if (this.profile) lines.push(`profile: ${this.profile.id}${this.profile.auto ? ' (by herself)' : ' (asked for)'}, mind ${this.profile.mind.kind}${this.profile.mind.model ? ` ${this.profile.mind.model}` : ''}, voice ${this.profile.voice.engine}${this.profile.voice.device ? `/${this.profile.voice.device}` : ''}, notes ${this.profile.notes.join(',') || '-'}`);
    for (const s of this.steps) {
      lines.push(`[${s.state}] ${s.id}${s.detail ? `: ${s.detail}` : ''}${s.error ? `\n    error: ${s.error}` : ''}`);
      for (const l of s.log || []) lines.push(`    | ${l}`);
    }
    const ol = this.d.ollamaHost?.status?.();
    const cb = this.d.chatterbox?.status?.();
    const pp = this.d.piper?.status?.();
    if (ol) lines.push(`ollama: ${JSON.stringify({ phase: ol.phase, exe: ol.exe, models: ol.modelsDir, error: ol.error })}`, ...ol.log.map((l) => `    | ${l}`));
    if (cb) lines.push(`chatterbox: ${JSON.stringify({ phase: cb.phase, dir: cb.dir, python: cb.python, device: cb.device, error: cb.error })}`, ...cb.log.map((l) => `    | ${l}`));
    if (pp) lines.push(`piper: ${JSON.stringify({ phase: pp.phase, exe: pp.exe, voice: pp.voice, error: pp.error })}`, ...pp.log.map((l) => `    | ${l}`));
    lines.push(`os: ${process.platform} ${os.release()}, ram ${Math.round(os.totalmem() / GB)} GB`);
    return lines.join('\n');
  }
}

module.exports = { Provision, STEPS, pickInstalled, sameModel, bytes };
