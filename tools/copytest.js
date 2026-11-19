/* 验证：文件树右键复制（文件名/路径/内容）+ 聚焦后 Ctrl+C + 按钮位置 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const nativeClip = require('../src/clipboard-native');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + n); }
  else { fail++; console.log('FAIL ' + n + (extra ? '  → ' + extra : '')); }
};

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copytest-'));
  const mdFile = path.join(tmp, '交易日历业务交接文档.md');
  const mdText = '# 交易日历业务交接文档\n\n## 业务概览\n\n正文内容。\n';
  fs.writeFileSync(mdFile, mdText, 'utf8');
  fs.mkdirSync(path.join(tmp, '子目录'));
  fs.writeFileSync(path.join(tmp, '另一个.md'), '# 另一个\n', 'utf8');

  const list = () => fs.readdirSync(tmp, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || /\.(md|txt)$/i.test(d.name)))
    .map((d) => ({ name: d.name, path: path.join(tmp, d.name), isDir: d.isDirectory() }))
    .sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name, 'zh-Hans-CN'));

  let clipboard = '';
  let lastRevealed = '';
  let lastCopiedFile = '';
  ipcMain.handle('clip:read', () => clipboard);
  ipcMain.handle('clip:write', (_e, text) => { clipboard = String(text ?? ''); return true; });
  ipcMain.handle('file:readText', async (_e, p) => {
    try { return { ok: true, text: fs.readFileSync(p, 'utf8') }; } catch (_) { return { ok: false }; }
  });
  ipcMain.handle('file:copyFile', async (_e, p) => {
    const list = (Array.isArray(p) ? p : [p]).filter((x) => x && fs.existsSync(x));
    nativeClip.setFiles(list);
    lastCopiedFile = p || '';
    return { ok: true, count: list.length };
  });
  ipcMain.handle('file:revealPath', async (_e, p) => { lastRevealed = p || ''; return { ok: true }; });
  ipcMain.handle('file:openPath', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8'), eol: '\n' }));
  ipcMain.handle('dir:read', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), entries: list() }));
  ipcMain.handle('dir:open', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('file:reveal', async () => ({ ok: true }));
  ipcMain.handle('ui:message', () => 0);
  ipcMain.handle('shell:openExternal', () => true);
  ipcMain.on('app:setDirty', () => {});
  ipcMain.on('win:setTitle', () => {});
  ipcMain.on('save:finished', () => {});

  const win = new BrowserWindow({
    width: 1400, height: 880, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await js(`localStorage.clear()`);
  await win.webContents.reload();
  await wait(1200);

  /* 1. 按钮位置 */
  const pos = await js(`(() => {
    const btns = [...document.querySelectorAll('.toolbar button')];
    const tree = document.getElementById('btn-tree');
    const outline = document.getElementById('btn-outline');
    const segBtn = document.querySelector('#mode-seg button');
    return {
      beforeSeg: btns.indexOf(tree) < btns.indexOf(segBtn),
      adjacent: btns.indexOf(segBtn) - btns.indexOf(tree) === 1,
      sameClass: tree.className === outline.className,
      treeText: tree.textContent.trim(), outlineText: outline.textContent.trim()
    };
  })()`);
  check('「目录」按钮紧挨在编辑/分栏/阅读之前', pos.beforeSeg === true && pos.adjacent === true, JSON.stringify(pos));
  check('两个开关样式类名一致', pos.sameClass === true, pos.treeClass || '');
  check('按钮文字为 目录 / 大纲', pos.treeText === '目录' && pos.outlineText === '大纲', pos.treeText + ' / ' + pos.outlineText);

  /* 2. 打开文件夹，准备文件树 */
  win.webContents.send('cmd', 'dir-opened', { ok: true, path: tmp, name: path.basename(tmp), entries: list() });
  await wait(400);

  const rightClick = async (pathSuffix, menuText) => js(`(() => {
    const rows = [...document.querySelectorAll('#sb-body .tree-row')];
    const row = rows.find(r => r.dataset.path.endsWith(${JSON.stringify(pathSuffix)}));
    if (!row) return { error: 'row not found' };
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 200 }));
    const menu = document.getElementById('ctxmenu');
    const items = [...menu.querySelectorAll('.ctx-item')].map(i => i.textContent);
    const target = [...menu.querySelectorAll('.ctx-item')].find(i => {
      const lab = i.querySelector('span');
      return lab && lab.textContent === ${JSON.stringify(menuText)};
    });
    if (!target) return { error: 'menu item not found', items };
    target.click();
    return { items };
  })()`);

  /* 3. 右键复制文件名 */
  await rightClick('交易日历业务交接文档.md', '复制文件名');
  await wait(200);
  check('右键复制文件名', clipboard === '交易日历业务交接文档.md', clipboard);

  /* 4. 右键复制完整路径 */
  await rightClick('交易日历业务交接文档.md', '复制完整路径');
  await wait(200);
  check('右键复制完整路径', clipboard === mdFile, clipboard);

  /* 5. 右键复制文件内容 */
  await rightClick('交易日历业务交接文档.md', '复制文件内容');
  await wait(250);
  check('右键复制文件内容', clipboard === mdText, JSON.stringify(clipboard).slice(0, 60));

  /* 6. 右键复制文件本身（Windows 文件对象） */
  await rightClick('交易日历业务交接文档.md', '复制文件');
  await wait(250);
  check('右键复制文件本身', lastCopiedFile === mdFile, lastCopiedFile);
  check('系统剪贴板含文件列表 CF_HDROP', nativeClip.hasFiles() === true);

  /* 7. 右键在资源管理器中显示：路径必须真的传过去 */
  await rightClick('交易日历业务交接文档.md', '在资源管理器中显示');
  await wait(200);
  check('资源管理器显示：路径参数正确传递', lastRevealed === mdFile, lastRevealed);

  /* 8. 右键菜单内容齐全、目录项禁用复制内容 */
  const menuInfo = await js(`(() => {
    const row = [...document.querySelectorAll('#sb-body .tree-row.is-dir')][0];
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 260, clientY: 200 }));
    const items = [...document.querySelectorAll('#ctxmenu .ctx-item')];
    const lab = (i) => { const s = i.querySelector('span'); return s ? s.textContent : ''; };
    return {
      labels: items.map(lab),
      contentDisabled: items.find(i => lab(i) === '复制文件内容').classList.contains('disabled')
    };
  })()`);
  check('右键菜单五项齐全', ['复制文件', '复制文件内容', '复制文件名', '复制完整路径', '在资源管理器中显示'].every(x => menuInfo.labels.includes(x)), JSON.stringify(menuInfo.labels));
  check('目录项禁用复制文件内容', menuInfo.contentDisabled === true);

  /* 9. 聚焦 + Ctrl+C 复制文件 */
  const kbd = await js(`(() => {
    document.getElementById('ctxmenu').hidden = true;
    const row = [...document.querySelectorAll('#sb-body .tree-row')].find(r => r.dataset.path.endsWith('另一个.md'));
    row.focus();
    const focused = document.activeElement === row;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    return { focused };
  })()`);
  await wait(250);
  check('文件树条目可聚焦', kbd.focused === true);
  check('Ctrl+C 复制文件本身', lastCopiedFile === path.join(tmp, '另一个.md'), lastCopiedFile);
  check('Ctrl+C 后剪贴板仍是文件列表', nativeClip.hasFiles() === true);

  /* 8. 普通编辑区 Ctrl+C 不受影响 */
  await js(`(() => {
    const ed = document.getElementById('editor');
    ed.value = 'EDITOR TEXT';
    ed.focus();
    ed.setSelectionRange(0, 5);
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await wait(250);
  check('编辑区 Ctrl+C 不误触文件树复制', clipboard !== 'EDITOR TEXT', clipboard);

  console.log('\n==== 文件树复制测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'shot-copy.png'), img.toPNG());
  console.log('screenshot saved');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});
