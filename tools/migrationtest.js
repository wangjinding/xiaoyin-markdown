/* 直接驱动真实 main.js：验证标签↔独立窗口双向迁移 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const main = require('../src/main.js');
let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('PASS ' + n); }
  else { fail++; console.log('FAIL ' + n + (extra ? '  → ' + extra : '')); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-'));
  const docs = ['A.md', 'B.md', 'C.md'].map((n) => {
    const p = path.join(tmp, n);
    fs.writeFileSync(p, '# ' + n + '\n\n内容 ' + n + '\n', 'utf8');
    return { path: p, name: n, text: '# ' + n + '\n\n内容 ' + n + '\n', eol: '\n' };
  });

  await wait(1200);
  let wins = BrowserWindow.getAllWindows();
  await wins[0].webContents.executeJavaScript(`localStorage.clear()`);
  await wins[0].webContents.reload();
  await wait(1200);
  check('启动后 1 个窗口', wins.length === 1, String(wins.length));

  // 在标签模式下打开 3 个文档
  for (const d of docs) {
    wins[0].webContents.send('cmd', 'file-opened', Object.assign({ ok: true }, d));
    await wait(300);
  }
  const tabCount = await wins[0].webContents.executeJavaScript(`document.querySelectorAll('#tabbar .tab').length`);
  check('标签模式有 3 个标签（欢迎 + A + B）', tabCount >= 3, String(tabCount));
  check('标题显示最后打开的文件', wins[0].getTitle().indexOf('C.md') >= 0, wins[0].getTitle());

  // 切到 A 标签，标题应跟着变（同步给主进程）
  await wins[0].webContents.executeJavaScript(`document.querySelectorAll('#tabbar .tab')[1].click()`);
  await wait(500);
  check('切换标签后标题变成 A.md', wins[0].getTitle().indexOf('A.md') >= 0, wins[0].getTitle());

  /* ---- 标签 → 独立窗口：应拆成多个窗口 ---- */
  await main.setOpenMode('windows');
  await wait(3200);
  wins = BrowserWindow.getAllWindows();
  check('切成独立窗口模式后拆成多个窗口', wins.length >= 3, String(wins.length));

  let allHidden = true;
  let foundDoc = false;
  for (const w of wins) {
    try {
      const info = await w.webContents.executeJavaScript(`({
        hidden: document.getElementById('tabbar').hidden,
        val: editor.value.slice(0, 30)
      })`);
      if (!info.hidden) allHidden = false;
      if (info.val.indexOf('内容') >= 0) foundDoc = true;
    } catch (_) { /* 已关闭 */ }
  }
  check('拆分后各窗口标签栏隐藏', allHidden === true);
  check('拆分后文档内容被带过去', foundDoc === true);
  check('主进程模式为 windows', main.getOpenMode() === 'windows');

  /* ---- 独立窗口 → 标签：应合并成一个窗口 ---- */
  await main.setOpenMode('tabs');
  await wait(3500);
  wins = BrowserWindow.getAllWindows();
  check('切成标签模式后合并为 1 个窗口', wins.length === 1, String(wins.length));

  if (wins.length === 1) {
    const merged = await wins[0].webContents.executeJavaScript(`(() => ({
      hidden: document.getElementById('tabbar').hidden,
      n: document.querySelectorAll('#tabbar .tab').length,
      names: [...document.querySelectorAll('#tabbar .tab-name')].map(e => e.textContent)
    }))()`);
    check('合并后标签栏可见', merged.hidden === false);
    check('合并后保留全部 4 个标签（含空白欢迎页）', merged.n === 4, JSON.stringify(merged.names));
    check('合并后标签名正确', ['A.md', 'B.md', 'C.md'].every((n) => merged.names.includes(n)), JSON.stringify(merged.names));
  }
  check('主进程模式为 tabs', main.getOpenMode() === 'tabs');

  /* ---- 保存必须直接覆盖原文件，而不是弹另存为 ---- */
  if (wins.length === 1) {
    const before = fs.readFileSync(docs[0].path, 'utf8');
    await wins[0].webContents.executeJavaScript(`(() => {
      // 确保激活的是 A.md 标签
      const idx = [...document.querySelectorAll('#tabbar .tab-name')].findIndex(e => e.textContent === 'A.md');
      if (idx >= 0) document.querySelectorAll('#tabbar .tab')[idx].click();
    })()`);
    await wait(500);
    await wins[0].webContents.executeJavaScript(`(() => {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      document.execCommand('insertText', false, '\\n保存覆盖验证标记');
    })()`);
    await wait(250);
    wins[0].webContents.send('cmd', 'save');
    await wait(900);
    const after = fs.readFileSync(docs[0].path, 'utf8');
    check('保存直接覆盖原文件（A.md 内容已更新）', after.indexOf('保存覆盖验证标记') >= 0, after.slice(-60));
    check('覆盖前原内容仍保留', before.indexOf('内容 A.md') >= 0);
    const title = wins[0].getTitle();
    check('保存后标题仍是 A.md', title.indexOf('A.md') >= 0, title);
  }

  console.log('\n==== 模式迁移测试：通过 ' + pass + '，失败 ' + fail + ' ====');
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});
