/* 验证关闭窗口时主进程不抛异常 */
process.on('uncaughtException', (e) => {
  console.log('UNCAUGHT:', e.message);
  process.exit(2);
});

const { app, BrowserWindow } = require('electron');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
require('../src/main.js');
// 阻止 window-all-closed 自动退出，便于关闭后继续检查
app.removeAllListeners('window-all-closed');

let errors = [];
process.on('uncaughtException', (e) => errors.push(e.message));

app.whenReady().then(async () => {
  await wait(1400);
  const wins = BrowserWindow.getAllWindows();
  console.log('打开窗口数:', wins.length);

  // 连续开关多个窗口，覆盖正常关闭和迁移式关闭
  const w2 = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  w2.close();
  await wait(300);

  for (const w of wins) w.close();
  await wait(1000);

  if (errors.length) {
    console.log('FAIL 主进程异常:', errors.join(' | '));
    process.exit(1);
  }
  console.log('PASS 关闭窗口无主进程异常');
  process.exit(0);
});
