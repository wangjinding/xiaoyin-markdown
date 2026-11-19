/* 验证：启动即显示侧栏、空态引导、记住上次文件夹 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + n); }
  else { fail++; console.log('FAIL ' + n + (extra ? '  → ' + extra : '')); }
};

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidetest-'));
  fs.writeFileSync(path.join(tmp, '一篇.md'), '# 一篇\n', 'utf8');
  fs.writeFileSync(path.join(tmp, '二篇.md'), '# 二篇\n', 'utf8');

  const list = () => fs.readdirSync(tmp, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || /\.(md|txt)$/i.test(d.name)))
    .map((d) => ({ name: d.name, path: path.join(tmp, d.name), isDir: d.isDirectory() }));

  ipcMain.handle('file:openPath', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n' }));
  ipcMain.handle('dir:read', async (_e, p) => {
    if (!fs.existsSync(p)) return { ok: false };
    return { ok: true, path: p, name: path.basename(p), entries: list() };
  });
  ipcMain.handle('dir:open', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('clip:read', () => '');
  ipcMain.handle('clip:write', () => true);
  ipcMain.handle('file:reveal', () => ({ ok: true }));
  ipcMain.handle('ui:message', () => 0);
  ipcMain.handle('shell:openExternal', () => true);
  ipcMain.on('app:setDirty', () => {});
  ipcMain.on('win:setTitle', () => {});
  ipcMain.on('save:finished', () => {});

  const win = new BrowserWindow({
    width: 1280, height: 820, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(700);

  // 1. 清空记忆后重新加载 = 首次启动
  await js(`localStorage.clear()`);
  await win.webContents.reload();
  await wait(1100);
  const first = await js(`({
    visible: !document.getElementById('sidebar').hidden,
    hasBtn: !!document.querySelector('.sb-pick-btn'),
    title: document.getElementById('sb-title').textContent,
    hasTree: document.querySelectorAll('#sb-body .tree-row').length
  })`);
  check('首次启动显示左侧目录（空态引导）', first.visible === true, JSON.stringify(first));
  check('空态有「选择文件夹」按钮', first.hasBtn === true);
  check('无文件夹时不渲染空条目', first.hasTree === 0);
  check('面板标题为「目录」', first.title === '目录', first.title);

  // 2. 打开文件夹后记录到本地
  win.webContents.send('cmd', 'dir-opened', { ok: true, path: tmp, name: path.basename(tmp), entries: list() });
  await wait(400);
  const after = await js(`({ saved: localStorage.getItem('md-editor-dir'), rows: document.querySelectorAll('#sb-body .tree-row').length, title: document.getElementById('sb-title').textContent })`);
  check('打开文件夹后写入记忆', after.saved === tmp, after.saved);
  check('文件树列出两个文件', after.rows === 2, String(after.rows));
  check('侧栏标题为文件夹名', after.title === path.basename(tmp), after.title);

  // 3. 重启后自动恢复上次文件夹
  await win.webContents.reload();
  await wait(1100);
  const restored = await js(`({
    visible: !document.getElementById('sidebar').hidden,
    title: document.getElementById('sb-title').textContent,
    rows: [...document.querySelectorAll('#sb-body .tree-row')].map(r => r.querySelector('.tree-name').textContent)
  })`);
  check('重启后自动恢复上次文件夹', restored.visible === true && restored.rows.length === 2, JSON.stringify(restored));
  check('恢复后标题正确', restored.title === path.basename(tmp));

  // 4. 收起后下次启动保持收起
  await js(`document.getElementById('sb-close').click()`);
  await wait(200);
  await win.webContents.reload();
  await wait(1100);
  const kept = await js(`!document.getElementById('sidebar').hidden`);
  check('用户收起后重启仍保持收起', kept === false, String(kept));

  // 5. 工具栏按钮再次唤出
  await js(`document.getElementById('btn-tree').click()`);
  await wait(400);
  const shown = await js(`({ hidden: document.getElementById('sidebar').hidden, rows: document.querySelectorAll('#sb-body .tree-row').length })`);
  check('工具栏可重新唤出文件树', shown.hidden === false && shown.rows === 2, JSON.stringify(shown));

  console.log('\n==== 侧栏测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});
