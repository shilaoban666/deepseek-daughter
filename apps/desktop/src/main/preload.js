// 只把需要的接口暴露给界面，界面拿不到 Node 和 API Key

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, ...args) => fn(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('fish', {
  init: () => ipcRenderer.invoke('init'),
  cortex: () => ipcRenderer.invoke('cortex'),
  send: (text) => ipcRenderer.invoke('send', text),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  // 记忆：忘掉（归档）、恢复、彻底删除、改内容、处理矛盾
  forget: (id) => ipcRenderer.invoke('forget', id),
  restoreMemory: (id) => ipcRenderer.invoke('restore-memory', id),
  deleteMemory: (id) => ipcRenderer.invoke('delete-memory', id),
  editMemory: (id, text) => ipcRenderer.invoke('edit-memory', id, text),
  resolveConflict: (id, keepId) => ipcRenderer.invoke('resolve-conflict', id, keepId),
  // 人格：撤销一次成长
  undoGrowth: (id) => ipcRenderer.invoke('undo-growth', id),
  // 睡眠巩固、备份
  consolidate: () => ipcRenderer.invoke('consolidate'),
  receiveExternal: (payload) => ipcRenderer.invoke('receive-external', payload),
  backup: () => ipcRenderer.invoke('backup'),
  backups: () => ipcRenderer.invoke('backups'),
  usage: () => ipcRenderer.invoke('usage'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  refreshBalance: () => ipcRenderer.invoke('refresh-balance'),
  onVitals: on('vitals'),
  onReplyStart: on('reply-start'),
  onReplyDelta: on('reply-delta'),
  onReplyEnd: on('reply-end'),
  onProactive: on('proactive'),
  onMemory: on('memory'),
  onProfile: on('profile'),
  onThought: on('thought'),
  onDiary: on('diary'),
  onNotice: on('notice'),
  onUs: on('us'),
  addAnniversary: (x) => ipcRenderer.invoke('add-anniversary', x),
  removeAnniversary: (id) => ipcRenderer.invoke('remove-anniversary', id),
  removeSlang: (term) => ipcRenderer.invoke('remove-slang', term),
  markFalsePositive: () => ipcRenderer.invoke('mark-false-positive'),
});
