/* Tauri 桥接层：替代 Electron preload，向 app.js 提供同形状的 window.api */
(function () {
  'use strict';

  const T = window.__TAURI__;
  if (!T) { console.error('Tauri API 未注入'); return; }
  const invoke = T.core.invoke;
  const listen = T.event.listen;
  const cur = T.window.getCurrentWindow();

  /* ---------- 标题状态（等价原主进程窗口状态） ---------- */
  const titleState = { path: null, dirty: false };
  function baseName(p) {
    if (!p) return null;
    return String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null;
  }
  function updateTitle() {
    const t = (titleState.dirty ? '● ' : '') + (baseName(titleState.path) || '未命名') + ' — 小银 Markdown';
    cur.setTitle(t).catch(() => {});
  }

  /* ---------- 模态对话框（支持任意按钮数组，返回按钮索引） ---------- */
  function modalDialog(o) {
    const buttons = Array.isArray(o.buttons) && o.buttons.length ? o.buttons : ['好'];
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;color:#222;border-radius:12px;padding:22px 24px 18px;max-width:440px;box-shadow:0 18px 60px rgba(0,0,0,.3);font-size:13.5px;';
      const msg = document.createElement('div');
      msg.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:6px;';
      msg.textContent = o.message || '';
      box.appendChild(msg);
      if (o.detail) {
        const d = document.createElement('div');
        // pre-wrap：更新说明是多行编号，不保留换行会被压成一坨
        d.style.cssText = 'opacity:.72;margin-bottom:14px;line-height:1.7;white-space:pre-wrap;';
        d.textContent = o.detail;
        box.appendChild(d);
      }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:4px;';
      buttons.forEach((label, i) => {
        const b = document.createElement('button');
        b.textContent = label;
        const primary = i === buttons.length - 1;
        b.style.cssText = 'padding:7px 16px;border-radius:8px;border:1px solid #c9cdd4;cursor:pointer;font-size:13px;background:' +
          (primary ? '#3b7bf6;color:#fff;border-color:#3b7bf6;' : 'transparent;color:inherit;');
        b.addEventListener('click', () => { overlay.remove(); resolve(i); });
        row.appendChild(b);
      });
      box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  /* ---------- 命令 / 关闭 / 导出 处理器注册表 ---------- */
  const cmdHandlers = [];
  const closeHandlers = [];
  let exportHandler = null;
  function fire(name, payload) {
    cmdHandlers.forEach((cb) => { try { cb(name, payload); } catch (err) { console.error(err); } });
  }

  /* ---------- 迁移：广播收集所有窗口的文档 ---------- */
  function collectAllDocs() {
    return new Promise((resolve) => {
      const replies = [];
      let un = null;
      listen('mig:docs', (e) => {
        if (e.payload && Array.isArray(e.payload.docs)) replies.push(e.payload.docs);
      }).then((u) => { un = u; });
      T.event.emit('mig:request', { from: cur.label });
      const start = Date.now();
      const tick = () => {
        if (Date.now() - start >= 2200 || un) {
          if (un) un();
          const seen = new Set();
          const out = [];
          for (const docs of replies) {
            for (const d of docs) {
              if (d.path && seen.has(d.path)) continue;
              if (d.path) seen.add(d.path);
              out.push(d);
            }
          }
          if (!out.length) out.push({ path: null, name: null, text: '', eol: '\n', dirty: false, lastSaved: '' });
          resolve(out);
          return;
        }
        setTimeout(tick, 120);
      };
      setTimeout(tick, 600);
    });
  }

  /* ---------- 对外 API（与 Electron preload 同形状） ---------- */
  window.api = {
    open: () => invoke('open_file_dialog'),
    openPath: (p) => invoke('read_text_file', { path: p }),
    save: async (payload) => {
      const r = await invoke('save_file', {
        content: payload.content,
        saveAs: !!payload.saveAs,
        eol: payload.eol || '\n',
        currentPath: titleState.path
      });
      if (r && r.ok && r.path) {
        titleState.path = r.path;
        titleState.dirty = false;
        updateTitle();
      }
      return r;
    },
    reveal: () => (titleState.path ? invoke('reveal_in_explorer', { path: titleState.path }) : Promise.resolve({ ok: false })),
    revealPath: (p) => invoke('reveal_in_explorer', { path: p }),
    copyFile: (p) => invoke('copy_file_to_clipboard', { path: p }),
    readFileText: (p) => invoke('read_text_file', { path: p }),
    readClipboard: () => invoke('read_clipboard_text'),
    writeClipboard: (t) => invoke('write_clipboard_text', { text: t }),
    openExternal: (url) => invoke('open_external', { url }),
    dirOpen: () => invoke('open_dir_dialog'),
    dirRead: (p) => invoke('read_dir', { path: p }),
    openNewWindow: (p) => invoke('open_new_window', { path: p }),
    newWindow: () => invoke('open_new_window', { path: null }),
    closeWindow: () => invoke('force_close'),
    getOpenMode: async () => ({ mode: localStorage.getItem('md-editor-open-mode') || 'tabs' }),
    setOpenMode: async (mode) => {
      const docs = await collectAllDocs();
      await invoke('migrate_apply', { mode, docs, keepLabel: cur.label });
      return { ok: true, mode };
    },
    setDirty: (d) => { titleState.dirty = !!d; updateTitle(); },
    syncDoc: (p) => {
      titleState.path = p || null;
      updateTitle();
    },
    message: (o) => modalDialog(o),
    saveFinished: () => {},
    exportDocs: () => {},
    onCommand: (cb) => cmdHandlers.push(cb),
    onCloseConfirm: (cb) => closeHandlers.push(cb),
    onExport: (cb) => { exportHandler = cb; }
  };

  /* ---------- 事件接线 ---------- */
  listen('mig:adopt-tabs', (e) => fire('adopt-tabs', e.payload && e.payload.docs));
  listen('mig:adopt-doc', (e) => fire('adopt-doc', e.payload));
  listen('open-external', (e) => fire('open-external', e.payload));
  listen('init-file', (e) => fire('file-opened', e.payload));
  listen('close-confirm', () => closeHandlers.forEach((cb) => { try { cb(cur.label); } catch (err) { console.error(err); } }));
  listen('mig:request', () => {
    if (exportHandler) {
      try {
        const docs = exportHandler();
        T.event.emit('mig:docs', { from: cur.label, docs });
      } catch (err) { console.error(err); }
    }
  });


  /* ---------- 在线升级（服务端：https://md.wangjinding.com/update/latest.json） ---------- */
  const updateBtn = document.getElementById('btn-update');
  if (updateBtn) updateBtn.addEventListener('click', runUpdate);
  let updating = false;

  // 状态栏显示当前版本（静态值只是兜底，这里用真实版本覆盖）
  const verEl = document.getElementById('st-ver');
  if (verEl) {
    invoke('app_version')
      .then((v) => { if (v) verEl.textContent = 'v' + v; })
      .catch(() => {});
  }

  /* 升级进度浮层 */
  function progressUI(title) {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:99998;'
      + 'display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#222;border-radius:12px;padding:24px 26px;'
      + 'width:380px;box-shadow:0 20px 60px rgba(0,0,0,.3);';
    const t = document.createElement('div');
    t.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:14px;';
    t.textContent = title;
    const track = document.createElement('div');
    track.style.cssText = 'height:6px;border-radius:4px;background:#eceef3;overflow:hidden;';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:6%;background:linear-gradient(90deg,#3a7bfc,#0b66dd);'
      + 'transition:width .25s ease;';
    track.appendChild(bar);
    const sub = document.createElement('div');
    sub.style.cssText = 'margin-top:10px;font-size:12.5px;color:#7a8494;';
    sub.textContent = '正在下载…';
    box.append(t, track, sub);
    mask.appendChild(box);
    document.body.appendChild(mask);
    return {
      set(p) {
        if (!p) return;
        if (p.done) { bar.style.width = '100%'; sub.textContent = '安装完成，正在重启…'; return; }
        const d = p.downloaded || 0;
        const total = p.total || 0;
        if (total > 0) {
          bar.style.width = Math.min(100, (d / total) * 100).toFixed(1) + '%';
          sub.textContent = `${(d / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
        } else {
          sub.textContent = `${(d / 1048576).toFixed(1)} MB`;
        }
      },
      close() { mask.remove(); },
    };
  }

  async function runUpdate() {
    if (!updateBtn || updating) return;
    updating = true;
    updateBtn.classList.add('busy');
    try {
      const st = await invoke('check_update');
      if (!st || !st.available) {
        await modalDialog({ message: '已是最新版本', buttons: ['好'] });
        return;
      }
      const lines = [];
      if (st.date) lines.push(`发布时间：${st.date}`);
      if (st.notes) lines.push('', st.notes);
      const pick = await modalDialog({
        message: `发现新版本 v${st.version}`,
        detail: lines.join('\n'),
        buttons: ['立即升级', '稍后'],
      });
      if (pick !== 0) return;

      const ui = progressUI(`正在升级到 v${st.version}…`);
      let un = null;
      try {
        un = await listen('update-progress', (e) => ui.set(e.payload));
        await invoke('install_update');
        ui.set({ done: true });
      } catch (e) {
        if (un) un();
        ui.close();
        await modalDialog({ message: '升级失败', detail: String((e && e.message) || e), buttons: ['好'] });
      }
    } catch (e) {
      await modalDialog({ message: '检查更新失败', detail: String((e && e.message) || e), buttons: ['好'] });
    } finally {
      updating = false;
      updateBtn.classList.remove('busy');
    }
  }

  /* ---------- 拖放（Tauri 系统级，拿得到真实路径） ---------- */
  cur.onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === 'drop' && Array.isArray(p.paths) && p.paths.length) {
      fire('dropped-path', p.paths[0]);
    }
  });

  /* ---------- 文本拖放兜底（HTML5） ---------- */
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    const text = dt.getData && dt.getData('text/plain');
    if (text) fire('dropped-text', { name: null, text });
  });
})();
