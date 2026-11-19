/* 验证：目录/大纲宽度可拖拽、写入本地存储、重启恢复、分隔条跟随面板显隐 */
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paneltest-'));
  fs.writeFileSync(path.join(tmp, '文档.md'), '# 文档\n\n正文。\n', 'utf8');
  const list = () => fs.readdirSync(tmp, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || /\.(md|txt)$/i.test(d.name)))
    .map((d) => ({ name: d.name, path: path.join(tmp, d.name), isDir: d.isDirectory() }));

  ipcMain.handle('file:openPath', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n' }));
  ipcMain.handle('dir:read', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), entries: list() }));
  ipcMain.handle('dir:open', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('file:readText', async (_e, p) => ({ ok: true, text: fs.readFileSync(p, 'utf8') }));
  ipcMain.handle('file:copyFile', async () => ({ ok: true }));
  ipcMain.handle('file:revealPath', async () => ({ ok: true }));
  ipcMain.handle('clip:read', () => ''); ipcMain.handle('clip:write', () => true);
  ipcMain.handle('file:reveal', () => ({ ok: true })); ipcMain.handle('ui:message', () => 0);
  ipcMain.handle('shell:openExternal', () => true);
  ipcMain.handle('app:getOpenMode', async () => ({ mode: 'tabs' }));
  ipcMain.handle('app:setOpenMode', async () => ({ ok: true }));
  ipcMain.on('app:setDirty', () => {}); ipcMain.on('win:setTitle', () => {});
  ipcMain.on('save:finished', () => {}); ipcMain.on('docs:exported', () => {});

  const win = new BrowserWindow({
    width: 1440, height: 900, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await js(`localStorage.clear(); localStorage.setItem('md-editor-dir', ${JSON.stringify(tmp)});`);
  await win.webContents.reload();
  await wait(1400);

  /* 1. 初始宽度与分隔条存在 */
  const init = await js(`(() => ({
    sb: document.getElementById('sidebar').getBoundingClientRect().width,
    ol: document.getElementById('outline').getBoundingClientRect().width,
    sbSp: !document.getElementById('sb-splitter').hidden,
    olSp: !document.getElementById('ol-splitter').hidden
  }))()`);
  check('分隔条存在且可见', init.sbSp === true && init.olSp === true, JSON.stringify(init));
  check('目录初始宽度约 232', Math.abs(init.sb - 232) < 4, String(init.sb));
  check('大纲初始宽度约 210', Math.abs(init.ol - 210) < 4, String(init.ol));

  /* 2. 拖拽目录变宽 */
  const sbDrag = await js(`(() => {
    const before = document.getElementById('sidebar').getBoundingClientRect().width;
    const sp = document.getElementById('sb-splitter');
    sp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: before + 6 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: before + 146 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const after = document.getElementById('sidebar').getBoundingClientRect().width;
    return { before, after, saved: localStorage.getItem('md-editor-sb-w') };
  })()`);
  check('拖拽后目录变宽约 150px', Math.abs(sbDrag.after - sbDrag.before - 140) < 25, JSON.stringify(sbDrag));
  check('目录宽度写入本地存储', !!sbDrag.saved && Math.abs(Number(sbDrag.saved) - sbDrag.after) < 3, sbDrag.saved);

  /* 3. 拖拽大纲变宽（分隔条在大纲左边缘，向左拖 = 变宽） */
  const olDrag = await js(`(() => {
    const ol = document.getElementById('outline');
    const before = ol.getBoundingClientRect().width;
    const left = ol.getBoundingClientRect().left;
    const sp = document.getElementById('ol-splitter');
    sp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: left + 2 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: left - 98 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const after = ol.getBoundingClientRect().width;
    return { before, after, saved: localStorage.getItem('md-editor-ol-w') };
  })()`);
  check('拖拽后大纲变宽约 100px', Math.abs(olDrag.after - olDrag.before - 98) < 20, JSON.stringify(olDrag));
  check('大纲宽度写入本地存储', !!olDrag.saved && Math.abs(Number(olDrag.saved) - olDrag.after) < 3, olDrag.saved);

  /* 4. 重启后宽度恢复 */
  await win.webContents.reload();
  await wait(1400);
  const kept = await js(`(() => ({
    sb: document.getElementById('sidebar').getBoundingClientRect().width,
    ol: document.getElementById('outline').getBoundingClientRect().width
  }))()`);
  check('重启后目录宽度恢复', Math.abs(kept.sb - sbDrag.after) < 4, JSON.stringify(kept));
  check('重启后大纲宽度恢复', Math.abs(kept.ol - olDrag.after) < 4, JSON.stringify(kept));

  /* 5. 最小宽度限制（放在恢复验证之后，避免覆盖已保存的宽度） */
  const minTest = await js(`(() => {
    document.getElementById('sb-splitter').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 300 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 2 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return document.getElementById('sidebar').getBoundingClientRect().width;
  })()`);
  check('目录宽度不会被拖到小于 180', minTest >= 180 && minTest < 220, String(minTest));

  /* 6. 关闭面板时分隔条跟随隐藏 */
  await js(`document.getElementById('sb-close').click()`);
  await wait(200);
  const sbHidden = await js(`document.getElementById('sb-splitter').hidden`);
  check('目录隐藏时分隔条跟随隐藏', sbHidden === true);
  await js(`document.getElementById('ol-close').click()`);
  await wait(200);
  const olHidden = await js(`document.getElementById('ol-splitter').hidden`);
  check('大纲隐藏时分隔条跟随隐藏', olHidden === true);

  /* 7. 重新打开时分隔条恢复，宽度仍是记住的值 */
  await js(`(() => {
    localStorage.setItem('md-editor-sb', '0');
    document.getElementById('btn-tree').click();
  })()`);
  await wait(250);
  await js(`document.getElementById('btn-outline').click()`);
  await wait(250);
  const reopened = await js(`(() => ({
    sbSp: !document.getElementById('sb-splitter').hidden,
    olSp: !document.getElementById('ol-splitter').hidden,
    sb: document.getElementById('sidebar').getBoundingClientRect().width,
    ol: document.getElementById('outline').getBoundingClientRect().width
  }))()`);
  check('重新打开后分隔条恢复', reopened.sbSp === true && reopened.olSp === true, JSON.stringify(reopened));
  const savedNow = await js(`({ sb: localStorage.getItem('md-editor-sb-w'), ol: localStorage.getItem('md-editor-ol-w') })`);
  check('重新打开后宽度与保存值一致',
    Math.abs(reopened.sb - Number(savedNow.sb)) < 4 && Math.abs(reopened.ol - Number(savedNow.ol)) < 4,
    JSON.stringify({ reopened, savedNow }));

  /* 8. 编辑/预览分栏比例记忆 */
  const splitDrag = await js(`(() => {
    const ws = document.getElementById('workspace');
    const rect = ws.getBoundingClientRect();
    const sp = document.getElementById('splitter');
    const before = document.getElementById('editor-pane').getBoundingClientRect().width;
    sp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rect.left + before }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + rect.width * 0.62 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const after = document.getElementById('editor-pane').getBoundingClientRect().width;
    return { before, after, pct: localStorage.getItem('md-editor-split-pct') };
  })()`);
  check('拖拽分栏后比例写入存储', !!splitDrag.pct && Math.abs(Number(splitDrag.pct) - 0.62) < 0.05, JSON.stringify(splitDrag));
  await win.webContents.reload();
  await wait(1400);
  const splitKept = await js(`document.getElementById('editor-pane').getBoundingClientRect().width / document.getElementById('workspace').getBoundingClientRect().width`);
  check('重启后分栏比例恢复', Math.abs(splitKept - 0.62) < 0.03, String(splitKept));

  console.log('\n==== 面板宽度测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});
