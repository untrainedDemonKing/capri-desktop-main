'use strict';

// Her voice through Chatterbox (src/main/chatterbox.js, chatterbox-server.py, tts.js): finding the folder
// and its Python, her mood as Chatterbox's dials, the request, and the whole way through with a stand-in for
// the model: a real folder with a real Python environment, her real little server, a stub `chatterbox`
// package that makes a tone instead of a voice. No GPU, no download.
//   node --test tests/chatterbox.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { Chatterbox, findPython, findFolder, findVoiceDirs, moodDials, MOOD } = require('../src/main/chatterbox.js');
const tts = require('../src/main/tts.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-cb-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const mk = (...parts) => {
  const dir = path.join(tmp, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const touch = (file, text = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

// ---- the folder ----

test('her Python is found in a venv, an embedded Python, or a folder or two down', () => {
  const win = mk('win', 'Chatterbox');
  touch(path.join(win, 'venv', 'Scripts', 'python.exe'));
  assert.equal(findPython(win, { platform: 'win32' }), path.join(win, 'venv', 'Scripts', 'python.exe'));

  const embedded = mk('embedded', 'Chatterbox-Portable');
  touch(path.join(embedded, 'python_embeded', 'python.exe'));
  touch(path.join(embedded, 'python_embeded', 'python311._pth'));
  assert.equal(findPython(embedded, { platform: 'win32' }), path.join(embedded, 'python_embeded', 'python.exe'));

  const nix = mk('nix', 'chatterbox');
  touch(path.join(nix, '.venv', 'bin', 'python3'));
  touch(path.join(nix, '.venv', 'pyvenv.cfg'), 'home = /usr/bin');
  assert.equal(findPython(nix, { platform: 'linux' }), path.join(nix, '.venv', 'bin', 'python3'));

  const none = mk('none', 'chatterbox');
  touch(path.join(none, 'readme.txt'));
  assert.equal(findPython(none, { platform: 'win32' }), null, 'a folder with no Python gives none');
  // a python.exe that is only in a package's folder does not count as a Python home without its stdlib marker
  const plain = mk('plain', 'chatterbox');
  touch(path.join(plain, 'python.exe'));
  assert.equal(findPython(plain, { platform: 'win32' }), null);
  // never looks into the folders that hold thousands of files
  const deep = mk('deep', 'chatterbox');
  touch(path.join(deep, 'node_modules', 'x', 'Scripts', 'python.exe'));
  assert.equal(findPython(deep, { platform: 'win32' }), null);
});

test('the Chatterbox folder is the one named, or one with chatterbox in its name next to her', () => {
  const root = mk('roots');
  mk('roots', 'assets');
  mk('roots', 'My-Chatterbox-TTS-Server');
  mk('roots', 'chatterbox-old');
  assert.equal(findFolder({}, [root]), path.join(root, 'chatterbox-old'), 'the first by name');
  assert.equal(findFolder({}, [path.join(tmp, 'nowhere'), root]), path.join(root, 'chatterbox-old'), 'a root that is not there is skipped');
  assert.equal(findFolder({ chatterboxDir: path.join(root, 'My-Chatterbox-TTS-Server') }, [root]), path.join(root, 'My-Chatterbox-TTS-Server'), 'the one she was told');
  assert.equal(findFolder({ chatterboxDir: path.join(root, 'gone') }, [root]), null, 'a named folder that is gone is not replaced by another');
  assert.equal(findFolder({}, [mk('empty-root')]), null);
});

test('the folders of voice recordings are found, and only those', () => {
  const root = mk('voices', 'Chatterbox');
  mk('voices', 'Chatterbox', 'voices');
  mk('voices', 'Chatterbox', 'app', 'reference_audio');
  mk('voices', 'Chatterbox', 'venv', 'voices'); // (inside the Python: not hers)
  mk('voices', 'Chatterbox', 'models');
  const dirs = findVoiceDirs(root).map((d) => path.relative(root, d)).sort();
  assert.deepEqual(dirs, [path.join('app', 'reference_audio'), 'voices']);
});

// ---- her mood in Chatterbox's dials ----

test('every mood has dials, and they differ the way the moods do', () => {
  for (const m of ['calm', 'happy', 'laugh', 'angry', 'annoyed', 'sad', 'shy', 'smug', 'surprised', 'dreamy', 'bored']) {
    const d = moodDials(m);
    assert.ok(d.exaggeration >= 0.25 && d.exaggeration <= 1, m);
    assert.ok(d.cfg_weight >= 0.2 && d.cfg_weight <= 0.7, m);
    assert.ok(d.temperature >= 0.5 && d.temperature <= 1.1, m);
  }
  assert.ok(MOOD.angry.exaggeration > MOOD.calm.exaggeration && MOOD.calm.exaggeration > MOOD.bored.exaggeration, 'angry feels more than calm, calm more than bored');
  assert.ok(MOOD.angry.cfg_weight < MOOD.sad.cfg_weight, 'angry is quicker than sad');
  assert.deepEqual(moodDials('no such mood'), MOOD.calm);
});

// ---- the request ----

test('tts.speak asks the Chatterbox server for wav, with her language and mood, and no key', async () => {
  const real = global.fetch;
  let seen;
  global.fetch = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(Buffer.from('RIFFxxxxWAVE'), { status: 200 });
  };
  try {
    const audio = await tts.speak({ ttsEngine: 'chatterbox', ttsVoice: '' }, {}, { text: 'Привет!', mood: 'angry', lang: 'ru', base: 'http://127.0.0.1:9999/v1/' });
    assert.equal(seen.url, 'http://127.0.0.1:9999/v1/audio/speech');
    assert.equal(seen.body.input, 'Привет!');
    assert.equal(seen.body.language, 'ru');
    assert.equal(seen.body.response_format, 'wav');
    assert.equal(seen.body.exaggeration, MOOD.angry.exaggeration);
    assert.equal(seen.body.mood, 'angry');
    assert.equal(seen.body.voice, undefined, 'no voice named: the model\'s own');
    assert.equal(seen.init.headers.authorization, undefined, 'no key is sent to a server on this PC');
    assert.equal(String(audio.subarray(0, 4)), 'RIFF');
    // a voice she was given goes along
    await tts.speak({ ttsEngine: 'chatterbox', ttsVoice: 'anna.wav' }, {}, { text: 'x', mood: 'calm', lang: 'en', base: 'http://127.0.0.1:9999/v1' });
    assert.equal(seen.body.voice, 'anna.wav');
    assert.equal(seen.body.language, 'en');
    // no server: said so, with a code she can act on
    await assert.rejects(() => tts.speak({ ttsEngine: 'chatterbox' }, {}, { text: 'x', mood: 'calm', lang: 'ru', base: '' }), (e) => e.code === 'nourl');
    // an error from the server comes through
    global.fetch = async () => new Response(JSON.stringify({ error: { message: 'the model is still loading' } }), { status: 503 });
    await assert.rejects(() => tts.speak({ ttsEngine: 'chatterbox' }, {}, { text: 'x', mood: 'calm', lang: 'ru', base: 'http://127.0.0.1:9999/v1' }), /still loading/);
  } finally {
    global.fetch = real;
  }
  assert.ok(tts.ENGINES.chatterbox, 'it is one of her engines (the menu, the setup and the config follow this list)');
});

// ---- the manager, without a Python ----

test('her manager: auto-start, an address of your own, a missing folder, and stopping', async () => {
  // a server of your own: she starts nothing and talks to it
  let spawned = 0;
  const own = new Chatterbox({ spawn: () => { spawned++; throw new Error('should not start'); }, fsx: fs, roots: () => [] });
  const states = [];
  own.on('change', (s) => states.push(s.phase));
  await own.sync({ ttsEngine: 'chatterbox', chatterboxUrl: 'http://127.0.0.1:8004/v1/' });
  assert.equal(spawned, 0);
  assert.equal(own.status().phase, 'ready');
  assert.equal(await own.ready({ ttsEngine: 'chatterbox', chatterboxUrl: 'http://127.0.0.1:8004/v1/' }), 'http://127.0.0.1:8004/v1');
  assert.deepEqual(states, ['ready']);

  // another engine: nothing runs, and asking for her voice is an error with a code
  const idle = new Chatterbox({ spawn: () => { throw new Error('should not start'); }, roots: () => [] });
  await idle.sync({ ttsEngine: 'system' });
  assert.equal(idle.status().phase, 'off');
  await assert.rejects(() => idle.ready({ ttsEngine: 'system' }), (e) => e.code === 'off');
  // auto-start off and no address: she does not start it
  await assert.rejects(() => idle.ready({ ttsEngine: 'chatterbox', chatterboxAuto: false }), (e) => e.code === 'off');

  // a folder that was named and is gone
  const lost = new Chatterbox({ spawn: () => { throw new Error('should not start'); }, roots: () => [] });
  await lost.sync({ ttsEngine: 'chatterbox', chatterboxDir: path.join(tmp, 'gone') });
  assert.equal(lost.status().phase, 'failed');
  assert.match(lost.status().error, /not there/);
  await assert.rejects(() => lost.ready({ ttsEngine: 'chatterbox', chatterboxDir: path.join(tmp, 'gone') }), (e) => e.code === 'nofolder');

  // a Python that cannot be started: ENOENT falls back to the next candidate, then fails with a message about it
  const attempts = [];
  const noPython = new Chatterbox({
    platform: 'win32',
    roots: () => [],
    spawn: (cmd) => {
      attempts.push(cmd);
      const { EventEmitter } = require('node:events');
      const p = new EventEmitter();
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      p.stdin = { end() {}, on() {} };
      setTimeout(() => p.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })), 5);
      return p;
    },
    pollMs: 20,
  });
  await noPython.sync({ ttsEngine: 'chatterbox' });
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(attempts, ['py', 'python'], 'the Python launcher first, then python on the PATH');
  assert.equal(noPython.status().phase, 'failed');
  assert.match(noPython.status().error, /Python was not found/);
  noPython.stop();
});

// ---- the whole way, with a stand-in for the model ----

const python = (() => {
  try {
    const r = cp.spawnSync('python3', ['-c', 'import numpy, venv; print(1)'], { encoding: 'utf8' });
    return r.status === 0 ? 'python3' : null;
  } catch {
    return null;
  }
})();

const STUB = `
import json, os
import numpy as np

class _Wave:
    def __init__(self, a): self.a = a
    def squeeze(self): return self
    def detach(self): return self
    def cpu(self): return self
    def numpy(self): return self.a

class ChatterboxMultilingualTTS:
    sr = 24000
    @classmethod
    def from_pretrained(cls, device='cpu'):
        if os.environ.get('CB_STUB_FAIL'):
            raise RuntimeError('CUDA out of memory (stand-in)')
        return cls()
    def generate(self, text, language_id='en', audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8):
        with open(os.path.join(os.path.dirname(__file__), 'calls.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'text': text, 'language_id': language_id, 'audio_prompt_path': audio_prompt_path,
                                'exaggeration': exaggeration, 'cfg_weight': cfg_weight, 'temperature': temperature}, ensure_ascii=False) + '\\n')
        n = int(self.sr * 0.01 * max(5, len(text)))
        t = np.arange(n) / self.sr
        return _Wave((0.3 * np.sin(2 * np.pi * 220 * t)).astype('float32'))
`;

// a Chatterbox folder next to her: its own venv (a real one, with no pip), with the stub package inside it
function fakeFolder(name) {
  const root = mk('e2e');
  const dir = path.join(root, name);
  cp.execFileSync(python, ['-m', 'venv', '--without-pip', '--system-site-packages', path.join(dir, 'venv')]); // (numpy comes from the system's; a real one has its own)
  const site = fs.readdirSync(path.join(dir, 'venv', 'lib')).map((d) => path.join(dir, 'venv', 'lib', d, 'site-packages')).find((p) => fs.existsSync(p));
  touch(path.join(site, 'chatterbox', '__init__.py'), '');
  touch(path.join(site, 'chatterbox', 'mtl_tts.py'), STUB);
  fs.mkdirSync(path.join(dir, 'voices'), { recursive: true });
  touch(path.join(dir, 'voices', 'anna.wav'), 'RIFF');
  return { root, dir, calls: path.join(site, 'chatterbox', 'calls.jsonl') };
}

const waitFor = async (fn, ms = 20000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

test('end to end: she finds the folder next to her, starts her server with its Python, and her line comes back as wav', { skip: !python && 'no python3 with numpy here' }, async () => {
  const { root, dir, calls } = fakeFolder('Chatterbox-TTS-Server');
  const box = new Chatterbox({ roots: () => [root], pollMs: 100 });
  const cfg = { ttsEngine: 'chatterbox', chatterboxAuto: true, chatterboxDevice: 'cpu' };
  try {
    await box.sync(cfg);
    assert.equal(box.status().phase, 'starting');
    assert.equal(box.status().dir, dir, 'the folder with chatterbox in its name');
    assert.equal(box.status().python, path.join(dir, 'venv', 'bin', 'python3'), 'its own Python, not the PATH one');
    assert.ok(await waitFor(() => box.status().phase === 'ready'), `ready: ${JSON.stringify(box.status())}`);
    const base = await box.ready(cfg);
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    // the health check says so
    const health = await (await fetch(`${base.replace(/\/v1$/, '')}/health`)).json();
    assert.equal(health.ready, true);
    assert.equal(health.device, 'cpu');

    // a short line in Russian, angry: one piece, her language and her mood's dials reach the model
    const wav = await tts.speak(cfg, {}, { text: 'Ты опять всё сломал!', mood: 'angry', lang: 'ru', base });
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24000, 'the model\'s sample rate');
    assert.equal(wav.readUInt32LE(4), wav.length - 8, 'a whole wav file');
    assert.ok(wav.length > 5000, 'there is sound in it');
    let seen = fs.readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].language_id, 'ru');
    assert.equal(seen[0].exaggeration, MOOD.angry.exaggeration);
    assert.equal(seen[0].cfg_weight, MOOD.angry.cfg_weight);
    assert.equal(seen[0].audio_prompt_path, null, 'no voice asked for: the model\'s own');

    // a long answer: cut into sentences-or-two, said one after another, one WAV out, silence between
    fs.rmSync(calls);
    const long = 'Это длинный ответ. '.repeat(30).trim();
    const longWav = await tts.speak(cfg, {}, { text: long, mood: 'calm', lang: 'ru', base });
    seen = fs.readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(seen.length >= 2 && seen.every((c) => c.text.length <= 260), `${seen.length} pieces`);
    assert.ok(longWav.length > wav.length * 2, 'and all of it is in the answer');

    // a recording from the voices folder, by name, found in the folder's own `voices`
    fs.rmSync(calls);
    await tts.speak({ ...cfg, ttsVoice: 'anna' }, {}, { text: 'Привет', mood: 'calm', lang: 'ru', base });
    seen = fs.readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(seen[0].audio_prompt_path, path.join(dir, 'voices', 'anna.wav'));

    // nothing to say, and a language she does not have: both answered, not crashed
    const empty = await fetch(`${base}/audio/speech`, { method: 'POST', body: JSON.stringify({ input: '  ' }) });
    assert.equal(empty.status, 400);
    fs.rmSync(calls);
    await tts.speak(cfg, {}, { text: 'Hello', mood: 'calm', lang: 'xx', base });
    assert.equal(JSON.parse(fs.readFileSync(calls, 'utf8').trim()).language_id, 'en');
  } finally {
    box.stop();
  }
  // stopped: nothing answers any more
  const url = box.url;
  assert.equal(box.status().phase, 'off');
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    alive = await fetch(`${url.replace(/\/v1$/, '')}/health`, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
    if (alive) await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(alive, false, 'her server went with her');
});

test('end to end: a model that cannot load is a clear failure in her menu, not a silence', { skip: !python && 'no python3 with numpy here' }, async () => {
  const { root } = fakeFolder('Chatterbox-Broken');
  const box = new Chatterbox({ roots: () => [path.join(root)], pollMs: 100 });
  // (the other fake folder in the same root sorts first: this one is named, so there is no doubt)
  const cfg = { ttsEngine: 'chatterbox', chatterboxDir: path.join(root, 'Chatterbox-Broken') };
  process.env.CB_STUB_FAIL = '1';
  try {
    await box.sync(cfg);
    assert.ok(await waitFor(() => box.status().phase === 'failed'), JSON.stringify(box.status()));
    assert.match(box.status().error, /out of memory/);
    await assert.rejects(() => box.ready(cfg), /out of memory/);
    // the same settings again do not restart it over and over
    await box.sync(cfg);
    assert.equal(box.status().phase, 'failed');
    // the menu's button does
    delete process.env.CB_STUB_FAIL;
    await box.restart(cfg);
    assert.ok(await waitFor(() => box.status().phase === 'ready'), JSON.stringify(box.status()));
  } finally {
    delete process.env.CB_STUB_FAIL;
    box.stop();
  }
});

test('the torch for a card: the build its driver can run, a newer one for the newest cards, none when the driver is too old', () => {
  const setup = require('../src/main/chatterbox-setup.js');
  const torch = { version: '2.6.0', audio: '2.6.0', cuda: false };
  assert.match(setup.cudaBuild({ driver: '552.22', compute: 8.6 }).index, /cu124$/, 'a driver of 2024');
  assert.match(setup.cudaBuild({ driver: '537.13', compute: 7.5 }).index, /cu118$/, 'an older driver gets the older build');
  assert.match(setup.cudaBuild({ driver: '572.16', compute: 12 }).index, /cu128$/, 'the newest cards (Blackwell) need CUDA 12.8');
  assert.equal(setup.cudaBuild({ driver: '551.0', compute: 12 }), null, 'and a driver that knows it');
  assert.equal(setup.cudaBuild({ driver: '391.35', compute: 5 }), null, 'a driver too old for any build');
  assert.match(setup.cudaBuild({}).index, /cu124$/, 'nothing known: the usual one');
  assert.deepEqual(setup.cudaTorchArgs(torch, { driver: '552.22', compute: 8.6 }), ['install', '--force-reinstall', '--no-deps', 'torch==2.6.0', 'torchaudio==2.6.0', '--index-url', 'https://download.pytorch.org/whl/cu124']);
  assert.deepEqual(setup.cudaTorchArgs(torch, { driver: '572.16', compute: 12 }).slice(3, 5), ['torch==2.7.1', 'torchaudio==2.7.1'], 'a newer torch for the newest cards');
  assert.equal(setup.cudaTorchArgs(torch, { driver: '391.35' }), null);
});

test('a copy of the model hub\'s cache in the Chatterbox folder is what the model is read from', () => {
  const { modelCache } = require('../src/main/chatterbox.js');
  const dir = mk('cached', 'Chatterbox');
  assert.equal(modelCache(dir), '');
  assert.equal(modelCache(''), '');
  fs.mkdirSync(path.join(dir, 'huggingface', 'hub'), { recursive: true });
  assert.equal(modelCache(dir), path.join(dir, 'huggingface'));
  // and the server is started with it
  let env = null;
  const { EventEmitter } = require('node:events');
  const cb = new Chatterbox({
    roots: () => [path.dirname(dir)], port: async () => 1, pollMs: 100000,
    spawn: (_cmd, _args, opts) => { env = opts.env; const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = { end() {}, on() {} }; p.kill = () => {}; return p; },
  });
  return cb.start({ ttsEngine: 'chatterbox', chatterboxDir: dir }).then(() => {
    assert.equal(env.HF_HOME, path.join(dir, 'huggingface'));
    assert.ok(cb.status().log.some((l) => /read from/.test(l)));
    cb.stop();
  });
});

test('the folder of the recording she was given is passed to the server first, before the ones found in the Chatterbox folder', async () => {
  const dir = mk('with-sample', 'Chatterbox');
  fs.mkdirSync(path.join(dir, 'voices'), { recursive: true });
  const hers = path.join(tmp, 'her-data', 'voices');
  let args = null;
  const { EventEmitter } = require('node:events');
  const cb = new Chatterbox({
    roots: () => [path.dirname(dir)], port: async () => 1, pollMs: 100000, voices: () => [hers],
    spawn: (_cmd, a) => { args = a; const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.stdin = { end() {}, on() {} }; p.kill = () => {}; return p; },
  });
  await cb.start({ ttsEngine: 'chatterbox', chatterboxDir: dir });
  const folders = args.flatMap((a, i) => (args[i - 1] === '--voices' ? [a] : []));
  assert.deepEqual(folders, [hers, path.join(dir, 'voices')], 'a name found in both is hers');
  cb.stop();
});

test('end to end: the recording she was given reaches the model as the voice to copy, and no recording is the model\'s own', { skip: !python && 'no python3 with numpy here' }, async () => {
  const { createSample } = require('../src/main/voice-sample.js');
  const { root, dir, calls } = fakeFolder('Chatterbox-Sample');
  const data = mk('her-sample-data');
  const sample = createSample({ dir: path.join(data, 'voices') });
  const box = new Chatterbox({ roots: () => [root], pollMs: 100, voices: () => [sample.dir()] });
  // (named: the other fake folders in the same root sort first)
  const cfg = { ttsEngine: 'chatterbox', chatterboxAuto: true, chatterboxDevice: 'cpu', chatterboxDir: dir };
  try {
    await box.sync(cfg);
    assert.ok(await waitFor(() => box.status().phase === 'ready'), JSON.stringify(box.status()));
    const base = await box.ready(cfg);
    const say = (extra) => tts.speak(cfg, {}, { text: 'Привет', mood: 'calm', lang: 'ru', base, ...extra });
    const last = () => JSON.parse(fs.readFileSync(calls, 'utf8').trim().split('\n').pop());
    await say({ sample: sample.current() });
    assert.equal(last().audio_prompt_path, null, 'no recording yet: the model\'s own voice');

    // she is given one while the server is already running: the next line is in that voice, no restart
    const src = path.join(data, 'mine.wav');
    const tone = Buffer.alloc(44 + 16000 * 2 * 6);
    tone.write('RIFF', 0); tone.writeUInt32LE(tone.length - 8, 4); tone.write('WAVEfmt ', 8); tone.writeUInt32LE(16, 16);
    tone.writeUInt16LE(1, 20); tone.writeUInt16LE(1, 22); tone.writeUInt32LE(16000, 24); tone.writeUInt32LE(32000, 28);
    tone.writeUInt16LE(2, 32); tone.writeUInt16LE(16, 34); tone.write('data', 36); tone.writeUInt32LE(16000 * 2 * 6, 40);
    for (let i = 0; i < 16000 * 6; i++) tone.writeInt16LE(Math.round(Math.sin(i / 9) * 12000), 44 + i * 2);
    fs.writeFileSync(src, tone);
    assert.equal(sample.use(src).ok, true);
    await say({ sample: sample.current() });
    assert.equal(last().audio_prompt_path, path.join(data, 'voices', 'capri.wav'));

    // and taken away again: the model's own
    sample.remove();
    await say({ sample: sample.current() });
    assert.equal(last().audio_prompt_path, null);
  } finally {
    box.stop();
  }
});

// the server cuts a long recording to the part the voice is taken from (needs the `soundfile` package, which
// Chatterbox brings with it; CAPRI_TEST_PYTHON names a Python that has it)
const pythonWithSoundfile = (() => {
  for (const py of [process.env.CAPRI_TEST_PYTHON, python].filter(Boolean)) {
    try {
      if (cp.spawnSync(py, ['-c', 'import soundfile, numpy'], { encoding: 'utf8' }).status === 0) return py;
    } catch {
      // not this one
    }
  }
  return null;
})();

test('the server uses the first 20 seconds of a long recording, and a short one as it is', { skip: !pythonWithSoundfile && 'no Python with soundfile here' }, () => {
  const script = `
import importlib.util, os, sys, tempfile
import numpy as np, soundfile
spec = importlib.util.spec_from_file_location('server', ${JSON.stringify(path.join(__dirname, '..', 'src', 'main', 'chatterbox-server.py'))})
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
tmp = tempfile.mkdtemp()
short = os.path.join(tmp, 'short.wav'); long = os.path.join(tmp, 'long.wav')
soundfile.write(short, (np.sin(np.arange(16000 * 8) / 9) * 0.3).astype('float32'), 16000)
soundfile.write(long, (np.sin(np.arange(16000 * 45) / 9) * 0.3).astype('float32'), 16000)
assert server.reference(short) == short, 'a short one is used as it is'
cut = server.reference(long)
assert cut != long and soundfile.info(cut).duration <= 20.01 and soundfile.info(cut).duration > 19.9, soundfile.info(cut).duration
assert server.reference(long) == cut, 'cut once'
assert server.reference(os.path.join(tmp, 'nothing.wav')) == os.path.join(tmp, 'nothing.wav'), 'what cannot be read is left to the model'
print('ok')
`;
  const r = cp.spawnSync(pythonWithSoundfile, ['-c', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /ok/);
});
