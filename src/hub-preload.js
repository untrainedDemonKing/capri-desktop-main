'use strict';

// What her main menu (renderer/hub.html) may ask of her: how things stand, a preview of a choice, a key tried,
// the choice applied, the report. Nothing else of her is reachable from that page.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  state: () => ipcRenderer.invoke('hub:state'),
  rescan: () => ipcRenderer.invoke('hub:rescan'),
  preview: (choice) => ipcRenderer.invoke('hub:preview', choice),
  connect: (payload) => ipcRenderer.invoke('hub:connect', payload),
  keyPage: (provider) => ipcRenderer.send('hub:keyPage', String(provider)),
  voiceKey: (payload) => ipcRenderer.invoke('hub:voiceKey', payload),
  apply: (choice) => ipcRenderer.invoke('hub:apply', choice),
  retry: () => ipcRenderer.invoke('hub:retry'),
  stop: () => ipcRenderer.invoke('hub:stop'),
  report: () => ipcRenderer.invoke('hub:report'),
  copy: (text) => ipcRenderer.send('hub:copy', String(text)),
  skip: () => ipcRenderer.send('hub:skip'),
  close: () => ipcRenderer.send('hub:close'),
  choose: (what) => ipcRenderer.invoke('prepare:choose', what),
  open: (url) => ipcRenderer.send('prepare:open', String(url)),
  onChange: (fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on('hub:change', listener);
    return () => ipcRenderer.removeListener('hub:change', listener);
  },
});
