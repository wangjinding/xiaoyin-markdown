/* 截图专用 mock：把 Windows 侧的文件/剪贴板接口换成假数据，
   界面部分（index.html / style.css / app.js / markdown.js）全是仓库里的真实代码。 */
(function () {
  const q = new URLSearchParams(location.search);
  const theme = q.get('theme') || 'light';
  const mode = q.get('mode') || 'split';

  // app.js 自己用的状态键，预先写好，避免出现欢迎页
  localStorage.setItem('md-editor-theme', theme);
  localStorage.setItem('md-editor-mode', mode);
  localStorage.setItem('md-editor-outline', '1');
  localStorage.setItem('md-editor-sb', '0');           // 侧栏展开
  localStorage.setItem('md-editor-dir', 'D:\\notes');
  localStorage.setItem('md-editor-welcome-closed', '1');

  const DOC = `# 周报 · 2026 第 47 周

本周主要在收尾 **小银 Markdown** 的在线升级，顺手把官网也改了一版。

## 这周做了什么

- 新增在线升级：状态栏右下角点「检查更新」就能装新版
- 安装包换成 Tauri，不再捆绑运行时
- 官网换成真实界面截图，配色参照 UU 远程
- 修掉 \`Ctrl+F\` 在长文档里的滚动抖动

## 待办

- [x] 交叉编译出 Windows 安装包
- [x] 装完 .md 默认用它打开
- [x] 在线升级跑通签名校验
- [ ] 补一段更新日志
- [ ] 录个 30 秒的演示视频

## 关键代码

\`\`\`js
// 检查 → 下载 → 覆盖安装 → 重启
const st = await invoke('check_update')
if (st.available) await invoke('install_update')
\`\`\`

## 常用快捷键

| 操作 | 快捷键 |
| --- | --- |
| 查找 | Ctrl + F |
| 保存 | Ctrl + S |
| 深色 / 浅色 | Ctrl + Shift + L |

> 下周把 README 补一节「用 Tauri 打包」，再录个演示视频。
`;

  const TREE = [
    { name: '项目', path: 'D:\\notes\\项目', isDir: true },
    { name: '日记', path: 'D:\\notes\\日记', isDir: true },
    { name: '周报-2026-11-19.md', path: 'D:\\notes\\周报-2026-11-19.md', isDir: false },
    { name: '读书笔记.md', path: 'D:\\notes\\读书笔记.md', isDir: false },
    { name: '待办.txt', path: 'D:\\notes\\待办.txt', isDir: false },
  ];

  const DOC_PATH = 'D:\\notes\\周报-2026-11-19.md';
  const ok = (o) => Object.assign({ ok: true }, o || {});
  const opened = () => ok({ path: DOC_PATH, name: '周报-2026-11-19.md', text: DOC, eol: '\n' });

  window.api = {
    // ——— 文件 ———
    open: async () => opened(),
    openPath: async () => opened(),
    readFileText: async () => ok({ text: DOC, eol: '\n' }),
    save: async () => ok({ path: DOC_PATH, name: '周报-2026-11-19.md' }),
    dirOpen: async () => ok({ path: 'D:\\notes', name: 'notes', entries: TREE }),
    dirRead: async (p) => ok({ path: p || 'D:\\notes', name: (p || '').split('\\').pop() || 'notes', entries: TREE }),

    // ——— 窗口/标签 ———
    getOpenMode: async () => ({ mode: 'tabs' }),
    setOpenMode: async () => ok(),
    newWindow: async () => ok(),
    openNewWindow: async () => ok(),
    closeWindow: async () => ok(),
    syncDoc: async () => ok(),
    setDirty: () => {},

    // ——— 提示/对话框 ———
    message: async () => 0,
    reveal: async () => ok(),
    revealPath: async () => ok(),
    openExternal: async () => ok(),

    // ——— 剪贴板 ———
    copyFile: async () => ok(),
    readClipboard: async () => '',
    writeClipboard: async () => ok(),

    // ——— 事件订阅（真实主进程里由 IPC 推来）———
    onCommand: () => {},
    onCloseConfirm: () => {},
    onExport: () => {},
    saveFinished: () => {},
    exportDocs: async () => ok(),
  };
})();
