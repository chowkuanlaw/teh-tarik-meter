'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ttm', {
  view: new URLSearchParams(location.search).get('view') || 'widget',
  getState: () => ipcRenderer.invoke('get-state'),
  sessionKey: value => ipcRenderer.invoke('session-key', String(value || '')),
  act: (type, payload) => ipcRenderer.send('action', Object.assign({ type }, payload || {})),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onTarik: cb => ipcRenderer.on('tarik', () => cb()),
  onShowOver: cb => ipcRenderer.on('show-over', () => cb())
});
