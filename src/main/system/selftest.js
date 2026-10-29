'use strict';

// Her check of herself on a PC (`Capri.exe --selftest=<folder>`; the "Проверка Капри" folder, selftest/, starts it).
// She opens as usual but in a data folder of her own (nothing of yours is read, changed or started: no Ollama, no voice, no download),
// looks at herself for a few seconds, writes what she found to <folder>/electron.json (and two screenshots next to it) and quits.
// What she writes is facts about the PC and the program, never a key, a chat or a setting of yours.
//
// The pieces that need her windows are done with what main.js hands to run() (a window, the screen, the config…), so that the tests
// can give stand-ins; dirFrom(), isolate(), nonBlank() and the step runner are plain functions.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STEP_LIMIT = 25000; // ms one look may take before it is written down as stuck
const WHOLE_LIMIT = 150000; // ms for all of it: after that she quits however far she got

// `--selftest=<folder>` (or `--selftest <folder>`): where to write. A bare `--selftest` uses a folder of the system's temp.
function dirFrom(argv = process.argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a.startsWith('--selftest=')) return path.resolve(a.slice('--selftest='.length) || path.join(os.tmpdir(), 'capri-selftest'));
    if (a === '--selftest') return path.resolve(argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : path.join(os.tmpdir(), 'capri-selftest'));
  }
  return '';
}

// `--selftest-render=gl|software`: how her window is drawn for this run (her menu › Display), to find out which one works on this PC.
// Without it the default is used, which is what a first start does.
function renderFrom(argv = process.argv) {
  const a = argv.find((x) => String(x).startsWith('--selftest-render='));
  const v = a ? String(a).slice('--selftest-render='.length) : '';
  return ['gl', 'software'].includes(v) ? v : '';
}

// Her data folder for this run is inside the check's folder, with a settings file that keeps every first-run window and every
// download away. Done before anything reads the settings. The port of her bridge is a free-ish one of its own, so a Capri that is
// running meanwhile (and her single-instance lock, which is per data folder) is not in the way.
function isolate({ app, dir, env = process.env, render = '' }) {
  const data = path.join(dir, 'userdata');
  fs.mkdirSync(data, { recursive: true });
  app.setPath('userData', data);
  try {
    app.setPath('sessionData', data);
  } catch {
    // (older Electron: the same folder anyway)
  }
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ welcomed: true, hubDone: true, provisioned: true, autoSetup: false, ...(render && { render }) }));
  if (!env.CAPRI_PORT) env.CAPRI_PORT = String(20000 + Math.floor(Math.random() * 30000));
  return data;
}

// A picture (BGRA bytes, as Electron's toBitmap gives) in numbers: how much is drawn at all, and how much of that is plain black.
// A see-through window that came out black (a graphics driver's doing) is the second; nothing drawn at all is the first being 0.
function nonBlank(bitmap, { step = 4 } = {}) {
  let seen = 0;
  let opaque = 0;
  let black = 0;
  let colourful = 0;
  const px = Math.floor(bitmap.length / 4);
  for (let i = 0; i < px; i += step) {
    const at = i * 4;
    seen++;
    const [b, g, r, a] = [bitmap[at], bitmap[at + 1], bitmap[at + 2], bitmap[at + 3]];
    if (a < 8) continue;
    opaque++;
    if (r < 6 && g < 6 && b < 6) black++;
    else if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colourful++;
  }
  return { sampled: seen, opaque, black, colourful };
}

// One look: its name, how long it took, what it found or why it failed, and it never takes longer than `limit`.
async function step(name, fn, limit = STEP_LIMIT) {
  const started = Date.now();
  let timer;
  try {
    const data = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`stuck (more than ${limit / 1000} s)`)), limit); }),
    ]);
    return { name, ok: true, ms: Date.now() - started, data };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - started, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What her page is asked in its own window (executeJavaScript): what the screen's drawing and the sound can do here.
const RENDERER_PROBE = String.raw`(async () => {
  const out = { errors: [] };
  const attempt = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = null; out.errors.push(name + ': ' + (e && e.message || e)); } };
  const gl = (kind) => {
    const c = document.createElement('canvas');
    const g = c.getContext(kind);
    if (!g) return null;
    const ext = g.getExtension('WEBGL_debug_renderer_info');
    return { version: g.getParameter(g.VERSION), vendor: ext ? g.getParameter(ext.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR), renderer: ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER), maxTexture: g.getParameter(g.MAX_TEXTURE_SIZE) };
  };
  await attempt('webgl', async () => gl('webgl'));
  await attempt('webgl2', async () => gl('webgl2'));
  await attempt('page', async () => ({ url: location.protocol + '//' + location.host + location.pathname, title: document.title, dpr: window.devicePixelRatio, inner: [innerWidth, innerHeight], canvases: document.querySelectorAll('canvas').length, lang: navigator.language, languages: navigator.languages, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory || null }));
  await attempt('protocol', async () => {
    const res = {};
    for (const file of __FILES__) {
      try { const r = await fetch('capri://app/' + file); res[file] = r.status + ' ' + (await r.arrayBuffer()).byteLength; } catch (e) { res[file] = 'error ' + (e && e.message || e); }
    }
    return res;
  });
  await attempt('audio', async () => {
    const info = {};
    const ac = new AudioContext({ sampleRate: 16000 });
    info.sampleRate = ac.sampleRate;
    info.state = ac.state;
    try { await ac.audioWorklet.addModule('capri://app/src/renderer/js/senses/pcm-worklet.js'); info.worklet = 'ok'; } catch (e) { info.worklet = 'error ' + (e && e.message || e); }
    await ac.close();
    const dflt = new AudioContext();
    info.defaultRate = dflt.sampleRate;
    info.outputLatency = dflt.outputLatency ?? null;
    await dflt.close();
    return info;
  });
  await attempt('devices', async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    const count = {};
    for (const d of list) count[d.kind] = (count[d.kind] || 0) + 1;
    return { count, labelsKnown: list.some((d) => d.label) };
  });
  await attempt('permissions', async () => {
    const res = {};
    for (const name of ['microphone', 'camera', 'notifications']) {
      try { res[name] = (await navigator.permissions.query({ name })).state; } catch (e) { res[name] = 'unknown'; }
    }
    return res;
  });
  if (__MIC__) {
    await attempt('microphone', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ac = new AudioContext();
        const src = ac.createMediaStreamSource(stream);
        const an = ac.createAnalyser();
        src.connect(an);
        const data = new Float32Array(an.fftSize);
        let peak = 0;
        const end = Date.now() + 900;
        while (Date.now() < end) { an.getFloatTimeDomainData(data); for (const v of data) peak = Math.max(peak, Math.abs(v)); await new Promise((r) => setTimeout(r, 40)); }
        const tracks = stream.getAudioTracks().map((t) => ({ label: t.label, state: t.readyState, muted: t.muted, rate: (t.getSettings() || {}).sampleRate || null }));
        stream.getTracks().forEach((t) => t.stop());
        await ac.close();
        return { ok: true, tracks, peak: Math.round(peak * 1000) / 1000 };
      } catch (e) { return { ok: false, error: (e && e.name || '') + ' ' + (e && e.message || '') }; }
    });
  }
  await attempt('speech', async () => {
    if (!window.speechSynthesis) return { available: false };
    let voices = speechSynthesis.getVoices();
    if (!voices.length) { await new Promise((r) => { speechSynthesis.onvoiceschanged = r; setTimeout(r, 1500); }); voices = speechSynthesis.getVoices(); }
    return { available: true, count: voices.length, langs: [...new Set(voices.map((v) => v.lang))].slice(0, 30), russian: voices.filter((v) => /^ru/i.test(v.lang)).map((v) => v.name).slice(0, 6), english: voices.filter((v) => /^en/i.test(v.lang)).length };
  });
  await attempt('features', async () => ({ clipboard: Boolean(navigator.clipboard), serviceWorker: 'serviceWorker' in navigator, offscreen: typeof OffscreenCanvas, wasm: typeof WebAssembly, speechRecognition: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) }));
  return out;
})()`;

// the files her page and her windows are served from, which must be in the program
const FILES = [
  'src/renderer/index.html', 'src/renderer/hub.html', 'src/renderer/prepare.html',
  'src/renderer/js/senses/pcm-worklet.js', 'src/renderer/js/app.js', 'assets/icons/tray.png',
];
// the files that are read from outside the program's archive: PowerShell and Python cannot open them from inside it
const UNPACKED = ['src/main/system/windows.ps1', 'src/main/system/mover.ps1', 'src/main/system/media.ps1'];

const probeScript = ({ mic = false } = {}) => RENDERER_PROBE.replace('__FILES__', JSON.stringify(FILES)).replace('__MIC__', mic ? 'true' : 'false');

// A directory is writable if a file can be made in it and removed again.
function writable(dir) {
  try {
    const file = path.join(dir, `.capri-write-${process.pid}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, 'x');
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// Everything she looks at. `ctx` is what main.js gives (see its --selftest part); `steps` are put in the order of a person's questions:
// what is this PC and this program, can it draw, can it hear, can its helpers run, is anything in the way.
async function run(ctx) {
  const { app, electron, root, dir, mic = false, log = () => {} } = ctx;
  const pause = ctx.pause || wait; // (the tests do not wait)
  const { screen, globalShortcut, desktopCapturer, BrowserWindow } = electron;
  const results = [];
  const errors = ctx.errors || [];
  const add = async (name, fn, limit) => {
    log(`step ${name}`);
    const r = await step(name, fn, limit);
    results.push(r);
    log(`step ${name} ${r.ok ? 'ok' : `FAILED ${r.error}`} (${r.ms} ms)`);
    if (ctx.progress) ctx.progress({ done: false, ok: null, steps: results, errors: errors.slice(0, 80) }); // (what is found so far stays, if she is stopped)
    return r;
  };
  const overlay = () => {
    const w = ctx.overlay();
    if (!w || w.isDestroyed()) throw new Error('her window is gone');
    return w;
  };

  // her page must have loaded, and had a moment to draw
  await add('wait for her window', async () => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const w = ctx.overlay();
      if (w && !w.isDestroyed() && !w.webContents.isLoading()) break;
      await pause(200);
    }
    await pause(2500);
    return { loaded: !overlay().webContents.isLoading() };
  }, 30000);

  await add('program', async () => ({
    name: app.getName(), version: app.getVersion(), packaged: app.isPackaged,
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8,
    render: ctx.render || 'default', platform: process.platform, arch: process.arch, os: os.release(), osVersion: os.version?.() || '', osName: process.getSystemVersion?.() || '',
    locale: app.getLocale(), systemLocale: app.getSystemLocale?.() || '',
    exe: process.execPath, resources: process.resourcesPath, root, argv: process.argv.slice(1).filter((a) => !a.startsWith('--selftest')),
    ramTotal: os.totalmem(), ramFree: os.freemem(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model || '', uptimeHours: Math.round(os.uptime() / 360) / 10,
    session: process.env.SESSIONNAME || process.env.XDG_SESSION_TYPE || '',
  }));

  await add('graphics', async () => {
    const gpu = await app.getGPUInfo('basic').catch((e) => ({ error: String(e.message || e) }));
    return { features: app.getGPUFeatureStatus(), devices: gpu.gpuDevice || [], auxAttributes: gpu.auxAttributes || undefined, error: gpu.error };
  });

  await add('displays', async () => {
    const list = screen.getAllDisplays().map((d) => ({
      id: d.id, bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor, rotation: d.rotation, internal: d.internal, depth: d.colorDepth, touch: d.touchSupport,
    }));
    return { count: list.length, primary: screen.getPrimaryDisplay().id, list, cursor: screen.getCursorScreenPoint() };
  });

  await add('folders', async () => {
    const places = {};
    for (const name of ['home', 'appData', 'userData', 'temp', 'desktop', 'documents', 'downloads', 'logs']) {
      try {
        const p = app.getPath(name);
        places[name] = { path: p, exists: fs.existsSync(p), writable: ['userData', 'temp', 'downloads', 'documents'].includes(name) ? writable(p) : undefined };
      } catch (err) {
        places[name] = { error: String(err.message || err) };
      }
    }
    return places;
  });

  await add('settings', async () => {
    const config = ctx.config;
    config.save({ selftest: 'ok' });
    config.flush();
    const text = fs.readFileSync(config.file(), 'utf8');
    const back = JSON.parse(text);
    return { file: config.file(), written: back.selftest === 'ok', keys: Object.keys(config.load()).length };
  });

  await add('program files', async () => {
    const need = [...FILES, ...UNPACKED, 'package.json', 'src/main/voice/whisper.js', 'src/main/voice/piper.js'];
    const missing = need.filter((f) => !fs.existsSync(path.join(root, f)));
    const unpacked = UNPACKED.map((f) => {
      const real = path.join(root, f).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      return { file: f, readable: fs.existsSync(real), path: real };
    });
    const extra = {};
    if (app.isPackaged) {
      for (const f of ['chatterbox-server.py', path.join('voice-default', 'capri.wav'), path.join('voice-default', 'capri.json')]) extra[f] = fs.existsSync(path.join(process.resourcesPath, f));
    }
    return { checked: need.length, missing, unpacked, resources: extra, ok: !missing.length && unpacked.every((u) => u.readable) };
  });

  await add('this PC and her plan for it', async () => {
    const hw = await ctx.hardware.scan({ dir: app.getPath('userData') });
    const plan = ctx.profiles.plan(hw, {});
    return { hardware: hw, profile: plan.id, mind: plan.mind, voice: plan.voice, ears: plan.ears, disk: plan.disk, notes: plan.notes };
  }, 40000);

  if (process.platform === 'win32') {
    await add('PowerShell and her hands', async () => ({ probe: await ctx.control.probe() }), 40000);
  }

  await add('her helpers', async () => ({
    windowsSeen: ctx.windowsSeen(),
    tray: ctx.tray() ? { destroyed: ctx.tray().isDestroyed() } : null,
    shortcut: globalShortcut.isRegistered('Control+Alt+C'),
    windowWatchRunning: ctx.windowWatchRunning ? ctx.windowWatchRunning() : null,
  }));

  await add('her window', async () => {
    const w = overlay();
    return { bounds: w.getBounds(), visible: w.isVisible(), alwaysOnTop: w.isAlwaysOnTop(), focused: w.isFocused(), opacity: w.getOpacity() };
  });

  await add('her page', async () => overlay().webContents.executeJavaScript(probeScript({ mic }), true), 40000);

  await add('what she draws', async () => {
    const image = await overlay().webContents.capturePage();
    const size = image.getSize();
    if (dir) fs.writeFileSync(path.join(dir, 'overlay.png'), image.toPNG());
    const stats = nonBlank(image.toBitmap());
    return { size, ...stats, verdict: !stats.opaque ? 'nothing drawn' : stats.black / stats.opaque > 0.9 ? 'black' : 'drawn' };
  });

  await add('her sight (screen capture)', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((s) => {
      const stats = nonBlank(s.thumbnail.toBitmap(), { step: 2 });
      return { name: s.name, size: s.thumbnail.getSize(), empty: s.thumbnail.isEmpty(), black: stats.opaque ? Math.round((100 * stats.black) / stats.opaque) : null };
    });
  });

  await add('her main menu', async () => {
    ctx.hub().show();
    await pause(2500);
    const found = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /hub\.html/.test(w.webContents.getURL()));
    if (!found) throw new Error('the main menu did not open');
    const image = await found.webContents.capturePage();
    if (dir) fs.writeFileSync(path.join(dir, 'hub.png'), image.toPNG());
    const state = await found.webContents.executeJavaScript('({ title: document.title, text: document.body.innerText.length, buttons: document.querySelectorAll("button").length, cards: document.querySelectorAll("section, .card").length })', true).catch((e) => ({ error: String(e.message || e) }));
    return { bounds: found.getBounds(), visible: found.isVisible(), ...state, ...nonBlank(image.toBitmap()) };
  }, 30000);

  return {
    finished: new Date().toISOString(),
    done: true,
    ok: results.every((r) => r.ok),
    steps: results,
    errors: errors.slice(0, 80),
  };
}

// Hands the program's own events to the list the check ends with (a page that logged an error, a process that crashed).
function listen({ app }, errors) {
  // (the same message again is counted, not listed again)
  const note = (kind, text) => {
    const said = String(text).slice(0, 400);
    const same = errors.find((e) => e.kind === kind && e.text === said);
    if (same) same.times = (same.times || 1) + 1;
    else if (errors.length < 200) errors.push({ kind, text: said, at: new Date().toISOString() });
  };
  process.on('uncaughtException', (err) => note('uncaughtException', err?.stack || err));
  process.on('unhandledRejection', (err) => note('unhandledRejection', err?.stack || err));
  app.on('render-process-gone', (_e, contents, details) => note('render-process-gone', `${contents.getURL()} ${JSON.stringify(details)}`));
  app.on('child-process-gone', (_e, details) => note('child-process-gone', JSON.stringify(details)));
  app.on('web-contents-created', (_e, contents) => {
    contents.on('console-message', (event, level, message, line, source) => {
      // (newer Electron gives one details object, older ones separate arguments)
      const d = event && typeof event === 'object' && 'message' in event ? event : { level, message, lineNumber: line, sourceId: source };
      const lvl = typeof d.level === 'string' ? ({ error: 3, warning: 2 })[d.level] || 1 : d.level;
      if (lvl >= 2) note(lvl >= 3 ? 'console-error' : 'console-warning', `${d.message} (${path.basename(String(d.sourceId || ''))}:${d.lineNumber})`);
    });
    contents.on('did-fail-load', (_e, code, desc, url) => note('did-fail-load', `${code} ${desc} ${url}`));
  });
}

// Runs the check and writes electron.json; resolves the exit code (0: every look found something, 1: one failed).
async function execute(ctx) {
  const { dir } = ctx;
  const out = path.join(dir, 'electron.json');
  const save = (report) => fs.writeFileSync(out, JSON.stringify(report, null, 2));
  let report;
  try {
    report = await run({ ...ctx, progress: save });
  } catch (err) {
    report = { finished: new Date().toISOString(), done: true, ok: false, steps: [], errors: [...(ctx.errors || []), { kind: 'selftest', text: String(err?.stack || err) }] };
  }
  save(report);
  return report.ok ? 0 : 1;
}

module.exports = { dirFrom, renderFrom, isolate, nonBlank, step, run, execute, listen, probeScript, writable, FILES, UNPACKED, STEP_LIMIT, WHOLE_LIMIT };
