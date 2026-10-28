'use strict';

// What she has put on this PC, written down as she does it (installed.json in her data folder), so that she can
// take exactly that off again and nothing else (cleanup.js): the models she pulled into Ollama, whether Ollama or
// Python came from her (and how), Node.js. Folders in her own data folder need no entry: what is in there is hers.

const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['ollama', 'python', 'node']; // { how, at, ... } each, when she installed it

// `file`: the path, or a function that gives it (her data folder is known only once the app is ready)
function createInstalled({ file: fileOrFn, fsx = fs, now = () => Date.now() }) {
  const where = () => (typeof fileOrFn === 'function' ? fileOrFn() : fileOrFn);
  let data = null;

  const load = () => {
    if (data) return data;
    let raw = {};
    try {
      raw = JSON.parse(fsx.readFileSync(where(), 'utf8'));
    } catch {
      raw = {};
    }
    data = { models: Array.isArray(raw.models) ? raw.models.filter((m) => typeof m === 'string' && m) : [] };
    for (const kind of KINDS) if (raw[kind] && typeof raw[kind] === 'object') data[kind] = raw[kind];
    return data;
  };

  const save = () => {
    try {
      const file = where();
      fsx.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fsx.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fsx.renameSync(tmp, file);
    } catch {
      // a note that cannot be written is not worth stopping for: she just will not know it was hers
    }
  };

  return {
    // what is written down: { models: [...], ollama?: {...}, python?: {...}, node?: {...} }
    get: () => JSON.parse(JSON.stringify(load())),
    // she installed this: record('ollama', { how: 'winget' }), record('model', 'gemma3:4b')
    record(kind, value = {}) {
      const d = load();
      if (kind === 'model') {
        const name = String(value || '').trim();
        if (name && !d.models.includes(name)) d.models.push(name);
      } else if (KINDS.includes(kind)) {
        d[kind] = { ...value, at: now() };
      } else {
        return;
      }
      save();
    },
    // it is gone (or no longer hers to take off)
    forget(kind, value = null) {
      const d = load();
      if (kind === 'model') d.models = d.models.filter((m) => m !== value);
      else if (KINDS.includes(kind)) delete d[kind];
      else return;
      save();
    },
    clear() {
      data = { models: [] };
      try {
        fsx.rmSync(where(), { force: true });
      } catch {
        // gone already
      }
    },
    get file() {
      return where();
    },
  };
}

module.exports = { createInstalled, KINDS };
