'use strict';

// When her window has to be raised again so that her legs (hanging over the taskbar) stay in front of it
// (src/main/stacking.js).
//   node --test tests/stacking.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { needsRaise } = require('../src/main/stacking.js');

const snap = (o = {}) => ({ fg: 1, taskbar: false, over: false, wins: [], ...o });

test('the taskbar over her (a window opened, a program switched to): she is raised again, and by lowering her first if once did not do', () => {
  assert.equal(needsRaise(snap({ over: true }), snap(), 'taskbar'), 'soft');
  assert.equal(needsRaise(snap({ over: true }), null, 'taskbar'), 'soft', 'the very first look');
  assert.equal(needsRaise(snap({ over: true }), snap({ over: true }), 'taskbar'), 'hard', 'still over her after the last raise');
  assert.equal(needsRaise(snap({ over: false }), snap({ over: true }), 'taskbar'), false, 'it worked');
});

test('a click on the taskbar raises her once, as before', () => {
  assert.equal(needsRaise(snap({ taskbar: true }), snap(), 'taskbar'), 'soft');
  assert.equal(needsRaise(snap({ taskbar: true }), snap({ taskbar: true }), 'taskbar'), false, 'not again while it stays the one in front');
});

test('away from the taskbar, in her corner, nothing is done: the taskbar cannot cover her there', () => {
  assert.equal(needsRaise(snap({ over: true }), snap(), 'corner'), false);
  assert.equal(needsRaise(snap({ taskbar: true }), snap(), 'corner'), false);
  assert.equal(needsRaise(null, null, 'taskbar'), false);
});
