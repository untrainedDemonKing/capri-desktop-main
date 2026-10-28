'use strict';

// A light voice for a small PC: Piper (https://github.com/rhasspy/piper), a speech model that runs on the
// processor in a fraction of a second, with no Python and no graphics card. She finds its program and a voice
// in a "piper" folder next to her, or fetches both (the program from Piper's releases, a voice from the voice
// library on Hugging Face), keeps the program running while she talks, and stops it when she is quiet for a
// while or quits.
//
// The program reads one line of text per sentence on its input and prints the path of the wav it made for it
// (--output_dir), so one running program serves every line, in order.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { download, extract, findFile } = require('./fetch-files');
const { foldersLike, killTree } = require('./proc');

const RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2';
const VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
// the program for each system (a 32-bit build of her on a 64-bit Windows uses the 64-bit one)
const ASSETS = {
  'win32-x64': 'piper_windows_amd64.zip',
  'linux-x64': 'piper_linux_x86_64.tar.gz',
  'linux-arm64': 'piper_linux_aarch64.tar.gz',
  'darwin-x64': 'piper_macos_x64.tar.gz',
  'darwin-arm64': 'piper_macos_aarch64.tar.gz',
};
// the voices she likes, by the language she speaks (the first that the library has; else any of that language)
const LANG_PREFIX = { ru: 'ru_', en: 'en_', fr: 'fr_', es: 'es_', pt: 'pt_' };
const PREFERRED = {
  ru: ['ru_RU-irina-medium'],
  en: ['en_US-amy-medium', 'en_GB-jenny_dioco-medium', 'en_US-lessac-medium'],
  fr: ['fr_FR-siwis-medium'],
  es: ['es_ES-sharvard-medium', 'es_MX-claude-high'],
  pt: ['pt_BR-faber-medium'],
};
const QUALITY = ['medium', 'high', 'low', 'x_low'];
const LOG_LINES = 30;
const REQUEST_TIMEOUT = 45000;

const withCode = (err, code) => Object.assign(err, { code });

function assetFor(platform = process.platform, arch = process.arch, is64 = true) {
  const a = platform === 'win32' ? (is64 ? 'x64' : '') : arch;
  return ASSETS[`${platform}-${a}`] || '';
}

// The voice of the library's index (voices.json) for this language: { key, files: [{ path, bytes, md5 }] } or null
function pickVoice(index, lang, wanted = '') {
  const entries = Object.values(index || {}).filter((v) => v && v.key && v.files);
  const find = (key) => entries.find((v) => v.key === key);
  let hit = (wanted && find(wanted)) || null;
  if (!hit) for (const key of PREFERRED[lang] || []) if ((hit = find(key))) break;
  if (!hit) {
    const family = String(lang || 'en').slice(0, 2);
    hit = entries.filter((v) => (v.language?.family || v.key.slice(0, 2)) === family)
      .sort((a, b) => (QUALITY.indexOf(a.quality) + 1 || 9) - (QUALITY.indexOf(b.quality) + 1 || 9) || a.key.localeCompare(b.key))[0] || null;
  }
  if (!hit) return null;
  const files = Object.entries(hit.files).filter(([name]) => /\.onnx(\.json)?$/.test(name)).map(([name, f]) => ({ path: name, bytes: f.size_bytes || 0, md5: f.md5_digest || '' }));
  return files.length === 2 ? { key: hit.key, files } : null;
}

// the voices lying in a folder (a few levels): a model *.onnx with its *.onnx.json beside it
function voicesIn(root, { fsx = fs, depth = 3 } = {}) {
  const out = [];
  const walk = (dir, level) => {
    let entries = [];
    try {
      entries = fsx.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (level < depth && !/^(node_modules|espeak-ng-data|pkgconfig|\.git)$/i.test(e.name)) walk(full, level + 1);
      } else if (/\.onnx$/i.test(e.name) && fsx.existsSync(`${full}.json`)) {
        out.push({ key: e.name.replace(/\.onnx$/i, ''), onnx: full, config: `${full}.json` });
      }
    }
  };
  if (root) walk(root, 0);
  return out;
}

class Piper extends EventEmitter {
  constructor({
    spawn = cp.spawn, fetchFn = (...a) => fetch(...a), fsx = fs, platform = process.platform, arch = process.arch, is64 = true,
    roots = () => [], defaultDir = () => path.join(os.tmpdir(), 'capri-piper'), release = process.env.CAPRI_PIPER_RELEASE || RELEASE, voicesBase = process.env.CAPRI_PIPER_VOICES || VOICES, idleMs = 3 * 60 * 1000, timeoutMs = REQUEST_TIMEOUT,
  } = {}) {
    super();
    Object.assign(this, { spawn, fetchFn, fsx, platform, arch, is64, rootsFn: roots, defaultDir, release, voicesBase, idleMs, timeoutMs });
    this.phase = 'off'; // 'off', 'starting', 'ready', 'failed'
    this.error = '';
    this.exe = '';
    this.dir = '';
    this.voice = '';
    this.log = [];
    this.proc = null;
    this.procKey = '';
    this.queue = [];
    this.pending = '';
    this.outDir = '';
    this.idleTimer = null;
    this.chain = Promise.resolve();
  }

  status() {
    return { phase: this.phase, error: this.error, dir: this.dir, exe: this.exe, voice: this.voice, log: this.log.slice(-8) };
  }

  set(phase, error = '') {
    if (phase === this.phase && error === this.error) return;
    this.phase = phase;
    this.error = error;
    this.emit('change', this.status());
  }

  // ---- finding it ----

  // The program: in the folder named in her config, else a "piper" folder next to her, else the one she fetched.
  // { dir, exe } or null.
  locate(cfg = {}) {
    const names = this.platform === 'win32' ? ['piper.exe'] : ['piper'];
    const named = String(cfg.piperDir || '').trim();
    const folders = named ? [named] : [...foldersLike(/piper/i, this.rootsFn(), { fsx: this.fsx }), this.defaultDir()];
    for (const dir of folders) {
      const exe = findFile(dir, names, { depth: 2, fsx: this.fsx });
      if (exe) return { dir: path.dirname(exe), exe, root: dir };
    }
    return null;
  }

  // every voice she has on the PC: in the program's folder, in any "piper" folder next to her, in the one she fetched
  voices(cfg = {}) {
    const loc = this.locate(cfg);
    const places = [loc?.root, cfg.piperDir, ...foldersLike(/piper/i, this.rootsFn(), { fsx: this.fsx }), this.defaultDir()].filter(Boolean);
    const seen = new Map();
    for (const place of [...new Set(places)]) for (const v of voicesIn(place, { fsx: this.fsx })) if (!seen.has(v.onnx)) seen.set(v.onnx, v);
    return [...seen.values()];
  }

  // the voice for a language: the one named in her settings if she has it, else her favourite, else any of that language
  voiceFor(cfg, lang) {
    const all = this.voices(cfg);
    const named = String(cfg.ttsVoice || '').trim().toLowerCase();
    if (named) {
      const hit = all.find((v) => v.key.toLowerCase() === named || path.basename(v.onnx).toLowerCase() === named);
      if (hit) return hit;
    }
    const prefix = LANG_PREFIX[lang] || `${lang}_`;
    const ofLang = all.filter((v) => v.key.toLowerCase().startsWith(prefix));
    for (const key of PREFERRED[lang] || []) {
      const hit = ofLang.find((v) => v.key === key);
      if (hit) return hit;
    }
    return ofLang.sort((a, b) => a.key.localeCompare(b.key))[0] || null;
  }

  // ---- fetching it ----

  // Fetches the program into her own folder. onProgress({ completed, total }); resolves { exe }.
  async install({ onProgress, signal } = {}) {
    const asset = assetFor(this.platform, this.arch, this.is64);
    if (!asset) throw new Error(`Piper has no program for ${this.platform} ${this.arch}`);
    const dir = this.defaultDir();
    const file = path.join(dir, asset);
    await download(`${this.release}/${asset}`, file, { onProgress, signal, fetchFn: this.fetchFn });
    await extract(file, dir);
    fs.rmSync(file, { force: true });
    const loc = this.locate({});
    if (!loc) throw new Error(`${asset} unpacked, but it has no piper program in it`);
    if (this.platform !== 'win32') fs.chmodSync(loc.exe, 0o755);
    return loc;
  }

  // Fetches the voice for a language from the library into <piper folder>/voices. Resolves { key, onnx }.
  async fetchVoice(cfg, lang, { onProgress, signal } = {}) {
    const loc = this.locate(cfg);
    const base = path.join(loc ? loc.root : this.defaultDir(), 'voices');
    fs.mkdirSync(base, { recursive: true });
    // (where huggingface.co is blocked, the mirror of the model hub in her settings serves the voices too)
    const mirror = String(cfg.hfEndpoint || '').trim().replace(/\/+$/, '');
    const library = mirror ? `${mirror}/rhasspy/piper-voices/resolve/main` : this.voicesBase;
    const res = await this.fetchFn(`${library}/voices.json`, { signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`the voice library answered ${res.status}`);
    const index = await res.json();
    const wanted = String(cfg.ttsVoice || '').trim();
    const voice = pickVoice(index, lang, wanted);
    if (!voice) throw new Error(`the voice library has no voice for "${lang}"`);
    const total = voice.files.reduce((n, f) => n + f.bytes, 0);
    let before = 0;
    for (const f of voice.files) {
      const dest = path.join(base, path.basename(f.path));
      await download(`${library}/${f.path}`, dest, {
        signal, fetchFn: this.fetchFn, md5: f.md5,
        onProgress: ({ completed }) => onProgress?.({ completed: before + completed, total: total || before + completed }),
      });
      before += f.bytes;
    }
    return { key: voice.key, onnx: path.join(base, `${voice.key}.onnx`) };
  }

  // ---- speaking ----

  // The wav of a line. Starts the program if it is not running; lines are made one after the other.
  speak(cfg, { text, lang = 'en' }) {
    const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!line) return Promise.reject(new Error('nothing to say'));
    const job = this.chain.then(() => this.say(cfg, line, lang));
    this.chain = job.catch(() => {});
    return job;
  }

  async say(cfg, line, lang) {
    const loc = this.locate(cfg);
    if (!loc) throw withCode(new Error('Piper is not installed'), 'nopiper');
    const voice = this.voiceFor(cfg, lang);
    if (!voice) throw withCode(new Error(`Piper has no voice for "${lang}"`), 'novoice');
    this.exe = loc.exe;
    this.dir = loc.root;
    this.voice = voice.key;
    this.run(loc, voice);
    clearTimeout(this.idleTimer);
    const wav = await this.ask(line);
    if (this.phase !== 'ready') this.set('ready');
    this.idleTimer = setTimeout(() => this.stopProc(), this.idleMs);
    this.idleTimer.unref?.();
    return wav;
  }

  // (re)starts the program for this voice, if it is not the one running (the speed is the overlay's: it plays the wav at her rate)
  run(loc, voice) {
    const key = voice.onnx;
    if (this.proc && this.procKey === key) return;
    this.stopProc();
    if (this.phase !== 'ready') this.set('starting');
    this.outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-piper-'));
    const args = ['--model', voice.onnx, '--config', voice.config, '--output_dir', this.outDir, '--quiet'];
    let proc;
    try {
      proc = this.spawn(loc.exe, args, { cwd: loc.dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      this.set('failed', `could not start ${loc.exe}: ${err.message}`);
      throw withCode(new Error(this.error), 'nostart');
    }
    this.proc = proc;
    this.procKey = key;
    this.pending = '';
    proc.stdout?.on('data', (chunk) => this.take(proc, chunk));
    proc.stderr?.on('data', (chunk) => this.note(chunk));
    proc.stdin?.on('error', () => {});
    proc.on('error', (err) => this.gone(proc, err.code === 'ENOENT' ? `the Piper program is not there: ${loc.exe}` : err.message));
    proc.on('exit', (code) => this.gone(proc, `Piper stopped (code ${code})`));
  }

  note(chunk) {
    for (const l of String(chunk).split(/[\r\n]+/)) {
      const t = l.trim();
      if (!t) continue;
      this.log.push(t.slice(0, 240));
      if (this.log.length > LOG_LINES) this.log.shift();
    }
  }

  // what the program prints: the path of each wav, in the order the lines were asked
  take(proc, chunk) {
    if (this.proc !== proc) return;
    this.pending += String(chunk);
    let nl;
    while ((nl = this.pending.search(/\r?\n/)) >= 0) {
      const line = this.pending.slice(0, nl).trim();
      this.pending = this.pending.slice(this.pending[nl] === '\r' ? nl + 2 : nl + 1);
      if (!line) continue;
      const job = /\.wav$/i.test(line) ? this.queue.shift() : null;
      if (!job) {
        this.note(line);
        continue;
      }
      clearTimeout(job.timer);
      try {
        const wav = fs.readFileSync(line);
        fs.rmSync(line, { force: true });
        job.resolve(wav);
      } catch (err) {
        job.reject(new Error(`Piper made a file she cannot read: ${err.message}`));
      }
    }
  }

  ask(line) {
    return new Promise((resolve, reject) => {
      const job = { resolve, reject, timer: null };
      job.timer = setTimeout(() => {
        const at = this.queue.indexOf(job);
        if (at >= 0) this.queue.splice(at, 1);
        this.stopProc(); // (a program that does not answer is not trusted with the next line)
        reject(withCode(new Error('Piper did not answer in time'), 'timeout'));
      }, this.timeoutMs);
      this.queue.push(job);
      try {
        this.proc.stdin.write(`${line}\n`);
      } catch (err) {
        clearTimeout(job.timer);
        this.queue.splice(this.queue.indexOf(job), 1);
        reject(err);
      }
    });
  }

  // the program ended by itself (a model it could not read, a crash)
  gone(proc, why) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.procKey = '';
    const reason = this.lastProblem() || why;
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(withCode(new Error(reason), 'exited'));
    }
    this.set('failed', reason);
  }

  lastProblem() {
    return [...this.log].reverse().find((l) => /(error|exception|failed|cannot|could not|no such|invalid)/i.test(l)) || '';
  }

  stopProc() {
    clearTimeout(this.idleTimer);
    const proc = this.proc;
    this.proc = null;
    this.procKey = '';
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(withCode(new Error('Piper was stopped'), 'stopped'));
    }
    if (proc) killTree(proc, { platform: this.platform, spawn: this.spawn });
    if (this.outDir) {
      fs.rmSync(this.outDir, { recursive: true, force: true });
      this.outDir = '';
    }
  }

  stop(report = true) {
    this.stopProc();
    if (report) this.set('off');
    else this.phase = 'off';
  }

  // Whether it works: makes a short line, with the voice for this language (the provision's last step)
  async check(cfg, lang) {
    this.set('starting');
    try {
      await this.speak(cfg, { text: lang === 'ru' ? 'Привет.' : 'Hello.', lang });
    } catch (err) {
      this.set('failed', err.message);
      throw err;
    }
    this.set('ready');
    return this.status();
  }
}

module.exports = { Piper, assetFor, pickVoice, voicesIn, ASSETS, PREFERRED, RELEASE, VOICES };
