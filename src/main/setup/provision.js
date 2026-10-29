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
//          pp-find, pp-voice, pp-run  |  ws-find, ws-model, ws-run (her ears: whisper.cpp, which writes down what you say)
//   a step is { id, group, state: 'pending' | 'running' | 'done' | 'failed' | 'skipped', progress (0..1 or
//   null), detail (what she says about it), error, heavy (a long job: worth showing), actions, log }

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { findFolder, findPython, pythonCandidates } = require('../voice/chatterbox');
const tools = require('../voice/chatterbox-setup');
const nodeTools = require('./node-check');
const hardwareLib = require('./hardware');
const profiles = require('./profiles');
const { text } = require('../dialogs/prepare-lines');
const { engineFor } = require('../voice/stt');

const GB = 1024 ** 3;
const STEPS = [
  ['scan', 'pc'],
  ['node', 'tools'],
  ['ollama-find', 'ollama'], ['ollama-run', 'ollama'], ['ollama-model', 'ollama'],
  ['cb-find', 'voice'], ['cb-python', 'voice'], ['cb-package', 'voice'], ['cb-model', 'voice'],
  ['pp-find', 'voice'], ['pp-voice', 'voice'], ['pp-run', 'voice'],
  ['ws-find', 'ears'], ['ws-model', 'ears'], ['ws-run', 'ears'],
];
const CB_MODEL_WAIT = 20 * 60 * 1000;
// about how much pip fetches for the voice, to show how far it is before it says (the packages of chatterbox-tts; then the torch for a graphics card)
const PIP_PACKAGES_BYTES = 0.7e9;
const PIP_CARD_BYTES = 2.7e9;
// what else the voice takes, for the one bar over all of it: Python (when she has to fetch it), the model, and the time it needs to be loaded
// and tried, counted as if it were that much more to fetch
const PYTHON_BYTES = 0.03e9;
const MODEL_BYTES = 3.2e9;
const LOADING_BYTES = 0.3e9;
const RATE_WINDOW = 45 * 1000; // the speed is taken over the last 45 seconds
const RATE_AFTER = 8 * 1000;   // and said after the first eight
// the part of the voice a step is, for that bar
const VOICE_PART = { 'cb-python': 'python', 'cb-package': 'package', 'cb-model': 'model' };
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

// about how long is left, in words: "12 min", "1 h 5 min" (rounded to the minute, up to 10 minutes to five)
function etaTime(ms, lang) {
  const ru = lang === 'ru';
  let minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes > 10) minutes = Math.round(minutes / 5) * 5;
  if (minutes < 60) return ru ? `${minutes} мин` : `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return ru ? `${h} ч${m ? ` ${m} мин` : ''}` : `${h} h${m ? ` ${m} min` : ''}`;
}

const bytes = (n, lang) => {
  const unit = lang === 'ru' ? ['МБ', 'ГБ'] : ['MB', 'GB'];
  return n >= GB ? `${(n / GB).toFixed(1)} ${unit[1]}` : `${Math.max(1, Math.round(n / 1048576))} ${unit[0]}`;
};

class Provision extends EventEmitter {
  // deps: cfg() the config, save(patch) change it, lang(), ollamaHost, chatterbox, piper, whisper, ollamaApi { models, pull },
  //       installOllama(onLine), downloadOllama(onLine), installPython(onLine), roots(), defaultDir(), onModelsChanged(),
  //       hardware({ force }) a look at this PC, tune(tuning, profileId) what the profile says Ollama is told, tools,
  //       nodeTools, nodeDir() where she fetches Node.js to, platform, record(kind, value) writes down what she put on
  //       this PC (installed.js), so that she can take it off again (cleanup.js), tempDir() where downloads and pip work
  //       while they are on their way ('' the system's), cleanTemp() empties it, preferZip() Ollama comes first as the zip
  //       into her folder (when you picked a folder for everything she fetches), ensureRoot() makes that folder,
  //       blocked() whether nothing is to be fetched just now (it is being moved).
  //       The installers get (onLine, signal): "Stop" ends them at once.
  constructor(deps) {
    super();
    this.d = { hardware: () => hardwareLib.scan(), tools, nodeTools, nodeDir: () => '', platform: process.platform, installOllama: null, downloadOllama: null, installPython: null, tune: null, piper: null, onModelsChanged: async () => {}, record: () => {}, ...deps };
    this.plan = { ollama: false, chatterbox: false, piper: false, whisper: false, node: false, adopt: false };
    this.hw = null; // the picture of this PC (hardware.js)
    this.have = {}; // what is on it already
    this.profile = null; // what it gets (profiles.js)
    this.running = false;
    this.finished = false;
    this.ok = false;
    this.core = false;
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
    this.steps = STEPS.map(([id, group]) => ({ id, group, state: 'pending', progress: null, detail: '', error: '', heavy: false, bar: false, actions: [], log: [] }));
    this.parts = { python: 0, package: 0, model: 0 }; // how far each part of the voice is (0 to 1), only forward
    this.samples = []; // [{ at, done }] how many bytes of the voice were done when: its speed
  }

  step(id) {
    return this.steps.find((s) => s.id === id);
  }

  snapshot() {
    return {
      running: this.running, finished: this.finished, ok: this.ok, attention: this.attention, plan: this.plan,
      stopping: this.running && this.cancelled, cancelled: this.cancelled,
      pc: this.hw ? profiles.describe(this.hw) : null,
      profile: this.profile && {
        id: this.profile.id, auto: this.profile.auto, wanted: this.profile.wanted, mind: this.profile.mind, voice: this.profile.voice,
        notes: this.profile.notes, choices: this.profile.choices, disk: this.profile.disk,
        download: { items: this.profile.download.items, total: this.profile.download.total },
      },
      steps: this.steps.map((s) => ({ ...s, log: s.log.slice(-6) })),
      overall: this.overall(),
    };
  }

  // One bar over the whole of the voice (Python, the packages and torch, the model): how far it is and, from its speed so far,
  // about how long is left. null when there is no such voice to get, or nothing of it going on. { group, fraction, label }.
  overall(now = Date.now()) {
    if (!this.plan?.chatterbox) return null;
    const parts = ['cb-python', 'cb-package', 'cb-model'].map((id) => {
      const step = this.step(id);
      const size = id === 'cb-python' ? PYTHON_BYTES : id === 'cb-package' ? PIP_PACKAGES_BYTES + (this.wantsCard() ? PIP_CARD_BYTES : 0) : MODEL_BYTES + LOADING_BYTES;
      const fraction = ['done', 'skipped'].includes(step.state) ? 1 : this.parts[VOICE_PART[id]];
      return { step, size, fraction };
    });
    if (!parts.some((p) => p.step.state === 'running')) return null;
    const total = parts.reduce((n, p) => n + p.size, 0);
    const done = parts.reduce((n, p) => n + p.size * p.fraction, 0);
    const fraction = Math.min(0.99, done / total);
    const last = this.samples[this.samples.length - 1];
    if (!last || now - last.at >= 1000) {
      this.samples.push({ at: now, done });
      while (this.samples.length > 2 && now - this.samples[1].at > RATE_WINDOW) this.samples.shift();
    }
    const first = this.samples[0];
    const span = now - first.at;
    const rate = span >= RATE_AFTER ? (done - first.done) / (span / 1000) : 0; // bytes per second
    const left = rate > 0 ? ((total - done) / rate) * 1000 : 0;
    const percent = Math.round(fraction * 100);
    const label = left > 0 ? this.t('overallEta', { percent, time: etaTime(left, this.d.lang()) }) : this.t('overallCounting', { percent });
    return { group: 'voice', fraction, label };
  }

  update(id, patch) {
    const s = this.step(id);
    if (s.state === 'stopped' && !patch.state) return; // (a bar still on its way when she was stopped)
    Object.assign(s, patch);
    if (typeof patch.progress === 'number' && VOICE_PART[id]) this.part(id, patch.progress);
    if (patch.heavy || patch.state === 'failed') this.attention = true;
    this.emit('change', this.snapshot());
  }

  // how far a part of the voice is (only forward: a bar that goes back says nothing)
  part(id, fraction) {
    const key = VOICE_PART[id];
    // (the model: its download is most of the part, then it is loaded into memory and tried)
    const reach = id === 'cb-model' ? 0.92 * fraction : fraction;
    this.parts[key] = Math.max(this.parts[key], Math.min(1, reach));
  }

  // the model is being loaded into memory (or tried): there is no number for it, so the bar goes on a little with the time, not past 97%
  creep(id, to = 0.97) {
    const key = VOICE_PART[id];
    if (this.parts[key] > 0.5) this.parts[key] = Math.min(to, this.parts[key] + 0.0008);
  }

  begin(id, patch = {}) {
    this.checkStop();
    this.update(id, { state: 'running', progress: null, error: '', actions: [], detail: '', heavy: false, bar: false, ...patch });
  }

  done(id, detail = '') {
    this.update(id, { state: 'done', progress: null, detail, error: '', actions: [], heavy: false, bar: false });
  }

  fail(id, error, actions = ['retry'], log = []) {
    this.checkStop(); // (what ends because she was stopped did not fail)
    this.update(id, { state: 'failed', progress: null, detail: '', error: String(error).slice(0, 400), actions, heavy: false, bar: false, log });
    throw Object.assign(new Error(error), { step: id, handled: true });
  }

  // ---- "Stop" ----

  stopped(id = '') {
    return Object.assign(new Error('stopped'), { step: id, handled: true, cancelled: true });
  }

  checkStop() {
    if (this.cancelled) throw this.stopped();
  }

  // Waits for `promise`, but not past "Stop": what cannot be ended itself (a server coming up) is let go of. It
  // goes on in the background and is not heard of again.
  raceStop(promise) {
    const { signal } = this.abort;
    if (signal.aborted) return Promise.reject(this.stopped());
    return new Promise((resolve, reject) => {
      const onStop = () => reject(this.stopped());
      signal.addEventListener('abort', onStop, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onStop));
    });
  }

  // the steps that were going on when she was stopped say so (they are not failures; the ones not begun wait)
  settleStopped() {
    for (const s of this.steps) {
      if (s.state === 'running') Object.assign(s, { state: 'stopped', progress: null, detail: this.t('stoppedStep'), error: '', actions: [], heavy: false, bar: false });
    }
  }

  skip(id, detail = '') {
    this.update(id, { state: 'skipped', progress: null, detail, error: '', actions: [], heavy: false, bar: false });
  }

  // what is on this PC already, so the plan counts only what is missing
  async inventory(cfg) {
    const { ollamaHost, ollamaApi, piper, whisper } = this.d;
    const have = { ollama: false, models: [], chatterbox: false, piper: false, whisper: false, node: false };
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
      have.whisper = Boolean(whisper?.locate(cfg)) && Boolean(whisper.models(cfg).length);
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
    // (her ears: the recogniser on this PC, unless you set a cloud one up with a key of its own, or there is no program of it for this system)
    const whisper = cfg.autoEars !== false && Boolean(prof.ears) && engineFor(cfg, cfg.apiKeys || {}) === 'local';
    return { ollama, chatterbox: engine === 'chatterbox', piper: engine === 'piper', whisper, node: cfg.autoNode !== false, adopt, engine };
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
    if (this.d.blocked?.()) return Promise.resolve(); // (what she fetched is being moved: nothing is fetched now)
    this.job = this.go(opts).finally(() => { this.job = null; });
    return this.job;
  }

  async go({ rescan = false, repairOllama = false } = {}) {
    this.repair = repairOllama; // (Ollama is put in again, over the one that is there: its engine is not whole)
    this.running = true;
    this.finished = false;
    this.ok = false;
    this.attention = false;
    this.cancelled = false;
    this.abort = new AbortController();
    this.started = Date.now();
    this.reset();
    this.d.ensureRoot?.(); // (the folder you picked for what she fetches is there, with her mark in it)
    this.emit('change', this.snapshot());
    try {
      await this.scan({ rescan });
    } catch (err) {
      if (!err.handled) this.update('scan', { state: 'failed', error: String(err.message || err).slice(0, 400), actions: ['retry'] });
    }
    if (this.step('scan').state === 'done' && !this.cancelled) {
      const cfg = this.d.cfg();
      this.plan = this.decide(cfg, this.profile, this.have);
      if (this.repair) this.plan.ollama = true;
      for (const s of this.steps) {
        if (s.id !== 'scan' && !this.wanted(s)) s.state = 'skipped';
      }
      this.emit('change', this.snapshot());
      const jobs = [];
      if (this.plan.node) jobs.push(this.group(() => this.runNode()));
      if (this.plan.ollama) jobs.push(this.group(() => this.runOllama()));
      if (this.plan.chatterbox) jobs.push(this.group(() => this.runChatterbox()));
      if (this.plan.piper) jobs.push(this.group(() => this.runPiper()));
      if (this.plan.whisper) jobs.push(this.group(() => this.runWhisper()));
      // (a voice that is the system's, or a mind that is a cloud one: nothing to get ready, but it is her voice from now on)
      if (!this.plan.chatterbox && !this.plan.piper && this.plan.adopt) this.d.save({ provisioned: true });
      await Promise.all(jobs);
    } else if (!this.cancelled) {
      for (const s of this.steps) if (s.id !== 'scan') s.state = 'skipped';
    }
    if (this.cancelled) this.settleStopped();
    // (what was to be fetched is there now: the plan counts again what is still missing)
    if (!this.cancelled && this.profile && this.step('scan').state === 'done') {
      try {
        this.have = await this.inventory(this.d.cfg());
        this.profile = profiles.refresh(this.profile, this.have);
      } catch { /* the first count stands */ }
    }
    this.running = false;
    this.finished = true;
    const good = (s) => s.state === 'done' || s.state === 'skipped';
    this.ok = this.steps.every(good);
    this.core = this.steps.filter((s) => s.group !== 'ears').every(good); // (her mind and her voice: the ears failing is no reason to keep her quiet)
    if (this.cancelled) this.ok = this.core = false;
    this.repair = false;
    this.d.cleanTemp?.(); // (what a stopped download left behind)
    this.emit('change', this.snapshot());
    this.emit('finish', { ok: this.ok, core: this.core, plan: this.plan, attention: this.attention, profile: this.profile?.id, cancelled: this.cancelled });
  }

  wanted(step) {
    if (step.group === 'tools') return this.plan.node;
    if (step.group === 'ollama') return this.plan.ollama;
    if (step.id.startsWith('cb-')) return this.plan.chatterbox;
    if (step.id.startsWith('pp-')) return this.plan.piper;
    if (step.id.startsWith('ws-')) return this.plan.whisper;
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

  // stops what is being fetched (the window's "stop" or "skip", or her quitting): the programs under it are ended
  // at once, and the steps that were going on say they were stopped
  cancel() {
    if (!this.running || this.cancelled) return;
    this.cancelled = true;
    this.abort?.abort();
    this.emit('change', this.snapshot()); // ("Stopping…" at once, before the last of it has ended)
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
        dir: this.d.nodeDir(), arch, signal: this.abort.signal, tmp: this.d.tempDir?.() || undefined,
        onProgress: ({ completed, total }) => this.update('node', { heavy: true, progress: total ? Math.min(1, completed / total) : null, detail: this.t('nodeFetchingOf', { done: bytes(completed, lang), total: total ? bytes(total, lang) : '?' }) }),
      });
    } catch (err) {
      this.fail('node', this.t('nodeFailed', { error: err.message }), ['retry', 'open-node-site']);
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
    // find it (or, when it is to be repaired, put it in again: over the one that is there, whose engine is not whole)
    const repair = this.repair;
    this.begin('ollama-find');
    if (!repair && await ollamaHost.versionFn()) {
      this.done('ollama-find', this.t('olRunning'));
    } else {
      let found = repair ? null : await ollamaHost.locate(cfg());
      const named = String(cfg().ollamaDir || '').trim();
      if (repair) {
        this.update('ollama-find', { heavy: true, detail: this.t('olRepairing') });
        this.d.save({ mindChecked: '' });
        ollamaHost.stop(false);
        await this.raceStop(Promise.resolve(this.d.killOllama?.()).catch(() => {})); // (its tray program and its server hold the files)
      }
      if (!found && (repair || !named)) {
        // nowhere: get it (winget, else its own installer, else its zip)
        const installs = [['winget', this.d.installOllama], ['installer', this.d.downloadOllama], ['zip', this.d.downloadOllamaZip]].filter(([, fn]) => fn);
        if (this.d.preferZip?.()) installs.sort(([a], [b]) => (b === 'zip') - (a === 'zip')); // (a folder you picked for everything: Ollama comes into it first)
        // (repairing: the installer over the one there is keeps its models; her own zip is fetched again into its folder)
        if (repair) {
          const order = named ? ['zip', 'installer', 'winget'] : ['installer', 'winget', 'zip'];
          installs.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
        }
        for (const [how, install] of installs) {
          this.begin('ollama-find', { heavy: true, detail: this.t('olInstalling', { line: '' }) });
          const res = await this.raceStop(Promise.resolve(install((line) => this.update('ollama-find', { detail: this.t('olInstalling', { line: String(line).slice(0, 80) }) }), this.abort.signal)).catch((err) => ({ ok: false, error: err.message })));
          this.checkStop();
          if (res.ok && res.dir) this.d.save({ ollamaDir: res.dir }); // (the zip is unpacked into a folder of hers)
          if (res.ok) found = await ollamaHost.locate(cfg());
          if (found) {
            this.d.record('ollama', { how, dir: res.dir || '' }); // hers: she can take it off again
            break;
          }
        }
      }
      if (!found && repair) found = await ollamaHost.locate(cfg()); // (nothing could be put in again, or nothing was asked to: what is there is looked at, and said)
      if (!found) this.fail('ollama-find', this.t('olMissing'), ['retry', 'choose-ollama', 'open-ollama-site']);
      this.done('ollama-find', this.t('olFoundAt', { path: found.exe }));
    }
    // start it
    this.begin('ollama-run', { detail: this.t('olStarting') });
    try {
      if (ollamaHost.status().phase === 'failed') ollamaHost.stop(false);
      await this.raceStop(ollamaHost.ready(cfg(), 90000));
    } catch (err) {
      this.fail('ollama-run', err.message, ['retry', 'choose-ollama'], ollamaHost.status().log);
    }
    this.done('ollama-run', this.t('olUp', { from: ollamaHost.status().modelsDir ? this.t('olFromFolder') : '' }));
    // a model to talk with: the one you picked in her main menu, the one you asked for with a profile, else one
    // of those she has, else the profile's
    this.begin('ollama-model');
    const models = await ollamaApi.models().catch(() => []);
    // (a repair asked for while her mind is a service of the cloud: the engine is looked at with a model that is there, and her settings are left as they are)
    if (repair && (cfg().provider || 'ollama') !== 'ollama') {
      const there = pickInstalled(models, null);
      if (there) await this.checkModel(there);
      this.done('ollama-model', there ? this.t('olModelHave', { model: there }) : '');
      return;
    }
    const picked = String(cfg().wantModel || '').trim();
    if (picked) {
      const there = sameModel(models, picked);
      if (there) {
        this.d.save({ chatModel: there, wantModel: '', provider: 'ollama' });
        await this.d.onModelsChanged();
        await this.checkModel(there);
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
      await this.checkModel(have);
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
      this.fail('ollama-model', this.t('olPullFailed', { model: target, error: err.message }), ['retry']);
    }
    const after = await ollamaApi.models().catch(() => []);
    const name = sameModel(after, target) || target;
    this.d.record('model', name); // hers: she can take it off again
    this.d.save({ chatModel: name, provider: 'ollama', ...(picked ? { wantModel: '' } : {}), ...(reselect ? { profileApplied: cfg().profile } : {}) });
    await this.d.onModelsChanged();
    await this.checkModel(name);
    this.done('ollama-model', this.t('olModelHave', { model: name }));
  }

  // Can the model really be run here? One word of an answer says it: Ollama's engine is whole, the memory is enough. Done once
  // for this Ollama with this model (it is written down), not at every start. An engine that is not whole (a file gone: an install that
  // was cut short, the virus protection) is told as that, with the way out; any other reason is told as it is.
  async checkModel(name) {
    const { ollamaHost, ollamaApi } = this.d;
    if (!ollamaApi.probe) return;
    const key = `${ollamaHost.status().exe || ''}|${name}`;
    if (!this.repair && this.d.cfg().mindChecked === key) return;
    this.update('ollama-model', { bar: true, progress: null, detail: this.t('olChecking', { model: name }) });
    const res = await this.raceStop(Promise.resolve(ollamaApi.probe(name, this.abort.signal)));
    if (res.ok) {
      this.d.save({ mindChecked: key });
      return;
    }
    if (res.slow) return; // (a model that takes long to load on this PC: it is no failure, and it is looked at again next time)
    if (res.engine) this.fail('ollama-model', this.t(this.repair ? 'olBrokenAfter' : 'olBroken'), this.repair ? ['retry', 'open-ollama-site'] : ['repair-ollama', 'retry'], [res.error]);
    this.fail('ollama-model', this.t('olProbeFailed', { model: name, error: res.error }), ['retry'], [res.error]);
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
          await this.raceStop(Promise.resolve(this.d.installPython((line) => this.update('cb-python', { detail: this.t('cbPythonInstalling', { line: String(line).slice(0, 80) }) }), this.abort.signal)).catch(() => ({ ok: false })));
          this.checkStop();
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
    let progress = null; // how far pip is, over the whole step
    let raw = false; // pip can say it in lines
    const checkKey = String(python || 'system');
    let checked = cfg().voiceChecked === checkKey; // the card and the voice were looked at for this Python already: not at every start
    if (python && !setup.hasChatterbox(python)) {
      checked = false;
      this.d.save({ voiceChecked: '' });
      this.begin('cb-package', { heavy: true, progress: null, detail: this.t('cbPackageInstalling', { what: 'chatterbox-tts' }) });
      const target = setup.installTarget(dir);
      const wheels = this.wheelhouse(dir);
      // how far it is: a bar over everything the step fetches (the packages, and the torch for the card after them)
      progress = tools.createPipProgress();
      progress.phase(PIP_PACKAGES_BYTES, this.wantsCard() ? PIP_CARD_BYTES : 0);
      this.update('cb-package', { detail: this.t('cbPipUpdating') });
      const prep = await this.raceStop(Promise.resolve(setup.preparePip?.(python, this.pipOptions())).catch(() => null));
      raw = Boolean(prep?.raw);
      const onLine = (line) => {
        const changed = progress.feed(line);
        if (raw) {
          if (changed) this.showPip('cb-package', progress, 'cbPackageGetting', raw);
          return;
        }
        const a = setup.pipActivity(line);
        if (a) this.update('cb-package', { progress: progress.view().fraction || null, detail: this.t('cbPackageInstalling', { what: `${a.what}${a.size ? ` (${a.size})` : ''}` }) });
      };
      const res = await this.raceStop(setup.pip(python, ['install', '--no-cache-dir', ...(raw ? ['--progress-bar', 'raw'] : []), ...(wheels ? ['--find-links', wheels] : []), ...target.args], onLine, this.pipOptions())); // (no cache: gigabytes of wheels would stay behind)
      if (!res.ok) this.fail('cb-package', this.t('cbPackageFailed', { error: res.tail.slice(-3).join(' ') }), ['retry'], res.tail);
    }
    if (python && !checked) {
      const made = await this.graphicsCard(python, { progress, raw });
      if (made === 'installed') await this.verifyTorch(python);
    }
    this.done('cb-package', this.t('cbPackageHave'));
    // start it, and wait for the model
    this.begin('cb-model', { bar: true, detail: this.t('cbLoading') }); // (a bar all the time: it goes with the download, and runs back and forth while the model is put into memory; it is no reason to open the window: that is a download)
    if (!cfg().ttsEngine || cfg().ttsEngine !== 'chatterbox') this.d.save({ ttsEngine: 'chatterbox', voiceMode: cfg().voiceMode === 'off' ? 'chat' : cfg().voiceMode, provisioned: true });
    const starting = chatterbox.status().phase === 'failed' ? chatterbox.restart(cfg()) : chatterbox.sync(cfg());
    try {
      await this.raceStop(starting);
      const until = Date.now() + CB_MODEL_WAIT;
      while (Date.now() < until) {
        this.checkStop();
        const st = chatterbox.status();
        if (st.phase === 'ready') {
          if (!checked && chatterbox.check) {
            // it is loaded: does it speak? (once for this Python: it is written down)
            this.parts.model = Math.max(this.parts.model, 0.97);
            this.update('cb-model', { bar: true, progress: null, detail: this.t('cbChecking') });
            try {
              await this.raceStop(chatterbox.check(cfg(), this.d.lang()));
            } catch (err) {
              if (err.cancelled) throw err;
              this.fail('cb-model', this.t('cbCheckFailed', { error: err.message }), ['retry', 'choose-chatterbox'], chatterbox.status().log);
            }
            this.d.save({ voiceChecked: checkKey });
          }
          this.done('cb-model', this.t('cbReady', { device: st.device || 'cpu' }));
          return;
        }
        if (st.phase === 'failed') this.fail('cb-model', this.t('cbFailed', { error: st.error }), ['retry', 'choose-chatterbox'], st.log);
        if (st.progress !== null) {
          const lang = this.d.lang();
          const percent = Math.round(st.progress * 100);
          this.update('cb-model', {
            heavy: true, progress: st.progress,
            detail: st.bytes ? this.t('cbDownloadingOf', { done: bytes(st.bytes, lang), total: bytes(st.expect, lang), percent }) : this.t('cbDownloading', { percent }),
          });
        } else {
          this.creep('cb-model');
          this.update('cb-model', { bar: true, progress: null, detail: st.log.length ? `${this.t('cbLoading')} ${st.log[st.log.length - 1].slice(0, 80)}` : this.t('cbLoading') });
        }
        await this.raceStop(sleep(400));
      }
    } catch (err) {
      if (err.cancelled) {
        // (the model it was fetching is not fetched in the background any more: the server is ended, also one that was only then being started)
        chatterbox.stop();
        starting.then(() => chatterbox.stop(), () => {});
      }
      throw err;
    }
    this.fail('cb-model', this.t('cbFailed', { error: 'timeout' }), ['retry'], chatterbox.status().log);
  }

  // how pip is run: ended by "Stop", and working in the temp folder of the place she was given (when you picked one)
  pipOptions() {
    const options = { signal: this.abort.signal, env: {} };
    const dir = this.d.tempDir?.() || '';
    if (dir) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        options.env = { TEMP: dir, TMP: dir, TMPDIR: dir };
      } catch { /* the system's then */ }
    }
    return options;
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

  // does the voice want the graphics card (the profile says there is an NVIDIA one that can carry it)?
  wantsCard() {
    const cfg = this.d.cfg();
    return (this.profile?.voice.device === 'cuda' || cfg.chatterboxDevice === 'cuda') && cfg.chatterboxDevice !== 'cpu';
  }

  // an NVIDIA card and a torch that cannot use it: the same torch, built for the card and its driver (not fatal if it
  // cannot be). `progress`: the bar of the step, and `raw`: pip can tell how far it is.
  async graphicsCard(python, { progress = null, raw = false } = {}) {
    const { tools: setup } = this.d;
    if (!this.wantsCard()) return;
    const torch = await this.raceStop(Promise.resolve(setup.torchStatus(python)));
    if (!torch || torch.cuda) return;
    const args = setup.cudaTorchArgs(torch, this.hw?.gpu || {});
    if (!args) {
      this.update('cb-package', { detail: this.t('cbCpu') });
      return;
    }
    this.update('cb-package', { heavy: true, detail: this.t('cbGpu') });
    // (no cache here either: the build for the card is gigabytes)
    const uncached = args[0] === 'install' && !args.includes('--no-cache-dir') ? [args[0], '--no-cache-dir', ...args.slice(1)] : args;
    const bar = progress || tools.createPipProgress();
    bar.phase(PIP_CARD_BYTES);
    const onLine = (line) => {
      if (bar.feed(line) && raw) this.showPip('cb-package', bar, 'cbGpuGetting', raw);
    };
    const res = await this.raceStop(setup.pip(python, [...uncached.slice(0, 1), ...(raw ? ['--progress-bar', 'raw'] : []), ...uncached.slice(1)], onLine, this.pipOptions()));
    if (!res.ok) {
      this.update('cb-package', { detail: this.t('cbCpu') });
      return 'failed';
    }
    return 'installed';
  }

  // After torch was put in for the card: it is of one version with torchaudio (else the model does not load), it sees the card,
  // and what pip finds wrong with the versions together is kept for the report (the card's torch is not the version the package
  // asks for on the newest cards: that is no reason to stop)
  async verifyTorch(python) {
    const { tools: setup } = this.d;
    const torch = await this.raceStop(Promise.resolve(setup.torchStatus(python)));
    if (!torch) return;
    if (!tools.sameTorch(torch)) this.fail('cb-package', this.t('cbTorchMismatch', { torch: torch.version, audio: torch.audio }), ['retry', 'choose-chatterbox']);
    if (!torch.cuda) this.update('cb-package', { detail: this.t('cbNoCuda') });
    const conflicts = (await this.raceStop(Promise.resolve(setup.pipCheck?.(python)))) || [];
    if (conflicts.length) this.update('cb-package', { log: conflicts });
  }

  // the bar of a step that pip fills: how far it is over everything, and in words what it is on now (not more than a few
  // times a second: pip's lines come hundreds of times a second)
  showPip(id, progress, key, raw) {
    const view = progress.view();
    const at = Date.now();
    const shown = this.pipShown || (this.pipShown = {});
    const sign = `${id}|${view.stage}|${view.what}`;
    if (shown.sign === sign && Math.abs(view.fraction - shown.fraction) < 0.004 && at - shown.at < 800) return;
    Object.assign(shown, { sign, fraction: view.fraction, at });
    const lang = this.d.lang();
    let detail;
    if (view.stage === 'installing') detail = this.t('cbPackageUnpacking');
    else if (raw && view.total) {
      detail = this.t(key, {
        what: view.what || 'chatterbox-tts', done: bytes(view.done, lang), total: bytes(view.total, lang), percent: Math.round(view.fraction * 100),
        rate: view.rate > 50e3 ? ` · ${bytes(view.rate, lang)}/${lang === 'ru' ? 'с' : 's'}` : '',
      });
    } else detail = this.t('cbPackageInstalling', { what: view.what || 'chatterbox-tts' });
    this.update(id, { heavy: true, progress: view.fraction, detail });
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
        this.fail('pp-find', this.t('ppFetchFailed', { error: err.message }), ['retry', 'choose-piper']);
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
        this.fail('pp-voice', this.t('ppVoiceFailed', { error: err.message }), ['retry', 'choose-piper']);
      }
    }
    this.done('pp-voice', this.t('ppVoiceHave', { voice: voice.key }));
    // it works: a word is said to be sure
    this.begin('pp-run', { detail: this.t('ppChecking') });
    try {
      await this.raceStop(piper.check(cfg(), lang));
    } catch (err) {
      this.fail('pp-run', this.t('ppFailed', { error: err.message }), ['retry', 'choose-piper'], piper.status().log);
    }
    if (cfg().ttsEngine !== 'piper') this.d.save({ ttsEngine: 'piper', voiceMode: cfg().voiceMode === 'off' ? 'chat' : cfg().voiceMode, provisioned: true });
    this.done('pp-run', this.t('ppReady', { voice: piper.status().voice }));
  }

  // ---- her ears: whisper.cpp ----

  async runWhisper() {
    const { whisper } = this.d;
    const cfg = () => this.d.cfg();
    const lang = this.d.lang();
    const tier = this.profile?.ears?.tier || cfg().whisperTier || 'small';
    // the server program
    this.begin('ws-find');
    let loc = whisper.locate(cfg());
    if (!loc) {
      if (String(cfg().whisperDir || '').trim()) this.fail('ws-find', this.t('wsFolderGone', { path: cfg().whisperDir }), ['retry', 'choose-whisper']);
      this.begin('ws-find', { heavy: true, progress: 0, detail: this.t('wsFetching') });
      try {
        loc = await whisper.install({
          signal: this.abort.signal,
          onProgress: ({ completed, total }) => this.update('ws-find', { heavy: true, progress: total ? Math.min(1, completed / total) : null, detail: this.t('wsFetchingOf', { done: bytes(completed, lang), total: total ? bytes(total, lang) : '?' }) }),
        });
      } catch (err) {
        this.fail('ws-find', this.t('wsFetchFailed', { error: err.message }), ['retry', 'choose-whisper']);
      }
      this.d.record('whisper', { dir: loc.root }); // hers: she can take it off again
    }
    this.done('ws-find', this.t('wsFoundAt', { path: loc.exe }));
    // a model that suits this PC (any that lies there already is taken as it is)
    this.begin('ws-model');
    let model = whisper.modelFor({ ...cfg(), whisperTier: tier }, tier);
    if (!model) {
      this.begin('ws-model', { heavy: true, progress: 0, detail: this.t('wsModelFetching') });
      try {
        await whisper.fetchModel(cfg(), tier, {
          signal: this.abort.signal,
          onProgress: ({ completed, total }) => this.update('ws-model', { heavy: true, progress: total ? Math.min(1, completed / total) : null, detail: this.t('wsModelFetchingOf', { done: bytes(completed, lang), total: total ? bytes(total, lang) : '?' }) }),
        });
      } catch (err) {
        this.fail('ws-model', this.t('wsModelFailed', { error: err.message }), ['retry', 'choose-whisper']);
      }
      model = whisper.modelFor({ ...cfg(), whisperTier: tier }, tier);
      if (!model) this.fail('ws-model', this.t('wsModelFailed', { error: 'the model file is not there after the download' }), ['retry', 'choose-whisper']);
      this.d.save({ whisperTier: tier });
    }
    this.done('ws-model', this.t('wsModelHave', { model: model.name }));
    // it works: it is started and asked about a second of quiet (once for this program and model, it is written down: starting
    // a model of hundreds of megabytes at every start would cost memory and a moment, and it is not needed until you talk)
    const checked = `${loc.exe}|${model.file}`;
    if (this.d.cfg().earsChecked !== checked) {
      this.begin('ws-run', { bar: true, detail: this.t('wsChecking') });
      try {
        await this.raceStop(whisper.check(cfg()));
      } catch (err) {
        if (err.cancelled) throw err;
        this.fail('ws-run', this.t('wsFailed', { error: err.message }), ['retry', 'choose-whisper'], whisper.status().log);
      }
      this.d.save({ earsChecked: checked });
    }
    if (cfg().sttEngine !== 'local') this.d.save({ sttEngine: 'local' });
    this.done('ws-run', this.t('wsReady', { model: model.name }));
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
    const ws = this.d.whisper?.status?.();
    if (ol) lines.push(`ollama: ${JSON.stringify({ phase: ol.phase, exe: ol.exe, models: ol.modelsDir, error: ol.error })}`, ...ol.log.map((l) => `    | ${l}`));
    if (cb) lines.push(`chatterbox: ${JSON.stringify({ phase: cb.phase, dir: cb.dir, python: cb.python, device: cb.device, error: cb.error })}`, ...cb.log.map((l) => `    | ${l}`));
    if (pp) lines.push(`piper: ${JSON.stringify({ phase: pp.phase, exe: pp.exe, voice: pp.voice, error: pp.error })}`, ...pp.log.map((l) => `    | ${l}`));
    if (ws) lines.push(`whisper: ${JSON.stringify({ phase: ws.phase, exe: ws.exe, model: ws.model, error: ws.error })}`, ...ws.log.map((l) => `    | ${l}`));
    lines.push(`os: ${process.platform} ${os.release()}, ram ${Math.round(os.totalmem() / GB)} GB`);
    return lines.join('\n');
  }
}

module.exports = { Provision, STEPS, pickInstalled, sameModel, bytes };
