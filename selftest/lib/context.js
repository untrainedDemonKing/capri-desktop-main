'use strict';

// What the parts of the check share: where the results go, the log, the list of findings, the console.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const TAGS = { pass: ' OK ', fail: 'ОШИБКА', warn: ' ! ', skip: ' -- ', info: ' i ' };

// the folder with the program's own files (src, tests, package.json): source/ inside the check's folder, or next to it (the folder that
// is sent out has both side by side), or the project itself when the check is run from its selftest/ folder
function findSource(kit) {
  for (const dir of [path.join(kit, 'source'), path.resolve(kit, '..', 'source'), path.resolve(kit, '..')]) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src', 'main', 'main.js'))) return dir;
  }
  return '';
}

function createContext(opts, kit) {
  const started = new Date();
  const stamp = stampOf(started);
  let out = opts.out ? path.resolve(opts.out) : path.join(kit, 'results', `check-${stamp}`);
  try {
    fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
    fs.accessSync(out, fs.constants.W_OK);
  } catch {
    out = path.join(os.tmpdir(), `capri-check-${stamp}`);
    fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
  }
  const logPath = path.join(out, 'logs', 'run.log');
  const results = [];
  const facts = {};
  let counter = 0;

  const ctx = {
    opts, kit, out, stamp, started, results, facts,
    source: findSource(kit),
    runtime: { exe: process.execPath, node: process.versions.node, electron: process.versions.electron || '', viaCapri: Boolean(process.versions.electron) },
    wants: (part) => !opts.skip.has(part),
    full: opts.mode === 'full',

    // a line to the screen and to the log
    say(text = '') {
      process.stdout.write(`${text}\n`);
      fs.appendFileSync(logPath, `${text}\n`);
    },
    // a line to the log only
    note(text) {
      fs.appendFileSync(logPath, `${text}\n`);
    },
    // a file in the results (text or bytes); gives its path relative to the results
    write(rel, data) {
      const file = path.join(out, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
      return rel.split(path.sep).join('/');
    },
    path: (rel) => path.join(out, rel),

    // one finding: status 'pass' | 'fail' | 'warn' | 'skip' | 'info'; `detail` is a sentence or two for a person; `log` a file in the results
    add(group, title, status, detail = '', extra = {}) {
      const r = { n: ++counter, group, title, status, detail: String(detail || ''), ...extra };
      results.push(r);
      const line = `  [${TAGS[status] || status}] ${title}${detail ? ` — ${String(detail).split('\n')[0].slice(0, 160)}` : ''}`;
      ctx.say(line);
      return r;
    },

    // a part of the check: a heading, the work, and a crash of the work (or its taking longer than `limit` minutes) is a finding rather
    // than the end of the check
    async phase(title, fn, limit = 15) {
      ctx.say('');
      ctx.say(`== ${title}`);
      const t0 = Date.now();
      let timer;
      try {
        await Promise.race([
          fn(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`не закончилось за ${limit} мин, остановлено`), { stuck: true })), limit * 60000); }),
        ]);
      } catch (err) {
        ctx.add('check', `${title}: ${err.stuck ? 'зависло' : 'сама проверка упала'}`, 'fail', String(err && err.message || err), { stack: String(err && err.stack || '') });
        ctx.note(String(err && err.stack || err));
        if (err.stuck && ctx.onAbort) {
          try {
            await ctx.onAbort();
          } catch {
            // what it was doing is left as it is
          }
        }
      } finally {
        clearTimeout(timer);
        ctx.onAbort = null;
      }
      ctx.note(`-- ${title}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    },
  };
  return ctx;
}

module.exports = { createContext, findSource, stampOf, TAGS };
