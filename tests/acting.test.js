'use strict';

// Her idle fidgets (src/renderer/js/acting.js FIDGETS, capri.js fidget()): every one named is a real act,
// well-formed and gentle (nothing that would cut off a bigger act), the sitting ones swing her legs, and she
// picks by stance and mood, never the same twice in a row, and never while she is busy.
//   npm run test:acting

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

const MOODS = ['calm', 'happy', 'angry', 'annoyed', 'sad', 'shy', 'bored'];
const FIELDS = new Set(['head', 'mane', 'hair', 'tilt', 'bob', 'sx', 'sy', 'arms', 'armL', 'armR', 'reach', 'long', 'longL', 'longR', 'smear', 'echo', 'kickL', 'kickR']);

test('every fidget is an act that exists: gentle, made of drawings, with only the pose fields she has', async () => {
  const { ACTS, FIDGETS } = await load('acting.js');
  for (const stance of ['sit', 'stand']) {
    for (const mood of MOODS) assert.ok(Array.isArray(FIDGETS[stance][mood]), `${stance}/${mood} has a list`);
    for (const name of new Set(Object.values(FIDGETS[stance]).flat())) {
      const act = ACTS[name];
      assert.ok(act, `${name} is an act`);
      assert.ok(act.priority <= 1, `${name} does not cut off a stronger act`);
      assert.ok(!act.loop, `${name} ends by itself`);
      assert.ok(act.keys.length >= 4, `${name} has drawings`);
      for (const [frames, pose] of act.keys) {
        assert.ok(Number.isInteger(frames) && frames >= 1 && frames <= 20, `${name}: a drawing is held a sane time`);
        for (const key of Object.keys(pose)) assert.ok(FIELDS.has(key), `${name}: ${key} is a pose field`);
      }
      const total = act.keys.reduce((n, k) => n + k[0], 0) / 12;
      assert.ok(total >= 1.2 && total <= 9, `${name} lasts ${total.toFixed(1)} s`);
    }
  }
});

test('the sitting ones move her legs (and not just a little); the standing ones do not touch them', async () => {
  const { ACTS, FIDGETS } = await load('acting.js');
  for (const name of new Set(Object.values(FIDGETS.sit).flat())) {
    const kicks = ACTS[name].keys.flatMap(([, pose]) => [pose.kickL, pose.kickR]).filter((v) => v !== undefined);
    assert.ok(kicks.length > 0, `${name} sets her legs`);
    if (['swing', 'swingSlow', 'kickfast'].includes(name)) assert.ok(Math.max(...kicks) >= 0.5, `${name} swings wide`);
    // legs swing out and in (more than one value)
    assert.ok(new Set(kicks.map((v) => Math.round(v * 20))).size >= 2, `${name} moves them`);
  }
  for (const name of new Set(Object.values(FIDGETS.stand).flat())) {
    assert.ok(ACTS[name].keys.every(([, pose]) => pose.kickL === undefined && pose.kickR === undefined), `${name} leaves her legs`);
  }
  // she has more to do on a ledge than the one lazy kick
  assert.ok(new Set(Object.values(FIDGETS.sit).flat()).size >= 7);
});

test('fidget(): by stance and mood, not the same twice, and only when nothing is going on', async () => {
  const { Capri } = await load('capri.js');
  const { FIDGETS } = await load('acting.js');
  const played = [];
  const make = (extra = {}) => ({
    mode: 'idle', act: null, busy: false, dragging: false, pointing: null, dancing: false, activityAct: null,
    hidden: false, stowed: false, dormant: false, sky: null, upside: false, stance: 'sit', moodName: 'calm', lastFidget: '',
    perform(name) { played.push(name); },
    ...extra,
  });
  const run = (c) => Capri.prototype.fidget.call(c);

  // a ledge: her legs
  const sit = make();
  for (let i = 0; i < 40; i++) assert.ok(run(sit));
  assert.ok(played.every((n) => FIDGETS.sit.calm.includes(n)));
  assert.ok(new Set(played).size >= 5, 'a variety');
  assert.ok(played.every((n, i) => i === 0 || n !== played[i - 1]), 'never the same twice in a row');

  // her mood picks
  played.length = 0;
  for (let i = 0; i < 30; i++) run(make({ moodName: 'angry' }));
  assert.ok(played.every((n) => FIDGETS.sit.angry.includes(n)));
  played.length = 0;
  for (let i = 0; i < 30; i++) run(make({ stance: 'stand', moodName: 'happy' }));
  assert.ok(played.every((n) => FIDGETS.stand.happy.includes(n)));

  // angry and floating: nothing (her float is busy enough)
  played.length = 0;
  assert.equal(run(make({ stance: 'stand', moodName: 'angry' })), false);

  // not while something is going on, or in another stance
  for (const busy of [{ act: {} }, { busy: true }, { dragging: true }, { pointing: {} }, { dancing: true }, { activityAct: 'read' }, { mode: 'work' }, { mode: 'sleep' },
    { hidden: true }, { stowed: true }, { dormant: true }, { sky: {} }, { upside: true }, { stance: 'peek' }, { stance: 'fall' }]) {
    assert.equal(run(make(busy)), false, JSON.stringify(busy));
  }
  assert.equal(played.length, 0);
});
