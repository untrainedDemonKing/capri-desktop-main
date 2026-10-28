'use strict';

// What her voice (Chatterbox) needs on this PC, made ready by her: a Python, an environment for it in her
// Chatterbox folder, and the chatterbox-tts package in it (with a graphics-card build of torch when there
// is an NVIDIA card). Used by provision.js when something is missing; when the folder already has it all
// (a venv with the package in it) none of this runs.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runPython, which } = require('./proc');

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

// pip, with what it prints passed on line by line: onLine(text). Resolves { ok, code, tail }.
function pip(python, args, onLine, { spawn = cp.spawn, env = {} } = {}) {
  return new Promise((resolve) => {
    const tail = [];
    let child;
    try {
      child = spawn(python, ['-m', 'pip', ...args], {
        windowsHide: true,
        env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...env },
      });
    } catch (err) {
      resolve({ ok: false, code: -1, tail: [err.message] });
      return;
    }
    const read = (chunk) => {
      for (const line of String(chunk).split(/[\r\n]+/)) {
        const text = line.trim();
        if (!text) continue;
        tail.push(text.slice(0, 300));
        if (tail.length > 30) tail.shift();
        onLine?.(text);
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.on('error', (err) => resolve({ ok: false, code: -1, tail: [err.message] }));
    child.on('close', (code) => resolve({ ok: code === 0, code, tail }));
  });
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
function torchStatus(python, { run = runPython } = {}) {
  const r = run(python, ['-c', TORCH_CODE], { timeout: 120000 });
  if (!r.ok) return null;
  const [version, audio, cuda] = r.out.split(/\s+/).slice(-3);
  return { version, audio: audio === '-' ? '' : audio, cuda: cuda === '1' };
}

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

module.exports = { candidates, parseVersion, findSystemPython, venvPython, createVenv, hasChatterbox, installTarget, pip, pipActivity, torchStatus, hasNvidia, cudaBuild, cudaTorchArgs, MIN, MAX };
