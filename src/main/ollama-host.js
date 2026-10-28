'use strict';

// Ollama, the model she talks with, found, started and kept by her (chatterbox.js does the same for her
// voice). You put Ollama's folder next to her (or it is installed the usual way, or on the PATH): she finds
// its program and the models in it, starts `ollama serve` with those models, waits until it answers, and
// stops it when she quits, if it was she who started it. An Ollama that already answers (its tray app) is
// used as it is.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const ollama = require('./ollama');
const { killTree, which, foldersLike } = require('./proc');

const START_TIMEOUT = 2 * 60 * 1000;
const LOG_LINES = 30;
const SKIP = new Set(['node_modules', '.git', 'blobs', 'manifests', 'cache', '__pycache__', 'logs']);
const withCode = (err, code) => Object.assign(err, { code });

// Ollama's program inside a folder (a few folders deep): "ollama.exe" itself, not "ollama app.exe" (its tray)
function findExe(root, { platform = process.platform, fsx = fs, depth = 3 } = {}) {
  const want = platform === 'win32' ? /^ollama\.exe$/i : /^ollama$/;
  const queue = [[root, 0]];
  let seen = 0;
  while (queue.length && seen < 400) {
    const [dir, level] = queue.shift();
    seen++;
    let entries = [];
    try {
      entries = fsx.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const hit = entries.find((e) => e.isFile() && want.test(e.name));
    if (hit) return path.join(dir, hit.name);
    if (level < depth) for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name.toLowerCase())) queue.push([path.join(dir, e.name), level + 1]);
  }
  return null;
}

// Where Ollama keeps its models in a folder: the one with `manifests` and `blobs` in it (that is what
// OLLAMA_MODELS is), a few folders deep.
function findModelsDir(root, { fsx = fs, depth = 3 } = {}) {
  const queue = [[root, 0]];
  let seen = 0;
  while (queue.length && seen < 400) {
    const [dir, level] = queue.shift();
    seen++;
    let entries = [];
    try {
      entries = fsx.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()));
    if (names.has('manifests') && names.has('blobs')) return dir;
    if (level < depth) for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name.toLowerCase())) queue.push([path.join(dir, e.name), level + 1]);
  }
  return null;
}

// The usual places Ollama puts its program
function usualPlaces(platform = process.platform, env = process.env) {
  if (platform === 'win32') return [path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama', 'ollama.exe')];
  if (platform === 'darwin') return ['/Applications/Ollama.app/Contents/Resources/ollama', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama'];
  return ['/usr/local/bin/ollama', '/usr/bin/ollama'];
}

class OllamaHost extends EventEmitter {
  constructor({ spawn = cp.spawn, fsx = fs, platform = process.platform, roots = () => [], pollMs = 700, version = () => ollama.version(), whichFn = which, places = () => usualPlaces() } = {}) {
    super();
    Object.assign(this, { spawn, fsx, platform, rootsFn: roots, pollMs, versionFn: version, whichFn, placesFn: places });
    this.proc = null;
    this.phase = 'off'; // 'off', 'starting', 'ready', 'failed'
    this.error = '';
    this.code = '';
    this.extraEnv = {}; // what the profile of this PC says Ollama is started with (profiles.js tuningFor)
    this.found = null; // { exe, dir, modelsDir, where }
    this.ours = false; // she started it (so she stops it)
    this.log = [];
    this.timer = null;
    this.started = 0;
    this.pending = null;
  }

  setEnv(env = {}) {
    this.extraEnv = { ...env };
  }

  status() {
    return { phase: this.phase, error: this.error, code: this.code, ours: this.ours, exe: this.found?.exe || '', dir: this.found?.dir || '', modelsDir: this.found?.modelsDir || '', where: this.found?.where || '', log: this.log.slice(-6) };
  }

  set(phase, error = '', code = '') {
    if (phase === this.phase && error === this.error) return;
    this.phase = phase;
    this.error = error;
    this.code = code;
    this.emit('change', this.status());
  }

  // Where Ollama is on this PC: the folder named in her config; a folder with "ollama" in its name next
  // to her; the PATH; the usual place. { exe, dir, modelsDir, where } or null.
  async locate(cfg = {}) {
    const fsx = this.fsx;
    const found = (exe, where, extra = []) => {
      const dir = path.dirname(exe);
      const modelsDir = [dir, ...extra].map((d) => findModelsDir(d, { fsx })).find(Boolean) || null;
      return { exe, dir, modelsDir, where };
    };
    const named = String(cfg.ollamaDir || '').trim();
    if (named) {
      if (!fsx.existsSync(named)) return null;
      const isFile = !fsx.statSync(named).isDirectory();
      const exe = isFile ? named : findExe(named, { platform: this.platform, fsx });
      return exe ? found(exe, 'config', isFile ? [] : [named]) : null;
    }
    const folders = foldersLike(/ollama/i, this.rootsFn(), { fsx });
    const modelsOnly = folders.map((f) => findModelsDir(f, { fsx })).find(Boolean) || null;
    for (const folder of folders) {
      const exe = findExe(folder, { platform: this.platform, fsx });
      if (exe) {
        const here = found(exe, 'folder', [folder]);
        return { ...here, modelsDir: here.modelsDir || modelsOnly };
      }
    }
    const onPath = await this.whichFn('ollama', { platform: this.platform });
    if (onPath) return { ...found(onPath, 'path'), modelsDir: modelsOnly };
    for (const place of this.placesFn()) if (fsx.existsSync(place)) return { ...found(place, 'installed'), modelsDir: modelsOnly };
    return null;
  }

  // Wakes Ollama up if it is not answering, and says when it does (the menu's button, her start-up).
  async sync(cfg = {}) {
    if (this.pending) return this.pending;
    this.pending = this.start(cfg).finally(() => { this.pending = null; });
    return this.pending;
  }

  async start(cfg) {
    if (this.phase === 'starting' && this.proc) return; // (on its way: asking again does not start another)
    if (await this.versionFn()) {
      // one is answering already: hers from before, or the tray app's
      if (this.phase !== 'ready') this.set('ready');
      return;
    }
    this.stop(false);
    this.log = [];
    this.started = Date.now();
    this.found = await this.locate(cfg);
    if (!this.found) {
      this.set('failed', String(cfg.ollamaDir || '').trim() ? `There is no Ollama in ${cfg.ollamaDir}` : 'Ollama is not installed here', 'noexe');
      return;
    }
    this.set('starting');
    // (what the profile of this PC tells Ollama, unless you have set it yourself)
    const env = { ...this.extraEnv, ...process.env };
    if (this.found.modelsDir && !env.OLLAMA_MODELS) env.OLLAMA_MODELS = this.found.modelsDir;
    let proc;
    try {
      proc = this.spawn(this.found.exe, ['serve'], { cwd: this.found.dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      this.set('failed', `could not start ${this.found.exe}: ${err.message}`, 'nostart');
      return;
    }
    this.proc = proc;
    this.ours = true;
    const take = (chunk) => {
      for (const line of String(chunk).split(/[\r\n]+/)) {
        const text = line.trim();
        if (!text) continue;
        this.log.push(text.slice(0, 240));
        if (this.log.length > LOG_LINES) this.log.shift();
      }
    };
    proc.stdout?.on('data', take);
    proc.stderr?.on('data', take);
    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.ours = false;
      clearInterval(this.timer);
      this.set('failed', `could not start ${this.found.exe}: ${err.message}`, 'nostart');
    });
    proc.on('exit', async (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      clearInterval(this.timer);
      if (this.phase === 'off') return;
      // it quit because another Ollama has the port: that one will do
      if (await this.versionFn()) {
        this.ours = false;
        this.set('ready');
        return;
      }
      this.ours = false;
      this.set('failed', this.lastProblem() || `Ollama stopped (code ${code})`, 'exited');
    });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(proc), this.pollMs);
  }

  lastProblem() {
    const hit = [...this.log].reverse().find((l) => /(error|fail|cannot|unable|denied|in use)/i.test(l));
    return hit || '';
  }

  async poll(proc) {
    if (this.proc !== proc) return;
    if (Date.now() - this.started > START_TIMEOUT) {
      clearInterval(this.timer);
      this.stop(false);
      this.set('failed', 'Ollama did not answer in two minutes', 'timeout');
      return;
    }
    if (await this.versionFn()) {
      if (this.proc !== proc) return;
      clearInterval(this.timer);
      this.set('ready');
    }
  }

  // Waits (up to waitMs) until it answers. Throws with a code if it will not.
  async ready(cfg, waitMs = 60000) {
    if (this.phase === 'ready' && (await this.versionFn())) return true;
    await this.sync(cfg);
    const until = Date.now() + waitMs;
    while (this.phase === 'starting' && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    if (this.phase === 'ready') return true;
    throw withCode(new Error(this.error || 'Ollama is not running'), this.code || 'off');
  }

  stop(report = true) {
    clearInterval(this.timer);
    const proc = this.proc;
    this.proc = null;
    if (proc) killTree(proc, { platform: this.platform, spawn: this.spawn });
    this.ours = false;
    if (report) this.set('off');
    else this.phase = 'off';
  }
}

module.exports = { OllamaHost, findExe, findModelsDir, usualPlaces };
