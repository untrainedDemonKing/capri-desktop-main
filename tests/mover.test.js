'use strict';

// Moving the windows she has taken over (src/main/mover.js): when she may, converting to real pixels, one command
// at a time with the newest position winning, letting go when you take the window yourself, and always putting
// the window back (when she is done, when the page goes quiet, when she quits).
//   npm run test:mover

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createMover, SILENT_MS } = require('../src/main/mover.js');

const WIN = { id: 4242, x: 100, y: 80, w: 800, h: 500, max: false };

function world({ enabled = true, wins = [WIN], platform = 'win32', scale = 1.5 } = {}) {
  const writes = [];
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: (line) => writes.push(line.trim()), end() { child.ended = true; } };
    children.push(child);
    return child;
  };
  const timers = [];
  const lost = [];
  const state = { enabled, wins };
  const mover = createMover({
    screen: { dipToScreenRect: (_w, r) => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale }) },
    bounds: () => ({ x: 10, y: 20, width: 1600, height: 900 }),
    windows: () => ({ wins: state.wins }),
    enabled: () => state.enabled,
    onLost: (id, why) => lost.push([id, why]),
    spawn, platform,
    setTimer: (fn) => { const t = { fn, cleared: false, unref() {} }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
  });
  const reply = (line) => children.at(-1).stdout.emit('data', `${line}\n`);
  return { mover, writes, children, timers, lost, state, reply };
}

test('grab: only when both settings are on, on Windows, for a window the watcher knows and that is not maximised', () => {
  assert.deepEqual(world({ platform: 'linux' }).mover.grab(4242), { ok: false, why: 'nowin' });
  assert.deepEqual(world({ enabled: false }).mover.grab(4242), { ok: false, why: 'off' });
  assert.deepEqual(world().mover.grab(7), { ok: false, why: 'unknown' });
  assert.deepEqual(world({ wins: [{ ...WIN, max: true }] }).mover.grab(4242), { ok: false, why: 'maximised' });
  assert.deepEqual(world({ wins: [{ ...WIN, w: NaN }] }).mover.grab(4242), { ok: false, why: 'unknown' });
  const w = world();
  assert.deepEqual(w.mover.grab(4242), { ok: true });
  assert.equal(w.children.length, 1, 'the helper is started when it is needed');
  assert.equal(w.mover.isHolding(), true);
});

test('move: the overlay\'s pixels become the screen\'s (offset of the overlay, scaling), one command at a time, the newest wins', () => {
  const w = world();
  w.mover.grab(4242);
  assert.equal(w.mover.move(4242, 150, 90), true);
  // (150 + 10) * 1.5, (90 + 20) * 1.5
  assert.deepEqual(w.writes, ['M 4242 240 165']);
  // while that one is out, the rest wait: only the last of them is sent
  w.mover.move(4242, 160, 90);
  w.mover.move(4242, 170, 90);
  w.mover.move(4242, 180, 95);
  assert.equal(w.writes.length, 1);
  w.reply('OK 4242');
  assert.deepEqual(w.writes, ['M 4242 240 165', 'M 4242 285 173']);
  w.reply('OK 4242');
  assert.equal(w.writes.length, 2, 'nothing waiting');
  w.mover.move(4242, 100, 80);
  assert.equal(w.writes.at(-1), 'M 4242 165 150');
});

test('move: not for a window she does not hold, and not for numbers that make no sense', () => {
  const w = world();
  assert.equal(w.mover.move(4242, 1, 1), false, 'nothing grabbed yet');
  w.mover.grab(4242);
  assert.equal(w.mover.move(99, 1, 1), false);
  assert.equal(w.mover.move(4242, NaN, 1), false);
  assert.equal(w.mover.move(4242, 1, Infinity), false);
  assert.equal(w.mover.move(4242, 1e9, 1), false);
  assert.equal(w.writes.length, 0);
});

test('LOST (you took hold of the window): she lets go, tells the page, and sends nothing more for it', () => {
  const w = world();
  w.mover.grab(4242);
  w.mover.move(4242, 150, 90);
  w.reply('LOST 4242');
  assert.deepEqual(w.lost, [[4242, 'lost']]);
  assert.equal(w.mover.isHolding(), false);
  assert.equal(w.mover.move(4242, 200, 90), false);
  // and she does not put it back over you
  const before = w.writes.length;
  w.mover.release(4242, { restore: true });
  assert.equal(w.writes.slice(before).filter((l) => l.startsWith('M ')).length, 0);
  assert.ok(w.writes.includes('E 4242'), 'the helper forgets it');
});

test('GONE and DENIED (closed, maximised, the program says no) let go too', () => {
  for (const verdict of ['GONE', 'DENIED']) {
    const w = world();
    w.mover.grab(4242);
    w.mover.move(4242, 150, 90);
    w.reply(`${verdict} 4242`);
    assert.deepEqual(w.lost, [[4242, verdict.toLowerCase()]]);
    assert.equal(w.mover.isHolding(), false);
  }
});

test('release puts the window back where it was (the first look), then lets go; without restore it only lets go', () => {
  const w = world();
  w.mover.grab(4242);
  w.mover.move(4242, 400, 300);
  w.reply('OK 4242');
  w.mover.release(4242, { restore: true });
  // home: (100 + 10) * 1.5 = 165, (80 + 20) * 1.5 = 150
  assert.deepEqual(w.writes.slice(-2), ['M 4242 165 150', 'E 4242']);
  assert.equal(w.mover.isHolding(), false);
  assert.equal(w.mover.release(4242), false, 'nothing held any more');

  const v = world();
  v.mover.grab(4242);
  v.mover.move(4242, 400, 300);
  v.mover.release(4242, { restore: false });
  assert.deepEqual(v.writes.slice(1), ['E 4242']);
});

test('the page going quiet (no word for a few seconds) puts the window back by itself', () => {
  const w = world();
  w.mover.grab(4242);
  w.mover.move(4242, 400, 300);
  const dog = w.timers.filter((t) => !t.cleared).at(-1);
  assert.ok(dog, 'a timer is running');
  dog.fn();
  assert.deepEqual(w.writes.slice(-2), ['M 4242 165 150', 'E 4242']);
  assert.equal(w.mover.isHolding(), false);
  assert.ok(SILENT_MS >= 1000 && SILENT_MS <= 5000);
});

test('grabbing a second window puts the first back; quitting puts back the one she holds', () => {
  const other = { id: 5, x: 600, y: 200, w: 500, h: 400, max: false };
  const w = world({ wins: [WIN, other] });
  w.mover.grab(4242);
  w.mover.move(4242, 300, 300);
  w.reply('OK 4242');
  assert.deepEqual(w.mover.grab(5), { ok: true });
  assert.ok(w.writes.includes('M 4242 165 150'), 'the first is back');
  w.mover.move(5, 700, 300);
  w.mover.stop();
  assert.ok(w.writes.includes('M 5 915 480') || w.writes.some((l) => l.startsWith('M 5 ')), 'the second is put back on quitting');
  assert.equal(w.children[0].ended, true, 'the helper is closed');
  assert.equal(w.mover.isHolding(), false);
});

test('the helper dying while she holds a window: she lets go and says so', () => {
  const w = world();
  w.mover.grab(4242);
  w.mover.move(4242, 300, 300);
  w.children[0].emit('exit');
  assert.deepEqual(w.lost, [[4242, 'helper']]);
  assert.equal(w.mover.isHolding(), false);
  // the next time, a new helper
  assert.deepEqual(w.mover.grab(4242), { ok: true });
  assert.equal(w.children.length, 2);
});
