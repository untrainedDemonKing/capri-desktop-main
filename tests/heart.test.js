'use strict';

// What she makes of the pointer (src/renderer/js/heart.js, pointer-life.js): a shake, a rest by her, clicks by
// where they land and two in a row, being carried and put down, and what she says with no AI to answer.
//   npm run test:heart

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

// a Heart on fakes: she stands at (500, 500), nothing going on
async function world(extra = {}) {
  const { Heart } = await load('heart.js');
  const said = [];
  const reacted = [];
  const capri = {
    mode: 'idle', busy: false, dragging: false, stowed: false, dormant: false, hidden: false, sky: null, pointing: null,
    stance: 'stand', mouse: null, pos: { x: 500, y: 560 }, scale: 0.8,
    head: () => ({ x: 500, y: 500, top: 470 }),
    react: (name) => reacted.push(name),
    towardCenter: () => 1,
    setMood() {},
  };
  const panel = { visible: false, say: (m) => { said.push(m); return true; }, hide() { panel.hidden = (panel.hidden || 0) + 1; }, setMood() {} };
  const brain = { lang: 'ru', busySessions: [] };
  const heart = new Heart({ capri, panel, voice: { play() {}, mood: '' }, brain, host: { cursor: async () => null } });
  Object.assign(heart, extra);
  return { heart, capri, panel, said, reacted, brain };
}

const random = (value) => {
  const was = Math.random;
  Math.random = () => value;
  return () => { Math.random = was; };
};

// ---------- the shake ----------

test('Shake: strokes back and forth, fast, are a shake; a slow sweep, a twitch and one trip there and back are not', async () => {
  const { Shake } = await load('pointer-life.js');
  const strokes = (s, xs, step = 100) => {
    let t = 1000;
    let hit = false;
    for (const x of xs) hit = s.move(x, (t += step)) || hit;
    return hit;
  };
  // 100 -> 200 -> 100 -> 200 ... every 100 ms
  assert.equal(strokes(new Shake(), [100, 200, 100, 200, 100, 200, 100, 200]), true);
  // the same strokes, one a second: just moving the mouse about
  assert.equal(strokes(new Shake(), [100, 200, 100, 200, 100, 200, 100, 200], 1000), false);
  // twitching by a few pixels
  assert.equal(strokes(new Shake(), [100, 104, 100, 104, 100, 104, 100, 104, 100, 104, 100]), false);
  // across the screen and back
  assert.equal(strokes(new Shake(), [0, 200, 400, 600, 800, 600, 400, 200, 0]), false);
  // it starts counting over after a shake
  const s = new Shake();
  assert.equal(strokes(s, [100, 200, 100, 200, 100, 200]), true);
  assert.equal(strokes(s, [100, 200]), false);
});

// ---------- clicks ----------

test('tapped: two clicks within a moment are a double click, the third starts over', async () => {
  const { heart } = await world();
  assert.equal(heart.tapped(1000), false);
  assert.equal(heart.tapped(1200), true);
  assert.equal(heart.tapped(1300), false);
});

test('clickLine: a double click, the head and the legs have their own lines; the body only sometimes', async () => {
  const { heart } = await world();
  const { lifeLines } = await load('lines-life.js');
  const m = lifeLines('ru').mood.mouse;
  const back = random(0.1);
  assert.ok(m.doubleClick.includes(heart.clickLine({ double: true }).line));
  assert.ok(m.headClick.includes(heart.clickLine({ zone: 'head' }).line));
  assert.ok(m.legsClick.includes(heart.clickLine({ zone: 'legs' }).line));
  assert.ok(m.bodyClick.includes(heart.clickLine({ zone: 'body' }).line));
  back();
  const never = random(0.99);
  assert.equal(heart.clickLine({ zone: 'body' }), null);
  assert.equal(heart.clickLine({ zone: 'head' }), null);
  never();
  heart.enabled = false;
  assert.equal(heart.clickLine({ zone: 'head', double: true }), null);
});

test('clickLine, no AI: she says so, with a button that opens her main menu', async () => {
  const { heart, panel } = await world({ aiReady: false });
  const { lifeLines } = await load('lines-life.js');
  let opened = 0;
  heart.onConnect = () => { opened++; };
  const back = random(0.1);
  const msg = heart.clickLine({ zone: 'body' });
  back();
  assert.ok(lifeLines('ru').mood.noAi.click.includes(msg.line));
  assert.deepEqual(msg.actions.map((a) => [a.id, a.label]), [['connect', lifeLines('ru').mood.noAi.button]]);
  msg.onAction('connect');
  assert.equal(opened, 1);
  assert.equal(panel.hidden, 1);
  // with an AI, no such line
  heart.aiReady = true;
  const back2 = random(0.99);
  assert.equal(heart.clickLine({ zone: 'body' }), null);
  back2();
});

// ---------- the pointer by her ----------

test('the pointer coming up to her: a word now and then, only when nothing else is going on', async () => {
  const { heart, said, capri, panel } = await world();
  const back = random(0.05);
  heart.moved(1500, 500, 1000); // far away
  heart.moved(1400, 500, 1100);
  assert.equal(said.length, 0);
  heart.moved(560, 500, 40000); // by her
  assert.equal(said.length, 1);
  const { lifeLines } = await load('lines-life.js');
  assert.ok(lifeLines('ru').mood.mouse.near.includes(said[0].line));
  // not again for a while (and she is by her already)
  heart.moved(1500, 500, 41000);
  heart.moved(560, 500, 42000);
  assert.equal(said.length, 1);
  // not while a panel is up or she is busy
  panel.visible = true;
  heart.moved(1500, 500, 80000);
  heart.moved(560, 500, 81000);
  assert.equal(said.length, 1);
  panel.visible = false;
  capri.busy = true;
  heart.moved(1500, 500, 120000);
  heart.moved(560, 500, 121000);
  assert.equal(said.length, 1);
  back();
});

test('the pointer left to rest by her: one remark per rest; angrier when she is angry', async () => {
  const { heart, said } = await world();
  const { lifeLines } = await load('lines-life.js');
  const m = lifeLines('ru').mood;
  heart.moved(600, 520, 100000);
  heart.watch(105000); // not yet
  assert.equal(said.length, 0);
  heart.watch(110000);
  assert.equal(said.length, 1);
  assert.ok(m.mouse.linger.includes(said[0].line));
  heart.watch(150000); // already said
  assert.equal(said.length, 1);
  // a new rest, in a bad mood
  heart.mood.apply({ anger: 0.9 });
  heart.mood.changed();
  heart.moved(300, 520, 160000);
  heart.moved(580, 520, 200000);
  heart.watch(215000);
  assert.equal(said.length, 2);
  assert.ok(m.mouse.lingerAngry.includes(said[1].line));
  // nothing for a pointer that is not by her
  heart.moved(1500, 900, 300000);
  heart.watch(330000);
  assert.equal(said.length, 2);
});

test('the pointer shaken about: a remark and a start', async () => {
  const { heart, said, reacted } = await world();
  const back = random(0.1);
  let t = 50000;
  for (const x of [900, 1000, 900, 1000, 900, 1000, 900, 1000]) heart.moved(x, 300, (t += 100));
  back();
  assert.equal(said.length, 1);
  const { lifeLines } = await load('lines-life.js');
  assert.ok(lifeLines('ru').mood.mouse.shake.includes(said[0].line));
  assert.deepEqual(reacted, ['startle']);
});

test('with emotions off she says nothing about the pointer', async () => {
  const { heart, said } = await world();
  heart.enabled = false;
  const back = random(0.01);
  let t = 50000;
  for (const x of [900, 1000, 900, 1000, 900, 1000, 900, 1000]) heart.moved(x, 300, (t += 100));
  heart.moved(560, 500, 60000);
  heart.watch(90000);
  back();
  assert.equal(said.length, 0);
});

// ---------- being carried ----------

test('dragged: dizzy after a few; otherwise a word about the carry or the landing, sometimes', async () => {
  const { heart, said } = await world();
  const { lifeLines } = await load('lines-life.js');
  const m = lifeLines('ru').mood.mouse;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const back = random(0.01);
  heart.lastRemark = -1e9;
  heart.dragged({ ms: 3000, where: 'floor' });
  await wait(900);
  assert.ok(m.carry.includes(said.at(-1)?.line), 'a long carry');
  heart.lastRemark = -1e9;
  heart.dragged({ ms: 800, where: 'window' });
  await wait(900);
  assert.ok([...m.grab, ...m.dropWindow].includes(said.at(-1)?.line), 'put down on a window');
  back();
  const n = said.length;
  const never = random(0.99);
  heart.lastRemark = -1e9;
  heart.mood.drags = [];
  heart.dragged({ ms: 800, where: 'floor' });
  await wait(900);
  never();
  assert.equal(said.length, n);
});

test('dragged: three drags in a row make her dizzy, and then the landing has no word of its own', async () => {
  const { heart, said, reacted } = await world();
  const { lifeLines } = await load('lines-life.js');
  const back = random(0.99);
  heart.lastRemark = -1e9;
  for (let i = 0; i < 4; i++) heart.dragged({ ms: 800, where: 'floor' });
  await new Promise((r) => setTimeout(r, 900));
  back();
  assert.ok(reacted.includes('dizzy'));
  assert.ok(said.length >= 1 && said.every((m) => lifeLines('ru').mood.dizzy.includes(m.line)));
});

// ---------- no AI ----------

test('no AI: she mentions it every now and then (not the first minutes, not more than five times), with her button', async () => {
  const { heart, said } = await world({ aiReady: false });
  const { lifeLines } = await load('lines-life.js');
  const start = performance.now();
  heart.watch(start + 60000); // a minute in
  assert.equal(said.length, 0);
  heart.watch(start + 5 * 60000);
  assert.equal(said.length, 1);
  assert.ok(lifeLines('ru').mood.noAi.chatter.includes(said[0].line));
  assert.equal(said[0].actions[0].id, 'connect');
  heart.watch(start + 6 * 60000); // too soon after
  assert.equal(said.length, 1);
  for (let i = 1; i <= 10; i++) heart.watch(start + 5 * 60000 + i * 11 * 60000);
  assert.equal(said.length, 5);
  // with an AI connected, never
  const w = await world({ aiReady: true });
  w.heart.watch(performance.now() + 60 * 60000);
  assert.equal(w.said.length, 0);
});

// ---------- the lines ----------

test('the pointer lines exist in Russian and English, the same set, none empty', async () => {
  const { lifeLines } = await load('lines-life.js');
  const ru = lifeLines('ru').mood;
  const en = lifeLines('en').mood;
  assert.deepEqual(Object.keys(ru.mouse).sort(), Object.keys(en.mouse).sort());
  assert.deepEqual(Object.keys(ru.noAi).sort(), Object.keys(en.noAi).sort());
  for (const lang of [ru, en]) {
    for (const [key, lines] of Object.entries(lang.mouse)) {
      assert.ok(Array.isArray(lines) && lines.length >= 3, `mouse.${key} has lines`);
      assert.ok(lines.every((l) => typeof l === 'string' && l.trim()), `mouse.${key} has no blank line`);
    }
    assert.ok(lang.noAi.click.length >= 4 && lang.noAi.chatter.length >= 4);
    assert.ok(lang.noAi.button.trim());
  }
  // any other language (a settings file from an older version may still say 'fr') uses the English ones
  assert.deepEqual(lifeLines('fr').mood.mouse, en.mouse);
});

// ---------- where on her a click lands ----------

test('Capri.zone: the head, the legs below the hips, the rest is the body (mirrored too)', async () => {
  const { Capri } = await load('capri.js');
  const { SPRITE } = await load('sprite.js');
  const s = 0.8;
  const make = (facing, upside = false) => ({ scale: s, pos: { x: 400, y: 700 }, bob: 0, facing, upside });
  // sprite point -> screen point for a Capri facing 1 at that spot
  const at = (c, sx, sy) => [c.pos.x + (sx - SPRITE.feet.x) * s * c.facing, c.pos.y - (SPRITE.feet.y - sy) * s];
  for (const facing of [1, -1]) {
    const c = make(facing);
    assert.equal(Capri.prototype.zone.call(c, ...at(c, SPRITE.head.x, SPRITE.head.y - 34)), 'head');
    assert.equal(Capri.prototype.zone.call(c, ...at(c, SPRITE.feet.x, SPRITE.feet.y - 20)), 'legs');
    assert.equal(Capri.prototype.zone.call(c, ...at(c, SPRITE.feet.x, SPRITE.hip - 20)), 'body');
  }
});
