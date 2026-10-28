'use strict';

// Taking off what she put on this PC. A list of it with what each takes on the disk, one at a time (a model, her
// voice, Ollama...), or all of it, so that the room it took is free again. She only touches what is hers:
//
// - what lies in her own data folder (the Piper and Chatterbox folders, her Node.js, a zipped Ollama) is hers;
// - what she installed in the usual way (Ollama, Python), and the models she pulled into Ollama, she wrote down at
//   the time (installed.js): those she takes off;
// - a folder you put next to her, an Ollama you installed yourself, models you pulled: not hers. They are shown
//   (so you can see where the room went) but she leaves them alone; one model at a time can be taken off on your say.
//
// Nothing is fetched again behind your back after: what is taken off is also switched off in her settings.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const OLLAMA_ID = 'Ollama.Ollama';
const PYTHON_ID = 'Python.Python.3.11';

// is `child` somewhere under `parent`? (never `parent` itself)
function inside(parent, child) {
  if (!parent || !child) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// How many bytes a folder (or a file) takes, counted without blocking her for long: it stops counting after
// `budgetMs` and says so ({ bytes, partial }).
async function sizeOf(target, { fsp = fs.promises, budgetMs = 6000, skip = [] } = {}) {
  const until = Date.now() + budgetMs;
  const skipped = new Set(skip.map((p) => path.resolve(p)));
  let bytes = 0;
  let partial = false;
  const queue = [target];
  while (queue.length) {
    if (Date.now() > until) {
      partial = true;
      break;
    }
    const batch = queue.splice(0, 16);
    await Promise.all(batch.map(async (p) => {
      let st;
      try {
        st = await fsp.lstat(p);
      } catch {
        return;
      }
      if (st.isDirectory()) {
        if (skipped.has(path.resolve(p))) return; // (counted on its own)
        let names = [];
        try {
          names = await fsp.readdir(p);
        } catch {
          return;
        }
        for (const n of names) queue.push(path.join(p, n));
      } else {
        bytes += st.size;
      }
    }));
  }
  return { bytes, partial };
}

const SEEN_MS = 30 * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Cleanup {
  // deps: userData (her data folder), home (the user's home folder), cfg(), save(patch), installed (installed.js),
  //       ollamaApi { list(), remove(name) }, ollamaHost, chatterbox, piper, nodeTools { removeFromUserPath },
  //       provision (to see whether something is being fetched), onModelsChanged(), run(cmd, args) -> { ok, code },
  //       platform, env, fsx, settle (ms to let a stopped program let go of its files)
  constructor(deps) {
    this.d = { platform: process.platform, env: process.env, fsx: fs, fsp: fs.promises, home: os.homedir(), settle: 700, run: runProgram, onModelsChanged: async () => {}, ...deps };
    this.busy = false;
    this.seen = null; // the last list and when it was made: counting a Python environment takes a moment
  }

  // ---------- what is there ----------

  hf() {
    const { env, home } = this.d;
    return env.HUGGINGFACE_HUB_CACHE || path.join(env.HF_HOME || path.join(home, '.cache', 'huggingface'), 'hub');
  }

  // Chatterbox's model, kept in the default cache of the model hub by an older Capri: the entries of Resemble AI's.
  // Hers only for a folder of hers that has no cache of its own (a newer one keeps the model inside it).
  legacyCache(dir = '') {
    if (!dir || this.d.fsx.existsSync(path.join(dir, 'huggingface'))) return [];
    const hub = this.hf();
    let names = [];
    try {
      names = this.d.fsx.readdirSync(hub);
    } catch {
      return [];
    }
    return names.filter((n) => /^models--ResembleAI--/i.test(n)).map((n) => path.join(hub, n));
  }

  ollamaPlace() {
    const cfg = this.d.cfg();
    const man = this.d.installed.get();
    const { userData, fsx, platform, env, home } = this.d;
    const named = String(cfg.ollamaDir || '').trim();
    if (named && inside(userData, named) && fsx.existsSync(named)) return { dir: named, ours: true, how: 'zip' };
    if (man.ollama && (man.ollama.how === 'winget' || man.ollama.how === 'installer') && platform === 'win32') {
      const dir = path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Ollama');
      if (fsx.existsSync(dir)) return { dir, ours: true, how: man.ollama.how };
    }
    const found = this.d.ollamaHost?.status?.().dir;
    return found && fsx.existsSync(found) ? { dir: found, ours: false, how: '' } : null;
  }

  // Does the Ollama in her folder keep its models there too? Then all of them are hers and go with it.
  modelsInHerFolder(place = this.ollamaPlace()) {
    return Boolean(place?.ours && place.how === 'zip' && inside(this.d.userData, this.d.ollamaHost?.status?.().modelsDir || ''));
  }

  piperPlace() {
    const { userData, fsx } = this.d;
    const dir = this.d.piper?.defaultDir?.();
    if (dir && inside(userData, dir) && fsx.existsSync(dir)) return { dir, ours: true };
    const named = String(this.d.cfg().piperDir || '').trim();
    return named && fsx.existsSync(named) ? { dir: named, ours: false } : null;
  }

  chatterboxPlace() {
    const { userData, fsx } = this.d;
    const named = String(this.d.cfg().chatterboxDir || '').trim();
    if (!named || !fsx.existsSync(named)) return null;
    return { dir: named, ours: inside(userData, named) };
  }

  nodePlace() {
    const { userData, fsx } = this.d;
    const man = this.d.installed.get();
    const dir = path.join(userData, 'node');
    if (fsx.existsSync(dir)) return { dir, ours: true };
    if (man.node?.dir && inside(userData, man.node.dir) && fsx.existsSync(man.node.dir)) return { dir: man.node.dir, ours: true };
    return null;
  }

  // The list: [{ id, group, label, bytes, ours, removable, how?, path? }] and what the ones that are hers take.
  // One made a moment ago is reused (a removal needs only to know what is there), unless `fresh`.
  async inventory({ fresh = false } = {}) {
    if (!fresh && this.seen && Date.now() - this.seen.at < SEEN_MS) return this.seen.list;
    const list = await this.count();
    this.seen = { at: Date.now(), list };
    return list;
  }

  async count() {
    const items = [];
    const man = this.d.installed.get();
    let ollamaUp = true;
    let models = [];
    try {
      models = await this.d.ollamaApi.list();
    } catch {
      ollamaUp = false;
    }
    const ol = this.ollamaPlace();
    const inHers = this.modelsInHerFolder(ol);
    for (const m of models) {
      items.push({ id: `model:${m.name}`, group: 'mind', kind: 'model', label: m.name, bytes: m.size, ours: inHers || man.models.includes(m.name), removable: true });
    }
    const sized = async (place, base, opts = {}) => {
      const { bytes, partial } = await sizeOf(place.dir, { fsp: this.d.fsp, ...opts });
      return { ...base, bytes, partial, ours: place.ours, removable: place.ours, path: place.dir };
    };
    // (the program without its models when those are counted one by one above)
    if (ol) items.push(await sized(ol, { id: 'ollama', group: 'mind', kind: 'ollama', label: 'Ollama', how: ol.how }, { skip: inHers ? [path.join(ol.dir, 'models')] : [] }));
    const pi = this.piperPlace();
    if (pi) items.push(await sized(pi, { id: 'piper', group: 'voice', kind: 'piper', label: 'Piper' }));
    const cb = this.chatterboxPlace();
    if (cb) {
      const item = await sized(cb, { id: 'chatterbox', group: 'voice', kind: 'chatterbox', label: 'Chatterbox' });
      if (cb.ours) {
        for (const extra of this.legacyCache(cb.dir)) item.bytes += (await sizeOf(extra, { fsp: this.d.fsp })).bytes;
      }
      items.push(item);
    }
    const nd = this.nodePlace();
    if (nd) items.push(await sized(nd, { id: 'node', group: 'tools', kind: 'node', label: 'Node.js' }));
    if (man.python) items.push({ id: 'python', group: 'tools', kind: 'python', label: 'Python', bytes: 0, ours: true, removable: true });
    const mine = items.filter((i) => i.ours && i.removable);
    return { items, ollamaUp, total: mine.reduce((n, i) => n + i.bytes, 0), count: mine.length };
  }

  // ---------- taking it off ----------

  // a folder of hers: gone, with what is in it (never anything outside her data folder)
  async removeDir(dir) {
    if (!inside(this.d.userData, dir)) throw new Error(`not hers to remove: ${dir}`);
    await wait(this.d.settle); // (what was stopped lets go of its files)
    try {
      this.d.fsx.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 400 });
    } catch (err) {
      throw new Error(`could not remove ${dir}: ${err.code === 'EBUSY' || err.code === 'EPERM' ? 'a file is in use' : err.message}`);
    }
  }

  async ensureOllama() {
    if (await this.d.ollamaHost.versionFn?.()) return true;
    try {
      await this.d.ollamaHost.ready(this.d.cfg(), 40000);
      return true;
    } catch {
      return false;
    }
  }

  // her settings after a model is gone: another model if there is one, else no mind to fetch again
  async afterModels(removed) {
    const cfg = this.d.cfg();
    let left = [];
    try {
      left = await this.d.ollamaApi.list();
    } catch {
      left = null;
    }
    const patch = {};
    if (String(cfg.wantModel || '') === removed) patch.wantModel = '';
    if (left) {
      if (cfg.chatModel === removed) patch.chatModel = left[0]?.name || '';
      if (!left.length && (cfg.provider || 'ollama') === 'ollama') patch.autoMind = false; // (nothing fetched again behind your back)
    }
    if (Object.keys(patch).length) this.d.save(patch);
    await this.d.onModelsChanged();
  }

  async removeModel(name) {
    if (!(await this.ensureOllama())) throw new Error('Ollama is not running');
    await this.d.ollamaApi.remove(name);
    this.d.installed.forget('model', name);
    await this.afterModels(name);
  }

  async removePiper() {
    const place = this.piperPlace();
    this.d.piper?.stop?.();
    if (place?.ours) await this.removeDir(place.dir);
    const cfg = this.d.cfg();
    const patch = { piperDir: '' };
    if (cfg.ttsEngine === 'piper') Object.assign(patch, { ttsEngine: 'system', provisioned: true });
    this.d.save(patch);
  }

  async removeChatterbox() {
    const place = this.chatterboxPlace();
    this.d.chatterbox?.stop?.();
    if (place?.ours) {
      const older = this.legacyCache(place.dir); // (looked at before the folder goes)
      await this.removeDir(place.dir);
      for (const extra of older) {
        try {
          this.d.fsx.rmSync(extra, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
        } catch {
          // the model hub's cache: if it is in use, it stays
        }
      }
    }
    const cfg = this.d.cfg();
    const patch = { chatterboxDir: '', chatterboxAuto: false };
    if (cfg.ttsEngine === 'chatterbox') Object.assign(patch, { ttsEngine: 'system', provisioned: true });
    this.d.save(patch);
  }

  async removeNode() {
    const place = this.nodePlace();
    if (!place?.ours) return;
    this.d.nodeTools.removeFromUserPath?.(place.dir); // (and every PATH entry inside it: the folder with node.exe is a level down)
    await this.removeDir(place.dir);
    this.d.installed.forget('node');
    this.d.save({ autoNode: false });
  }

  async removePython() {
    const res = await this.d.run('winget', ['uninstall', '--id', PYTHON_ID, '--exact', '--silent', '--disable-interactivity']);
    if (!res.ok) throw new Error('Python could not be uninstalled (winget): remove it in Windows settings › Apps');
    this.d.installed.forget('python');
  }

  // Ollama: her models first (they go through Ollama), then the program, the way it came
  async removeOllama() {
    const place = this.ollamaPlace();
    if (!place?.ours) return;
    const mine = new Set(this.d.installed.get().models);
    if (this.modelsInHerFolder(place)) {
      try {
        for (const m of await this.d.ollamaApi.list()) mine.add(m.name); // (all of them live in her folder)
      } catch {
        // not answering: the folder goes with them
      }
    }
    for (const name of mine) {
      try {
        await this.removeModel(name);
      } catch {
        break; // (Ollama will not answer: the program goes, and the models with it, if they are in her folder)
      }
    }
    this.d.ollamaHost.stop?.();
    if (this.d.platform === 'win32') {
      // its tray app and the program it started
      await this.d.run('taskkill', ['/F', '/T', '/IM', 'ollama app.exe']);
      await this.d.run('taskkill', ['/F', '/T', '/IM', 'ollama.exe']);
    }
    if (place.how === 'zip') {
      await this.removeDir(place.dir);
    } else {
      const own = path.join(place.dir, 'unins000.exe');
      let res = { ok: false };
      if (this.d.fsx.existsSync(own)) res = await this.d.run(own, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES']);
      if (!res.ok) res = await this.d.run('winget', ['uninstall', '--id', OLLAMA_ID, '--exact', '--silent', '--disable-interactivity']);
      if (!res.ok) throw new Error('Ollama could not be uninstalled: remove it in Windows settings › Apps');
    }
    this.d.installed.forget('ollama');
    this.d.save({ ollamaDir: '', autoMind: false });
    await this.d.onModelsChanged();
  }

  // Takes one listed thing off, the way its kind goes
  async removeItem(item) {
    if (item.kind === 'model') await this.removeModel(item.label);
    else if (item.kind === 'piper') await this.removePiper();
    else if (item.kind === 'chatterbox') await this.removeChatterbox();
    else if (item.kind === 'node') await this.removeNode();
    else if (item.kind === 'python') await this.removePython();
    else if (item.kind === 'ollama') await this.removeOllama();
  }

  // One thing off. Resolves { ok, id, freed, error? }
  async remove(id) {
    if (this.busy) return { ok: false, id, error: 'busy' };
    if (this.d.provision?.running) return { ok: false, id, error: 'preparing' };
    this.busy = true;
    try {
      const list = await this.inventory();
      const item = list.items.find((i) => i.id === id);
      if (!item) return { ok: false, id, error: 'missing' };
      if (!item.removable || (!item.ours && item.kind !== 'model')) return { ok: false, id, error: 'not hers' };
      await this.removeItem(item);
      return { ok: true, id, freed: item.bytes };
    } catch (err) {
      return { ok: false, id, error: String(err.message || err).slice(0, 300) };
    } finally {
      this.seen = null; // (what is there has changed)
      this.busy = false;
    }
  }

  // Everything that is hers, in an order that works (what needs Python or Ollama before them). Models she did not
  // pull and folders you put next to her stay. Resolves { ok, freed, removed: [id], failed: [{ id, error }], left }
  async removeAll() {
    if (this.busy) return { ok: false, freed: 0, removed: [], failed: [], error: 'busy' };
    if (this.d.provision?.running) return { ok: false, freed: 0, removed: [], failed: [], error: 'preparing' };
    this.busy = true;
    const removed = [];
    const failed = [];
    let freed = 0;
    try {
      // (the models she pulled go through Ollama: it is woken up if it is not answering)
      if (this.d.installed.get().models.length) await this.ensureOllama();
      const { items } = await this.inventory();
      const order = ['chatterbox', 'piper', 'model', 'ollama', 'node', 'python'];
      const hers = items.filter((i) => i.ours && i.removable).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      for (const item of hers) {
        try {
          await this.removeItem(item);
          removed.push(item.id);
          freed += item.bytes;
        } catch (err) {
          failed.push({ id: item.id, error: String(err.message || err).slice(0, 300) });
        }
      }
      return { ok: failed.length === 0, freed, removed, failed, left: items.filter((i) => !i.ours).map((i) => i.id) };
    } finally {
      this.seen = null;
      this.busy = false;
    }
  }
}

// Runs a program and says whether it went well (nothing shown, no input): { ok, code }
function runProgram(cmd, args, { spawn = cp.spawn, timeout = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    const timer = setTimeout(() => child.kill?.(), timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code });
    });
  });
}

module.exports = { Cleanup, sizeOf, inside, runProgram, OLLAMA_ID, PYTHON_ID };
