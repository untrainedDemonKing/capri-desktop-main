'use strict';

// What is going on around her, and how it moves her (src/renderer/js/mind/life.js, mood.js): the net coming and going, the battery, hours at the
// PC, coming back after a long time, and what her chat model is told of it.
//   node --test tests/renderer/ambient.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { rendererFile } = require('../helpers/source');

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const load = (file) => import(pathToFileURL(rendererFile(file)).href);

async function world(lang = 'en') {
  const { Life } = await load('life.js');
  const said = [];
  const reacted = [];
  const events = [];
  const capri = {
    mode: 'idle', busy: false, dragging: false, stowed: false, dormant: false, hidden: false, sky: null, pointing: null, stance: 'stand',
    react: (n) => reacted.push(n), wake() {}, perform() {},
  };
  const panel = { visible: false, say: (m) => { said.push(m); return true; } };
  const heart = { enabled: true, event: (name, scale = 1) => events.push([name, scale]), mood: { v: { anger: 0 } } };
  const life = new Life({ capri, panel, voice: {}, host: {}, brain: { lang, busySessions: [], custom: {} }, heart, fx: {} });
  return { life, said, reacted, events, capri };
}

test('what is going on around her goes to her mind: the time, a long stretch at the PC, a return, the battery, the net', async () => {
  const { life } = await world();
  const at = (h, m) => new Date(2026, 2, 8, h, m);
  assert.deepEqual(life.situation(at(2, 40)), ['It is 02:40 on their PC (the middle of the night).']);
  assert.match(life.situation(at(9, 5))[0], /09:05.*morning/);
  assert.match(life.situation(at(14, 0))[0], /daytime/);
  assert.match(life.situation(at(19, 0))[0], /evening/);
  assert.match(life.situation(at(23, 30))[0], /late evening/);
  // hours without a break
  life.sessionSince = at(14, 0).getTime();
  const lines = life.situation(at(17, 30)).join(' ');
  assert.match(lines, /at the PC for about 3 h 30 without a real break|at the PC for about 3 h/);
  assert.doesNotMatch(life.situation(at(15, 0)).join(' '), /without a real break/, 'an hour is no stretch');
  // just back
  life.lastBack = { at: at(17, 25).getTime(), ms: 3 * 3600 * 1000 };
  assert.match(life.situation(at(17, 30)).join(' '), /just came back after being away for 3 h/);
  assert.doesNotMatch(life.situation(at(18, 30)).join(' '), /just came back/, 'for a few minutes only');
  life.lastBack = { at: at(17, 25).getTime(), ms: 5 * 60000 };
  assert.doesNotMatch(life.situation(at(17, 30)).join(' '), /just came back/, 'five minutes is no absence');
  // the battery and the net
  life.battery = { level: 0.12, charging: false };
  assert.match(life.situation(at(17, 30)).join(' '), /battery is low \(12%\) and not charging/);
  life.battery = { level: 0.12, charging: true };
  assert.doesNotMatch(life.situation(at(17, 30)).join(' '), /battery/);
  life.online = false;
  assert.match(life.situation(at(17, 30)).join(' '), /internet is down/);
  assert.match(life.context(), /It is \d\d:\d\d on their PC/, 'and it is in what the chat model is told');
});

test('the net going and coming back moves her, once each, and she says a word when she is free', async () => {
  const { life, said, reacted, events } = await world();
  life.netChanged(true);
  assert.deepEqual(events, [], 'nothing changed');
  life.netChanged(false);
  assert.deepEqual(events, [['offline', 1]]);
  assert.equal(said.length, 1);
  assert.match(said[0].line, /net|Internet|internet|quiet/);
  assert.equal(life.online, false);
  life.netChanged(false);
  assert.equal(events.length, 1, 'the same again is not news');
  life.netChanged(true);
  assert.deepEqual(events.at(-1), ['online', 1]);
  assert.equal(said.length, 2);
  assert.deepEqual(reacted, ['hurt', 'happy']);
  // busy (a panel is up): the feeling still moves, no line
  life.panel.visible = true;
  life.netChanged(false);
  assert.equal(events.at(-1)[0], 'offline');
  assert.equal(said.length, 2);
});

test('hours at the PC without a break: she says so, once, and a real break starts it over', async () => {
  const { life, said, events } = await world('ru');
  const now = Date.now();
  life.sessionSince = now - 2 * 3600 * 1000;
  life.session(now);
  assert.equal(said.length, 0, 'two hours is not yet');
  life.sessionSince = now - 3.2 * 3600 * 1000;
  life.session(now);
  assert.equal(said.length, 1);
  assert.match(said[0].line, /3 ч/);
  assert.deepEqual(events, [['longSession', 1]]);
  life.session(now);
  assert.equal(said.length, 1, 'once');
  // she was away for an hour: a break
  life.welcomeBack(60 * 60000);
  assert.ok(Date.now() - life.sessionSince < 1000, 'it starts over');
  assert.equal(life.sessionTold, false);
  assert.equal(life.lastBack.ms, 60 * 60000);
});

test('coming back after hours is missed more than after minutes', async () => {
  const { life, events } = await world();
  life.welcomeBack(10 * 60000);
  assert.deepEqual(events.map((e) => e[0]), ['userBack'], 'ten minutes: just back');
  events.length = 0;
  life.welcomeBack(4 * 3600 * 1000);
  assert.deepEqual(events, [['userBack', 1], ['longAway', 2]]);
  events.length = 0;
  life.welcomeBack(30 * 3600 * 1000);
  assert.deepEqual(events.at(-1), ['longAway', 4], 'and not more than four times');
});

test('the battery: low, she feels it; plugged in afterwards, she is glad', async () => {
  const { life, said, events } = await world();
  const listeners = {};
  const battery = { level: 0.1, charging: false, addEventListener: (n, fn) => { listeners[n] = fn; } };
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getBattery: async () => battery, onLine: true } });
  try {
    await life.watchBattery();
    assert.deepEqual(events.map((e) => e[0]), ['batteryLow']);
    assert.match(said[0].line, /10%/);
    assert.deepEqual(life.battery, { level: 0.1, charging: false });
    battery.charging = true;
    listeners.chargingchange();
    assert.deepEqual(events.map((e) => e[0]), ['batteryLow', 'charging']);
    assert.equal(said.length, 2);
    battery.charging = false;
    battery.level = 0.5;
    listeners.levelchange();
    assert.equal(events.length, 2, 'not low any more: nothing');
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
  }
});
