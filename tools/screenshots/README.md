# 官网截图生成

官网 `site/index.html` 里那几张「真实界面」图是这么来的：

用**仓库里真实的渲染层**（`src/renderer/{index.html,style.css,app.js,markdown.js}`）跑起来截图，
只把 Windows 侧的文件/剪贴板接口换成 `mock-api.js` 里的假数据 ——
界面、排版、渲染引擎全是线上那份代码，不是画的效果图。

## 步骤

```bash
# 1. 复制渲染层 + 挂上 mock
rm -rf /tmp/shots/app && mkdir -p /tmp/shots/app
cp src/renderer/* /tmp/shots/app/
# 在 index.html 里把 <script src="mock-api.js"> 插到 app.js 之前
cp tools/screenshots/mock-api.js /tmp/shots/app/

# 2. 起静态服务
cd /tmp/shots/app && python3 -m http.server 8901 &

# 3. 起无头 Chrome（开 CDP）
CH=$(ls ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | head -1)
$CH --headless=new --no-sandbox --hide-scrollbars --disable-gpu \
    --force-device-scale-factor=2 --remote-debugging-port=9222 \
    --window-size=1440,900 about:blank &

# 4. 截 4 张（浅色分栏 / 深色 / 查找高亮 / 阅读模式）
node tools/screenshots/take.mjs

# 5. 压成网页尺寸（1600 宽，JPEG q88）
python3 - <<'PY'
from PIL import Image; import os
for s, d in {'shot-split':'app-light','shot-dark':'app-dark',
             'shot-find':'app-find','shot-read':'app-read'}.items():
    im = Image.open(f'/tmp/shots/out/{s}.png').convert('RGB')
    w, h = im.size; tw = 1600
    im.resize((tw, round(h*tw/w)), Image.LANCZOS).save(
        f'site/img/{d}.jpg', 'JPEG', quality=88, optimize=True, progressive=True)
PY
```

> 截图里打开的是一篇样例「周报」文档，内容在 `mock-api.js` 的 `DOC` 常量里，改文案就改那里。
> 注意 `take.mjs` 里打开文件后要等 ~2.8 秒再截 —— 否则底部的「已打开」toast 会留在图上。
