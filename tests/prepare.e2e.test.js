'use strict';

// Her whole preparation with the real pieces and a stand-in for the models: a fresh PC with an Ollama folder (a
// stand-in program that answers like Ollama) and nothing else.
//  - a PC with a good card: she makes the Chatterbox folder, a real Python environment in it, installs the
//    package with the real pip (from a local wheel: no network), starts her real voice server around a stub
//    model, fetches a model through the stand-in Ollama
//  - a plain PC: she fetches Piper (a release archive and a voice from a stand-in library), unpacks it, starts
//    the (stand-in) program, and says a word with it
// and then a question is answered (Ollama's chat, streamed) and her answer is spoken (the voice server's wav).
//   node --test tests/prepare.e2e.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const cp = require('node:child_process');

const { Provision } = require('../src/main/provision.js');
const { Chatterbox } = require('../src/main/chatterbox.js');
const { OllamaHost } = require('../src/main/ollama-host.js');
const tools = require('../src/main/chatterbox-setup.js');
const hardware = require('../src/main/hardware.js');
const { Piper, assetFor, RELEASE, VOICES } = require('../src/main/piper.js');
const ollama = require('../src/main/ollama.js');
const tts = require('../src/main/tts.js');

const posix = process.platform !== 'win32';
// A Python on this machine with numpy (the stub voice needs it; a real chatterbox-tts brings its own with torch).
// Chatterbox is built for 3.10 to 3.12, which the real search looks for: here whichever Python has numpy is used.
const python = (() => {
  for (const cmd of ['python3.11', 'python3.12', 'python3.10', 'python3', 'python']) {
    const r = cp.spawnSync(cmd, ['-c', 'import numpy, os; print(os.path.dirname(os.path.dirname(numpy.__file__)))'], { encoding: 'utf8' });
    if (r.status === 0) return { cmd, pre: [], numpyAt: r.stdout.trim() };
  }
  return null;
})();
const skip = (!posix && 'the stand-ins are scripts') || (!python && 'no Python with numpy here');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-e2e-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// a wheel of a stub "chatterbox-tts" (a tone for a voice): built by tests/fixtures/build-stub-wheel.py
function buildWheel(dir) {
  fs.mkdirSync(dir, { recursive: true });
  cp.execFileSync(python.cmd, [...python.pre, path.join(__dirname, 'fixtures', 'build-stub-wheel.py'), path.join(dir, 'chatterbox_tts-0.0.1-py3-none-any.whl')]);
  return dir;
}

// a folder like the ones people drop next to her
function ollamaFolder(root) {
  const dir = path.join(root, 'Ollama-Portable');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'models', 'blobs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'models', 'manifests'), { recursive: true });
  const exe = path.join(dir, 'bin', 'ollama');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-ollama.js'), exe);
  fs.chmodSync(exe, 0o755);
  return dir;
}

const GB = 1024 ** 3;
const goodCard = () => hardware.make({ ram: 16 * GB, gpus: [{ name: 'NVIDIA GeForce RTX 3060', vram: 12 * GB, driver: '552.22', compute: 8.6 }], disk: { path: '', free: 300 * GB, total: 500 * GB } });

test('a fresh PC with a good card: she gets her mind and her voice (Chatterbox) ready by herself, a question is answered by the mind and the answer is spoken by the voice', { skip, timeout: 240000 }, async () => {
  const root = path.join(tmp, 'next-to-her');
  const userData = path.join(tmp, 'userdata');
  fs.mkdirSync(root, { recursive: true });
  ollamaFolder(root);
  const wheels = buildWheel(path.join(tmp, 'wheels'));
  const port = await freePort();
  const cbLog = path.join(tmp, 'chatterbox-calls.jsonl');
  const olLog = path.join(tmp, 'ollama-requests.jsonl');
  // (the stub wheel has no dependencies, so numpy is lent to the new environment from that Python)
  Object.assign(process.env, {
    PYTHONPATH: python.numpyAt, OLLAMA_HOST: `127.0.0.1:${port}`, FAKE_OLLAMA_LOG: olLog, CB_E2E_LOG: cbLog,
    PIP_NO_INDEX: '1', PIP_FIND_LINKS: wheels, PIP_DISABLE_PIP_VERSION_CHECK: '1',
  });
  const cfg = { provider: 'ollama', ttsEngine: 'system', voiceMode: 'chat', provisioned: false, chatModel: null, chatterboxDir: '', chatterboxUrl: '', ollamaDir: '', chatterboxDevice: 'cpu', hfEndpoint: '' };
  const saved = [];
  const roots = () => [root, userData];
  const chatterbox = new Chatterbox({ roots, pollMs: 100 });
  const ollamaHost = new OllamaHost({ roots, pollMs: 100, whichFn: async () => null, places: () => [] });
  const provision = new Provision({
    cfg: () => cfg,
    save: (patch) => { saved.push(patch); Object.assign(cfg, patch); },
    lang: () => 'ru',
    ollamaHost, chatterbox,
    tools: { ...tools, findSystemPython: () => ({ cmd: python.cmd, pre: python.pre, version: 'the one with numpy' }) },
    ollamaApi: { models: () => ollama.models(), pull: (name, onProgress, signal) => ollama.pull(name, onProgress, signal) },
    roots,
    defaultDir: () => path.join(userData, 'chatterbox'),
    hardware: async () => goodCard(),
    onModelsChanged: async () => {},
  });
  const seen = [];
  provision.on('change', (s) => seen.push(s));
  try {
    await provision.run();
    const steps = Object.fromEntries(provision.steps.map((s) => [s.id, `${s.state}${s.error ? `: ${s.error}` : ''}`]));
    assert.equal(provision.ok, true, JSON.stringify(steps, null, 1));
    assert.equal(steps.scan, 'done');
    assert.deepEqual(['ollama-find', 'ollama-run', 'ollama-model', 'cb-find', 'cb-python', 'cb-package', 'cb-model'].map((id) => steps[id]), Array(7).fill('done'));
    assert.deepEqual(['pp-find', 'pp-voice', 'pp-run'].map((id) => steps[id]), ['skipped', 'skipped', 'skipped'], 'no Piper on a PC that can carry Chatterbox');
    assert.equal(provision.profile.id, 'strong');
    // the mind
    assert.equal(ollamaHost.status().ours, true);
    assert.equal(cfg.chatModel, 'gemma3:4b', 'a model that fits next to the voice on a 12 GB card');
    assert.deepEqual(await ollama.models(), ['gemma3:4b']);
    assert.match(provision.step('ollama-find').detail, /Нашла: .*Ollama-Portable/);
    assert.ok(seen.some((s) => s.steps.find((x) => x.id === 'ollama-model').progress > 0.4 && s.steps.find((x) => x.id === 'ollama-model').progress < 1), 'the fetch showed its progress');
    assert.ok(seen.some((s) => /Скачиваю модель gemma3:4b: \d+ МБ из \d+ МБ/.test(s.steps.find((x) => x.id === 'ollama-model').detail)));
    // the voice: folder made, environment made, package installed with real pip, server up
    assert.equal(cfg.chatterboxDir, path.join(userData, 'chatterbox'));
    assert.ok(fs.existsSync(path.join(userData, 'chatterbox', 'venv', 'bin', 'python3')), 'a real environment');
    assert.equal(tools.hasChatterbox(path.join(userData, 'chatterbox', 'venv', 'bin', 'python3')), true, 'with the package in it');
    assert.equal(cfg.ttsEngine, 'chatterbox');
    assert.equal(cfg.provisioned, true);
    assert.equal(chatterbox.status().phase, 'ready');
    assert.ok(seen.some((s) => s.steps.find((x) => x.id === 'cb-package').heavy), 'the install was a long job');
    assert.equal(provision.attention, true);

    // a question: the mind answers (streamed), as her chat does it
    const pieces = [];
    const answer = await ollama.chat({ model: cfg.chatModel, messages: [{ role: 'user', content: 'Как тебя зовут?' }] }, (p) => pieces.push(p), AbortSignal.timeout(10000));
    assert.match(answer, /Ты спросил: «Как тебя зовут\?»/);
    assert.ok(pieces.length > 3, 'streamed in pieces');
    // and the answer is said: the voice server's wav, through the same call her overlay makes
    const base = await chatterbox.ready(cfg);
    const wav = await tts.speak(cfg, {}, { text: answer, mood: 'happy', lang: 'ru', base });
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.ok(wav.length > 20000, `${wav.length} bytes of her voice`);
    const calls = fs.readFileSync(cbLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls[0].language_id, 'ru');
    assert.ok(calls.map((c) => c.text).join(' ').includes('Ты спросил'), 'what she said is what the mind answered');
    assert.equal(calls[0].exaggeration, 0.7, 'a happy line');

    // the second start-up: everything is there, nothing is fetched or installed, no window is called for
    chatterbox.stop();
    ollamaHost.stop();
    const before = fs.readFileSync(olLog, 'utf8').split('\n').filter((l) => /"url":"\/api\/pull"/.test(l)).length;
    const again = new Provision({
      cfg: () => cfg, save: (p) => Object.assign(cfg, p), lang: () => 'ru', ollamaHost, chatterbox,
      ollamaApi: { models: () => ollama.models(), pull: () => { throw new Error('should not fetch'); } },
      roots, defaultDir: () => path.join(userData, 'chatterbox'), hardware: async () => goodCard(), onModelsChanged: async () => {},
    });
    await again.run();
    assert.equal(again.ok, true, JSON.stringify(again.steps.map((s) => [s.id, s.state, s.error])));
    assert.equal(again.attention, false, 'a quiet start-up');
    assert.equal(fs.readFileSync(olLog, 'utf8').split('\n').filter((l) => /"url":"\/api\/pull"/.test(l)).length, before);
    assert.equal(ollamaHost.status().modelsDir, path.join(root, 'Ollama-Portable', 'models'), 'the folder\'s own models');
  } finally {
    chatterbox.stop();
    ollamaHost.stop();
    for (const k of ['PYTHONPATH', 'OLLAMA_HOST', 'FAKE_OLLAMA_LOG', 'CB_E2E_LOG', 'PIP_NO_INDEX', 'PIP_FIND_LINKS', 'PIP_DISABLE_PIP_VERSION_CHECK']) delete process.env[k];
  }
});

// ---- a plain PC: Piper ----

const md5 = (buf) => require('node:crypto').createHash('md5').update(buf).digest('hex');

test('a plain PC: she fetches Piper and a voice, starts it, a question is answered by the mind and the answer is spoken by Piper; the next start fetches nothing', { skip: !posix && 'the stand-ins are scripts', timeout: 120000 }, async () => {
  const root = path.join(tmp, 'plain-next-to-her');
  const userData = path.join(tmp, 'plain-userdata');
  fs.mkdirSync(root, { recursive: true });
  ollamaFolder(root);
  const port = await freePort();
  const piperLog = path.join(tmp, 'piper-asked.jsonl');
  const olLog = path.join(tmp, 'plain-ollama.jsonl');
  Object.assign(process.env, { OLLAMA_HOST: `127.0.0.1:${port}`, FAKE_OLLAMA_LOG: olLog, FAKE_PIPER_LOG: piperLog });
  // the release (a folder with the stand-in program, in an archive) and the voice library, served from memory
  const release = path.join(tmp, 'plain-release');
  fs.mkdirSync(path.join(release, 'piper', 'espeak-ng-data'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-piper.js'), path.join(release, 'piper', 'piper'));
  fs.chmodSync(path.join(release, 'piper', 'piper'), 0o755);
  const archive = path.join(tmp, 'plain-release.tar.gz');
  cp.execFileSync('tar', ['-czf', archive, '-C', release, 'piper']);
  const asset = assetFor(process.platform, process.arch, true);
  const onnx = Buffer.from('IRINA-MODEL'.repeat(2000));
  const json = Buffer.from('{"audio":{"sample_rate":22050}}');
  const served = new Map([
    [`${RELEASE}/${asset}`, fs.readFileSync(archive)],
    [`${VOICES}/voices.json`, Buffer.from(JSON.stringify({ 'ru_RU-irina-medium': { key: 'ru_RU-irina-medium', language: { family: 'ru' }, quality: 'medium', files: {
      'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx': { size_bytes: onnx.length, md5_digest: md5(onnx) },
      'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json': { size_bytes: json.length, md5_digest: md5(json) },
    } } }))],
    [`${VOICES}/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx`, onnx],
    [`${VOICES}/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json`, json],
  ]);
  const fetched = [];
  const fetchFn = async (url) => {
    fetched.push(url);
    const body = served.get(url);
    return body ? new Response(body, { headers: { 'content-length': String(body.length) } }) : new Response('not found', { status: 404 });
  };
  const cfg = { provider: 'ollama', ttsEngine: 'system', voiceMode: 'chat', provisioned: false, chatModel: null, chatterboxDir: '', chatterboxUrl: '', ollamaDir: '', piperDir: '', profile: 'auto' };
  const roots = () => [root, userData];
  const chatterbox = new Chatterbox({ roots, pollMs: 100 });
  const ollamaHost = new OllamaHost({ roots, pollMs: 100, whichFn: async () => null, places: () => [] });
  const piper = new Piper({ roots, fetchFn, defaultDir: () => path.join(userData, 'piper') });
  const make = () => new Provision({
    cfg: () => cfg,
    save: (patch) => Object.assign(cfg, patch),
    lang: () => 'ru',
    ollamaHost, chatterbox, piper,
    ollamaApi: { models: () => ollama.models(), pull: (name, onProgress, signal) => ollama.pull(name, onProgress, signal) },
    roots,
    defaultDir: () => path.join(userData, 'chatterbox'),
    hardware: async () => hardware.make({ ram: 15.9 * GB, cpu: { name: 'Intel(R) Core(TM) i5', threads: 8 }, disk: { path: '', free: 200 * GB, total: 500 * GB } }),
    tune: (t) => { ollama.tune(t); ollamaHost.setEnv(t.ollamaEnv); },
    onModelsChanged: async () => {},
  });
  const provision = make();
  try {
    await provision.run();
    const steps = Object.fromEntries(provision.steps.map((s) => [s.id, `${s.state}${s.error ? `: ${s.error}` : ''}`]));
    assert.equal(provision.ok, true, JSON.stringify(steps, null, 1));
    assert.equal(provision.profile.id, 'standard');
    assert.deepEqual(['ollama-find', 'ollama-run', 'ollama-model', 'pp-find', 'pp-voice', 'pp-run'].map((id) => steps[id]), Array(6).fill('done'));
    assert.deepEqual(['cb-find', 'cb-python', 'cb-package', 'cb-model'].map((id) => steps[id]), Array(4).fill('skipped'), 'no Python, no environment, no Chatterbox');
    assert.equal(cfg.chatModel, 'gemma3:4b');
    assert.equal(cfg.ttsEngine, 'piper');
    assert.equal(cfg.provisioned, true);
    assert.ok(fs.existsSync(path.join(userData, 'piper', 'piper', 'piper')), 'the program was fetched and unpacked');
    assert.ok(fs.existsSync(path.join(userData, 'piper', 'voices', 'ru_RU-irina-medium.onnx')), 'and the voice of her language');
    assert.equal(fs.existsSync(path.join(userData, 'chatterbox')), false, 'nothing of Chatterbox was made');
    assert.equal(piper.status().phase, 'ready');

    // a question: the mind answers (with the context the profile gave it), and the answer is said by Piper
    const answer = await ollama.chat({ model: cfg.chatModel, messages: [{ role: 'user', content: 'Как тебя зовут?' }] }, () => {}, AbortSignal.timeout(10000));
    assert.match(answer, /Ты спросил: «Как тебя зовут\?»/);
    const requests = fs.readFileSync(olLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(requests.find((r) => r.url === '/api/chat').options.num_ctx, 4096, 'the context of the standard profile');
    assert.equal(requests[0].env.maxLoaded, '1', 'and Ollama was started with the profile\'s settings');
    const wav = await tts.speak(cfg, {}, { text: answer, mood: 'happy', lang: 'ru', piper });
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.ok(wav.length > 20000, `${wav.length} bytes of her voice`);
    const said = fs.readFileSync(piperLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(said.some((r) => r.text.includes('Ты спросил') && r.model === 'ru_RU-irina-medium.onnx'), 'what she said is what the mind answered, in the voice of her language');

    // the second start: everything is there, nothing is fetched or installed, no window is called for
    piper.stop();
    ollamaHost.stop();
    fetched.length = 0;
    const pulls = requests.filter((r) => r.url === '/api/pull').length;
    const again = make();
    await again.run();
    assert.equal(again.ok, true, JSON.stringify(again.steps.map((s) => [s.id, s.state, s.error])));
    assert.equal(again.attention, false, 'a quiet start-up');
    assert.deepEqual(fetched, [], 'nothing was downloaded');
    assert.equal(fs.readFileSync(olLog, 'utf8').split('\n').filter((l) => /"url":"\/api\/pull"/.test(l)).length, pulls);
  } finally {
    piper.stop();
    ollamaHost.stop();
    ollama.tune({});
    for (const k of ['OLLAMA_HOST', 'FAKE_OLLAMA_LOG', 'FAKE_PIPER_LOG']) delete process.env[k];
  }
});
