'use strict';

// The folder everything she fetches goes in. By default that is her own data folder (Windows' AppData); you can pick
// another place instead (another disk, where there is room): a folder called "Capri" is made there for her, with a
// mark inside it, and then her Ollama and its models, her Piper, her Chatterbox with its environment and its
// model, her Node.js and the files in the middle of a download (pip's, an installer's) go in it, and in nothing
// else. What was fetched before stays where it is, and is found and taken off from there: the new folder is for
// what she fetches from now on. Her settings and her notes about you stay in the data folder.

const fs = require('node:fs');
const path = require('node:path');

const NAME = 'Capri';
const MARK = 'capri-folder.json'; // what tells that a folder was made for her (cleanup.js takes off only what is under such a one)
const TEMP = 'temp';

// is `child` somewhere under `parent`? (never `parent` itself)
function inside(parent, child) {
  if (!parent || !child) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// The Capri folder for the place you picked: a folder "Capri" in it, unless it is that already (it is called so, or
// it has the mark).
function folderFor(picked, { fsx = fs } = {}) {
  const dir = path.resolve(String(picked || ''));
  if (path.basename(dir).toLowerCase() === NAME.toLowerCase()) return dir;
  try {
    if (fsx.existsSync(path.join(dir, MARK))) return dir;
  } catch { /* not readable: a new one is made under it */ }
  return path.join(dir, NAME);
}

// Makes the folder (and the mark in it, once). Throws when she cannot write there.
function make(dir, { fsx = fs } = {}) {
  fsx.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.write-test-${process.pid}`);
  fsx.writeFileSync(probe, '');
  fsx.rmSync(probe, { force: true });
  const mark = path.join(dir, MARK);
  if (!fsx.existsSync(mark)) fsx.writeFileSync(mark, JSON.stringify({ app: 'capri', made: new Date().toISOString() }, null, 2));
  return dir;
}

// Whether the place you picked will do, and the folder made there: { ok, dir } or { ok: false, error } with
//   relative  not a place on a disk
//   inApp     in her own program folder (the uninstaller takes that with it)
//   notFolder a file is there
//   noWrite   she may not write there
function choose(picked, { appDirs = [], fsx = fs } = {}) {
  if (typeof picked !== 'string' || !path.isAbsolute(picked)) return { ok: false, error: 'relative' };
  const dir = folderFor(picked, { fsx });
  if (appDirs.some((a) => a && (path.resolve(a) === dir || inside(a, dir)))) return { ok: false, error: 'inApp' };
  try {
    if (fsx.existsSync(dir) && !fsx.statSync(dir).isDirectory()) return { ok: false, error: 'notFolder' };
    make(dir, { fsx });
  } catch {
    return { ok: false, error: 'noWrite' };
  }
  return { ok: true, dir };
}

// Is `target` somewhere under a folder that was made for her (one with the mark)? That is hers to take off, wherever
// it is, also when it is not the folder in her settings any more.
function underMark(target, { fsx = fs } = {}) {
  let at = path.dirname(path.resolve(String(target || '')));
  for (let i = 0; i < 64; i++) {
    try {
      if (fsx.existsSync(path.join(at, MARK))) return true;
    } catch { /* not readable */ }
    const up = path.dirname(at);
    if (up === at) return false;
    at = up;
  }
  return false;
}

// What the rest of her asks about it. deps: cfg(), save(patch), userData, pickDir(parent, startAt) -> a path or null
// (the dialog), openPath(dir), appDirs (where her program is), diskOf(dir) -> { free }, busy() -> whether something is
// being fetched or taken off now (the place is not changed then), leaving(oldRoot) called before the place is changed
// (what is in the folder she leaves must stay found: her main.js pins Piper, which is looked for in the current one).
function createFolder({ cfg, save, userData, pickDir, openPath, appDirs = [], diskOf, busy = () => false, leaving = () => {}, fsx = fs }) {
  const custom = () => String(cfg().dataDir || '').trim();
  const root = () => custom() || userData;
  const info = () => {
    const dir = root();
    const free = diskOf ? diskOf(dir).free : Infinity;
    return { dir, custom: Boolean(custom()), standard: userData, free: Number.isFinite(free) ? free : 0 };
  };

  function use(picked) {
    if (busy()) return { ok: false, error: 'busy' };
    if (typeof picked === 'string' && picked && path.resolve(picked) === path.resolve(userData)) return reset();
    const res = choose(picked, { appDirs, fsx });
    if (!res.ok) return res;
    if (path.resolve(res.dir) === path.resolve(userData)) return reset();
    leaving(root());
    save({ dataDir: res.dir });
    return { ok: true, ...info() };
  }

  function reset() {
    if (busy()) return { ok: false, error: 'busy' };
    leaving(root());
    save({ dataDir: '' });
    return { ok: true, ...info() };
  }

  return {
    root,
    custom: () => Boolean(custom()),
    info,
    use,
    reset,
    sub: (name) => path.join(root(), name),
    // where downloads and pip work while they are on their way: in the folder you picked (a big file does not go to the
    // system disk then); '' when nothing was picked (the system's own, as before)
    temp: () => (custom() ? path.join(custom(), TEMP) : ''),
    // the folder is there, with its mark (before something is put in it: it may have been deleted since)
    ensure() {
      if (!custom()) return;
      try {
        make(custom(), { fsx });
      } catch { /* the fetching says it, when it cannot write */ }
    },
    cleanTemp() {
      if (!custom()) return;
      try {
        fsx.rmSync(path.join(custom(), TEMP), { recursive: true, force: true });
      } catch { /* in use: the next time */ }
    },
    async choose(parent) {
      if (busy()) return { ok: false, error: 'busy' };
      const picked = await pickDir(parent, custom() ? path.dirname(custom()) : '');
      if (!picked) return { ok: false, error: 'canceled' };
      return use(picked);
    },
    open() {
      const dir = root();
      try {
        fsx.mkdirSync(dir, { recursive: true });
      } catch { /* shown as far as it exists */ }
      return openPath(dir);
    },
  };
}

module.exports = { NAME, MARK, TEMP, inside, folderFor, make, choose, underMark, createFolder };
