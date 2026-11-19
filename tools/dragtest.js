/* 用 CDP 模拟真实系统拖放，验证 preload 能否取到路径并打开 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const log = (...a) => console.log(...a);

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragtest-'));
  const file = path.join(tmp, '拖进来的文件.md');
  const dir = path.join(tmp, '文档库');
  fs.writeFileSync(file, '# 拖进来的\n\n内容是 **拖放** 打开的。\n', 'utf8');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '第一篇.md'), '# 第一篇\n', 'utf8');
  fs.writeFileSync(path.join(dir, '第二篇.md'), '# 第二篇\n', 'utf8');

  // 真实主进程逻辑（复刻 main.js 的两条通路）
  ipcMain.handle('file:openPath', async (_e, p) => {
    return { ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n' };
  });
  ipcMain.handle('dir:read', async (_e, p) => {
    const entries = fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || /\.(md|txt)$/i.test(d.name)))
      .map((d) => ({ name: d.name, path: path.join(p, d.name), isDir: d.isDirectory() }));
    return { ok: true, path: p, name: path.basename(p), entries };
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

  // 复刻 main.js 里 file:drop 的分支（文件 → 打开；目录 → 文件树）
  ipcMain.on('file:drop', (_e, p) => {
    const win = BrowserWindow.getAllWindows()[0];
    let isDir = false;
    try { isDir = fs.statSync(p).isDirectory(); } catch (_) { return; }
    if (isDir) {
      const entries = fs.readdirSync(p, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || /\.(md|txt)$/i.test(d.name)))
        .map((d) => ({ name: d.name, path: path.join(p, d.name), isDir: d.isDirectory() }));
      win.webContents.send('cmd', 'dir-opened', { ok: true, path: p, name: path.basename(p), entries });
    } else {
      win.webContents.send('cmd', 'file-opened', {
        ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n'
      });
    }
  });

  const win = new BrowserWindow({
    width: 1280, height: 820, show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  win.focus();
  await new Promise((r) => setTimeout(r, 800));

  const dbg = win.webContents.debugger;
  dbg.attach('1.3');

  const dragDrop = async (absolutePath, x, y) => {
    const data = { items: [], files: [absolutePath], dragOperationsMask: 1 };
    await dbg.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await dbg.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    await dbg.sendCommand('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  };

  const js = (code) => win.webContents.executeJavaScript(code);
  let pass = 0;
  let fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; log('PASS ' + name); } else { fail++; log('FAIL ' + name + (extra ? '  → ' + extra : '')); }
  };

  // ---- 拖入单个 .md 文件 ----
  try {
    await dragDrop(file, 400, 380);
    await new Promise((r) => setTimeout(r, 900));
    const s = await js(`({ v: editor.value, name: document.getElementById('st-file').textContent, sb: !document.getElementById('sidebar').hidden, rows: [...document.querySelectorAll('#sb-body .tree-row')].map(r=>r.querySelector('.tree-name').textContent) })`);
    check('拖入文件：取到真实路径并打开', s.v.indexOf('拖放') >= 0, s.name);
    check('拖入文件：状态栏文件名正确', s.name === '拖进来的文件.md', s.name);
    check('拖入文件：自动列出所在目录', s.sb === true && s.rows.includes('文档库'), JSON.stringify(s.rows));
  } catch (e) {
    check('拖入文件（CDP 未支持 files 参数）', false, e.message);
  }

  // ---- 拖入文件夹 ----
  try {
    await dragDrop(dir, 400, 380);
    await new Promise((r) => setTimeout(r, 900));
    const s = await js(`({ title: document.getElementById('sb-title').textContent, rows: [...document.querySelectorAll('#sb-body .tree-row')].map(r=>r.querySelector('.tree-name').textContent) })`);
    check('拖入文件夹：侧栏标题为该文件夹', s.title === '文档库', s.title);
    check('拖入文件夹：列出里面的 md', s.rows.includes('第一篇.md') && s.rows.includes('第二篇.md'), JSON.stringify(s.rows));
  } catch (e) {
    check('拖入文件夹（CDP 未支持 files 参数）', false, e.message);
  }

  log('\n==== 拖放测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});
