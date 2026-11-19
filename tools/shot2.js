const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const theme = process.env.SHOT_THEME || 'light';
const out = process.env.SHOT_OUT || path.join(__dirname, '..', 'shot.png');

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shotdir-'));
  const mk = (n, c) => fs.writeFileSync(path.join(tmp, n), c, 'utf8');
  mk('产品需求说明.md', '# 产品需求说明\n\n## 目标\n\n做一个**纯本地**的 Markdown 编辑器。\n\n- 实时预览\n- 右键复制全文\n- 拖进来就打开\n\n> 不联网，不登录。\n');
  mk('API 设计.md', '# API\n');
  mk('更新日志.md', '# 更新日志\n');
  mk('readme.txt', 'txt\n');
  fs.mkdirSync(path.join(tmp, '草稿'));
  fs.writeFileSync(path.join(tmp, '草稿', '想法.md'), '# 想法\n', 'utf8');

  const list = () => fs.readdirSync(tmp, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.') && (d.isDirectory() || /\.(md|txt)$/i.test(d.name)))
    .map(d => ({ name: d.name, path: path.join(tmp, d.name), isDir: d.isDirectory() }))
    .sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name, 'zh-Hans-CN'));

  ipcMain.handle('file:openPath', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n' }));
  ipcMain.handle('dir:read', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), entries: list() }));
  ipcMain.handle('dir:open', async () => ({ ok: false }));
  ipcMain.handle('clip:read', () => ''); ipcMain.handle('clip:write', () => true);
  ipcMain.handle('file:reveal', () => ({ ok: true })); ipcMain.handle('ui:message', () => 0);
  ipcMain.handle('shell:openExternal', () => true);
  ipcMain.on('app:setDirty', () => {}); ipcMain.on('win:setTitle', () => {}); ipcMain.on('save:finished', () => {});

  const win = new BrowserWindow({ width: 1380, height: 880, show: true, backgroundColor: '#fff',
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(`localStorage.setItem('md-editor-theme', ${JSON.stringify(theme)}); document.documentElement.dataset.theme = ${JSON.stringify(theme)};`);
  win.webContents.send('cmd', 'dir-opened', { ok: true, path: tmp, name: path.basename(tmp), entries: list() });
  await new Promise(r => setTimeout(r, 500));
  win.webContents.send('cmd', 'file-opened', { ok: true, path: path.join(tmp, '产品需求说明.md'), name: '产品需求说明.md', text: fs.readFileSync(path.join(tmp, '产品需求说明.md'), 'utf8'), eol: '\n' });
  await new Promise(r => setTimeout(r, 1400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('saved', out);
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(0);
});
