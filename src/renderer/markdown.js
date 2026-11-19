/*
 * 轻量 Markdown 渲染引擎（零依赖，纯本地）
 * 支持：标题 / 粗体 / 斜体 / 删除线 / 行内代码 / 代码块 / 引用 / 有序无序列表 /
 *       嵌套列表 / 任务列表 / 表格（含对齐）/ 分割线 / 链接 / 图片 / 自动链接
 * 所有原始 HTML 均被转义，避免脚本注入。
 */
(function (global) {
  'use strict';

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  function safeUrl(u) {
    const t = String(u).trim();
    const flat = t.replace(/[\s\u0000-\u001f]/g, '');
    if (/^(javascript|vbscript|data):/i.test(flat)) return '#';
    return escapeHtml(t);
  }

  const PH = '\u0000';

  /* ------------------------- 行内渲染 ------------------------- */
  function renderInline(text) {
    let s = escapeHtml(text);
    const slots = [];
    const put = (html) => { slots.push(html); return PH + (slots.length - 1) + PH; };

    // 行内代码（先摘出来，避免内部语法被解析）
    s = s.replace(/(`+)([\s\S]*?)\1/g, (_m, _t, code) => put('<code>' + code.replace(/^ | $/g, '') + '</code>'));

    // 图片
    s = s.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)\s*\)/g,
      (_m, alt, src) => put('<img src="' + safeUrl(src) + '" alt="' + alt + '" loading="lazy">'));

    // 链接
    s = s.replace(/\[([^\]]+)\]\(\s*([^\s)]+)\s*\)/g,
      (_m, label, href) => put('<a href="' + safeUrl(href) + '" title="' + href + '">' + label + '</a>'));

    // 裸链接
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)\]]+)/g,
      (_m, pre, url) => pre + put('<a href="' + safeUrl(url) + '">' + url + '</a>'));

    // 强调
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w_])__([^_\n]+)__/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 还原占位符
    s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => slots[Number(i)]);
    return s;
  }

  function inlineWithBreaks(text) {
    return renderInline(text).replace(/\n/g, '<br>');
  }

  /* ------------------------- 块级解析 ------------------------- */
  const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
  const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const RE_QUOTE = /^\s{0,3}>\s?/;
  const RE_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
  const RE_TASK = /^\[([ xX])\]\s+/;

  function isTableSep(line) {
    if (!line || !line.includes('|')) return false;
    const cells = splitRow(line);
    return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function parseBlocks(lines, base) {
    base = base || 0;
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 空行
      if (/^\s*$/.test(line)) { i++; continue; }

      // 代码块
      let m = RE_FENCE.exec(line);
      if (m) {
        const fenceChar = m[2][0];
        const fenceLen = m[2].length;
        const lang = m[3] || '';
        const closer = new RegExp('^\\s*' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}\\s*$');
        const buf = [];
        i++;
        while (i < lines.length && !closer.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过闭合行
        out.push(
          '<div class="code-wrap">' +
          (lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '') +
          '<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre></div>'
        );
        continue;
      }

      // 分割线
      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      // 标题（带原始行号，供大纲跳转用）
      m = RE_HEADING.exec(line);
      if (m) {
        const lv = m[1].length;
        out.push('<h' + lv + ' data-line="' + (base + i) + '">' + renderInline(m[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 引用
      if (RE_QUOTE.test(line)) {
        const buf = [];
        const startAt = i;
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          buf.push(lines[i].replace(RE_QUOTE, ''));
          i++;
        }
        out.push('<blockquote>' + parseBlocks(buf, base + startAt) + '</blockquote>');
        continue;
      }

      // 表格
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map((c) => {
          const t = c.trim();
          if (/^:-+:$/.test(t)) return 'center';
          if (/^:-+$/.test(t)) return 'left';
          if (/^-+:$/.test(t)) return 'right';
          return '';
        });
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        const cell = (tag, txt, idx) => {
          const al = aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '';
          return '<' + tag + al + '>' + renderInline(txt) + '</' + tag + '>';
        };
        let html = '<div class="table-wrap"><table><thead><tr>';
        head.forEach((c, idx) => { html += cell('th', c, idx); });
        html += '</tr></thead><tbody>';
        rows.forEach((r) => {
          html += '<tr>';
          for (let k = 0; k < head.length; k++) html += cell('td', r[k] == null ? '' : r[k], k);
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        out.push(html);
        continue;
      }

      // 列表
      if (RE_ITEM.test(line)) {
        const r = parseList(lines, i, base);
        out.push(r.html);
        i = r.next;
        continue;
      }

      // 段落
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i])) {
        const l = lines[i];
        if (RE_FENCE.test(l) || RE_HEADING.test(l) || RE_HR.test(l) || RE_QUOTE.test(l) || RE_ITEM.test(l)) break;
        if (l.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
        buf.push(l);
        i++;
      }
      if (buf.length) out.push('<p>' + inlineWithBreaks(buf.join('\n')) + '</p>');
      else i++; // 防死循环
    }

    return out.join('\n');
  }

  function parseList(lines, start, base) {
    base = base || 0;
    const m0 = RE_ITEM.exec(lines[start]);
    const baseIndent = m0[1].length;
    const ordered = /\d/.test(m0[2]);
    const startNum = ordered ? parseInt(m0[2], 10) : 1;

    const items = [];
    let i = start;

    while (i < lines.length) {
      const m = RE_ITEM.exec(lines[i]);
      if (!m || m[1].length !== baseIndent || (/\d/.test(m[2])) !== ordered) break;

      const contentIndent = m[1].length + m[2].length + m[3].length;
      const content = m[4];
      i++;

      // 收集该列表项的后续行（子内容）
      const children = [];
      let childStart = -1;
      while (i < lines.length) {
        const l = lines[i];
        if (/^\s*$/.test(l)) {
          let j = i;
          while (j < lines.length && /^\s*$/.test(lines[j])) j++;
          if (j < lines.length) {
            const ind = lines[j].match(/^[ \t]*/)[0].length;
            if (ind >= contentIndent || (RE_ITEM.test(lines[j]) && ind > baseIndent)) {
              if (childStart < 0) childStart = i;
              for (let k = i; k < j; k++) children.push('');
              i = j;
              continue;
            }
          }
          break;
        }
        const ind = l.match(/^[ \t]*/)[0].length;
        if (ind >= contentIndent) {
          if (childStart < 0) childStart = i;
          children.push(l.slice(Math.min(ind, contentIndent)));
          i++;
          continue;
        }
        if (ind > baseIndent) {
          if (childStart < 0) childStart = i;
          children.push(l.trim());
          i++;
          continue;
        }
        break;
      }

      items.push({ content, children, childStart });
    }

    let html = ordered
      ? '<ol' + (startNum !== 1 ? ' start="' + startNum + '"' : '') + '>'
      : '<ul>';

    for (const it of items) {
      let inner;
      let cls = '';
      const task = RE_TASK.exec(it.content);
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        inner = '<input type="checkbox" disabled' + (checked ? ' checked' : '') + '> ' +
          renderInline(it.content.replace(RE_TASK, ''));
        cls = ' class="task-item"';
      } else {
        inner = renderInline(it.content);
      }
      html += '<li' + cls + '>' + inner;
      if (it.children.length) {
        html += parseBlocks(it.children, base + (it.childStart >= 0 ? it.childStart : 0));
      }
      html += '</li>';
    }

    html += ordered ? '</ol>' : '</ul>';
    return { html, next: i };
  }

  function render(md) {
    const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    return parseBlocks(lines);
  }

  /* ------------------------- 统计信息 ------------------------- */
  function stats(md) {
    const text = String(md || '');
    const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
    const words = (text.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9_'’-]+/g) || []).length;
    const lines = text.split('\n').length;
    const headings = (text.match(/^\s{0,3}#{1,6}\s+\S/gm) || []).length;
    return { chars: text.length, words: cjk + words, lines, headings };
  }

  global.MD = { render, stats, escapeHtml };
})(window);
