/* 用远程调试端口驱动真实 app，验证主进程确实能开出多个独立窗口 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const port = 9333;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const target = path.join(root, 'README.md');

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  const child = spawn(electron, ['--remote-debugging-port=' + port, '.'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); });

  let ok = false;
  try {
    await wait(3500);
    const before = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const pagesBefore = before.filter((p) => p.type === 'page');
    console.log('窗口数（启动后）:', pagesBefore.length);

    if (pagesBefore.length) {
      const page = pagesBefore[0];
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: `api.openNewWindow(${JSON.stringify(target)})`, awaitPromise: true }
      }));
      await wait(400);
      ws.close();
    }

    await wait(2500);
    const after = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const pagesAfter = after.filter((p) => p.type === 'page');
    console.log('窗口数（新窗口打开后）:', pagesAfter.length);
    console.log('新窗口标题:', pagesAfter.map((p) => p.title).join(' | '));
    ok = pagesAfter.length > pagesBefore.length;
    console.log(ok ? 'PASS 主进程成功创建独立窗口' : 'FAIL 没有创建新窗口');
  } catch (e) {
    console.log('ERR:', e.message);
    if (err) console.log('APP STDERR:', err.slice(0, 500));
  } finally {
    try { child.kill(); } catch (_) {}
    setTimeout(() => process.exit(ok ? 0 : 1), 300);
  }
})();
