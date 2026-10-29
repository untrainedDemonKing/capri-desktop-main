'use strict';

// Running programs for the check: always with a time limit (a program that hangs is a finding, not a hang of the check), never with a
// window, and with what it said (both streams) and how it ended.

const { spawn } = require('node:child_process');

const WIN = process.platform === 'win32';

// Kills a program and what it started (a plain kill leaves the children of a PowerShell or an installer running).
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (WIN) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

// exec(file, args, { timeout, cwd, env, input, shell, onLine }) -> { code, signal, out, err, ms, timedOut, error }
// Never rejects: a program that is not there is { error: 'ENOENT', code: null }.
function exec(file, args = [], { timeout = 30000, cwd, env, input, shell = false, onLine } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    let err = '';
    let timedOut = false;
    let error = '';
    let child;
    try {
      child = spawn(file, args, { cwd, env: env || process.env, shell, windowsHide: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: null, signal: null, out, err, ms: 0, timedOut, error: e.code || e.message });
      return;
    }
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.length > 4e6) out = out.slice(-2e6);
      if (onLine) for (const l of String(d).split(/\r?\n/)) if (l.trim()) onLine(l);
    });
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 4e6) err = err.slice(-2e6);
    });
    if (input !== undefined) child.stdin.on('error', () => {}).end(input);
    child.on('error', (e) => { error = e.code || e.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out, err, ms: Date.now() - started, timedOut, error });
    });
  });
}

const psArgs = (encoded) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];

// Runs a PowerShell script the way Capri does (encoded, so no quoting can change it), output as UTF-8.
function ps(script, opts = {}) {
  const full = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; ${script}`;
  return exec('powershell.exe', psArgs(Buffer.from(full, 'utf16le').toString('base64')), opts);
}

// Runs a script file with PowerShell, the way the watchers of Capri are started (-File).
function psFile(file, args = [], opts = {}) {
  return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], opts);
}

// The first line of what a program printed for `--version`, or null when it is not there.
async function version(file, args = ['--version'], opts = {}) {
  if (/\.(cmd|bat)$/i.test(file)) return ''; // (a script of cmd cannot be started without a shell; that it is found is the answer)
  const r = await exec(file, args, { timeout: 8000, ...opts });
  if (r.error || (r.code !== 0 && !r.out.trim() && !r.err.trim())) return null;
  // (some programs, wsl for one, print in UTF-16: every other byte is a zero)
  return (r.out.replace(/\u0000/g, '').trim() || r.err.replace(/\u0000/g, '').trim()).split(/\r?\n/)[0].slice(0, 160);
}

// Where a program is found on the PATH (where / which); null when it is not.
async function which(name) {
  const r = await exec(WIN ? 'where.exe' : 'which', [name], { timeout: 6000 });
  if (r.code !== 0) return null;
  return r.out.trim().split(/\r?\n/)[0] || null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { exec, ps, psFile, psArgs, version, which, killTree, wait, WIN };
