// 用真实界面截三张图：浅色分栏 / 深色分栏 / 查找高亮
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8901/index.html';
const OUT = '/tmp/shots/out';
fs.mkdirSync(OUT, { recursive: true });

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('没有 page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) console.error('  JS 错误:', JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r && r.result ? r.result.value : undefined;
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 2, mobile: false,
});

const shots = [
  { name: 'shot-split', q: '?theme=light&mode=split', after: null },
  { name: 'shot-dark', q: '?theme=dark&mode=split', after: null },
  { name: 'shot-read', q: '?theme=light&mode=read', after: null },
  {
    name: 'shot-find', q: '?theme=light&mode=split',
    after: `
      document.getElementById('btn-find').click();
      const fi = document.getElementById('find-input');
      fi.value = '安装包';
      fi.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('find-next').click();
    `,
  },
];

for (const s of shots) {
  await send('Page.navigate', { url: BASE + s.q });
  await sleep(1400);
  // 走真实代码路径打开文件（mock 的 api.open 返回样例文档）
  await evaluate("document.getElementById('btn-open').click()");
  await sleep(2800);
  if (s.after) { await evaluate(s.after); await sleep(600); }
  const dims = await evaluate("JSON.stringify({tabs: document.querySelectorAll('.tab').length, text: document.getElementById('editor').value.length, ol: document.getElementById('ol-body').children.length})");
  console.log(`  ${s.name} → ${dims}`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${s.name}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`    ✓ ${s.name}.png ${(fs.statSync(`${OUT}/${s.name}.png`).size / 1024).toFixed(0)}KB`);
}

ws.close();
