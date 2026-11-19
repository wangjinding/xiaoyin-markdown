/*
 * 小银 Markdown 编辑器 —— 主进程
 * 负责：多窗口管理、菜单与快捷键、文件读写、系统对话框、剪贴板、资源管理器联动
 *
 * 两种打开方式：
 *   tabs    —— 一个窗口内用标签页打开多个文档
 *   windows —— 每个文档开一个独立窗口
 * 偏好保存在 userData/prefs.json，切换后广播给所有窗口。
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const windows = new Map(); // webContents.id -> state { win, path, dirty, pendingClose, closing }
const pendingAdopt = new Map(); // webContents.id -> 待装载的文档（窗口拆分时用）
let openMode = 'tabs';

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (p.openMode === 'tabs' || p.openMode === 'windows') openMode = p.openMode;
  } catch (_) { /* 首次运行，用默认 */ }
}
function savePrefs() {
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify({ openMode }), 'utf8');
  } catch (_) { /* 忽略 */ }
}

function stateOf(sender) {
  return sender && sender.id != null ? windows.get(sender.id) : null;
}
function focusedState() {
  const win = BrowserWindow.getFocusedWindow();
  if (win && windows.has(win.webContents.id)) return windows.get(win.webContents.id);
  const first = windows.values().next();
  return first.done ? null : first.value;
}
function sendTo(state, channel, ...args) {
  if (state && state.win && !state.win.isDestroyed()) state.win.webContents.send(channel, ...args);
}
function primaryState() {
  const first = windows.values().next();
  return first.done ? null : first.value;
}

/* ------------------------------ 窗口 ------------------------------ */

/* 窗口图标（标题栏左上角 / 任务栏）：打包版取安装目录 resources 下的 app-win.ico，开发环境取源码树 */
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'app-win.ico')
  : path.join(__dirname, 'resources', 'app.ico');

function createWindow(filePath) {
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 860,
    minHeight: 520,
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: appIconPath,   // 标题栏左上角 / 任务栏图标（保留）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      sandbox: false
    }
  });

  const wcId = win.webContents.id;
  const state = { win, path: filePath || null, dirty: false, pendingClose: false, closing: false };
  windows.set(wcId, state);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    updateTitle(state);
    sendTo(state, 'cmd', 'open-mode', openMode);
    if (pendingAdopt.has(win.webContents.id)) {
      // 标签拆成独立窗口：装载该窗口分到的那一份文档
      sendTo(state, 'cmd', 'adopt-doc', pendingAdopt.get(win.webContents.id));
      pendingAdopt.delete(win.webContents.id);
    } else if (filePath) {
      const r = readPathQuiet(filePath);
      if (r.ok) sendTo(state, 'cmd', 'file-opened', r);
    }
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', (e) => {
    if (state.closing || !state.dirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['保存并退出', '不保存直接退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: '未保存的修改',
      message: '「' + (state.path ? path.basename(state.path) : '未命名') + '」还有未保存的修改',
      detail: '是否先保存再退出？'
    });
    if (choice === 2) return;
    if (choice === 1) { state.closing = true; win.close(); return; }
    state.pendingClose = true;
    sendTo(state, 'cmd', 'save');
  });

  // closed 触发时 webContents 已销毁，不能再读 win.webContents.id
  win.on('closed', () => {
    windows.delete(wcId);
    pendingAdopt.delete(wcId);
  });
  return win;
}

function readPathQuiet(p) {
  try {
    const { text, eol } = readFileSmart(p);
    return { ok: true, path: p, name: path.basename(p), text, eol };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/* ------------------------------ 菜单 ------------------------------ */

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => sendTo(focusedState(), 'cmd', 'new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => sendTo(focusedState(), 'cmd', 'open') },
        { label: '在新窗口打开', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendTo(focusedState(), 'cmd', 'newWindow') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendTo(focusedState(), 'cmd', 'save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendTo(focusedState(), 'cmd', 'saveAs') },
        { type: 'separator' },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+K', click: () => sendTo(focusedState(), 'cmd', 'openFolder') },
        { label: '在资源管理器中显示当前文件', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendTo(focusedState(), 'cmd', 'openDir') },
        { label: '复制全文', accelerator: 'CmdOrCtrl+Shift+C', click: () => sendTo(focusedState(), 'cmd', 'copyAll') },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => sendTo(focusedState(), 'cmd', 'find') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '编辑模式', accelerator: 'CmdOrCtrl+1', click: () => sendTo(focusedState(), 'cmd', 'mode', 'edit') },
        { label: '分栏模式', accelerator: 'CmdOrCtrl+2', click: () => sendTo(focusedState(), 'cmd', 'mode', 'split') },
        { label: '阅读模式', accelerator: 'CmdOrCtrl+3', click: () => sendTo(focusedState(), 'cmd', 'mode', 'read') },
        { type: 'separator' },
        {
          label: '文档打开方式',
          submenu: [
            {
              label: '标签页（多窗口）', type: 'radio', checked: openMode === 'tabs',
              click: () => setOpenMode('tabs')
            },
            {
              label: '独立窗口', type: 'radio', checked: openMode === 'windows',
              click: () => setOpenMode('windows')
            }
          ]
        },
        { type: 'separator' },
        { label: '显示 / 隐藏文件目录', accelerator: 'CmdOrCtrl+Shift+B', click: () => sendTo(focusedState(), 'cmd', 'tree') },
        { label: '显示 / 隐藏章节大纲', accelerator: 'CmdOrCtrl+Shift+T', click: () => sendTo(focusedState(), 'cmd', 'outline') },
        { label: '切换深色/浅色', accelerator: 'CmdOrCtrl+Shift+L', click: () => sendTo(focusedState(), 'cmd', 'theme') },
        { label: '放大', accelerator: 'CmdOrCtrl+Shift+=', click: () => sendTo(focusedState(), 'cmd', 'zoom', 1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+Shift+-', click: () => sendTo(focusedState(), 'cmd', 'zoom', -1) },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', click: () => sendTo(focusedState(), 'cmd', 'zoom', 0) },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* 让某个窗口把它的所有标签文档交出来（带未保存内容） */
function collectDocsFrom(state) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish([]), 2500);
    function finish(docs) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ipcMain.removeListener('docs:exported', handler);
      resolve(docs);
    }
    function handler(e, payload) {
      if (!state || e.sender.id !== state.win.webContents.id) return;
      finish(Array.isArray(payload && payload.docs) ? payload.docs : []);
    }
    ipcMain.on('docs:exported', handler);
    sendTo(state, 'cmd', 'export-docs');
  });
}

function dedupeDocs(docs) {
  const seen = new Set();
  const out = [];
  for (const d of docs) {
    if (d.path && seen.has(d.path)) continue;
    if (d.path) seen.add(d.path);
    out.push(d);
  }
  return out;
}

function closeForMigration(state) {
  if (!state || state.win.isDestroyed()) return;
  state.closing = true;   // 内容已收集，跳过未保存确认
  state.win.close();
}

/* 切换模式时做双向迁移：
   windows → tabs：把各窗口的文档并到一个窗口的多标签
   tabs → windows：把标签拆成多个独立窗口 */
async function setOpenMode(mode) {
  if (mode !== 'tabs' && mode !== 'windows') return;
  if (mode === openMode) { buildMenu(); return; }

  const states = [...windows.values()].filter((s) => s.win && !s.win.isDestroyed());
  const allDocs = [];
  for (const st of states) {
    const docs = await collectDocsFrom(st);
    allDocs.push(...docs);
  }
  let docs = dedupeDocs(allDocs);
  if (!docs.length) docs.push({ path: null, name: null, text: '', eol: '\n', dirty: false, lastSaved: '' });

  openMode = mode;
  savePrefs();
  buildMenu();

  if (mode === 'tabs') {
    const primary = states[0] || null;
    for (const st of states.slice(1)) closeForMigration(st);
    if (!primary) { createWindow(); return; }
    sendTo(primary, 'cmd', 'open-mode', 'tabs');
    sendTo(primary, 'cmd', 'adopt-tabs', docs);
  } else {
    for (const d of docs) {
      const win = createWindow();
      pendingAdopt.set(win.webContents.id, d);
    }
    for (const st of states) closeForMigration(st);
    for (const st of windows.values()) sendTo(st, 'cmd', 'open-mode', 'windows');
  }
}

/* ------------------------------ IPC ------------------------------ */

function readFileSmart(p) {
  const buf = fs.readFileSync(p);
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  text = text.replace(/\r\n?/g, '\n');
  return { text, eol };
}

function openPathInternal(p, state) {
  try {
    const { text, eol } = readFileSmart(p);
    if (state) { state.path = p; state.dirty = false; updateTitle(state); }
    return { ok: true, path: p, name: path.basename(p), text, eol };
  } catch (err) {
    const st = state || focusedState();
    dialog.showMessageBoxSync(st ? st.win : null, {
      type: 'error', title: '打开失败', message: '无法读取该文件', detail: String(err.message || err), buttons: ['好']
    });
    return { ok: false, error: String(err.message || err) };
  }
}

ipcMain.handle('file:open', async (e) => {
  const state = stateOf(e.sender) || focusedState();
  const r = await dialog.showOpenDialog(state ? state.win : null, {
    title: '打开 Markdown 文件',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdwn', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return openPathInternal(r.filePaths[0], state);
});

ipcMain.handle('file:openPath', async (e, p) => openPathInternal(p, stateOf(e.sender) || focusedState()));

/* 新窗口打开（右键菜单 / 菜单命令都走这里） */
ipcMain.handle('window:openPath', async (_e, p) => {
  if (!p) return { ok: false };
  try {
    if (!fs.statSync(p).isFile()) return { ok: false };
  } catch (_) { return { ok: false }; }
  createWindow(p);
  return { ok: true };
});

ipcMain.handle('window:new', async () => {
  createWindow();
  return { ok: true };
});

ipcMain.handle('app:getOpenMode', async () => openMode);
ipcMain.handle('app:setOpenMode', async (_e, mode) => {
  await setOpenMode(mode);
  return { ok: true, mode: openMode };
});

/* ---------------------- 文件夹浏览 ---------------------- */

const MD_EXT = /\.(md|markdown|mdown|mkd|mdwn|txt)$/i;
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

function listDir(dir) {
  const entries = [];
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return entries; }

  for (const d of items) {
    if (d.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(d.name)) continue;

    const full = path.join(dir, d.name);
    let isDir = d.isDirectory();
    if (!isDir && !d.isFile()) {
      try { isDir = fs.statSync(full).isDirectory(); } catch (_) { continue; }
    }
    if (!isDir && !MD_EXT.test(d.name)) continue;
    entries.push({ name: d.name, path: full, isDir });
  }
  entries.sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return entries;
}

function dirInfo(p) {
  return { ok: true, path: p, name: path.basename(p) || p, entries: listDir(p) };
}

ipcMain.handle('dir:open', async (e) => {
  const state = stateOf(e.sender) || focusedState();
  const r = await dialog.showOpenDialog(state ? state.win : null, {
    title: '打开文件夹', properties: ['openDirectory']
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  return dirInfo(r.filePaths[0]);
});

ipcMain.handle('dir:read', async (_e, p) => {
  try { if (!fs.statSync(p).isDirectory()) return { ok: false }; } catch (_) { return { ok: false }; }
  return dirInfo(p);
});

ipcMain.handle('file:save', async (e, payload) => {
  const state = stateOf(e.sender) || focusedState();
  const { content, saveAs, eol } = payload;
  let target = state && state.path;

  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(state ? state.win : null, {
      title: saveAs ? '另存为' : '保存',
      defaultPath: target || path.join(app.getPath('documents'), '未命名.md'),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '纯文本', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    target = r.filePath;
  }

  try {
    let text = content;
    if (eol === '\r\n') text = text.replace(/\r?\n/g, '\r\n');
    await fs.promises.writeFile(target, text, 'utf8');
    if (state) { state.path = target; state.dirty = false; updateTitle(state); }
    return { ok: true, path: target, name: path.basename(target) };
  } catch (err) {
    dialog.showMessageBoxSync(state ? state.win : null, {
      type: 'error', title: '保存失败', message: '写入文件时出错', detail: String(err.message || err), buttons: ['好']
    });
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('file:reveal', async (e) => {
  const state = stateOf(e.sender) || focusedState();
  const target = state && state.path;
  if (!target) {
    dialog.showMessageBoxSync(state ? state.win : null, {
      type: 'info', title: '提示', message: '当前文件还没有保存到磁盘',
      detail: '请先保存文件，之后即可打开它所在的文件夹。', buttons: ['好']
    });
    return { ok: false };
  }
  if (!fs.existsSync(target)) {
    dialog.showMessageBoxSync(state ? state.win : null, {
      type: 'warning', title: '提示', message: '文件已不存在', detail: target, buttons: ['好']
    });
    return { ok: false };
  }
  shell.showItemInFolder(target);
  return { ok: true };
});

ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.handle('clip:write', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });

const nativeClip = require('./clipboard-native');
ipcMain.handle('file:copyFile', async (_e, paths) => {
  try {
    const list = (Array.isArray(paths) ? paths : [paths]).filter((p) => p && fs.existsSync(p));
    if (!list.length) return { ok: false, error: '文件不存在' };
    nativeClip.setFiles(list);
    return { ok: true, count: list.length };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('file:readText', async (_e, p) => {
  try { return { ok: true, text: readFileSmart(p).text }; } catch (_) { return { ok: false }; }
});

ipcMain.handle('file:revealPath', async (_e, p) => {
  try {
    if (!p || !fs.existsSync(p)) return { ok: false, error: '文件不存在' };
    const err = await shell.openPath(path.dirname(p));
    if (!err) return { ok: true };
    shell.showItemInFolder(p);
    return { ok: true, fallback: true };
  } catch (err) {
    try { shell.showItemInFolder(p); return { ok: true, fallback: true }; }
    catch (_) { return { ok: false, error: String(err.message || err) }; }
  }
});

ipcMain.handle('shell:openExternal', (_e, url) => {
  const u = String(url || '');
  if (/^(https?|mailto):/i.test(u)) shell.openExternal(u);
  return true;
});

/* 拖放：作用于收到事件的那个窗口 */
ipcMain.on('file:drop', (e, p) => {
  if (!p) return;
  const state = stateOf(e.sender) || focusedState();
  let isDir = false;
  try { isDir = fs.statSync(p).isDirectory(); } catch (_) { return; }

  if (isDir) {
    sendTo(state, 'cmd', 'dir-opened', dirInfo(p));
    return;
  }
  const r = openPathInternal(p, state);
  if (r.ok) sendTo(state, 'cmd', 'file-opened', r);
});

ipcMain.on('file:droppedText', (e, payload) => {
  sendTo(stateOf(e.sender) || focusedState(), 'cmd', 'dropped-text', {
    name: payload && payload.name, text: (payload && payload.text) || ''
  });
});

ipcMain.handle('ui:message', async (e, opts) => {
  const state = stateOf(e.sender) || focusedState();
  const r = await dialog.showMessageBox(state ? state.win : null, {
    type: opts.type || 'info',
    title: opts.title || '提示',
    message: opts.message || '',
    detail: opts.detail || '',
    buttons: opts.buttons || ['好'],
    noLink: true,
    defaultId: 0,
    cancelId: (opts.buttons || ['好']).length - 1
  });
  return r.response;
});

ipcMain.on('app:setDirty', (e, d) => {
  const state = stateOf(e.sender) || focusedState();
  if (state) { state.dirty = !!d; updateTitle(state); }
});

/* 切标签 / 迁移后，渲染进程把当前激活的文档路径同步给主进程，
   这样窗口标题和「保存＝覆盖原文件」才不会错位 */
ipcMain.on('doc:syncPath', (e, p) => {
  const state = stateOf(e.sender);
  if (!state) return;
  state.path = p || null;
  updateTitle(state);
});

ipcMain.on('win:setTitle', (e) => updateTitle(stateOf(e.sender) || focusedState()));

ipcMain.on('save:finished', (e, ok) => {
  const state = stateOf(e.sender) || focusedState();
  if (!state) return;
  if (state.pendingClose && ok) {
    state.pendingClose = false;
    state.closing = true;
    state.win.close();
  } else if (!ok) {
    state.pendingClose = false;
  }
});

function updateTitle(state) {
  if (!state || !state.win || state.win.isDestroyed()) return;
  const name = state.path ? path.basename(state.path) : '未命名';
  state.win.setTitle(`${state.dirty ? '● ' : ''}${name} — 小银 Markdown`);
  state.win.setDocumentEdited(state.dirty);
}

/* ------------------------------ 生命周期 ------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const arg = argv.find((a) => /\.(md|markdown|txt|mdown|mkd)$/i.test(a));
    if (arg) {
      if (openMode === 'windows') {
        createWindow(arg);
      } else {
        const state = primaryState();
        if (state) {
          if (state.win.isMinimized()) state.win.restore();
          state.win.focus();
          sendTo(state, 'cmd', 'open-external', arg);
        } else {
          createWindow(arg);
        }
      }
      return;
    }
    const state = primaryState();
    if (state) {
      if (state.win.isMinimized()) state.win.restore();
      state.win.focus();
    }
  });

  app.whenReady().then(() => {
    loadPrefs();
    buildMenu();
    const arg = process.argv.find((a) => /\.(md|markdown|txt|mdown|mkd)$/i.test(a));
    createWindow(arg || null);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());
}

/* 供迁移测试直接驱动 */
module.exports = {
  windows,
  setOpenMode,
  getOpenMode: () => openMode
};
