'use strict';

// Her check of herself (src/main/system/selftest.js, started by `Capri.exe --selftest=<folder>`, which the selftest/ folder does):
// where it writes, that it works in a data folder of its own before anything reads her settings, what it makes of a picture, that one
// look failing or hanging does not stop the others, and that what is found is kept as it goes.
//   npm run test:selftest

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const selftest = require('../../src/main/system/selftest.js');
const control = require('../../src/main/system/control.js');
const { mainFile } = require('../helpers/source.js');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'capri-selftest-'));

test('the folder to write to is read from the command line, in both spellings', () => {
  assert.equal(selftest.dirFrom(['capri', '--selftest=/tmp/a']), path.resolve('/tmp/a'));
  assert.equal(selftest.dirFrom(['capri', '--selftest', '/tmp/b', '--dev']), path.resolve('/tmp/b'));
  assert.equal(selftest.dirFrom(['capri', '--selftest', '--dev']), path.join(os.tmpdir(), 'capri-selftest'), 'a bare flag: a folder of the system temp');
  assert.equal(selftest.dirFrom(['capri', '--selftest=']), path.join(os.tmpdir(), 'capri-selftest'));
  assert.equal(selftest.dirFrom(['capri', '--dev', '--selftest-mic']), '', 'the other flags are not it');
  assert.equal(selftest.dirFrom([]), '');
});

test('how her window is drawn can be asked for, and only the two ways she knows', () => {
  assert.equal(selftest.renderFrom(['x', '--selftest-render=software']), 'software');
  assert.equal(selftest.renderFrom(['x', '--selftest-render=gl']), 'gl');
  for (const bad of ['--selftest-render=', '--selftest-render=vulkan', '--selftest-render=gl;calc', '--selftest']) assert.equal(selftest.renderFrom(['x', bad]), '', bad);
});

test('it works in a data folder of its own: settings that keep every first-run window and download away, a port of its own', () => {
  const dir = temp();
  const paths = {};
  const app = { setPath: (name, value) => { paths[name] = value; } };
  const env = {};
  const data = selftest.isolate({ app, dir, env, render: 'software' });
  assert.equal(data, path.join(dir, 'userdata'));
  assert.equal(paths.userData, data);
  assert.equal(paths.sessionData, data);
  const config = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'));
  assert.deepEqual(config, { welcomed: true, hubDone: true, provisioned: true, autoSetup: false, render: 'software' });
  assert.ok(Number(env.CAPRI_PORT) >= 20000 && Number(env.CAPRI_PORT) < 50000, 'a port that is not the usual one');

  const keep = { CAPRI_PORT: '1234' };
  selftest.isolate({ app, dir, env: keep });
  assert.equal(keep.CAPRI_PORT, '1234', 'a port that was asked for stays');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).render, undefined, 'no drawing way unless asked');
});

test('an Electron without sessionData does not stop it', () => {
  const dir = temp();
  const app = { setPath: (name) => { if (name === 'sessionData') throw new Error('Failed to get \'sessionData\' path'); } };
  assert.doesNotThrow(() => selftest.isolate({ app, dir, env: {} }));
});

test('in main.js the data folder is chosen before anything reads it, and nothing is started or fetched in a check', () => {
  const text = fs.readFileSync(mainFile('main.js'), 'utf8');
  const isolate = text.indexOf('selftest.isolate(');
  assert.ok(isolate > 0, 'isolate is called');
  for (const early of ['const folder = createFolder(', 'const voiceSample = createSample(', 'const installed = createInstalled(', 'const memoryFile =']) {
    assert.ok(text.indexOf(early) > isolate, `${early} comes after the data folder is set`);
  }
  assert.ok(text.indexOf('const PORT =') > isolate, 'the port is read after the check set its own');
  const whenReady = text.slice(text.indexOf('app.whenReady().then(() => {\n    if (!['));
  assert.match(whenReady, /if \(SELFTEST\) \{\s*\/\/[^\n]*\n\s*\} else if \(firstTime/, 'no main menu opens by itself, no set-up runs, nothing is synced');
  assert.match(whenReady, /if \(!SELFTEST\) \{\s*adoptBundledVoice\(\);\s*refreshModels\(\);/, 'no voice adopted, no models asked for, no launch scan');
  assert.match(whenReady, /if \(SELFTEST\) startSelftest\(\);/);
});

test('a picture in numbers: nothing drawn, drawn, and drawn black (a window a graphics driver painted over)', () => {
  const px = (r, g, b, a, n = 100) => Buffer.from(Array.from({ length: n }, () => [b, g, r, a]).flat()); // (BGRA, as Electron gives it)
  const nothing = selftest.nonBlank(px(0, 0, 0, 0), { step: 1 });
  assert.deepEqual(nothing, { sampled: 100, opaque: 0, black: 0, colourful: 0 });
  const black = selftest.nonBlank(px(0, 0, 0, 255), { step: 1 });
  assert.equal(black.opaque, 100);
  assert.equal(black.black, 100);
  const drawn = selftest.nonBlank(Buffer.concat([px(250, 20, 120, 255, 30), px(0, 0, 0, 0, 70)]), { step: 1 });
  assert.equal(drawn.opaque, 30);
  assert.equal(drawn.colourful, 30);
  assert.equal(drawn.black, 0);
  assert.equal(selftest.nonBlank(Buffer.alloc(0)).sampled, 0, 'an empty picture is not an error');
});

test('a look is timed, a look that throws is written down, and one that hangs is given up on', async () => {
  const good = await selftest.step('good', async () => ({ a: 1 }));
  assert.equal(good.ok, true);
  assert.deepEqual(good.data, { a: 1 });
  assert.equal(good.name, 'good');
  const bad = await selftest.step('bad', () => { throw new Error('no PowerShell'); });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'no PowerShell');
  const stuck = await selftest.step('stuck', () => new Promise(() => {}), 40);
  assert.equal(stuck.ok, false);
  assert.match(stuck.error, /stuck/);
  assert.ok(stuck.ms < 2000, 'it did not wait for ever');
});

// the pieces main.js hands over, as stand-ins
function ctxFor(dir, { failHardware = false } = {}) {
  const png = Buffer.from('png');
  const bitmap = Buffer.from(Array.from({ length: 50 }, () => [60, 30, 200, 255]).flat());
  const image = { getSize: () => ({ width: 5, height: 10 }), toPNG: () => png, toBitmap: () => bitmap, isEmpty: () => false };
  const contents = (url) => ({
    isLoading: () => false,
    getURL: () => url,
    capturePage: async () => image,
    executeJavaScript: async (code) => (/getUserMedia/.test(code) ? { errors: [], mic: true } : { errors: [], webgl: { renderer: 'stand-in' }, title: 'x' }),
  });
  const overlay = { isDestroyed: () => false, webContents: contents('capri://app/src/renderer/index.html'), getBounds: () => ({ x: 0, y: 0, width: 5, height: 5 }), isVisible: () => true, isAlwaysOnTop: () => true, isFocused: () => false, getOpacity: () => 1 };
  const hubWindow = { isDestroyed: () => false, webContents: contents('capri://app/src/renderer/hub.html'), getBounds: () => ({ x: 1, y: 1, width: 4, height: 4 }), isVisible: () => true };
  let hubShown = 0;
  const saved = {};
  return {
    app: {
      getName: () => 'capri', getVersion: () => '9.9.9', isPackaged: false, getLocale: () => 'ru', getSystemLocale: () => 'ru-RU',
      getGPUInfo: async () => ({ gpuDevice: [{ vendorId: 1 }] }), getGPUFeatureStatus: () => ({ webgl: 'enabled' }),
      getPath: (name) => (name === 'userData' ? dir : os.tmpdir()),
    },
    electron: {
      screen: { getAllDisplays: () => [{ id: 1, bounds: {}, workArea: {}, scaleFactor: 1.5 }], getPrimaryDisplay: () => ({ id: 1 }), getCursorScreenPoint: () => ({ x: 1, y: 2 }) },
      globalShortcut: { isRegistered: () => true },
      desktopCapturer: { getSources: async () => [{ name: 'Screen 1', thumbnail: image }] },
      BrowserWindow: { getAllWindows: () => [overlay, hubWindow] },
    },
    root: path.join(__dirname, '..', '..'),
    dir,
    overlay: () => overlay,
    hub: () => ({ show: () => { hubShown++; } }),
    config: { save: (patch) => { Object.assign(saved, patch); fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(saved)); }, flush() {}, file: () => path.join(dir, 'config.json'), load: () => ({ ...saved }) },
    pause: async () => {},
    hardware: { scan: async () => { if (failHardware) throw new Error('PowerShell would not start'); return { cpu: { name: 'x' } }; } },
    profiles: { plan: () => ({ id: 'standard', mind: {}, voice: {}, ears: {}, disk: {}, notes: [] }) },
    control: { probe: async () => 'ps=5.1 screen=1920x1080 windows=7' },
    windowsSeen: () => 3,
    tray: () => ({ isDestroyed: () => false }),
    windowWatchRunning: () => true,
    shown: () => hubShown,
  };
}

test('every look is made and written, with the two pictures, and the exit says whether all went well', async () => {
  const dir = temp();
  const ctx = ctxFor(dir);
  const code = await selftest.execute(ctx);
  assert.equal(code, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'electron.json'), 'utf8'));
  assert.equal(report.done, true);
  assert.equal(report.ok, true);
  const names = report.steps.map((s) => s.name);
  for (const want of ['program', 'graphics', 'displays', 'folders', 'settings', 'program files', 'this PC and her plan for it', 'her helpers', 'her window', 'her page', 'what she draws', 'her sight (screen capture)', 'her main menu']) {
    assert.ok(names.includes(want), want);
  }
  assert.equal(names.includes('PowerShell and her hands'), process.platform === 'win32', 'the hands are looked at on Windows only');
  assert.ok(fs.existsSync(path.join(dir, 'overlay.png')));
  assert.ok(fs.existsSync(path.join(dir, 'hub.png')));
  assert.equal(ctx.shown(), 1, 'her main menu was opened once');
  const draws = report.steps.find((s) => s.name === 'what she draws').data;
  assert.equal(draws.verdict, 'drawn');
  assert.equal(report.steps.find((s) => s.name === 'program').data.version, '9.9.9');
  assert.equal(report.steps.find((s) => s.name === 'her helpers').data.windowsSeen, 3);
});

test('a look that fails is told, the rest are still made, and the exit code says one failed', async () => {
  const dir = temp();
  const code = await selftest.execute(ctxFor(dir, { failHardware: true }));
  assert.equal(code, 1);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'electron.json'), 'utf8'));
  assert.equal(report.ok, false);
  const failed = report.steps.filter((s) => !s.ok);
  assert.deepEqual(failed.map((s) => s.name), ['this PC and her plan for it']);
  assert.match(failed[0].error, /would not start/);
  assert.ok(report.steps.some((s) => s.name === 'her main menu' && s.ok), 'the ones after it were made');
});

test('what is found is kept as it goes, so that a check that is stopped leaves what it had', async () => {
  const dir = temp();
  const seen = [];
  await selftest.run({ ...ctxFor(dir), progress: (partial) => seen.push(partial.steps.length) });
  assert.ok(seen.length >= 10);
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'one more each time');
  const first = [];
  await selftest.execute({ ...ctxFor(dir), progress: undefined });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'electron.json'), 'utf8')).done, true, 'the last write says it is whole');
  assert.equal(first.length, 0);
});

test('her page is asked about the drawing, the sound, the files she is served and (only when told) the microphone', () => {
  const plain = selftest.probeScript();
  const withMic = selftest.probeScript({ mic: true });
  for (const want of ['webgl2', 'WEBGL_debug_renderer_info', 'audioWorklet.addModule', 'enumerateDevices', 'speechSynthesis', 'capri://app/']) assert.ok(plain.includes(want), want);
  assert.ok(/if \(false\) \{\s*await attempt\('microphone'/.test(plain), 'no microphone unless told');
  assert.ok(/if \(true\) \{\s*await attempt\('microphone'/.test(withMic));
  for (const f of selftest.FILES) assert.ok(plain.includes(JSON.stringify(f)), f);
  assert.doesNotThrow(() => new Function(`return ${withMic}`), 'it is code that parses');
  assert.doesNotMatch(plain, /__FILES__|__MIC__/);
});

test('the files she lists as needed are the ones in the program, and the scripts PowerShell reads are the unpacked ones', () => {
  const root = path.join(__dirname, '..', '..');
  for (const f of [...selftest.FILES, ...selftest.UNPACKED]) assert.ok(fs.existsSync(path.join(root, f)), f);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const f of selftest.UNPACKED) assert.ok(pkg.build.asarUnpack.includes(f), `${f} is unpacked from the archive`);
});

test('the probe of her hands touches nothing: both helpers, and a look at the version, the screen and the windows', async () => {
  const real = control.runner.run;
  const calls = [];
  control.runner.run = async (script, timeout, opts) => { calls.push({ script, timeout, opts }); return 'ps=5.1 screen=1x1 windows=2'; };
  try {
    assert.equal(await control.probe(), 'ps=5.1 screen=1x1 windows=2');
  } finally {
    control.runner.run = real;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.mouse, true, 'the mouse helper is compiled too');
  assert.match(calls[0].script, /\[CapriHands\]::Find\(''\)/);
  assert.match(calls[0].script, /\[CapriMouse\]::Width\(\)/);
  assert.doesNotMatch(calls[0].script, /SetCursorPos|Move\(|Click\(|SendKeys|Set-Clipboard|ShowWindow|PostMessage|Focus\(/, 'nothing is moved, pressed, copied or closed');
});

test('the same message again is counted, not listed again', () => {
  const handlers = {};
  const app = { on: (name, fn) => { handlers[name] = fn; } };
  const errors = [];
  selftest.listen({ app }, errors);
  const contents = { handlers: {}, on(name, fn) { this.handlers[name] = fn; }, getURL: () => 'capri://x' };
  handlers['web-contents-created']({}, contents);
  for (let i = 0; i < 5; i++) contents.handlers['console-message']({ level: 'warning', message: 'GPU stall', lineNumber: 1, sourceId: 'capri://app/index.html' });
  contents.handlers['console-message']({ level: 'error', message: 'boot failed', lineNumber: 9, sourceId: 'capri://app/app.js' });
  contents.handlers['console-message']({ level: 'info', message: 'fine', lineNumber: 1, sourceId: '' });
  assert.equal(errors.length, 2, 'the info one is not an error');
  assert.equal(errors[0].times, 5);
  assert.equal(errors[1].kind, 'console-error');
  contents.handlers['console-message']({}, 3, 'older Electron', 4, 'capri://app/old.js');
  assert.equal(errors[2].kind, 'console-error', 'the older way of giving the arguments is read too');
  handlers['render-process-gone']({}, contents, { reason: 'crashed' });
  assert.equal(errors.at(-1).kind, 'render-process-gone');
});
