/* 生成应用图标：渲染 SVG 风格图形 → PNG 多尺寸 → 打包为 .ico */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:512px;height:512px;background:transparent;overflow:hidden}
  .wrap{width:512px;height:512px;display:flex;align-items:center;justify-content:center}
  .box{width:452px;height:452px;border-radius:106px;position:relative;overflow:hidden;
    background:linear-gradient(145deg,#5B8CFF 0%,#6A5AF9 46%,#9B4DF7 100%);
    box-shadow:inset 0 -18px 44px rgba(10,10,60,.22), inset 0 16px 34px rgba(255,255,255,.24);
    display:flex;align-items:center;justify-content:center}
  .box::before{content:'';position:absolute;inset:0;
    background:radial-gradient(130% 95% at 16% 6%, rgba(255,255,255,.30), transparent 55%)}
  /* 四个字母排成紧凑 2×2：列宽取同列较宽者，字母在各自格子内居中 → 上下左右全部对齐 */
  .mark{display:grid;grid-template-columns:repeat(2, auto);column-gap:22px;row-gap:0;
    align-items:center;justify-items:center;position:relative;z-index:2;color:#fff;
    font-family:"Segoe UI","Microsoft YaHei",sans-serif;
    text-shadow:0 8px 26px rgba(18,18,72,.32)}
  .mark i{font-style:normal;font-weight:750;font-size:148px;line-height:1;display:block}
</style></head><body><div class="wrap"><div class="box">
  <div class="mark"><i>X</i><i>Y</i><i>M</i><i>D</i></div>
</div></div></body></html>`;

function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const entries = [];
  const datas = [];
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e[0] = p.size >= 256 ? 0 : p.size;
    e[1] = p.size >= 256 ? 0 : p.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.buf.length;
    entries.push(e);
    datas.push(p.buf);
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512, height: 512, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false }
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 900));

  const img = await win.webContents.capturePage();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((size) => ({
    size,
    buf: img.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }));

  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(outDir, 'icon.png'), img.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  console.log('icon written:', path.join(outDir, 'icon.ico'), fs.statSync(path.join(outDir, 'icon.ico')).size, 'bytes');
  app.exit(0);
});
