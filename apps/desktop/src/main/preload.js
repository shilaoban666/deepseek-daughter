// 只把需要的接口暴露给界面，界面拿不到 Node 和 API Key

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('fish', {
  init: () => ipcRenderer.invoke('init'),
  send: (text) => ipcRenderer.invoke('send', text),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  forget: (id) => ipcRenderer.invoke('forget', id),
  usage: () => ipcRenderer.invoke('usage'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  refreshBalance: () => ipcRenderer.invoke('refresh-balance'),
  onVitals: on('vitals'),
  onReplyStart: on('reply-start'),
  onReplyDelta: on('reply-delta'),
  onReplyEnd: on('reply-end'),
  onProactive: on('proactive'),
  onFacts: on('facts'),
  onDiary: on('diary'),
  onNotice: on('notice'),
});
