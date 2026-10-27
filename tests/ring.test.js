'use strict';

// Her circular menu (ring.js) and what's behind its tabs: where the ring and its card go on a
// screen, the shape of a sector, how the mic's sensitivity and level are read (ears.js), where you
// stand in the bond (bond.js progressOf) and editing her notebook by hand.
//   npm run test:ring

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', file)).href);

test('the ring and its card are put where there is room, on either side of her', async () => {
  const { place } = await load('ring.js');
  // in the middle of a wide screen: ring on her, card on the right
  let at = place({ cx: 800, cy: 600, size: 480, vw: 1600, vh: 900 });
  assert.equal(at.side, 'right');
  assert.equal(at.left, 560);
  assert.equal(at.cardLeft, 560 + 480 + 18);
  assert.ok(at.top >= 8 && at.top + at.size <= 900 - 8);
  // at the right edge: the card goes to her left
  at = place({ cx: 1500, cy: 500, size: 480, vw: 1600, vh: 900 });
  assert.equal(at.side, 'left');
  assert.ok(at.cardLeft >= 8 && at.cardLeft + 372 <= at.left);
  assert.ok(at.left + at.size <= 1600 - 8);
  // at the left edge of a narrow screen: the ring slides over so the card fits
  at = place({ cx: 120, cy: 500, size: 480, vw: 1100, vh: 800 });
  assert.equal(at.side, 'right');
  assert.ok(at.cardLeft + 372 <= 1100 - 8, JSON.stringify(at));
  assert.ok(at.left >= 8);
  // a small screen: the ring shrinks to fit
  at = place({ cx: 500, cy: 400, size: 520, vw: 1000, vh: 500 });
  assert.equal(at.size, 484);
  assert.ok(at.top >= 8 && at.top + at.size <= 500);
});

test('nine sectors are drawn as closed annular shapes with a gap between them', async () => {
  const { sectorPath, sectorMid, polar } = await load('ring.js');
  const { ORDER } = await load('ring-tabs.js');
  assert.equal(ORDER.length, 9);
  assert.equal(ORDER[0], 'bond');
  assert.equal(ORDER[1], 'brain');
  const d = sectorPath(0);
  assert.match(d, /^M [\d. ]+ A 222 222 0 0 1 [\d. ]+ L [\d. ]+ L [\d. ]+ A 142 142 0 0 0 [\d. ]+ L [\d. ]+ Z$/);
  assert.notEqual(sectorPath(0), sectorPath(1));
  // the first sector's middle is straight up from the centre, the third's off to the right
  const top = sectorMid(0);
  assert.ok(Math.abs(top.x - 230) < 0.01 && top.y < 230);
  const right = sectorMid(2);
  assert.ok(right.x > 230 && right.y < 240);
  const [x, y] = polar(100, 0);
  assert.equal(Math.round(x), 330);
  assert.equal(Math.round(y), 230);
});

test('the mic: sensitivity sets the voice threshold, and the meter reads a normal voice about half way', async () => {
  const { micThreshold, meterLevel } = await load('ears.js');
  assert.ok(Math.abs(micThreshold(0.4) - 0.012) < 0.0015, 'the default is the old fixed level');
  assert.ok(micThreshold(0) > micThreshold(0.5) && micThreshold(0.5) > micThreshold(1));
  assert.equal(micThreshold(5), micThreshold(1));
  assert.equal(micThreshold(NaN), micThreshold(0.4));
  assert.equal(meterLevel(0), 0);
  assert.equal(meterLevel(1), 1);
  assert.ok(meterLevel(0.03) > 0.4 && meterLevel(0.03) < 0.6);
});

test('the mic: a level meter can be asked for, opens the mic for itself, and closes it again', async () => {
  const { Ears } = await load('ears.js');
  const states = [];
  let opened = 0;
  let stopped = 0;
  globalThis.navigator ??= {};
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (c) => { opened += 1; return { getTracks: () => [{ stop: () => { stopped += 1; } }], c }; },
        enumerateDevices: async () => [
          { kind: 'audioinput', deviceId: 'default', label: 'Default - X' },
          { kind: 'audioinput', deviceId: 'a1', label: 'Headset' },
          { kind: 'audiooutput', deviceId: 'o1', label: 'Speakers' },
          { kind: 'audioinput', deviceId: 'communications', label: 'Comms' },
        ],
      },
    },
  });
  globalThis.AudioContext = class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData() {} }; }
    close() { return Promise.resolve(); }
  };
  try {
    const ears = new Ears({ host: {}, capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'ru' }, speech: {} });
    ears.onState = (s) => states.push(s);
    assert.equal(await ears.watch(true), false, 'off: nothing opens');
    await ears.watch(false); // (every ask is paired with a let-go)
    ears.configure({ ears: true, micSensitivity: 1 });
    assert.equal(ears.voiceLevel, 0.035 * 0.08);
    assert.equal(await ears.watch(true), true);
    assert.equal(ears.state, 'metering');
    assert.equal(opened, 1);
    await ears.watch(true); // a second one watching: the same mic
    assert.equal(opened, 1);
    await ears.watch(false);
    assert.equal(ears.state, 'metering', 'still one watching');
    await ears.watch(false);
    assert.equal(ears.state, 'off');
    assert.equal(stopped, 1);
    assert.deepEqual(await ears.devices(), [{ id: '', label: '' }, { id: 'a1', label: 'Headset' }]);
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
    delete globalThis.AudioContext;
  }
});

test('the mic you picked is asked for by id, and the default is used if it is gone', async () => {
  const { Ears } = await load('ears.js');
  const asked = [];
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async ({ audio }) => {
          asked.push(audio.deviceId?.exact || '');
          if (audio.deviceId) throw Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
          return { getTracks: () => [] };
        },
      },
    },
  });
  globalThis.AudioContext = class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0 }; }
    close() { return Promise.resolve(); }
  };
  try {
    const ears = new Ears({ host: {}, capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'ru' }, speech: {} });
    ears.configure({ ears: true, micDevice: 'usb-1' });
    assert.equal(await ears.openMic(), true);
    assert.deepEqual(asked, ['usb-1', '']);
    ears.shutMic();
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
    delete globalThis.AudioContext;
  }
});

test('a mic that will not open for the meter says nothing in a panel and stays on', async () => {
  const { Ears } = await load('ears.js');
  const said = [];
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }); } } },
  });
  try {
    const ears = new Ears({ host: {}, capri: {}, panel: { say: (m) => said.push(m) }, voice: {}, brain: { lang: 'ru' }, speech: {} });
    ears.configure({ ears: true });
    assert.equal(await ears.watch(true), false);
    assert.equal(said.length, 0, 'the ring says it itself');
    assert.equal(ears.enabled, true);
    await ears.watch(false);
    // pressing to talk is another matter: she tells you
    assert.equal(await ears.openMic(), false);
    assert.equal(said.length, 1);
    assert.equal(ears.enabled, false);
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
  }
});

test('her sounds go to the output picked, and fall back to the default if it is gone', async () => {
  const { Voice } = await load('voice.js');
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
          { kind: 'audiooutput', deviceId: 'spk', label: 'Speakers (Realtek)' },
          { kind: 'audiooutput', deviceId: 'hp', label: 'Headphones' },
          { kind: 'audiooutput', deviceId: 'communications', label: 'Comms' },
          { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
        ],
      },
    },
  });
  try {
    const v = new Voice();
    assert.deepEqual(await v.outputs(), [{ id: '', label: '' }, { id: 'spk', label: 'Speakers (Realtek)' }, { id: 'hp', label: 'Headphones' }]);
    const set = [];
    v.ctx = { setSinkId: async (id) => { set.push(id); if (id === 'gone') throw new Error('device not found'); } };
    assert.equal(await v.setSink('hp'), true);
    assert.equal(v.sink, 'hp');
    assert.equal(v.sinkError, '');
    assert.equal(await v.setSink('gone'), false);
    assert.deepEqual(set, ['hp', 'gone', ''], 'and the default instead');
    assert.match(v.sinkError, /not found/);
    // from her settings
    v.configure({ audioOut: 'spk' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(v.sink, 'spk');
    v.configure({ muted: true });
    assert.equal(v.muted, true);
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
  }
});

test('hearing your own mic on the output picked: needs the mic on, keeps it open until let go', async () => {
  const { Ears } = await load('ears.js');
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let stopped = 0;
  const sinks = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped += 1; } }] }) } },
  });
  globalThis.AudioContext = class {
    setSinkId(id) { sinks.push(id); return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
    get destination() { return {}; }
    close() { return Promise.resolve(); }
  };
  try {
    const ears = new Ears({ host: {}, capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'ru' }, speech: {} });
    assert.equal(await ears.monitor(true), false, 'the mic is off: nothing to hear');
    assert.equal(ears.monitorHeld, false);
    assert.equal(ears.watchers, 0, 'nothing left held');
    ears.configure({ ears: true, audioOut: 'hp' });
    assert.equal(await ears.monitor(true), true);
    assert.ok(ears.monitorCtx);
    assert.equal(ears.state, 'metering');
    assert.ok(sinks.includes('hp'), 'on the headphones');
    ears.configure({ ears: true, audioOut: 'spk' });
    assert.equal(sinks.at(-1), 'spk', 'and the output changes under it');
    // another microphone: the same job on it, and still heard
    ears.configure({ ears: true, audioOut: 'spk', micDevice: 'usb' });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(ears.monitorCtx, 'monitor resumed on the new mic');
    assert.equal(await ears.monitor(false), true);
    assert.equal(ears.monitorCtx, null);
    assert.equal(ears.state, 'off');
    assert.equal(ears.watchers, 0);
    assert.ok(stopped >= 1);
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
    delete globalThis.AudioContext;
  }
});

test('while the menu is open a prompt or a chat steps it aside, Claude\'s news waits, small talk is dropped', async () => {
  const { whileMenuOpen, Panel } = await load('panel.js');
  assert.equal(whileMenuOpen({ kind: 'alert' }), 'urgent');
  assert.equal(whileMenuOpen({ kind: 'info', chat: { send: 'x' } }), 'urgent');
  assert.equal(whileMenuOpen({ kind: 'info', guide: true }), 'urgent');
  assert.equal(whileMenuOpen({ kind: 'done' }), 'later');
  assert.equal(whileMenuOpen({ kind: 'error' }), 'later');
  assert.equal(whileMenuOpen({ kind: 'report' }), 'later');
  assert.equal(whileMenuOpen({ kind: 'info' }), 'drop');
  assert.equal(whileMenuOpen({ kind: 'idle' }), 'drop');
  assert.equal(whileMenuOpen({ kind: 'work' }), 'drop');

  // what waited is shown once the menu is shut (and not if it's stale)
  const said = [];
  const p = Object.create(Panel.prototype);
  p.say = (m) => said.push(m.line);
  p.held = { kind: 'done', line: 'отложено до открытия', heldAt: performance.now() };
  p.quiet = true; // (the menu opens: what was put aside for it stays put aside)
  assert.equal(p.quiet, true);
  assert.equal(p.held.line, 'отложено до открытия');
  p.held = { kind: 'done', line: 'готово', heldAt: performance.now() };
  p.quiet = false;
  assert.equal(p.quiet, false);
  assert.equal(p.held, null);
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(said, ['готово']);
  p.quiet = true;
  p.held = { kind: 'done', line: 'старое', heldAt: performance.now() - 3 * 60000 };
  p.quiet = false;
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(said, ['готово'], 'three minutes old: not worth saying');
});

test('opening the menu over a panel: a passing line goes, Claude\'s news waits, a prompt and a chat stay', async () => {
  const { Panel } = await load('panel.js');
  const make = (current) => {
    const p = Object.create(Panel.prototype);
    Object.assign(p, { current, el: { hidden: false }, suspended: false, leaving: false, held: null, hid: 0 });
    p.hide = () => { p.hid += 1; };
    return p;
  };
  const park = (current) => { const p = make(current); p.park(); return p; };
  assert.equal(park({ kind: 'info' }).hid, 1);
  assert.equal(park({ kind: 'idle' }).held, null);
  const done = park({ kind: 'done', line: 'готово' });
  assert.equal(done.hid, 1);
  assert.equal(done.held.line, 'готово', 'kept for after');
  assert.equal(park({ kind: 'error', line: 'упало' }).held.line, 'упало');
  assert.equal(park({ kind: 'alert' }).hid, 0, 'a permission prompt stays');
  assert.equal(park({ kind: 'info', chat: { send: 'x' } }).hid, 0, 'her chat stays');
  assert.equal(park({ kind: 'info', guide: true }).hid, 0, 'her guide stays');
  assert.equal(park(null).hid, 0);
});

test('turning conversation off keeps the mic for the meter; a finished turn closes it unless the meter wants it', async () => {
  const { Ears } = await load('ears.js');
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let stopped = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped += 1; } }] }) } },
  });
  globalThis.AudioContext = class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData() {} }; }
    close() { return Promise.resolve(); }
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return false; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; } // (no onstop: no transcription here)
  };
  let ears;
  try {
    ears = new Ears({ host: {}, capri: {}, panel: { say() {} }, voice: {}, brain: { lang: 'ru' }, speech: {} });
    ears.configure({ ears: true, converse: true });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ears.state, 'idle');
    await ears.watch(true); // the menu's meter, while she listens anyway
    ears.configure({ ears: true, converse: false });
    assert.equal(ears.state, 'metering', 'the meter still has its mic');
    assert.ok(ears.stream);
    assert.equal(stopped, 0);
    await ears.watch(false);
    assert.equal(ears.state, 'off', 'and let go with the meter');
    assert.equal(stopped, 1);

    // press-to-talk: the mic closes after the turn, unless the meter is on
    await ears.listenOnce();
    assert.equal(ears.single, true);
    ears.finish(); // (what the vad does when you go quiet; then the answer comes back)
    ears.afterTurn();
    assert.equal(ears.state, 'off');
    await ears.watch(true);
    await ears.listenOnce();
    ears.finish();
    ears.afterTurn();
    assert.equal(ears.state, 'metering');
    await ears.watch(false);
    assert.equal(ears.state, 'off');

    // conversation off while no menu is open: closed
    ears.configure({ ears: true, converse: true });
    await new Promise((r) => setTimeout(r, 10));
    ears.configure({ ears: true, converse: false });
    assert.equal(ears.state, 'off');
  } finally {
    ears?.shutMic(); // (a failed assert must not leave the vad timer running)
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
    delete globalThis.AudioContext;
    delete globalThis.MediaRecorder;
  }
});

test('the AI tab lists the same services the main process knows, and which of them take a key', async () => {
  const { PROVIDERS, GROUPS, needsKey, isLocal } = await load('brain-providers.js');
  const main = require('../src/main/llm.js').PROVIDERS;
  assert.deepEqual(Object.keys(PROVIDERS).sort(), Object.keys(main).sort());
  for (const [id, p] of Object.entries(PROVIDERS)) {
    assert.ok(GROUPS.includes(p.group), id);
    // a service that has a key variable in the main process takes a key here too
    assert.equal(needsKey(id), Boolean(main[id].env), id);
    assert.equal(isLocal(id), Boolean(main[id].local), id);
  }
  assert.equal(PROVIDERS.anthropic.group, 'claude');
  assert.equal(main.anthropic.kind, 'anthropic');
  const { lifeLines } = await load('lines-life.js');
  for (const lang of ['ru', 'en']) {
    const b = lifeLines(lang).ring.brain;
    for (const id of Object.keys(PROVIDERS)) assert.equal(b.providers[id]?.length, 2, `${lang} ${id}`);
    for (const g of GROUPS) assert.ok(b.groups[g], `${lang} ${g}`);
  }
});

test('where you stand in the bond: the next level, how far, and what is missing', async () => {
  const { progressOf, LEVEL_AT } = await load('bond.js');
  assert.equal(LEVEL_AT.length, 5);
  let p = progressOf({ talks: 0, days: 0 });
  assert.equal(p.level, 0);
  assert.equal(p.next, 1);
  assert.equal(p.needTalks, 12);
  assert.equal(p.fraction, 0);
  p = progressOf({ talks: 6, days: 1 });
  assert.equal(p.fraction, 0.5);
  p = progressOf({ talks: 143, days: 6, style: { n: 0, hostile: 0 } });
  assert.equal(p.level, 2);
  assert.equal(p.next, 3);
  assert.equal(p.needTalks, 250 - 143);
  assert.equal(p.needDays, 4);
  assert.ok(p.fraction > 0.3 && p.fraction < 0.5, String(p.fraction));
  p = progressOf({ talks: 900, days: 40, style: { n: 0, hostile: 0 } });
  assert.equal(p.level, 4);
  assert.equal(p.next, null);
  assert.equal(p.fraction, 1);
  // plenty of time, but rude: held back, and it says so
  p = progressOf({ talks: 900, days: 40, style: { n: 50, hostile: 0.4 } });
  assert.equal(p.level, 1);
  assert.equal(p.held, true);
});

test('her notebook can be edited by hand: remove, add, dials', async () => {
  const bond = await load('bond.js');
  const host = { saved: null, bondSave: (d) => { host.saved = d; } };
  const b = new bond.Bond({ host, brain: { lang: 'ru', custom: {} }, heart: null });
  b.data.notes = { facts: ['a one', 'b two'], likes: ['кофе'], dislikes: ['спорт'], style: 'коротко', us: 'друзья' };
  b.removeNote('facts', 'a one');
  assert.deepEqual(b.data.notes.facts, ['b two']);
  b.removeNote('style');
  assert.equal(b.data.notes.style, '');
  assert.equal(b.addNote('likes', '  спорт  '), true);
  assert.deepEqual(b.data.notes.likes, ['спорт', 'кофе']);
  assert.deepEqual(b.data.notes.dislikes, [], 'liked now, so not disliked');
  assert.equal(b.addNote('facts', 'мой пароль 1234 абв'), false, 'a password is not kept');
  assert.equal(b.addNote('facts', 'x'), false);
  assert.equal(b.addNote('style', 'нельзя'), false, 'only facts, likes and dislikes by hand');
  b.setTune('short', 5);
  assert.equal(b.data.tune.short, 1);
  b.setTune('nope', 0.5);
  assert.equal('nope' in b.data.tune, false);
  b.save(true);
  assert.equal(host.saved.tune.short, 1);
});

test('every sector has a title in the languages that have her menu, and all the strings she needs', async () => {
  const { lifeLines } = await load('lines-life.js');
  const { ORDER } = await load('ring-tabs.js');
  const shape = (o, p = '') => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => shape(v, `${p}${k}.`)) : [p]);
  const ru = lifeLines('ru').ring;
  const en = lifeLines('en').ring;
  for (const id of ORDER) assert.ok(ru.tabs[id] && en.tabs[id], id);
  assert.deepEqual(shape(ru).sort(), shape(en).sort(), 'the same strings in both languages');
  for (const key of ['hearing', 'quiet', 'sensitivity', 'device', 'level']) assert.ok(ru.mic[key] && en.mic[key], key);
  assert.equal(ru.bond.tune.short.length, 2);
});
