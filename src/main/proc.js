'use strict';

// Small helpers for the programs she starts herself (Ollama, her Chatterbox server): killing one with
// everything it started, finding a program on the PATH, listing the folders next to her.

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

// A process and its children (Ollama's runner, Python's workers): taskkill's /T on Windows, else the process.
function killTree(proc, { platform = process.platform, spawn = cp.spawn } = {}) {
  if (!proc) return;
  try {
    proc.stdin?.end();
  } catch {
    // gone already
  }
  try {
    if (platform === 'win32' && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else proc.kill();
  } catch {
    // gone already
  }
}

// Ends `proc` and everything it started when `signal` fires (her "Stop"). Returns the function that lets go of the
// signal once the program is over on its own.
function killOnAbort(proc, signal, opts) {
  if (!signal) return () => {};
  const stop = () => killTree(proc, opts);
  if (signal.aborted) {
    stop();
    return () => {};
  }
  signal.addEventListener('abort', stop, { once: true });
  return () => signal.removeEventListener('abort', stop);
}

// A program run to its end, with what it prints passed on (onData(chunk)). Resolves { ok, code }, or
// { ok: false, error } when it will not start, or { ok: false, cancelled: true } as soon as `signal` fires: then
// the program and what it started are ended, and nobody waits for them to close their pipes.
function runToEnd(file, args, { signal, onData, env, stdio, spawn = cp.spawn, platform } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, cancelled: true });
      return;
    }
    let child;
    try {
      child = spawn(file, args, { windowsHide: true, ...(env && { env }), ...(stdio && { stdio }) });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    const unkill = killOnAbort(child, signal, { platform, spawn });
    const stopped = () => resolve({ ok: false, cancelled: true });
    signal?.addEventListener('abort', stopped, { once: true });
    const letGo = () => {
      unkill();
      signal?.removeEventListener('abort', stopped);
    };
    if (onData) {
      const hear = (chunk) => { if (!signal?.aborted) onData(chunk); }; // (what is said while it is being ended is not passed on)
      child.stdout?.on('data', hear);
      child.stderr?.on('data', hear);
    }
    child.on('error', (err) => {
      letGo();
      resolve({ ok: false, error: err.message });
    });
    child.on('close', (code) => {
      letGo();
      resolve({ ok: code === 0, code });
    });
  });
}

// Where a command is on the PATH (null: not there).
function which(cmd, { platform = process.platform, execFile = cp.execFile } = {}) {
  return new Promise((resolve) => {
    execFile(platform === 'win32' ? 'where.exe' : 'which', [cmd], { windowsHide: true, timeout: 5000 }, (err, out) => (
      resolve(err ? null : String(out).split(/\r?\n/)[0].trim() || null)));
  });
}

// The folders (not files) in each of `roots` whose name matches `pattern`, by name without regard to case.
function foldersLike(pattern, roots, { fsx = fs } = {}) {
  const out = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fsx.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries.filter((e) => e.isDirectory() && pattern.test(e.name)).map((e) => e.name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    for (const name of names) out.push(path.join(root, name));
  }
  return out;
}

// What `python -c` says for a snippet: { ok, out } (a Python that will not run is not ok)
function runPython(python, args, { spawnSync = cp.spawnSync, timeout = 30000, cwd } = {}) {
  try {
    const r = spawnSync(python, args, { encoding: 'utf8', timeout, windowsHide: true, cwd });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  } catch (err) {
    return { ok: false, out: err.message };
  }
}

module.exports = { killTree, killOnAbort, runToEnd, which, foldersLike, runPython };
