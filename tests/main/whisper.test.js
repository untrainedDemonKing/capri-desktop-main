'use strict';

// Her ears on this PC (src/main/voice/whisper.js, used by src/main/voice/stt.js): finding the server program and a model,
// picking the model that suits a PC, fetching both from stand-in servers, and keeping the server standing and asking it, against
// a stand-in of whisper.cpp's server (tests/fixtures/fake-whisper.js).
//   node --test tests/main/whisper.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { Whisper, assetFor, tierFor, threadsFor, isModel, silence, TIERS, RELEASES, VERSIONS, MODELS } = require('../../src/main/voice/whisper.js');
const stt = require('../../src/main/voice/stt.js');
const hardware = require('../../src/main/setup/hardware.js');

const posix = process.platform !== 'win32';
const GB = 1024 ** 3;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-whisper-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const mk = (...p) => { const d = path.join(tmp, `${n++}`, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const touch = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const model = (f, body = '') => touch(f, `lmgg${body}`.padEnd(64 + (/base/.test(f) ? 0 : /small/.test(f) ? 100 : 400), '.')); // a file that begins as a ggml model does (and a bigger model is a bigger file)

// a folder as people drop it next to her: the server (the stand-in) and a model
function whisperFolder(root, { file = 'ggml-small-q5_1.bin', body = '' } = {}) {
  const dir = path.join(root, 'whisper');
  const exe = path.join(dir, process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'fake-whisper.js'), exe);
  fs.chmodSync(exe, 0o755);
  if (file) model(path.join(dir, 'models', file), body);
  return dir;
}

const pc = (over = {}) => hardware.make({
  platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'AMD64' }, ram: 16 * GB, ramFree: 8 * GB,
  cpu: { name: '', cores: 8, threads: 8 }, gpus: [], disk: { path: '', free: 100 * GB, total: 200 * GB }, ...over,
});

// ---- what suits a PC ----

test('the program for each system, the model for each PC, the threads it may use', () => {
  assert.equal(assetFor('win32', 'x64', true), 'whisper-bin-x64.zip');
  assert.equal(assetFor('win32', 'ia32', true), 'whisper-bin-x64.zip', 'her 32-bit build on a 64-bit Windows');
  assert.equal(assetFor('win32', 'ia32', false), 'whisper-bin-Win32.zip', 'a 32-bit Windows');
  assert.equal(assetFor('win32', 'arm64', true), 'whisper-bin-x64.zip', 'Windows on ARM runs the 64-bit one');
  assert.equal(assetFor('linux', 'x64', true), '', 'no program of hers elsewhere: the one put next to her is used');
  assert.equal(tierFor(pc({ ram: 4 * GB })), 'base', 'a small PC');
  assert.equal(tierFor(pc({ ram: 8 * GB })), 'small');
  assert.equal(tierFor(pc({ ram: 32 * GB, cpu: { name: '', cores: 12, threads: 24 } })), 'turbo', 'a strong one');
  assert.equal(tierFor(pc({ ram: 32 * GB, cpu: { name: '', cores: 4, threads: 8 } })), 'small', 'memory without speed is not enough');
  assert.equal(tierFor(pc({ arch: 'ia32', env: { PROCESSOR_ARCHITECTURE: 'x86' }, ram: 16 * GB })), 'base', 'a 32-bit system');
  assert.equal(threadsFor(2), 2);
  assert.equal(threadsFor(8), 6);
  assert.equal(threadsFor(32), 8, 'never more than eight');
  for (const t of Object.values(TIERS)) assert.ok(t.file.endsWith('.bin') && t.min < t.bytes);
});

test('a ggml model is told by its first bytes; a page of an error, a short file or no file is not one', () => {
  const dir = mk('magic');
  assert.equal(isModel(model(path.join(dir, 'a.bin'))), true);
  assert.equal(isModel(touch(path.join(dir, 'b.bin'), '<html>404 Not Found</html>'.padEnd(64))), false);
  assert.equal(isModel(model(path.join(dir, 'c.bin')), { min: 1000 }), false, 'shorter than a whole one');
  assert.equal(isModel(path.join(dir, 'gone.bin')), false);
  const wav = silence(1);
  assert.equal(wav.length, 44 + 32000);
  assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000, 'the 16 kHz that ears.js sends too');
});

// ---- finding them ----

test('the program is found in the folder named in her settings, in a "whisper" folder next to her, or in the one she fetched', () => {
  const root = mk('roots');
  const beside = whisperFolder(root);
  const w = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'userdata', 'whisper'), platform: process.platform });
  assert.equal(w.locate({}).root, beside);
  assert.equal(path.basename(w.locate({}).exe), posix ? 'whisper-server' : 'whisper-server.exe');
  const named = whisperFolder(mk('named'));
  assert.equal(w.locate({ whisperDir: named }).root, named, 'the folder in her settings wins');
  assert.equal(w.locate({ whisperDir: mk('empty') }), null, 'and when it has no program, nothing else is looked at');
  const alone = new Whisper({ roots: () => [], defaultDir: () => path.join(mk('none'), 'whisper'), platform: process.platform });
  assert.equal(alone.locate({}), null);
  // (a program that came in a zip with a folder of its own around it)
  const nested = mk('nested', 'whisper', 'Release');
  fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'fake-whisper.js'), path.join(nested, posix ? 'whisper-server' : 'whisper-server.exe'));
  const z = new Whisper({ roots: () => [], defaultDir: () => path.dirname(nested), platform: process.platform });
  assert.equal(z.locate({}).dir, nested);
});

test('the models she has: only ggml files, the one named first, else the one that suits, else the biggest that is not too much', () => {
  const root = mk('models');
  const dir = whisperFolder(root, { file: 'ggml-base-q5_1.bin' });
  model(path.join(dir, 'models', 'ggml-small-q5_1.bin'));
  touch(path.join(dir, 'models', 'ggml-silero-v5.1.2.bin'), 'lmggVAD'.padEnd(64)); // (a model of something else)
  touch(path.join(dir, 'models', 'ggml-large.bin'), 'a page, not a model'.padEnd(64));
  const w = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'x'), platform: process.platform });
  assert.deepEqual(w.models({}).map((m) => m.name).sort(), ['ggml-base-q5_1.bin', 'ggml-small-q5_1.bin']);
  assert.equal(w.modelFor({}, 'small').name, 'ggml-small-q5_1.bin');
  assert.equal(w.modelFor({}, 'base').name, 'ggml-base-q5_1.bin');
  assert.equal(w.modelFor({ whisperModel: 'ggml-base-q5_1.bin' }, 'small').name, 'ggml-base-q5_1.bin', 'the one in her settings');
  assert.equal(w.modelFor({ whisperTier: 'base' }).name, 'ggml-base-q5_1.bin', 'the tier in her settings');
  assert.equal(w.modelFor({}, 'turbo').name, 'ggml-small-q5_1.bin', 'the biggest she has, when the wanted one is not there');
  model(path.join(dir, 'models', 'ggml-large-v3-turbo-q5_0.bin'));
  assert.equal(w.modelFor({}, 'small').name, 'ggml-small-q5_1.bin', 'a big one is not forced on a PC that picked the middle one');
  assert.equal(new Whisper({ roots: () => [], defaultDir: () => mk('no'), platform: process.platform }).modelFor({}), null);
});

// ---- fetching them ----

function zipOf(entries) {
  const zip = path.join(mk('zips'), 'w.zip');
  cp.execFileSync('python3', ['-I', '-c', `
import zipfile, json
z = zipfile.ZipFile(${JSON.stringify(zip)}, 'w')
for name, body in json.loads(${JSON.stringify(JSON.stringify(entries))}).items():
    z.writestr(name, body, compress_type=zipfile.ZIP_DEFLATED)
z.close()
`]);
  return fs.readFileSync(zip);
}

test('fetching the program on Windows: the first version that has it, the next when one is gone, then the newest the site names', async () => {
  const good = zipOf({ 'Release/whisper-server.exe': 'MZ'.repeat(500), 'Release/whisper.dll': 'dll', 'Release/main.exe': 'MZ' });
  const asked = [];
  const answer = (served) => async (url) => {
    asked.push(url);
    const body = served[url];
    return body ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) : new Response('nope', { status: 404 });
  };
  const make = (served, dir) => new Whisper({ platform: 'win32', arch: 'x64', is64: true, fetchFn: answer(served), defaultDir: () => dir, roots: () => [] });
  // the first version
  let dir = mk('w1', 'whisper');
  let loc = await make({ [`${RELEASES}/${VERSIONS[0]}/whisper-bin-x64.zip`]: good }, dir).install();
  assert.equal(loc.exe, path.join(dir, 'Release', 'whisper-server.exe'));
  assert.ok(fs.existsSync(path.join(dir, 'Release', 'whisper.dll')), 'its libraries come with it');
  assert.ok(!fs.existsSync(path.join(dir, 'whisper-bin-x64.zip')), 'the zip is not left behind');
  // the second, when the first is gone
  asked.length = 0;
  dir = mk('w2', 'whisper');
  loc = await make({ [`${RELEASES}/${VERSIONS[1]}/whisper-bin-x64.zip`]: good }, dir).install();
  assert.deepEqual(asked, [`${RELEASES}/${VERSIONS[0]}/whisper-bin-x64.zip`, `${RELEASES}/${VERSIONS[1]}/whisper-bin-x64.zip`]);
  assert.ok(loc.exe.endsWith('whisper-server.exe'));
  // the newest, when both are gone
  asked.length = 0;
  dir = mk('w3', 'whisper');
  const api = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest';
  const newest = 'https://github.com/ggml-org/whisper.cpp/releases/download/v9.9.9/whisper-bin-x64.zip';
  loc = await make({
    [api]: JSON.stringify({ assets: [{ name: 'whisper-bin-x64.zip', browser_download_url: newest }, { name: 'whisper-bin-Win32.zip', browser_download_url: 'x' }] }),
    [newest]: good,
  }, dir).install();
  assert.equal(asked.at(-1), newest);
  assert.ok(loc.exe.endsWith('whisper-server.exe'));
  // a package without a server in it is no package, said with where it was tried; nothing at all says so too
  const empty = zipOf({ 'Release/main.exe': 'MZ' });
  await assert.rejects(() => make({ [`${RELEASES}/${VERSIONS[0]}/whisper-bin-x64.zip`]: empty, [`${RELEASES}/${VERSIONS[1]}/whisper-bin-x64.zip`]: empty }, mk('w4', 'whisper')).install(), /no server program inside/);
  await assert.rejects(() => make({}, mk('w5', 'whisper')).install(), /answered 404|could not find|release list answered/);
  await assert.rejects(() => new Whisper({ platform: 'linux', arch: 'x64', defaultDir: () => mk('w6') }).install(), /no whisper\.cpp program for/);
});

test('fetching a model: into the models folder, checked to be one, from the mirror of the model hub where she is told to', async () => {
  const body = Buffer.concat([Buffer.from('lmgg'), Buffer.alloc(TIERS.base.min + 10, 7)]);
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    return url.endsWith(TIERS.base.file) ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) : new Response('<html>not a model</html>'.padEnd(TIERS.small.min + 5), { status: 200 });
  };
  const dir = mk('fm', 'whisper');
  const w = new Whisper({ fetchFn, defaultDir: () => dir, roots: () => [], platform: process.platform });
  const seen = [];
  const got = await w.fetchModel({}, 'base', { onProgress: (p) => seen.push(p) });
  assert.equal(got.file, path.join(dir, 'models', TIERS.base.file));
  assert.equal(asked[0], `${MODELS}/${TIERS.base.file}`);
  assert.equal(seen.at(-1).completed, body.length);
  assert.equal(w.models({}).length, 1, 'and now she has it');
  await w.fetchModel({ hfEndpoint: 'https://hf-mirror.test/' }, 'base');
  assert.equal(asked.at(-1), `https://hf-mirror.test/ggerganov/whisper.cpp/resolve/main/${TIERS.base.file}`);
  // a page saved as a model is refused and does not stay
  const bad = new Whisper({ fetchFn, defaultDir: () => mk('fm2', 'whisper'), roots: () => [], platform: process.platform });
  await assert.rejects(() => bad.fetchModel({}, 'small'), /is not a model/);
  assert.equal(bad.models({}).length, 0);
  const down = new Whisper({ fetchFn: async () => new Response('', { status: 503 }), defaultDir: () => mk('fm3', 'whisper'), roots: () => [], platform: process.platform });
  await assert.rejects(() => down.fetchModel({}, 'small'), /answered 503/);
});

// ---- the server ----

test('nothing installed: asking for the address says so with a code she acts on', async () => {
  const w = new Whisper({ roots: () => [], defaultDir: () => mk('nothing', 'whisper'), platform: process.platform });
  await assert.rejects(() => w.ready({}), (err) => err.code === 'nolocal');
  await assert.rejects(() => stt.transcribe({ sttEngine: 'local' }, {}, { audio: silence(1), mime: 'audio/wav' }, { whisper: w }), (err) => err.code === 'nolocal');
  const bare = whisperFolder(mk('bare'), { file: '' });
  await assert.rejects(() => new Whisper({ roots: () => [path.dirname(bare)], defaultDir: () => mk('x'), platform: process.platform }).ready({}), (err) => err.code === 'nolocal', 'a program with no model');
});

test('the server is started once for any number of asks, in the model\'s folder with the model by its file name, and asked about a second of quiet', { skip: !posix }, async () => {
  const root = mk('run');
  const dir = whisperFolder(root);
  const log = path.join(root, 'log.jsonl');
  process.env.FAKE_WHISPER_LOG = log;
  const w = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'x'), threads: 3 });
  const changes = [];
  w.on('change', (st) => changes.push(st.phase));
  try {
    const [a, b, c] = await Promise.all([w.ready({}), w.ready({}), w.ready({})]);
    assert.equal(a, b);
    assert.equal(b, c);
    assert.match(a, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(w.status().phase, 'ready');
    assert.equal(w.status().model, 'ggml-small-q5_1.bin');
    assert.deepEqual(changes.slice(0, 2), ['starting', 'ready']);
    const st = await w.check({});
    assert.equal(st.phase, 'ready');
    const asked = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(asked.length, 1, 'the check asked once');
    assert.equal(asked[0].fields.response_format, 'json');
    assert.deepEqual(asked[0].args, ['-m', 'ggml-small-q5_1.bin', '--host', '127.0.0.1', '--port', a.split(':').pop(), '-t', '3', '-l', 'auto']);
    assert.equal(asked[0].bytes, silence(1).length);
    assert.equal(await w.ready({}), a, 'and it is still the same server');
    // another model: another server
    model(path.join(dir, 'models', 'ggml-base-q5_1.bin'));
    const other = await w.ready({ whisperModel: 'ggml-base-q5_1.bin' });
    assert.notEqual(other, a);
    assert.equal(w.status().model, 'ggml-base-q5_1.bin');
  } finally {
    w.stop();
    delete process.env.FAKE_WHISPER_LOG;
  }
  assert.equal(w.status().phase, 'off');
});

test('speech goes through the server as a wav, in the language she is told or "whichever", and the words come back without what it made up for a noise', { skip: !posix }, async () => {
  const root = mk('speak');
  whisperFolder(root);
  const log = path.join(root, 'log.jsonl');
  process.env.FAKE_WHISPER_LOG = log;
  process.env.FAKE_WHISPER_TEXT = 'Открой Spotify.';
  const w = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'x') });
  const loud = Buffer.from(silence(1));
  for (let i = 44; i < loud.length; i += 2) loud.writeInt16LE(Math.round(Math.sin(i / 9) * 8000), i);
  try {
    const cfg = { sttEngine: 'local' };
    assert.equal(await stt.transcribe(cfg, {}, { audio: loud, mime: 'audio/wav', lang: 'ru' }, { whisper: w }), 'Открой Spotify.');
    assert.equal(await stt.transcribe(cfg, {}, { audio: silence(1), mime: 'audio/wav', lang: 'ru' }, { whisper: w }), '', 'quiet is no words');
    assert.equal(await stt.transcribe(cfg, {}, { audio: loud, mime: 'audio/wav', lang: '', hint: 'ru' }, { whisper: w }), 'Открой Spotify.');
    const asked = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(asked[0].fields.language, 'ru');
    assert.equal(asked[0].fields.response_format, 'verbose_json');
    assert.match(asked[0].fields.prompt, /Капри/, 'her name and the apps are hinted');
    assert.equal(asked[2].fields.language, undefined, 'no language told: the recogniser hears which');
    assert.equal(asked[0].fields.model, undefined, 'a model of its own: no name is sent');
    // a server that knows only the plain answer is asked for that
    process.env.FAKE_WHISPER_NO_VERBOSE = '1';
    w.stop();
    assert.equal(await stt.transcribe(cfg, {}, { audio: loud, mime: 'audio/wav', lang: 'ru' }, { whisper: w }), 'Открой Spotify.');
  } finally {
    w.stop();
    for (const k of ['FAKE_WHISPER_LOG', 'FAKE_WHISPER_TEXT', 'FAKE_WHISPER_NO_VERBOSE']) delete process.env[k];
  }
});

test('a model that will not load is a clear failure with the program\'s own words; one that dies later is told as that, with a code', { skip: !posix }, async () => {
  const root = mk('broken');
  whisperFolder(root, { body: 'BROKEN' });
  const w = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'x'), startTimeout: 5000 });
  await assert.rejects(() => w.ready({}), (err) => err.code === 'exited' && /failed to initialize whisper context|not all tensors/.test(err.message));
  assert.equal(w.status().phase, 'failed');
  assert.ok(w.status().log.some((l) => /tensors/.test(l)));
  // a good one, killed under her
  const ok = mk('killed');
  whisperFolder(ok);
  const v = new Whisper({ roots: () => [ok], defaultDir: () => path.join(ok, 'x') });
  const base = await v.ready({});
  v.proc.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(v.status().phase, 'failed');
  await assert.rejects(() => stt.transcribe({ sttEngine: 'local' }, {}, { audio: silence(1), mime: 'audio/wav' }, { whisper: { ready: async () => base, status: () => v.status(), rest() {} } }), (err) => err.code === 'exited', 'asking a server that is gone');
  // and it is started again by the next ask
  assert.match(await v.ready({}), /^http:\/\/127\.0\.0\.1:\d+$/);
  v.stop();
});

test('a server nobody asks goes away after a while, and starts again when asked', { skip: !posix }, async () => {
  const root = mk('idle');
  whisperFolder(root);
  const w = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'x'), idleMs: 250 });
  await w.ready({});
  assert.equal(w.status().phase, 'ready');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(w.status().phase, 'off');
  assert.equal(w.proc, null);
  await w.ready({});
  assert.equal(w.status().phase, 'ready');
  w.stop();
});

test('a server that is slow to load is waited for, and one that never comes up is ended and said', { skip: !posix }, async () => {
  const root = mk('slow');
  whisperFolder(root);
  process.env.FAKE_WHISPER_LOAD_MS = '700';
  try {
    const w = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'x') });
    await w.ready({});
    assert.equal(w.status().phase, 'ready', 'a model takes a while to load');
    w.stop();
    process.env.FAKE_WHISPER_LOAD_MS = '60000';
    const never = new Whisper({ roots: () => [root], defaultDir: () => path.join(root, 'x'), startTimeout: 800 });
    await assert.rejects(() => never.ready({}), (err) => err.code === 'timeout');
    assert.equal(never.proc, null, 'ended');
  } finally {
    delete process.env.FAKE_WHISPER_LOAD_MS;
  }
});

// ---- which engine answers ----

test('a cloud service with no key saved is not an engine: the one on this PC answers; with a key, the cloud one', () => {
  assert.equal(stt.engineFor({ sttEngine: 'groq' }, {}), 'local');
  assert.equal(stt.engineFor({ sttEngine: 'groq' }, { groq: 'gsk-1' }), 'groq');
  assert.equal(stt.engineFor({ sttEngine: 'openai' }, { groq: 'gsk-1' }), 'local', 'another service\'s key does not count');
  assert.equal(stt.engineFor({}, {}), 'local', 'nothing chosen');
  assert.equal(stt.engineFor({ sttEngine: 'nonsense' }, {}), 'local');
  assert.equal(stt.engineFor({ sttEngine: 'custom', sttUrl: 'http://127.0.0.1:9/v1' }, {}), 'custom', 'a server of your own needs no key');
  assert.equal(stt.engineFor({ sttEngine: 'local' }, { groq: 'gsk-1' }), 'local');
});
