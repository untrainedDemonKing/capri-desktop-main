'use strict';

// How far the long jobs of the voice are: pip's lines into a bar over everything the step fetches (chatterbox-setup.js), and the
// download of the model from the cache of the model hub (chatterbox.js).
//   node --test tests/progress.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const setup = require('../src/main/chatterbox-setup.js');
const { Chatterbox } = require('../src/main/chatterbox.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-progress-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('pip prints sizes in decimal units: kB, MB, GB', () => {
  assert.equal(setup.parseSize('57.2 MB'), 57200000);
  assert.equal(setup.parseSize('2.5 GB'), 2500000000);
  assert.equal(setup.parseSize('204.2 kB'), 204200);
  assert.equal(setup.parseSize('12 B'), 12);
  assert.equal(setup.parseSize('about a lot'), 0);
});

test('the bar over a pip run: it follows the lines, never goes back, stays short of the end until pip says it is done, and says what it is on', () => {
  let t = 0;
  const bar = setup.createPipProgress({ now: () => (t += 300) });
  bar.phase(800e6);
  const seen = [];
  const feed = (line) => { const changed = bar.feed(line); const v = bar.view(); seen.push(v); return { changed, v }; };
  assert.equal(feed('Collecting chatterbox-tts').changed, false);
  assert.equal(feed('Downloading torch-2.6.0-cp311-cp311-win_amd64.whl (204.2 MB)').v.what, 'torch', 'the name without its version');
  feed('Progress 0 of 204200000');
  const half = feed('Progress 102100000 of 204200000').v;
  assert.ok(half.fraction > 0.1 && half.fraction < 0.2, `a part of what is expected (${half.fraction})`);
  assert.ok(half.rate > 0, 'and how fast');
  const all = feed('Progress 204200000 of 204200000').v;
  assert.ok(all.fraction < 0.92 && all.stage === 'getting', 'the packages still to come: it does not run to its end');
  const unpack = feed('Installing collected packages: torch').v;
  assert.equal(unpack.stage, 'installing');
  assert.ok(unpack.fraction <= 0.96);
  const end = feed('Successfully installed torch-2.6.0').v;
  assert.equal(end.stage, 'done');
  assert.equal(end.fraction, 1, 'what a run is over is what it fetched, not what was expected');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].fraction >= seen[i - 1].fraction, 'never back');
});

test('a second run (the torch for the card) goes on over the first, and what was reserved for it is counted from the start', () => {
  const bar = setup.createPipProgress();
  bar.phase(700e6, 2.7e9);
  bar.feed('Downloading chatterbox_tts-0.1.4-py3-none-any.whl (1.3 MB)');
  bar.feed('Progress 1300000 of 1300000');
  bar.feed('Successfully installed chatterbox-tts-0.1.4');
  const first = bar.view().fraction;
  assert.ok(first < 0.1, `the packages are a small part of it (${first})`);
  bar.phase(2.7e9);
  bar.feed('Downloading torch-2.6.0+cu124-cp311-cp311-win_amd64.whl (2.5 GB)');
  bar.feed('Progress 1250000000 of 2500000000');
  const mid = bar.view().fraction;
  assert.ok(mid > 0.4 && mid < 0.6, `half of the torch is about half (${mid})`);
  bar.feed('Progress 2500000000 of 2500000000');
  bar.feed('Successfully installed torch-2.6.0+cu124');
  assert.equal(bar.view().fraction, 1);
});

test('a file larger than pip said first (a different size in the lines of progress) moves the end, and no lines of progress still moves the bar by files', () => {
  const bar = setup.createPipProgress();
  bar.phase(100e6);
  bar.feed('Downloading a-1.0-py3-none-any.whl (50.0 MB)');
  bar.feed('Progress 20000000 of 60000000');
  assert.ok(bar.view().total >= 100e6);
  const plain = setup.createPipProgress();
  plain.phase(400e6);
  plain.feed('Downloading a-1.0-py3-none-any.whl (100.0 MB)');
  plain.feed('Downloading b-1.0-py3-none-any.whl (100.0 MB)');
  assert.ok(plain.view().fraction > 0.2 && plain.view().fraction < 0.3, 'the first file got: a quarter');
});

test('raw progress lines do not fill the tail of what pip said (the lines that say what went wrong must stay in it)', async () => {
  const { EventEmitter } = require('node:events');
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      const lines = ['Collecting torch', ...Array.from({ length: 200 }, (_x, i) => `Progress ${i * 1000} of 200000`), 'ERROR: No matching distribution found for torch==9'];
      child.stdout.emit('data', `${lines.join('\n')}\n`);
      child.emit('close', 1);
    });
    return child;
  };
  const got = [];
  const res = await setup.pip('python', ['install', 'torch'], (l) => got.push(l), { spawn });
  assert.equal(res.ok, false);
  assert.deepEqual(res.tail, ['Collecting torch', 'ERROR: No matching distribution found for torch==9']);
  assert.equal(got.length, 202, 'but they all reach the bar');
});

test('whether a pip can print its progress is read from its own help; an older one is made newer first, and a failure of that is no reason to stop', async () => {
  const help = (text) => (_py, args) => ({ ok: true, out: args.includes('--help') ? text : '' });
  assert.equal(await setup.supportsRawProgress('py', { run: help('--progress-bar <progress_bar>\n Specify whether the progress bar should be used.\n [auto, on, off, raw] (default: auto)') }), true);
  assert.equal(await setup.supportsRawProgress('py', { run: help('--progress-bar <progress_bar>\n Specify whether the progress bar should be used [on, off] (default: on)') }), false);
  assert.equal(await setup.supportsRawProgress('py', { run: () => ({ ok: false, out: '' }) }), false);
  // an old pip: it is upgraded, and then it can
  let upgraded = false;
  const run = (_py, args) => ({ ok: true, out: args.includes('--help') ? (upgraded ? '--progress-bar [auto, on, off, raw]' : '--progress-bar [on, off]') : '' });
  const calls = [];
  const pipFn = async (_py, args) => { calls.push(args); upgraded = true; return { ok: true, tail: [] }; };
  assert.deepEqual(await setup.preparePip('py', { run, pipFn }), { raw: true });
  assert.deepEqual(calls[0], ['install', '--upgrade', '--no-cache-dir', '--retries', '1', '--timeout', '15', 'pip']);
  // one that is new enough is left alone
  const fine = [];
  assert.deepEqual(await setup.preparePip('py', { run: help('--progress-bar [auto, on, off, raw]'), pipFn: async (_p, a) => { fine.push(a); return { ok: true }; } }), { raw: true });
  assert.deepEqual(fine, []);
  // an upgrade that fails: the install goes on without the lines
  assert.deepEqual(await setup.preparePip('py', { run: help('--progress-bar [on, off]'), pipFn: async () => ({ ok: false, tail: ['no network'] }) }), { raw: false });
});

// ---- the model ----

const hub = (home) => path.join(home, 'huggingface', 'hub', 'models--ResembleAI--chatterbox', 'blobs');
const blob = (home, name, bytes) => { fs.mkdirSync(hub(home), { recursive: true }); fs.writeFileSync(path.join(hub(home), name), Buffer.alloc(bytes, 1)); };

test('the download of the model is how much of it is in the cache: growing is downloading, all there and still is loading, and the bar does not run over', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'hf-'));
  const cb = new Chatterbox({ port: async () => 1, roots: () => [] });
  cb.cache = path.join(home, 'huggingface');
  cb.expect = 4000; // (a small stand-in for the 3.2 GB)
  const changes = [];
  cb.on('change', (s) => changes.push(s));
  cb.watchModel();
  assert.equal(cb.progress, null, 'nothing in the cache: nothing is downloading');
  blob(home, 'abc.incomplete', 1000);
  cb.watchModel();
  assert.equal(cb.progress, 0.25);
  assert.equal(cb.status().bytes, 1000);
  blob(home, 'abc.incomplete', 3000);
  cb.watchModel();
  assert.equal(cb.progress, 0.75, 'over all the files: not each one from the start');
  fs.renameSync(path.join(hub(home), 'abc.incomplete'), path.join(hub(home), 'abc'));
  blob(home, 'def', 800);
  cb.watchModel();
  assert.ok(cb.progress > 0.9 && cb.progress <= 0.99, `a file after a file: the bar goes on (${cb.progress})`);
  cb.watchModel(); // (nothing grew, nothing is incomplete: it is all there)
  assert.equal(cb.progress, null, 'it is being put into memory now');
  blob(home, 'ghi', 8000);
  cb.watchModel();
  assert.ok(cb.progress === null || cb.progress <= 0.99);
  assert.ok(cb.expect >= 11800, 'a model larger than thought moves the end');
  assert.ok(changes.length >= 3);
});

test('without a cache of hers the usual place of the model hub is looked at, and nothing there is nothing', () => {
  const cb = new Chatterbox({ port: async () => 1, roots: () => [] });
  cb.cache = '';
  const before = process.env.HUGGINGFACE_HUB_CACHE;
  process.env.HUGGINGFACE_HUB_CACHE = path.join(tmp, 'nowhere');
  try {
    cb.watchModel();
    assert.equal(cb.progress, null);
    assert.equal(cb.status().bytes, 0);
  } finally {
    if (before === undefined) delete process.env.HUGGINGFACE_HUB_CACHE;
    else process.env.HUGGINGFACE_HUB_CACHE = before;
  }
});

test('the voice says a line to prove that it speaks: wav back is speech, an error is told as it came, a scrap is not speech', async () => {
  const ok = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4000, 1)]);
  const make = (reply) => {
    const cb = new Chatterbox({ port: async () => 1, roots: () => [], fetchFn: async (url, init) => reply(url, init) });
    cb.ready = async () => 'http://127.0.0.1:9/v1';
    return cb;
  };
  const seen = [];
  const good = make((url, init) => { seen.push([url, JSON.parse(init.body)]); return { ok: true, arrayBuffer: async () => ok }; });
  const res = await good.check({}, 'ru');
  assert.equal(res.ok, true);
  assert.equal(seen[0][0], 'http://127.0.0.1:9/v1/audio/speech');
  assert.equal(seen[0][1].input, 'Привет.');
  assert.equal(seen[0][1].language, 'ru');
  const bad = make(() => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'CUDA out of memory' } }) }));
  await assert.rejects(() => bad.check({}, 'en'), /CUDA out of memory/);
  const scrap = make(() => ({ ok: true, arrayBuffer: async () => Buffer.from('nope') }));
  await assert.rejects(() => scrap.check({}, 'en'), /not speech/);
});

test('torch and torchaudio of one version, and what pip finds wrong is read from its words', async () => {
  assert.equal(setup.sameTorch({ version: '2.6.0', audio: '2.6.0' }), true);
  assert.equal(setup.sameTorch({ version: '2.6.0', audio: '2.6.1' }), true, 'a fix release of one is the same');
  assert.equal(setup.sameTorch({ version: '2.7.1', audio: '2.6.0' }), false);
  assert.equal(setup.sameTorch({ version: '2.6.0', audio: '' }), true, 'no torchaudio: nothing to differ from');
  assert.deepEqual(await setup.pipCheck('py', { run: () => ({ ok: true, out: 'No broken requirements found.' }) }), []);
  assert.deepEqual(await setup.pipCheck('py', { run: () => ({ ok: false, out: 'chatterbox-tts 0.1.4 has requirement torch==2.6.0, but you have torch 2.7.1.\nsomething else' }) }), ['chatterbox-tts 0.1.4 has requirement torch==2.6.0, but you have torch 2.7.1.']);
});
