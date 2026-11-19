/* 验证：查找时预览正文的关键字背景标记与当前命中高亮 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + n); }
  else { fail++; console.log('FAIL ' + n + (extra ? '  → ' + extra : '')); }
};

app.whenReady().then(async () => {
  ipcMain.handle('clip:read', () => '');
  ipcMain.handle('clip:write', () => true);
  ipcMain.handle('file:reveal', () => ({ ok: true }));
  ipcMain.handle('ui:message', () => 0);
  ipcMain.handle('shell:openExternal', () => true);
  ipcMain.handle('app:getOpenMode', async () => ({ mode: 'tabs' }));
  ipcMain.handle('app:setOpenMode', async () => ({ ok: true }));
  ipcMain.on('app:setDirty', () => {}); ipcMain.on('win:setTitle', () => {});
  ipcMain.on('save:finished', () => {}); ipcMain.on('docs:exported', () => {});
  ipcMain.on('doc:syncPath', () => {});

  const win = new BrowserWindow({
    width: 1400, height: 900, show: true,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const js = (c) => win.webContents.executeJavaScript(c);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await js(`localStorage.clear()`);
  await win.webContents.reload();
  await wait(1800);

  /* 1. 输入关键字，预览出现标记 */
  const r1 = await js(`(async () => {
    editor.value = '# 标题\\n\\n银色是银色的银，银币也很银。\\n\\n- 银在列表里\\n\\n**银** 在加粗里。';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    document.getElementById('btn-find').click();
    await new Promise(r => setTimeout(r, 150));
    const inp = document.getElementById('find-input');
    inp.value = '银';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return {
      total: document.querySelectorAll('#preview mark.find-hit').length,
      active: document.querySelectorAll('#preview mark.find-hit.find-hit-active').length,
      count: document.getElementById('find-count').textContent
    };
  })()`);
  check('预览正文出现 7 处关键字标记', r1.total === 7, JSON.stringify(r1));
  check('当前命中有一个且仅一个', r1.active === 1, JSON.stringify(r1));
  check('计数显示正常', r1.count.indexOf('7') >= 0, r1.count);

  /* 1b. 编辑器叠加层同步高亮 */
  const r1b = await js(`(() => ({
    marks: document.querySelectorAll('#editor-hl mark').length,
    active: document.querySelectorAll('#editor-hl mark.find-hit-active').length
  }))()`);
  check('编辑器叠加层出现 7 处标记', r1b.marks === 7, JSON.stringify(r1b));
  check('编辑器层当前命中唯一', r1b.active === 1, JSON.stringify(r1b));

  /* 1c. 编辑模式（无预览）下叠加层仍然高亮 */
  const r1c = await js(`(async () => {
    document.querySelector('.seg button[data-mode="edit"]').click();
    await new Promise(r => setTimeout(r, 150));
    const inEdit = document.getElementById('workspace').dataset.mode;
    const marks = document.querySelectorAll('#editor-hl mark').length;
    document.querySelector('.seg button[data-mode="split"]').click();
    await new Promise(r => setTimeout(r, 150));
    return { inEdit, marks };
  })()`);
  check('编辑模式下叠加层保持标记', r1c.inEdit === 'edit' && r1c.marks === 7, JSON.stringify(r1c));

  /* 2. 下一处：active 移动 */
  const r2 = await js(`(() => {
    document.getElementById('find-next').click();
    return {
      actives: [...document.querySelectorAll('#preview mark.find-hit-active')].map(m => m.textContent),
      idx: document.getElementById('find-count').textContent
    };
  })()`);
  check('下一处后当前命中唯一', r2.actives.length === 1, JSON.stringify(r2));
  check('计数推进到 2 / 7', r2.idx.indexOf('2 /') >= 0, r2.idx);

  /* 3. 编辑内容后（renderNow 重建 DOM）标记恢复 */
  const r3 = await js(`(async () => {
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    document.execCommand('insertText', false, '\\n新增一行也带银字。');
    await new Promise(r => setTimeout(r, 350));
    return { total: document.querySelectorAll('#preview mark.find-hit').length };
  })()`);
  check('编辑重渲染后标记自动恢复', r3.total === 8, JSON.stringify(r3));

  /* 4. 关闭查找，标记清除 */
  const r4 = await js(`(() => {
    document.getElementById('find-close').click();
    return {
      preview: document.querySelectorAll('#preview mark.find-hit').length,
      editor: document.querySelectorAll('#editor-hl mark').length
    };
  })()`);
  check('关闭查找后标记全部清除', r4.preview === 0, JSON.stringify(r4));
  check('编辑器叠加层同时清空', r4.editor === 0, JSON.stringify(r4));

  /* 5. 再次查找（新关键字），标记正常 */
  const r5 = await js(`(async () => {
    document.getElementById('btn-find').click();
    const inp = document.getElementById('find-input');
    inp.value = '标题';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return {
      total: document.querySelectorAll('#preview mark.find-hit').length,
      text: [...document.querySelectorAll('#preview mark.find-hit')].map(m => m.textContent)
    };
  })()`);
  check('新关键字标记正常', r5.total === 1 && r5.text[0] === '标题', JSON.stringify(r5));

  /* 6. 换回完整文本输入框内容，普通正文无残留 mark */
  const r6 = await js(`(() => {
    document.getElementById('find-close').click();
    return { marks: document.querySelectorAll('#preview mark').length };
  })()`);
  check('正文中无任何 mark 残留', r6.marks === 0, JSON.stringify(r6));

  console.log('\n==== 预览查找高亮测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  app.exit(fail ? 1 : 0);
});
