'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const q = new URLSearchParams(location.search);
contextBridge.exposeInMainWorld('ttm', {
  view: q.get('view') || 'widget',
  tab: q.get('tab') || '',
  welcome: q.get('welcome') === '1',
  getState: () => ipcRenderer.invoke('get-state'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  sessionKey: value => ipcRenderer.invoke('session-key', String(value || '')),
  act: (type, payload) => ipcRenderer.send('action', Object.assign({ type }, payload || {})),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onTarik: cb => ipcRenderer.on('tarik', () => cb()),
  onShowOver: cb => ipcRenderer.on('show-over', () => cb())
});
