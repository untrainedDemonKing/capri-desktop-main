'use strict';

// Her preparation window: a window of its own that shows what she is getting ready (provision.js), how far
// each step is and what failed, with the buttons that help. It opens by itself when something long starts (an
// install, a download) or fails, never for a normal start-up, and shuts by itself a few seconds after
// everything is done if it opened by itself. Also from her tray menu ("Setup").

const path = require('node:path');
const { table } = require('./prepare-lines');

const SITES = /^https:\/\/(www\.)?(ollama\.com|python\.org|nodejs\.org)(\/|$)/;
const AUTO_CLOSE = 6000;

function createPrepare({ BrowserWindow, ipcMain, dialog, shell, clipboard, provision, config, updateConfig, lang, ollamaHost, chatterbox, piper, openAiTab, isHubOpen, protocolUrl }) {
  let win = null;
  let userOpened = false; // opened from the menu: it stays until it is closed
  let dismissed = false; // closed on purpose during this run: not opened again by what happens next (a failure at the end is)
  let closeTimer = null;
  let closing = false; // closed by her own code (not by you: that is a "not now")

  const state = () => ({ snapshot: provision.snapshot(), ui: table(lang()), lang: lang(), never: config.load().prepareWindow === false });
  const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

  function show({ manual = false } = {}) {
    clearTimeout(closeTimer);
    if (manual) userOpened = true;
    dismissed = false;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      return win;
    }
    win = new BrowserWindow({
      width: 660, height: 760, minWidth: 520, minHeight: 480,
      show: false, title: 'Capri', backgroundColor: '#17121f', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, '..', 'prepare-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.removeMenu?.();
    win.loadURL(protocolUrl);
    win.once('ready-to-show', () => (manual ? win.show() : win.showInactive()));
    win.on('close', () => { if (!closing) dismissed = true; });
    win.on('closed', () => { win = null; closing = false; });
    return win;
  }

  function hide({ byUser = false } = {}) {
    clearTimeout(closeTimer);
    if (byUser) dismissed = true;
    closing = !byUser;
    if (win && !win.isDestroyed()) win.close();
    userOpened = false;
  }

  // what happens in the preparation shows on the window, and opens it when it matters
  provision.on('change', (snap) => {
    send('prepare:change', snap);
    if (snap.attention && !win && !dismissed && config.load().prepareWindow !== false && !isHubOpen?.()) show(); // (her main menu shows it itself)
  });
  provision.on('finish', ({ ok, attention }) => {
    send('prepare:change', provision.snapshot());
    if (!ok && attention && !win && config.load().prepareWindow !== false && !isHubOpen?.()) show();
    if (ok && win && !userOpened) {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => hide(), AUTO_CLOSE);
    }
    if (!ok) dismissed = false;
  });
  chatterbox.on('change', () => send('prepare:change', provision.snapshot()));
  ollamaHost.on('change', () => send('prepare:change', provision.snapshot()));
  piper?.on('change', () => send('prepare:change', provision.snapshot()));

  ipcMain.handle('prepare:state', () => state());
  ipcMain.handle('prepare:retry', async () => {
    dismissed = false;
    provision.run();
    return true;
  });
  ipcMain.handle('prepare:skip', () => {
    provision.cancel();
    return true;
  });
  ipcMain.handle('prepare:choose', async (_e, what) => {
    const key = { ollama: 'ollamaDir', chatterbox: 'chatterboxDir', piper: 'piperDir' }[what];
    if (!key) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
      title: { ollama: 'Ollama', chatterbox: 'Chatterbox', piper: 'Piper' }[what], properties: ['openDirectory'], defaultPath: config.load()[key] || path.dirname(process.execPath),
    });
    if (canceled || !filePaths[0]) return null;
    if (what === 'ollama') {
      ollamaHost.stop(false);
      updateConfig({ ollamaDir: filePaths[0] });
    } else if (what === 'piper') {
      piper?.stop(false);
      updateConfig({ piperDir: filePaths[0], ttsEngine: 'piper' });
    } else {
      updateConfig({ chatterboxDir: filePaths[0], ttsEngine: 'chatterbox' });
      chatterbox.stop(false);
    }
    dismissed = false;
    provision.run();
    return filePaths[0];
  });
  // the profile you pick for this PC (or "auto"): her mind's model and her voice are chosen again by it. A voice
  // of a service (OpenAI, ElevenLabs...) is left as it is: only the ones she runs herself are chosen anew.
  ipcMain.handle('prepare:profile', async (_e, id) => {
    const cfg = config.load();
    const patch = { profile: ['cloud', 'light', 'standard', 'strong'].includes(id) ? id : 'auto', profileApplied: '', provisioned: false };
    if (['system', 'chatterbox', 'piper'].includes(cfg.ttsEngine || 'system')) patch.ttsEngine = 'system';
    chatterbox.stop(false);
    piper?.stop(false);
    if (provision.running) {
      provision.cancel();
      await provision.job?.catch(() => {});
    }
    updateConfig(patch);
    dismissed = false;
    provision.run();
    return true;
  });
  ipcMain.handle('prepare:rescan', async () => {
    if (provision.running) return false;
    dismissed = false;
    provision.run({ rescan: true });
    return true;
  });
  ipcMain.on('prepare:openAi', () => openAiTab?.());
  ipcMain.handle('prepare:report', () => provision.report());
  ipcMain.on('prepare:copy', (_e, text) => clipboard.writeText(String(text).slice(0, 20000)));
  ipcMain.on('prepare:open', (_e, url) => { if (SITES.test(String(url))) shell.openExternal(String(url)); });
  ipcMain.on('prepare:never', (_e, on) => updateConfig({ prepareWindow: !on }));
  ipcMain.on('prepare:close', () => hide({ byUser: true }));
  // from the overlay (her menus): open the window, and run the preparation again
  ipcMain.on('prepare:show', () => {
    show({ manual: true });
    provision.run();
  });

  return { show, hide, isOpen: () => Boolean(win && !win.isDestroyed()), window: () => win };
}

module.exports = { createPrepare };
