'use strict';

// What her main menu (renderer/hub.html) may ask of her: how things stand, a preview of a choice, a key tried,
// the choice applied, the report, how her mind was fitted to this PC, the recording she has as her voice, what is on this PC
// because of her and taking it off. Nothing else of her is
// reachable from that page.

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
  inventory: () => ipcRenderer.invoke('hub:inventory'),
  remove: (id) => ipcRenderer.invoke('hub:remove', String(id)),
  removeAll: () => ipcRenderer.invoke('hub:removeAll'),
  uninstall: () => ipcRenderer.invoke('hub:uninstall'),
  sample: () => ipcRenderer.invoke('voice:sample'),
  sampleChoose: () => ipcRenderer.invoke('voice:sampleChoose'),
  sampleRemove: () => ipcRenderer.invoke('voice:sampleRemove'),
  tune: () => ipcRenderer.invoke('hub:tune'),
  retune: () => ipcRenderer.invoke('hub:retune'),
  copy: (text) => ipcRenderer.send('hub:copy', String(text)),
  skip: () => ipcRenderer.send('hub:skip'),
  close: () => ipcRenderer.send('hub:close'),
  choose: (what) => ipcRenderer.invoke('prepare:choose', what),
  open: (url) => ipcRenderer.send('prepare:open', String(url)),
  onFocus: (fn) => {
    const listener = (_e, section) => fn(section);
    ipcRenderer.on('hub:focus', listener);
    return () => ipcRenderer.removeListener('hub:focus', listener);
  },
  onTune: (fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on('hub:tune', listener);
    return () => ipcRenderer.removeListener('hub:tune', listener);
  },
  onChange: (fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on('hub:change', listener);
    return () => ipcRenderer.removeListener('hub:change', listener);
  },
});
