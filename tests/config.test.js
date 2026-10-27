'use strict';

// Her settings file (src/main/config.js): a change that changes nothing costs nothing, a burst of
// changes (a slider dragged in her ring menu) is one write, and nothing is lost on the way out.
//   npm run test:config

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-config-'));
const realLoad = Module._load;
// config.js only needs electron's app.getPath: a stand-in, so it runs under plain node
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => dir } };
  return realLoad.call(this, request, ...rest);
};
const config = require('../src/main/config.js');
Module._load = realLoad;

const onDisk = () => JSON.parse(fs.readFileSync(config.file(), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a setting that is already so changes nothing and writes nothing', async () => {
  assert.deepEqual(config.save({ volume: config.DEFAULTS.volume, memories: [] }), []);
  await wait(320);
  assert.equal(fs.existsSync(config.file()), false);
});

test('a real change is reported, kept at once, and written once a moment later', async () => {
  assert.deepEqual(config.save({ volume: 0.5 }), ['volume']);
  assert.equal(config.load().volume, 0.5);
  assert.equal(fs.existsSync(config.file()), false, 'not yet');
  await wait(320);
  assert.equal(onDisk().volume, 0.5);
});

test('a burst of changes is one write with the last value', async () => {
  const writes = [];
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (file, data, ...more) => { writes.push(String(file)); return realWrite(file, data, ...more); };
  try {
    for (let i = 0; i < 40; i++) config.save({ micSensitivity: i / 40 });
    await wait(320);
  } finally {
    fs.writeFileSync = realWrite;
  }
  assert.equal(writes.length, 1);
  assert.equal(onDisk().micSensitivity, 39 / 40);
});

test('objects are compared by value, and several keys come back together', () => {
  assert.deepEqual(config.save({ memories: ['a'] }), ['memories']);
  assert.deepEqual(config.save({ memories: ['a'] }), [], 'the same list again');
  assert.deepEqual(config.save({ memories: ['a', 'b'], theme: 'toxic' }).sort(), ['memories', 'theme']);
});

test('flush() writes at once; reading the file fresh never loses what is waiting', () => {
  config.save({ userName: 'Кирилл' });
  config.flush();
  assert.equal(onDisk().userName, 'Кирилл');
  config.save({ userName: 'Паша' });
  assert.equal(config.load(true).userName, 'Паша', 'the read flushes first');
  assert.equal(onDisk().userName, 'Паша');
});

test('the file is replaced whole, never half written', () => {
  config.save({ persona: 'x'.repeat(5000) });
  config.flush();
  assert.equal(fs.existsSync(`${config.file()}.tmp`), false);
  assert.equal(onDisk().persona.length, 5000);
});

test('a write that fails is kept and tried again; a fresh read does not throw it away', () => {
  const realWrite = fs.writeFileSync;
  const realError = console.error;
  console.error = () => {};
  fs.writeFileSync = () => { throw new Error('EBUSY: the file is held by another program'); };
  try {
    config.save({ userName: 'Вика' });
    config.flush();
    assert.equal(config.load(true).userName, 'Вика', 'what we hold is newer than the file');
  } finally {
    fs.writeFileSync = realWrite;
    console.error = realError;
  }
  assert.notEqual(onDisk().userName, 'Вика', 'not written yet');
  config.flush();
  assert.equal(onDisk().userName, 'Вика', 'written once the file is free');
});
