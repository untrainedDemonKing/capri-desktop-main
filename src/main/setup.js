'use strict';

// Setting her up with buttons, so nobody has to type in a terminal: Ollama (installed with winget,
// woken up, a model fetched with its progress), an API key pasted in her panel (kept encrypted with
// your Windows account), and Claude Code or Codex run through Ollama in a window of their own.
// Windows; elsewhere the buttons open the right pages instead.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { safeStorage } = require('electron');
const ollama = require('./ollama');
const { download, extract } = require('./fetch-files');

const WIN = process.platform === 'win32';

// The models she offers for her chat, with what they weigh (as Ollama lists them)
const MODELS = [
  { name: 'gemma3:4b', bytes: 3.3e9 }, // better in languages other than English
  { name: 'llama3.2', bytes: 2.0e9 },  // lighter
];

// Where to get a key, by provider (llm.js)
const KEY_PAGES = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  groq: 'https://console.groq.com/keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
  openai: 'https://platform.openai.com/api-keys',
  mistral: 'https://console.mistral.ai/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
};

function which(cmd) {
  return new Promise((resolve) => {
    execFile(WIN ? 'where.exe' : 'which', [cmd], { windowsHide: true, timeout: 5000 }, (err, out) => (
      resolve(err ? null : String(out).split(/\r?\n/)[0].trim() || null)));
  });
}

// Ollama's own app (it runs the server from the tray) and its command, where its installer puts them
function ollamaFiles() {
  const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama');
  return { app: path.join(dir, 'ollama app.exe'), cli: path.join(dir, 'ollama.exe') };
}

// { running, installed, models, winget }: how far along Ollama is on this PC
async function ollamaState() {
  const models = await ollama.models().catch(() => null);
  if (models) return { running: true, installed: true, models, winget: false };
  const [onPath, winget] = await Promise.all([which('ollama'), WIN ? which('winget') : null]);
  return { running: false, installed: fs.existsSync(ollamaFiles().cli) || Boolean(onPath), models: null, winget: Boolean(winget) };
}

// Installs something with winget (Windows' own package manager); onLine(text) for what it prints.
function wingetInstall(id, onLine) {
  return new Promise((resolve) => {
    const child = spawn('winget', [
      'install', '--id', id, '--exact', '--silent',
      '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity',
    ], { windowsHide: true });
    // its progress bars redraw with \r: the last state of each line is enough
    const read = (chunk) => String(chunk).split(/[\r\n]+/).map((l) => l.trim()).filter((l) => /[a-z]{3}/i.test(l)).forEach((l) => onLine?.(l));
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}
const installOllama = (onLine) => wingetInstall('Ollama.Ollama', onLine);

// Python's own installer, if you put one next to her (python-3.11.9-amd64.exe from python.org): for a PC with no
// winget or no internet. A few folders are looked in: `roots` and a `python` or `installers` folder in each.
function findPythonInstaller(roots = [], { fsx = fs } = {}) {
  const wanted = /^python-3\.1[0-2](\.\d+)?(-amd64|-win32)?\.exe$/i;
  const bits = process.arch === 'ia32' && !process.env.PROCESSOR_ARCHITEW6432 ? /win32|^python-3\.1[0-2](\.\d+)?\.exe$/i : /amd64/i;
  const found = [];
  for (const root of roots) {
    for (const dir of [root, path.join(root, 'python'), path.join(root, 'installers')]) {
      let names = [];
      try {
        names = fsx.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) if (wanted.test(name) && bits.test(name)) found.push(path.join(dir, name));
    }
  }
  // the newest 3.11 first (what Chatterbox is tested with), then the others
  return found.sort((a, b) => (/3\.11/.test(b) ? 1 : 0) - (/3\.11/.test(a) ? 1 : 0) || path.basename(b).localeCompare(path.basename(a)))[0] || null;
}

// Python: the installer next to her if there is one (silent, for you only, on the PATH), else winget
function installPython(onLine, roots = []) {
  const file = findPythonInstaller(roots);
  if (!file || !WIN) return wingetInstall('Python.Python.3.11', onLine);
  return new Promise((resolve) => {
    onLine?.(path.basename(file));
    const child = spawn(file, ['/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0', 'Include_launcher=1'], { windowsHide: true, stdio: 'ignore' });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}

// Ollama's own installer, downloaded and run silently (for a Windows with no winget). onLine(text): how far.
async function downloadOllama(onLine) {
  if (!WIN) return { ok: false, error: 'Windows only' };
  const file = path.join(os.tmpdir(), 'OllamaSetup.exe');
  try {
    const res = await fetch('https://ollama.com/download/OllamaSetup.exe', { redirect: 'follow' });
    if (!res.ok || !res.body) return { ok: false, error: `the download answered ${res.status}` };
    const total = Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(file);
    let got = 0;
    let shown = 0;
    for await (const chunk of res.body) {
      out.write(chunk);
      got += chunk.length;
      if (total && got - shown > total / 50) {
        shown = got;
        onLine?.(`${Math.round((got / total) * 100)}%`);
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return new Promise((resolve) => {
    const child = spawn(file, ['/SILENT', '/NORESTART'], { windowsHide: true, stdio: 'ignore' });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}

// Ollama's zip (from its releases on GitHub: the program and its libraries, no installer, no administrator, no
// winget) unpacked into `dir`. For a Windows where neither of the above worked. Resolves { ok, dir }.
async function downloadOllamaZip(dir, onLine, signal) {
  if (!WIN) return { ok: false, error: 'Windows only' };
  const arm = process.env.PROCESSOR_ARCHITECTURE === 'ARM64' || process.env.PROCESSOR_ARCHITEW6432 === 'ARM64';
  const file = path.join(os.tmpdir(), `capri-ollama-${process.pid}.zip`);
  try {
    await download(`https://github.com/ollama/ollama/releases/latest/download/ollama-windows-${arm ? 'arm64' : 'amd64'}.zip`, file, {
      signal, onProgress: ({ completed, total }) => onLine?.(total ? `${Math.round((completed / total) * 100)}%` : `${Math.round(completed / 1048576)} MB`),
    });
    onLine?.('…');
    await extract(file, dir);
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(file, { force: true });
  }
  // (the models she fetches go in here, beside it: the folder is found by these two, and they go with it)
  for (const sub of ['manifests', 'blobs']) fs.mkdirSync(path.join(dir, 'models', sub), { recursive: true });
  return { ok: fs.existsSync(path.join(dir, 'ollama.exe')), dir };
}

// Wakes Ollama up (its app, else `ollama serve` in the background) and waits for it to answer.
async function startOllama() {
  const { app, cli } = ollamaFiles();
  const run = (file, args) => spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  if (fs.existsSync(app)) run(app, []);
  else run(fs.existsSync(cli) ? cli : 'ollama', ['serve']);
  for (let i = 0; i < 40; i++) {
    if (await ollama.models().catch(() => null)) return { ok: true };
    await new Promise((r) => setTimeout(r, 750));
  }
  return { ok: false, error: 'Ollama did not answer' };
}

// Fetches a model (ollama.js): onProgress({ completed, total, status }), the bar going once from empty to full.
const pullModel = (name, onProgress, signal) => ollama.pull(name, onProgress, signal);

// Claude Code (or Codex) through Ollama, in a window of its own: Ollama fetches what's missing and
// asks which model to use. She sees it like any other session, through her hooks.
function launchThroughOllama(integration) {
  if (!WIN || !['claude', 'codex'].includes(integration)) return { ok: false };
  const { cli } = ollamaFiles();
  // `start` opens a new console window (its first quoted argument is the window's title); cmd /k
  // strips the outer quotes of what follows, so a path with spaces in it keeps its own
  const command = `""${fs.existsSync(cli) ? cli : 'ollama'}" launch ${integration}"`;
  spawn('cmd.exe', ['/d', '/c', 'start', '"Capri"', 'cmd.exe', '/k', command], {
    detached: true, stdio: 'ignore', windowsVerbatimArguments: true,
  }).on('error', () => {}).unref();
  return { ok: true };
}

// API keys are kept encrypted in config.json, with your Windows account (DPAPI): "enc:<base64>".
function sealKey(key) {
  return safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(key).toString('base64')}` : key;
}

function openKey(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc:')) return stored || '';
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  } catch {
    return '';
  }
}

const openKeys = (apiKeys = {}) => Object.fromEntries(Object.entries(apiKeys).map(([id, v]) => [id, openKey(v)]));

module.exports = {
  MODELS, KEY_PAGES, ollamaState, installOllama, installPython, findPythonInstaller, downloadOllama, downloadOllamaZip, startOllama, pullModel, launchThroughOllama, sealKey, openKeys,
};
