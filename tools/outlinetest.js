/* 验证章节目录：生成、开关、跳转、随编辑更新、状态记忆 */
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
  ipcMain.handle('file:openPath', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n' }));
  ipcMain.handle('dir:read', async () => ({ ok: false }));
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
    width: 1360, height: 860, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(`localStorage.clear()`);
  await win.webContents.reload();
  await new Promise((r) => setTimeout(r, 1800));
  const js = (c) => win.webContents.executeJavaScript(c);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 清掉上次遗留的偏好，保证从"全新用户"状态开始
  await js(`localStorage.clear()`);
  await win.webContents.reload();
  await wait(1200);

  /* 1. 默认显示且能生成大纲 */
  const init = await js(`(() => {
    const rows = [...document.querySelectorAll('.ol-item')];
    const heads = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    return {
      visible: !document.getElementById('outline').hidden,
      count: rows.length,
      heads: heads.length,
      label: document.getElementById('ol-count').textContent,
      btnOn: document.getElementById('btn-outline').classList.contains('on'),
      first: rows[0] ? rows[0].textContent : '',
      levels: rows.slice(0, 4).map(r => r.dataset.level)
    };
  })()`);
  check('默认显示章节目录', init.visible === true);
  check('大纲条数等于标题数', init.count > 0 && init.count === init.heads, init.count + ' vs ' + init.heads);
  check('计数徽标同步', init.label === String(init.count), init.label);
  check('右上角按钮为开启态', init.btnOn === true);
  check('首条是欢迎标题', init.first.indexOf('欢迎使用') >= 0, init.first);
  check('层级信息正确', init.levels[0] === '1', JSON.stringify(init.levels));

  /* 2. 关闭按钮 */
  const closed = await js(`(() => {
    document.getElementById('ol-close').click();
    return { hidden: document.getElementById('outline').hidden, on: document.getElementById('btn-outline').classList.contains('on'), ls: localStorage.getItem('md-editor-outline') };
  })()`);
  check('点关闭后大纲隐藏', closed.hidden === true);
  check('关闭后按钮取消高亮', closed.on === false);
  check('关闭状态被记住', closed.ls === '0', closed.ls);

  /* 3. 用右上角按钮再打开 */
  const reopened = await js(`(() => {
    document.getElementById('btn-outline').click();
    return { hidden: document.getElementById('outline').hidden, on: document.getElementById('btn-outline').classList.contains('on'), rows: document.querySelectorAll('.ol-item').length };
  })()`);
  check('右上角按钮可重新打开', reopened.hidden === false && reopened.on === true);
  check('重新打开后条目仍在', reopened.rows === init.count, String(reopened.rows));

  /* 4. 快捷键 / 菜单命令切换 */
  win.webContents.send('cmd', 'outline');
  await wait(200);
  const byCmd = await js(`document.getElementById('outline').hidden`);
  check('菜单命令可切换大纲', byCmd === true);
  win.webContents.send('cmd', 'outline');
  await wait(200);
  const byCmd2 = await js(`document.getElementById('outline').hidden`);
  check('再切一次恢复显示', byCmd2 === false);

  /* 5. 点击大纲跳转 */
  const jump = await js(`(() => {
    const rows = [...document.querySelectorAll('.ol-item')];
    const heads = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const target = rows[2];
    const expectLine = Number(heads[2].dataset.line);
    target.click();
    return { expectLine, activeIdx: rows.indexOf(document.querySelector('.ol-item.active')) };
  })()`);
  await wait(700);
  const jumped = await js(`(() => {
    const pos = editor.selectionStart;
    const line = editor.value.slice(0, pos).split('\\n').length - 1;
    return { line, active: [...document.querySelectorAll('.ol-item')].findIndex(r => r.classList.contains('active')), pTop: preview.scrollTop };
  })()`);
  check('点击大纲定位到源码对应行', jumped.line === jump.expectLine, jumped.line + ' vs ' + jump.expectLine);
  check('点击后大纲高亮该项', jumped.active === 2, String(jumped.active));
  check('阅读区同步滚动', jumped.pTop > 0 || jump.expectLine === 0, String(jumped.pTop));

  /* 6. 编辑内容后大纲实时更新 */
  const updated = await js(`(async () => {
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    document.execCommand('insertText', false, '\\n\\n## 新增的一个章节\\n\\n正文\\n\\n### 三级小节\\n');
    await new Promise(r => setTimeout(r, 350));
    const rows = [...document.querySelectorAll('.ol-item')];
    return { count: rows.length, last: rows[rows.length - 1].textContent, hasNew: rows.some(r => r.textContent === '新增的一个章节') };
  })()`);
  check('新增标题后大纲自动更新', updated.hasNew === true && updated.count === init.count + 2, JSON.stringify(updated));
  check('三级标题也被收录', updated.last === '三级小节', updated.last);

  /* 7. 无标题文档显示空提示 */
  const empty = await js(`(async () => {
    editor.value = '只有正文，没有任何标题。\\n';
    editor.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 350));
    return { rows: document.querySelectorAll('.ol-item').length, tip: document.querySelector('.ol-empty') ? document.querySelector('.ol-empty').textContent : '', label: document.getElementById('ol-count').textContent };
  })()`);
  check('无标题时给出空提示', empty.rows === 0 && empty.tip.length > 0, empty.tip);
  check('无标题时计数为 0', empty.label === '0');

  /* 8. 重启后保持隐藏状态 */
  await js(`document.getElementById('ol-close').click()`);
  await wait(200);
  await win.webContents.reload();
  await wait(1100);
  const kept = await js(`({ hidden: document.getElementById('outline').hidden, rows: document.querySelectorAll('.ol-item').length })`);
  check('重启后保持上次的显示状态', kept.hidden === true, String(kept.hidden));
  check('重启后大纲仍能生成', kept.rows > 0, String(kept.rows));

  console.log('\n==== 章节目录测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  app.exit(fail ? 1 : 0);
});
