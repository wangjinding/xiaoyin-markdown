/* 验证：标签页、独立窗口偏好、右键打开方式、状态保留 */
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multitest-'));
  const a = path.join(tmp, 'A文档.md');
  const b = path.join(tmp, 'B文档.md');
  fs.writeFileSync(a, '# A 文档\n\n这是 A。\n', 'utf8');
  fs.writeFileSync(b, '# B 文档\n\n这是 B。\n', 'utf8');
  const list = () => fs.readdirSync(tmp, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || /\.(md|txt)$/i.test(d.name)))
    .map((d) => ({ name: d.name, path: path.join(tmp, d.name), isDir: d.isDirectory() }));

  let forcedMode = 'tabs';
  let lastNewWindow = '';
  let lastNewBlank = 0;
  let lastSetMode = '';

  ipcMain.handle('file:openPath', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n' }));
  ipcMain.handle('dir:read', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), entries: list() }));
  ipcMain.handle('dir:open', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('file:readText', async (_e, p) => ({ ok: true, text: fs.readFileSync(p, 'utf8') }));
  ipcMain.handle('file:copyFile', async () => ({ ok: true }));
  ipcMain.handle('file:revealPath', async () => ({ ok: true }));
  ipcMain.handle('clip:read', () => '');
  ipcMain.handle('clip:write', () => true);
  ipcMain.handle('file:reveal', () => ({ ok: true }));
  ipcMain.handle('ui:message', () => 0);
  ipcMain.handle('shell:openExternal', () => true);
  ipcMain.handle('app:getOpenMode', async () => ({ mode: forcedMode }));
  ipcMain.handle('app:setOpenMode', async (_e, m) => { lastSetMode = m; forcedMode = m; return { ok: true }; });
  ipcMain.handle('window:openPath', async (_e, p) => { lastNewWindow = p || ''; return { ok: true }; });
  ipcMain.handle('window:new', async () => { lastNewBlank++; return { ok: true }; });
  ipcMain.on('app:setDirty', () => {});
  ipcMain.on('win:setTitle', () => {});
  ipcMain.on('save:finished', () => {});
  ipcMain.on('file:drop', () => {});
  ipcMain.on('file:droppedText', () => {});

  const win = new BrowserWindow({
    width: 1400, height: 880, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await js(`localStorage.clear()`);
  await win.webContents.reload();
  await wait(1300);

  /* 1. 初始标签 */
  const init = await js(`(() => ({
    visible: !document.getElementById('tabbar').hidden,
    n: document.querySelectorAll('#tabbar .tab').length,
    label: document.getElementById('openmode-label').textContent
  }))()`);
  check('默认标签栏可见且有 1 个标签', init.visible === true && init.n === 1, JSON.stringify(init));
  check('按钮显示「标签」', init.label === '标签', init.label);

  /* 2. 打开两个文件 → 两个新标签 */
  win.webContents.send('cmd', 'file-opened', { ok: true, path: a, name: 'A文档.md', text: fs.readFileSync(a, 'utf8'), eol: '\n' });
  await wait(300);
  win.webContents.send('cmd', 'file-opened', { ok: true, path: b, name: 'B文档.md', text: fs.readFileSync(b, 'utf8'), eol: '\n' });
  await wait(400);
  const two = await js(`(() => ({
    n: document.querySelectorAll('#tabbar .tab').length,
    active: document.querySelector('#tabbar .tab.active .tab-name').textContent,
    val: editor.value.slice(0, 6),
    names: [...document.querySelectorAll('#tabbar .tab-name')].map(e => e.textContent)
  }))()`);
  check('打开两个文件得到 3 个标签', two.n === 3, JSON.stringify(two.names));
  check('当前标签是最后打开的文件', two.active === 'B文档.md', two.active);
  check('编辑区显示当前标签内容', two.val.indexOf('B 文档') >= 0, two.val);

  /* 3. 切换标签，各自状态保留 */
  await js(`(() => {
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    document.execCommand('insertText', false, '\\nB 的修改');
  })()`);
  await wait(250);
  await js(`document.querySelectorAll('#tabbar .tab')[1].click()`);
  await wait(350);
  const switched = await js(`(() => ({
    active: document.querySelector('#tabbar .tab.active .tab-name').textContent,
    val: editor.value.slice(0, 6)
  }))()`);
  check('点标签切到 A 文档', switched.active === 'A文档.md' && switched.val.indexOf('A 文档') >= 0, JSON.stringify(switched));

  await js(`document.querySelectorAll('#tabbar .tab')[2].click()`);
  await wait(350);
  const back = await js(`editor.value.includes('B 的修改')`);
  check('切回后 B 的修改还在', back === true);

  /* 4. 重复打开同一文件不新增标签 */
  win.webContents.send('cmd', 'file-opened', { ok: true, path: a, name: 'A文档.md', text: fs.readFileSync(a, 'utf8'), eol: '\n' });
  await wait(350);
  const dup = await js(`document.querySelectorAll('#tabbar .tab').length`);
  check('重复打开同一文件不新建标签', dup === 3, String(dup));

  /* 5. 关闭标签 */
  await js(`document.querySelectorAll('#tabbar .tab-close')[2].click()`);
  await wait(400);
  const closed = await js(`(() => ({ n: document.querySelectorAll('#tabbar .tab').length, active: document.querySelector('#tabbar .tab.active .tab-name').textContent }))()`);
  check('关闭标签后数量减 1', closed.n === 2, JSON.stringify(closed));
  check('关闭后切到相邻标签', ['A文档.md', '未命名'].includes(closed.active), closed.active);

  /* 6. 切换到独立窗口模式 */
  const modeInfo = await js(`(async () => {
    document.getElementById('btn-openmode').click();
    await new Promise(r => setTimeout(r, 350));
    return {
      hidden: document.getElementById('tabbar').hidden,
      label: document.getElementById('openmode-label').textContent,
      ls: localStorage.getItem('md-editor-open-mode')
    };
  })()`);
  check('切到窗口模式后标签栏隐藏', modeInfo.hidden === true, JSON.stringify(modeInfo));
  check('按钮文字变为「窗口」', modeInfo.label === '窗口', modeInfo.label);
  check('模式写入本地存储', modeInfo.ls === 'windows', modeInfo.ls);
  check('模式同步到主进程', lastSetMode === 'windows', lastSetMode);

  /* 7. 窗口模式下右键显示「在新窗口打开」，且真的走新窗口 */
  const ctxWin = await js(`(() => {
    const row = [...document.querySelectorAll('#sb-body .tree-row')].find(r => r.dataset.path.endsWith('A文档.md'));
    if (!row) return { err: 'no row' };
    const p = row.dataset.path;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 200 }));
    const items = [...document.querySelectorAll('#ctxmenu .ctx-item')];
    const lab = (i) => { const s = i.querySelector('span'); return s ? s.textContent : ''; };
    const first = items[0] ? lab(items[0]) : '';
    const target = items.find(i => lab(i) === '在新窗口打开');
    if (target) target.click();
    return { first, exists: !!target, path: p };
  })()`).catch(async () => {
    // executeJavaScript 里不能引用 win，重来一次
    return js(`(() => {
      const row = [...document.querySelectorAll('#sb-body .tree-row')].find(r => r.dataset.path.endsWith('A文档.md'));
      if (!row) return { err: 'no row' };
      const p = row.dataset.path;
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 200 }));
      const items = [...document.querySelectorAll('#ctxmenu .ctx-item')];
      const lab = (i) => { const s = i.querySelector('span'); return s ? s.textContent : ''; };
      const first = items[0] ? lab(items[0]) : '';
      const target = items.find(i => lab(i) === '在新窗口打开');
      if (target) target.click();
      return { first, exists: !!target, path: p };
    })()`);
  });
  await wait(350);
  check('窗口模式右键首项是「在新窗口打开」', ctxWin.first === '在新窗口打开', JSON.stringify(ctxWin));
  check('右键触发了独立窗口打开', lastNewWindow === a, lastNewWindow);

  /* 8. 切回标签模式，右键变「在新标签打开」 */
  await js(`document.getElementById('btn-openmode').click()`);
  await wait(350);
  const ctxTab = await js(`(() => {
    const row = [...document.querySelectorAll('#sb-body .tree-row')].find(r => r.dataset.path.endsWith('B文档.md'));
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 200 }));
    const items = [...document.querySelectorAll('#ctxmenu .ctx-item')];
    const lab = (i) => { const s = i.querySelector('span'); return s ? s.textContent : ''; };
    const first = items[0] ? lab(items[0]) : '';
    const target = items.find(i => lab(i) === '在新标签打开');
    if (target) target.click();
    return { first, exists: !!target };
  })()`);
  await wait(450);
  check('标签模式右键首项是「在新标签打开」', ctxTab.first === '在新标签打开', JSON.stringify(ctxTab));
  const afterCtx = await js(`(() => ({ n: document.querySelectorAll('#tabbar .tab').length, val: editor.value.slice(0,6) }))()`);
  check('右键在新标签打开生效', afterCtx.val.indexOf('B 文档') >= 0, JSON.stringify(afterCtx));

  /* 9. 重启后保持模式 */
  await win.webContents.reload();
  await wait(1300);
  const kept = await js(`(() => ({
    hidden: document.getElementById('tabbar').hidden,
    label: document.getElementById('openmode-label').textContent,
    tabs: document.querySelectorAll('#tabbar .tab').length
  }))()`);
  check('重启后保持标签模式', kept.hidden === false && kept.label === '标签', JSON.stringify(kept));
  check('重启后有欢迎标签', kept.tabs === 1, String(kept.tabs));

  /* 9.5 关闭欢迎页后，下次启动不再显示 */
  const hadWelcome = await js(`editor.value.indexOf('欢迎使用') >= 0`);
  await js(`document.querySelectorAll('#tabbar .tab-close')[0].click()`);
  await wait(450);
  const flag = await js(`localStorage.getItem('md-editor-welcome-closed')`);
  check('初始打开的是欢迎页', hadWelcome === true);
  check('关闭欢迎页后写入标记', flag === '1', flag);
  await win.webContents.reload();
  await wait(1300);
  const afterClose = await js(`(() => ({
    tabs: document.querySelectorAll('#tabbar .tab').length,
    name: (document.querySelector('#tabbar .tab-name') || {}).textContent || '',
    val: editor.value
  }))()`);
  check('重启后不再显示欢迎页', afterClose.val.indexOf('欢迎使用') < 0, JSON.stringify(afterClose.val.slice(0, 20)));
  check('重启后是空白未命名标签', afterClose.tabs === 1 && afterClose.name === '未命名' && afterClose.val === '', JSON.stringify({ name: afterClose.name, len: afterClose.val.length }));

  /* 10. 主进程偏好为 windows 时启动即窗口模式 */
  forcedMode = 'windows';
  await win.webContents.reload();
  await wait(1300);
  const fromMain = await js(`(() => ({
    hidden: document.getElementById('tabbar').hidden,
    label: document.getElementById('openmode-label').textContent
  }))()`);
  check('主进程偏好为窗口时启动即窗口模式', fromMain.hidden === true && fromMain.label === '窗口', JSON.stringify(fromMain));

  console.log('\n==== 多窗口/标签测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});
