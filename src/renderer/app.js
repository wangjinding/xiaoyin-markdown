/* 小银 Markdown 编辑器 —— 渲染进程逻辑 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const preview = $('preview');
  const workspace = $('workspace');
  const editorPane = $('editor-pane');
  const previewPane = $('preview-pane');
  const splitter = $('splitter');
  const ctxMenu = $('ctxmenu');
  const toastEl = $('toast');
  const findbar = $('findbar');
  const findInput = $('find-input');
  const findCount = $('find-count');
  const dropHint = $('drop-hint');
  const sidebar = $('sidebar');
  const sbBody = $('sb-body');
  const sbTitle = $('sb-title');
  const editorHl = $('editor-hl');

  const tabbar = $('tabbar');

  const state = {
    path: null,
    name: null,
    dirty: false,
    eol: '\n',
    mode: 'split',
    theme: 'light',
    lastSaved: '',
    dir: null,
    openMode: 'tabs',          // tabs = 标签页；windows = 独立窗口
    tabs: [],
    activeKey: null
  };

  /* ---------------- 欢迎示例 ---------------- */
  const WELCOME = `# 欢迎使用 小银 Markdown

一个纯本地的 Windows Markdown 编辑器：左边写，右边看，随手存档。

## 常用按键

| 操作 | 快捷键 |
| --- | --- |
| 新建 / 打开 | Ctrl + N / Ctrl + O |
| 保存 / 另存为 | Ctrl + S / Ctrl + Shift + S |
| 撤销 / 重做 | Ctrl + Z / Ctrl + Y |
| 剪切 / 复制 / 粘贴 | Ctrl + X / C / V |
| 查找 | Ctrl + F |
| 复制全文 | Ctrl + Shift + C |
| 切模式 | Ctrl + 1 / 2 / 3 |
| 深色 / 浅色 | Ctrl + Shift + L |

## 右键能干的事

在编辑区划右键可以**复制全文**、**打开当前文件所在文件夹**，还有剪切、复制、粘贴、全选。

## 语法示例

**加粗**、*斜体*、~~删除线~~、\`行内代码\`，还有 [链接](https://www.electronjs.org)。

> 引用一段话：写作是把想清楚的事情，写下来再想一遍。

- 无序列表
  - 支持嵌套
    - 也可以再深一层
- 第二项

1. 有序列表
2. 第二项
3. 第三项

- [x] 已完成的待办
- [ ] 待办事项

\`\`\`js
function hello(name) {
  return \`你好，\${name}\`;
}
\`\`\`

---

把 .md 文件拖进窗口可以直接打开；把**整个文件夹**拖进来，左边会列成文件树，点哪个读哪个。

开始写吧。

> 这个欢迎页关掉之后，下次启动就不会再出现了。
`;

  /* ---------------- 工具 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 200);
    }, 1600);
  }

  function setDirty(d) {
    if (state.dirty === d) return;
    state.dirty = d;
    $('st-dirty').hidden = !d;
    api.setDirty(d);
    const t = currentTab();
    if (t) t.dirty = d;
    renderTabs();
  }

  /* ---------------- 多标签管理 ---------------- */
  function currentTab() {
    return state.tabs.find((t) => t.key === state.activeKey) || null;
  }

  function makeTab(doc) {
    const text = doc.text || '';
    const t = {
      key: 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      path: doc.path || null,
      name: doc.name || null,
      text,
      eol: doc.eol || '\n',
      dirty: false,
      lastSaved: text,
      editorScroll: 0,
      previewScroll: 0,
      cursor: 0
    };
    if (doc.isWelcome) t.isWelcome = true;
    return t;
  }

  function captureTab() {
    const t = currentTab();
    if (!t) return;
    t.text = editor.value;
    t.eol = state.eol;
    t.dirty = state.dirty;
    t.lastSaved = state.lastSaved;
    t.editorScroll = editor.scrollTop;
    t.previewScroll = preview.scrollTop;
    t.cursor = editor.selectionStart;
  }

  function restoreTab(t) {
    captureTab();
    activateTab(t);
  }

  function tabFromDoc(d) {
    const t = makeTab(d);
    t.path = d.path || null;
    t.name = d.name || null;
    t.eol = d.eol || '\n';
    t.dirty = !!d.dirty;
    t.lastSaved = d.lastSaved != null ? d.lastSaved : (d.text || '');
    t.editorScroll = d.editorScroll || 0;
    t.previewScroll = d.previewScroll || 0;
    t.cursor = d.cursor || 0;
    return t;
  }

  /* 装载一个标签（不保存当前内容，供模式迁移使用） */
  function activateTab(t) {
    state.activeKey = t.key;
    state.path = t.path;
    state.name = t.name;
    setEditorText(t.text, t.eol);
    state.lastSaved = t.lastSaved;
    setDirty(t.dirty);
    updateFileLabel();
    try { api.syncDoc(t.path); } catch (_) {}
    requestAnimationFrame(() => {
      editor.scrollTop = t.editorScroll || 0;
      preview.scrollTop = t.previewScroll || 0;
      const pos = Math.min(t.cursor || 0, editor.value.length);
      editor.setSelectionRange(pos, pos);
      updateCursor();
    });
    renderTabs();
    highlightTree();
  }

  function openTab(doc) {
    if (state.openMode !== 'tabs') return false;
    captureTab();
    if (doc.path) {
      const exist = state.tabs.find((t) => t.path === doc.path);
      if (exist) { restoreTab(exist); return true; }
    }
    const tab = makeTab(doc);
    // 空白占位标签（无路径、无修改、无内容）直接被第一个打开的文档顶替
    const blank = state.tabs.find((t) => !t.path && !t.dirty && (t.text || '') === '' && !t.isWelcome);
    const i = state.tabs.indexOf(blank);
    if (i >= 0) state.tabs.splice(i, 1, tab);
    else state.tabs.push(tab);
    restoreTab(tab);
    return true;
  }

  function renderTabs() {
    tabbar.hidden = state.openMode !== 'tabs';
    if (tabbar.hidden) return;
    tabbar.innerHTML = '';
    for (const t of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.key === state.activeKey ? ' active' : '') + (t.dirty ? ' dirty' : '');
      el.dataset.key = t.key;
      el.title = t.path || (t.name || '未命名');

      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      el.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = t.name || '未命名';
      el.appendChild(name);

      const close = document.createElement('span');
      close.className = 'tab-close';
      close.dataset.close = t.key;
      close.title = '关闭标签';
      close.innerHTML = '<svg viewBox="0 0 16 16"><path d="M3.4 2.6L8 7.2l4.6-4.6 1.1 1.1L9.1 8.3l4.6 4.6-1.1 1.1L8 9.4l-4.6 4.6-1.1-1.1 4.6-4.6-4.6-4.6z"/></svg>';
      el.appendChild(close);

      tabbar.appendChild(el);
    }
  }

  async function closeTab(key) {
    const idx = state.tabs.findIndex((t) => t.key === key);
    if (idx < 0) return;
    const t = state.tabs[idx];
    if (t.isWelcome) {
      // 用户主动关掉欢迎页后，以后启动不再显示
      try { localStorage.setItem('md-editor-welcome-closed', '1'); } catch (_) {}
    }
    if (t.dirty) {
      const r = await api.message({
        type: 'question',
        message: '「' + (t.name || '未命名') + '」尚未保存',
        detail: '关闭标签会丢失这些修改，是否继续？',
        buttons: ['关闭', '取消']
      });
      if (r !== 0) return;
    }
    if (state.activeKey === key) {
      captureTab();
      state.tabs.splice(idx, 1);
      if (state.tabs.length) {
        restoreTab(state.tabs[Math.max(0, idx - 1)]);
      } else {
        const fresh = makeTab({ text: '', eol: '\n', name: null, path: null });
        state.tabs.push(fresh);
        restoreTab(fresh);
      }
    } else {
      state.tabs.splice(idx, 1);
      renderTabs();
    }
  }

  tabbar.addEventListener('click', (e) => {
    const close = e.target.closest('.tab-close');
    if (close) { e.stopPropagation(); closeTab(close.dataset.close); return; }
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.key !== state.activeKey) {
      restoreTab(state.tabs.find((t) => t.key === tab.dataset.key));
    }
  });

  /* 打开方式：tabs / windows */
  async function setOpenMode(mode, fromMain) {
    if (mode !== 'tabs' && mode !== 'windows') return;
    state.openMode = mode;
    try { localStorage.setItem('md-editor-open-mode', mode); } catch (_) {}
    $('openmode-label').textContent = mode === 'tabs' ? '标签' : '窗口';
    $('btn-openmode').title = mode === 'tabs'
      ? '当前：标签页模式（点此改为独立窗口）'
      : '当前：独立窗口模式（点此改为标签页）';
    renderTabs();
    if (!fromMain) {
      try { await api.setOpenMode(mode); } catch (_) {}
    }
  }

  function updateFileLabel() {
    $('st-file').textContent = state.name || '未命名';
    $('st-file').title = state.path || '尚未保存到磁盘';
  }

  function setEditorText(text, eol) {
    editor.value = text;
    state.eol = eol || '\n';
    state.lastSaved = text;
    renderNow();
    updateCursor();
    scrollToTop();
  }

  function scrollToTop() {
    syncLock = true;
    editor.scrollTop = 0;
    preview.scrollTop = 0;
    requestAnimationFrame(() => {
      editor.scrollTop = 0;
      preview.scrollTop = 0;
      requestAnimationFrame(() => { syncLock = false; });
    });
  }

  /* ---------------- 渲染 ---------------- */
  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderNow, 80);
  }

  function renderNow() {
    const text = editor.value;
    const started = performance.now();
    try {
      preview.innerHTML = MD.render(text);
    } catch (err) {
      preview.innerHTML = '<p style="color:#d14343">渲染出错：' + MD.escapeHtml(String(err)) + '</p>';
    }
    if (performance.now() - started > 300) {
      // 超长文档，降频
    }
    updateStats();
    updateOutline();
    // 查找开着时，重渲染后恢复正文里的关键字标记
    if (!findbar.hidden && findInput.value) {
      highlightEditorLayer();
      highlightPreview();
    }
  }

  function updateStats() {
    const s = MD.stats(editor.value);
    $('st-words').textContent = s.words.toLocaleString() + ' 字';
    $('st-chars').textContent = s.chars.toLocaleString() + ' 字符';
  }

  function updateCursor() {
    const pos = editor.selectionStart;
    const before = editor.value.slice(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    $('st-cursor').textContent = '第 ' + line + ' 行, 第 ' + col + ' 列';
  }

  /* ---------------- 文件操作 ---------------- */
  async function doNew() {
    if (state.dirty) {
      const r = await api.message({
        type: 'question',
        message: '当前内容尚未保存',
        detail: '新建会清空当前编辑区，是否继续？',
        buttons: ['新建', '取消']
      });
      if (r !== 0) return;
    }
    if (state.openMode === 'tabs') {
      openTab({ text: '', eol: '\n', path: null, name: null });
      editor.focus();
      return;
    }
    try { await api.newWindow(); } catch (_) {}
  }

  async function doOpen() {
    const r = await api.open();
    if (r && r.ok) applyOpened(r);
  }

  async function doOpenPath(p) {
    const r = await api.openPath(p);
    if (r && r.ok) applyOpened(r);
  }

  function applyOpened(r) {
    if (state.openMode === 'tabs') {
      openTab(r);
    } else {
      state.path = r.path;
      state.name = r.name;
      setEditorText(r.text, r.eol);
      setDirty(false);
      updateFileLabel();
      try { api.syncDoc(r.path); } catch (_) {}
    }
    highlightTree();
    syncDirForFile(r.path);
    toast('已打开 ' + r.name);
  }

  async function doSave(saveAs) {
    const r = await api.save({ content: editor.value, saveAs: !!saveAs, eol: state.eol });
    if (r && r.ok) {
      state.path = r.path;
      state.name = r.name;
      state.lastSaved = editor.value;
      const t = currentTab();
      if (t) { t.path = r.path; t.name = r.name; t.text = editor.value; t.lastSaved = editor.value; t.dirty = false; }
      setDirty(false);
      updateFileLabel();
      renderTabs();
      api.saveFinished(true);
      toast(saveAs ? '已另存为 ' + r.name : '已保存');
    } else {
      api.saveFinished(false);
    }
    return r;
  }

  async function doReveal() {
    await api.reveal();
  }

  async function doCopyAll() {
    await api.writeClipboard(editor.value);
    toast('已复制全文（' + editor.value.length + ' 字符）');
  }

  /* ---------------- 文件夹浏览 / 文件树 ---------------- */
  let sbDismissed = false;   // 用户主动收起了侧栏
  let treeToken = 0;

  function showSidebar(show) {
    sidebar.hidden = !show;
    const sp = $('sb-splitter');
    if (sp) sp.hidden = !show;
    $('btn-tree').classList.toggle('on', show);
    try { localStorage.setItem('md-editor-sb', show ? '0' : '1'); } catch (_) {}
  }

  function toggleTree() {
    if (!sidebar.hidden) { sbDismissed = true; showSidebar(false); return; }
    if (!state.dir) { pickFolder(); return; }
    sbDismissed = false;
    showSidebar(true);
  }

  function showEmptySidebar() {
    sbTitle.textContent = '目录';
    sbTitle.title = '把文件夹拖进窗口，或点「选择文件夹」';
    sbBody.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'sb-tip';
    box.appendChild(document.createTextNode('还没有打开文件夹'));
    const hint = document.createElement('div');
    hint.className = 'sb-tip-sub';
    hint.textContent = '把文件夹拖进窗口，或点下面的按钮';
    box.appendChild(hint);
    const btn = document.createElement('button');
    btn.className = 'sb-pick-btn';
    btn.textContent = '选择文件夹';
    btn.addEventListener('click', pickFolder);
    box.appendChild(btn);
    sbBody.appendChild(box);
  }

  /* 启动时恢复上次的文件夹；没有就显示引导 */
  async function initSidebar() {
    sbDismissed = localStorage.getItem('md-editor-sb') === '1';
    const lastDir = localStorage.getItem('md-editor-dir');
    let loaded = false;

    if (lastDir) {
      const r = await api.dirRead(lastDir);
      if (r && r.ok) {
        setDir(r, false);
        loaded = true;
      } else {
        try { localStorage.removeItem('md-editor-dir'); } catch (_) {}
      }
    }
    if (!loaded) showEmptySidebar();
    showSidebar(!sbDismissed);
  }

  function shortName(p) {
    const parts = String(p || '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(p || '');
  }

  function renderEntries(entries, depth) {
    const frag = document.createDocumentFragment();
    for (const en of entries) {
      const row = document.createElement('div');
      row.className = 'tree-row' + (en.isDir ? ' is-dir' : '');
      row.dataset.path = en.path;
      row.dataset.depth = String(depth);
      row.style.paddingLeft = 8 + depth * 14 + 'px';
      row.title = en.path;
      row.tabIndex = 0;   // 可聚焦，便于 Ctrl+C 复制路径

      const tw = document.createElement('span');
      tw.className = 'twisty';
      tw.textContent = en.isDir ? '▸' : '';
      row.appendChild(tw);

      const nm = document.createElement('span');
      nm.className = 'tree-name';
      nm.textContent = en.name;
      row.appendChild(nm);

      frag.appendChild(row);

      if (en.isDir) {
        const kids = document.createElement('div');
        kids.className = 'tree-children';
        kids.hidden = true;
        kids.dataset.loaded = '0';
        frag.appendChild(kids);
      }
    }
    return frag;
  }

  function setDir(info, force) {
    if (!info || !info.ok) return;
    if (force) sbDismissed = false;
    state.dir = info.path;
    try { localStorage.setItem('md-editor-dir', info.path); } catch (_) {}
    sbTitle.textContent = info.name || shortName(info.path);
    sbTitle.title = info.path;
    sbBody.innerHTML = '';
    if (!info.entries || !info.entries.length) {
      const tip = document.createElement('div');
      tip.className = 'sb-tip';
      tip.textContent = '这个文件夹里没有 Markdown 文件';
      sbBody.appendChild(tip);
    } else {
      sbBody.appendChild(renderEntries(info.entries, 0));
    }
    if (!sbDismissed) showSidebar(true);
    highlightTree();
  }

  function highlightTree() {
    sbBody.querySelectorAll('.tree-row.active').forEach((r) => r.classList.remove('active'));
    if (!state.path) return;
    for (const r of sbBody.querySelectorAll('.tree-row')) {
      if (r.dataset.path === state.path) {
        r.classList.add('active');
        r.scrollIntoView({ block: 'nearest' });
        break;
      }
    }
  }

  async function toggleDirRow(row) {
    const kids = row.nextElementSibling;
    if (!kids || !kids.classList.contains('tree-children')) return;
    const tw = row.querySelector('.twisty');

    if (!kids.hidden) {
      kids.hidden = true;
      if (tw) tw.textContent = '▸';
      return;
    }

    if (kids.dataset.loaded === '0') {
      const token = ++treeToken;
      const r = await api.dirRead(row.dataset.path);
      if (token !== treeToken) return;
      if (r && r.ok) {
        kids.innerHTML = '';
        const depth = Number(row.dataset.depth || 0) + 1;
        if (r.entries && r.entries.length) {
          kids.appendChild(renderEntries(r.entries, depth));
        } else {
          const empty = document.createElement('div');
          empty.className = 'tree-empty';
          empty.textContent = '（空）';
          empty.style.paddingLeft = 8 + depth * 14 + 'px';
          kids.appendChild(empty);
        }
        kids.dataset.loaded = '1';
      }
    }
    kids.hidden = false;
    if (tw) tw.textContent = '▾';
  }

  async function openFromTree(p) {
    if (state.path === p) return;
    if (state.dirty) {
      const r = await api.message({
        type: 'question',
        message: '当前内容尚未保存',
        detail: '打开另一个文件会覆盖编辑区，是否继续？',
        buttons: ['继续打开', '取消']
      });
      if (r !== 0) return;
    }
    const r = await api.openPath(p);
    if (r && r.ok) applyOpened(r);
  }

  /* 单击只选中（聚焦，便于 Ctrl+C 复制），双击才打开 / 展开 */
  sbBody.addEventListener('click', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    row.focus();
  });

  sbBody.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    e.preventDefault();
    if (row.classList.contains('is-dir')) toggleDirRow(row);
    else openFromTree(row.dataset.path);
  });

  /* 右键打开：按当前偏好决定开标签还是独立窗口 */
  async function openInNewWindow(p) {
    if (state.openMode === 'tabs') {
      const r = await api.openPath(p);
      if (r && r.ok) { openTab(r); toast('已在新标签打开 ' + r.name); return; }
    } else {
      try {
        const r = await api.openNewWindow(p);
        if (r && r.ok) { toast('已在新窗口打开'); return; }
      } catch (_) {}
    }
    toast('打开失败');
  }

  /* 复制文件本身：走 Windows 原生 CF_HDROP，等同于资源管理器 Ctrl+C */
  async function copyFileItem(p) {
    const r = await api.copyFile(p);
    if (r && r.ok) toast('已复制文件，可在文件夹里粘贴');
    else toast('复制失败：' + ((r && r.error) || '未知错误'));
  }

  async function copyFileItemAsText(p) {
    const r = await api.readFileText(p);
    if (r && r.ok) {
      await api.writeClipboard(r.text);
      toast('已复制文件内容');
    } else {
      toast('读取文件失败');
    }
  }

  async function revealTreePath(p) {
    const r = await api.revealPath(p);
    if (!r || !r.ok) toast('打开失败：' + ((r && r.error) || '未知错误'));
  }

  async function copyTreeName(p) {
    await api.writeClipboard(shortName(p));
    toast('已复制文件名：' + shortName(p));
  }

  async function copyTreePath(p) {
    await api.writeClipboard(p);
    toast('已复制完整路径');
  }

  /* 文件树右键：复制文件内容 / 文件名 / 路径 / 定位 */
  sbBody.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    row.focus();
    const p = row.dataset.path;
    const isDir = row.classList.contains('is-dir');
    showMenu(e.clientX, e.clientY, [
      { label: state.openMode === 'tabs' ? '在新标签打开' : '在新窗口打开', action: () => openInNewWindow(p) },
      { sep: true },
      { label: '复制文件', kbd: 'Ctrl+C', action: () => copyFileItem(p) },
      { label: '复制文件内容', disabled: isDir, action: () => copyFileItemAsText(p) },
      { sep: true },
      { label: '复制文件名', action: () => copyTreeName(p) },
      { label: '复制完整路径', action: () => copyTreePath(p) },
      { sep: true },
      { label: '在资源管理器中显示', action: () => revealTreePath(p) }
    ]);
  });

  async function pickFolder() {
    const r = await api.dirOpen();
    if (r && r.ok) setDir(r, true);
  }

  /* 打开文件后把侧栏同步到它所在目录（用户收起过侧栏就不再弹出） */
  async function syncDirForFile(filePath) {
    if (!filePath) return;
    const dir = String(filePath).replace(/[\\/][^\\/]+$/, '');
    if (!dir || dir === filePath) return;
    if (state.dir === dir) { highlightTree(); return; }
    const r = await api.dirRead(dir);
    if (r && r.ok) setDir(r, false);
  }

  /* ---------------- 模式 / 主题 / 缩放 ---------------- */
  function setMode(mode) {
    state.mode = mode;
    workspace.dataset.mode = mode;
    document.querySelectorAll('#mode-seg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    localStorage.setItem('md-editor-mode', mode);
    if (mode !== 'edit') renderNow();
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('md-editor-theme', theme);
  }

  let zoom = 1;
  function applyZoom(delta) {
    if (delta === 0) zoom = 1;
    else zoom = Math.min(1.6, Math.max(0.8, +(zoom + delta * 0.1).toFixed(2)));
    document.documentElement.style.setProperty('--zoom', zoom);
    editor.style.fontSize = (13.5 * zoom).toFixed(1) + 'px';
    if (editorHl) editorHl.style.fontSize = (13.5 * zoom).toFixed(1) + 'px';
    preview.style.fontSize = (14.5 * zoom).toFixed(1) + 'px';
  }

  /* ---------------- 查找 ---------------- */
  let findMatches = [];
  let findIndex = -1;

  /* 预览正文里的关键字背景标记 */
  let previewHits = [];
  function clearPreviewHits() {
    preview.querySelectorAll('mark.find-hit').forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
    previewHits = [];
  }

  function highlightPreview() {
    clearPreviewHits();
    const q = (findInput.value || '').toLowerCase();
    if (!q || findbar.hidden) return;
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(q)) return NodeFilter.FILTER_REJECT;
        const p = node.parentNode;
        if (p && (p.nodeName === 'MARK' || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach((node) => {
      const lower = node.nodeValue.toLowerCase();
      const at = [];
      let i = lower.indexOf(q);
      while (i !== -1) { at.push(i); i = lower.indexOf(q, i + q.length); }
      for (let k = at.length - 1; k >= 0; k--) {
        const range = document.createRange();
        range.setStart(node, at[k]);
        range.setEnd(node, at[k] + q.length);
        const mark = document.createElement('mark');
        mark.className = 'find-hit';
        try { range.surroundContents(mark); } catch (_) { /* 跨元素边界，跳过 */ }
      }
    });
    previewHits = [...preview.querySelectorAll('mark.find-hit')];
    if (findIndex >= 0 && findIndex < previewHits.length) {
      previewHits[findIndex].classList.add('find-hit-active');
    }
  }

  function openFind() {
    findbar.hidden = false;
    findInput.focus();
    findInput.select();
    if (state.mode === 'read') setMode('split');
  }

  /* 编辑器叠加层：把所有匹配染上背景色，当前命中更深 */
  function highlightEditorLayer() {
    if (!editorHl) return;
    if (findbar.hidden || !findInput.value) { editorHl.innerHTML = ''; return; }
    const esc = MD.escapeHtml(editor.value);
    const re = new RegExp(findInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let count = 0;
    editorHl.innerHTML = esc.replace(re, (m) => {
      const cls = count === findIndex ? ' class="find-hit-active"' : '';
      count++;
      return '<mark' + cls + '>' + m + '</mark>';
    });
    editorHl.scrollTop = editor.scrollTop;
    editorHl.scrollLeft = editor.scrollLeft;
  }

  function closeFind() {
    findbar.hidden = true;
    findMatches = [];
    findIndex = -1;
    findCount.textContent = '';
    clearPreviewHits();
    if (editorHl) editorHl.innerHTML = '';
    editor.focus();
  }

  function collectMatches() {
    const q = findInput.value;
    findMatches = [];
    if (!q) { findCount.textContent = ''; return; }
    const hay = editor.value.toLowerCase();
    const needle = q.toLowerCase();
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      findMatches.push(idx);
      idx = hay.indexOf(needle, idx + needle.length);
    }
    findCount.textContent = findMatches.length ? '共 ' + findMatches.length + ' 处' : '无匹配';
  }

  function selectMatch(i) {
    if (!findMatches.length) return;
    findIndex = (i + findMatches.length) % findMatches.length;
    const start = findMatches[findIndex];
    editor.focus();
    editor.setSelectionRange(start, start + findInput.value.length);
    // 粗略滚动到可见
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 23;
    const line = editor.value.slice(0, start).split('\n').length - 1;
    const target = line * lineHeight;
    if (target < editor.scrollTop || target > editor.scrollTop + editor.clientHeight - 80) {
      editor.scrollTop = Math.max(0, target - editor.clientHeight / 2);
    }
    // 预览正文同步标记当前命中
    previewHits.forEach((m) => m.classList.remove('find-hit-active'));
    const m = previewHits[findIndex];
    if (m) {
      m.classList.add('find-hit-active');
      try { m.scrollIntoView({ block: 'center' }); } catch (_) {}
    }
    // 编辑器叠加层的当前命中刷新
    highlightEditorLayer();
    findCount.textContent = (findIndex + 1) + ' / ' + findMatches.length;
  }

  function findNext(back) {
    if (!findbar.hidden && findInput.value) {
      collectMatches();
      if (!findMatches.length) return;
      selectMatch(back ? findIndex - 1 : findIndex + 1);
    }
  }

  /* ---------------- 右键菜单 ---------------- */
  const KEY = { cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', selectAll: 'Ctrl+A', undo: 'Ctrl+Z', redo: 'Ctrl+Y' };

  function buildMenu(items) {
    ctxMenu.innerHTML = '';
    items.forEach((it) => {
      if (it.sep) {
        const d = document.createElement('div');
        d.className = 'ctx-sep';
        ctxMenu.appendChild(d);
        return;
      }
      const d = document.createElement('div');
      d.className = 'ctx-item' + (it.disabled ? ' disabled' : '');
      const label = document.createElement('span');
      label.textContent = it.label;
      d.appendChild(label);
      if (it.kbd) {
        const k = document.createElement('span');
        k.className = 'kbd';
        k.textContent = it.kbd;
        d.appendChild(k);
      }
      d.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      d.addEventListener('click', () => { hideMenu(); it.action(); });
      ctxMenu.appendChild(d);
    });
  }

  function showMenu(x, y, items) {
    buildMenu(items);
    ctxMenu.hidden = false;
    const rect = ctxMenu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    ctxMenu.style.left = Math.max(6, px) + 'px';
    ctxMenu.style.top = Math.max(6, py) + 'px';
  }

  function hideMenu() { ctxMenu.hidden = true; }

  document.addEventListener('mousedown', (e) => {
    if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) hideMenu();
  });
  window.addEventListener('blur', hideMenu);
  window.addEventListener('resize', hideMenu);

  function hasSelection() {
    return editor.selectionEnd > editor.selectionStart;
  }

  editor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const sel = hasSelection();
    showMenu(e.clientX, e.clientY, [
      { label: '撤销', kbd: KEY.undo, action: () => { editor.focus(); document.execCommand('undo'); } },
      { label: '重做', kbd: KEY.redo, action: () => { editor.focus(); document.execCommand('redo'); } },
      { sep: true },
      { label: '剪切', kbd: KEY.cut, disabled: !sel, action: () => { editor.focus(); document.execCommand('cut'); } },
      { label: '复制', kbd: KEY.copy, disabled: !sel, action: () => { editor.focus(); document.execCommand('copy'); } },
      { label: '粘贴', kbd: KEY.paste, action: pasteIntoEditor },
      { label: '全选', kbd: KEY.selectAll, action: () => { editor.focus(); editor.select(); } },
      { sep: true },
      { label: '复制全文', kbd: 'Ctrl+Shift+C', action: doCopyAll },
      { label: '打开文件所在文件夹', kbd: 'Ctrl+Shift+O', action: doReveal }
    ]);
  });

  previewPane.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const selText = String(window.getSelection() || '');
    showMenu(e.clientX, e.clientY, [
      { label: '复制选中内容', kbd: 'Ctrl+C', disabled: !selText, action: () => { api.writeClipboard(selText); toast('已复制选中内容'); } },
      { label: '复制全文', kbd: 'Ctrl+Shift+C', action: doCopyAll },
      { sep: true },
      { label: '打开文件所在文件夹', kbd: 'Ctrl+Shift+O', action: doReveal }
    ]);
  });

  async function pasteIntoEditor() {
    const text = await api.readClipboard();
    editor.focus();
    // 用 insertText 让粘贴进入原生撤销栈
    if (text) document.execCommand('insertText', false, text);
  }

  /* ---------------- 编辑区行为 ---------------- */
  editor.addEventListener('input', () => {
    setDirty(editor.value !== state.lastSaved);
    scheduleRender();
    updateCursor();
    if (!findbar.hidden && findInput.value) collectMatches();
  });

  editor.addEventListener('keyup', updateCursor);
  editor.addEventListener('click', updateCursor);
  editor.addEventListener('select', updateCursor);

  editor.addEventListener('keydown', (e) => {
    // Tab 缩进
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
      return;
    }
    // 回车续列表
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      const pos = editor.selectionStart;
      if (pos !== editor.selectionEnd) return;
      const before = editor.value.slice(0, pos);
      const lineStart = before.lastIndexOf('\n') + 1;
      const line = before.slice(lineStart);
      const m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
      if (m) {
        const hasContent = m[5].trim().length > 0;
        if (hasContent) {
          e.preventDefault();
          let marker;
          if (/\d/.test(m[2])) {
            marker = (parseInt(m[2], 10) + 1) + m[2].slice(-1);
          } else {
            marker = m[2];
          }
          const insert = '\n' + m[1] + marker + ' ' + (m[4] ? '[ ] ' : '');
          document.execCommand('insertText', false, insert);
        } else {
          // 空列表项回车 → 结束该列表
          e.preventDefault();
          const start = lineStart;
          editor.setSelectionRange(start, pos);
          document.execCommand('insertText', false, '');
        }
      }
    }
    // Esc 关闭查找
    if (e.key === 'Escape' && !findbar.hidden) {
      e.preventDefault();
      closeFind();
    }
  });

  /* ---------------- 预览交互 ---------------- */
  preview.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href)) api.openExternal(href);
    else if (href.startsWith('#')) {
      const el = preview.querySelector(href) || preview.querySelector('[id="' + href.slice(1) + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (href && href !== '#') {
      api.openExternal(href);
    }
  });

  /* ---------------- 章节大纲 ---------------- */
  const outlineEl = $('outline');
  const olBody = $('ol-body');
  const olCount = $('ol-count');
  let outlineItems = [];
  let activeHeading = -1;

  function setOutlineVisible(show, persist) {
    outlineEl.hidden = !show;
    const sp = $('ol-splitter');
    if (sp) sp.hidden = !show;
    $('btn-outline').classList.toggle('on', show);
    if (persist !== false) {
      try { localStorage.setItem('md-editor-outline', show ? '1' : '0'); } catch (_) {}
    }
    if (show) syncOutlineActive();
  }

  function toggleOutline() {
    setOutlineVisible(outlineEl.hidden);
  }

  function updateOutline() {
    const heads = Array.prototype.slice.call(preview.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    outlineItems = heads.map((h) => ({
      level: Number(h.tagName.charAt(1)),
      text: (h.textContent || '').trim() || '（无标题）',
      line: Number(h.dataset.line || 0)
    }));

    olBody.innerHTML = '';
    if (!outlineItems.length) {
      olCount.textContent = '0';
      const empty = document.createElement('div');
      empty.className = 'ol-empty';
      empty.textContent = '本文还没有标题，用 # 号写下小标题就会出现在这里';
      olBody.appendChild(empty);
      activeHeading = -1;
      return;
    }

    olCount.textContent = String(outlineItems.length);
    const frag = document.createDocumentFragment();
    outlineItems.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'ol-item';
      row.dataset.idx = String(idx);
      row.dataset.level = String(it.level);
      row.style.paddingLeft = 10 + (it.level - 1) * 13 + 'px';
      row.textContent = it.text;
      row.title = it.text;
      frag.appendChild(row);
    });
    olBody.appendChild(frag);

    if (activeHeading >= outlineItems.length) activeHeading = -1;
    if (activeHeading >= 0) markActiveHeading(activeHeading, false);
  }

  function markActiveHeading(idx, doScroll) {
    activeHeading = idx;
    const rows = olBody.querySelectorAll('.ol-item');
    for (let k = 0; k < rows.length; k++) rows[k].classList.toggle('active', k === idx);
    const row = rows[idx];
    if (row && doScroll !== false) row.scrollIntoView({ block: 'nearest' });
  }

  function lineToOffset(line) {
    const lines = editor.value.split('\n');
    let off = 0;
    for (let k = 0; k < line && k < lines.length; k++) off += lines[k].length + 1;
    return Math.min(off, editor.value.length);
  }

  function jumpToHeading(idx) {
    const it = outlineItems[idx];
    if (!it) return;

    // 编辑区与预览各滚各的，先压住滚动同步，免得互相拉扯
    suppressSyncUntil = Date.now() + 650;

    if (state.mode !== 'edit') {
      const heads = preview.querySelectorAll('h1,h2,h3,h4,h5,h6');
      const h = heads[idx];
      if (h) {
        const boxTop = preview.getBoundingClientRect().top;
        const top = h.getBoundingClientRect().top - boxTop + preview.scrollTop - 10;
        preview.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }

    if (state.mode !== 'read') {
      const lh = parseFloat(getComputedStyle(editor).lineHeight) || 23;
      const top = Math.max(0, it.line * lh - editor.clientHeight * 0.3);
      editor.scrollTo({ top, behavior: 'smooth' });
      const pos = lineToOffset(it.line);
      editor.focus();
      editor.setSelectionRange(pos, pos);
      updateCursor();
    }

    markActiveHeading(idx);
  }

  /* 预览滚动时高亮当前所在章节 */
  function syncOutlineActive() {
    if (outlineEl.hidden || !outlineItems.length || state.mode === 'edit') return;
    const heads = preview.querySelectorAll('h1,h2,h3,h4,h5,h6');
    if (!heads.length) return;
    const line = preview.getBoundingClientRect().top + 30;
    let idx = 0;
    for (let k = 0; k < heads.length; k++) {
      if (heads[k].getBoundingClientRect().top <= line) idx = k;
      else break;
    }
    if (idx !== activeHeading) markActiveHeading(idx, false);
  }

  olBody.addEventListener('click', (e) => {
    const row = e.target.closest('.ol-item');
    if (!row) return;
    jumpToHeading(Number(row.dataset.idx));
  });

  /* ---------------- 滚动同步 ---------------- */
  let syncLock = false;
  let suppressSyncUntil = 0;
  editor.addEventListener('scroll', () => {
    // 高亮层跟随滚动（与模式无关）
    if (editorHl) {
      editorHl.scrollTop = editor.scrollTop;
      editorHl.scrollLeft = editor.scrollLeft;
    }
    if (state.mode !== 'split' || syncLock) return;
    if (Date.now() < suppressSyncUntil) return;
    syncLock = true;
    const denom = Math.max(1, editor.scrollHeight - editor.clientHeight);
    const ratio = editor.scrollTop / denom;
    preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight);
    requestAnimationFrame(() => { syncLock = false; });
  });

  preview.addEventListener('scroll', () => {
    syncOutlineActive();
    if (state.mode !== 'split' || syncLock) return;
    if (Date.now() < suppressSyncUntil) return;
    syncLock = true;
    const denom = Math.max(1, preview.scrollHeight - preview.clientHeight);
    const ratio = preview.scrollTop / denom;
    editor.scrollTop = ratio * Math.max(0, editor.scrollHeight - editor.clientHeight);
    requestAnimationFrame(() => { syncLock = false; });
  });

  /* ---------------- 分栏拖动 ---------------- */
  let dragging = false;
  splitter.addEventListener('mousedown', (e) => {
    if (state.mode !== 'split') return;
    dragging = true;
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    let w = e.clientX - rect.left;
    const min = 220;
    const max = rect.width - min;
    w = Math.min(max, Math.max(min, w));
    editorPane.style.flex = '0 0 ' + w + 'px';
    previewPane.style.flex = '1 1 0';
    editorPane.dataset.split = String(w);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing');
    // 记住分栏比例（按工作区宽度的百分比，窗口大小变了也合理）
    const rect = workspace.getBoundingClientRect();
    const pct = editorPane.getBoundingClientRect().width / rect.width;
    if (pct > 0.15 && pct < 0.85) {
      try { localStorage.setItem('md-editor-split-pct', String(pct)); } catch (_) {}
    }
  });

  /* ---------------- 目录 / 大纲宽度拖动（记住宽度） ---------------- */
  const sbSplitter = $('sb-splitter');
  const olSplitter = $('ol-splitter');
  let panelDrag = null; // 'sb' | 'ol'

  function clampPanelWidth(w, min) {
    const max = Math.floor(workspace.getBoundingClientRect().width * 0.6);
    return Math.max(min, Math.min(max, w));
  }
  function applySidebarWidth(w) {
    w = clampPanelWidth(w, 180);
    sidebar.style.flexBasis = w + 'px';
    return w;
  }
  function applyOutlineWidth(w) {
    w = clampPanelWidth(w, 160);
    outlineEl.style.flexBasis = w + 'px';
    return w;
  }
  function restorePanelWidths() {
    try {
      const sw = parseInt(localStorage.getItem('md-editor-sb-w'), 10);
      if (sw) applySidebarWidth(sw);
      const ow = parseInt(localStorage.getItem('md-editor-ol-w'), 10);
      if (ow) applyOutlineWidth(ow);
    } catch (_) {}
  }

  sbSplitter.addEventListener('mousedown', (e) => {
    if (sidebar.hidden) return;
    panelDrag = 'sb';
    sbSplitter.classList.add('dragging');
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  olSplitter.addEventListener('mousedown', (e) => {
    if (outlineEl.hidden) return;
    panelDrag = 'ol';
    olSplitter.classList.add('dragging');
    document.body.classList.add('resizing');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!panelDrag) return;
    const rect = workspace.getBoundingClientRect();
    if (panelDrag === 'sb') {
      sidebar.dataset.w = String(applySidebarWidth(e.clientX - rect.left));
    } else {
      outlineEl.dataset.w = String(applyOutlineWidth(rect.right - e.clientX));
    }
  });

  document.addEventListener('mouseup', () => {
    if (!panelDrag) return;
    const key = panelDrag === 'sb' ? 'md-editor-sb-w' : 'md-editor-ol-w';
    const val = panelDrag === 'sb' ? sidebar.dataset.w : outlineEl.dataset.w;
    if (val) { try { localStorage.setItem(key, val); } catch (_) {} }
    (panelDrag === 'sb' ? sbSplitter : olSplitter).classList.remove('dragging');
    document.body.classList.remove('resizing');
    panelDrag = null;
  });

  /* ---------------- 拖放打开 ---------------- */
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) dropHint.hidden = false;
  });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropHint.hidden = true;
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropHint.hidden = true;
  });

  /* ---------------- 主进程指令 ---------------- */
  api.onCommand(async (name, payload) => {
    switch (name) {
      case 'new': doNew(); break;
      case 'open': doOpen(); break;
      case 'save': doSave(false); break;
      case 'saveAs': doSave(true); break;
      case 'openDir': doReveal(); break;
      case 'openFolder': pickFolder(); break;
      case 'dir-opened': setDir(payload, true); break;
      case 'copyAll': doCopyAll(); break;
      case 'find': openFind(); break;
      case 'mode': setMode(payload); break;
      case 'outline': toggleOutline(); break;
      case 'tree': toggleTree(); break;
      case 'open-mode': setOpenMode(payload, true); break;
      case 'export-docs': {
        captureTab();
        const docs = state.tabs.map((t) => Object.assign({}, t));
        api.exportDocs({ docs });
        break;
      }
      case 'adopt-tabs': {
        const docs = Array.isArray(payload) ? payload : [];
        if (!docs.length) break;
        state.tabs = docs.map(tabFromDoc);
        activateTab(state.tabs[0]);
        toast('已合并为 ' + state.tabs.length + ' 个标签');
        break;
      }
      case 'adopt-doc': {
        if (!payload) break;
        const t = tabFromDoc(payload);
        state.tabs = [t];
        activateTab(t);
        break;
      }
      case 'newWindow':
        if (state.path) openInNewWindow(state.path);
        else { try { api.newWindow(); } catch (_) {} }
        break;
      case 'theme': setTheme(state.theme === 'dark' ? 'light' : 'dark'); break;
      case 'zoom': applyZoom(payload); break;
      case 'file-opened': applyOpened(payload); break;
      case 'open-external': doOpenPath(payload); break;
      case 'dropped-path': doOpenPath(payload); break;
      case 'dropped-text': {
        if (state.dirty) {
          const r = await api.message({ message: '当前内容尚未保存', detail: '打开新文件会覆盖当前编辑区，是否继续？', buttons: ['继续', '取消'], type: 'question' });
          if (r !== 0) break;
        }
        state.path = null;
        state.name = payload.name || null;
        setEditorText(payload.text, '\n');
        setDirty(false);
        updateFileLabel();
        try { api.syncDoc(null); } catch (_) {}
        break;
      }
    }
  });

  /* 模式迁移时，各窗口交出自己的标签文档 */
  api.onExport(() => {
    captureTab();
    return state.tabs.map((t) => Object.assign({}, t));
  });

  /* 窗口关闭确认（Tauri: CloseRequested → close-confirm 事件） */
  api.onCloseConfirm(async () => {
    const dirtyTab = state.tabs.find((t) => t.dirty);
    if (!dirtyTab) { api.closeWindow(); return; }
    const r = await api.message({
      type: 'question',
      message: '「' + (dirtyTab.name || '未命名') + '」还有未保存的修改',
      detail: '是否先保存再退出？',
      buttons: ['取消', '不保存', '保存']
    });
    if (r === 1) { api.closeWindow(); return; }
    if (r === 2) {
      activateTab(dirtyTab);
      const rr = await doSave(!dirtyTab.path);
      if (!rr || !rr.ok) return;
      api.closeWindow();
    }
    /* r === 0 取消：什么都不做，窗口留着 */
  });

  /* ---------------- 按钮绑定 ---------------- */
  $('btn-new').addEventListener('click', doNew);
  $('btn-open').addEventListener('click', doOpen);
  $('btn-tree').addEventListener('click', toggleTree);
  $('btn-outline').addEventListener('click', toggleOutline);
  $('sb-pick').addEventListener('click', pickFolder);
  $('sb-close').addEventListener('click', () => { sbDismissed = true; showSidebar(false); });
  $('btn-save').addEventListener('click', () => doSave(false));
  $('btn-saveas').addEventListener('click', () => doSave(true));
  $('btn-undo').addEventListener('click', () => { editor.focus(); document.execCommand('undo'); });
  $('btn-redo').addEventListener('click', () => { editor.focus(); document.execCommand('redo'); });
  $('btn-find').addEventListener('click', openFind);
  $('btn-copyall').addEventListener('click', doCopyAll);
  $('btn-dir').addEventListener('click', doReveal);
  $('btn-theme').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('btn-openmode').addEventListener('click', () => setOpenMode(state.openMode === 'tabs' ? 'windows' : 'tabs'));
  $('btn-outline').addEventListener('click', toggleOutline);
  $('ol-close').addEventListener('click', () => setOutlineVisible(false));

  document.querySelectorAll('#mode-seg button').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });

  $('find-next').addEventListener('click', () => findNext(false));
  $('find-prev').addEventListener('click', () => findNext(true));
  $('find-close').addEventListener('click', closeFind);

  findInput.addEventListener('input', () => {
    collectMatches();
    findIndex = -1;
    highlightEditorLayer();
    highlightPreview();
    if (findMatches.length) selectMatch(0);
  });

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });

  // Ctrl+F 兜底（菜单已注册，双保险）
  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }

    // 焦点在文件树的条目上 → Ctrl+C 复制文件本身（不是路径文字）
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
      const el = document.activeElement;
      const row = el && el.closest ? el.closest('.tree-row') : null;
      if (row && sbBody.contains(row)) {
        e.preventDefault();
        copyFileItem(row.dataset.path);
      }
    }

    /* 以下快捷键原由应用菜单注册（Electron），Tauri 版统一在前端处理 */
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(e.shiftKey); return; }
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); doNew(); return; }
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') { e.preventDefault(); doOpen(); return; }
    if (ctrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFolder(); return; }
    if (ctrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); doCopyAll(); return; }
    if (ctrl && !e.shiftKey && !e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
      e.preventDefault();
      setMode(e.key === '1' ? 'edit' : e.key === '2' ? 'split' : 'read');
      return;
    }
    if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(1); return; }
    if (ctrl && e.key === '-') { e.preventDefault(); applyZoom(-1); return; }
    if (ctrl && e.key === '0') { e.preventDefault(); applyZoom(0); return; }

    if (e.key === 'Escape' && !ctxMenu.hidden) hideMenu();
  });

  /* ---------------- 启动 ---------------- */
  async function boot() {
    const savedTheme = localStorage.getItem('md-editor-theme');
    setTheme(savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    setMode(localStorage.getItem('md-editor-mode') || 'split');
    setOutlineVisible(localStorage.getItem('md-editor-outline') !== '0', false);

    // 打开方式：主进程偏好优先，其次本地缓存
    let openMode = localStorage.getItem('md-editor-open-mode') || 'tabs';
    try {
      const m = await api.getOpenMode();
      if (m && (m.mode === 'tabs' || m.mode === 'windows')) openMode = m.mode;
    } catch (_) { /* 测试环境未注册时忽略 */ }
    await setOpenMode(openMode, true);
    restorePanelWidths();

    // 恢复分栏比例；欢迎页一旦被用户关闭过，就不再显示
    const splitPct = parseFloat(localStorage.getItem('md-editor-split-pct'));
    if (splitPct > 0.15 && splitPct < 0.85) {
      editorPane.style.flex = '0 0 ' + (splitPct * 100).toFixed(2) + '%';
    }
    const welcomeClosed = localStorage.getItem('md-editor-welcome-closed') === '1';
    const firstTab = welcomeClosed
      ? makeTab({ text: '', eol: '\n', name: null, path: null })
      : makeTab({ text: WELCOME, eol: '\n', name: null, path: null, isWelcome: true });
    state.tabs = [firstTab];
    state.activeKey = firstTab.key;
    setEditorText(firstTab.text, '\n');
    setDirty(false);
    updateFileLabel();
    editor.focus();
    editor.setSelectionRange(0, 0);
    updateCursor();
    renderTabs();

    await initSidebar();
  }

  boot();
})();
