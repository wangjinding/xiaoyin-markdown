/* 自测脚本：跑真实渲染进程逻辑，验证打开/编辑/保存/撤销/渲染/查找 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''));
}

app.whenReady().then(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdtest-'));
  const tmpFile = path.join(tmpDir, '测试文档.md');
  const sample = '# 标题一\n\n**粗体** 正文\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] 完成\n';
  fs.writeFileSync(tmpFile, sample, 'utf8');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'sub', 'c.md'), '# 子文件\n\n内容\n', 'utf8');
  fs.writeFileSync(path.join(tmpDir, '其他.txt'), 'hello\n', 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'pic.png'), 'not markdown\n', 'utf8');

  // 模拟主进程的保存 handler
  ipcMain.handle('file:save', async (_e, p) => {
    let target = p.__target || tmpFile;
    await fs.promises.writeFile(target, p.content, 'utf8');
    return { ok: true, path: target, name: path.basename(target) };
  });
  ipcMain.handle('file:openPath', async (_e, p) => {
    const text = fs.readFileSync(p, 'utf8');
    return { ok: true, path: p, name: path.basename(p), text, eol: '\n' };
  });
  ipcMain.handle('clip:read', () => 'PASTED');
  ipcMain.handle('clip:write', () => true);
  ipcMain.handle('file:reveal', () => ({ ok: true }));
  ipcMain.handle('ui:message', () => 0);
  ipcMain.handle('shell:openExternal', () => true);

  // 目录读取（与 main.js 的 listDir 保持同样的过滤规则）
  const MD_RE = /\.(md|markdown|mdown|mkd|mdwn|txt)$/i;
  const listDir = (dir) => {
    const entries = [];
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const full = path.join(dir, d.name);
      const isDir = d.isDirectory();
      if (!isDir && !MD_RE.test(d.name)) continue;
      entries.push({ name: d.name, path: full, isDir });
    }
    entries.sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return entries;
  };
  ipcMain.handle('dir:open', async () => ({ ok: false, canceled: true }));
  ipcMain.handle('dir:read', async (_e, p) => ({ ok: true, path: p, name: path.basename(p), entries: listDir(p) }));
  ipcMain.on('app:setDirty', () => {});
  ipcMain.on('win:setTitle', () => {});
  ipcMain.on('save:finished', () => {});

  const win = new BrowserWindow({
    width: 1300, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(`localStorage.clear()`);
  await win.webContents.reload();
  await new Promise((r) => setTimeout(r, 900));
  const js = (code) => win.webContents.executeJavaScript(code);

  /* 1. 初始状态 */
  const init = await js(`({ val: editor.value.length, h1: !!preview.querySelector('h1'), table: !!preview.querySelector('table'), dirty: !document.getElementById('st-dirty').hidden })`);
  check('初始渲染：有 h1 与表格', init.h1 && init.table, JSON.stringify(init));
  check('初始不标记未保存', init.dirty === false);

  /* 2. 打开文件（走真实 cmd 通道） */
  win.webContents.send('cmd', 'file-opened', { ok: true, path: tmpFile, name: '测试文档.md', text: sample, eol: '\n' });
  await new Promise((r) => setTimeout(r, 400));
  const opened = await js(`({ v: editor.value === ${JSON.stringify(sample)}, name: document.getElementById('st-file').textContent, dirty: !document.getElementById('st-dirty').hidden })`);
  check('打开文件后编辑区内容正确', opened.v);
  check('状态栏文件名更新', opened.name === '测试文档.md', opened.name);
  check('打开后为已保存状态', opened.dirty === false);

  /* 3. 编辑 → dirty */
  await js(`(() => {
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    document.execCommand('insertText', false, '\\n\\n新增一行 **内容**');
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  const edited = await js(`({ dirty: !document.getElementById('st-dirty').hidden, hasNew: editor.value.includes('新增一行'), bold: !!preview.querySelector('strong') })`);
  check('输入后标记未保存', edited.dirty === true);
  check('插入文本成功', edited.hasNew === true);
  check('预览同步出现粗体', edited.bold === true);

  /* 4. 保存 */
  await js(`document.getElementById('btn-save').click()`);
  await new Promise((r) => setTimeout(r, 600));
  const saved = fs.readFileSync(tmpFile, 'utf8');
  const afterSave = await js(`!document.getElementById('st-dirty').hidden`);
  check('保存后磁盘内容已更新', saved.includes('新增一行'), saved.length + ' bytes');
  check('保存后清除未保存标记', afterSave === false);

  /* 5. 撤销 / 重做 */
  const undo = await js(`(() => {
    const before = editor.value;
    editor.focus();
    const ok1 = document.execCommand('undo');
    const afterUndo = editor.value;
    const ok2 = document.execCommand('redo');
    return { ok1, ok2, changed: afterUndo !== before, restored: editor.value === before };
  })()`);
  check('撤销生效（内容发生变化）', undo.changed === true, JSON.stringify(undo));
  check('重做恢复内容', undo.restored === true);

  /* 6. 粘贴（读剪贴板 → insertText） */
  const paste = await js(`(async () => {
    editor.focus();
    editor.setSelectionRange(0, 0);
    const t = await api.readClipboard();
    document.execCommand('insertText', false, t);
    return editor.value.startsWith('PASTED');
  })()`);
  check('粘贴插入到光标处', paste === true);

  /* 7. 复制全文 */
  const copyAll = await js(`(async () => {
    await document.getElementById('btn-copyall').click();
    await new Promise(r => setTimeout(r, 100));
    return document.getElementById('toast').textContent;
  })()`);
  check('复制全文有提示反馈', /已复制全文/.test(copyAll), copyAll);

  /* 8. 查找 */
  const find = await js(`(async () => {
    document.getElementById('btn-find').click();
    const inp = document.getElementById('find-input');
    inp.value = '标题';
    inp.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 100));
    return { count: document.getElementById('find-count').textContent, sel: editor.selectionStart, selEnd: editor.selectionEnd };
  })()`);
  check('查找定位并显示计数', find.selEnd > find.sel, JSON.stringify(find));

  /* 9. 模式切换 */
  const modes = await js(`(() => {
    const ws = document.getElementById('workspace');
    document.querySelector('#mode-seg button[data-mode="read"]').click();
    const a = ws.dataset.mode;
    document.querySelector('#mode-seg button[data-mode="split"]').click();
    return { a, b: ws.dataset.mode };
  })()`);
  check('模式切换正常', modes.a === 'read' && modes.b === 'split', JSON.stringify(modes));

  /* 10. 文件夹树 */
  win.webContents.send('cmd', 'dir-opened', { ok: true, path: tmpDir, name: path.basename(tmpDir), entries: listDir(tmpDir) });
  await new Promise((r) => setTimeout(r, 400));
  const tree = await js(`(() => {
    const rows = [...document.querySelectorAll('#sb-body .tree-row')];
    return {
      visible: !document.getElementById('sidebar').hidden,
      names: rows.map(r => r.querySelector('.tree-name').textContent),
      dirs: rows.filter(r => r.classList.contains('is-dir')).length,
      pngFiltered: !rows.some(r => r.querySelector('.tree-name').textContent.includes('pic.png'))
    };
  })()`);
  check('拖入文件夹后侧栏显示', tree.visible === true);
  check('文件树列出文件与子目录', tree.names.includes('测试文档.md') && tree.names.includes('sub') && tree.dirs === 1, JSON.stringify(tree.names));
  check('非 Markdown 文件被过滤', tree.pngFiltered === true);

  /* 11. 展开子目录 */
  await js(`(() => {
    const r = [...document.querySelectorAll('.tree-row.is-dir')].find(x => x.dataset.path.endsWith('sub'));
    if (r) r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  const sub = await js(`(() => {
    const rows = [...document.querySelectorAll('#sb-body .tree-row')];
    return { hasC: rows.some(r => r.dataset.path.endsWith('c.md')) };
  })()`);
  check('双击子目录可展开', sub.hasC === true, JSON.stringify(sub));

  /* 12. 单击不切换，双击才打开文件 */
  const beforeSingle = await js(`editor.value`);
  const single = await js(`(() => {
    const r = [...document.querySelectorAll('#sb-body .tree-row')].find(x => x.dataset.path.endsWith('c.md'));
    if (!r) return false;
    r.click();
    return document.activeElement === r;
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  const afterSingle = await js(`editor.value`);
  check('单击文件只选中不切换文档', single === true && afterSingle === beforeSingle, JSON.stringify(single));

  await js(`(() => {
    const r = [...document.querySelectorAll('#sb-body .tree-row')].find(x => x.dataset.path.endsWith('c.md'));
    if (r) r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  const byTree = await js(`(() => {
    const act = document.querySelector('#sb-body .tree-row.active');
    return { v: editor.value.indexOf('子文件') >= 0, name: document.getElementById('st-file').textContent, active: act ? act.dataset.path : '' };
  })()`);
  check('双击文件树打开文件', byTree.v === true, byTree.name);
  check('树中高亮当前文件', String(byTree.active).endsWith('c.md'), byTree.active);

  /* 13. 收起侧栏 */
  const collapsed = await js(`(() => {
    document.getElementById('sb-close').click();
    const hidden1 = document.getElementById('sidebar').hidden;
    document.getElementById('btn-tree').click();
    return { hidden1, hidden2: document.getElementById('sidebar').hidden };
  })()`);
  check('侧栏可收起再展开', collapsed.hidden1 === true && collapsed.hidden2 === false, JSON.stringify(collapsed));

  /* 10. 渲染引擎边界用例 */
  const r = await js(`(() => {
    const cases = {
      code: MD.render('\\u0060\\u0060\\u0060py\\nprint(1)\\n\\u0060\\u0060\\u0060'),
      nested: MD.render('- a\\n  - b\\n    - c'),
      quote: MD.render('> 引用\\n> 第二行'),
      hr: MD.render('---'),
      xss: MD.render('<script>alert(1)</script>'),
      tableAlign: MD.render('|a|b|\\n|:--|--:|\\n|1|2|'),
      task: MD.render('- [x] done'),
      escape: MD.render('a & b < c')
    };
    return {
      code: cases.code.includes('print(1)') && cases.code.includes('<pre>'),
      nested: (cases.nested.match(/<ul>/g) || []).length === 3 && cases.nested.includes('<li>c</li>'),
      quote: cases.quote.includes('<blockquote>'),
      hr: cases.hr.includes('<hr>'),
      xss: !cases.xss.includes('<script>') && cases.xss.includes('&lt;script&gt;'),
      tableAlign: cases.tableAlign.includes('text-align:left'),
      task: cases.task.includes('type="checkbox"') && cases.task.includes('checked'),
      escape: cases.escape.includes('a &amp; b &lt; c')
    };
  })()`);
  Object.keys(r).forEach((k) => check('渲染用例 ' + k, r[k]));

  const failed = results.filter((x) => !x.ok);
  console.log('\n==== 共 ' + results.length + ' 项，失败 ' + failed.length + ' 项 ====');
  if (failed.length) console.log(failed.map((f) => f.name).join(', '));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  app.exit(failed.length ? 1 : 0);
});
