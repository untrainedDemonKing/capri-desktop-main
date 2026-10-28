'use strict';

// Her main menu: a window of its own that opens by itself the first time she runs (and from the clock's menu
// after). There you choose what she thinks with (Ollama on this PC with a model of your pick, or a service in the
// cloud: its key is asked for, tried, and kept only if it works), what she talks with (Piper, Chatterbox, the
// system's voice, or a service with a key), see what that costs to fetch against the free room on the disk, and
// press one button: she fetches, installs and starts it, with the steps and bars of the preparation (provision.js).
// Nothing is fetched before you press it. And the other way: what is on this PC because of her, with what it takes,
// one thing at a time or all of it, and her own removal (cleanup.js).

const path = require('node:path');
const { table } = require('./hub-lines');
const prepareLines = require('./prepare-lines');
const profiles = require('./profiles');
const { sameModel } = require('./provision');

const GB = 1024 ** 3;

// the services that can answer her: how they are told apart in the menu, and whether they take a key
const CLOUD = [
  { id: 'groq', tag: 'free', key: true },
  { id: 'gemini', tag: 'free', key: true },
  { id: 'openrouter', tag: 'free-some', key: true },
  { id: 'pollinations', tag: 'nokey', key: false },
  { id: 'anthropic', tag: 'best', key: true },
  { id: 'openai', tag: 'paid', key: true },
  { id: 'mistral', tag: 'paid', key: true },
  { id: 'deepseek', tag: 'paid', key: true },
  { id: 'custom', tag: 'own', key: false, url: true },
];
const VOICES = ['piper', 'chatterbox', 'system', 'openai', 'elevenlabs'];
const MINDS = ['ollama', 'cloud', 'skip'];

const SECTIONS = new Set(['manage']); // the places of the page a button elsewhere can open it at

function createHub({ BrowserWindow, ipcMain, shell, clipboard, provision, config, updateConfig, lang, connect, saveVoiceKey, keyPages, voiceKeyPages = {}, cleanup = null, uninstall = null, mind = null, protocolUrl, onClosed }) {
  let win = null;
  let applied = false; // the button was pressed in this window: closing it is not "skip"
  let last = null; // the last look at the PC, for the previews (a look takes a second or two)

  const ui = () => ({ ...prepareLines.table(lang()), ...table(lang()) });
  const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

  async function look({ rescan = false } = {}) {
    if (!last || rescan || Date.now() - last.at > 15000) last = { ...(await provision.preview({ rescan })), at: Date.now() };
    return last;
  }

  const cloudState = (cfg) => CLOUD.map((c) => ({
    ...c,
    connected: cfg.provider === c.id && (!c.key || Boolean(cfg.apiKeys?.[c.id])),
    keySaved: Boolean(cfg.apiKeys?.[c.id]),
    keyPage: Boolean(keyPages[c.id]),
  }));

  async function state({ rescan = false } = {}) {
    const cfg = config.load();
    const { hw, have, profile } = await look({ rescan });
    const voiceOnCard = profiles.chatterboxDevice(hw) !== 'cpu';
    const rec = profiles.recommend(hw, { voiceOnCard });
    return {
      lang: lang(),
      ui: ui(),
      first: !cfg.hubDone,
      pc: profiles.describe(hw),
      recommended: { id: profile.id, mind: profile.mind, voice: profile.voice },
      have,
      models: rec.rows.map((m) => ({ model: m.model, bytes: m.bytes, vision: m.vision, ru: m.ru, rank: m.rank, heavy: m.rank === 'heavy', have: Boolean(sameModel(have.models || [], m.model)) })),
      rec: { mind: { best: rec.best, alt: rec.alt, bestWhy: rec.bestWhy, altWhy: rec.altWhy }, voice: profiles.recommendVoice(hw) },
      cloud: cloudState(cfg),
      voiceKeys: { openai: Boolean(cfg.apiKeys?.openai), elevenlabs: Boolean(cfg.apiKeys?.elevenlabs) },
      node: { auto: cfg.autoNode !== false },
      tune: mind ? mind.status() : null,
      current: { provider: cfg.provider, chatModel: cfg.chatModel, ttsEngine: cfg.ttsEngine || 'system', customUrl: cfg.customUrl || '' },
      snapshot: provision.snapshot(),
    };
  }

  // What the picked set-up is made of, what of it is to be fetched, and whether the disk has room
  async function preview({ mind, model, voice, node } = {}) {
    const { hw, have } = await look();
    const device = profiles.chatterboxDevice(hw);
    const parts = profiles.components({ mind: MINDS.includes(mind) ? mind : 'skip', model: String(model || ''), voice: VOICES.includes(voice) ? voice : 'system', device, node: node === true, have });
    const free = Number.isFinite(hw.disk.free) ? hw.disk.free : Infinity;
    const notes = [];
    if (voice === 'chatterbox' && device === 'cpu') notes.push('slowVoice');
    if (free < parts.need) notes.push('diskShort');
    const info = profiles.CATALOG.find((m) => m.model === model);
    if (mind === 'ollama' && info && !profiles.runsWell(hw, info.bytes, { voiceOnCard: voice === 'chatterbox' && device !== 'cpu' })) notes.push('heavy');
    return { items: parts.items, total: parts.total, need: parts.need, free: Number.isFinite(free) ? free : 0, ok: free >= parts.need, notes, device };
  }

  // The config of the picked set-up. A model that is there already is taken as it is; one that is not is asked
  // of the preparation (wantModel). The voice she runs herself is set in the end by the preparation, when it works.
  function patchFor({ mind, model, voice, node }, cfg, installed) {
    const patch = { hubDone: true, autoSetup: true };
    if (typeof node === 'boolean') patch.autoNode = node;
    if (mind === 'ollama') {
      patch.provider = 'ollama';
      patch.autoMind = true;
      const there = model ? sameModel(installed, model) : null;
      if (there) Object.assign(patch, { chatModel: there, wantModel: '' });
      else if (model) patch.wantModel = model;
    }
    if (VOICES.includes(voice)) {
      patch.ttsEngine = voice;
      patch.provisioned = true;
      if (!cfg.voiceMode || cfg.voiceMode === 'off') patch.voiceMode = 'chat';
    }
    return patch;
  }

  async function apply(choice = {}) {
    if (cleanup?.busy) return { ok: false, error: 'removing' }; // (something is being taken off: not a moment to fetch)
    const cfg = config.load();
    const { have } = await look();
    if (provision.running) {
      provision.cancel();
      await provision.job?.catch(() => {});
    }
    const patch = patchFor(choice, cfg, have.models || []);
    applied = true;
    updateConfig(patch);
    last = null;
    provision.run();
    return { ok: true };
  }

  function skip() {
    if (!config.load().hubDone) updateConfig({ hubDone: true, autoSetup: false });
  }

  // `section`: a place on the page to go to ('manage': what is on this PC and taking it off)
  function show(section = '') {
    const at = SECTIONS.has(section) ? section : '';
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (at) win.webContents.send('hub:focus', at);
      return win;
    }
    applied = false;
    last = null;
    win = new BrowserWindow({
      width: 780, height: 900, minWidth: 560, minHeight: 560,
      show: false, title: 'Capri', backgroundColor: '#17121f', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, '..', 'hub-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.removeMenu?.();
    win.loadURL(at ? `${protocolUrl}#${at}` : protocolUrl);
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      win = null;
      if (!applied) skip(); // closed without pressing anything: nothing is fetched behind your back from now on
      onClosed?.();
    });
    return win;
  }

  provision.on('change', (snapshot) => send('hub:change', snapshot));
  // how her mind was fitted to this PC (tune.js), and fitting it again
  ipcMain.handle('hub:tune', () => (mind ? mind.status() : null));
  ipcMain.handle('hub:retune', async () => {
    await mind?.measure();
    return mind ? mind.status() : null;
  });

  ipcMain.on('hub:show', (_e, section) => show(typeof section === 'string' ? section : '')); // from the overlay: her "Connect" button, her menu's "More" tab
  ipcMain.handle('hub:state', (_e, opts) => state(opts));
  ipcMain.handle('hub:rescan', () => state({ rescan: true }));
  ipcMain.handle('hub:preview', (_e, choice) => preview(choice));
  ipcMain.handle('hub:connect', async (_e, payload = {}) => {
    const res = await connect({ provider: String(payload.provider || ''), key: payload.key ? String(payload.key) : '', url: payload.url ? String(payload.url) : '' });
    return { ...res, cloud: cloudState(config.load()) };
  });
  ipcMain.on('hub:keyPage', (_e, provider) => {
    const url = keyPages[provider] || voiceKeyPages[provider];
    if (url) shell.openExternal(url);
  });
  ipcMain.handle('hub:voiceKey', (_e, { engine, key } = {}) => saveVoiceKey({ engine, key: String(key || '').trim() }));
  ipcMain.handle('hub:apply', (_e, choice) => apply(choice));
  ipcMain.handle('hub:retry', () => {
    provision.run();
    return true;
  });
  ipcMain.handle('hub:stop', () => {
    provision.cancel();
    return true;
  });
  ipcMain.handle('hub:report', () => provision.report());
  // what is on this PC because of her, and taking it off (cleanup.js)
  const inventory = async () => (cleanup ? cleanup.inventory({ fresh: true }) : { items: [], ollamaUp: true, total: 0, count: 0 });
  ipcMain.handle('hub:inventory', () => inventory());
  ipcMain.handle('hub:remove', async (_e, id) => {
    if (!cleanup) return { ok: false, error: 'missing', inventory: await inventory() };
    const res = await cleanup.remove(String(id || ''));
    last = null; // (what is there has changed: the next look at the PC is a new one)
    return { ...res, inventory: await inventory() };
  });
  ipcMain.handle('hub:removeAll', async () => {
    if (!cleanup) return { ok: false, removed: [], failed: [], freed: 0, inventory: await inventory() };
    const res = await cleanup.removeAll();
    last = null;
    return { ...res, inventory: await inventory() };
  });
  // her own removal: all of what she put here, then herself (the installer's uninstaller, if she came from it)
  ipcMain.handle('hub:uninstall', async () => {
    if (!uninstall) return { ok: false, error: 'missing' };
    last = null;
    return uninstall();
  });
  ipcMain.on('hub:copy', (_e, text) => clipboard.writeText(String(text).slice(0, 20000)));
  ipcMain.on('hub:skip', () => {
    skip();
    if (win && !win.isDestroyed()) win.close();
  });
  ipcMain.on('hub:close', () => {
    if (win && !win.isDestroyed()) win.close();
  });

  return {
    show, isOpen: () => Boolean(win && !win.isDestroyed()), window: () => win, state, preview, apply, patchFor,
    // (the measurement began or ended)
    tuneChanged: () => { if (mind) send('hub:tune', mind.status()); },
  };
}

module.exports = { createHub, CLOUD, VOICES, MINDS, GB };
