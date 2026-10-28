'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn: spawnProgram } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage,
  desktopCapturer, session,
  clipboard, ClipboardItem, dialog, powerMonitor,
} = require('electron');

const config = require('./config');
const { TRAY, LANGS } = require('./labels');
const { createBridge } = require('./bridge');
const { startWindowWatch } = require('./windows');
const { createMover } = require('./mover');
const llm = require('./llm');
const setup = require('./setup');
const apps = require('./apps');
const launch = require('./launch');
const tts = require('./tts');
const { Chatterbox } = require('./chatterbox');
const { Piper } = require('./piper');
const hardware = require('./hardware');
const { needsRaise } = require('./stacking');
const { OllamaHost } = require('./ollama-host');
const ollama = require('./ollama');
const tuner = require('./tune');
const { createSample } = require('./voice-sample');
const { Provision } = require('./provision');
const { createInstalled } = require('./installed');
const { Cleanup } = require('./cleanup');
const nodeCheck = require('./node-check');
const { createPrepare } = require('./prepare');
const { createHub } = require('./hub');
const stt = require('./stt');
const vision = require('./screen');
const control = require('./control');
const { startMediaWatch } = require('./media');
const { ASSISTANTS, assistant } = require('./assistants');
const activeAssistant = () => assistant(config.load().assistant); // Claude Code or Codex
const activeHooks = () => activeAssistant().hooks;
const demoSteps = require('../../scripts/demo-sequence');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.CAPRI_PORT) || 47823;
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;

const OLLAMA_SITE = 'https://ollama.com';
// her colours (renderer themes.js), in the order of her menu
const THEMES = ['classic', 'netrunner', 'toxic', 'violet', 'gold', 'sakura', 'ghost', 'mood'];
// which saved key each voice engine uses (OpenAI's is the same one as her chat's)
const TTS_KEYS = { openai: 'openai', elevenlabs: 'elevenlabs', custom: 'tts' };
// her voice (Chatterbox) and her mind (Ollama), models on this PC: she finds their folders next to her, starts
// them, keeps them, and gets them ready when something is missing (provision.js, shown by prepare.js)
const placesNextToHer = () => {
  // next to her first (her folder, the one she was started from), then the places a folder gets put
  const place = (name) => { try { return app.getPath(name); } catch { return ''; } };
  return [path.dirname(process.execPath), ROOT, path.resolve(ROOT, '..'), process.env.PORTABLE_EXECUTABLE_DIR, process.cwd(), place('desktop'), place('downloads'), place('documents'), place('home')]
    .filter(Boolean).filter((p, i, all) => all.indexOf(p) === i);
};
let overlay = null; // her window
// (a message to the overlay once its window is gone, while she is quitting, would throw)
const toOverlay = (channel, payload) => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload); };
// the recording she was given as her voice, if any (voice-sample.js): in her own data folder
const voiceSample = createSample({ dir: () => path.join(app.getPath('userData'), 'voices') });
const chatterbox = new Chatterbox({ roots: placesNextToHer, voices: () => [voiceSample.dir()] });
chatterbox.on('change', (status) => toOverlay('chatterbox:status', status));
const ollamaHost = new OllamaHost({ roots: placesNextToHer });
ollamaHost.on('change', (status) => toOverlay('ollama:status', status));
const piper = new Piper({
  roots: placesNextToHer,
  defaultDir: () => path.join(app.getPath('userData'), 'piper'),
  is64: hardware.systemIs64(),
});
piper.on('change', (status) => toOverlay('piper:status', status));
// A look at this PC (hardware.js). It is kept for two weeks (PowerShell takes a second or two, and this PC does
// not change), unless she is asked to look again; the free space of the disk is measured every time.
const LOOK_KEEPS = 14 * 24 * 3600 * 1000;
async function lookAtPc({ force = false } = {}) {
  const dir = app.getPath('userData');
  const fingerprint = `v1|${os.totalmem()}|${process.arch}|${os.release()}`; // (v: the shape of what is kept)
  const kept = config.load().hardwareCache;
  if (!force && kept && kept.key === fingerprint && Date.now() - kept.at < LOOK_KEEPS && kept.hw?.os) return { ...kept.hw, disk: hardware.diskOf(dir) };
  const hw = await hardware.scan({ dir });
  config.save({ hardwareCache: { at: Date.now(), key: fingerprint, hw: { ...hw, disk: undefined } } });
  return hw;
}
// what she put on this PC, written down as she does it, so that she can take exactly that off again (cleanup.js)
const installed = createInstalled({ file: () => path.join(app.getPath('userData'), 'installed.json') });
const provision = new Provision({
  record: (kind, value) => installed.record(kind, value),
  cfg: () => config.load(),
  save: (patch) => updateConfig(patch),
  lang: () => resolveLang(config.load().lang),
  ollamaHost,
  chatterbox,
  piper,
  ollamaApi: { models: () => ollama.models(), pull: (name, onProgress, signal) => ollama.pull(name, onProgress, signal) },
  installOllama: process.platform === 'win32' ? setup.installOllama : null,
  downloadOllama: process.platform === 'win32' ? setup.downloadOllama : null,
  downloadOllamaZip: process.platform === 'win32' ? (onLine, signal) => setup.downloadOllamaZip(path.join(app.getPath('userData'), 'ollama'), onLine, signal) : null,
  installPython: process.platform === 'win32' ? (onLine) => setup.installPython(onLine, placesNextToHer()) : null,
  roots: placesNextToHer,
  defaultDir: () => path.join(app.getPath('userData'), 'chatterbox'),
  nodeDir: () => path.join(app.getPath('userData'), 'node'),
  hardware: lookAtPc,
  // what the profile of this PC says about how she asks Ollama, and how Ollama is started
  tune: (tuning, profileId) => setProfileTuning(tuning, profileId),
  onModelsChanged: () => refreshModels(),
});
// Taking off what she put on this PC (cleanup.js), made once the app is ready
let cleanupTool = null;
const theCleanup = () => (cleanupTool ||= new Cleanup({
  userData: app.getPath('userData'),
  home: app.getPath('home'),
  cfg: () => config.load(),
  save: (patch) => updateConfig(patch),
  installed,
  ollamaApi: { list: () => ollama.list(), remove: (name) => ollama.remove(name) },
  ollamaHost,
  chatterbox,
  piper,
  nodeTools: nodeCheck,
  provision,
  onModelsChanged: () => refreshModels(),
}));
let prepare = null; // her preparation window (prepare.js), made once the app is ready
let hub = null; // her main menu (hub.js), the same
provision.on('change', (snapshot) => toOverlay('provision:status', snapshot));
provision.on('finish', async ({ ok, plan, attention, profile }) => {
  await refreshModels();
  rebuildTray();
  if (ok) tuneSoon(); // the set-up is done: how the model really does here is measured, once
  // a PC that cannot carry a local mind: the first time, she opens the tab where a cloud one is picked
  if (ok && plan.adopt && profile === 'cloud' && (config.load().provider || 'ollama') === 'ollama') sendCommand('ring', { tab: 'ai' });
  // she says so, the first time and after anything long: a line in her own voice is the proof it all works
  if (ok && (attention || plan.adopt)) sendCommand('testVoice');
});
const STT_KEYS = { groq: 'groq', openai: 'openai', custom: 'stt' };

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let tray = null;
let trayMenu = null; // also what she opens when you right-click her
let demoTimer = null;
let windowWatch = null;
let mover = null; // moves the window she has taken over (mover.js)
// the watcher only speaks when something changes: the overlay asks for this when it (re)loads
let lastWindows = null;
let chatModels = null; // the provider's models, as last seen (null: not reached)
let chatError = null;  // why not, when the provider said
let chatErrorCode = null; // 'nokey' or 'nourl': what her setup should ask for
const chats = new Map(); // id -> AbortController of an answer being streamed
let moodState = null;   // how she feels (the overlay says), for her menu's top line
let mediaWatch = null;  // what's playing (media.js), while she's allowed to know
let presenceTimer = null;
let senseState = {};    // which senses are live right now (the overlay says): { eyes, ears, listening }
let pttKey = null;      // the push-to-talk shortcut currently registered
let restLevel = 'awake'; // how deeply she rests (rest()): 'awake', 'sleep' or 'deep'

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

// Her memory of your chats, across restarts: { history: [{ role, content }], claude: Claude Code's session }
const memoryFile = () => path.join(app.getPath('userData'), 'memory.json');
function readMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveMemory(patch) {
  try {
    fs.writeFileSync(memoryFile(), JSON.stringify({ ...readMemory(), ...patch }));
  } catch (err) {
    console.error('[capri] could not save her memory:', err.message);
  }
}
// What she's learned about you (bond.js): kept on this PC only, next to her memory.
const bondFile = () => path.join(app.getPath('userData'), 'bond.json');
function readBond() {
  try {
    return JSON.parse(fs.readFileSync(bondFile(), 'utf8'));
  } catch {
    return null;
  }
}
function saveBond(data) {
  try {
    const tmp = `${bondFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data)); // whole or not at all: a crash mid-write never leaves half a file
    fs.renameSync(tmp, bondFile());
  } catch (err) {
    console.error('[capri] could not save what she learned:', err.message);
  }
}

function forgetChats() {
  llm.resetClaude();
  saveMemory({ history: [], claude: null });
  sendCommand('forget');
}

// capri://app/...        -> files of this repo
// capri://usersounds/... -> the user's own sound overrides
function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

// Her window: the work area, or the whole screen while she rests on the taskbar (her legs hang
// over it), less its top row of pixels: a window on top covering the whole screen is a fullscreen
// app to Windows (animated wallpapers pause, notifications wait). `gap`: how much of her window is
// below the top of the taskbar (0, or its height).
function overlayArea() {
  const { workArea, bounds } = targetDisplay();
  const area = config.load().rest === 'taskbar' ? { ...bounds, y: bounds.y + 1, height: bounds.height - 1 } : workArea;
  return { area, gap: area.y + area.height - (workArea.y + workArea.height) };
}

function fitOverlay() {
  if (!overlay) return;
  const { area, gap } = overlayArea();
  overlay.setBounds(area);
  overlay.webContents.send('overlay:resize', { width: area.width, height: area.height, gap });
}

// The pointer reaches her click-through window through a mouse hook, and Windows drops a hook that
// doesn't answer in time without a word (waking from sleep, a locked screen, a stall): she can't be
// clicked anymore. Off then on puts in a new one; her place on top and her size are set again too.
function rearmOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(false);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  fitOverlay();
  sendCommand('rearmed'); // click-through again: she waits for the pointer to be on her
  console.log('[capri] mouse hook set up again');
}

// Back on top of everything, the taskbar included (it comes up over her when it's clicked, and when a window
// opens or is switched to: stacking.js). Twice: the taskbar can come up again a moment later, as its menus
// and previews open. `hard`: lowered and raised again, which puts her on top for certain.
let lastRaise = 0;
function raiseOverlay({ hard = false } = {}) {
  if (Date.now() - lastRaise < 60) return; // (the watcher looks every 40 ms: once is enough)
  lastRaise = Date.now();
  for (const wait of [0, 400]) {
    setTimeout(() => {
      if (!overlay || overlay.isDestroyed()) return;
      if (hard && wait === 0) overlay.setAlwaysOnTop(false);
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
    }, wait);
  }
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...overlayArea().area,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL('capri://app/src/renderer/index.html');
  // always shown: put away, she's still there as her biochip in the corner. Sized again first:
  // Windows keeps a new window inside the work area, and resting on the taskbar it covers it too.
  overlay.once('ready-to-show', () => {
    fitOverlay();
    overlay.showInactive();
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });
  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendCommand(name, payload = {}) {
  overlay?.webContents.send('capri:command', { name, ...payload });
}

// Ctrl+Alt+C: she folds herself away into her biochip in the corner, or comes back out of it.
function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function playDemo() {
  clearTimeout(demoTimer);
  const steps = demoSteps(resolveLang(config.load().lang)); // in her language
  let i = 0;
  const next = () => {
    if (i >= steps.length) return;
    const [delay, evt] = steps[i++];
    demoTimer = setTimeout(() => {
      overlay?.webContents.send('claude:event', evt);
      next();
    }, delay);
  };
  next();
}

// During the demo, a little fake terminal for her to sit on and take over (window tracking is
// Windows only, so only there). Opened without stealing focus; closing it drops her off it.
let demoWin = null;
const DEMO_TERMINAL = `<body style="margin:0;background:#14101c;color:#8f8aa3;font:13px/1.7 Consolas,monospace;padding:14px 18px">
<div style="color:#36ff7a">PS C:\\night-city-api&gt; npm test -- gigs</div>
<div>&nbsp;&nbsp;GET /gigs</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ returns 20 items per page</div>
<div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ paginates with a cursor</div><div style="color:#36ff7a">&nbsp;&nbsp;&nbsp;&nbsp;✓ rejects a bad cursor</div>
<div>&nbsp;&nbsp;6 passing (212ms)</div><div style="color:#36ff7a">PS C:\\night-city-api&gt; _</div></body>`;

function demoWindow(open) {
  demoWin?.destroy();
  demoWin = null;
  if (!open || process.platform !== 'win32') return false;
  const b = overlay.getBounds();
  demoWin = new BrowserWindow({
    x: Math.round(b.x + b.width * 0.5 - 310), y: Math.round(b.y + b.height * 0.42), width: 620, height: 300,
    show: false, alwaysOnTop: true, title: 'night-city-api — npm test', backgroundColor: '#14101c', autoHideMenuBar: true,
  });
  demoWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEMO_TERMINAL)}`);
  demoWin.once('ready-to-show', () => demoWin?.showInactive());
  demoWin.on('closed', () => { demoWin = null; });
  return true;
}

// 'auto' -> the first system language Capri speaks, English otherwise.
function resolveLang(setting) {
  if (LANGS.includes(setting)) return setting;
  const preferred = [...app.getPreferredSystemLanguages(), app.getSystemLocale(), app.getLocale()];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// What the overlay gets: `lang` is the resolved one, `langSetting` what the user picked.
function rendererConfig() {
  const { apiKeys, ...cfg } = config.load(); // the keys stay here: the overlay only learns which ones are set
  return { ...cfg, keys: Object.keys(apiKeys || {}), assistant: activeAssistant().id, lang: resolveLang(cfg.lang), langSetting: LANGS.includes(cfg.lang) ? cfg.lang : 'auto', floorGap: overlayArea().gap };
}

// A setting changed (her menus, her ring, her setup). Only what really changed is acted on: the same
// value again costs nothing (no file, no message to the overlay, no menu to build).
function updateConfig(patch) {
  const changed = config.save(patch);
  if (!changed.length) return rendererConfig();
  const did = (...keys) => keys.some((k) => changed.includes(k));
  if (did('rest')) {
    fitOverlay(); // the taskbar in her window or not
    if (config.load().rest === 'taskbar') raiseOverlay(); // and her legs over it
  }
  if (did('musicAware')) watchMedia();
  if (did('ears', 'pushToTalk')) registerPushToTalk();
  if (did('ttsEngine', 'chatterboxDir', 'chatterboxUrl', 'chatterboxAuto', 'chatterboxDevice', 'hfEndpoint')) chatterbox.sync(config.load()).catch(() => {});
  if (did('chatModel', 'provider')) { applyTuning(); tuneSoon(); } // (another model: another measurement)
  if (did('ollamaDir')) ollamaHost.stop(false);
  if (did('piperDir')) piper.stop(false);
  // picking Ollama, Chatterbox or Piper (here, in her menu or in her ring), or a language that needs another Piper voice,
  // gets what they need ready, by herself
  const voice = config.load().ttsEngine;
  if (config.load().autoSetup !== false && ((did('provider') && config.load().provider === 'ollama') || (did('ttsEngine') && ['chatterbox', 'piper'].includes(voice)) || (did('lang') && voice === 'piper'))) provision.run();
  const cfg = rendererConfig();
  overlay?.webContents.send('capri:config', cfg);
  rebuildTray();
  return cfg;
}

// Who answers her chat, with its key or address if it needs one: saved, tried, and undone if it fails (the
// wizard in her overlay and her main menu both connect a service this way).
async function useProvider({ provider, key, url } = {}) {
  if (!llm.PROVIDERS[provider]) return { ok: false, error: 'unknown provider' };
  const before = config.load();
  const patch = { provider };
  if (provider === 'ollama') patch.autoMind = true; // (choosing it again here: it is looked after at start-up again)
  if (key) patch.apiKeys = { ...before.apiKeys, [provider]: setup.sealKey(String(key).trim()) };
  if (url) patch.customUrl = String(url).trim();
  updateConfig(patch);
  const models = await refreshModels();
  if (models?.length) return { ok: true, model: pickModel() };
  const error = models ? 'no model' : chatError || 'offline';
  updateConfig({ provider: before.provider, apiKeys: before.apiKeys, customUrl: before.customUrl });
  await refreshModels();
  return { ok: false, error };
}

// A voice service's key (or address, or voice) pasted in her panel or her main menu: the key kept encrypted.
function ttsSetup({ engine, key, url, voice } = {}) {
  const before = config.load();
  const patch = {};
  if (engine && tts.ENGINES[engine]) patch.ttsEngine = engine;
  const slot = TTS_KEYS[patch.ttsEngine || before.ttsEngine];
  if (key && slot) patch.apiKeys = { ...before.apiKeys, [slot]: setup.sealKey(String(key).trim()) };
  if (typeof url === 'string' && url.trim()) patch.ttsUrl = url.trim();
  if (typeof voice === 'string' && voice.trim()) patch.ttsVoice = voice.trim().slice(0, 80);
  return updateConfig(patch);
}

// The tray menu is rebuilt from scratch (a hundred items), so asks for it are gathered: a slider
// dragged in her ring is dozens of changes a second, the menu follows once, a moment after.
let trayTimer = 0;
function rebuildTray() {
  if (!tray || trayTimer) return;
  trayTimer = setTimeout(() => {
    trayTimer = 0;
    buildTray();
  }, 120);
}

// Whether her hooks are in (a read of the assistant's settings file): looked at again after a few
// seconds, or right away after she installed or removed them herself.
let hookCache = { at: 0, id: '', value: null };
function hooksNow(fresh = false) {
  const id = activeAssistant().id;
  if (fresh || hookCache.id !== id || Date.now() - hookCache.at > 5000) hookCache = { at: Date.now(), id, value: activeHooks().status() };
  return hookCache.value;
}

function buildTray() {
  if (!tray) return;
  const cfg = config.load();
  const hookState = hooksNow();
  const watched = activeAssistant();
  const t = Object.fromEntries(Object.entries(TRAY[resolveLang(cfg.lang)]).map(([key, value]) =>
    [key, typeof value === 'string' && watched.id !== 'claude' ? value.replaceAll('Claude Code', watched.name) : value]));

  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;

  const menu = Menu.buildFromTemplate([
    { label: t.online(PORT), enabled: false },
    ...(moodState && cfg.emotions !== false ? [{ label: t.mood(t.moods[moodState.mood] || moodState.mood), enabled: false }] : []),
    { type: 'separator' },
    { label: t.teleport, click: () => sendCommand('teleport') },
    { label: t.satellite, click: () => sendCommand('satellite') },
    { label: t.demo, click: playDemo },
    { label: t.help, click: () => sendCommand('welcome') },
    { label: t.hub, click: () => hub?.show() },
    { label: t.prepare, click: () => { prepare?.show({ manual: true }); provision.run(); } },
    ...(cfg.claude ? [{ label: t.report, click: () => sendCommand('report') }] : []),
    { label: t.talk, click: () => sendCommand('chat') },
    { label: t.ring, click: () => sendCommand('ring') },
    { label: t.custom, click: () => sendCommand('customize') },
    { label: cfg.visible ? t.hide : t.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    { type: 'separator' },
    {
      label: t.size,
      submenu: [[t.small, 0.45], [t.medium, 0.6], [t.large, 0.8]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: t.colors,
      submenu: THEMES.map((theme) => ({
        label: t.themes[theme], type: 'radio', checked: (cfg.theme || 'classic') === theme, click: () => updateConfig({ theme }),
      })),
    },
    {
      label: t.voice,
      submenu: [
        ...[['off', t.voiceOff], ['chat', t.voiceChat], ['all', t.voiceAll]].map(([voiceMode, label]) => ({
          label, type: 'radio', checked: cfg.voiceMode === voiceMode, click: () => updateConfig({ voiceMode }),
        })),
        { type: 'separator' },
        {
          label: t.voiceEngine,
          submenu: Object.keys(tts.ENGINES).map((ttsEngine) => ({
            label: t.engines[ttsEngine], type: 'radio', checked: cfg.ttsEngine === ttsEngine,
            click: () => {
              updateConfig({ ttsEngine });
              const key = TTS_KEYS[ttsEngine];
              const missing = (key && !config.load().apiKeys?.[key] && !(ttsEngine === 'openai' && process.env.OPENAI_API_KEY))
                || (ttsEngine === 'custom' && !config.load().ttsUrl);
              if (missing) sendCommand('setupVoice');
            },
          })),
        },
        { label: t.voiceFx, type: 'checkbox', checked: cfg.ttsFx !== false, click: (item) => updateConfig({ ttsFx: item.checked }) },
        { label: t.voiceSetup, click: () => sendCommand('setupVoice') },
        { label: t.voiceTest, click: () => sendCommand('testVoice') },
      ],
    },
    {
      label: t.character,
      submenu: [
        { label: t.emotions, type: 'checkbox', checked: cfg.emotions !== false, click: (item) => updateConfig({ emotions: item.checked }) },
        { label: t.life, type: 'checkbox', checked: cfg.life !== false, click: (item) => updateConfig({ life: item.checked }) },
        { label: t.musicAware, type: 'checkbox', checked: cfg.musicAware !== false, enabled: process.platform === 'win32', click: (item) => updateConfig({ musicAware: item.checked }) },
        { label: t.dj, type: 'checkbox', checked: cfg.dj !== false, enabled: process.platform === 'win32' && cfg.musicAware !== false, click: (item) => updateConfig({ dj: item.checked }) },
        { type: 'separator' },
        // she gets to know you and adapts (bond.js); what she learned, and a button to wipe it
        { label: t.learn, type: 'checkbox', checked: cfg.learn !== false, click: (item) => updateConfig({ learn: item.checked }) },
        { label: t.bond, click: () => sendCommand('bond') },
      ],
    },
    // her senses: she can see your screen, move to your music, and listen to your voice. All off
    // until you turn them on here, and each one is a live use of your screen, sound or microphone.
    {
      label: t.senses,
      submenu: [
        { label: t.vision, type: 'checkbox', checked: cfg.vision === true, click: (item) => updateConfig({ vision: item.checked }) },
        { label: t.lookNow, enabled: cfg.vision === true, click: () => sendCommand('lookNow') },
        { type: 'separator' },
        { label: t.rhythm, type: 'checkbox', checked: cfg.rhythm === true, click: (item) => updateConfig({ rhythm: item.checked }) },
        { type: 'separator' },
        { label: t.ears, type: 'checkbox', checked: cfg.ears === true, click: (item) => updateConfig({ ears: item.checked }) },
        { label: t.converse, type: 'checkbox', checked: cfg.converse === true, enabled: cfg.ears === true, click: (item) => updateConfig({ converse: item.checked }) },
        { label: `${t.pushToTalk}: ${prettyKey(cfg.pushToTalk)}`, enabled: false },
        { type: 'separator' },
        { label: t.visionSetup, click: () => sendCommand('setupVision') },
        { label: t.earsSetup, click: () => sendCommand('setupEars') },
      ],
    },
    // her hands: she can arrange your windows and type messages for you, only when you ask and,
    // for anything she types, only after you say yes. Windows only.
    {
      label: t.hands,
      submenu: [
        { label: t.handsOn, type: 'checkbox', checked: cfg.hands === true, enabled: process.platform === 'win32', click: (item) => updateConfig({ hands: item.checked }) },
        { label: t.handsType, type: 'checkbox', checked: cfg.handsType !== false, enabled: process.platform === 'win32' && cfg.hands === true, click: (item) => updateConfig({ handsType: item.checked }) },
      ],
    },
    {
      label: t.sound,
      submenu: [
        { label: t.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: t.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: t.screen,
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); fitOverlay(); rebuildTray(); },
      })),
    },
    {
      label: t.chatModel,
      submenu: [
        { label: t.aiSetup, click: () => sendCommand('setupChat') },
        { type: 'separator' },
        ...Object.entries(llm.PROVIDERS).map(([provider, p]) => ({
          label: p.label, type: 'radio', checked: cfg.provider === provider, click: () => pickProvider(provider),
        })),
        { type: 'separator' },
        ...(chatModels?.length
          ? chatModels.map((name) => ({
            label: llm.modelLabel(cfg.provider, name), type: 'radio', checked: name === pickModel(cfg), click: () => updateConfig({ chatModel: name }),
          }))
          : [{ label: (chatError || t.noOllama).slice(0, 80), enabled: false }]),
        { type: 'separator' },
        ...(cfg.provider === 'claude' ? [
          { label: `Claude Code: ${cfg.claudeCwd || app.getPath('home')}`, click: pickClaudeFolder },
          {
            label: 'Claude Code permissions',
            submenu: llm.CLAUDE_MODES.map((mode) => ({
              label: mode, type: 'radio', checked: cfg.claudeMode === mode, click: () => updateConfig({ claudeMode: mode }),
            })),
          },
        ] : []),
        { label: t.forget, click: forgetChats },
        // the key (or the address) of the one picked, pasted in her panel
        { label: t.apiKey, click: () => sendCommand('setupKey') },
      ],
    },
    { label: t.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: t.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    { label: t.possessMove, type: 'checkbox', checked: cfg.possess && cfg.possessMove !== false, enabled: cfg.possess, click: (item) => updateConfig({ possessMove: item.checked }) },
    {
      label: t.rest,
      submenu: [['corner', t.restCorner], ['taskbar', t.restTaskbar]].map(([rest, label]) => ({
        label, type: 'radio', checked: cfg.rest === rest, click: () => updateConfig({ rest }),
      })),
    },
    // the coding assistant she watches (a new one: she says hello and offers to plug herself in), or none
    {
      label: t.watch,
      submenu: [
        ...Object.entries(ASSISTANTS).map(([id, { name }]) => ({
          label: name,
          type: 'radio',
          checked: cfg.claude && watched.id === id,
          click: () => {
            const other = watched.id !== id;
            updateConfig({ claude: true, assistant: id, ...(other && { linked: false, welcomed: false }) });
            if (other) sendCommand('assistantChanged');
          },
        })),
        { label: t.watchNone, type: 'radio', checked: !cfg.claude, click: () => updateConfig({ claude: false }) },
      ],
    },
    {
      label: t.motion,
      submenu: [['auto', t.motionAuto], ['full', t.motionFull], ['reduced', t.motionReduced]].map(([motion, label]) => ({
        label, type: 'radio', checked: cfg.motion === motion, click: () => updateConfig({ motion, motionAsked: true }),
      })),
    },
    {
      label: t.display,
      // only read when she starts: she restarts in the mode picked
      submenu: [['auto', t.displayAuto], ['gl', t.displayGl], ['software', t.displaySoftware]].map(([render, label]) => ({
        label, type: 'radio', checked: cfg.render === render,
        click: () => {
          if (cfg.render === render) return;
          config.save({ render });
          config.flush(); // (app.exit() doesn't wait for the file)
          app.relaunch();
          app.exit(0);
        },
      })),
    },
    {
      label: t.lang,
      submenu: [[t.auto, 'auto'], ...LANGS.map((lang) => [TRAY[lang].name, lang])].map(([label, lang]) => ({
        label, type: 'radio', checked: (LANGS.includes(cfg.lang) ? cfg.lang : 'auto') === lang, click: () => updateConfig({ lang }),
      })),
    },
    {
      label: t.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    // her hooks, while she watches Claude Code
    ...(cfg.claude ? [
      { type: 'separator' },
      hookState.installed
        ? { label: t.hooksOn, enabled: false }
        : { label: t.hooksOff, click: () => runHooks('install') },
      ...(hookState.installed ? [{ label: t.hooksRemove, click: () => runHooks('uninstall') }] : []),
    ] : []),
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  trayMenu = menu;
}

// Run from a clone (`npm start`), electron.exe alone would open the default Electron app at login:
// it needs the project folder as argument.
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

// From the tray, she says how it went; from her welcome panel (quiet), the panel does.
function runHooks(action, { quiet = false } = {}) {
  let outcome;
  try {
    const result = action === 'install' ? activeHooks().install() : activeHooks().uninstall();
    outcome = { action, ok: true, file: result.file };
  } catch (err) {
    outcome = { action, ok: false, error: err.message };
  }
  if (!quiet) sendCommand('hooks', outcome);
  hooksNow(true); // (she changed them: look again)
  rebuildTray();
  return outcome;
}

// The model she talks with: the one picked in her menu if it's still installed, else the first.
function pickModel(cfg = config.load()) {
  if (!chatModels?.length) return null;
  return chatModels.includes(cfg.chatModel) ? cfg.chatModel : chatModels[0];
}

// The recording that came with her (resources/voice-default, put there by whoever made the installer), taken as her voice
// once when she has none: a note in the config keeps it from coming back after you took it away.
function adoptBundledVoice() {
  if (config.load().voiceBundledTaken) return;
  for (const folder of [process.resourcesPath && path.join(process.resourcesPath, 'voice-default'), path.join(ROOT, 'assets', 'voice-default')]) {
    if (folder && voiceSample.useBundled(folder)) {
      updateConfig({ voiceBundledTaken: true });
      return;
    }
  }
}

// ---- her mind, fitted to this PC (tune.js) ----
// The profile of the PC gives the start (the memory of the talk, how long the model stays loaded); a short run after the
// set-up says how fast the model really is here and whether it sits on the card, and she asks accordingly. Both are kept
// in the config (mindTune), so the next start asks the same way from the first message.
let tuneJob = null; // the measurement under way
let tuneTimer = null;

function setProfileTuning(tuning, profileId) {
  const base = { numCtx: tuning.numCtx, maxCtx: tuning.maxCtx, keepAlive: tuning.keepAlive };
  const old = config.load().mindTune || {};
  // (a measurement made for another kind of PC says nothing about this one)
  updateConfig({ mindTune: { ...(old.profile === profileId ? old : {}), profile: profileId, base } });
  ollamaHost.setEnv(tuning.ollamaEnv);
  applyTuning();
}

function applyTuning() {
  const t = config.load().mindTune;
  if (!t?.base) return;
  ollama.tune(tuner.settle(t.base, tuner.stillGood(t, { model: pickModel(), profile: t.profile }) ? t : null));
}

// Measures the model she talks with (once per model and kind of PC; `force`: again, as asked in her menu).
// Returns the record, or null when it could not be done now (nothing to measure, a chat is going on, it failed).
async function tuneMind({ force = false } = {}) {
  const cfg = config.load();
  const t = cfg.mindTune;
  const model = pickModel(cfg);
  if (cfg.provider !== 'ollama' || !model || !t?.base || tuneJob) return null;
  if (!force && tuner.stillGood(t, { model, profile: t.profile })) return t;
  if (!force && t.failedAt && Date.now() - t.failedAt < 86400000) return null; // (it failed lately: not on every start)
  if (chats.size || !(await ollama.version())) return null;
  const job = { abort: new AbortController() };
  tuneJob = job;
  hub?.tuneChanged();
  try {
    const sample = await ollama.measure(model, AbortSignal.any([job.abort.signal, AbortSignal.timeout(120000)]));
    const verdict = tuner.judge(sample);
    // (her look at the PC may have changed the profile meanwhile: what was measured is then for another kind of PC)
    const now = config.load().mindTune;
    if (now?.profile === t.profile) {
      const keep = { profile: now.profile, base: now.base };
      updateConfig({ mindTune: verdict ? { ...keep, model, ...verdict, at: Date.now() } : { ...keep, failedAt: Date.now() } });
      applyTuning();
    }
  } catch {
    // stopped for a chat that began, or too slow to tell: tried again on another day
    if (!job.abort.signal.aborted) updateConfig({ mindTune: { ...config.load().mindTune, failedAt: Date.now() } });
  } finally {
    if (tuneJob === job) tuneJob = null;
    hub?.tuneChanged();
  }
  return config.load().mindTune;
}

// How her mind stands, for her main menu: the model, what was measured, the memory she asks with, and what she asks for in each task
function tuneStatus() {
  const cfg = config.load();
  const t = cfg.mindTune || {};
  const model = pickModel(cfg);
  const now = ollama.current();
  const measured = Boolean(model) && tuner.stillGood(t, { model, profile: t.profile });
  const asks = (task) => tuner.ask(task, { model: model || '', lang: resolveLang(cfg.lang), answerCap: now.answerCap }).options;
  return {
    provider: cfg.provider, model: model || '', running: Boolean(tuneJob), measured,
    tps: measured ? t.tps : null, speed: measured ? t.speed : '', onCard: measured ? t.onCard ?? null : null, at: measured ? t.at : 0,
    numCtx: now.numCtx, maxCtx: now.maxCtx, keepAlive: now.keepAlive, size: tuner.sizeClass(model),
    chat: asks('chat'), note: asks('note'),
  };
}

// a moment after something changed (the chat or her menus use the model first)
function tuneSoon(ms = 6000) {
  clearTimeout(tuneTimer);
  tuneTimer = setTimeout(() => tuneMind().catch(() => {}), ms);
  tuneTimer.unref?.();
}

// The models of whoever answers her, asked of them. `cached`: a list from the last minute is good
// enough (opening her chat asks every time; for a service on the internet, or Claude Code's version
// check, that's a round trip each). Anything that changes who answers, or their key, asks again.
let modelsSeen = { who: '', at: 0 };
async function refreshModels({ cached = false } = {}) {
  const cfg = config.load();
  const who = `${cfg.provider}|${cfg.customUrl}|${cfg.apiKeys?.[cfg.provider] || ''}`;
  if (cached && chatModels?.length && !llm.isLocal(cfg.provider, cfg) && modelsSeen.who === who && Date.now() - modelsSeen.at < 60000) {
    return chatModels;
  }
  chatError = null;
  chatErrorCode = null;
  chatModels = await llm.models(cfg.provider, llmConfig(cfg)).catch((err) => {
    chatError = err.message;
    chatErrorCode = err.code || null;
    return null;
  });
  modelsSeen = { who: chatModels ? who : '', at: Date.now() };
  applyTuning(); // (the measurement is for a model: which one is picked is known now)
  rebuildTray();
  return chatModels;
}

// Her answer from the model picked, or from the next one when that one can't: too busy twice in a row
// (Gemini's "high demand"), or not served anymore (an older model closed to new keys). The model
// that answered is kept for next time.
async function chatWithFallback(cfg, messages, send, signal, streamed) {
  let model = pickModel(cfg);
  const tried = new Set();
  let busy = 0;
  for (;;) {
    try {
      const text = await llm.chat(cfg.provider, llmConfig(cfg), { model, messages, task: 'chat', lang: resolveLang(cfg.lang) }, send, signal);
      if (model !== pickModel(cfg)) updateConfig({ chatModel: model });
      return text;
    } catch (err) {
      if (signal.aborted || streamed() || !['busy', 'gone'].includes(err.code)) throw err;
      if (err.code === 'busy' && busy++ === 0) {
        await new Promise((r) => setTimeout(r, 1500)); // usually gone a moment later
        continue;
      }
      tried.add(model);
      const next = chatModels?.find((m) => !tried.has(m));
      if (!next || tried.size >= 3) throw err;
      model = next;
      busy = 0;
    }
  }
}

async function pickProvider(provider) {
  updateConfig({ provider });
  await refreshModels();
  if (chatErrorCode) sendCommand('setupKey'); // it needs a key or an address: she asks for it
}

// What llm.js gets: the config with its keys opened (they're kept encrypted, setup.js)
function llmConfig(cfg = config.load()) {
  return { ...cfg, apiKeys: setup.openKeys(cfg.apiKeys) };
}

async function pickClaudeFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: config.load().claudeCwd || app.getPath('home') });
  if (canceled || !filePaths[0]) return;
  llm.resetClaude(); // a new folder, a new Claude Code conversation (hers goes on)
  saveMemory({ claude: null });
  updateConfig({ claudeCwd: filePaths[0] });
}

// What's playing (media.js), while her menu lets her know it.
function watchMedia() {
  const on = config.load().musicAware !== false && restLevel !== 'deep';
  if (on && !mediaWatch) {
    mediaWatch = startMediaWatch({ onUpdate: (now) => overlay?.webContents.send('media:now', now) });
  } else if (!on && mediaWatch) {
    mediaWatch.stop();
    mediaWatch = null;
    overlay?.webContents.send('media:now', {});
  }
}

// An accelerator as a person reads it (Control+Alt+Space -> Ctrl+Alt+Space).
function prettyKey(key) {
  return String(key || 'Control+Alt+Space').replace(/\bControl\b/g, 'Ctrl').replace(/\bCommandOrControl\b/g, 'Ctrl');
}

// Her window out of the shot while she looks at your screen, so she isn't seeing her own reflection.
// Returns a function that brings her back. On a system that won't fade a transparent window cleanly
// it's a no-op, so she might see a faint copy of herself; harmless.
async function hideOverlayForShot() {
  if (!overlay || overlay.isDestroyed()) return () => {};
  try {
    overlay.setOpacity(0);
  } catch {
    return () => {};
  }
  await new Promise((r) => setTimeout(r, 120));
  return () => {
    try {
      overlay?.setOpacity(1);
    } catch {
      // comes back on the next draw regardless
    }
  };
}

// So she can hear the system's sound (rhythm.js) without a screen-share picker: when the overlay
// asks for display media, hand it a screen source with the audio set to loopback.
function allowLoopbackAudio() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

// Hold-to-talk (her menu, Senses): the shortcut tells the overlay to listen (ears.js).
function registerPushToTalk() {
  if (pttKey) {
    globalShortcut.unregister(pttKey);
    pttKey = null;
  }
  const cfg = config.load();
  if (!cfg.ears) return;
  const key = cfg.pushToTalk || 'Control+Alt+Space';
  try {
    if (globalShortcut.register(key, () => sendCommand('pushToTalk'))) pttKey = key;
  } catch (err) {
    console.error('[capri] could not set push-to-talk:', err.message);
  }
}

// How long since the keyboard or the mouse were last touched: she notices you're away, and back.
function watchPresence() {
  clearInterval(presenceTimer);
  presenceTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.webContents.send('presence', { idle: powerMonitor.getSystemIdleTime() });
  }, restLevel === 'deep' ? 15000 : 5000);
}

// Where the other windows are (windows.js), so she can sit on them. Restartable: it stops while
// she rests deeply (rest()).
function watchWindows() {
  if (windowWatch) return;
  windowWatch = startWindowWatch({
    overlay,
    onUpdate: (data) => {
      // the taskbar comes up over her (a click on it, a window opened, a program switched to): sitting on it,
      // her legs would vanish behind it
      const raise = needsRaise(data, lastWindows, config.load().rest);
      if (raise) raiseOverlay({ hard: raise === 'hard' });
      lastWindows = data;
      overlay?.webContents.send('windows:update', data);
    },
  });
}

// How deeply she rests (the overlay says, rest:level): 'awake', 'sleep' (dozing, still drawn), or
// 'deep' (down to her mask, or put away in her chip). Resting deeply, the helpers that watch your
// windows and your music stop altogether (two PowerShell processes polling, gone), and she checks
// whether you're there less often. Anything that wakes her (a click, Claude, her menu, the
// shortcut) brings them back a moment later.
function rest(level) {
  if (!['awake', 'sleep', 'deep'].includes(level) || level === restLevel) return;
  const was = restLevel;
  restLevel = level;
  if (DEV) console.log(`[capri] rest: ${was} -> ${level}`);
  if (level === 'deep') {
    windowWatch?.stop();
    windowWatch = null;
    lastWindows = null;
    mediaWatch?.stop();
    mediaWatch = null;
  } else if (was === 'deep') {
    watchWindows();
    watchMedia();
  }
  watchPresence();
}

// The tooltip of her icon by the clock: her name, and which senses are live right now.
function trayTip() {
  const live = [senseState.eyes && '◉ screen', senseState.ears && (senseState.listening ? '● mic (open)' : '● mic')].filter(Boolean);
  return live.length ? `Capri · ${live.join(' · ')}` : 'Capri';
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip(trayTip());
  tray.on('click', () => sendCommand('status'));
  buildTray();
}

function registerIpc() {
  ipcMain.on('overlay:interactive', (_e, on) => {
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('overlay:rearm', () => rearmOverlay()); // the pointer moved over her and she never heard of it
  ipcMain.handle('overlay:cursor', () => {
    const p = screen.getCursorScreenPoint();
    const b = overlay.getBounds();
    return { x: p.x - b.x, y: p.y - b.y, inside: p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height };
  });
  ipcMain.handle('config:get', () => rendererConfig());
  ipcMain.handle('hooks:status', () => activeHooks().status());
  ipcMain.handle('config:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return rendererConfig();
    const { apiKeys: _keys, ...safe } = patch; // (her keys only go in through setup:use and the voice and ears setups, sealed)
    return updateConfig(safe);
  });
  ipcMain.handle('demo:window', (_e, open) => demoWindow(open));
  // right-clicking her: the same menu as the tray icon (which Windows often hides behind the ^ by the clock)
  ipcMain.on('menu:open', () => trayMenu?.popup({ window: overlay }));
  // her welcome panel's buttons
  ipcMain.handle('hooks:install', () => runHooks('install', { quiet: true }));
  ipcMain.handle('claude:found', () => fs.existsSync(path.dirname(hooksNow().file))); // Claude Code keeps its settings there
  ipcMain.on('claude:help', () => shell.openExternal(activeAssistant().help));
  ipcMain.handle('windows:get', () => lastWindows);
  // the window she has taken over (possession.js): hold it, move it, let go; it goes back where it was
  ipcMain.handle('window:grab', (_e, id) => (Number.isSafeInteger(id) && mover ? mover.grab(id) : { ok: false, why: 'unknown' }));
  ipcMain.on('window:move', (_e, m) => { if (mover && Number.isSafeInteger(m?.id)) mover.move(m.id, Number(m.x), Number(m.y)); });
  ipcMain.on('window:release', (_e, m) => { if (mover && Number.isSafeInteger(m?.id)) mover.release(m.id, { restore: m.restore !== false }); });
  // talking to her (chat.js): is Ollama there, with a model to talk with
  ipcMain.handle('chat:status', async () => {
    const cfg = config.load(true); // keys may have been edited by hand
    const { provider } = cfg;
    // her mind is being got ready (the preparation window): not "Ollama is missing"
    if (provision.running && provider === 'ollama' && provision.step('ollama-model').state !== 'done') return { ok: false, error: 'preparing', code: 'preparing', provider };
    const models = await refreshModels({ cached: true });
    if (!models) return { ok: false, error: chatError || 'offline', code: chatErrorCode, provider };
    if (!models.length) return { ok: false, error: 'nomodel', provider };
    llm.warm(provider, pickModel()); // loading while you type your first message
    return { ok: true, provider, model: pickModel(), agent: provider === 'claude', local: llm.isLocal(provider, cfg), warmup: provider === 'ollama' };
  });
  // Can her chat answer? 'ready', 'none' (nothing to answer with: she says so, with a button to her main menu),
  // or 'busy' (it is being got ready, or her main menu is open: not the time to nag). The look chat:status takes,
  // but without loading the model, so it can be asked now and then.
  ipcMain.handle('chat:ready', async () => {
    const cfg = config.load(true);
    if (hub?.isOpen() || (provision.running && cfg.provider === 'ollama' && provision.step('ollama-model').state !== 'done')) return 'busy';
    const models = await refreshModels({ cached: true });
    return models?.length ? 'ready' : 'none';
  });
  // her answer, streamed to the overlay piece by piece as `chat:delta`
  ipcMain.handle('chat:send', async (_e, { id, messages }) => {
    const abort = new AbortController();
    chats.set(id, abort);
    tuneJob?.abort.abort(); // (the measurement waits: your message is first)
    // the pieces of her answer go over in groups of a frame or two, not one message per token
    let streamed = false;
    let queued = '';
    let timer = 0;
    const drain = () => {
      clearTimeout(timer);
      timer = 0;
      if (queued) overlay?.webContents.send('chat:delta', { id, text: queued });
      queued = '';
    };
    const send = (text) => {
      streamed = true;
      queued += text;
      timer ||= setTimeout(drain, 33);
    };
    try {
      const cfg = config.load();
      const text = await chatWithFallback(cfg, messages, send, abort.signal, () => streamed);
      drain();
      if (cfg.provider === 'claude') saveMemory({ claude: llm.claudeMemory() });
      return { ok: true, text };
    } catch (err) {
      drain();
      // the key was refused (or taken away): the list of models is asked for again next time
      if (['badkey', 'nokey'].includes(err.code)) modelsSeen = { who: '', at: 0 };
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message, code: err.code || null };
    } finally {
      clearTimeout(timer);
      chats.delete(id);
    }
  });
  ipcMain.on('chat:stop', (_e, id) => chats.get(id)?.abort());
  // her ring menu › AI: the models of whoever answers her now (as last seen), with their names
  ipcMain.handle('chat:models', () => {
    const cfg = config.load();
    return {
      provider: cfg.provider,
      current: pickModel(cfg),
      error: chatError,
      code: chatErrorCode,
      models: (chatModels || []).map((id) => ({ id, label: llm.modelLabel(cfg.provider, id) })),
    };
  });
  ipcMain.handle('chat:memory', () => readMemory().history || []);
  // her bond with you (bond.js): load, save, and a line in her notebook from your last chats, written
  // by your chat model in one quiet go (never Claude Code: it would be working in your project)
  ipcMain.handle('bond:load', () => readBond());
  ipcMain.on('bond:save', (_e, data) => data && typeof data === 'object' && saveBond(data));
  ipcMain.handle('bond:reflect', async (_e, { messages } = {}) => {
    const cfg = config.load();
    if (cfg.provider === 'claude') return { ok: false, code: 'agent' };
    if (!Array.isArray(messages) || !messages.length) return { ok: false, code: 'empty' };
    try {
      const text = await llm.chat(cfg.provider, llmConfig(cfg), { model: pickModel(cfg), messages, task: 'note', lang: resolveLang(cfg.lang) }, () => {}, AbortSignal.timeout(90000));
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });
  ipcMain.on('chat:remember', (_e, history) => Array.isArray(history) && saveMemory({ history }));
  ipcMain.on('chat:ollama', () => shell.openExternal(OLLAMA_SITE));
  // setting her up with buttons (setup.js): Ollama and a model, or a key, or an address
  const progress = (payload) => overlay?.webContents.send('setup:progress', payload);
  let pulling = null; // AbortController of the model being fetched
  ipcMain.handle('setup:info', () => ({ models: setup.MODELS, ram: os.totalmem(), keyed: Object.keys(setup.KEY_PAGES) }));
  ipcMain.handle('setup:ollama', () => setup.ollamaState());
  ipcMain.handle('setup:install', () => setup.installOllama((line) => progress({ kind: 'install', line })));
  ipcMain.handle('setup:start', async () => {
    const res = await setup.startOllama();
    await refreshModels();
    return res;
  });
  ipcMain.handle('setup:pull', async (_e, name) => {
    if (!setup.MODELS.some((m) => m.name === name)) return { ok: false, error: 'unknown model' };
    pulling?.abort();
    const abort = new AbortController();
    pulling = abort;
    try {
      await setup.pullModel(name, (p) => progress({ kind: 'pull', ...p }), abort.signal);
      updateConfig({ provider: 'ollama', autoMind: true });
      await refreshModels();
      const model = chatModels?.find((m) => m === name || m.startsWith(`${name}:`));
      if (model) updateConfig({ chatModel: model });
      return { ok: true, model };
    } catch (err) {
      return { ok: false, error: abort.signal.aborted ? 'stopped' : err.message };
    } finally {
      if (pulling === abort) pulling = null;
    }
  });
  ipcMain.on('setup:cancel', () => pulling?.abort());
  // who answers her chat, with its key or address if it needs one: saved, tried, and undone if it fails
  ipcMain.handle('setup:use', (_e, payload) => useProvider(payload));
  ipcMain.on('setup:keyPage', (_e, provider) => setup.KEY_PAGES[provider] && shell.openExternal(setup.KEY_PAGES[provider]));
  ipcMain.handle('setup:launch', (_e, integration) => setup.launchThroughOllama(integration));
  // closing an app you asked her to close, once you've clicked to confirm (apps.js)
  const appInfo = (app) => app && { name: app.process, label: app.label };
  ipcMain.handle('apps:list', async () => (await apps.list().catch(() => [])).map(appInfo));
  ipcMain.handle('apps:find', async (_e, wanted) => appInfo(await apps.find(wanted).catch(() => null)));
  ipcMain.handle('apps:close', (_e, { name, force }) => apps.close(name, { force }).catch((err) => ({ error: err.message })));
  // opening things you ask her to (launch.js): an app or a game, your music, a website
  ipcMain.handle('apps:findLaunch', (_e, text) => launch.find(String(text || '')).catch(() => null));
  ipcMain.handle('apps:launch', (_e, item) => launch.launch(item).then(() => ({ ok: true }), (err) => ({ ok: false, error: err.message })));
  ipcMain.handle('apps:media', (_e, action) => launch.media(action));
  ipcMain.handle('apps:music', (_e, query) => launch.music(query).catch(() => false));
  ipcMain.handle('apps:site', (_e, address) => launch.site(address).catch(() => false));
  // typing to her: the overlay takes the keyboard while the chat is open, and gives it back after
  ipcMain.on('overlay:focus', (_e, on) => {
    if (!overlay) return;
    overlay.setFocusable(Boolean(on));
    if (on) overlay.focus();
    else overlay.blur();
  });
  // her report card's copy button: a picture of that part of the overlay, on the clipboard
  ipcMain.handle('panel:copy', async (_e, rect) => {
    const image = await overlay.webContents.capturePage(rect);
    if (image.isEmpty()) return false;
    const png = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  });
  // her guide: where her tray icon is (it lives in the taskbar, off the overlay, hence overlay
  // coordinates past its edge), and the corner by the clock in case Windows hid it behind the ^
  ipcMain.handle('guide:tray', () => {
    const o = overlay.getBounds();
    const d = targetDisplay().bounds;
    const b = tray?.getBounds();
    const icon = b && b.width > 0 ? { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height } : null;
    const corner = { x: d.x + d.width - 150 - o.x, y: d.y + d.height - 44 - o.y, w: 140, h: 40 };
    return { icon, corner };
  });
  // her guide: Claude Code's folder (~/.claude) in Explorer, its settings file selected
  ipcMain.handle('guide:claudeFolder', () => {
    const file = activeHooks().status().file;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) return { found: false, dir };
    if (fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(dir);
    return { found: true, dir, file: fs.existsSync(file), label: fs.existsSync(file) ? path.basename(file) : path.basename(dir) };
  });
  // her voice through a speech service (tts.js): the audio of what she says, back to the overlay
  ipcMain.handle('tts:speak', async (_e, { text, mood, lang }) => {
    const cfg = config.load();
    try {
      const base = cfg.ttsEngine === 'chatterbox' ? await chatterbox.ready(cfg) : '';
      const sample = voiceSample.current();
      const audio = await tts.speak(cfg, setup.openKeys(cfg.apiKeys), { text, mood, lang, base, piper, sample, sampleLang: sample ? voiceSample.lang() : '' });
      return { ok: true, audio };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });
  // her voice's key, address or voice, pasted in her panel (the key kept encrypted like her chat's)
  ipcMain.handle('tts:setup', (_e, payload) => ttsSetup(payload));
  ipcMain.on('tts:keyPage', (_e, engine) => tts.KEY_PAGES[engine] && shell.openExternal(tts.KEY_PAGES[engine]));
  // Chatterbox: how it is doing, which folder it is, and starting it again
  ipcMain.handle('chatterbox:status', () => chatterbox.status());
  ipcMain.handle('piper:status', () => piper.status());
  // the Piper voices she has on this PC (her Voice tab picks between them)
  ipcMain.handle('piper:voices', () => {
    const cfg = config.load();
    const lang = resolveLang(cfg.lang);
    return { voices: piper.voices(cfg).map((v) => v.key).filter((key) => key.toLowerCase().startsWith(`${lang}_`)).sort(), current: piper.voiceFor(cfg, lang)?.key || '' };
  });
  ipcMain.handle('ollama:status', async () => ({ ...ollamaHost.status(), model: pickModel(), models: chatModels || [] }));
  ipcMain.handle('provision:status', () => provision.snapshot());
  ipcMain.handle('chatterbox:choose', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Chatterbox', properties: ['openDirectory'], defaultPath: config.load().chatterboxDir || path.dirname(process.execPath) });
    if (canceled || !filePaths[0]) return null;
    updateConfig({ chatterboxDir: filePaths[0], ttsEngine: 'chatterbox' });
    return filePaths[0];
  });
  // the recording she was given as her voice: how it stands, taking one (a file you pick), taking it away
  ipcMain.handle('voice:sample', () => voiceSample.status());
  ipcMain.handle('voice:sampleChoose', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Capri', properties: ['openFile'], defaultPath: app.getPath('music'),
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg'] }],
    });
    if (canceled || !filePaths[0]) return { ok: false, error: 'canceled', ...voiceSample.status() };
    const res = voiceSample.use(filePaths[0]);
    return res.ok ? res : { ...res, ...voiceSample.status() };
  });
  ipcMain.handle('voice:sampleRemove', () => voiceSample.remove());
  ipcMain.handle('chatterbox:restart', async () => {
    await chatterbox.restart(config.load());
    return chatterbox.status();
  });
  // ---- her senses and her hands ----
  // her eyes: a picture of your screen (screen.js), read by the vision model (llm.js)
  ipcMain.handle('eyes:see', async (_e, { prompt }) => {
    const cfg = config.load();
    if (!cfg.vision) return { ok: false, error: 'off', code: 'off' };
    try {
      const image = await vision.grab({ displayId: cfg.displayId, hideOverlay: hideOverlayForShot });
      if (!image) return { ok: false, error: 'no picture', code: 'nocapture' };
      const text = await llm.see(cfg.provider, llmConfig(cfg), { image, prompt });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });
  // her ears: your voice (ears.js) turned into text by the speech service (stt.js)
  ipcMain.handle('stt:transcribe', async (_e, { audio, mime, lang }) => {
    const cfg = config.load();
    try {
      const text = await stt.transcribe(cfg, setup.openKeys(cfg.apiKeys), { audio: Buffer.from(audio), mime, lang });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });
  ipcMain.on('stt:keyPage', (_e, engine) => stt.KEY_PAGES[engine] && shell.openExternal(stt.KEY_PAGES[engine]));
  // which speech-to-text service, and its key or address (the key kept encrypted, like her chat's)
  ipcMain.handle('stt:setup', (_e, { engine, key, url }) => {
    const before = config.load();
    const patch = {};
    if (engine && stt.ENGINES[engine]) patch.sttEngine = engine;
    const slot = STT_KEYS[patch.sttEngine || before.sttEngine];
    if (key && slot) patch.apiKeys = { ...before.apiKeys, [slot]: setup.sealKey(String(key).trim()) };
    if (typeof url === 'string' && url.trim()) patch.sttUrl = url.trim();
    return updateConfig(patch);
  });
  // her hands (control.js): all gated on the setting here too, so the overlay can't reach past it
  const handsOn = () => config.load().hands === true;
  ipcMain.handle('hands:window', (_e, { op, name }) => (handsOn() ? control.windowOp(op, name).then((n) => n, (err) => ({ error: { message: err.message, code: err.code } })) : { error: { code: 'off' } }));
  ipcMain.handle('hands:desktop', () => (handsOn() ? control.showDesktop().then(() => true, () => false) : false));
  ipcMain.handle('hands:type', (_e, { text, into }) => (handsOn() && config.load().handsType ? control.type(text, into).then(() => true, (err) => ({ error: { message: err.message, code: err.code } })) : { error: { code: 'off' } }));
  ipcMain.handle('hands:prepare', async (_e, request) => {
    if (!handsOn() || !config.load().handsType) throw Object.assign(new Error('off'), { code: 'off' });
    return control.prepareMessage(request);
  });
  ipcMain.handle('hands:send', (_e, prepared) => (handsOn() && config.load().handsType
    ? control.sendPrepared(prepared).then(() => true, (err) => ({ error: { message: err.message, code: err.code } }))
    : { error: { code: 'off', message: 'off' } })); // turned off between typing it and your yes: not sent
  // how deeply she rests: the helpers watching your windows and music stop while she's out
  ipcMain.on('rest:level', (_e, level) => rest(String(level)));
  // her senses' indicator by the clock (an eye, a mic, a note): only the tray line cares
  ipcMain.on('sense:state', (_e, state) => {
    senseState = state || {};
    tray?.setToolTip(trayTip()); // a sense is never silently on: the icon by the clock says so too
  });
  // how she feels, for her menu's top line (only when the mood itself changes)
  ipcMain.on('mood:state', (_e, state) => {
    const changed = state?.mood !== moodState?.mood;
    moodState = state && { mood: String(state.mood), level: Number(state.level) || 0 };
    if (changed) rebuildTray();
  });
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });
}

// Only in --dev: lets scripts drive the overlay and grab frames of it (no desktop content, just our window).
const testWins = new Map(); // name -> test window

async function debugHandler(route, body) {
  if (!DEV) throw new Error('debug routes need --dev');
  if (route === 'command') {
    sendCommand(body.name, body);
    return { ok: true };
  }
  if (route === 'reload') {
    overlay.webContents.reloadIgnoringCache();
    return { ok: true };
  }
  if (route === 'unhook') {
    // the pointer no longer passed on to her, as when Windows drops the mouse hook
    overlay.setIgnoreMouseEvents(true);
    return { ok: true };
  }
  if (route === 'testwin') {
    // plain windows to sit on, opened without stealing focus, by name (`id`, default "main");
    // each one opened goes in front of the others. { open: false } without an id closes them all.
    const id = body.id ?? 'main';
    if (!body.open && body.id === undefined) {
      for (const win of testWins.values()) win.destroy();
      testWins.clear();
      return { ok: true };
    }
    testWins.get(id)?.destroy();
    testWins.delete(id);
    if (body.open) {
      const b = overlay.getBounds();
      const win = new BrowserWindow({
        x: b.x + (body.x ?? 300), y: b.y + (body.y ?? 380), width: body.w ?? 720, height: body.h ?? 380,
        show: false, alwaysOnTop: true, title: `Capri test window ${id}`, backgroundColor: '#1b1726',
      });
      win.loadURL('data:text/html,<body style="background:%231b1726"></body>');
      win.showInactive();
      testWins.set(id, win);
    }
    return { ok: true };
  }
  if (route === 'movewin' && testWins.has(body.id ?? 'main')) {
    const win = testWins.get(body.id ?? 'main');
    const [x, y] = win.getPosition();
    win.setPosition(x + (body.dx || 0), y + (body.dy || 0));
    return { ok: true };
  }
  if (route === 'mouse') {
    // the pointer moving over the overlay (css px), and clicking if asked, without touching the real one
    const at = { x: Math.round(body.x), y: Math.round(body.y) };
    overlay.webContents.sendInputEvent({ type: 'mouseMove', ...at });
    if (body.click) {
      overlay.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at });
      overlay.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at });
    }
    return { ok: true };
  }
  if (route === 'type') {
    // typing into the overlay (her chat), and Enter if asked
    if (body.text) await overlay.webContents.insertText(body.text);
    if (body.enter) {
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
      overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    return { ok: true };
  }
  if (route === 'capture') {
    const image = await overlay.webContents.capturePage();
    // installed, the app's own folder is read-only: its data folder instead
    const dir = path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'captures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(body.name || 'frame').replace(/[^\w-]/g, '')}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  }
  throw new Error('unknown debug route');
}

// How her window is drawn, set before Electron starts (her menu › Display). On some PCs her see-through
// window shows up black (NVIDIA with FXAA, MFAA or HDR on, for one): drawing it through OpenGL, or
// without the graphics card, often fixes it.
function applyRender() {
  const { render } = config.load();
  if (render === 'gl') app.commandLine.appendSwitch('use-angle', 'gl');
  if (render === 'software') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // her drawing still needs WebGL, done on the CPU
  }
  // --dev: what Chromium ended up drawing with
  if (DEV) app.whenReady().then(() => setTimeout(() => console.log('[capri] display:', render, JSON.stringify(app.getGPUFeatureStatus())), 4000));
}

// Her own removal: all of what she put on this PC comes off, then (if she came from the installer) the installer's
// uninstaller is started for herself, her settings and her memory, and she quits. Resolves what the page says.
async function uninstallCapri() {
  const res = await theCleanup().removeAll();
  if (!res.ok) return { ok: false, error: res.error || '', failed: res.failed };
  const dir = path.dirname(process.execPath);
  const uninstaller = path.join(dir, `Uninstall ${app.name}.exe`);
  if (!app.isPackaged || process.platform !== 'win32' || !fs.existsSync(uninstaller)) return { ok: true, manual: true, dir: app.isPackaged ? dir : ROOT, freed: res.freed };
  // (the uninstaller waits for her to quit, then removes the program and, with this flag, her data folder too)
  const child = spawnProgram(uninstaller, ['/S', '--delete-app-data'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
  setTimeout(() => app.quit(), 600);
  return { ok: true, freed: res.freed };
}

// `Capri.exe --remove-everything`, started by the uninstaller when you say yes to "delete what she downloaded too":
// no window, she takes off all she put on this PC and quits.
function removeEverythingAndQuit() {
  app.whenReady().then(async () => {
    const cap = setTimeout(() => app.exit(0), 5 * 60 * 1000); // (never left hanging)
    try {
      await theCleanup().removeAll();
    } catch (err) {
      console.error('[capri] taking off what she installed:', err.message);
    }
    clearTimeout(cap);
    for (const stop of [() => ollamaHost.stop(false), () => chatterbox.stop(), () => piper.stop(), () => config.flush()]) {
      try { stop(); } catch { /* not running */ }
    }
    app.exit(0);
  });
}

function main() {
  if (process.argv.includes('--remove-everything')) {
    removeEverythingAndQuit();
    return;
  }
  applyRender();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => sendCommand('status'));
  if (process.platform === 'win32') app.setAppUserModelId('capri.desktop');

  app.whenReady().then(() => {
    if (!['codex', 'claude'].includes(config.load().assistant)) config.save({ assistant: activeAssistant().id });
    serveProtocol();
    registerIpc();
    createOverlay();
    createTray();
    watchWindows();
    mover = createMover({
      screen,
      bounds: () => overlay.getBounds(),
      windows: () => lastWindows,
      enabled: () => { const c = config.load(); return c.possess !== false && c.possessMove !== false; },
      onLost: (id, why) => overlay?.webContents.send('window:lost', { id, why }),
    });
    createBridge({
      port: PORT,
      // her own Claude Code chat's hooks would cover its answer with theirs
      onEvent: (evt) => !llm.isChatSession(evt.session_id) && overlay?.webContents.send('claude:event', evt),
      onDebug: DEV ? debugHandler : null,
    });
    globalShortcut.register('Control+Alt+C', () => toggleVisible());
    llm.restoreClaude(readMemory().claude);
    watchMedia();
    watchPresence();
    allowLoopbackAudio();
    registerPushToTalk();
    prepare = createPrepare({
      BrowserWindow, ipcMain, dialog, shell, clipboard, provision, config, updateConfig, ollamaHost, chatterbox, piper,
      openAiTab: () => sendCommand('ring', { tab: 'ai' }),
      isHubOpen: () => Boolean(hub?.isOpen()),
      lang: () => resolveLang(config.load().lang),
      protocolUrl: 'capri://app/src/renderer/prepare.html',
    });
    hub = createHub({
      BrowserWindow, ipcMain, shell, clipboard, provision, config, updateConfig,
      lang: () => resolveLang(config.load().lang),
      connect: useProvider,
      saveVoiceKey: ({ engine, key }) => {
        if (!['openai', 'elevenlabs'].includes(engine) || !key) return { ok: false, error: 'no key' };
        ttsSetup({ engine, key });
        return { ok: true };
      },
      keyPages: setup.KEY_PAGES,
      voiceKeyPages: tts.KEY_PAGES,
      cleanup: theCleanup(),
      uninstall: uninstallCapri,
      mind: { status: tuneStatus, measure: () => tuneMind({ force: true }) },
      protocolUrl: 'capri://app/src/renderer/hub.html',
      onClosed: () => rebuildTray(),
    });
    // The first time (nothing chosen yet), her main menu opens and nothing is fetched until you press its button.
    // After that, what she lives on is found, started, and made ready if something is missing (a window opens only
    // if that takes long).
    const firstTime = !config.load().hubDone && !config.load().provisioned;
    if (firstTime && config.load().autoSetup !== false && !process.argv.includes('--no-hub')) setTimeout(() => hub.show(), 1500);
    else if (config.load().autoSetup !== false) setTimeout(() => provision.run(), 1200);
    else {
      // (not getting things ready for you, but the ones that are in place are still started)
      chatterbox.sync(config.load()).catch(() => {});
      if ((config.load().provider || 'ollama') === 'ollama') ollamaHost.sync(config.load()).catch(() => {});
    }
    adoptBundledVoice();
    refreshModels(); // for her menu's model list
    setTimeout(() => launch.launchables().catch(() => {}), 20000); // what she can open, before you ask
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
    // after sleep or a locked screen, once Windows has settled
    powerMonitor.on('resume', () => setTimeout(rearmOverlay, 2000));
    powerMonitor.on('unlock-screen', () => setTimeout(rearmOverlay, 1000));
  });

  app.on('will-quit', () => {
    config.flush(); // the last changes, written now
    // what she started goes with her (each on its own: one failing must not leave the other running)
    for (const stop of [() => provision.cancel(), () => chatterbox.stop(), () => piper.stop(), () => ollamaHost.stop()]) {
      try { stop(); } catch (err) { console.error('[capri] stopping what she started:', err.message); }
    }
    clearTimeout(trayTimer);
    globalShortcut.unregisterAll();
    windowWatch?.stop();
    mover?.stop(); // a window she is holding goes back where it was
    mediaWatch?.stop();
    clearInterval(presenceTimer);
    try {
      session.defaultSession.setDisplayMediaRequestHandler(null);
    } catch {
      // nothing to clear
    }
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
