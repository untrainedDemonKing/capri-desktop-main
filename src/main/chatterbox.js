'use strict';

// Her voice through Chatterbox (a speech model that runs on your own PC), started and kept by her.
//
// You put the Chatterbox folder next to her (or name it in her menu); she finds the Python in it (its
// venv, or an embedded one), starts her little server around the Chatterbox library with it
// (chatterbox-server.py, on a free port, in the background), waits until the model is loaded, asks it for
// her lines (tts.js) and stops it when she quits. Nothing to start by hand, nothing to type.
//
// A Chatterbox server of your own that is already running can be used instead: set chatterboxUrl and she
// only talks to it.

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');

const LOG_LINES = 40;
const START_TIMEOUT = 15 * 60 * 1000; // the first start downloads the model (a few GB)
// folders that are never worth looking into when searching for the Python
const SKIP = new Set(['node_modules', '.git', 'site-packages', '__pycache__', 'lib', 'lib64', 'include', 'share', 'models', 'weights', 'outputs', 'cache', '.cache', 'dist', 'build', 'docs']);
const PREFER = ['venv', '.venv', 'env', '.env', 'python_embeded', 'python_embedded', 'python', 'runtime'];

const withCode = (err, code) => Object.assign(err, { code });
// a copy of the model hub's cache that you put in the Chatterbox folder (the `huggingface` folder of another PC's
// ~/.cache): the model is read from it and not downloaded
const CACHE_NAMES = ['hf_home', 'hf-home', 'huggingface', 'hf_cache', 'hf-cache'];
function modelCache(dir, { fsx = fs } = {}) {
  if (!dir) return '';
  for (const name of CACHE_NAMES) {
    const full = path.join(dir, name);
    try {
      if (fsx.statSync(full).isDirectory()) return full;
    } catch {
      // not here
    }
  }
  return '';
}

// How to say what a folder is: its Python, if it has one (a venv, or an embedded Python).
function pythonHome(dir, platform, fsx) {
  const has = (...p) => fsx.existsSync(path.join(dir, ...p));
  if (platform === 'win32') {
    if (has('Scripts', 'python.exe')) return path.join(dir, 'Scripts', 'python.exe');
    // an embedded Python (python.exe beside its python3xx._pth or python3xx.dll)
    if (has('python.exe') && fsx.readdirSync(dir).some((f) => /^python\d+\.(_pth|dll)$/i.test(f))) return path.join(dir, 'python.exe');
    return null;
  }
  for (const name of ['python3', 'python']) if (has('bin', name) && has('pyvenv.cfg')) return path.join(dir, 'bin', name);
  return null;
}

// The Python in or under `root` (a few folders deep, the likely ones first); null if there is none.
function findPython(root, { platform = process.platform, fsx = fs, depth = 3 } = {}) {
  const queue = [[root, 0]];
  let seen = 0;
  while (queue.length && seen < 600) {
    const [dir, level] = queue.shift();
    seen++;
    const found = pythonHome(dir, platform, fsx);
    if (found) return found;
    if (level >= depth) continue;
    let entries = [];
    try {
      entries = fsx.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP.has(e.name.toLowerCase()));
    } catch {
      continue;
    }
    entries.sort((a, b) => (PREFER.indexOf(a.name.toLowerCase()) + 1 || 99) - (PREFER.indexOf(b.name.toLowerCase()) + 1 || 99));
    for (const e of entries) queue.push([path.join(dir, e.name), level + 1]);
  }
  return null;
}

// Where the Chatterbox folder is: the one named in her config, else a folder with "chatterbox" in its name
// next to her (the places given), else nothing.
function findFolder(cfg, roots = [], { fsx = fs } = {}) {
  const named = String(cfg.chatterboxDir || '').trim();
  if (named) return fsx.existsSync(named) ? named : null;
  for (const root of roots) {
    let entries = [];
    try {
      entries = fsx.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const hit = entries.filter((e) => e.isDirectory() && /chatterbox/i.test(e.name)).map((e) => e.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))[0];
    if (hit) return path.join(root, hit);
  }
  return null;
}

// The folders (in the Chatterbox one, a few deep) that hold recordings of voices, for her `voice` setting.
function findVoiceDirs(root, { fsx = fs, depth = 2 } = {}) {
  const out = [];
  const walk = (dir, level) => {
    let entries = [];
    try {
      entries = fsx.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP.has(e.name.toLowerCase()) && !PREFER.includes(e.name.toLowerCase()));
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (/^(voices|reference_audio|reference|references)$/i.test(e.name)) out.push(full);
      else if (level < depth) walk(full, level + 1);
    }
  };
  if (root) walk(root, 0);
  return out;
}

// How she sounds in each mood, as Chatterbox's own dials: exaggeration (how much feeling), cfg_weight
// (low is slower, more deliberate; high is quicker, closer to the reference voice) and temperature
// (how much it varies).
const MOOD = {
  calm: { exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8 },
  happy: { exaggeration: 0.7, cfg_weight: 0.4, temperature: 0.9 },
  laugh: { exaggeration: 0.85, cfg_weight: 0.35, temperature: 1.0 },
  angry: { exaggeration: 0.9, cfg_weight: 0.3, temperature: 0.9 },
  annoyed: { exaggeration: 0.6, cfg_weight: 0.45, temperature: 0.8 },
  sad: { exaggeration: 0.4, cfg_weight: 0.55, temperature: 0.7 },
  shy: { exaggeration: 0.55, cfg_weight: 0.5, temperature: 0.8 },
  smug: { exaggeration: 0.7, cfg_weight: 0.4, temperature: 0.85 },
  surprised: { exaggeration: 0.8, cfg_weight: 0.35, temperature: 0.95 },
  dreamy: { exaggeration: 0.4, cfg_weight: 0.6, temperature: 0.7 },
  bored: { exaggeration: 0.35, cfg_weight: 0.6, temperature: 0.7 },
};
const moodDials = (mood) => MOOD[mood] || MOOD.calm;

// her own Python first; failing that the one on the PATH (where `pip install chatterbox-tts` put it)
function pythonCandidates(found, platform = process.platform) {
  if (found) return [[found, []]];
  return platform === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function serverScript() {
  const beside = path.join(__dirname, 'chatterbox-server.py');
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'chatterbox-server.py') : '';
  return packaged && fs.existsSync(packaged) ? packaged : beside;
}

class Chatterbox extends EventEmitter {
  // `voices`: folders with recordings of voices that are hers (voice-sample.js), beside the ones found in the Chatterbox folder
  constructor({ spawn = cp.spawn, fetchFn = (...a) => fetch(...a), fsx = fs, platform = process.platform, script = serverScript(), port = freePort, roots = () => [], voices = () => [], pollMs = 1000 } = {}) {
    super();
    Object.assign(this, { spawn, fetchFn, fsx, platform, script, portFn: port, rootsFn: roots, voicesFn: voices, pollMs });
    this.proc = null;
    this.phase = 'off'; // 'off', 'starting', 'ready', 'failed'
    this.error = '';
    this.url = '';
    this.key = ''; // what the running server was started for (a change means a restart)
    this.dir = '';
    this.python = '';
    this.log = [];
    this.timer = null;
    this.started = 0;
    this.progress = null; // how far a download of the model is (0..1), when the log says
    this.activity = '';
    this.device = '';
  }

  status() {
    return { phase: this.phase, error: this.error, url: this.url, dir: this.dir, python: this.python, device: this.device, progress: this.progress, activity: this.activity, log: this.log.slice(-8) };
  }

  set(phase, error = '') {
    if (phase === this.phase && error === this.error) return;
    this.phase = phase;
    this.error = error;
    this.emit('change', this.status());
  }

  // the server of her config's own address, or the one she runs
  external(cfg) {
    return String(cfg.chatterboxUrl || '').trim().replace(/\/+$/, '');
  }

  wants(cfg) {
    return cfg.ttsEngine === 'chatterbox' && !this.external(cfg) && cfg.chatterboxAuto !== false;
  }

  // Start, restart or stop to match her config (called at start-up and with every change of it).
  async sync(cfg) {
    if (cfg.ttsEngine === 'chatterbox' && this.external(cfg)) {
      this.stop();
      this.url = this.external(cfg);
      this.set('ready');
      return;
    }
    if (!this.wants(cfg)) {
      if (this.proc || this.phase !== 'off') this.stop();
      return;
    }
    const key = [cfg.chatterboxDir || '', cfg.chatterboxDevice || 'auto'].join('|');
    if (key === this.key && (this.phase === 'starting' || this.phase === 'ready' || this.phase === 'failed')) return; // (a failed start is tried again by the menu's button, not by every setting touched)
    await this.start(cfg, key);
  }

  // the menu's "start again"
  async restart(cfg) {
    this.stop();
    await this.sync(cfg);
  }

  async start(cfg, key = '') {
    this.stop(false);
    this.key = key;
    this.log = [];
    this.progress = null;
    this.activity = '';
    this.device = '';
    this.started = Date.now();
    this.set('starting');
    const dir = findFolder(cfg, this.rootsFn(), { fsx: this.fsx });
    if (String(cfg.chatterboxDir || '').trim() && !dir) return this.fail('The Chatterbox folder is not there: ' + cfg.chatterboxDir, 'nofolder');
    this.dir = dir || '';
    const found = dir ? findPython(dir, { platform: this.platform, fsx: this.fsx }) : null;
    const candidates = pythonCandidates(found, this.platform);
    if (!found && !dir) this.log.push('no Chatterbox folder found: trying the Python on the PATH');
    let port;
    try {
      port = await this.portFn();
    } catch (err) {
      return this.fail(`no free port: ${err.message}`, 'noport');
    }
    this.url = `http://127.0.0.1:${port}/v1`;
    const voices = [...this.voicesFn(), ...findVoiceDirs(dir, { fsx: this.fsx })]; // (hers first: a name found in both is hers)
    const args = [this.script, '--port', String(port), '--device', cfg.chatterboxDevice || 'auto', '--watch-stdin', ...voices.flatMap((v) => ['--voices', v])];
    const env = String(cfg.hfEndpoint || '').trim() ? { HF_ENDPOINT: String(cfg.hfEndpoint).trim() } : {}; // (a mirror of the model hub, where it is blocked)
    const cache = modelCache(dir, { fsx: this.fsx });
    if (cache) {
      env.HF_HOME = cache;
      this.log.push(`the model is read from ${cache}`);
    }
    return this.launch(candidates, args, dir || path.dirname(this.script), env);
  }

  launch(candidates, args, cwd, extraEnv = {}) {
    const [cmd, pre] = candidates[0];
    this.python = cmd;
    let proc;
    try {
      proc = this.spawn(cmd, [...pre, ...args], {
        cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_TELEMETRY: '1', ...extraEnv },
      });
    } catch (err) {
      return this.fail(`could not start ${cmd}: ${err.message}`, 'nopython');
    }
    this.proc = proc;
    const take = (chunk) => {
      for (const line of String(chunk).split(/[\r\n]+/)) {
        const text = line.trim();
        if (!text) continue;
        this.log.push(text.slice(0, 240));
        if (this.log.length > LOG_LINES) this.log.shift();
        // the model hub's download bars: "model.safetensors:  45%|████ | 1.2G/3.0G"
        const bar = /(\d{1,3})%\|/.exec(text);
        if (bar) {
          const progress = Math.min(1, Number(bar[1]) / 100);
          if (this.progress === null || Math.abs(progress - this.progress) >= 0.01) {
            this.progress = progress;
            this.activity = text.slice(0, 160);
            this.emit('change', this.status());
          }
        }
      }
    };
    proc.stdout?.on('data', take);
    proc.stderr?.on('data', take);
    proc.stdin?.on('error', () => {});
    proc.on('error', (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (err.code === 'ENOENT' && candidates.length > 1) return this.launch(candidates.slice(1), args, cwd);
      this.fail(err.code === 'ENOENT' ? `Python was not found (${cmd}): put Chatterbox's folder next to her, with its venv` : err.message, 'nopython');
    });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      clearInterval(this.timer);
      if (this.phase === 'off') return;
      this.fail(this.lastProblem() || `the voice server stopped (code ${code})`, 'exited');
    });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(proc), this.pollMs);
    return undefined;
  }

  // the line of the server's log that says what went wrong
  lastProblem() {
    const hit = [...this.log].reverse().find((l) => /(Error|Exception|Traceback|CUDA|out of memory|No module)/i.test(l));
    return hit || '';
  }

  async poll(proc) {
    if (this.proc !== proc) return;
    if (Date.now() - this.started > START_TIMEOUT) return this.fail('the model did not load in 15 minutes', 'timeout');
    try {
      const res = await this.fetchFn(`${this.url.replace(/\/v1$/, '')}/health`, { signal: AbortSignal.timeout(1500) });
      const body = await res.json();
      if (this.proc !== proc) return;
      if (body.error) return this.fail(body.error, 'failed');
      if (body.device) this.device = body.device;
      if (body.ready) {
        clearInterval(this.timer);
        this.progress = null;
        this.set('ready');
      }
    } catch {
      // not listening yet
    }
    return undefined;
  }

  fail(message, code = 'failed') {
    clearInterval(this.timer);
    const proc = this.proc;
    this.proc = null;
    this.killProc(proc);
    this.code = code;
    this.set('failed', message);
  }

  killProc(proc) {
    if (!proc) return;
    try {
      proc.stdin?.end();
    } catch {
      // gone already
    }
    try {
      if (this.platform === 'win32' && proc.pid) this.spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else proc.kill();
    } catch {
      // gone already
    }
  }

  stop(report = true) {
    clearInterval(this.timer);
    const proc = this.proc;
    this.proc = null;
    this.killProc(proc);
    if (report) this.set('off');
    else this.phase = 'off';
  }

  // The address to speak to, once the model is ready (waits up to `waitMs` for it; she says the line with
  // the system voice meanwhile and says so once).
  async ready(cfg, waitMs = 20000) {
    const ext = this.external(cfg);
    if (ext) return ext;
    if (!this.wants(cfg)) throw withCode(new Error(cfg.ttsEngine === 'chatterbox' ? 'Chatterbox is not started: she starts it only when auto-start is on' : 'her voice engine is not Chatterbox'), 'off');
    if (this.phase === 'off') await this.sync(cfg);
    const until = Date.now() + waitMs;
    while (this.phase === 'starting' && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    if (this.phase === 'ready') return this.url;
    if (this.phase === 'failed') throw withCode(new Error(`Chatterbox: ${this.error}`), this.code || 'failed');
    throw withCode(new Error('Chatterbox is still loading its model'), 'starting');
  }
}

module.exports = { Chatterbox, findPython, findFolder, findVoiceDirs, modelCache, pythonCandidates, moodDials, MOOD, serverScript };
