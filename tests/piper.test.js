'use strict';

// Her light voice (src/main/piper.js) and the file tools it fetches with (src/main/fetch-files.js): finding the
// program and the voices, picking a voice from the library's index, fetching both from a stand-in server, and
// speaking through a stand-in of the program that makes a tone for every line.
//   node --test tests/piper.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const { Piper, assetFor, pickVoice, voicesIn, RELEASE, VOICES, STYLE } = require('../src/main/piper.js');
const files = require('../src/main/fetch-files.js');

const posix = process.platform !== 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-piper-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const mk = (...p) => { const d = path.join(tmp, `${n++}`, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const touch = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

// a folder as people drop it next to her: the program (the stand-in), and a voice
function piperFolder(root, { voice = 'ru_RU-irina-medium', body = 'MODEL' } = {}) {
  const dir = path.join(root, 'piper');
  const exe = path.join(dir, process.platform === 'win32' ? 'piper.exe' : 'piper');
  fs.mkdirSync(path.join(dir, 'espeak-ng-data'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-piper.js'), exe);
  fs.chmodSync(exe, 0o755);
  if (voice) {
    touch(path.join(dir, 'voices', `${voice}.onnx`), body);
    touch(path.join(dir, 'voices', `${voice}.onnx.json`), '{}');
  }
  return dir;
}

// the library's index and files, served from memory
function library() {
  const onnx = Buffer.from('ONNX-MODEL-OF-IRINA'.repeat(500));
  const json = Buffer.from('{"audio":{"sample_rate":22050}}');
  const amy = Buffer.from('AMY'.repeat(300));
  const index = {
    'ru_RU-irina-medium': { key: 'ru_RU-irina-medium', name: 'irina', language: { family: 'ru', code: 'ru_RU' }, quality: 'medium', files: {
      'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx': { size_bytes: onnx.length, md5_digest: md5(onnx) },
      'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json': { size_bytes: json.length, md5_digest: md5(json) },
      'ru/ru_RU/irina/medium/MODEL_CARD': { size_bytes: 10, md5_digest: 'x' },
    } },
    'en_US-amy-low': { key: 'en_US-amy-low', language: { family: 'en' }, quality: 'low', files: {
      'en/en_US/amy/low/en_US-amy-low.onnx': { size_bytes: amy.length, md5_digest: md5(amy) },
      'en/en_US/amy/low/en_US-amy-low.onnx.json': { size_bytes: json.length, md5_digest: md5(json) },
    } },
    'en_GB-alan-medium': { key: 'en_GB-alan-medium', language: { family: 'en' }, quality: 'medium', files: {
      'en/en_GB/alan/medium/en_GB-alan-medium.onnx': { size_bytes: amy.length, md5_digest: md5(amy) },
      'en/en_GB/alan/medium/en_GB-alan-medium.onnx.json': { size_bytes: json.length, md5_digest: md5(json) },
    } },
  };
  const served = new Map([
    [`${VOICES}/voices.json`, Buffer.from(JSON.stringify(index))],
    [`${VOICES}/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx`, onnx],
    [`${VOICES}/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json`, json],
    [`${VOICES}/en/en_US/amy/low/en_US-amy-low.onnx`, amy],
    [`${VOICES}/en/en_US/amy/low/en_US-amy-low.onnx.json`, json],
    [`${VOICES}/en/en_GB/alan/medium/en_GB-alan-medium.onnx`, amy],
    [`${VOICES}/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json`, json],
  ]);
  const requested = [];
  const fetchFn = async (url) => {
    requested.push(url);
    const body = served.get(url);
    return body ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) : new Response('not found', { status: 404 });
  };
  return { index, served, fetchFn, requested, onnx };
}

// ---- the library's index ----

test('the program for each system, and none for a 32-bit Windows', () => {
  assert.equal(assetFor('win32', 'x64', true), 'piper_windows_amd64.zip');
  assert.equal(assetFor('win32', 'ia32', true), 'piper_windows_amd64.zip', 'her 32-bit build on a 64-bit Windows');
  assert.equal(assetFor('win32', 'ia32', false), '');
  assert.equal(assetFor('linux', 'x64'), 'piper_linux_x86_64.tar.gz');
  assert.equal(assetFor('linux', 'arm64'), 'piper_linux_aarch64.tar.gz');
  assert.equal(assetFor('darwin', 'arm64'), 'piper_macos_aarch64.tar.gz');
  assert.equal(assetFor('freebsd', 'x64'), '');
});

test('the voice for a language: the one she likes, else any of the language (the best quality), else none', () => {
  const { index } = library();
  assert.equal(pickVoice(index, 'ru').key, 'ru_RU-irina-medium');
  assert.deepEqual(pickVoice(index, 'ru').files.map((f) => f.path.split('/').pop()), ['ru_RU-irina-medium.onnx', 'ru_RU-irina-medium.onnx.json'], 'the model and its config, not the model card');
  assert.equal(pickVoice(index, 'en').key, 'en_GB-alan-medium', 'none of her favourites is there: the medium one over the low one');
  assert.equal(pickVoice(index, 'en', 'en_US-amy-low').key, 'en_US-amy-low', 'the one named in her settings');
  assert.equal(pickVoice(index, 'en', 'nonsense').key, 'en_GB-alan-medium', 'a name the library does not know is ignored');
  assert.equal(pickVoice(index, 'fr'), null);
  assert.equal(pickVoice({}, 'ru'), null);
  assert.equal(pickVoice(null, 'ru'), null);
});

// ---- finding it ----

test('voices lying in a folder: a model with its config beside it', () => {
  const dir = mk('voices-here');
  touch(path.join(dir, 'ru_RU-irina-medium.onnx'));
  touch(path.join(dir, 'ru_RU-irina-medium.onnx.json'));
  touch(path.join(dir, 'lonely.onnx')); // no config: not a voice
  touch(path.join(dir, 'deep', 'er', 'en_US-amy-medium.onnx'));
  touch(path.join(dir, 'deep', 'er', 'en_US-amy-medium.onnx.json'));
  assert.deepEqual(voicesIn(dir).map((v) => v.key).sort(), ['en_US-amy-medium', 'ru_RU-irina-medium']);
  assert.deepEqual(voicesIn(path.join(dir, 'missing')), []);
});

test('the program and the voices: the folder in her settings, then a "piper" folder next to her, then the one she fetched', { skip: !posix && 'the stand-in is a script' }, () => {
  const root = mk('next-to-her');
  const own = mk('own');
  const fetched = mk('userdata', 'piper');
  const piper = new Piper({ roots: () => [root], defaultDir: () => fetched });
  assert.equal(piper.locate({}), null, 'nothing yet');
  piperFolder(fetched, { voice: 'en_US-amy-medium' });
  fs.renameSync(path.join(fetched, 'piper'), path.join(fetched, 'fetched'));
  assert.match(piper.locate({}).exe, /fetched/);
  piperFolder(root);
  assert.equal(piper.locate({}).root, path.join(root, 'piper'), 'next to her wins over what she fetched');
  piperFolder(own, { voice: 'fr_FR-siwis-medium' });
  assert.equal(piper.locate({ piperDir: path.join(own, 'piper') }).root, path.join(own, 'piper'), 'the folder in her settings wins over both');
  assert.equal(piper.locate({ piperDir: path.join(own, 'nowhere') }), null, 'a folder named in her settings that is not there is not replaced by another');
  const keys = piper.voices({}).map((v) => v.key).sort();
  assert.deepEqual(keys, ['en_US-amy-medium', 'ru_RU-irina-medium'], 'every voice she has, wherever');
  assert.equal(piper.voiceFor({}, 'ru').key, 'ru_RU-irina-medium');
  assert.equal(piper.voiceFor({}, 'en').key, 'en_US-amy-medium');
  assert.equal(piper.voiceFor({}, 'pt'), null, 'a voice of another language is not used for Portuguese');
  assert.equal(piper.voiceFor({ ttsVoice: 'en_US-amy-medium' }, 'ru').key, 'en_US-amy-medium', 'the voice named in her settings, if she has it');
  assert.equal(piper.voiceFor({ ttsVoice: 'nova' }, 'ru').key, 'ru_RU-irina-medium', 'a name from another engine (OpenAI\'s "nova") means nothing here');
});

// ---- fetching it ----

test('unzip: files stored and deflated, folders, and a path that leaves the folder is refused', async () => {
  const dir = mk('zips');
  const good = path.join(dir, 'good.zip');
  cp.execFileSync('python3', ['-I', '-c', `
import zipfile
z = zipfile.ZipFile(${JSON.stringify(good)}, 'w')
z.writestr('piper/', '')
z.writestr('piper/piper.exe', 'MZ' * 5000, compress_type=zipfile.ZIP_DEFLATED)
z.writestr('piper/espeak-ng-data/voices/ru', 'name Russian', compress_type=zipfile.ZIP_STORED)
z.writestr('piper/empty.txt', '')
z.close()
`]);
  const out = path.join(dir, 'out');
  const seen = [];
  await files.unzip(good, out, { onProgress: (p) => seen.push(p) });
  assert.equal(fs.readFileSync(path.join(out, 'piper', 'piper.exe'), 'utf8'), 'MZ'.repeat(5000));
  assert.equal(fs.readFileSync(path.join(out, 'piper', 'espeak-ng-data', 'voices', 'ru'), 'utf8'), 'name Russian');
  assert.equal(fs.readFileSync(path.join(out, 'piper', 'empty.txt'), 'utf8'), '');
  assert.ok(seen.length >= 2 && seen[seen.length - 1].completed === seen[seen.length - 1].total);
  assert.equal(files.findFile(out, ['piper.exe']), path.join(out, 'piper', 'piper.exe'));
  const evil = path.join(dir, 'evil.zip');
  cp.execFileSync('python3', ['-I', '-c', `
import zipfile
z = zipfile.ZipFile(${JSON.stringify(evil)}, 'w')
z.writestr('../escaped.txt', 'no')
z.close()
`]);
  await assert.rejects(() => files.unzip(evil, path.join(dir, 'evil-out')), /outside its folder/);
  assert.equal(fs.existsSync(path.join(dir, 'escaped.txt')), false);
  fs.writeFileSync(path.join(dir, 'junk.zip'), 'not a zip at all');
  await assert.rejects(() => files.unzip(path.join(dir, 'junk.zip'), path.join(dir, 'junk-out')), /not a zip/);
});

test('download: with its progress, through a .part file, checked against a checksum, a bad one leaves nothing', async () => {
  const dir = mk('dl');
  const body = Buffer.alloc(300000, 7);
  const fetchFn = async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
  const seen = [];
  await files.download('https://x.test/a.bin', path.join(dir, 'a.bin'), { fetchFn, onProgress: (p) => seen.push(p), md5: md5(body) });
  assert.equal(fs.readFileSync(path.join(dir, 'a.bin')).length, 300000);
  assert.equal(fs.existsSync(path.join(dir, 'a.bin.part')), false);
  assert.equal(seen[seen.length - 1].completed, 300000);
  await assert.rejects(() => files.download('https://x.test/b.bin', path.join(dir, 'b.bin'), { fetchFn, md5: 'f'.repeat(32) }), /damaged/);
  assert.equal(fs.existsSync(path.join(dir, 'b.bin')), false);
  assert.equal(fs.existsSync(path.join(dir, 'b.bin.part')), false);
  await assert.rejects(() => files.download('https://x.test/c.bin', path.join(dir, 'c.bin'), { fetchFn: async () => new Response('nope', { status: 404 }) }), /answered 404/);
  const ctl = new AbortController();
  const slow = async (_u, { signal }) => new Response(new ReadableStream({ start(c) { signal.addEventListener('abort', () => c.error(new Error('aborted'))); c.enqueue(new Uint8Array(1000)); } }), { status: 200, headers: { 'content-length': '999999' } });
  const job = files.download('https://x.test/d.bin', path.join(dir, 'd.bin'), { fetchFn: slow, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(job);
  assert.equal(fs.existsSync(path.join(dir, 'd.bin.part')), false, 'a stopped download leaves no half file');
});

test('fetching the program: the release for this system is downloaded, unpacked into her folder and found', { skip: !posix && 'tar' }, async () => {
  const src = mk('release-src');
  piperFolder(src, { voice: '' });
  fs.rmSync(path.join(src, 'piper', 'voices'), { recursive: true, force: true });
  const tgz = path.join(mk('release'), 'piper_linux_x86_64.tar.gz');
  cp.execFileSync('tar', ['-czf', tgz, '-C', src, 'piper']);
  const body = fs.readFileSync(tgz);
  const asked = [];
  const fetchFn = async (url) => { asked.push(url); return url.endsWith('piper_linux_x86_64.tar.gz') ? new Response(body, { headers: { 'content-length': String(body.length) } }) : new Response('', { status: 404 }); };
  const dir = mk('userdata', 'piper');
  const piper = new Piper({ platform: 'linux', arch: 'x64', fetchFn, defaultDir: () => dir, roots: () => [] });
  const seen = [];
  const loc = await piper.install({ onProgress: (p) => seen.push(p) });
  assert.deepEqual(asked, [`${RELEASE}/piper_linux_x86_64.tar.gz`]);
  assert.equal(loc.exe, path.join(dir, 'piper', 'piper'));
  assert.ok(fs.statSync(loc.exe).mode & 0o100, 'it can be run');
  assert.ok(fs.existsSync(path.join(dir, 'piper', 'espeak-ng-data')));
  assert.equal(fs.existsSync(path.join(dir, 'piper_linux_x86_64.tar.gz')), false, 'the archive is cleared away');
  assert.ok(seen.length > 0);
  await assert.rejects(() => new Piper({ platform: 'win32', arch: 'ia32', is64: false, defaultDir: () => dir }).install(), /no program for/);
  await assert.rejects(() => new Piper({ platform: 'linux', arch: 'x64', fetchFn: async () => new Response('', { status: 404 }), defaultDir: () => mk('u2') }).install(), /answered 404/);
});

test('fetching the program on Windows: the zip is unpacked by her own unzip, and piper.exe is found', async () => {
  const dir = mk('win-userdata', 'piper');
  const zip = path.join(mk('win-release'), 'piper_windows_amd64.zip');
  cp.execFileSync('python3', ['-I', '-c', `
import zipfile
z = zipfile.ZipFile(${JSON.stringify(zip)}, 'w')
z.writestr('piper/piper.exe', 'MZ' * 1000, compress_type=zipfile.ZIP_DEFLATED)
z.writestr('piper/espeak-ng.dll', 'dll')
z.writestr('piper/espeak-ng-data/en_dict', 'dict')
z.close()
`]);
  const body = fs.readFileSync(zip);
  const fetchFn = async (url) => (url === `${RELEASE}/piper_windows_amd64.zip` ? new Response(body, { headers: { 'content-length': String(body.length) } }) : new Response('', { status: 404 }));
  const piper = new Piper({ platform: 'win32', arch: 'ia32', is64: true, fetchFn, defaultDir: () => dir, roots: () => [] });
  const loc = await piper.install();
  assert.equal(loc.exe, path.join(dir, 'piper', 'piper.exe'));
  assert.ok(fs.existsSync(path.join(dir, 'piper', 'espeak-ng-data', 'en_dict')));
});

test('fetching a voice: the index is read, the model and its config are downloaded and checked, into the voices folder', async () => {
  const lib = library();
  const dir = mk('userdata-v', 'piper');
  const piper = new Piper({ fetchFn: lib.fetchFn, defaultDir: () => dir, roots: () => [] });
  const seen = [];
  const v = await piper.fetchVoice({}, 'ru', { onProgress: (p) => seen.push(p) });
  assert.equal(v.key, 'ru_RU-irina-medium');
  assert.equal(v.onnx, path.join(dir, 'voices', 'ru_RU-irina-medium.onnx'));
  assert.equal(fs.readFileSync(v.onnx).length, lib.onnx.length);
  assert.ok(fs.existsSync(`${v.onnx}.json`));
  assert.ok(!lib.requested.some((u) => /MODEL_CARD/.test(u)), 'the model card is not needed');
  assert.ok(seen.some((p) => p.completed > 0 && p.completed < p.total), 'the bar goes from empty to full over both files');
  assert.equal(seen[seen.length - 1].completed, seen[seen.length - 1].total);
  assert.equal(piper.voiceFor({}, 'ru').key, 'ru_RU-irina-medium', 'and now she has it');
  await assert.rejects(() => piper.fetchVoice({}, 'fr'), /no voice for "fr"/);
  const broken = library();
  broken.served.set(`${VOICES}/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx`, Buffer.from('damaged on the way'));
  await assert.rejects(() => new Piper({ fetchFn: broken.fetchFn, defaultDir: () => mk('userdata-w', 'piper'), roots: () => [] }).fetchVoice({}, 'ru'), /damaged|stopped at/);
  const down = new Piper({ fetchFn: async () => new Response('', { status: 503 }), defaultDir: () => mk('userdata-x', 'piper'), roots: () => [] });
  await assert.rejects(() => down.fetchVoice({}, 'ru'), /voice library answered 503/);
});

test('where the model hub is blocked, the mirror in her settings serves the voice library', async () => {
  const lib = library();
  const mirror = 'https://hf-mirror.test';
  const fetchFn = async (url, opts) => lib.fetchFn(url.replace(mirror, 'https://huggingface.co'), opts);
  const asked = [];
  const piper = new Piper({ fetchFn: async (url, opts) => { asked.push(url); return fetchFn(url, opts); }, defaultDir: () => mk('userdata-m', 'piper'), roots: () => [] });
  const v = await piper.fetchVoice({ hfEndpoint: `${mirror}/` }, 'ru');
  assert.equal(v.key, 'ru_RU-irina-medium');
  assert.ok(asked.length === 3 && asked.every((u) => u.startsWith(`${mirror}/rhasspy/piper-voices/resolve/main/`)), asked.join('\n'));
});

test('a voice goes next to the program that is already there (a folder she was given), not somewhere else', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('given');
  piperFolder(root, { voice: '' });
  const lib = library();
  const piper = new Piper({ fetchFn: lib.fetchFn, roots: () => [root], defaultDir: () => mk('elsewhere') });
  const v = await piper.fetchVoice({}, 'ru');
  assert.equal(v.onnx, path.join(root, 'piper', 'voices', 'ru_RU-irina-medium.onnx'));
});

// ---- speaking ----

const wavSeconds = (b) => (b.length - 44) / 2 / 22050;

test('speaking: the line goes to the running program and its wav comes back; one program serves every line, in order', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('speak');
  piperFolder(root);
  const log = path.join(root, 'asked.jsonl');
  process.env.FAKE_PIPER_LOG = log;
  const piper = new Piper({ roots: () => [root], defaultDir: () => mk('nothing') });
  try {
    const changes = [];
    piper.on('change', (s) => changes.push(s.phase));
    const first = await piper.speak({}, { text: 'Привет, я Капри.', lang: 'ru' });
    assert.equal(first.subarray(0, 4).toString(), 'RIFF');
    assert.equal(first.readUInt32LE(24), 22050);
    // three at once: answered in the order asked, each its own length
    const [a, b, c] = await Promise.all([
      piper.speak({}, { text: 'a', lang: 'ru' }),
      piper.speak({}, { text: 'a much longer line than the first one, which makes a longer tone', lang: 'ru' }),
      piper.speak({}, { text: 'bb', lang: 'ru' }),
    ]);
    assert.ok(wavSeconds(b) > wavSeconds(a) && wavSeconds(b) > wavSeconds(c), 'each got its own answer');
    const asked = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(asked.map((r) => r.text.slice(0, 3)), ['При', 'a', 'a m', 'bb']);
    assert.equal(new Set(asked.map((r) => r.pid)).size, 1, 'one program for all of them');
    assert.equal(asked[0].model, 'ru_RU-irina-medium.onnx');
    // she is quick, lively and a little teasing: the program is asked for a livelier delivery than its reading-aloud default
    const flag = (name) => asked[0].args[asked[0].args.indexOf(name) + 1];
    assert.ok(Number(flag('--length_scale')) < 1, 'a bit faster');
    assert.ok(Number(flag('--noise_scale')) > 0.667 && Number(flag('--noise_w')) > 0.8, 'more varied in tone and rhythm');
    assert.ok(Number(flag('--sentence_silence')) < 0.2, 'less rest between sentences');
    assert.deepEqual(STYLE.filter((a) => a.startsWith('--')), ['--length_scale', '--noise_scale', '--noise_w', '--sentence_silence']);
    assert.deepEqual([...new Set(changes)], ['starting', 'ready']);
    assert.equal(piper.status().voice, 'ru_RU-irina-medium');
    // the wav files the program made are cleared away
    const left = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('capri-piper-')).flatMap((d) => { try { return fs.readdirSync(path.join(os.tmpdir(), d)); } catch { return []; } });
    assert.deepEqual(left.filter((f) => f.endsWith('.wav')), []);
    // line breaks in a line do not make several lines
    await piper.speak({}, { text: 'one\ntwo\r\nthree', lang: 'ru' });
    assert.equal(JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop()).text, 'one two three');
    // not silent forever: nothing to say is no job
    await assert.rejects(() => piper.speak({}, { text: '   ', lang: 'ru' }), /nothing to say/);
  } finally {
    piper.stop();
    delete process.env.FAKE_PIPER_LOG;
  }
});

test('speaking: the program is stopped after a quiet while and started again for the next line; stopping kills it', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('idle');
  piperFolder(root);
  const log = path.join(root, 'asked.jsonl');
  process.env.FAKE_PIPER_LOG = log;
  const piper = new Piper({ roots: () => [root], defaultDir: () => mk('nothing'), idleMs: 120 });
  try {
    await piper.speak({}, { text: 'one', lang: 'ru' });
    const pid1 = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]).pid;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(piper.proc, null, 'let go after being quiet');
    assert.equal(piper.status().phase, 'ready', 'and still ready');
    await piper.speak({}, { text: 'two', lang: 'ru' });
    const pid2 = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[1]).pid;
    assert.notEqual(pid1, pid2);
    const pid = piper.proc.pid;
    piper.stop();
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the program is gone');
    assert.equal(piper.status().phase, 'off');
  } finally {
    piper.stop();
    delete process.env.FAKE_PIPER_LOG;
  }
});

test('speaking: what can go wrong says what', { skip: !posix && 'the stand-in is a script' }, async () => {
  const none = new Piper({ roots: () => [], defaultDir: () => mk('empty') });
  await assert.rejects(() => none.speak({}, { text: 'hi', lang: 'ru' }), (e) => e.code === 'nopiper');
  const root = mk('wrong');
  piperFolder(root);
  const noVoice = new Piper({ roots: () => [root], defaultDir: () => mk('nothing') });
  await assert.rejects(() => noVoice.speak({}, { text: 'hi', lang: 'pt' }), (e) => e.code === 'novoice' && /no voice for "pt"/.test(e.message));
  // a model the program cannot load
  const bad = mk('bad');
  piperFolder(bad, { body: 'BROKEN model' });
  const broken = new Piper({ roots: () => [bad], defaultDir: () => mk('nothing') });
  await assert.rejects(() => broken.speak({}, { text: 'hi', lang: 'ru' }), (e) => e.code === 'exited' && /invalid protobuf|Failed to load/.test(e.message));
  assert.equal(broken.status().phase, 'failed');
  assert.match(broken.status().error, /protobuf|Failed to load/);
  // a program that does not answer: given up on, and the next line works with a fresh one
  const hang = new Piper({ roots: () => [root], defaultDir: () => mk('nothing'), timeoutMs: 400 });
  try {
    await assert.rejects(() => hang.speak({}, { text: 'HANG forever', lang: 'ru' }), (e) => e.code === 'timeout');
    const wav = await hang.speak({}, { text: 'and now?', lang: 'ru' });
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  } finally {
    hang.stop();
  }
});

test('check: it says a word to be sure all of it works, and reports ready (or why not)', { skip: !posix && 'the stand-in is a script' }, async () => {
  const root = mk('check');
  piperFolder(root);
  const piper = new Piper({ roots: () => [root], defaultDir: () => mk('nothing') });
  try {
    const st = await piper.check({}, 'ru');
    assert.equal(st.phase, 'ready');
    assert.equal(st.voice, 'ru_RU-irina-medium');
  } finally {
    piper.stop();
  }
  const empty = new Piper({ roots: () => [], defaultDir: () => mk('nothing') });
  await assert.rejects(() => empty.check({}, 'ru'));
  assert.equal(empty.status().phase, 'failed');
  assert.match(empty.status().error, /not installed/);
});
