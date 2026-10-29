'use strict';

// Moving what she fetched to the folder in use (downloads.js). You pick another place for everything she fetches, and
// what is already on the disk, hers (Ollama's zip with its models, Piper, Chatterbox with its environment and its
// model, Node.js), can go there too: one thing after the other, the programs that use it stopped meanwhile.
//
// Nothing is lost on the way. On the same disk a folder is only renamed. Otherwise it is copied beside the place
// it is going to (as `<name>.part`), looked at (does it work there?), put in its place, her settings are pointed at it,
// and only then the old one goes. "Stop", a full disk, a file that cannot be read: the copy goes and the old folder
// is where it was. What is not hers (a folder you put next to her, an Ollama of Windows' own) is not touched.
//
// And the other way round, for a folder you moved yourself (in Explorer): adopt() looks in the folder in use for what her
// settings name somewhere it is not any more.

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { inside } = require('./downloads');
const { sizeOf } = require('./cleanup');
const { findFile } = require('../setup/fetch-files');

const BIG_FILE = 32 * 1048576; // (a file this big is copied in pieces, so that the bar moves)
const SAME_SPOT = ['EXDEV', 'EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST']; // (why a rename did not do: it is copied then)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// what is moved: the folder it has in the folder in use, and the program that tells it works there
const KINDS = {
  ollama: { sub: 'ollama', exe: ['ollama.exe', 'ollama'] },
  piper: { sub: 'piper', exe: ['piper.exe', 'piper'] },
  chatterbox: { sub: 'chatterbox', exe: [] },
  node: { sub: 'node', exe: ['node.exe', 'node'] },
};
const ORDER = ['chatterbox', 'piper', 'ollama', 'node'];

// A folder with everything in it copied to `to` (made as needed). onBytes(n) as it goes; `signal` ends it (a rejection
// that is an AbortError); links stay links.
async function copyTree(from, to, { signal, onBytes = () => {}, fsx = fs } = {}) {
  const fsp = fsx.promises;
  await fsp.mkdir(to, { recursive: true });
  const queue = [''];
  while (queue.length) {
    const rel = queue.shift();
    for (const entry of await fsp.readdir(path.join(from, rel), { withFileTypes: true })) {
      signal?.throwIfAborted();
      const r = path.join(rel, entry.name);
      const src = path.join(from, r);
      const dst = path.join(to, r);
      if (entry.isDirectory()) {
        await fsp.mkdir(dst, { recursive: true });
        queue.push(r);
      } else if (entry.isSymbolicLink()) {
        try {
          await fsp.symlink(await fsp.readlink(src), dst);
        } catch {
          // (a link that cannot be made, on Windows without the right: what it points at is copied, if it is a file)
          const target = await fsp.stat(src).catch(() => null);
          if (target?.isFile()) await fsp.copyFile(src, dst);
        }
      } else if (entry.isFile()) {
        const { size, mode } = await fsp.stat(src);
        if (size < BIG_FILE) {
          await fsp.copyFile(src, dst);
          onBytes(size);
        } else {
          const read = fsx.createReadStream(src);
          read.on('data', (chunk) => onBytes(chunk.length));
          await pipeline(read, fsx.createWriteStream(dst, { mode }), { signal });
        }
      }
    }
  }
}

const rootOf = (p) => path.parse(path.resolve(p)).root.toLowerCase();

class Relocate extends EventEmitter {
  // deps: cleanup (Cleanup: where hers are, what is hers), folder (downloads.js createFolder: the folder in use), cfg(),
  //       save(patch), installed (installed.js), stop() (ends her programs: Ollama, Chatterbox, Piper, so that they let go
  //       of their files), nodeTools { addToUserPath, removeFromUserPath }, tools { findPython, hasChatterbox } (does the
  //       Python environment work where it is now), diskOf(dir) -> { free }, busy() -> '' or what else is going on
  //       ('preparing': something is being fetched; 'removing': something is being taken off), sameDisk(a, b) (a folder is
  //       only renamed there, and takes no room),
  //       after() (once it is over: her programs are started again), platform, fsx, settle (ms for the programs to let go)
  constructor(deps) {
    super();
    this.d = { fsx: fs, platform: process.platform, settle: 700, stop: () => {}, after: () => {}, busy: () => '', sameDisk: (a, b) => rootOf(a) === rootOf(b), ...deps };
    this.running = false;
    this.cancelled = false;
    this.finished = false;
    this.abort = null;
    this.job = null;
    this.now = { kind: '', index: 0, count: 0, done: 0, total: 0 };
    this.result = { moved: [], failed: [], left: [], skipped: [] };
    this.lastEmit = 0;
  }

  get busy() {
    return this.running;
  }

  snapshot() {
    return {
      running: this.running, stopping: this.running && this.cancelled, cancelled: this.cancelled, finished: this.finished,
      ok: this.finished && !this.cancelled && this.result.failed.length === 0, ...this.now, ...this.result,
    };
  }

  update(patch, { force = true } = {}) {
    Object.assign(this.now, patch);
    if (!force && Date.now() - this.lastEmit < 150) return; // (a bar going: not more than a few times a second)
    this.lastEmit = Date.now();
    this.emit('change', this.snapshot());
  }

  // ---- what there is to move ----

  // [{ kind, from, to }]: hers, and not in the folder in use. Cheap (no sizes): for showing the button.
  places() {
    const { cleanup, folder, fsx } = this.d;
    const found = [];
    const ol = cleanup.ollamaPlace();
    if (ol?.ours && ol.how === 'zip') found.push({ kind: 'ollama', from: ol.dir });
    const pi = cleanup.piperPlace();
    if (pi?.ours) found.push({ kind: 'piper', from: pi.dir });
    const cb = cleanup.chatterboxPlace();
    if (cb?.ours) found.push({ kind: 'chatterbox', from: cb.dir });
    const nd = cleanup.nodePlace();
    const nodeBase = nd?.ours && this.nodeBase(nd.dir);
    if (nodeBase) found.push({ kind: 'node', from: nodeBase });
    return found
      .map((f) => ({ ...f, to: folder.sub(KINDS[f.kind].sub) }))
      .filter((f) => {
        const from = path.resolve(f.from);
        const to = path.resolve(f.to);
        return from !== to && !inside(from, to) && !inside(to, from) && fsx.existsSync(from);
      })
      .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  }

  // her Node.js lives in a folder called "node" (the program is a level down in it, and her notes may name that one)
  nodeBase(dir) {
    for (let d = path.resolve(dir), i = 0; i < 4; i++, d = path.dirname(d)) {
      if (path.basename(d).toLowerCase() === 'node') return this.d.cleanup.mine(d) ? d : '';
    }
    return '';
  }

  candidates() {
    return this.places().map(({ kind }) => kind);
  }

  // The same with sizes, the room on the disk it goes to, and what cannot go (something is lying in its place already).
  async plan() {
    const { folder, diskOf, fsx } = this.d;
    const items = [];
    const conflicts = [];
    for (const place of this.places()) {
      const { bytes, partial } = await sizeOf(place.from, { fsp: fsx.promises });
      const sameDisk = this.d.sameDisk(place.from, place.to);
      const taken = this.taken(place.to);
      (taken ? conflicts : items).push({ ...place, bytes, partial, sameDisk });
    }
    const need = items.filter((i) => !i.sameDisk).reduce((n, i) => n + i.bytes, 0);
    const free = diskOf ? diskOf(folder.root()).free : Infinity;
    return {
      items, conflicts, bytes: items.reduce((n, i) => n + i.bytes, 0), need: Math.round(need * 1.05),
      free: Number.isFinite(free) ? free : 0, enough: !Number.isFinite(free) || free >= need * 1.05,
    };
  }

  // is something lying in the place a folder is going to? (an empty folder is no hindrance)
  taken(to) {
    try {
      return this.d.fsx.readdirSync(to).length > 0;
    } catch {
      return false;
    }
  }

  // ---- the move ----

  // Begins; resolves { ok: true } at once (how it goes is told by 'change'), or { ok: false, error }.
  async start() {
    if (this.running) return { ok: false, error: 'busy' };
    const why = this.d.busy(); // ('preparing', 'removing': something else is going on)
    if (why) return { ok: false, error: why === true ? 'busy' : why };
    const plan = await this.plan();
    if (!plan.items.length) return { ok: false, error: plan.conflicts.length ? 'taken' : 'nothing' };
    if (!plan.enough) return { ok: false, error: 'space', need: plan.need, free: plan.free };
    this.running = true;
    this.cancelled = false;
    this.finished = false;
    this.abort = new AbortController();
    this.result = { moved: [], failed: [], left: [], skipped: plan.conflicts.map((c) => c.kind) };
    this.now = { kind: '', index: 0, count: plan.items.length, done: 0, total: plan.bytes };
    this.job = this.go(plan.items).finally(() => { this.job = null; });
    this.update({});
    return { ok: true };
  }

  cancel() {
    if (!this.running || this.cancelled) return;
    this.cancelled = true;
    this.abort?.abort();
    this.update({}); // ("Stopping…" at once)
  }

  async go(items) {
    const { cleanup } = this.d;
    const roots = new Set();
    try {
      this.d.stop(); // (they let go of their files: Ollama, Chatterbox, Piper)
      await wait(this.d.settle);
      let before = 0;
      for (const [index, item] of items.entries()) {
        if (this.cancelled) break;
        this.update({ kind: item.kind, index: index + 1, done: before });
        roots.add(path.dirname(item.from));
        try {
          const how = await this.moveOne(item, (bytes) => this.update({ done: before + Math.min(bytes, item.bytes) }, { force: false }));
          if (how.left) this.result.left.push(how.left);
          this.result.moved.push(item.kind);
        } catch (err) {
          if (!this.cancelled) this.result.failed.push({ kind: item.kind, error: String(err.message || err).slice(0, 200) });
        }
        before += item.bytes;
      }
      // (the folders she left, when nothing but her mark is in them: they go)
      for (const root of roots) cleanup.removeEmptyRoot(root);
    } finally {
      this.running = false;
      this.finished = true;
      this.update({ done: this.now.total });
      try {
        this.d.after();
      } catch (err) {
        console.error('[capri] after the move:', err.message);
      }
    }
  }

  // One folder to its place. Resolves { how, left? } (left: the old folder, when it could not be removed whole); throws
  // with why it did not go (everything is as it was then).
  async moveOne({ kind, from, to, bytes }, onBytes) {
    const { fsx, cleanup, folder } = this.d;
    if (!cleanup.mine(from) || !inside(folder.root(), to)) throw new Error('not hers to move');
    const part = `${to}.part`;
    const before = this.lookAt(kind, from); // (what it was, to be sure it is the same after)
    fsx.rmSync(part, { recursive: true, force: true }); // (what an earlier try left)
    try {
      if (fsx.existsSync(to)) fsx.rmdirSync(to); // (an empty one: only the folder itself)
    } catch {
      throw new Error('something is lying in the new place already');
    }
    fsx.mkdirSync(path.dirname(to), { recursive: true });
    let how = 'rename';
    try {
      fsx.renameSync(from, to);
    } catch (err) {
      if (!SAME_SPOT.includes(err.code)) throw err;
      how = 'copy';
    }
    if (how === 'copy') {
      let copied = 0;
      try {
        await copyTree(from, part, { signal: this.abort.signal, fsx, onBytes: (n) => { copied += n; onBytes(copied); } });
        fsx.renameSync(part, to);
      } catch (err) {
        fsx.rmSync(part, { recursive: true, force: true });
        if (this.abort.signal.aborted) throw Object.assign(new Error('stopped'), { cancelled: true });
        throw err;
      }
    } else {
      onBytes(bytes);
    }
    // does it work there? if not, it is put back (the old one is still there, or is renamed back)
    if (!this.works(kind, to, before)) {
      if (how === 'rename') fsx.renameSync(to, from);
      else fsx.rmSync(to, { recursive: true, force: true });
      throw new Error('it did not work in the new place, left where it was');
    }
    this.point(kind, to, from);
    if (how === 'rename') return { how };
    try {
      await this.removeOld(from);
    } catch {
      return { how, left: from };
    }
    return { how };
  }

  async removeOld(dir) {
    if (!this.d.cleanup.mine(dir)) throw new Error('not hers to remove');
    await this.d.fsx.promises.rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 });
  }

  // What a folder is before it goes: for Chatterbox, whether it has a Python environment and the package in it.
  lookAt(kind, dir) {
    const { tools } = this.d;
    if (kind !== 'chatterbox' || !tools?.findPython) return {};
    const python = tools.findPython(dir);
    return { python: Boolean(python), package: Boolean(python && tools.hasChatterbox?.(python)) };
  }

  // Does what was moved work in its new place: its program is there, and a Python environment is still one, with the
  // package in it if it had it (a venv is moved with its files: its python.exe finds its folder by itself).
  works(kind, dir, before = {}) {
    const { fsx, tools } = this.d;
    const exe = KINDS[kind].exe;
    if (exe.length && !findFile(dir, exe, { depth: 2, fsx })) return false;
    if (kind === 'chatterbox' && before.python) {
      const python = tools?.findPython?.(dir);
      if (!python) return false;
      if (before.package && tools.hasChatterbox && !tools.hasChatterbox(python)) return false;
    }
    return true;
  }

  // her settings and notes pointed at the new place
  point(kind, to, from) {
    const { save, installed, folder, nodeTools, fsx } = this.d;
    if (kind === 'ollama') {
      save({ ollamaDir: to });
      installed?.record('ollama', { how: 'zip', dir: to });
    } else if (kind === 'piper') {
      save({ piperDir: path.resolve(to) === path.resolve(folder.sub('piper')) ? '' : to });
    } else if (kind === 'chatterbox') {
      save({ chatterboxDir: to });
    } else if (kind === 'node') {
      nodeTools?.removeFromUserPath?.(from);
      const exe = findFile(to, KINDS.node.exe, { depth: 2, fsx });
      const dir = exe ? path.dirname(exe) : to;
      const onPath = nodeTools?.addToUserPath?.(dir) || { ok: false };
      installed?.record('node', { dir, onPath: onPath.ok });
    }
  }

  // ---- a folder moved by hand ----

  // Her settings name Ollama's, Piper's or Chatterbox's folder where there is nothing any more, and the folder in use has
  // one: that is where it was moved to. Returns the kinds taken up again.
  adopt() {
    const { cfg, save, folder, fsx } = this.d;
    const c = cfg();
    const patch = {};
    const found = [];
    for (const [kind, key] of [['ollama', 'ollamaDir'], ['piper', 'piperDir'], ['chatterbox', 'chatterboxDir']]) {
      const named = String(c[key] || '').trim();
      const here = folder.sub(KINDS[kind].sub);
      if (!named || fsx.existsSync(named) || path.resolve(named) === path.resolve(here)) continue;
      const exe = KINDS[kind].exe;
      const there = kind === 'chatterbox' ? this.taken(here) : Boolean(exe.length && findFile(here, exe, { depth: 2, fsx }));
      if (!there) continue;
      patch[key] = kind === 'piper' ? '' : here;
      found.push(kind);
    }
    if (found.length) save(patch);
    return found;
  }
}

module.exports = { Relocate, copyTree, KINDS };
