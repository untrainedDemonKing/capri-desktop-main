'use strict';

// The "Проверка Капри" folder (selftest/): what it takes out of a report before it is packed, the zip it writes, the addresses it asks
// about, how it reads what the program says of herself, how it runs the tests, and that what it sends PowerShell is what Capri's hands
// would send. Nothing here needs Windows (the PowerShell parts are looked at as text).
//   npm run test:selftest

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const KIT = path.join(ROOT, 'selftest');
const lib = (name) => require(path.join(KIT, 'lib', name));

const { makeRedactor } = lib('redact.js');
const zip = lib('zip.js');
const net = lib('net.js');
const wav = lib('wav.js');
const { parseArgs } = lib('args.js');
const { createContext } = lib('context.js');
const report = lib('report.js');
const app = lib('app.js');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'capri-kit-test-'));

// ---- what is taken out ----

test('names of the user and the PC, the home folder and the addresses of the home network are taken out; the rest stays', () => {
  const redact = makeRedactor({ home: 'C:\\Users\\Иван Петров', user: 'Иван Петров', host: 'DESKTOP-ABC123' });
  const text = redact([
    'C:\\Users\\Иван Петров\\AppData\\Local\\Capri\\x.json', 'C:\\\\Users\\\\Иван Петров\\\\y', 'DESKTOP-ABC123 says hello', 'proxy http://bob:secret@10.0.0.7:8080/',
    'ip 192.168.1.20 and 172.20.5.9 and 127.0.0.1 and 8.8.8.8', 'mac aa:bb:cc:dd:ee:ff', 'S-1-5-21-111-222-333-1001', 'key sk-abcdefghijklmnopqrstuvwx and hf_abcdefghijklmnopqrstuvwxyz',
  ].join('\n'));
  assert.doesNotMatch(text, /Иван|Петров|ABC123|bob|secret|192\.168|172\.20|aa:bb|1001|sk-abc|hf_abc/);
  assert.match(text, /~\\AppData\\Local\\Capri\\x\.json/);
  assert.match(text, /127\.0\.0\.1/, 'the loopback address stays');
  assert.match(text, /8\.8\.8\.8/, 'a public address stays');
  const unix = makeRedactor({ home: '/home/alice', user: 'alice', host: 'box1' });
  assert.equal(unix('/home/alice/.config/x and alice and malice and /tmp/alice-x'), '~/.config/x and <user> and malice and /tmp/alice-x');
});

test('a user name that is too short to be told from a word is left alone, not turned into holes in every sentence', () => {
  const redact = makeRedactor({ home: '/home/al', user: 'al', host: 'pc' });
  assert.equal(redact('all is well, al'), 'all is well, al');
});

// ---- the zip ----

// a reader for the zip, to see that what was written can be read back (the central directory, inflating each file, the crc)
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'an end record');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    assert.ok(flags & 0x0800, 'names are marked UTF-8');
    const local = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const body = buf.subarray(local, local + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.equal(zip.crc32(data), crc, `crc of ${name}`);
    files[name] = data;
    at += 46 + nameLength;
  }
  return files;
}

test('the zip holds every file with its name in UTF-8, packed or stored as it is smaller, and reads back', () => {
  const dir = temp();
  fs.mkdirSync(path.join(dir, 'logs', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.txt'), 'привет '.repeat(500));
  fs.writeFileSync(path.join(dir, 'logs', 'unit', 'a.log'), 'x');
  fs.writeFileSync(path.join(dir, 'pic.png'), crypto.randomBytes(300));
  fs.mkdirSync(path.join(dir, 'userdata'));
  fs.writeFileSync(path.join(dir, 'userdata', 'config.json'), '{"key":"secret"}');
  const target = path.join(temp(), 'out.zip');
  const n = zip.zipFolder(dir, target, { prefix: 'capri-check-1', skip: (rel) => /(^|\/)userdata(\/|$)/.test(rel), transform: (rel, data) => (rel === 'logs/unit/a.log' ? Buffer.from('changed') : data) });
  assert.equal(n, 3, 'the folder of her data is left out');
  const files = unzip(fs.readFileSync(target));
  assert.deepEqual(Object.keys(files).sort(), ['capri-check-1/logs/unit/a.log', 'capri-check-1/pic.png', 'capri-check-1/report.txt']);
  assert.equal(files['capri-check-1/report.txt'].toString('utf8'), 'привет '.repeat(500));
  assert.equal(files['capri-check-1/logs/unit/a.log'].toString(), 'changed', 'a file can be changed on its way in');
  assert.ok(fs.statSync(target).size < 4000, 'the text was packed');
});

// ---- the command line ----

test('the command line: quick by default, full on request, a part left out, a path with a space or an equals sign', () => {
  assert.equal(parseArgs([]).mode, 'quick');
  const o = parseArgs(['--full', '--yes', '--keep', '--no-hands', '--no-real', '--out', 'C:\\My Files\\out', '--capri=C:\\Prog Files\\Capri\\Capri.exe', 'stray']);
  assert.equal(o.mode, 'full');
  assert.ok(o.yes && o.keep);
  assert.deepEqual([...o.skip].sort(), ['hands', 'real']);
  assert.equal(o.out, 'C:\\My Files\\out');
  assert.equal(o.capri, 'C:\\Prog Files\\Capri\\Capri.exe');
  assert.deepEqual(o.unknown, ['stray']);
  assert.equal(parseArgs(['--full', '--quick']).mode, 'quick', 'the last one says');
});

// ---- the network ----

test('the addresses it asks about are the ones in Capri\'s code, each over HTTPS, each with a name', () => {
  const list = net.targets(ROOT);
  const ids = list.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  for (const t of list) {
    assert.match(t.url, /^https:\/\//, t.id);
    assert.ok(t.title && ['need', 'cloud', 'extra'].includes(t.level), t.id);
  }
  const whisper = require('../../src/main/voice/whisper.js');
  const piper = require('../../src/main/voice/piper.js');
  assert.ok(list.find((t) => t.id === 'whisper-zip').url.startsWith(`${whisper.RELEASES}/${whisper.VERSIONS[0]}/${whisper.ASSETS['win32-x64']}`), 'the program she fetches');
  for (const tier of Object.values(whisper.TIERS)) assert.ok(list.some((t) => t.url === `${whisper.MODELS}/${tier.file}`), tier.file);
  assert.ok(list.some((t) => t.url === `${piper.RELEASE}/${piper.ASSETS['win32-x64']}`), 'Piper');
  assert.ok(list.some((t) => t.url === `${piper.VOICES}/voices.json`), 'the voices');
});

test('an address is asked for its first byte only, and what comes back is read: a status, the size from the range, the host it ended on; a failure is told in words', async () => {
  const fetchFn = async (url, opts) => {
    if (/dead/.test(url)) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (/cert/.test(url)) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } });
    assert.equal(opts.method, 'GET');
    assert.equal(opts.headers.range, 'bytes=0-0');
    return { status: 206, url: 'https://objects.example.org/x', headers: { get: (h) => ({ 'content-range': 'bytes 0-0/3675974', date: 'Thu, 29 Oct 2026 10:00:00 GMT' })[h.toLowerCase()] || null }, body: { cancel: async () => {} } };
  };
  const ok = await net.probe({ url: 'https://example.org/f.zip', range: true }, fetchFn);
  assert.deepEqual([ok.status, ok.size, ok.host], [206, 3675974, 'objects.example.org']);
  const dead = await net.probe({ url: 'https://dead.example.org/' }, fetchFn);
  assert.equal(dead.status, 0);
  assert.match(dead.why, /DNS/);
  assert.match((await net.probe({ url: 'https://cert.example.org/' }, fetchFn)).why, /сертификат/);
  assert.equal(net.explain(Object.assign(new Error('x'), { name: 'TimeoutError' })).code, 'TIMEOUT');
});

// ---- the wav ----

test('a speech file of any rate comes out as 16 kHz 16 bit mono, and a quiet one is told by its peak', () => {
  const s = new Int16Array(22050).map((_, i) => Math.round(8000 * Math.sin(i / 10)));
  const slow = wav.write(s, 22050);
  const fine = wav.to16k(slow);
  const info = wav.read(fine);
  assert.equal(info.rate, 16000);
  assert.ok(Math.abs(info.samples.length - 16000) <= 1);
  assert.ok(wav.peak(fine) > 0.2 && wav.peak(wav.write(new Int16Array(100), 16000)) === 0);
  assert.throws(() => wav.read(Buffer.from('not a wav file at all, but long enough to be read as one................')), /not a wav/);
});

// ---- the tests it runs ----

test('it runs the test files one by one with the Node it runs on, and counts passes, failures and left-out ones from the events (no reporter to parse)', async () => {
  const source = temp();
  fs.mkdirSync(path.join(source, 'tests', 'main'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), '{}');
  fs.writeFileSync(path.join(source, 'tests', 'main', 'good.test.js'), "const t=require('node:test');t('one',()=>{});t('two',async()=>{});t.skip('three',()=>{});");
  fs.writeFileSync(path.join(source, 'tests', 'main', 'bad.test.js'), "const t=require('node:test');const a=require('node:assert');t('fine',()=>{});t('breaks',()=>{a.strictEqual(1,2)});");
  fs.writeFileSync(path.join(source, 'tests', 'main', 'crash.test.js'), 'throw new Error("cannot even load");');
  const ctx = createContext(parseArgs(['--out', path.join(temp(), 'out')]), KIT);
  ctx.source = source;
  ctx.say = () => {};
  await lib('unit.js').run(ctx);
  const by = Object.fromEntries(ctx.facts.unit.tallies.map((t) => [path.basename(t.file), t]));
  assert.deepEqual([by['good.test.js'].pass, by['good.test.js'].fail, by['good.test.js'].skip], [2, 0, 1]);
  assert.deepEqual([by['bad.test.js'].pass, by['bad.test.js'].fail], [1, 1]);
  assert.match(by['bad.test.js'].failures[0].error, /strictly equal|1 !== 2/);
  assert.ok(by['crash.test.js'].fail > 0 || by['crash.test.js'].crashed, 'a file that cannot load is a failure');
  const verdict = ctx.results.find((r) => r.title === 'Тесты кода');
  assert.equal(verdict.status, 'fail');
  assert.ok(ctx.results.some((r) => /bad\.test\.js/.test(r.title) && r.status === 'fail'));
  const log = fs.readFileSync(ctx.path('logs/unit/tests_main_bad.test.js.log'), 'utf8');
  assert.match(log, /FAILED +breaks/);
  assert.match(log, /ok +fine/);
});

// ---- the PowerShell of her hands, as the check collects it ----

test('every action of her hands is collected as the script that would be sent, whole, with the mark at its start, and none is too long for a command line', () => {
  const out = temp();
  const run = cp.spawnSync(process.execPath, [path.join(KIT, 'lib', 'capture.js'), ROOT, out], { env: { ...process.env, CAPRI_CHECK_FAKE_WIN: '1' }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const index = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.ok(index.length >= 17, 'every action');
  for (const item of index) {
    assert.ok(item.file, `${item.name}: ${item.error}`);
    assert.ok(item.encodedLength < 30000, `${item.name} is ${item.encodedLength}`);
    const buf = fs.readFileSync(path.join(out, item.file));
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${item.name} has the mark`);
    const text = buf.subarray(3).toString('utf8');
    assert.match(text, /Add-Type/, item.name);
    assert.match(text, /try \{/, item.name);
  }
  const type = fs.readFileSync(path.join(out, 'type.ps1'), 'utf8');
  assert.doesNotMatch(type, /Привет/, 'the text is data (base64), never code');
  assert.match(fs.readFileSync(path.join(out, 'probe.ps1'), 'utf8'), /CapriMouse/);
});

test('the test window and the check of the hands agree: the title it is looked for by, and every field of its state file', () => {
  const target = fs.readFileSync(path.join(KIT, 'windows', 'target.ps1'), 'utf8');
  const hands = fs.readFileSync(path.join(KIT, 'lib', 'hands.js'), 'utf8');
  assert.match(target, /\$form\.Text = 'CapriSelfTest'/);
  assert.match(hands, /const TITLE = 'CapriSelfTest'/);
  for (const field of ['ready', 'clicks', 'clicksRu', 'text', 'selected', 'windowState', 'inFront', 'cursor', 'form', 'one', 'two', 'ruName']) {
    assert.match(target, new RegExp(`\\b${field} = `), `the window writes ${field}`);
  }
  for (const field of ['inFront', 'clicksRu', 'selected', 'windowState', 'cursor', 'ruName', 'started.one', 'started.form']) assert.ok(hands.includes(field), `the check reads ${field}`);
  assert.match(target, /SetProcessDPIAware/, 'in pixels of the screen, like the hands');
  assert.match(target, /0x041D, 0x0430/, 'the Russian name is made of letter numbers, so the file needs no encoding');
});

test('the Russian name of the second button in the window is "Нажми меня"', () => {
  const target = fs.readFileSync(path.join(KIT, 'windows', 'target.ps1'), 'utf8');
  const codes = /\[char\[\]\]\(([^)]+)\)/.exec(target)[1].split(',').map((x) => Number(x.trim()));
  assert.equal(String.fromCharCode(...codes), 'Нажми меня');
});

// ---- the launchers ----

test('the launchers find Node 20, else Capri\'s own, and start selftest.js with what they were given', () => {
  const start = fs.readFileSync(path.join(KIT, 'lib', 'start.cmd'), 'latin1');
  assert.match(start, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(start, /selftest\.js" %\*/);
  assert.match(start, /Programs\\Capri\\Capri\.exe/);
  assert.match(start, /process\.versions\.node/);
  for (const [file, mode] of [['RUN-QUICK-CHECK.cmd', '--quick'], ['RUN-FULL-CHECK.cmd', '--full']]) {
    const text = fs.readFileSync(path.join(KIT, file), 'latin1');
    assert.match(text, new RegExp(`lib\\\\start\\.cmd" ${mode} %\\*`), file);
  }
  const sh = fs.readFileSync(path.join(KIT, 'check.sh'), 'utf8');
  assert.match(sh, /ELECTRON_RUN_AS_NODE=1/);
  assert.ok(!sh.includes('\r'), 'a shell script with Unix line ends');
  if (process.platform !== 'win32') {
    for (const f of ['check.sh', 'check.command']) assert.ok(fs.statSync(path.join(KIT, f)).mode & 0o100, `${f} can be run`);
  }
});

test('--help says what the options are and leaves at once', () => {
  const run = cp.spawnSync(process.execPath, [path.join(KIT, 'selftest.js'), '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--full/);
  assert.match(run.stdout, /--quick/);
});

// ---- reading what she says of herself ----

function fakeRun(report, code = 0) {
  return { name: 'default', dir: '', code, ms: 8000, report, output: '' };
}
function judged(report, label = '') {
  const ctx = createContext(parseArgs(['--out', path.join(temp(), 'o')]), KIT);
  ctx.say = () => {};
  const verdict = app.judge(ctx, fakeRun(report), label);
  return { ctx, verdict };
}
const stepOf = (name, data) => ({ name, ok: true, ms: 1, data });

test('a Capri that wrote nothing is a failure that says which of the two it probably is', () => {
  const { ctx, verdict } = judged(null);
  assert.equal(verdict.ran, false);
  assert.equal(ctx.results[0].status, 'fail');
  assert.match(ctx.results[0].detail, /без режима проверки|упала на старте/);
});

test('her window drawn is fine; empty or black is told apart, and WebGL missing is a failure of its own', () => {
  const page = (webgl) => stepOf('her page', { webgl, webgl2: webgl, audio: { sampleRate: 16000, worklet: 'ok', defaultRate: 48000 }, devices: { count: { audioinput: 1, audiooutput: 1 } }, protocol: { 'src/renderer/index.html': '200 10' }, permissions: { microphone: 'prompt' }, errors: [] });
  const good = judged({ done: true, steps: [stepOf('what she draws', { verdict: 'drawn', opaque: 100, sampled: 1000, black: 3 }), page({ renderer: 'ANGLE (NVIDIA)' })], errors: [] });
  assert.equal(good.verdict.drawn, true);
  assert.equal(good.ctx.results.filter((r) => r.status === 'fail').length, 0);
  const black = judged({ done: true, steps: [stepOf('what she draws', { verdict: 'black', opaque: 100, sampled: 1000, black: 99 }), page(null)], errors: [] });
  assert.equal(black.verdict.drawn, false);
  const fails = black.ctx.results.filter((r) => r.status === 'fail').map((r) => r.title);
  assert.deepEqual(fails, ['Её окно рисуется', 'WebGL']);
  assert.match(black.ctx.results.find((r) => r.title === 'Её окно рисуется').detail, /чёрное/);
  const empty = judged({ done: true, steps: [stepOf('what she draws', { verdict: 'nothing drawn', opaque: 0, sampled: 1000, black: 0 })], errors: [] });
  assert.match(empty.ctx.results.find((r) => r.title === 'Её окно рисуется').detail, /пустое/);
});

test('a way of drawing tried after the first is judged on drawing alone, and a microphone Windows refuses is a failure with its reason', () => {
  const steps = [stepOf('what she draws', { verdict: 'drawn', opaque: 9, sampled: 10, black: 0 }), stepOf('her page', { webgl: { renderer: 'x' }, protocol: {}, errors: ['a: b'], microphone: { ok: false, error: 'NotAllowedError Permission denied' } })];
  const again = judged({ done: true, steps, errors: [] }, 'без видеокарты');
  assert.ok(again.ctx.results.every((r) => /без видеокарты/.test(r.title)), 'every line says which way it was');
  assert.ok(!again.ctx.results.some((r) => /Микрофон|Звук/.test(r.title)), 'the rest is not repeated');
  const first = judged({ done: true, steps, errors: [] });
  const mic = first.ctx.results.find((r) => /Микрофон открывается/.test(r.title));
  assert.equal(mic.status, 'fail');
  assert.match(mic.detail, /NotAllowedError/);
});

// ---- the report ----

test('the report says first what is wrong, then what to note, then everything in order', () => {
  const ctx = createContext(parseArgs(['--out', path.join(temp(), 'o')]), KIT);
  ctx.say = () => {};
  ctx.add('unit', 'Тесты кода', 'fail', '3 не прошли');
  ctx.add('network', 'GitHub', 'pass', '200');
  ctx.add('app', 'Микрофон', 'warn', 'не найден');
  ctx.add('real', 'Голос', 'skip', 'нет');
  const sum = report.summary(ctx.results);
  assert.deepEqual(sum, { fail: 1, warn: 1, pass: 1, skip: 1, info: 0 });
  const text = report.textReport(ctx, sum);
  assert.ok(text.indexOf('ЧТО НЕ ТАК') < text.indexOf('НА ЗАМЕТКУ') && text.indexOf('НА ЗАМЕТКУ') < text.indexOf('ВСЁ ПО ПОРЯДКУ'));
  assert.match(text, /ИТОГ: ошибок 1, предупреждений 1, в порядке 1, пропущено 1/);
});

test('finishing writes the report, packs the folder without her data, and cleans the names out of the text', () => {
  const base = temp();
  const ctx = createContext(parseArgs(['--out', path.join(base, 'check')]), KIT);
  ctx.say = () => {};
  ctx.add('system', 'Система', 'info', `home is ${os.homedir()} and the PC is ${os.hostname()}`);
  fs.mkdirSync(ctx.path('userdata'), { recursive: true });
  fs.writeFileSync(ctx.path('userdata/config.json'), 'SECRET');
  fs.writeFileSync(ctx.path('logs/other.log'), `in ${os.homedir()}/file`);
  const done = report.finish(ctx);
  const files = unzip(fs.readFileSync(done.zipFile));
  const names = Object.keys(files).map((n) => n.replace(/^[^/]+\//, ''));
  assert.ok(names.includes('report.txt') && names.includes('report.json') && names.includes('logs/other.log'));
  assert.ok(!names.some((n) => /userdata/.test(n)));
  if (os.homedir().length > 3) for (const body of Object.values(files)) assert.ok(!body.toString('utf8').includes(os.homedir()), 'the home folder is not in the zip');
  assert.match(done.zipFile, /capri-check-\d{8}-\d{6}\.zip$/);
});

// ---- the real run of her ears and her voice (Windows only in life: here with stand-ins for the fetching and the speaking) ----

const posix = process.platform !== 'win32';
const real = lib('real.js');

function realWorld({ usage = '  -m, --model FNAME\n  --host HOST\n  --port N\n  -t, --threads N\n  -l, --language LANG\n', vanish = false, checkFails = false, noVoice = false, heardEn = 'Hello Capri, how are you today? Please open the browser.', heardRu = 'Привет, Капри. Открой браузер и включи музыку.' } = {}) {
  const root = temp();
  const exe = path.join(root, 'whisper-server');
  fs.writeFileSync(exe, `#!/usr/bin/env node\nconsole.error(${JSON.stringify(usage)});`);
  fs.chmodSync(exe, 0o755);
  const stopped = [];
  class Whisper {
    async install() {
      if (vanish) fs.rmSync(exe);
      return { exe, dir: root, root };
    }
    async fetchModel() { return { file: 'x' }; }
    async check() { if (checkFails) throw new Error('the program stopped (code 3221225781)'); }
    status() { return { log: ['loading model', 'error: failed to initialize whisper context'] }; }
    stop() { stopped.push('whisper'); }
  }
  class Piper {
    async install() {}
    async fetchVoice() {}
    async speak() { return wav.write(new Int16Array(30000).map((_, i) => Math.round(9000 * Math.sin(i / 7))), 22050); }
    status() { return { log: [] }; }
    stop() { stopped.push('piper'); }
  }
  const said = [];
  const replies = [heardEn, heardRu, 'Hello, this is a test of the voice. The weather is good today.', 'Привет, это проверка голоса. Сегодня хорошая погода.'];
  const lib = {
    whisper: { Whisper, TIERS: { base: { file: 'ggml-base-q5_1.bin' } } },
    piper: { Piper },
    hardware: { systemIs64: () => true },
    stt: {
      // (the first two asks are of the Windows voices' speech, the next two of Piper's)
      transcribe: async (_cfg, _keys, { lang }) => {
        said.push(lang);
        return replies.shift();
      },
    },
    speech: async () => (noVoice ? null : wav.write(new Int16Array(16000).fill(1000), 16000)),
    settleMs: 0,
  };
  const ctx = createContext(parseArgs(['--full', '--out', path.join(temp(), 'o')]), KIT);
  ctx.say = () => {};
  return { ctx, lib, root, stopped, said };
}
const byTitle = (ctx, re) => ctx.results.filter((r) => re.test(r.title));

test('the real run, when all is well: the program, its flags, the model, the server, speech heard in both languages, a voice that speaks and is understood', { skip: !posix }, async () => {
  const w = realWorld();
  const ears = await real.ears(w.ctx, w.root, w.lib);
  assert.ok(ears, 'the server is handed on to the voice test');
  await real.voice(w.ctx, w.root, w.lib, ears);
  const bad = w.ctx.results.filter((r) => r.status !== 'pass');
  assert.deepEqual(bad.map((r) => `${r.title}: ${r.detail}`), []);
  assert.ok(byTitle(w.ctx, /флаги сервера на месте/).length === 1);
  assert.ok(byTitle(w.ctx, /Распознавание речи \(русский\)/).length === 1 && byTitle(w.ctx, /Распознавание речи \(английский\)/).length === 1);
  assert.ok(byTitle(w.ctx, /Голос Piper \(русский\) говорит и его понимают/).length === 1);
  assert.deepEqual(w.said, ['en', 'ru', 'en', 'ru'], 'her ears were asked in the language that was spoken');
  assert.ok(fs.existsSync(w.ctx.path('logs/whisper-server-help.txt')), 'what the program says of itself is kept');
});

test('the real run: a program an antivirus took away, a server that will not start (with the program\'s own words kept), and flags missing from its help are each told', { skip: !posix }, async () => {
  const gone = realWorld({ vanish: true });
  assert.equal(await real.ears(gone.ctx, gone.root, gone.lib), null);
  assert.match(byTitle(gone.ctx, /исчезла/)[0].detail, /антивирус/);

  const broken = realWorld({ checkFails: true });
  assert.equal(await real.ears(broken.ctx, broken.root, broken.lib), null);
  const fail = byTitle(broken.ctx, /сервер запускается и отвечает/)[0];
  assert.equal(fail.status, 'fail');
  assert.match(fail.detail, /3221225781/);
  assert.match(fs.readFileSync(broken.ctx.path('logs/whisper-server.log'), 'utf8'), /failed to initialize whisper context/);

  const odd = realWorld({ usage: 'usage: whisper-server [options]\n  --port N\n' });
  await real.ears(odd.ctx, odd.root, odd.lib);
  const flags = byTitle(odd.ctx, /флаги сервера/)[0];
  assert.equal(flags.status, 'warn');
  assert.match(flags.detail, /--host/);
});

test('the real run: speech heard wrongly is a failure, a PC with no Windows voice of a language skips that language only', { skip: !posix }, async () => {
  const wrong = realWorld({ heardEn: 'thank you for watching', heardRu: 'Продолжение следует' });
  await real.ears(wrong.ctx, wrong.root, wrong.lib);
  assert.deepEqual(byTitle(wrong.ctx, /^Распознавание речи \(/).map((r) => r.status), ['fail', 'fail']);

  const mute = realWorld({ noVoice: true });
  await real.ears(mute.ctx, mute.root, mute.lib);
  assert.equal(byTitle(mute.ctx, /голоса Windows для проверки нет/).length, 2);
  assert.ok(mute.ctx.results.some((r) => /Распознавание живой речи/.test(r.title) && r.status === 'skip'));
});

test('the full parts leave themselves out of a quick check, and out of a system they are not for', async () => {
  const quick = createContext(parseArgs(['--out', path.join(temp(), 'o')]), KIT);
  quick.say = () => {};
  await real.run(quick);
  await lib('hands.js').run(quick);
  assert.deepEqual(quick.results.map((r) => r.status), ['skip', 'skip']);
});

// ---- the hands on the test window: the check's reading of what the window saw ----

const { EventEmitter } = require('node:events');

// a stand-in for the window and for her hands: each action changes the window's state file as the real window would
function handsWorld({ noFocus = false, garble = false, noClip = false } = {}) {
  const ctx = createContext(parseArgs(['--full', '--out', path.join(temp(), 'o')]), KIT);
  ctx.say = () => {};
  ctx.source = ROOT;
  const st = {
    ready: true, pid: 1, clicks: 0, clicksRu: 0, text: '', selected: 0, windowState: 'Normal', inFront: false,
    cursor: { x: 7, y: 9 }, form: { x: 100, y: 100, w: 520, h: 360 }, one: { x: 120, y: 280, w: 200, h: 50 }, two: { x: 360, y: 280, w: 200, h: 50 }, ruName: 'Нажми меня',
  };
  let file = '';
  const save = () => fs.writeFileSync(file, JSON.stringify(st));
  const child = Object.assign(new EventEmitter(), { exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(), kill() { this.exitCode = 9; } });
  const calls = [];
  let clip = '';
  const control = {
    windowOp: async (op) => {
      calls.push(`window ${op}`);
      if (op === 'focus' && !noFocus) st.inFront = true;
      if (op === 'minimize') st.windowState = 'Minimized';
      if (op === 'maximize') st.windowState = 'Maximized';
      if (op === 'restore') st.windowState = 'Normal';
      if (op === 'close') child.exitCode = 0;
      save();
      return 1;
    },
    type: async (text) => { calls.push('type'); st.text = garble ? text.replace('Капри', 'Kapri') : text; save(); return true; },
    pressKeys: async () => { calls.push('keys'); st.selected = st.text.length; save(); return true; },
    moveMouse: async (to) => { calls.push(`move ${to.x},${to.y}`); st.cursor = { x: to.x, y: to.y }; save(); return 'ok'; },
    clickMouse: async () => { calls.push('click'); st.clicks++; save(); return true; },
    scrollMouse: async () => { calls.push('scroll'); return true; },
    elementAction: async ({ name }) => { calls.push(`press ${name}`); if (name === 'Press me') st.clicks++; else st.clicksRu++; save(); return name; },
  };
  const deps = {
    win: true, control,
    start: (f) => { file = f; save(); return child; },
    ps: async (script) => {
      const set = /Set-Clipboard -Value '([^']*)'/.exec(script);
      if (set) clip = set[1];
      return { out: /Get-Clipboard/.test(script) ? (noClip ? 'something else' : clip) : '', err: '', code: 0 };
    },
  };
  return { ctx, deps, calls, st };
}

test('the hands on the test window: each action is checked against what the window itself wrote down, and the pointer goes home', async () => {
  const w = handsWorld();
  await lib('hands.js').run(w.ctx, w.deps);
  assert.deepEqual(w.ctx.results.filter((r) => r.status !== 'pass').map((r) => `${r.title}: ${r.detail}`), []);
  assert.ok(w.ctx.results.length >= 14, 'every action has its line');
  assert.deepEqual(w.calls.slice(0, 2), ['window focus', 'type']);
  assert.ok(w.calls.includes('press Press me') && w.calls.includes('press Нажми меня'), 'both buttons, the Russian one by its name');
  assert.equal(w.calls.at(-1), 'move 7,9', 'the pointer is put back where it was');
  assert.equal(w.calls.at(-2), 'window close');
  assert.equal(w.st.clicks, 2, 'one click of the mouse, one press by name');
});

test('the hands on the test window: a window that never comes to the front, text that arrives changed and a clipboard not put back are each a failure', { timeout: 60000 }, async () => {
  const w = handsWorld({ noFocus: true, garble: true, noClip: true });
  await lib('hands.js').run(w.ctx, w.deps);
  const failed = w.ctx.results.filter((r) => r.status === 'fail').map((r) => r.title);
  assert.ok(failed.some((t) => /вперёд/.test(t)), failed.join(' | '));
  assert.ok(failed.some((t) => /Печать/.test(t)));
  assert.ok(failed.some((t) => /Буфер обмена/.test(t)));
  assert.match(w.ctx.results.find((r) => /Печать/.test(r.title)).detail, /Kapri/, 'it says what arrived');
  assert.equal(w.calls.at(-1), 'move 7,9', 'even then the pointer goes home');
});

// ---- a part that hangs or crashes does not end the check ----

test('a part of the check that hangs is given up on (and what it started is ended); one that crashes is a finding too; the others go on', async () => {
  const ctx = createContext(parseArgs(['--out', path.join(temp(), 'o')]), KIT);
  ctx.say = () => {};
  let ended = 0;
  await ctx.phase('hangs', () => { ctx.onAbort = () => { ended++; }; return new Promise(() => {}); }, 0.001);
  await ctx.phase('crashes', () => { throw new Error('boom'); });
  await ctx.phase('fine', async () => ctx.add('x', 'done', 'pass'));
  assert.equal(ended, 1);
  assert.equal(ctx.onAbort, null, 'the hook does not stay for the next part');
  assert.deepEqual(ctx.results.map((r) => [r.title, r.status]), [['hangs: зависло', 'fail'], ['crashes: сама проверка упала', 'fail'], ['done', 'pass']]);
  assert.match(ctx.results[0].detail, /не закончилось/);
});
