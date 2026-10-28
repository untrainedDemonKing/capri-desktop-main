'use strict';

// Her tray menu speaks every language she does, and every voice engine and window she has a line for in each
// (a missing line is an empty item in the menu).
//   node --test tests/labels.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { TRAY, LANGS } = require('../src/main/labels.js');
const tts = require('../src/main/tts.js');

test('she speaks two languages, Russian and English, and nothing else is left of the others', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  assert.deepEqual(LANGS, ['ru', 'en']);
  assert.deepEqual(Object.keys(TRAY).sort(), ['en', 'ru']);
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  const lines = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'lines.js')).href);
  assert.deepEqual(Object.keys(lines.LINES).sort(), ['en', 'ru'], 'her lines');
  // a language from an old settings file reads English, for her lines of every assistant too
  for (const assistant of ['claude', 'codex', 'agy']) {
    assert.deepEqual(lines.linesFor('fr', assistant), lines.linesFor('en', assistant), assistant);
    assert.deepEqual(Object.keys(lines.linesFor('ru', assistant)), Object.keys(lines.linesFor('en', assistant)), `${assistant}: the same lines in both`);
  }
  assert.match(lines.linesFor('ru', 'codex').welcome.connect, /Codex/);
  assert.match(lines.linesFor('en', 'agy').welcome.restart, /Antigravity/);
  // the demo session and the voices she asks the system for
  const demo = require('../scripts/demo-sequence.js');
  assert.deepEqual(demo('fr'), demo('en'), 'the demo');
  assert.notDeepEqual(demo('ru'), demo('en'));
  const speech = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'speech.js')).href);
  assert.equal(typeof speech.speakable, 'function');
  const fs = require('node:fs');
  const files = ['piper.js', 'tune.js', 'config.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', f), 'utf8')).join('\n');
  assert.doesNotMatch(files, /\b(?:fr|es|pt)_(?:FR|ES|MX|BR)|\b(?:fr|es|pt): [['{]/, 'no voices of other languages');
});

test('every voice engine has its name in the tray menu, in every language', () => {
  for (const lang of LANGS) {
    for (const engine of Object.keys(tts.ENGINES)) {
      assert.ok(TRAY[lang].engines[engine], `${lang}: no line for the voice engine "${engine}"`);
    }
  }
});

test('the preparation and the main menu are in the tray menu, in every language', () => {
  for (const lang of LANGS) {
    assert.ok(TRAY[lang].prepare, `${lang}: prepare`);
    assert.ok(TRAY[lang].hub, `${lang}: hub`);
  }
});

test('her voice engines in the ring menu and in her guide (lines-life.js) have their names too', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'lines-life.js'), 'utf8');
  const blocks = [...src.matchAll(/engines: \{ system: [^}]*\}/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 4, 'the engine lists');
  for (const b of blocks) for (const engine of Object.keys(tts.ENGINES)) assert.match(b, new RegExp(`${engine}:`), `${engine} in ${b.slice(0, 60)}`);
});
