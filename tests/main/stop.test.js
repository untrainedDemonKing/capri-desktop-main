'use strict';

// "Stop" while she fetches things (src/main/setup/proc.js runToEnd, setup.js, fetch-files.js): a program that was started
// is ended at once together with what it started, nobody waits for it to close, and nothing is left running or
// said after. The steps and the window around it are in tests/main/provision.test.js.
//   node --test tests/main/stop.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { runToEnd, runPythonAsync } = require('../../src/main/setup/proc.js');
const files = require('../../src/main/setup/fetch-files.js');
const { writeZip } = require('../helpers/zip.js');

const setup = require('../helpers/setup.js')(); // (setup.js needs electron's safeStorage: a stand-in under plain node)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-stop-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const within = (ms, promise) => Promise.race([promise, new Promise((_r, reject) => setTimeout(() => reject(new Error(`still going after ${ms} ms`)), ms))]);
const gone = (child) => new Promise((resolve) => (child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve)));
// a program that prints every few ms and never ends by itself
const chatty = (holder) => (_cmd, _args, opts) => {
  holder.child = cp.spawn(process.execPath, ['-e', 'setInterval(() => console.log("Downloading torch (2.5 GB)"), 15)'], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  return holder.child;
};

test('a program run to its end: its exit says whether it went well; one that will not start says why', async () => {
  const ok = await runToEnd(process.execPath, ['-e', 'console.log("hello")'], { onData: () => {} });
  assert.deepEqual(ok, { ok: true, code: 0 });
  const bad = await runToEnd(process.execPath, ['-e', 'process.exit(3)']);
  assert.deepEqual(bad, { ok: false, code: 3 });
  const missing = await runToEnd(path.join(tmp, 'no-such-program'), []);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /ENOENT/);
});

test('a signal that fires ends the program, answers at once, and the program is not heard after', async () => {
  const holder = {};
  const ac = new AbortController();
  const heard = [];
  const run = runToEnd('x', [], { spawn: chatty(holder), signal: ac.signal, onData: (c) => heard.push(String(c)) });
  while (!heard.length) await new Promise((r) => setTimeout(r, 10));
  ac.abort();
  assert.deepEqual(await within(1000, run), { ok: false, cancelled: true });
  await within(2000, gone(holder.child));
  const n = heard.length;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(heard.length, n);
});

test('a signal that has fired already: the program is not even started', async () => {
  let started = false;
  const res = await runToEnd('x', [], { spawn: () => { started = true; }, signal: AbortSignal.abort() });
  assert.deepEqual(res, { ok: false, cancelled: true });
  assert.equal(started, false);
});

test('winget and the Python installer end with the signal, and Python goes through winget where there is no installer of its own', async () => {
  for (const run of [
    (spawnFn, signal) => setup.wingetInstall('Ollama.Ollama', () => {}, signal, { spawnFn }),
    (spawnFn, signal) => setup.installPython(() => {}, [], signal, { spawnFn }),
  ]) {
    const holder = {};
    const seen = [];
    const spawnFn = (cmd, args, opts) => {
      seen.push([cmd, args]);
      return chatty(holder)(cmd, args, opts);
    };
    const ac = new AbortController();
    const res = run(spawnFn, ac.signal);
    while (!holder.child) await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    assert.equal((await within(1000, res)).cancelled, true);
    await within(2000, gone(holder.child));
    assert.equal(seen[0][0], 'winget');
    assert.ok(seen[0][1].includes('--silent') && seen[0][1].includes('--exact'));
  }
});

test('unpacking a zip stops at the next file when the signal has fired', async () => {
  const zip = path.join(tmp, 'x.zip');
  writeZip(zip, { 'a/one.txt': 'one'.repeat(1000), 'a/two.txt': 'two' });
  const out = path.join(tmp, 'out');
  await assert.rejects(() => files.unzip(zip, out, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(fs.existsSync(path.join(out, 'a', 'one.txt')), false, 'not even the first file');
  await files.unzip(zip, path.join(tmp, 'out-ok'), { signal: new AbortController().signal });
  assert.equal(fs.readFileSync(path.join(tmp, 'out-ok', 'a', 'two.txt'), 'utf8'), 'two');
});

test('a Python asked something does not hold her up: her own work goes on meanwhile, and a Python that takes too long is ended', async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 20);
  const slow = await runPythonAsync(process.execPath, ['-e', 'setTimeout(() => console.log("late"), 300)']);
  clearInterval(timer);
  assert.deepEqual(slow, { ok: true, out: 'late' });
  assert.ok(ticks >= 5, `her event loop ran meanwhile (${ticks} ticks)`);
  const hung = Date.now();
  const cut = await runPythonAsync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 300 });
  assert.equal(cut.ok, false);
  assert.ok(Date.now() - hung < 3000, 'ended at the timeout');
  const missing = await runPythonAsync(path.join(tmp, 'no-python'), ['-c', '1']);
  assert.equal(missing.ok, false);
  assert.match(missing.out, /ENOENT/);
});
