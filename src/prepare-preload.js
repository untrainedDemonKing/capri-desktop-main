'use strict';

// What her preparation window (renderer/prepare.html) may ask of her: how things stand, a retry, a folder to
// pick, the report. Nothing else of her is reachable from that page.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prepare', {
  state: () => ipcRenderer.invoke('prepare:state'),
  onChange: (fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on('prepare:change', listener);
    return () => ipcRenderer.removeListener('prepare:change', listener);
  },
  retry: (id) => ipcRenderer.invoke('prepare:retry', id ?? null),
  skip: () => ipcRenderer.invoke('prepare:skip'),
  choose: (what) => ipcRenderer.invoke('prepare:choose', what),
  open: (url) => ipcRenderer.send('prepare:open', String(url)),
  profile: (id) => ipcRenderer.invoke('prepare:profile', String(id)),
  rescan: () => ipcRenderer.invoke('prepare:rescan'),
  openAi: () => ipcRenderer.send('prepare:openAi'),
  report: () => ipcRenderer.invoke('prepare:report'),
  copy: (text) => ipcRenderer.send('prepare:copy', String(text)),
  never: (on) => ipcRenderer.send('prepare:never', Boolean(on)),
  close: () => ipcRenderer.send('prepare:close'),
});
