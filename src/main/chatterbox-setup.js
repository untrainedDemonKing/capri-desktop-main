'use strict';

// What her voice (Chatterbox) needs on this PC, made ready by her: a Python, an environment for it in her
// Chatterbox folder, and the chatterbox-tts package in it (with a graphics-card build of torch when there
// is an NVIDIA card). Used by provision.js when something is missing; when the folder already has it all
// (a venv with the package in it) none of this runs.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runPython, runPythonAsync, which, runToEnd } = require('./proc');

const MIN = [3, 10];
const MAX = [3, 12]; // (what Chatterbox is built for; a newer one often has no torch yet)

// the Pythons to try, best first: the launcher with a version (Windows), then the names Linux and macOS give
function candidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    // (and where Python's installer puts it, for a Python that was installed a minute ago: this process has not heard of the new PATH)
    const local = env.LOCALAPPDATA ? ['311', '312', '310'].map((v) => [path.join(env.LOCALAPPDATA, 'Programs', 'Python', `Python${v}`, 'python.exe'), []]) : [];
    return [['py', ['-3.11']], ['py', ['-3.12']], ['py', ['-3.10']], ['python', []], ['python3', []], ...local];
  }
  return [['python3.11', []], ['python3.12', []], ['python3.10', []], ['python3', []], ['python', []]];
}

function parseVersion(text) {
  const m = /Python (\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}
const inRange = (v) => v && (v[0] > MIN[0] || (v[0] === MIN[0] && v[1] >= MIN[1])) && (v[0] < MAX[0] || (v[0] === MAX[0] && v[1] <= MAX[1]));

// A Python of the system that is good enough: { cmd, pre, version } or null. `tooNew`: one was found, but not
// a version Chatterbox is built for (so she can say which).
function findSystemPython({ platform = process.platform, run = runPython, env = process.env } = {}) {
  let seen = null;
  for (const [cmd, pre] of candidates(platform, env)) {
    const r = run(cmd, [...pre, '--version'], { timeout: 8000 });
    if (!r.ok) continue;
    const version = parseVersion(r.out);
    if (inRange(version)) return { cmd, pre, version: version.join('.') };
    seen = seen || version;
  }
  return seen ? { tooNew: seen.join('.') } : null;
}

const venvPython = (dir, platform = process.platform) => (platform === 'win32' ? path.join(dir, 'venv', 'Scripts', 'python.exe') : path.join(dir, 'venv', 'bin', 'python3'));

// Her environment in the folder: `venv`. Returns the Python in it, or throws with what the system Python said.
function createVenv(system, dir, { platform = process.platform, run = runPython, fsx = fs } = {}) {
  fsx.mkdirSync(dir, { recursive: true });
  const r = run(system.cmd, [...system.pre, '-m', 'venv', path.join(dir, 'venv')], { timeout: 180000 });
  const python = venvPython(dir, platform);
  if (!r.ok || !fsx.existsSync(python)) throw new Error(`could not make a Python environment in ${dir}: ${r.out.split('\n').slice(-2).join(' ').slice(0, 200)}`);
  return python;
}

// whether the package is there (looked for, not imported: importing torch takes a good while)
function hasChatterbox(python, { run = runPython, pre = [] } = {}) {
  return run(python, [...pre, '-c', "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('chatterbox') else 1)"], { timeout: 30000 }).ok;
}

// what to pip install: the folder itself if it is Chatterbox's own source, else the package from PyPI
function installTarget(dir, { fsx = fs } = {}) {
  try {
    const project = fsx.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
    if (/name\s*=\s*["']chatterbox-tts["']/.test(project)) return { args: ['-e', dir], label: 'the folder' };
  } catch {
    // not a source folder
  }
  return { args: ['chatterbox-tts'], label: 'chatterbox-tts' };
}

const RAW_PROGRESS = /^Progress \d+ of \d+$/; // (what `pip --progress-bar raw` prints)

// pip, with what it prints passed on line by line: onLine(text). Resolves { ok, code, tail }, and cancelled: true
// when `signal` stopped it (pip and everything it started are ended at once: a download of gigabytes does not go on
// behind her "Stop"). env: more for its environment (a TEMP in the folder she was given, for one).
async function pip(python, args, onLine, { spawn = cp.spawn, env = {}, signal } = {}) {
  const tail = [];
  const read = (chunk) => {
    for (const line of String(chunk).split(/[\r\n]+/)) {
      const text = line.trim();
      if (!text) continue;
      if (!RAW_PROGRESS.test(text)) {
        tail.push(text.slice(0, 300));
        if (tail.length > 30) tail.shift(); // (the raw progress lines are hundreds a second: they would push the lines that say what went wrong out)
      }
      onLine?.(text);
    }
  };
  const res = await runToEnd(python, ['-m', 'pip', ...args], {
    spawn, signal, onData: read,
    env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...env },
  });
  if (res.error) tail.push(res.error);
  return { ok: res.ok, code: res.code ?? -1, ...(res.cancelled && { cancelled: true }), tail };
}

// Whether this pip can print its progress in lines (`--progress-bar raw`, from pip 25.1: the pip that comes with Python 3.11
// has only the bar that needs a terminal, so there she would see no progress at all)
async function supportsRawProgress(python, { run = runPythonAsync } = {}) {
  const r = await run(python, ['-m', 'pip', 'install', '--help'], { timeout: 20000 });
  return r.ok && /--progress-bar[\s\S]{0,400}?\braw\b/.test(r.out);
}

// Makes pip fit for showing how far it is: a newer one if this one cannot print its progress (a failure of that is
// not a reason to stop: the install goes on with what there is). Resolves { raw } (the lines can be had).
async function preparePip(python, { signal, env, onLine, run = runPythonAsync, pipFn = pip } = {}) {
  if (!(await supportsRawProgress(python, { run }))) {
    // (quick to give up: a PC with no internet, with a folder of wheels, has no use for a newer pip, and must not wait for it)
    await pipFn(python, ['install', '--upgrade', '--no-cache-dir', '--retries', '1', '--timeout', '15', 'pip'], onLine, { signal, env });
  }
  return { raw: await supportsRawProgress(python, { run }) };
}

// pip shows sizes in decimal units: "57.2 MB", "2.5 GB", "204.2 kB"
function parseSize(text) {
  const m = /^\s*([\d.]+)\s*(B|kB|MB|GB)\s*$/i.exec(String(text));
  return m ? Math.round(Number(m[1]) * { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }[m[2].toUpperCase()]) : 0;
}

// How far everything pip does in a step is, from its lines. It is told each line (feed), and says what it is getting and how
// much of all (view). A stretch of work is a phase (one pip run) with the bytes it is expected to fetch, when that is known
// beforehand: pip tells the size of a file only when it comes to it, and the bar must not run to its end and wait there. So
// the total is the larger of what is expected and what is seen, the bar never goes back, and it stays short of the end
// until pip says it is done (unpacking a few GB has no lines of its own).
function createPipProgress({ now = Date.now } = {}) {
  const phases = [];
  let cur = null;
  let stage = 'getting'; // 'getting' | 'installing' | 'done'
  let top = 0;
  let samples = []; // [{ at, bytes }]: for the speed
  const finish = () => {
    if (cur?.file) Object.assign(cur, { done: cur.done + cur.size, file: '', size: 0, got: 0 });
  };
  let reserved = 0;
  // a phase that is over is what it fetched, not what was expected of it
  const settle = () => {
    finish();
    if (cur) cur.expected = cur.known;
  };
  const total = () => reserved + phases.reduce((n, p) => n + Math.max(p.expected, p.known), 0);
  const done = () => phases.reduce((n, p) => n + p.done + p.got, 0);
  const api = {
    // reserve: what a later phase is expected to fetch, counted in the total until that phase begins (so the bar does not
    // run to its end at the first and start again at the second)
    phase(expected = 0, reserve = 0) {
      settle();
      reserved = reserve;
      cur = { expected, known: 0, done: 0, file: '', size: 0, got: 0 };
      phases.push(cur);
      stage = 'getting';
    },
    // true when what is shown has changed
    feed(line) {
      if (!cur) api.phase(0);
      let m = /^Downloading\s+(\S+)\s+\(([^)]+)\)/.exec(line);
      if (m) {
        finish();
        Object.assign(cur, { file: m[1], size: parseSize(m[2]), got: 0 });
        cur.known += cur.size;
        stage = 'getting';
        return true;
      }
      m = /^Progress (\d+) of (\d+)$/.exec(line);
      if (m) {
        const total_ = Number(m[2]);
        if (cur.file && total_ && total_ !== cur.size) {
          cur.known += total_ - cur.size;
          cur.size = total_;
        }
        cur.got = Math.min(Number(m[1]), cur.size || Number(m[1]));
        const at = now();
        if (!samples.length || at - samples[samples.length - 1].at >= 250) {
          samples.push({ at, bytes: done() });
          samples = samples.filter((x) => at - x.at <= 5000);
        }
        return true;
      }
      if (/^(Collecting|Using cached|Requirement already satisfied)\b/.test(line)) {
        finish();
        return false;
      }
      if (/^Installing collected packages/.test(line)) {
        finish();
        stage = 'installing';
        return true;
      }
      if (/^Successfully installed/.test(line)) {
        settle();
        stage = 'done';
        return true;
      }
      return false;
    },
    view() {
      const t = total();
      const d = done();
      const cap = stage === 'done' ? 1 : stage === 'installing' ? 0.96 : 0.92;
      top = Math.max(top, t ? Math.min(d / t, cap) : 0);
      const first = samples[0];
      const last = samples[samples.length - 1];
      const rate = first && last && last.at > first.at ? Math.max(0, ((last.bytes - first.bytes) / (last.at - first.at)) * 1000) : 0;
      // (the file's name without its version: "torch-2.6.0-cp311-cp311-win_amd64.whl" is "torch")
      const what = cur?.file ? cur.file.replace(/-\d.*$/, '').replace(/\.(whl|tar\.gz)$/, '') : '';
      return { what, done: d, total: t, fraction: top, stage, rate };
    },
  };
  return api;
}

// How far pip is, from a line of its output: what it is getting, in words
function pipActivity(line) {
  let m = /^Downloading\s+(\S+?)(?:\s+\(([^)]+)\))?$/i.exec(line);
  if (m) return { what: m[1].replace(/-\d.*$/, ''), size: m[2] || '' };
  m = /^Collecting\s+([A-Za-z0-9_.-]+)/.exec(line);
  if (m) return { what: m[1], size: '' };
  m = /^Installing collected packages/.exec(line);
  if (m) return { what: 'install', size: '' };
  return null;
}

// torch in her Python: { version, audio, cuda } (null: not importable). One line, so it goes through any shell.
const TORCH_CODE = "import importlib.metadata as m, torch; a=[d.version for d in m.distributions() if (d.metadata['Name'] or '').lower()=='torchaudio']; print(torch.__version__.split('+')[0], (a[0].split('+')[0] if a else '-'), int(torch.cuda.is_available()))";
async function torchStatus(python, { run = runPythonAsync } = {}) {
  const r = await run(python, ['-c', TORCH_CODE], { timeout: 120000 });
  if (!r.ok) return null;
  const [version, audio, cuda] = r.out.split(/\s+/).slice(-3);
  return { version, audio: audio === '-' ? '' : audio, cuda: cuda === '1' };
}

// What pip finds wrong with the versions installed together ("a has requirement b==1, but you have b 2"): [] when they all fit
async function pipCheck(python, { run = runPythonAsync } = {}) {
  const r = await run(python, ['-m', 'pip', 'check'], { timeout: 60000 });
  if (r.ok) return [];
  return r.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /has requirement|requires|is not supported/i.test(l)).slice(0, 8);
}

// torch and torchaudio of one version (a torchaudio of another one does not even load)
const sameTorch = (torch) => !torch?.audio || String(torch.version).split('.').slice(0, 2).join('.') === String(torch.audio).split('.').slice(0, 2).join('.');

// Whether there is an NVIDIA card to use (nvidia-smi answers)
async function hasNvidia({ platform = process.platform, whichFn = which } = {}) {
  return Boolean(await whichFn('nvidia-smi', { platform }));
}

// Which of PyTorch's builds for NVIDIA cards fits this card and its driver: the card's capability (the newest
// cards, "Blackwell", need CUDA 12.8 and a torch of 2.7), then the driver (an older driver cannot run a newer
// build). null: a driver too old for any of them. `gpu`: { driver, compute } as hardware.js has them; without
// them, the middle one (what most drivers of the last years run).
function cudaBuild(gpu = {}) {
  const driver = parseFloat(String(gpu.driver || '').split('.').slice(0, 2).join('.')) || 0;
  const compute = Number(gpu.compute) || 0;
  const url = (tag) => `https://download.pytorch.org/whl/${tag}`;
  if (compute >= 12) return driver && driver < 570 ? null : { index: url('cu128'), pin: '2.7.1' };
  if (!driver || driver >= 551) return { index: url('cu124'), pin: '' };
  if (driver >= 452) return { index: url('cu118'), pin: '' };
  return null;
}

// The CUDA build of the same torch the package pulled in (the plain one from PyPI has no card support on
// Windows): same versions, from PyTorch's own index. Returns pip's arguments, or null if no build fits the card.
function cudaTorchArgs(torch, gpu = {}) {
  const build = cudaBuild(gpu);
  if (!build) return null;
  const version = build.pin || torch.version;
  const pins = [`torch==${version}`, ...(torch.audio ? [`torchaudio==${build.pin || torch.audio}`] : [])];
  return ['install', '--force-reinstall', '--no-deps', ...pins, '--index-url', build.index];
}

module.exports = { candidates, parseVersion, findSystemPython, venvPython, createVenv, hasChatterbox, installTarget, pip, pipActivity, supportsRawProgress, preparePip, createPipProgress, parseSize, pipCheck, sameTorch, torchStatus, hasNvidia, cudaBuild, cudaTorchArgs, MIN, MAX };
