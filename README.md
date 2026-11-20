# 小银 Markdown

一个纯本地的 Windows Markdown 编辑器。左边写、右边看，不联外网、不登录、不收集任何东西。

> 官网 / 下载：<https://md.wangjinding.com>

## 装在哪（示例）

- 程序：`%USERPROFILE%\Apps\XiaoyinMarkdown\XiaoyinMarkdown.exe`
- 桌面快捷方式：`小银Markdown`（双击即可）

## 功能

- **两种打开方式**：「标签」模式＝一个窗口内多标签切换；「独立窗口」模式＝每个文档一个窗口。点工具栏「标签 / 窗口」按钮即可切换，偏好会记住，重启后仍然生效
- **切换时自动迁移**：从独立窗口切到标签 → 所有窗口里的文档合并进一个窗口的多个标签；从标签切到独立窗口 → 每个标签拆成一个独立窗口。未保存的正文、滚动位置、光标位置都会跟着过去，不会丢失
- **右键打开**：文件树中右键「在新标签打开」或「在新窗口打开」——具体行为按当前记住的模式走；菜单「文件 → 在新窗口打开」快捷键 `Ctrl+Shift+N`
- **左侧文件目录**：列出当前文件夹里的 Markdown / 文本文件；**单击只选中，双击才打开**（文件夹也是双击展开），跟资源管理器的习惯一致；当前打开的文件高亮，会记住上次打开的文件夹
- **文件条目操作**：文件树里右键「复制文件」＝调用 Windows 原生复制（`Ctrl+C`），剪贴板里是**文件本身**，到资源管理器或微信等地方 `Ctrl+V` 能粘贴出文件副本；另有「复制文件内容」（正文文本）、「复制文件名」「复制完整路径」「在资源管理器中显示」
- 实现说明：Electron 45 的 clipboard API 没有写文件的能力，所以通过 `koffi` 直接调用 Win32 `SetClipboardData(CF_HDROP)`，效果等同于在资源管理器里选中文件按 `Ctrl+C`
- **右侧章节大纲**：按 `#` 标题自动生成章节树，点一条跳到对应位置；随编辑实时更新，滚动时自动高亮当前章节
- **两个开关标识**：「目录」紧挨在「编辑 / 分栏 / 阅读」切换按钮之前，「大纲」在它的右侧；样式统一，亮＝展开、灭＝收起，关掉随时能再打开，状态会记住
- **面板宽度可拖拽**：目录右缘、大纲左缘各有一条分隔条，拖动即可调整宽度（有最小宽度限制）；宽度自动记住，重启后保持
- **查找**：`Ctrl+F` 查找条，`Enter`/`Shift+Enter` 上下切换；**右侧预览正文里所有命中都会加黄色背景标记**，当前命中橙色并自动滚到可视区，编辑内容变化时标记实时恢复，关闭查找自动清除
- **实时预览**：编辑 / 分栏 / 阅读三种模式，分栏宽度可拖动
- **拖进来就打开**：把 `.md` 文件拖进窗口直接打开；把**文件夹**拖进来，左侧列出该目录
- **右键菜单**：复制全文、打开当前文件所在文件夹、剪切 / 复制 / 粘贴 / 全选 / 撤销 / 重做
- **文件操作**：新建、打开、保存、另存为、打开文件夹，关窗时会提示未保存
- **查找**：带匹配计数和上下跳转
- **深色 / 浅色**主题，字号缩放
- **渲染支持**：标题、粗体斜体删除线、行内代码、代码块、引用、有序无序与嵌套列表、任务列表、表格（含对齐）、分割线、链接、图片
- 状态栏显示字数、字符数、光标行列；保留原文件的换行符（CRLF / LF）
- 渲染前会转义 HTML，预览里的链接用系统默认浏览器打开

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建 / 打开 | `Ctrl+N` / `Ctrl+O` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` |
| 剪切 / 复制 / 粘贴 / 全选 | `Ctrl+X` / `C` / `V` / `A` |
| 查找 | `Ctrl+F` |
| 复制全文 | `Ctrl+Shift+C` |
| 打开文件夹 | `Ctrl+Shift+K` |
| 在新窗口打开当前文档 | `Ctrl+Shift+N` |
| 显示 / 隐藏文件目录 | `Ctrl+Shift+B` |
| 显示 / 隐藏章节大纲 | `Ctrl+Shift+T` |
| 复制文件树中选中项（文件本身） | `Ctrl+C`（焦点在条目上） |
| 在资源管理器中显示当前文件 | `Ctrl+Shift+O` |
| 编辑 / 分栏 / 阅读 | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| 深色浅色切换 | `Ctrl+Shift+L` |
| 放大 / 缩小 / 还原 | `Ctrl+Shift+=` / `Ctrl+Shift+-` / `Ctrl+0` |
| 全屏 / 开发者工具 | `F11` / `F12` |

编辑区里还有两个顺手的细节：`Tab` 插入缩进；在列表项末尾按回车会自动续上下一条标记。

## 自己改代码

源码在本目录。目录结构：

```
md-editor/
├─ src/
│  ├─ main.js            主进程：窗口、菜单快捷键、文件读写、对话框
│  ├─ preload.js         安全桥接（contextIsolation 开启）
│  └─ renderer/
│     ├─ index.html      界面结构
│     ├─ style.css       样式与两套主题
│     ├─ markdown.js     自写的 Markdown 渲染引擎（零依赖）
│     └─ app.js          交互逻辑
├─ tools/                自测与打包辅助脚本（不参与发布）
└─ build/icon.ico        应用图标
```

开发调试：

```bash
npm start
```

跑一遍功能自测（31 项，覆盖渲染用例、打开保存、撤销粘贴、查找、模式切换、文件树展开与打开）：

```bash
npx electron tools/test.js
```

单独验证真实拖放链路（用 CDP 注入系统级拖放事件，确认能取到路径并打开文件/文件夹）：

```bash
npx electron tools/dragtest.js
```

验证侧栏启动行为与记忆恢复（记住文件夹、收起状态持久化）：

```bash
npx electron tools/sidetest.js
```

验证章节目录（生成、开关、跳转定位、实时更新、状态记忆）：

```bash
npx electron tools/outlinetest.js
```

验证文件树复制（右键复制文件名/路径/内容、Ctrl+C、按钮位置）：

```bash
npx electron tools/copytest.js
```

验证标签页、独立窗口偏好、右键打开方式（21 项）：

```bash
npx electron tools/multitest.js
```

验证真实主进程能否创建多个独立窗口：

```bash
node tools/wintest.js
```

验证模式切换时的双向迁移（多窗口合并成标签、标签拆成多窗口，11 项）：

```bash
npx electron tools/migrationtest.js
```

验证关闭窗口时主进程不抛异常：

```bash
npx electron tools/closetest.js
```

验证目录/大纲宽度拖拽与记忆（14 项）：

```bash
npx electron tools/paneltest.js
```

重新打包 exe：

```bash
npx electron-packager . XiaoyinMarkdown --platform=win32 --arch=x64 --out=dist ^
  --overwrite --asar --icon=build/icon.ico --ignore="^/dist" --ignore="^/tools" --ignore="^/build"
```

打包完成后把 `dist\XiaoyinMarkdown-win32-x64` 整个目录拷到 `%USERPROFILE%\Apps\XiaoyinMarkdown` 覆盖即可（exe 依赖同目录的 dll，不能只拷 exe）。

## 三端支持（Windows / macOS / Linux）

| 平台 | 产物 | 状态 |
| --- | --- | --- |
| Windows 10/11 x64 | `xymd_<版本>.exe`（NSIS 安装包）| ✅ 已发布 |
| Linux x86_64 | `xymd_<版本>_amd64.AppImage` / `.deb` | ✅ 已发布 |
| macOS 11+ | `xymd_<版本>_aarch64.dmg` / `_x64.dmg` | ⏳ 需在 macOS 上构建（见下）|

### 平台差异

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 「复制文件本身」到剪贴板 | ✅ Win32 CF_HDROP | ⚠️ 退化为复制路径文本 | ⚠️ 退化为复制路径文本 |
| 在文件管理器中显示 | 资源管理器并选中 | `open -R` | `xdg-open` 打开所在目录 |
| 打开外部链接 | `explorer` | `open` | `xdg-open` |
| 文本剪贴板 | `clipboard-win` | `arboard` | `arboard` |
| 在线升级 | ✅ | ✅（需签名）| ✅（仅 AppImage 形态）|

macOS / Linux 的剪贴板没有跨平台的「文件」格式（要写 NSPasteboard / GTK 私有 target），
所以这两个平台上「复制文件」会退化成把**路径文本**放进剪贴板。

### 本机构建（Linux / Windows 交叉）

```bash
# Linux 原生（需要 webkit2gtk-4.1 等系统库）
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev
npx tauri build --bundles deb,appimage

# Windows（在 Linux 上交叉编译）
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
```

### macOS

macOS 的包**必须**在 macOS 上构建（需要 Xcode 的命令行工具链，Linux 无法交叉编译）：
仓库里的 `.github/workflows/build.yml` 会同时在 `macos-latest`（Apple Silicon + Intel）、
`ubuntu-22.04`、`windows-latest` 三个 runner 上出包，产物在 Actions 的 Artifacts 里。

需要在仓库 Secrets 里配：
- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` —— 升级签名私钥
- `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` —— 苹果开发者证书（可选）
- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` —— 公证用（可选）

没有苹果开发者证书时产物是**未签名**的，用户首次打开需要「右键 → 打开」，
或在终端执行 `xattr -dr com.apple.quarantine /Applications/XiaoyinMarkdown.app`。

### 发布

```bash
python3 tools/release/publish.py --notes-file notes.txt
```

会自动扫描 `src-tauri/target` 下**存在的**产物（Windows / Linux / macOS 各归各位），
拷到官网 `download/`，并把对应平台写进 `update/latest.json`（**合并**语义：
在 Windows 上发版不会把 macOS 那条冲掉）。

## 用 Tauri 打包（推荐的安装包）

Tauri 版走系统 WebView2，**不用捆绑运行时**，安装包比 Electron 版小一个数量级。
在 Linux 上也能交叉编译出 Windows 安装包：

```bash
# 一次性准备
apt-get install -y mingw-w64 nsis
curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal   # 国内可设 RUSTUP_DIST_SERVER 用清华镜像
rustup target add x86_64-pc-windows-gnu
mkdir -p ~/.cargo && cat >> ~/.cargo/config.toml <<'EOF'
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
ar = "x86_64-w64-mingw32-ar"
EOF

# 打包
npm install
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
# → src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/XiaoyinMarkdown_<版本>_x64-setup.exe
```

### 装完 .md 默认用小银 Markdown 打开

两步配合，缺一不可：

1. `tauri.conf.json` 的 `bundle.fileAssociations` → 写 `HKCU\Software\Classes\.md` = `XiaoyinMarkdown.Document`
   （含 markdown / mdown / mkd / mdwn / txt）
2. `src-tauri/installer-hooks.nsh`（NSIS `NSIS_HOOK_POSTINSTALL`）→ 删掉
   `HKCU\...\Explorer\FileExts\.md\UserChoice`。这个键带哈希保护、**只能删不能写**，
   删掉后系统才回落到第 1 步写的关联，否则用户原来的默认程序会一直赢。

首次双击 .md 时是冷启动，文件路径由 Rust 的 `on_page_load` 读 `argv` 发给前端
（`main.rs` 里的 `STARTUP_FILE_SENT`）；程序已在运行时再双击，走 single-instance 回调。

## 说明

- 未做代码签名，首次运行 Windows SmartScreen 可能提示"未知发布者"，选"仍要运行"即可。
- 程序只读写你主动打开或保存的文件，不联网（预览里的链接除外，会交给系统浏览器）。
