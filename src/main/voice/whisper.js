'use strict';

// Her ears on this PC: whisper.cpp (https://github.com/ggml-org/whisper.cpp), a speech recogniser that runs on the processor
// with no Python and no graphics card, so that talking to her needs no account, no key and no internet. She finds its server
// program and a model in a "whisper" folder next to her, or fetches both (the program from whisper.cpp's releases, a model
// from the model hub), starts the server when your voice is first heard, keeps it for a while, and ends it when it has had
// nothing to do for some minutes or she quits (a model takes 0.3-1 GB of memory).
//
// The server speaks HTTP on 127.0.0.1 only: POST /inference with the audio as a 16 kHz wav (ears.js makes exactly that) and
// the answer is JSON. stt.js asks it; this file keeps it standing.

const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { download, extract, findFile } = require('../setup/fetch-files');
const { foldersLike, killTree } = require('../setup/proc');

const RELEASES = 'https://github.com/ggml-org/whisper.cpp/releases/download';
const API_LATEST = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest';
// the versions she tries one after the other (then whatever is the newest); the program's options she uses are the same in all
const VERSIONS = ['v1.7.6', 'v1.7.5'];
const MODELS = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
// the program for each system (a 32-bit Windows gets the 32-bit build; Windows on ARM runs the 64-bit one)
const ASSETS = { 'win32-x64': 'whisper-bin-x64.zip', 'win32-ia32': 'whisper-bin-Win32.zip' };
const PROGRAMS = { win32: ['whisper-server.exe', 'server.exe'], other: ['whisper-server', 'server'] };
// The models, small to big, quantised (a fifth of the size, the same words): what each needs in memory and how well it hears
// Russian. `min` is the least a whole file can be: a page of an error that was saved as a model is smaller than that.
const TIERS = {
  base: { file: 'ggml-base-q5_1.bin', bytes: 60e6, min: 40e6, ram: 0.4e9 },
  small: { file: 'ggml-small-q5_1.bin', bytes: 190e6, min: 150e6, ram: 0.8e9 },
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', bytes: 574e6, min: 500e6, ram: 1.6e9 },
};
const TIER_ORDER = ['base', 'small', 'turbo'];
const LOG_LINES = 30;
const START_TIMEOUT = 90000;
// how Windows says a program could not even start, in words (the program's own last line would be nothing of the kind)
const NOT_STARTED = {
  3221225501: 'this processor lacks an instruction the program needs (it is too old for it)', // 0xC000001D: AVX2 or the like
  3221225781: 'Windows lacks the Visual C++ runtime the program needs (install "Microsoft Visual C++ Redistributable 2015-2022", x64 or x86 as the program is)', // 0xC0000135
  3221225595: 'the program does not fit this Windows (32-bit and 64-bit libraries mixed)', // 0xC000007B
};
const MAGIC = ['lmgg', 'ggml']; // the first four bytes of a ggml model (little- or big-endian)

const withCode = (err, code) => Object.assign(err, { code });
const GB = 1024 ** 3;

function assetFor(platform = process.platform, _arch = process.arch, is64 = true) {
  if (platform !== 'win32') return '';
  return ASSETS[`win32-${is64 ? 'x64' : 'ia32'}`] || '';
}

// Which model suits this PC (hardware.js): the small one on a weak one, the big one on a strong one, else the middle one.
function tierFor(hw) {
  if (!hw?.os?.is64 || (hw.ram || 0) < 5 * GB) return 'base';
  if ((hw.ram || 0) >= 24 * GB && (hw.cpu?.threads || 0) >= 16) return 'turbo'; // (the big model on a processor takes a few seconds for a phrase: only for a strong one)
  return 'small';
}

// How many threads the server may use: most of the processor, but not all (the rest of the PC goes on living)
const threadsFor = (cores = os.cpus().length) => Math.max(2, Math.min(8, Math.floor(cores * 0.75)));

// Whether a file is a ggml model: the magic bytes (a download that is a web page, or cut short, is not)
function isModel(file, { fsx = fs, min = 8 } = {}) {
  try {
    const fd = fsx.openSync(file, 'r');
    try {
      const head = Buffer.alloc(4);
      fsx.readSync(fd, head, 0, 4, 0);
      return MAGIC.includes(head.toString('latin1')) && fsx.fstatSync(fd).size >= min;
    } finally {
      fsx.closeSync(fd);
    }
  } catch {
    return false;
  }
}

// A second of quiet as a 16 kHz wav, to ask the server something with (it answers an empty text)
function silence(seconds = 1) {
  const n = Math.round(16000 * seconds);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + n * 2, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(n * 2, 40);
  return Buffer.concat([head, Buffer.alloc(n * 2)]);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

class Whisper extends EventEmitter {
  constructor({
    spawn = cp.spawn, fetchFn = (...a) => fetch(...a), fsx = fs, platform = process.platform, arch = process.arch, is64 = true,
    roots = () => [], defaultDir = () => path.join(os.tmpdir(), 'capri-whisper'), versions = process.env.CAPRI_WHISPER_RELEASE ? [process.env.CAPRI_WHISPER_RELEASE] : VERSIONS,
    releases = process.env.CAPRI_WHISPER_RELEASES || RELEASES, apiLatest = process.env.CAPRI_WHISPER_API || API_LATEST, modelsBase = process.env.CAPRI_WHISPER_MODELS || MODELS,
    idleMs = 10 * 60 * 1000, startTimeout = START_TIMEOUT, threads = threadsFor(), port = freePort,
  } = {}) {
    super();
    Object.assign(this, { spawn, fetchFn, fsx, platform, arch, is64, rootsFn: roots, defaultDir, versions, releases, apiLatest, modelsBase, idleMs, startTimeout, threads, pickPort: port });
    this.phase = 'off'; // 'off', 'starting', 'ready', 'failed'
    this.error = '';
    this.exe = '';
    this.dir = '';
    this.model = '';
    this.base = '';
    this.log = [];
    this.proc = null;
    this.procKey = '';
    this.starting = null;
    this.idleTimer = null;
  }

  status() {
    return { phase: this.phase, error: this.error, dir: this.dir, exe: this.exe, model: this.model, base: this.base, log: this.log.slice(-8) };
  }

  set(phase, error = '') {
    if (phase === this.phase && error === this.error) return;
    this.phase = phase;
    this.error = error;
    this.emit('change', this.status());
  }

  // ---- finding it ----

  // The server program: in the folder named in her config, else a "whisper" folder next to her, else the one she fetched.
  // { dir, exe, root } or null.
  locate(cfg = {}) {
    const names = this.platform === 'win32' ? PROGRAMS.win32 : PROGRAMS.other;
    const named = String(cfg.whisperDir || '').trim();
    const folders = named ? [named] : [...foldersLike(/whisper/i, this.rootsFn(), { fsx: this.fsx }), this.defaultDir()];
    for (const root of folders) {
      for (const name of names) {
        const exe = findFile(root, [name], { depth: 3, fsx: this.fsx });
        if (exe) return { dir: path.dirname(exe), exe, root };
      }
    }
    return null;
  }

  // every model she has on the PC: *.bin that are ggml models, in the program's folder, its "models" folder, any "whisper" folder next to her
  models(cfg = {}) {
    const loc = this.locate(cfg);
    const places = [loc?.root, cfg.whisperDir, ...foldersLike(/whisper/i, this.rootsFn(), { fsx: this.fsx }), this.defaultDir()].filter(Boolean);
    const out = new Map();
    const walk = (dir, level) => {
      let entries = [];
      try {
        entries = this.fsx.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (level < 2 && !/^(node_modules|\.git)$/i.test(e.name)) walk(full, level + 1);
        } else if (/^ggml-.*\.bin$/i.test(e.name) && !/^ggml-(silero|vad)/i.test(e.name) && !out.has(full) && isModel(full, { fsx: this.fsx, min: 8 })) {
          out.set(full, { file: full, name: e.name, bytes: this.fsx.statSync(full).size });
        }
      }
    };
    for (const place of [...new Set(places)]) walk(place, 0);
    return [...out.values()];
  }

  // The model to use: the file named in her settings if she has it; else the one of the tier this PC suits, else the best of
  // those she has (a bigger one is better, but not past what the tier would take: a PC chosen a small one must not be given a large).
  modelFor(cfg, tier = cfg.whisperTier || 'small') {
    const all = this.models(cfg);
    const named = String(cfg.whisperModel || '').trim().toLowerCase();
    if (named) {
      const hit = all.find((m) => m.name.toLowerCase() === named || m.file.toLowerCase() === named);
      if (hit) return hit;
    }
    const want = TIERS[tier] || TIERS.small;
    const exact = all.find((m) => m.name === want.file);
    if (exact) return exact;
    const ceiling = TIER_ORDER.indexOf(tier);
    const rank = (m) => TIER_ORDER.findIndex((t) => TIERS[t].file === m.name);
    const fits = all.filter((m) => rank(m) < 0 || rank(m) <= ceiling);
    return (fits.length ? fits : all).sort((a, b) => b.bytes - a.bytes)[0] || null;
  }

  // ---- fetching it ----

  // Fetches the server program into her own folder. It is tried at each version in turn (then the newest the site names),
  // and a package without a server program in it is no package. onProgress({ completed, total }); resolves { exe, dir, root }.
  async install({ onProgress, signal } = {}) {
    const asset = assetFor(this.platform, this.arch, this.is64);
    if (!asset) throw new Error(`there is no whisper.cpp program for ${this.platform} ${this.arch}`);
    const dir = this.defaultDir();
    const tried = [];
    const urls = this.versions.map((v) => `${this.releases}/${v}/${asset}`);
    for (let i = 0; i <= urls.length; i++) {
      let url = urls[i];
      if (i === urls.length) {
        url = await this.newestAsset(asset, signal).catch(() => null);
        if (!url) break;
      }
      const file = path.join(dir, asset);
      try {
        await download(url, file, { onProgress, signal, fetchFn: this.fetchFn });
        await extract(file, dir, { signal });
        const loc = this.locate({});
        if (loc) return loc;
        tried.push(`${url}: no server program inside`);
      } catch (err) {
        if (signal?.aborted) throw err;
        tried.push(`${url}: ${err.message}`);
      } finally {
        fs.rmSync(file, { force: true }); // (and not left behind when she was stopped)
      }
    }
    throw new Error(tried.length ? tried.join('; ') : `could not find ${asset}`);
  }

  // The address of the newest release's package, from the site's list of releases
  async newestAsset(asset, signal) {
    const res = await this.fetchFn(this.apiLatest, { signal, redirect: 'follow', headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`the release list answered ${res.status}`);
    const body = await res.json();
    const hit = (body.assets || []).find((a) => a.name === asset);
    if (!hit?.browser_download_url) throw new Error(`the newest release has no ${asset}`);
    return hit.browser_download_url;
  }

  // Fetches the model of a tier into <whisper folder>/models. Resolves { file }.
  async fetchModel(cfg, tier, { onProgress, signal } = {}) {
    const want = TIERS[tier] || TIERS.small;
    const loc = this.locate(cfg);
    const base = path.join(loc ? loc.root : this.defaultDir(), 'models');
    fs.mkdirSync(base, { recursive: true });
    // (where huggingface.co is blocked, the mirror of the model hub in her settings serves the models too)
    const mirror = String(cfg.hfEndpoint || '').trim().replace(/\/+$/, '');
    const library = mirror ? `${mirror}/ggerganov/whisper.cpp/resolve/main` : this.modelsBase;
    const dest = path.join(base, want.file);
    await download(`${library}/${want.file}`, dest, { onProgress, signal, fetchFn: this.fetchFn });
    if (!isModel(dest, { fsx: this.fsx, min: want.min })) {
      fs.rmSync(dest, { force: true });
      throw new Error(`${want.file} arrived, but it is not a model (a page of an error, or a cut file)`);
    }
    return { file: dest };
  }

  // ---- running it ----

  // The address of the server, started if it is not up (one start at a time). Throws with a code: 'nolocal' (nothing installed),
  // 'nostart', 'exited', 'timeout'.
  async ready(cfg) {
    const loc = this.locate(cfg);
    if (!loc) throw withCode(new Error('whisper.cpp is not installed'), 'nolocal');
    const model = this.modelFor(cfg);
    if (!model) throw withCode(new Error('whisper.cpp has no model'), 'nolocal');
    const key = `${loc.exe}|${model.file}`;
    if (this.proc && this.procKey === key && this.phase === 'ready') {
      this.rest();
      return this.base;
    }
    if (this.starting && this.startKey === key) return this.starting;
    this.stopProc();
    this.startKey = key;
    this.starting = this.start(loc, model, key).finally(() => { this.starting = null; });
    return this.starting;
  }

  async start(loc, model, key) {
    this.exe = loc.exe;
    this.dir = loc.root;
    this.model = model.name;
    this.log = [];
    this.set('starting');
    const port = await this.pickPort();
    // (the model is named by its file name, with its folder as the working folder: a path with letters of your language
    // in it, which the program reads in the system's code page, cannot get lost on the way)
    const args = ['-m', model.name, '--host', '127.0.0.1', '--port', String(port), '-t', String(this.threads), '-l', 'auto'];
    let proc;
    try {
      proc = this.spawn(loc.exe, args, { cwd: path.dirname(model.file), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      this.set('failed', `could not start ${loc.exe}: ${err.message}`);
      throw withCode(new Error(this.error), 'nostart');
    }
    this.proc = proc;
    this.procKey = key;
    const base = `http://127.0.0.1:${port}`;
    let ended = '';
    proc.stdout?.on('data', (chunk) => this.note(chunk));
    proc.stderr?.on('data', (chunk) => this.note(chunk));
    proc.on('error', (err) => { ended = err.code === 'ENOENT' ? `the program is not there: ${loc.exe}` : err.message; this.gone(proc, ended, err.code === 'ENOENT'); });
    proc.on('exit', (code) => {
      ended = NOT_STARTED[code] || `the program stopped (code ${code})`;
      this.gone(proc, ended, Boolean(NOT_STARTED[code]));
    });
    // up when it answers (it loads the whole model before it listens)
    const until = Date.now() + this.startTimeout;
    while (Date.now() < until) {
      if (this.proc !== proc) throw withCode(new Error(this.error || ended || 'whisper.cpp was stopped'), 'exited');
      try {
        const res = await this.fetchFn(`${base}/`, { signal: AbortSignal.timeout(1500) });
        await res.arrayBuffer?.().catch(() => {});
        if (res.status < 500) {
          this.base = base;
          this.set('ready');
          this.rest();
          return base;
        }
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    this.stopProc();
    this.set('failed', 'the speech server did not come up in time');
    throw withCode(new Error(this.error), 'timeout');
  }

  note(chunk) {
    for (const l of String(chunk).split(/[\r\n]+/)) {
      const t = l.trim();
      if (!t) continue;
      this.log.push(t.slice(0, 240));
      if (this.log.length > LOG_LINES) this.log.shift();
    }
  }

  // the program ended by itself (a model it could not read, a missing library, a crash)
  gone(proc, why, known = false) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.procKey = '';
    this.base = '';
    clearTimeout(this.idleTimer);
    const reason = known ? why : this.lastProblem() || why; // (a reason in words is told as it is; else the last complaint of the program)
    this.set('failed', reason);
  }

  lastProblem() {
    return [...this.log].reverse().find((l) => /(error|failed|cannot|could not|no such|invalid|unable)/i.test(l)) || '';
  }

  // it was used: it stays up for a while longer
  rest() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stopProc(true), this.idleMs);
    this.idleTimer.unref?.();
  }

  stopProc(idle = false) {
    clearTimeout(this.idleTimer);
    const proc = this.proc;
    this.proc = null;
    this.procKey = '';
    this.base = '';
    if (proc) killTree(proc, { platform: this.platform, spawn: this.spawn });
    if (idle && this.phase === 'ready') this.set('off');
  }

  stop(report = true) {
    this.stopProc();
    if (report) this.set('off');
    else this.phase = 'off';
  }

  // Whether it works: starts the server and asks it about a second of quiet (the provision's last step). Resolves the status.
  async check(cfg) {
    const base = await this.ready(cfg);
    const form = new FormData();
    form.append('file', new Blob([silence(1)], { type: 'audio/wav' }), 'check.wav');
    form.append('response_format', 'json');
    const res = await this.fetchFn(`${base}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw withCode(new Error(`the speech server answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`), 'check');
    await res.json().catch(() => { throw withCode(new Error('the speech server answered something that is not JSON'), 'check'); });
    return this.status();
  }
}

module.exports = { Whisper, assetFor, tierFor, threadsFor, isModel, silence, TIERS, TIER_ORDER, RELEASES, VERSIONS, MODELS, ASSETS };
