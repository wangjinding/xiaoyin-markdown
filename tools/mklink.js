const ws = require('windows-shortcuts');
const path = require('path');

// 用 USERPROFILE 而不是写死某个人的目录 —— 换机器/换用户名都能直接用。
const home = process.env.USERPROFILE || process.env.HOME;
const appDir = path.join(home, 'Apps', 'XiaoyinMarkdown');
const target = path.join(appDir, 'XiaoyinMarkdown.exe');
const workingDir = appDir;
const lnk = path.join(home, 'Desktop', '小银Markdown.lnk');

ws.create(
  lnk,
  { target, workingDir, icon: target, iconIndex: 0, desc: '小银 Markdown 编辑器', runStyle: 1 },
  (err) => {
    if (err) {
      console.log('ERR', err.message);
      process.exit(1);
    }
    ws.query(lnk, (e, d) => {
      console.log(e ? 'QUERY ERR ' + e.message : JSON.stringify(d, null, 2));
    });
  }
);
