'use strict';

// How she moves a window she has taken over (src/renderer/js/possession.js): every move starts and ends where the
// window was, never takes it off the screen, and has no jumps; the ones a window has room for are offered.
//   npm run test:possession

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

const VIEW = { w: 1600, h: 900, floor: 852 };
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

test('roomFor: the distance to each edge of the screen (the floor is the taskbar), never negative', async () => {
  const { roomFor } = await load('possession.js');
  assert.deepEqual(roomFor({ x: 100, y: 50, w: 800, h: 500 }, VIEW), { left: 100, right: 700, up: 50, down: 302 });
  // partly off the screen: no room on that side
  assert.deepEqual(roomFor({ x: -40, y: 0, w: 1700, h: 1000 }, VIEW), { left: 0, right: 0, up: 0, down: 0 });
});

test('available: nothing for a window that fills the screen; more moves with more room', async () => {
  const { available } = await load('possession.js');
  assert.deepEqual(available({ left: 10, right: 20, up: 0, down: 5 }), []);
  assert.deepEqual(available({ left: 0, right: 0, up: 0, down: 80 }), ['shake']);
  const roomy = available({ left: 300, right: 700, up: 100, down: 300 });
  for (const name of ['shake', 'sway', 'dance', 'drag', 'puck', 'bounce']) assert.ok(roomy.includes(name), name);
  // no room above: no hops
  assert.ok(!available({ left: 300, right: 700, up: 20, down: 300 }).includes('bounce'));
});

test('every move starts and ends at rest, stays inside the room, and has no jumps', async () => {
  const { make, available } = await load('possession.js');
  const rooms = [
    { left: 300, right: 700, up: 100, down: 300 },
    { left: 0, right: 900, up: 0, down: 500 },
    { left: 700, right: 0, up: 400, down: 0 },
    { left: 40, right: 60, up: 200, down: 10 },
    { left: 800, right: 800, up: 400, down: 400 },
    { left: 0, right: 0, up: 0, down: 90 },
  ];
  let seen = 0;
  for (const room of rooms) {
    for (const name of available(room)) {
      for (let seed = 1; seed <= 8; seed++) {
        const move = make(name, room, seeded(seed * 7919));
        assert.ok(move && move.ms > 500 && move.ms < 4000, `${name} has a length`);
        const start = move.at(0), end = move.at(move.ms);
        assert.ok(Math.hypot(start.dx, start.dy) < 0.5, `${name} starts at rest`);
        assert.ok(Math.hypot(end.dx, end.dy) < 0.5, `${name} ends where it was (${end.dx}, ${end.dy})`);
        let prev = start;
        for (let t = 0; t <= move.ms; t += 16) {
          const o = move.at(t);
          assert.ok(o.dx >= -room.left - 1e-6 && o.dx <= room.right + 1e-6, `${name} stays inside, x (${o.dx})`);
          assert.ok(o.dy >= -room.up - 1e-6 && o.dy <= room.down + 1e-6, `${name} stays inside, y (${o.dy})`);
          assert.ok(Math.hypot(o.dx - prev.dx, o.dy - prev.dy) < 60, `${name} has no jump at ${t} ms`);
          prev = o;
        }
        seen++;
      }
    }
  }
  assert.ok(seen > 60);
});

test('drag goes where there is room; bounce goes up; shake and sway really move it', async () => {
  const { make } = await load('possession.js');
  const biggest = (move, axis, sign) => {
    let m = 0;
    for (let t = 0; t <= move.ms; t += 8) m = Math.max(m, sign * move.at(t)[axis]);
    return m;
  };
  const right = make('drag', { left: 0, right: 600, up: 0, down: 0 }, () => 0.5);
  assert.ok(biggest(right, 'dx', 1) > 200 && biggest(right, 'dx', -1) < 1, 'only to the right');
  const down = make('drag', { left: 0, right: 0, up: 0, down: 500 }, () => 0.5);
  assert.ok(biggest(down, 'dy', 1) > 200);
  const hop = make('bounce', { left: 0, right: 0, up: 300, down: 300 });
  assert.ok(biggest(hop, 'dy', -1) > 90 && biggest(hop, 'dy', 1) < 1, 'hops up, not down');
  const shake = make('shake', { left: 100, right: 100, up: 100, down: 100 }, () => 0.3);
  assert.ok(biggest(shake, 'dx', 1) > 4 && biggest(shake, 'dx', 1) <= 13);
  const sway = make('sway', { left: 100, right: 100, up: 100, down: 100 }, () => 0.3);
  assert.ok(biggest(sway, 'dx', 1) > 15 || biggest(sway, 'dx', -1) > 15);
  // the puck slides off, then comes home
  const puck = make('puck', { left: 500, right: 500, up: 300, down: 300 }, () => 0.2);
  assert.ok(Math.max(biggest(puck, 'dx', 1), biggest(puck, 'dx', -1), biggest(puck, 'dy', 1), biggest(puck, 'dy', -1)) > 100);
});

test('make: null for a move the window has no room for or one that does not exist', async () => {
  const { make } = await load('possession.js');
  assert.equal(make('drag', { left: 0, right: 0, up: 0, down: 0 }), null);
  assert.equal(make('fly', { left: 900, right: 900, up: 900, down: 900 }), null);
});
