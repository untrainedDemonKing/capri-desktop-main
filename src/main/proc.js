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

module.exports = { killTree, which, foldersLike, runPython };
