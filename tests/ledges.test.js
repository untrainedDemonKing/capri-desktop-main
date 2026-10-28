'use strict';

// Where she sits and where she lands (src/renderer/js/ledges.js): riding along with a window, falling when
// it is gone or covered, hopping off a ledge, landing on windows that moved, being dropped onto one.
//   node --test tests/ledges.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

const SCALE = 0.8;
const VIEW = { w: 1600, h: 900, floor: 852 }; // a taskbar of 48 px under the work area
const win = (id, x, y, w = 700, h = 400, extra = {}) => ({ id, x, y, w, h, max: false, ...extra });

test('her hips rest on the top edge of a window: her feet are lower by the length of her legs', async () => {
  const { seat } = await load('ledges.js');
  const { SPRITE } = await load('sprite.js');
  const at = seat(win(1, 300, 400), 200, SCALE);
  assert.equal(at.x, 500);
  assert.equal(at.y, 400 + 3 + (SPRITE.feet.y - SPRITE.hip) * SCALE);
});

test('which windows she can sit on: a real, wide one with room above and below it; never a maximized one', async () => {
  const { canSit } = await load('ledges.js');
  assert.equal(canSit(win(1, 300, 400), VIEW, SCALE), true);
  assert.equal(canSit(win(1, 300, 400, 700, 400, { max: true }), VIEW, SCALE), false, 'maximized');
  assert.equal(canSit(win(1, 300, 400, 250), VIEW, SCALE), false, 'too narrow');
  assert.equal(canSit(win(1, 300, 60), VIEW, SCALE), false, 'no room above for her');
  assert.equal(canSit(win(1, 300, 800), VIEW, SCALE), false, 'so low that her legs would be in the taskbar');
  assert.equal(canSit({ id: 'taskbar' }, VIEW, SCALE), true, 'the taskbar always');
});

test('a window above hers hides her seat only where it overlaps it, and only if it is in front', async () => {
  const { covered } = await load('ledges.js');
  const mine = win(1, 300, 400);
  const front = win(2, 500, 300, 400, 300); // above hers in the stack, over its top edge at x 500..900
  assert.equal(covered(mine, 600, [front, mine], SCALE), true, 'her seat is under it');
  assert.equal(covered(mine, 480, [front, mine], SCALE), true, 'her body is 27 px each side: 480 + 27 reaches 500');
  assert.equal(covered(mine, 460, [front, mine], SCALE), false, 'and 460 + 27 does not');
  assert.equal(covered(mine, 330, [front, mine], SCALE), false, 'her seat is clear of it');
  assert.equal(covered(mine, 600, [mine, front], SCALE), false, 'a window behind hers cannot cover it');
  assert.equal(covered(mine, 600, [win(3, 500, 600, 400, 200), mine], SCALE), false, 'a window in front that does not reach the top edge');
  assert.equal(covered({ id: 'taskbar' }, 600, [front], SCALE), false, 'nothing covers the taskbar');
  assert.equal(covered(mine, 600, [], SCALE), false, 'her window is not in the list at all (the caller falls for that)');
});

test('she rides along with the window: it moves, she moves; it narrows, she keeps to it', async () => {
  const { follow, seat } = await load('ledges.js');
  const perch = { id: 1, dx: 200 };
  assert.deepEqual(follow(perch, [win(1, 300, 400)], VIEW, SCALE).pos, seat(win(1, 300, 400), 200, SCALE));
  assert.deepEqual(follow(perch, [win(1, 700, 300)], VIEW, SCALE).pos, seat(win(1, 700, 300), 200, SCALE), 'dragged');
  // resized from the right edge so that her spot is outside: she is kept inside it (60 from the end)
  assert.equal(follow({ id: 1, dx: 260 }, [win(1, 300, 400, 300)], VIEW, SCALE).pos.x, 300 + 240, 'a narrower window');
  assert.equal(follow({ id: 1, dx: 20 }, [win(1, 300, 400)], VIEW, SCALE).pos.x, 350, 'and not past the near end either');
});

test('a window dragged half off the screen keeps her on its visible part; one wholly off lets her fall', async () => {
  const { follow } = await load('ledges.js');
  const perch = { id: 1, dx: 200 };
  assert.equal(follow(perch, [win(1, -500, 400)], VIEW, SCALE).pos.x, 60, 'off the left edge: where it still shows');
  assert.equal(follow(perch, [win(1, 1400, 400)], VIEW, SCALE).pos.x, 1540, 'off the right edge');
  assert.deepEqual(follow(perch, [win(1, -700, 400)], VIEW, SCALE), { fall: true }, 'wholly off the left');
  assert.deepEqual(follow(perch, [win(1, 1600, 400)], VIEW, SCALE), { fall: true }, 'wholly off the right');
  assert.equal(follow(perch, [win(1, 300, 400)], VIEW, SCALE).pos.x, 500, 'a window on the screen: as before');
});

test('she falls when her window is closed, minimized, maximized, moved where nobody can sit, or covered by another', async () => {
  const { follow } = await load('ledges.js');
  const perch = { id: 1, dx: 200 };
  assert.deepEqual(follow(perch, [], VIEW, SCALE), { fall: true }, 'closed or minimized: it is not in the list');
  assert.deepEqual(follow(perch, [win(1, 0, 0, 1600, 852, { max: true })], VIEW, SCALE), { fall: true }, 'maximized');
  assert.deepEqual(follow(perch, [win(1, 300, 30)], VIEW, SCALE), { fall: true }, 'dragged up to the top of the screen');
  assert.deepEqual(follow(perch, [win(2, 400, 300, 500, 300), win(1, 300, 400)], VIEW, SCALE), { fall: true }, 'another window comes over her seat');
  assert.ok(follow(perch, [win(2, 1000, 300, 500, 300), win(1, 300, 400)], VIEW, SCALE).pos, 'another window elsewhere is nothing to her');
});

test('on the taskbar she stays seated whatever the windows do', async () => {
  const { follow, taskbar } = await load('ledges.js');
  const perch = { id: 'taskbar', dx: 1200 };
  const next = follow(perch, [win(2, 400, 300, 900, 600), win(3, 0, 0, 1600, 852, { max: true })], VIEW, SCALE);
  assert.equal(next.pos.x, 1200);
  assert.equal(next.pos.y, taskbar(VIEW).y + 3 + (418 - 232) * SCALE, 'on the top edge of the taskbar, her legs hanging below it');
  assert.deepEqual(follow(perch, [], VIEW, SCALE).pos, next.pos);
});

test('falling from a ledge: onto the next ledge under her, else the floor; a ledge out of her way or covered is not one', async () => {
  const { landing, seat } = await load('ledges.js');
  const from = { x: 500, y: 300 };
  const low = win(1, 300, 560);
  assert.deepEqual(landing(from, [low], VIEW, SCALE), { y: seat(low, 200, SCALE).y, stance: 'sit', perch: { id: 1, dx: 200 } });
  assert.deepEqual(landing(from, [], VIEW, SCALE), { y: VIEW.floor - 6, stance: 'stand', perch: null }, 'nothing: the floor');
  assert.equal(landing(from, [win(1, 700, 560)], VIEW, SCALE).stance, 'stand', 'a window to the side');
  assert.equal(landing(from, [win(1, 300, 100)], VIEW, SCALE).stance, 'stand', 'a window above her');
  assert.equal(landing(from, [win(2, 400, 500, 400, 300), low], VIEW, SCALE).perch.id, 2, 'the nearest ledge first');
  assert.equal(landing(from, [win(2, 300, 500, 700, 300), low], VIEW, SCALE).perch.id, 2);
  assert.equal(landing(from, [win(3, 350, 500, 300, 300), win(2, 300, 500, 700, 300)], VIEW, SCALE).perch.id, 3, 'whichever is in front of the one it covers');
});

test('hopping off a ledge is leaving it: she does not land on the same one (it is at her hips)', async () => {
  const { landing, seat } = await load('ledges.js');
  const mine = win(1, 300, 400, 700, 200);
  const at = seat(mine, 200, SCALE);
  assert.equal(landing(at, [mine], VIEW, SCALE).perch.id, 1, 'without it she lands on it at once');
  assert.deepEqual(landing(at, [mine], VIEW, SCALE, 1), { y: VIEW.floor - 6, stance: 'stand', perch: null }, 'with it she goes down to the floor');
  const lower = win(2, 300, 640);
  assert.equal(landing(at, [mine, lower], VIEW, SCALE, 1).perch.id, 2, 'or the ledge below');
});

test('the windows move while she falls: where she lands is where the window is now', async () => {
  const { landing } = await load('ledges.js');
  const from = { x: 500, y: 300 };
  assert.equal(landing(from, [win(1, 300, 560), win(2, 300, 400)], VIEW, SCALE).perch.id, 2);
  assert.equal(landing(from, [win(1, 300, 560), win(2, 900, 400)], VIEW, SCALE).perch.id, 1, 'the near one moved away: the next');
  assert.equal(landing(from, [win(1, 1000, 560), win(2, 900, 400)], VIEW, SCALE).stance, 'stand', 'both moved: the floor');
  assert.equal(landing({ x: 500, y: 600 }, [win(2, 300, 400)], VIEW, SCALE).stance, 'stand', 'a window she has fallen past is no ledge');
});

test('let go of her: onto a ledge if her hips are right at it, else nothing', async () => {
  const { dropOnto, seat } = await load('ledges.js');
  const mine = win(1, 300, 400);
  const hips = (y) => ({ x: 500, y: y + (418 - 232) * SCALE });
  const near = dropOnto(hips(410), [mine], VIEW, SCALE);
  assert.deepEqual(near.perch, { id: 1, dx: 200 });
  assert.deepEqual(near.pos, seat(mine, 200, SCALE));
  assert.equal(dropOnto(hips(440), [mine], VIEW, SCALE), null, 'too far under the edge');
  assert.equal(dropOnto(hips(360), [mine], VIEW, SCALE), null, 'too far over it');
  assert.ok(dropOnto(hips(380), [mine], VIEW, SCALE), 'a little over it still counts');
  assert.equal(dropOnto({ x: 310, y: hips(400).y }, [mine], VIEW, SCALE), null, 'at the very end of it');
  assert.equal(dropOnto(hips(400), [win(2, 400, 300, 500, 300), mine], VIEW, SCALE), null, 'under another window');
});
