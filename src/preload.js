const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  open: () => ipcRenderer.invoke('file:open'),
  openPath: (p) => ipcRenderer.invoke('file:openPath', p),
  save: (payload) => ipcRenderer.invoke('file:save', payload),
  reveal: () => ipcRenderer.invoke('file:reveal'),
  revealPath: (p) => ipcRenderer.invoke('file:revealPath', p),
  copyFile: (p) => ipcRenderer.invoke('file:copyFile', p),
  readFileText: (p) => ipcRenderer.invoke('file:readText', p),
  readClipboard: () => ipcRenderer.invoke('clip:read'),
  writeClipboard: (t) => ipcRenderer.invoke('clip:write', t),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  dirOpen: () => ipcRenderer.invoke('dir:open'),
  dirRead: (p) => ipcRenderer.invoke('dir:read', p),
  openNewWindow: (p) => ipcRenderer.invoke('window:openPath', p),
  newWindow: () => ipcRenderer.invoke('window:new'),
  getOpenMode: () => ipcRenderer.invoke('app:getOpenMode'),
  setOpenMode: (mode) => ipcRenderer.invoke('app:setOpenMode', mode),
  exportDocs: (payload) => ipcRenderer.send('docs:exported', payload),
  syncDoc: (p) => ipcRenderer.send('doc:syncPath', p),
  setDirty: (d) => ipcRenderer.send('app:setDirty', d),
  message: (o) => ipcRenderer.invoke('ui:message', o),
  saveFinished: (ok) => ipcRenderer.send('save:finished', ok),
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, name, payload) => cb(name, payload))
});

/* 拖放：在 preload 上下文里取真实路径（Electron 32+ 已移除 File.path） */
window.addEventListener('dragover', (e) => { e.preventDefault(); });

window.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!dt) return;
  e.preventDefault();

  const files = dt.files ? Array.from(dt.files) : [];
  if (!files.length) return;

  // 逐个尝试取真实路径；取到第一个就送去开（文件或文件夹都行）
  for (const file of files) {
    let realPath = null;
    try {
      realPath = webUtils.getPathForFile(file);
    } catch (_) { /* 拿不到就换兜底 */ }

    if (realPath) {
      ipcRenderer.send('file:drop', realPath);
      return;
    }
  }

  // 兜底：完全拿不到路径时，按普通文件读取内容（目录会失败，忽略）
  const first = files[0];
  if (typeof first.text === 'function') {
    first.text()
      .then((text) => ipcRenderer.send('file:droppedText', { name: first.name, text }))
      .catch(() => { /* 目录或不可读文件，忽略 */ });
  }
});
