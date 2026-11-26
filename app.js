/* Life — big boards for the parts of your life.
   Data lives in localStorage and optionally syncs through a secret GitHub Gist.
   Every record carries an `updated` timestamp; deletes are kept as tombstones,
   so changes from several devices merge instead of overwriting each other. */
(() => {
  const KEY = 'life-dashboard-v1';
  const SYNC_KEY = 'life-sync';
  const FILE = 'life-dashboard.json';
  const $ = (s, el = document) => el.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => Date.now();
  const dayKey = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const live = arr => arr.filter(x => !x.deleted);
  // Stable id from a name, so two fresh devices create the *same* default boards.
  const boardIdFor = name => 'b-' + String(name).trim().toLowerCase().replace(/\s+/g, '-');

  const DEFAULT_BOARDS = ['Study', 'Work', 'Personal', 'Health'];
  const COLORS = ['grey', 'sage', 'clay', 'lilac', 'mist', 'sand', 'stone', 'white'];
  const colorFor = i => COLORS[i % (COLORS.length - 1)];
  const defaults = () => ({
    boards: DEFAULT_BOARDS.map((name, i) => ({ id: boardIdFor(name), name, order: i, color: colorFor(i), updated: 0 })),
    pages: [{ id: 'p-home', name: 'Home', order: 0, updated: 0 }], // fixed id so fresh devices agree
    tasks: [],   // items: {id, boardId, type: task|note|heading|bullet, title, due, done, doneOn, pos, created, updated, deleted?}
    theme: null, // per device, never synced
  });

  // Bring older saved data (from the tabbed version) up to the current shape.
  const migrate = raw => {
    const s = Object.assign(defaults(), raw || {});
    if (!raw?.boards) {
      const names = raw?.areas?.length ? raw.areas : DEFAULT_BOARDS;
      s.boards = names.map((name, i) => ({ id: boardIdFor(name), name, order: i, updated: raw?.areasUpdated || 0 }));
    }
    s.boards.forEach((b, i) => { if (!COLORS.includes(b.color)) b.color = colorFor(b.order ?? i); });
    if (!Array.isArray(s.pages)) s.pages = [];
    if (!s.pages.some(p => !p.deleted)) s.pages.push({ id: 'p-home', name: 'Home', order: 0, updated: 0 });
    const firstPage = s.pages.filter(p => !p.deleted).sort((a, b) => a.order - b.order)[0].id;
    s.boards.forEach(b => { if (!b.pageId || !s.pages.some(p => p.id === b.pageId && !p.deleted)) b.pageId = firstPage; });
    s.tasks.forEach(t => {
      t.updated ??= t.created || 0;
      t.type ??= 'task';
      t.pos ??= t.created || 0;
      if (!t.boardId) t.boardId = boardIdFor(t.area || s.boards[0]?.name || 'Tasks');
      if (!s.boards.some(b => b.id === t.boardId)) // task points at a board we don't have: recreate it
        s.boards.push({ id: t.boardId, name: t.area || 'Tasks', order: s.boards.length, color: colorFor(s.boards.length), updated: 0 });
    });
    return s;
  };

  let S;
  try { S = migrate(JSON.parse(localStorage.getItem(KEY))); } catch { S = defaults(); }
  // Undo the short-lived 'all boards gray' version: give gray boards their colours back once.
  if (S.grayBoards && !S.colorsBack) {
    live(S.boards).sort((a, b) => a.order - b.order).forEach((b, i) => { if (b.color === 'grey') { b.color = colorFor(i); b.updated = now(); } });
    S.colorsBack = true; localStorage.setItem(KEY, JSON.stringify(S));
  }
  const store = () => localStorage.setItem(KEY, JSON.stringify(S));
  const save = () => { store(); scheduleSync(); };

  /* ---------- theme ---------- */
  const applyTheme = () => {
    const dark = S.theme ? S.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
    $('meta[name=theme-color]').content = '#111416'; // matches the black navigation bar
  };
  $('#themeBtn').onclick = () => {
    S.theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    store(); applyTheme();
  };

  /* ---------- render ---------- */
  const pages = () => live(S.pages).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  let page = decodeURIComponent(location.hash.slice(1)) || localStorage.getItem('life-page') || '';
  const currentPage = () => {
    if (!pages().some(p => p.id === page)) page = pages()[0].id;
    return page;
  };
  const allBoards = () => live(S.boards).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const boards = () => allBoards().filter(b => b.pageId === currentPage());
  const isTask = t => (t.type || 'task') === 'task';
  // Items keep the order you give them. Finished tasks stay crossed out for the rest of the day, then tidy away.
  const visibleItems = boardId => {
    const today = dayKey();
    return live(S.tasks)
      .filter(t => t.boardId === boardId && (!isTask(t) || !t.done || t.doneOn === today))
      // an empty line only shows on the device where someone is writing in it
      .filter(t => t.title || t.id === keepId || t.id === document.activeElement?.closest?.('[data-id]')?.dataset.id)
      .sort((a, b) => a.pos - b.pos || a.created - b.created);
  };
  let keepId = null; // the empty line currently being written in
  const nextPos = boardId => Math.max(-1, ...S.tasks.filter(t => t.boardId === boardId).map(t => t.pos)) + 1;

  /* ---------- deadlines ---------- */
  // t.due is 'YYYY-MM-DD' (whole day) or 'YYYY-MM-DDTHH:MM' (exact time), or null.
  const dueDate = due => due.length > 10 ? new Date(due) : new Date(due + 'T23:59:59');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const dueInfo = t => {
    if (!t.due || !isTask(t)) return null;
    const hasTime = t.due.length > 10, d = dueDate(t.due);
    const dayDiff = Math.round((new Date(t.due.slice(0, 10) + 'T00:00') - new Date(dayKey() + 'T00:00')) / 864e5);
    const when = (Math.abs(dayDiff) < 7
      ? (dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : dayDiff === -1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short' }))
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) }))
      + (hasTime ? ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
    if (t.done) return { when, left: '', level: 'done' };
    let left, level;
    const ms = d - now();
    if (hasTime && Math.abs(dayDiff) <= 1) {
      const mins = Math.round(Math.abs(ms) / 60000), h = Math.floor(mins / 60);
      const span = h >= 1 ? `${h} h${mins % 60 && h < 10 ? ' ' + (mins % 60) + ' min' : ''}` : `${mins} min`;
      left = ms < 0 ? `${span} late` : `${span} left`;
      level = ms < 0 ? 'late' : ms < 864e5 ? 'soon' : 'later';
    } else if (dayDiff < 0) { left = `${plural(-dayDiff, 'day')} late`; level = 'late'; }
    else if (dayDiff === 0) return hasTime && ms < 0 ? { when, left: 'late', level: 'late' } : { when: '', left: 'Due today', level: 'soon' };
    else if (dayDiff === 1) { left = '1 day left'; level = 'soon'; }
    else if (dayDiff < 14) { left = `${dayDiff} days left`; level = 'later'; }
    else { const w = Math.round(dayDiff / 7); left = dayDiff < 60 ? `${plural(w, 'week')} left` : `${plural(Math.round(dayDiff / 30), 'month')} left`; level = 'later'; }
    return { when, left, level };
  };
  const clockIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const gripIcon = '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="2" cy="3" r="1.4"/><circle cx="8" cy="3" r="1.4"/><circle cx="2" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="2" cy="13" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>';
  const dueFields = due => `
    <input type="date" name="date" value="${due ? due.slice(0, 10) : ''}" aria-label="Deadline date">
    <input type="time" name="time" value="${due && due.length > 10 ? due.slice(11, 16) : ''}" aria-label="Deadline time (optional)">`;
  const readDue = (date, time) => (date ? date + (time ? 'T' + time : '') : null);

  /* ---------- bold text ----------
     A line is stored as plain text (title) plus, when it has bold parts, a tiny
     safe HTML string (rich) that only ever contains escaped text, <b> and <br>. */
  // Right-to-left if the first letter is Persian/Arabic/Hebrew, so a Farsi line's checkbox sits on the right.
  const RTL_FIRST = /^[^A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]*[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  const dirOf = text => (RTL_FIRST.test(text || '') ? 'rtl' : 'ltr');
  const isBold = n => n.nodeName === 'B' || n.nodeName === 'STRONG' || /^(bold|bolder|[6-9]00)$/.test(n.style?.fontWeight || '');
  const toRich = (node, inBold = false) => {
    let out = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out += esc(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      if (n.nodeName === 'BR') { out += '<br>'; return; }
      if (/^(DIV|P)$/.test(n.nodeName) && out && !out.endsWith('<br>')) out += '<br>';
      const bold = !inBold && isBold(n), inner = toRich(n, inBold || bold);
      out += bold ? (inner ? `<b>${inner}</b>` : '') : inner;
    });
    return out;
  };
  const cleanRich = html => html.replace(/(<br>)+$/, '').replace(/<\/b><b>/g, '');
  // Re-check stored HTML before showing it, so nothing but text, <b> and <br> can ever render.
  const showRich = html => { const tpl = document.createElement('template'); tpl.innerHTML = html; return cleanRich(toRich(tpl.content)); };
  // Read what's in a line being edited into the item.
  const readLine = (el, t) => {
    const rich = cleanRich(toRich(el));
    const plain = el.innerText.replace(/\n+$/, '');
    t.title = typeOf(t) === 'note' ? plain.replace(/^\s+|\s+$/g, '') : plain.replace(/\s+/g, ' ').trim();
    t.rich = rich.includes('<b>') ? rich : null;
  };

  /* ---------- notepad pages ----------
     A notepad page is a list of blocks: paragraph, two heading sizes, bullet and numbered
     lists, tasks, quotes and drawings. It's stored as tiny HTML that is always rebuilt by
     readBlocks(), so it can only ever contain escaped text, <b> <i> <u> <br>, our block <div>s
     and drawings whose image is a checked data:image URL. Every block picks its own
     direction (dir="auto"), so Farsi lines run right-to-left and English left-to-right. */
  const BLOCKS = ['p', 'h1', 'h2', 'ul', 'ol', 'todo', 'quote'];
  const MARK = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u' };
  const markOf = n => MARK[n.nodeName] || (isBold(n) ? 'b' : /italic/.test(n.style?.fontStyle || '') ? 'i'
    : /underline/.test(n.style?.textDecorationLine || n.style?.textDecoration || '') ? 'u' : null);
  const SRC_OK = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
  const BLOCK_TAG = /^(DIV|P|H[1-6]|LI|BLOCKQUOTE|UL|OL|SECTION|ARTICLE|FIGURE|PRE)$/;
  const isBlockEl = n => n.nodeType === 1 && BLOCK_TAG.test(n.nodeName);
  const inlineOf = n => {
    if (n.nodeType === 3) return esc(n.nodeValue);
    if (n.nodeType !== 1 || /^(FIGURE|BUTTON|IMG|STYLE|SCRIPT)$/.test(n.nodeName)) return '';
    if (n.nodeName === 'BR') return '<br>';
    const inner = [...n.childNodes].map(inlineOf).join('');
    const tag = markOf(n);
    return (isBlockEl(n) ? '<br>' : '') + (tag && inner ? `<${tag}>${inner}</${tag}>` : inner);
  };
  const trimBr = h => h.replace(/^(<br>)+|(<br>)+$/g, '');
  // Read the editor (or stored HTML) into a clean list of blocks.
  const readBlocks = root => {
    const out = []; let run = null;
    const flush = () => { if (run !== null) { out.push({ t: 'p', html: trimBr(run) }); run = null; } };
    const walk = parent => parent.childNodes.forEach(n => {
      if (n.nodeType === 1 && n.nodeName === 'FIGURE') {
        flush(); const src = n.getAttribute('data-src') ?? n.querySelector('img')?.getAttribute('src') ?? '';
        if (src === '' || SRC_OK.test(src)) out.push({ t: 'sketch', src }); return;
      }
      if (isBlockEl(n)) {
        flush();
        if ([...n.childNodes].some(isBlockEl)) return walk(n); // a wrapper: read what's inside
        const pt = n.parentNode?.nodeName;
        const t = BLOCKS.includes(n.dataset?.t) ? n.dataset.t
          : n.nodeName === 'H1' ? 'h1' : /^H[2-6]$/.test(n.nodeName) ? 'h2' : n.nodeName === 'BLOCKQUOTE' ? 'quote'
          : n.nodeName === 'LI' ? (pt === 'OL' ? 'ol' : 'ul') : 'p';
        const dir = n.getAttribute?.('dir');
        out.push({ t, c: t === 'todo' && n.dataset?.c === '1', dir: dir === 'rtl' || dir === 'ltr' ? dir : '', html: trimBr([...n.childNodes].map(inlineOf).join('')) });
        return;
      }
      if (n.nodeType === 1 && n.nodeName === 'BR') { if (run === null) out.push({ t: 'p', html: '' }); else flush(); return; }
      const h = inlineOf(n); if (h) run = (run || '') + h;
    });
    walk(root); flush();
    return out;
  };
  const blockHTML = b => b.t === 'sketch'
    ? `<figure class="sketch" contenteditable="false" data-src="${b.src}">${sketchBar()}<canvas class="sk-canvas" aria-label="Drawing area"></canvas></figure>`
    : `<div data-t="${b.t}"${b.c ? ' data-c="1"' : ''} dir="${b.dir || 'auto'}">${b.html || '<br>'}</div>`;
  const parseDoc = html => { const tpl = document.createElement('template'); tpl.innerHTML = html || ''; return readBlocks(tpl.content); };
  const docHTML = blocks => (blocks.length ? blocks : [{ t: 'p' }]).map(blockHTML).join('');
  const docPage = () => S.pages.find(p => p.id === currentPage());
  const body = () => $('#docBody');
  const blockText = () => [...body().querySelectorAll('[data-t]')].map(b => b.innerText).join('\n').trim();
  const wordCount = () => { const t = blockText(), n = t ? t.split(/\s+/).length : 0; return `${n} word${n === 1 ? '' : 's'}`; };
  const isEmptyDoc = () => !blockText() && !body().querySelector('figure');
  const refreshDocUI = () => { body().classList.toggle('empty-doc', isEmptyDoc()); $('#summary').textContent = wordCount(); };
  let shownDoc = null;
  const renderDoc = () => {
    const p = docPage(), key = p.id + '\n' + (p.doc || '');
    if (document.activeElement !== body() && !pen && key !== shownDoc) { body().innerHTML = docHTML(parseDoc(p.doc)); shownDoc = key; }
    hydrateSketches(); refreshDocUI();
  };
  let docTimer;
  const saveDoc = (now_ = false) => {
    clearTimeout(docTimer);
    const run = () => { const p = docPage(); if (!p || p.kind !== 'doc') return; const html = readBlocks(body()).map(blockHTML).join('');
      if (p.doc !== html) { p.doc = html; p.updated = now(); save(); } shownDoc = p.id + '\n' + html; };
    now_ ? run() : (docTimer = setTimeout(run, 400));
  };
  // The block (direct child of the editor) that holds the cursor.
  const blockOf = n => { while (n && n.parentNode !== body()) n = n.parentNode; return n && n.nodeType === 1 ? n : null; };
  const curBlock = () => blockOf(getSelection().anchorNode);
  const selectedBlocks = () => {
    const sel = getSelection(); if (!sel.rangeCount) return [];
    const a = blockOf(sel.getRangeAt(0).startContainer), z = blockOf(sel.getRangeAt(0).endContainer);
    if (!a) return [];
    const list = []; for (let n = a; n; n = n.nextElementSibling) { if (n.dataset.t) list.push(n); if (n === z) break; }
    return list;
  };
  const caretAt = (node, offset) => { const r = document.createRange(); r.setStart(node, offset); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  // Keep the editor made of block <div>s (typing into an emptied editor makes bare text).
  const normalize = () => {
    const b = body(), sel = getSelection(), an = sel.anchorNode, ao = sel.anchorOffset;
    let wrap = null;
    [...b.childNodes].forEach(n => {
      if (n.nodeType === 1 && (n.dataset?.t || n.nodeName === 'FIGURE')) { wrap = null; return; }
      if (n.nodeType === 1 && isBlockEl(n)) { n.dataset.t = 'p'; n.setAttribute('dir', 'auto'); wrap = null; return; }
      if (!wrap) { wrap = document.createElement('div'); wrap.dataset.t = 'p'; wrap.dir = 'auto'; b.insertBefore(wrap, n); }
      wrap.appendChild(n);
    });
    if (!b.firstChild) b.innerHTML = blockHTML({ t: 'p' });
    if (an && b.contains(an)) try { caretAt(an, ao); } catch {}
  };
  const setBlockType = (blocks, t) => {
    const all = blocks.every(b => b.dataset.t === t);
    blocks.forEach(b => { b.dataset.t = all && t !== 'p' ? 'p' : t; if (b.dataset.t !== 'todo') delete b.dataset.c; });
    saveDoc(); refreshDocUI();
  };
  // Markdown-style shortcuts at the start of a line.
  const DOC_SHORTCUTS = [[/^##\s/, 'h2'], [/^#\s/, 'h1'], [/^[-*•]\s/, 'ul'], [/^1[.)]\s/, 'ol'], [/^\[\s?\]\s/, 'todo'], [/^>\s/, 'quote']];
  const deleteFirstChars = (block, k) => {
    const tw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); let n, left = k;
    const r = document.createRange(); r.setStart(block, 0);
    while ((n = tw.nextNode())) { if (n.nodeValue.length >= left) { r.setEnd(n, left); break; } left -= n.nodeValue.length; }
    r.deleteContents();
  };

  $('#docBody').addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'div'));
  $('#docBody').addEventListener('input', e => {
    normalize();
    const blk = curBlock();
    if (blk && e.inputType === 'insertParagraph') {
      // a new line after a heading is plain text; a new task starts unticked
      if (blk.dataset.t === 'h1' || blk.dataset.t === 'h2') blk.dataset.t = 'p';
      delete blk.dataset.c;
    }
    if (blk && blk.dataset.t && e.inputType === 'insertText') {
      const text = blk.textContent, hit = DOC_SHORTCUTS.find(([re]) => re.test(text));
      if (hit && (blk.dataset.t === 'p' || blk.dataset.t !== hit[1])) { deleteFirstChars(blk, text.match(hit[0])[0].length); blk.dataset.t = hit[1]; if (!blk.firstChild) blk.innerHTML = '<br>'; caretAt(blk, 0); }
    }
    refreshDocUI(); saveDoc();
  });
  $('#docBody').addEventListener('keydown', e => {
    const blk = curBlock(); if (!blk) return;
    const t = blk.dataset.t, empty = !blk.textContent;
    if (e.key === 'Enter' && !e.shiftKey && empty && ['ul', 'ol', 'todo', 'quote'].includes(t)) { e.preventDefault(); setBlockType([blk], 'p'); return; }
    if (e.key === 'Backspace' && t && t !== 'p') {
      const sel = getSelection(), r = sel.rangeCount && sel.getRangeAt(0);
      if (r && r.collapsed) { const pre = document.createRange(); pre.setStart(blk, 0); pre.setEnd(r.startContainer, r.startOffset);
        if (!pre.toString()) { e.preventDefault(); setBlockType([blk], 'p'); return; } } // Backspace at the start undoes the list/heading
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault(); document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]); saveDoc();
    }
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '\t'); }
  });
  $('#docBody').addEventListener('focusout', () => { saveDoc(true); if (renderPending) setTimeout(() => { if (!editing()) render(); }, 0); });
  $('#docBody').addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || ''); });
  // Tick tasks; edit or delete drawings.
  $('#docBody').addEventListener('click', e => {
    const skBtn = e.target.closest('[data-sk]');
    if (skBtn) return sketchAction(skBtn);
    const blk = e.target.closest('[data-t=todo]'); if (!blk || blk.parentNode !== body()) return;
    const r = blk.getBoundingClientRect(), rtl = getComputedStyle(blk).direction === 'rtl';
    if (rtl ? e.clientX > r.right - 30 : e.clientX < r.left + 30) {
      if (blk.dataset.c) delete blk.dataset.c; else blk.dataset.c = '1';
      saveDoc(true);
    }
  });
  $('#doc').addEventListener('click', e => {
    if (e.target.id !== 'doc' && !e.target.classList.contains('doc-paper')) return;
    const last = body().lastElementChild; body().focus();
    if (last) { const r = document.createRange(); r.selectNodeContents(last); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); }
  });
  // Toolbar: keep the text selection while clicking it.
  $('#docTools').addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
  $('#docBody').addEventListener('pointerdown', e => { if (e.target.closest('.sk-bar')) e.preventDefault(); });
  $('#docTools').addEventListener('click', e => {
    const btn = e.target.closest('button[data-cmd]'); if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (document.activeElement !== body()) { body().focus(); }
    let blocks = selectedBlocks(); if (!blocks.length) { normalize(); blocks = [body().lastElementChild].filter(b => b?.dataset.t); }
    if (BLOCKS.includes(cmd)) return setBlockType(blocks, cmd);
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') { document.execCommand(cmd); return saveDoc(); }
    if (cmd === 'dir') { // auto → right-to-left → left-to-right → auto
      const next = { auto: 'rtl', rtl: 'ltr', ltr: 'auto' }[blocks[0]?.getAttribute('dir') || 'auto'];
      blocks.forEach(b => b.setAttribute('dir', next)); return saveDoc(true);
    }
    if (cmd === 'draw') return insertSketch(blocks.at(-1));
  });

  /* ---------- drawing right on the page ----------
     A drawing is a block with a canvas you draw on directly. After each stroke the
     picture is kept in the block (data-src, a checked data:image URL) and saved. */
  const PEN_COLORS = [['#1f2328', 'Black'], ['#8b9198', 'Gray'], ['#d64545', 'Red'], ['#2f6fd1', 'Blue'], ['#2f9e5a', 'Green'], ['#e8a317', 'Yellow']];
  const PEN_SIZES = [[2, 4, 'Thin'], [4, 7, 'Medium'], [9, 12, 'Thick']];
  const tool = { color: '#1f2328', size: 4, erase: false };
  const sketchBar = () => `<div class="sk-bar" contenteditable="false">${PEN_COLORS.map(([c, n]) =>
      `<button type="button" class="sk-dot${!tool.erase && c === tool.color ? ' on' : ''}" data-sk="color" data-v="${c}" style="--c:${c}" aria-label="${n}"></button>`).join('')}
    <span class="sep"></span>${PEN_SIZES.map(([s, d, n]) =>
      `<button type="button" class="sk-size${s === tool.size ? ' on' : ''}" data-sk="size" data-v="${s}" style="--d:${d}px" aria-label="${n}"></button>`).join('')}
    <span class="sep"></span><button type="button" data-sk="erase" class="${tool.erase ? 'on' : ''}">Eraser</button><button type="button" data-sk="undo">Undo</button><button type="button" data-sk="clear">Clear</button>
    <button type="button" class="sk-del" data-sk="del" aria-label="Delete drawing" title="Delete drawing">×</button></div>`;
  const syncBars = () => body().querySelectorAll('.sk-bar').forEach(bar => {
    bar.querySelectorAll('[data-sk=color]').forEach(b => b.classList.toggle('on', !tool.erase && b.dataset.v === tool.color));
    bar.querySelectorAll('[data-sk=size]').forEach(b => b.classList.toggle('on', +b.dataset.v === tool.size));
    bar.querySelector('[data-sk=erase]').classList.toggle('on', tool.erase);
  });
  // Size each canvas to its block and paint the saved picture back onto it.
  const hydrateSketches = (force = false) => body().querySelectorAll('figure.sketch').forEach(fig => {
    const cv = fig.querySelector('canvas'); const w = cv?.clientWidth; if (!w || (!force && +cv.dataset.w === w)) return;
    const dpr = Math.min(2, devicePixelRatio || 1), src = fig.dataset.src;
    const setup = ratio => { const h = Math.round(w * ratio); cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.dataset.w = w; };
    if (src) { const img = new Image(); img.onload = () => { setup(img.naturalHeight / img.naturalWidth); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); }; img.src = src; }
    else setup(innerWidth < 640 ? 0.8 : 0.5);
  });
  let resizeT; addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => isDocPage() && hydrateSketches(true), 200); });
  const undoStack = new WeakMap(); // figure → earlier pictures, for Undo
  const paintSrc = (fig, src) => {
    const cv = fig.querySelector('canvas'), ctx = cv.getContext('2d');
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, cv.width, cv.height);
    fig.dataset.src = src || '';
    if (src) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, cv.width, cv.height); img.src = src; }
    saveDoc(true);
  };
  let pen = null;
  $('#docBody').addEventListener('pointerdown', e => {
    const cv = e.target.closest('canvas.sk-canvas'); if (!cv || e.button > 0) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const fig = cv.closest('figure'), ctx = cv.getContext('2d'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
    (undoStack.get(fig) || undoStack.set(fig, []).get(fig)).push(fig.dataset.src || '');
    ctx.globalCompositeOperation = tool.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = tool.color; ctx.lineWidth = (tool.erase ? tool.size * 4 : tool.size) * k; ctx.lineCap = ctx.lineJoin = 'round';
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + .1, y); ctx.stroke();
    pen = { cv, ctx, fig, r, k, x, y };
  });
  addEventListener('pointermove', e => {
    if (!pen) return;
    const { ctx, r, k } = pen, x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    ctx.beginPath(); ctx.moveTo(pen.x, pen.y); ctx.lineTo(x, y); ctx.stroke(); pen.x = x; pen.y = y;
  });
  const penUp = () => { if (!pen) return; const { cv, fig } = pen; pen = null; fig.dataset.src = cv.toDataURL('image/png'); saveDoc(true); };
  addEventListener('pointerup', penUp); addEventListener('pointercancel', penUp);
  const sketchAction = (btn) => {
    const fig = btn.closest('figure'), act = btn.dataset.sk;
    if (act === 'color') { tool.color = btn.dataset.v; tool.erase = false; }
    else if (act === 'size') tool.size = +btn.dataset.v;
    else if (act === 'erase') tool.erase = !tool.erase;
    else if (act === 'undo') { const st = undoStack.get(fig); if (st?.length) paintSrc(fig, st.pop()); }
    else if (act === 'clear') { if (fig.dataset.src && confirm('Clear this drawing?')) { (undoStack.get(fig) || undoStack.set(fig, []).get(fig)).push(fig.dataset.src); paintSrc(fig, ''); } }
    else if (act === 'del') { if (!fig.dataset.src || confirm('Delete this drawing?')) { fig.remove(); normalize(); saveDoc(true); refreshDocUI(); } }
    syncBars();
  };
  // Put a new drawing area after the line you're on, with a fresh line under it to keep writing.
  const insertSketch = after => {
    const holder = document.createElement('template'); holder.innerHTML = blockHTML({ t: 'sketch', src: '' }) + blockHTML({ t: 'p' });
    const fig = holder.content.firstChild, nextLine = holder.content.lastChild;
    body().insertBefore(holder.content, after && after.parentNode === body() ? after.nextSibling : null);
    body().focus(); caretAt(nextLine, 0); // keep writing under the drawing
    hydrateSketches(); refreshDocUI(); saveDoc(true);
    fig.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  /* ---------- item types ---------- */
  // 'note' is a plain paragraph of text (shown as "Text").
  const TYPES = {
    note:    { label: 'Text',    ph: 'Write…   [] task   - list   # heading' },
    task:    { label: 'Task',    ph: 'Task' },
    bullet:  { label: 'List',    ph: 'List item' },
    heading: { label: 'Heading', ph: 'Heading' },
  };
  const typeOf = t => (TYPES[t.type] ? t.type : 'task');
  // Typing one of these at the start of a line turns it into that kind of item.
  const SHORTCUTS = [[/^#{1,3}\s/, 'heading'], [/^[-*•]\s/, 'bullet'], [/^\[\s?\]\s/, 'task']];

  let renamingPage = null, addMenu = false;
  // Each page gets its own colour, in tab order, so neighbouring tabs always differ.
  const PAGE_COLORS = ['#7cc4ff', '#6fdc9a', '#ff8fab', '#b9a4ff', '#ffc566', '#ff9f7a'];
  const pageColor = id => PAGE_COLORS[Math.max(0, pages().findIndex(p => p.id === id)) % PAGE_COLORS.length];
  const renderNav = () => {
    const cur = currentPage();
    $('#pages').innerHTML = pages().map(p => p.id === renamingPage
      ? `<input class="page-tab editing" data-page="${esc(p.id)}" value="${esc(p.name)}" size="${Math.max(4, [...p.name].length + 1)}" maxlength="30" dir="auto" aria-label="Page name">`
      : `<button class="page-tab ${p.id === cur ? 'on' : ''}" style="--pc:${pageColor(p.id)}" role="tab" aria-selected="${p.id === cur}" data-page="${esc(p.id)}" title="Double-click to rename">
           <span class="tab-icon ${p.kind === 'doc' ? 'pen' : 'dot'}" aria-hidden="true">${p.kind === 'doc' ? '✎' : ''}</span><span dir="auto">${esc(p.name)}</span>${p.id === cur && pages().length > 1 ? '<span class="page-del" data-act="delpage" title="Delete page" aria-label="Delete page">×</span>' : ''}
         </button>`).join('') +
      '<button class="page-tab add" data-act="addmenu" title="New page" aria-label="New page">+</button>' +
      (addMenu ? `<span class="add-menu"><button class="page-tab" data-act="addpage" data-kind="boards">▦ Boards</button>
        <button class="page-tab" data-act="addpage" data-kind="doc">✎ Notepad</button></span>` : '');
    document.title = (pages().find(p => p.id === cur)?.name || 'Life') + ' · Life';
  };
  const goTo = id => {
    page = id; localStorage.setItem('life-page', id);
    history.replaceState(null, '', '#' + encodeURIComponent(id));
    picking = moving = null; render(); scrollTo({ top: 0 });
  };

  const header = () => {
    $('#date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    try { $('#dateFa').textContent = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); } catch {}
    if (isDocPage()) { $('#summary').textContent = wordCount(); return; }
    const ids = new Set(boards().map(b => b.id));
    const tasks = live(S.tasks).filter(t => isTask(t) && t.title && ids.has(t.boardId));
    const open = tasks.filter(t => !t.done).length;
    const doneToday = tasks.filter(t => t.doneOn === dayKey()).length;
    const late = tasks.filter(t => dueInfo(t)?.level === 'late').length;
    const today = tasks.filter(t => !t.done && t.due && t.due.slice(0, 10) === dayKey() && dueInfo(t).level !== 'late').length;
    $('#summary').textContent = `${open} to do` + (today ? ` · ${today} due today` : '') + (late ? ` · ${late} late` : '') +
      (doneToday ? ` · ${doneToday} done today` : '');
  };

  const itemHTML = t => {
    const type = typeOf(t);
    const handle = `<span class="handle" title="Drag to move" aria-hidden="true">${gripIcon}</span>`;
    const text = `<div class="text" contenteditable="true" dir="auto" spellcheck="false" data-ph="${esc(TYPES[type].ph)}">${t.rich ? showRich(t.rich) : esc(t.title)}</div>`;
    // Small bar under the line you're writing in, to switch what kind of line it is.
    const typebar = `<div class="typebar">${Object.entries(TYPES).map(([k, v]) =>
      `<button class="type ${k === type ? 'on' : ''}" data-act="settype" data-type="${k}" tabindex="-1">${v.label}</button>`).join('')}
      <button class="type size-btn bold-btn" data-act="tbold" tabindex="-1" aria-label="Bold"><b>B</b></button><button class="type size-btn" data-act="tsmaller" tabindex="-1" aria-label="Smaller text">A−</button><button class="type size-btn" data-act="tbigger" tabindex="-1" aria-label="Bigger text">A+</button></div>`;
    const del = `<button class="del" data-act="del" aria-label="Delete">×</button>`;
    if (type !== 'task') return `
      <li class="item ${type}" dir="${dirOf(t.title)}" data-id="${t.id}"${t.size && t.size !== 1 ? ` style="--z:${t.size}"` : ''}>
        ${handle}${type === 'bullet' ? '<span class="dot">•</span>' : ''}
        <div class="body">${text}${typebar}</div>${del}
      </li>`;
    const info = dueInfo(t);
    return `
      <li class="item task ${t.done ? 'done' : ''}" dir="${dirOf(t.title)}" data-id="${t.id}"${t.size && t.size !== 1 ? ` style="--z:${t.size}"` : ''}>
        ${handle}
        <button class="check" data-act="toggle" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${t.done ? '✓' : ''}</button>
        <div class="body">
          ${text}
          ${info ? `<button class="due ${info.level}" data-act="editdue">${[esc(info.when), info.left && `<b>${info.left}</b>`].filter(Boolean).join(' · ')}</button>` : ''}
          ${dueEditing === t.id ? `<form class="due-edit" data-form="due">${dueFields(t.due)}
            <button class="pill" type="submit">Save</button>
            ${t.due ? '<button class="pill ghost" type="button" data-act="cleardue">Remove</button>' : ''}
          </form>` : ''}
          ${typebar}
        </div>
        <button class="tool" data-act="editdue" title="Deadline" aria-label="Set deadline">${clockIcon}</button>
        ${del}
      </li>`;
  };

  const boardHTML = (b, i, n) => {
    const items = visibleItems(b.id);
    const open = items.filter(t => isTask(t) && !t.done && t.title).length;
    return `
      <section class="board" data-board="${esc(b.id)}" data-color="${b.color}" style="--board: var(--c-${b.color});${canvasMode() && b.x != null
        ? `left:${b.x}px;top:${b.y}px;width:${b.w || CARD_W}px;height:${b.h || CARD_H}px;z-index:${b.z || 1}` : ''}">
        <div class="board-head">
          <input class="board-name" value="${esc(b.name)}" size="${Math.max(4, [...b.name].length + 1)}" dir="auto" aria-label="Board name" maxlength="40">
          <div class="board-menu">
            <button class="swatch-btn" data-act="colors" title="Colour" aria-label="Change colour"></button>
            ${!canvasMode() && i > 0 ? '<button class="mini" data-act="left" title="Move earlier" aria-label="Move earlier">←</button>' : ''}
            ${!canvasMode() && i < n - 1 ? '<button class="mini" data-act="right" title="Move later" aria-label="Move later">→</button>' : ''}
            ${pages().length > 1 ? '<button class="mini" data-act="moving" title="Move to another page" aria-label="Move to another page">⇢</button>' : ''}
            <button class="mini" data-act="delboard" title="Delete board" aria-label="Delete board">×</button>
          </div>
          <span class="board-count">${open || ''}</span>
        </div>
        ${picking === b.id ? `<div class="swatches">${COLORS.map(c => `
          <button class="swatch ${c === b.color ? 'on' : ''}" data-act="color" data-color="${c}" style="background: var(--c-${c})" title="${c}" aria-label="${c}"></button>`).join('')}
        </div>` : ''}
        ${moving === b.id ? `<div class="move-to"><span class="muted">Move to</span>${pages().filter(p => p.id !== b.pageId).map(p =>
          `<button class="pill ghost" data-act="moveto" data-page="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>` : ''}
        <ul class="items">
          ${items.map(itemHTML).join('') || '<li class="empty">Tap anywhere to write.</li>'}
        </ul>
        <div class="write-here" aria-hidden="true"></div>
      </section>`;
  };

  let moving = null;
  let renderPending = false, picking = null, dueEditing = null, quiet = false;
  const editing = () => document.activeElement?.matches?.('#boards [contenteditable], #boards .board-name, #boards .due-edit input, #docBody') || !!drag || !!cardDrag || !!pen;
  const isDocPage = () => S.pages.find(p => p.id === currentPage())?.kind === 'doc';
  const render = () => {
    renderPending = false;
    renderNav();
    header();
    const docPage = isDocPage();
    document.body.classList.toggle('doc-mode', docPage);
    $('#doc').hidden = !docPage; $('#boards').hidden = docPage;
    if (docPage) return renderDoc();
    const list = boards();
    quiet = true; // re-drawing removes the line being edited; that's not the user leaving it
    const canvas = canvasMode();
    if (canvas) placeBoards(list);
    resizeWatch.disconnect();
    $('#boards').classList.toggle('canvas', canvas);
    $('#boards').innerHTML = list.map((b, i) => boardHTML(b, i, list.length)).join('') +
      (canvas ? '' : '<button class="new-board" data-act="newboard">+ New board</button>');
    if (canvas) { fitCanvas(); document.querySelectorAll('#boards .board').forEach(el => resizeWatch.observe(el)); }
    quiet = false;
  };

  /* ---------- text size ---------- */
  const SIZES = [0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
  // Size of one line, changed with Ctrl/⌘ + and Ctrl/⌘ − while the cursor is in it (0 resets).
  const resizeLine = (li, dir) => {
    const t = S.tasks.find(x => x.id === li?.dataset.id); if (!t) return;
    const i = dir === 0 ? SIZES.indexOf(1) : nearestStep(t.size || 1) + dir;
    if (i < 0 || i >= SIZES.length) return;
    t.size = SIZES[i]; t.updated = now();
    li.style.setProperty('--z', t.size); // no re-draw, so the cursor stays put
    save();
  };
  const nearestStep = v => SIZES.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(SIZES[best] - v) ? i : best), 0);
  // Whole-app text size for this device (not synced, so phone and laptop can differ).
  let textSize = +localStorage.getItem('life-textsize') || 1;
  const applyTextSize = () => {
    document.documentElement.style.setProperty('--g', textSize);
    const label = $('#textSizeLabel'); if (label) label.textContent = Math.round(textSize * 100) + '%';
  };
  const changeTextSize = dir => {
    const i = nearestStep(textSize) + dir; if (i < 0 || i >= SIZES.length) return;
    textSize = SIZES[i]; localStorage.setItem('life-textsize', textSize); applyTextSize();
  };
  $('#textSmaller').onclick = () => changeTextSize(-1);
  $('#textBigger').onclick = () => changeTextSize(1);
  applyTextSize();

  /* ---------- canvas: cards you can place and resize anywhere ---------- */
  const WIDE = matchMedia('(min-width: 900px)');
  const canvasMode = () => WIDE.matches;
  const PAD = 24, GAP = 24, CARD_W = 340, CARD_H = 320, SNAP = 12;
  const snap = v => Math.max(PAD, Math.round(v / SNAP) * SNAP);
  // Boards that have no spot yet get one in a tidy grid below the ones already placed.
  const placeBoards = list => {
    const todo = list.filter(b => b.x == null); if (!todo.length) return;
    const width = Math.max(CARD_W, $('#boards').clientWidth - PAD * 2);
    const cols = Math.max(1, Math.floor((width + GAP) / (CARD_W + GAP)));
    const placed = list.filter(b => b.x != null);
    const top = placed.length ? Math.max(...placed.map(b => b.y + (b.h || CARD_H))) + GAP : PAD;
    todo.forEach((b, i) => {
      b.x = PAD + (i % cols) * (CARD_W + GAP); b.y = top + Math.floor(i / cols) * (CARD_H + GAP);
      b.w = CARD_W; b.h = CARD_H; b.updated = now();
    });
    save();
  };
  const fitCanvas = () => {
    const list = boards();
    $('#boards').style.height = (list.length ? Math.max(...list.map(b => (b.y || 0) + (b.h || CARD_H))) + PAD * 4 : 400) + 'px';
  };
  const topZ = () => Math.max(1, ...boards().map(b => b.z || 1)) + 1;
  // Remember a card's size after it's resized from its corner.
  let resizeTimer;
  const resizeWatch = new ResizeObserver(entries => {
    let changed = false;
    for (const en of entries) {
      const el = en.target, b = S.boards.find(x => x.id === el.dataset.board); if (!b || !canvasMode()) continue;
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (Math.abs(w - (b.w || CARD_W)) > 2 || Math.abs(h - (b.h || CARD_H)) > 2) { b.w = w; b.h = h; b.updated = now(); changed = true; }
    }
    if (changed) { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { save(); fitCanvas(); }, 400); }
  });
  const newBoard = (x, y) => {
    const list = boards();
    const used = new Set(list.map(b => b.color));
    const color = COLORS.slice(0, -1).find(c => !used.has(c)) || colorFor(list.length);
    const board = { id: 'b-' + uid(), pageId: currentPage(), name: 'New board', order: (list.at(-1)?.order ?? -1) + 1, color, updated: now() };
    if (canvasMode() && x != null) {
      const maxX = Math.max(PAD, $('#boards').clientWidth - CARD_W - PAD); // keep new cards inside the visible canvas
      Object.assign(board, { x: Math.min(snap(x), maxX), y: snap(y), w: CARD_W, h: CARD_H, z: topZ() });
    }
    S.boards.push(board); save(); render();
    const input = $(`[data-board="${board.id}"] .board-name`);
    input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); input?.focus(); input?.select();
  };
  // Drag a card by its empty space or title bar. A tap without moving still starts writing.
  let cardDrag = null, swallowClick = false;
  $('#boards').addEventListener('pointerdown', e => {
    if (!canvasMode() || e.button > 0) return;
    const card = e.target.closest('.board');
    if (!card || e.target.closest('.item, button, input, .swatches, .due-edit, .typebar, [contenteditable]')) return;
    const r = card.getBoundingClientRect();
    if (e.clientX > r.right - 22 && e.clientY > r.bottom - 22) return; // the resize corner
    const b = boardOf(card);
    e.preventDefault();
    cardDrag = { card, b, sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, moved: false };
  });
  addEventListener('pointermove', e => {
    if (!cardDrag) return;
    const { card, b, sx, sy, ox, oy } = cardDrag, dx = e.clientX - sx, dy = e.clientY - sy;
    if (!cardDrag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      cardDrag.moved = true; document.activeElement?.blur?.();
      b.z = topZ(); card.style.zIndex = b.z; card.classList.add('lifted'); document.body.classList.add('drag-active');
    }
    card.style.left = Math.max(0, ox + dx) + 'px'; card.style.top = Math.max(0, oy + dy) + 'px';
  });
  addEventListener('pointerup', e => {
    if (!cardDrag) return;
    const { card, b, sx, sy, ox, oy, moved } = cardDrag; cardDrag = null;
    if (!moved) return;
    card.classList.remove('lifted'); document.body.classList.remove('drag-active');
    b.x = snap(ox + e.clientX - sx); b.y = snap(oy + e.clientY - sy); b.updated = now();
    card.style.left = b.x + 'px'; card.style.top = b.y + 'px';
    save(); fitCanvas(); swallowClick = true; setTimeout(() => { swallowClick = false; }, 50);
  });
  // Double-click empty canvas to make a card there.
  $('#boards').addEventListener('dblclick', e => {
    if (!canvasMode() || e.target !== $('#boards')) return;
    const r = $('#boards').getBoundingClientRect();
    newBoard(e.clientX - r.left - 40, e.clientY - r.top - 24);
  });
  $('#newBoardBtn').onclick = () => {
    const list = boards();
    const bottom = list.length ? Math.max(...list.map(b => (b.y || 0) + (b.h || CARD_H))) + GAP : PAD;
    newBoard(PAD, bottom);
  };
  WIDE.addEventListener('change', () => render());
  // Never yank the text out from under the user when synced data arrives.
  const softRender = () => (editing() ? (renderPending = true) : render());
  $('#boards').addEventListener('focusout', () => setTimeout(() => { if (renderPending && !editing()) render(); }, 0));

  const boardOf = el => S.boards.find(b => b.id === el.closest('[data-board]')?.dataset.board);
  const taskOf = el => S.tasks.find(t => t.id === el.closest('[data-id]')?.dataset.id);
  const remove = x => { x.deleted = true; x.updated = now(); };
  const focusItem = (id, atEnd = true) => {
    const el = $(`[data-id="${CSS.escape(id)}"] .text`); if (!el) return;
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(!atEnd);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  // Re-draw, then put the cursor back where the user is writing.
  const redrawAndFocus = id => { keepId = id; quiet = true; render(); focusItem(id); quiet = false; };

  const newItem = (boardId, type, pos, title = '') => {
    const item = { id: uid(), boardId, type, title, due: null, done: false, doneOn: null, pos, created: now(), updated: now() };
    S.tasks.push(item); return item;
  };
  const insertAfter = (t, type, title = '') => {
    const items = visibleItems(t.boardId), next = items[items.indexOf(t) + 1];
    return newItem(t.boardId, type, next ? (t.pos + next.pos) / 2 : t.pos + 1, title);
  };
  // Start writing at the end of a board (reuses an empty last line if there is one).
  const writeAtEnd = boardId => {
    const last = visibleItems(boardId).at(-1);
    if (last && !last.title) return focusItem(last.id);
    const prevType = last ? typeOf(last) : 'note';
    const item = newItem(boardId, prevType === 'task' || prevType === 'bullet' ? prevType : 'note', nextPos(boardId));
    store(); redrawAndFocus(item.id);
  };
  const setType = (t, type) => { t.type = type; t.updated = now(); store(); redrawAndFocus(t.id); };

  /* ---------- navigation bar: pages ---------- */
  const startRename = id => {
    renamingPage = id; renderNav();
    const input = $(`#pages input[data-page="${CSS.escape(id)}"]`); input.focus(); input.select();
  };
  const finishRename = (input, keep = true) => {
    const p = S.pages.find(x => x.id === input.dataset.page), name = input.value.trim();
    renamingPage = null;
    if (keep && p && name && name !== p.name) { p.name = name; p.updated = now(); save(); }
    renderNav();
  };
  $('#pages').addEventListener('click', e => {
    const el = e.target.closest('[data-act], .page-tab'); if (!el || el.matches('input')) return;
    if (el.dataset.act === 'addmenu') { addMenu = !addMenu; return renderNav(); }
    if (el.dataset.act === 'addpage') {
      addMenu = false;
      const doc = el.dataset.kind === 'doc';
      const p = { id: 'p-' + uid(), name: doc ? 'Notes' : 'New page', order: (pages().at(-1)?.order ?? -1) + 1, updated: now(), ...(doc && { kind: 'doc', doc: '' }) };
      S.pages.push(p); save(); goTo(p.id); return startRename(p.id);
    }
    if (el.dataset.act === 'delpage') {
      e.stopPropagation();
      const p = S.pages.find(x => x.id === currentPage()), list = boards();
      if (!confirm(`Delete the page "${p.name}"${p.kind === 'doc' && p.doc ? ' and everything written on it' : ''}${list.length ? ` and its ${list.length} board${list.length > 1 ? 's' : ''}` : ''}?`)) return;
      remove(p);
      list.forEach(bd => { remove(bd); S.tasks.filter(t => t.boardId === bd.id && !t.deleted).forEach(remove); });
      save(); return goTo(pages()[0].id);
    }
    if (el.dataset.page && el.dataset.page !== currentPage()) goTo(el.dataset.page);
  });
  $('#pages').addEventListener('dblclick', e => {
    const tab = e.target.closest('button.page-tab[data-page]'); if (tab) startRename(tab.dataset.page);
  });
  $('#pages').addEventListener('keydown', e => {
    if (!e.target.matches('input.page-tab')) return;
    if (e.key === 'Enter') { e.preventDefault(); finishRename(e.target); }
    if (e.key === 'Escape') finishRename(e.target, false);
  });
  $('#pages').addEventListener('input', e => { if (e.target.matches('input.page-tab')) e.target.size = Math.max(4, [...e.target.value].length + 1); });
  $('#pages').addEventListener('focusout', e => { if (e.target.matches('input.page-tab') && renamingPage) finishRename(e.target); });
  addEventListener('hashchange', () => { const id = decodeURIComponent(location.hash.slice(1)); if (id && id !== page) goTo(id); });

  /* ---------- events ---------- */
  // Keep the cursor in the line when tapping the type bar.
  $('#boards').addEventListener('pointerdown', e => { if (e.target.closest('.typebar')) e.preventDefault(); });

  $('#boards').addEventListener('click', e => {
    if (swallowClick) return;
    const b = e.target.closest('button');
    if (!b) {
      // A tap on the board's empty space starts a new line at the end.
      const board = e.target.closest('.board');
      if (board && !e.target.closest('.item, .board-head, .swatches, form')) writeAtEnd(board.dataset.board);
      return;
    }
    const act = b.dataset.act;
    if (act === 'toggle') {
      const t = taskOf(b); t.done = !t.done; t.doneOn = t.done ? dayKey() : null; t.updated = now();
    } else if (act === 'del') {
      remove(taskOf(b));
    } else if (act === 'settype') {
      const t = taskOf(b), el = b.closest('.item').querySelector('.text');
      readLine(el, t); return setType(t, b.dataset.type);
    } else if (act === 'editdue') {
      const id = taskOf(b).id; dueEditing = dueEditing === id ? null : id; render();
      return $(`[data-id="${id}"] .due-edit input`)?.focus();
    } else if (act === 'cleardue') {
      const t = taskOf(b); t.due = null; t.updated = now(); dueEditing = null;
    } else if (act === 'newboard') {
      return newBoard();
    } else if (act === 'colors') {
      const id = boardOf(b).id; picking = picking === id ? null : id; return render();
    } else if (act === 'color') {
      const board = boardOf(b); board.color = b.dataset.color; board.updated = now(); picking = null;
    } else if (act === 'tbold') {
      const el = b.closest('.item').querySelector('.text');
      document.execCommand('bold'); readLine(el, taskOf(b)); taskOf(b).updated = now(); return save();
    } else if (act === 'tsmaller' || act === 'tbigger') {
      return resizeLine(b.closest('.item'), act === 'tbigger' ? 1 : -1);
    } else if (act === 'moving') {
      const id = boardOf(b).id; moving = moving === id ? null : id; return render();
    } else if (act === 'moveto') {
      const board = boardOf(b); board.pageId = b.dataset.page; board.x = board.y = null; board.updated = now(); moving = null;
    } else if (act === 'delboard') {
      const board = boardOf(b);
      const count = live(S.tasks).filter(t => t.boardId === board.id && t.title && !(isTask(t) && t.done)).length;
      if (!confirm(`Delete "${board.name}"${count ? ` and everything on it (${count} item${count > 1 ? 's' : ''})` : ''}?`)) return;
      remove(board);
      S.tasks.filter(t => t.boardId === board.id && !t.deleted).forEach(remove);
    } else if (act === 'left' || act === 'right') {
      const list = boards(), i = list.indexOf(boardOf(b)), j = act === 'left' ? i - 1 : i + 1;
      list.forEach((x, k) => { if (x.order !== k) { x.order = k; x.updated = now(); } }); // normalise first
      [list[i].order, list[j].order] = [j, i];
      list[i].updated = list[j].updated = now();
    } else return;
    save(); render();
  });

  $('#boards').addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target, f = form.elements;
    if (form.dataset.form === 'due') {
      const t = taskOf(form); t.due = readDue(f.date.value, f.time.value); t.updated = now();
      dueEditing = null; save(); return render();
    }
  });

  // Writing in place
  $('#boards').addEventListener('input', e => {
    const el = e.target;
    if (el.classList.contains('board-name')) { el.size = Math.max(4, [...el.value].length + 1); return; }
    if (!el.classList.contains('text')) return;
    const t = taskOf(el);
    const raw = el.innerText;
    readLine(el, t); t.updated = now();
    el.closest('.item').dir = dirOf(t.title); // flips sides as soon as you start typing Farsi
    const hit = SHORTCUTS.find(([re, type]) => re.test(raw) && type !== typeOf(t)); // works on any kind of line
    if (hit) { t.title = raw.replace(hit[0], '').trim(); t.rich = null; return setType(t, hit[1]); }
    store();
  });

  // Pasting several lines into a task or list line adds one item per line.
  $('#boards').addEventListener('paste', e => {
    const el = e.target.closest?.('.text'); if (!el) return;
    e.preventDefault(); // paste as plain text, never someone else's formatting
    const text = e.clipboardData?.getData('text/plain') || '';
    const t = taskOf(el), lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (typeOf(t) === 'note' || lines.length < 2) { document.execCommand('insertText', false, text); return; }
    document.execCommand('insertText', false, lines[0]);
    readLine(el, t); t.updated = now();
    let prev = t;
    for (const line of lines.slice(1)) prev = insertAfter(prev, typeOf(t), line);
    save(); redrawAndFocus(prev.id);
  });

  $('#boards').addEventListener('keydown', e => {
    const el = e.target;
    if (el.classList.contains('text') && (e.ctrlKey || e.metaKey) && ['=', '+', '-', '_', '0'].includes(e.key)) {
      e.preventDefault(); // instead of zooming the whole page
      return resizeLine(el.closest('.item'), e.key === '0' ? 0 : e.key === '-' || e.key === '_' ? -1 : 1);
    }
    if (el.classList.contains('text') && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      document.execCommand('bold'); // bolds the selection, or what you type next
      const t = taskOf(el); readLine(el, t); t.updated = now(); return save();
    }
    if (el.classList.contains('text')) {
      const t = taskOf(el), type = typeOf(t), title = el.innerText.trim();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!title) {
          // Enter on an empty task / list line turns it back into plain text (like most editors)
          if (type !== 'note') setType(t, 'note');
          return;
        }
        readLine(el, t); t.updated = now();
        const item = insertAfter(t, type === 'heading' ? 'note' : type); store(); redrawAndFocus(item.id);
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault(); document.execCommand('insertLineBreak');
      } else if (e.key === 'Backspace' && el.textContent === '') {
        e.preventDefault();
        if (type !== 'note') return setType(t, 'note');
        const items = visibleItems(t.boardId), prev = items[items.indexOf(t) - 1];
        remove(t); save();
        if (prev) redrawAndFocus(prev.id); else { render(); }
      } else if (e.key === 'Escape') el.blur();
    } else if (el.classList.contains('board-name') && e.key === 'Enter') {
      e.preventDefault(); el.blur();
    }
  });
  $('#boards').addEventListener('focusout', e => {
    if (quiet) return;
    if (e.target.classList.contains('text')) {
      if (e.relatedTarget && e.target.closest('.item')?.contains(e.relatedTarget)) return; // tapped its own type bar
      keepId = null;
      const t = taskOf(e.target); if (!t || t.deleted) return;
      readLine(e.target, t);
      const title = t.title;
      if (!title) remove(t);
      t.updated = now(); save();
      if (!title) setTimeout(() => { if (!editing()) render(); else renderPending = true; }, 0);
      else setTimeout(() => { if (!editing()) header(); }, 0);
    } else if (e.target.classList.contains('board-name')) {
      const board = boardOf(e.target), name = e.target.value.trim();
      if (name && name !== board.name) { board.name = name; board.updated = now(); save(); }
      else if (!name) e.target.value = board.name;
    }
  });

  /* ---------- drag to reorder (and to move between boards) ---------- */
  let drag = null;
  $('#boards').addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle'); if (!h || e.button > 0) return;
    e.preventDefault();
    document.activeElement?.blur?.();
    const li = h.closest('.item'), r = li.getBoundingClientRect();
    const ghost = li.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: r.width + 'px', background: getComputedStyle(li.closest('.board')).backgroundColor });
    document.body.append(ghost);
    drag = { li, id: li.dataset.id, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top };
    li.classList.add('dragging'); document.body.classList.add('drag-active');
    moveDrag(e);
  });
  const moveDrag = e => {
    if (!drag) return;
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;
    const list = document.elementFromPoint(e.clientX, e.clientY)?.closest('.board')?.querySelector('.items');
    if (list) {
      const others = [...list.querySelectorAll('.item:not(.dragging)')];
      const before = others.find(o => { const r = o.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (before) { if (drag.li.nextElementSibling !== before) list.insertBefore(drag.li, before); }
      else if (list.lastElementChild !== drag.li) list.append(drag.li);
      list.querySelector('.empty')?.remove();
    }
    const edge = 70; // scroll the page when dragging near the top/bottom
    if (e.clientY < edge) scrollBy(0, -12); else if (e.clientY > innerHeight - edge) scrollBy(0, 12);
  };
  addEventListener('pointermove', moveDrag);
  const endDrag = () => {
    if (!drag) return;
    const { li, id, ghost } = drag; drag = null;
    ghost.remove(); li.classList.remove('dragging'); document.body.classList.remove('drag-active');
    const t = S.tasks.find(x => x.id === id), boardId = li.closest('[data-board]')?.dataset.board;
    const posOf = el => el?.classList.contains('item') ? S.tasks.find(x => x.id === el.dataset.id)?.pos : undefined;
    const a = posOf(li.previousElementSibling), b = posOf(li.nextElementSibling);
    if (t && boardId) {
      t.pos = a != null && b != null ? (a + b) / 2 : a != null ? a + 1 : b != null ? b - 1 : 0;
      t.boardId = boardId; t.updated = now(); save();
    }
    render();
  };
  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);

  /* ================= sync (GitHub Gist) ================= */
  let sync = null;
  try { sync = JSON.parse(localStorage.getItem(SYNC_KEY)); } catch {}
  const storeSync = () => sync ? localStorage.setItem(SYNC_KEY, JSON.stringify(sync)) : localStorage.removeItem(SYNC_KEY);
  let syncState = 'off', syncError = '';

  const setStatus = (state, err = '') => {
    syncState = state; syncError = err;
    const el = $('#syncStatus');
    el.textContent = { off: '', syncing: 'syncing…', ok: 'synced', offline: 'offline', error: 'sync error' }[state];
    el.className = 'sync-status' + (state === 'error' ? ' err' : '');
    el.title = err || (sync?.last ? 'Last synced ' + new Date(sync.last).toLocaleString() : '');
    if ($('#menu').open) renderSyncBox();
  };

  const gh = async (path, opts = {}) => {
    const r = await fetch('https://api.github.com' + path, {
      cache: 'no-store', ...opts,
      headers: { Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    });
    if (r.status === 401) throw new Error('GitHub rejected the token. Create a new one and reconnect.');
    if (r.status === 404) throw new Error('404');
    if (r.status === 403) throw new Error('GitHub refused access (403). Make sure the token has the "gist" permission.');
    if (!r.ok) throw new Error(`GitHub error ${r.status}`);
    return r.json();
  };

  // --- merging: the newest version of each record wins; deletes are records too ---
  const newer = (a, b) => ((b.updated || 0) > (a.updated || 0) ? b : a);
  const mergeList = (a = [], b = []) => {
    const m = new Map(a.map(x => [x.id, x]));
    for (const x of b) m.set(x.id, m.has(x.id) ? newer(m.get(x.id), x) : x);
    return [...m.values()];
  };
  const merge = (l, r) => {
    const out = { ...r, ...l }; // keeps any older fields (habits, notes…) so nothing is lost
    for (const k of ['pages', 'boards', 'tasks', 'notes', 'sessions', 'habits'])
      if (Array.isArray(l[k]) || Array.isArray(r[k])) out[k] = mergeList(l[k], r[k]);
    return out;
  };
  // Forget deleted records after 60 days so the file doesn't grow forever.
  const prune = s => {
    const cutoff = now() - 60 * 864e5;
    for (const k of ['pages', 'boards', 'tasks']) s[k] = s[k].filter(x => !x.deleted || x.updated > cutoff);
  };
  const pristine = () => S.tasks.length === 0 && S.pages.length === 1 && !S.pages[0].updated && S.boards.length === DEFAULT_BOARDS.length &&
    S.boards.every((b, i) => b.updated === 0 && b.id === boardIdFor(DEFAULT_BOARDS[i]) && b.name === DEFAULT_BOARDS[i]);
  const payload = () => { const { theme, ...rest } = S; return JSON.stringify(rest); };

  async function findOrCreateGist() {
    for (let page = 1; page <= 10; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      const g = list.find(g => g.files?.[FILE]);
      if (g) { sync.gistId = g.id; return storeSync(); }
      if (list.length < 100) break;
    }
    const g = await gh('/gists', { method: 'POST', body: JSON.stringify({
      description: 'Life dashboard data (synced automatically, keep secret)', public: false,
      files: { [FILE]: { content: payload() } },
    }) });
    sync.gistId = g.id; storeSync();
  }

  let syncing = false, again = false, syncTimer;
  const scheduleSync = (delay = 1500) => { if (!sync) return; clearTimeout(syncTimer); syncTimer = setTimeout(runSync, delay); };

  async function runSync() {
    if (!sync) return setStatus('off');
    if (!navigator.onLine) return setStatus('offline');
    if (syncing) { again = true; return; }
    syncing = true; setStatus('syncing');
    try {
      if (!sync.gistId) await findOrCreateGist();
      let g;
      try { g = await gh(`/gists/${sync.gistId}`); }
      catch (e) { if (e.message !== '404') throw e; sync.gistId = null; await findOrCreateGist(); g = await gh(`/gists/${sync.gistId}`); }
      const f = g.files?.[FILE];
      let remoteText = f?.content || '';
      if (f?.truncated) remoteText = await fetch(f.raw_url, { cache: 'no-store' }).then(r => r.text());
      const before = payload();
      if (remoteText) {
        const theme = S.theme, remote = migrate(JSON.parse(remoteText));
        // A brand-new, untouched device adopts the synced boards instead of adding its default ones.
        S = pristine() ? remote : migrate(merge(S, remote));
        S.theme = theme;
      }
      prune(S); store();
      const after = payload();
      if (after !== remoteText)
        await gh(`/gists/${sync.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: after } } }) });
      if (after !== before) softRender();
      sync.last = now(); storeSync(); setStatus('ok');
    } catch (e) {
      const msg = e.message === '404' ? 'Could not find your sync data on GitHub.' : (e.message || String(e));
      setStatus(navigator.onLine ? 'error' : 'offline', msg);
    } finally {
      syncing = false;
      if (again) { again = false; scheduleSync(300); }
    }
  }

  const renderSyncBox = () => {
    const box = $('#syncBox');
    if (!sync) {
      box.innerHTML = `
        <p class="muted">Keep every device up to date. Your data is stored in a secret gist on your GitHub account.</p>
        <ol>
          <li><a href="https://github.com/settings/tokens/new?scopes=gist&description=Life%20dashboard%20sync" target="_blank" rel="noopener">Create a GitHub token</a> with only the <b>gist</b> box ticked and a long expiration.</li>
          <li>Paste it below. Do the same on every device (the same token is fine).</li>
        </ol>
        <form class="row" id="syncForm">
          <input id="tokenInput" type="password" placeholder="ghp_…" autocomplete="off" required>
          <button class="btn">Connect</button>
        </form>
        ${syncError ? `<p class="muted" style="margin-top:8px">⚠ ${esc(syncError)}</p>` : ''}`;
      $('#syncForm').onsubmit = async e => {
        e.preventDefault();
        sync = { token: $('#tokenInput').value.trim() }; storeSync();
        await runSync();
        if (syncState === 'error') { const err = syncError; sync = null; storeSync(); setStatus('off', err); }
        renderSyncBox();
      };
    } else {
      const label = { syncing: 'Syncing…', ok: 'Synced', offline: 'Offline. Changes will sync when you reconnect.', error: 'Sync failed', off: '' }[syncState];
      box.innerHTML = `
        <p>${label}${sync.last ? ` <span class="muted">· last ${new Date(sync.last).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}</p>
        ${syncError ? `<p class="muted">⚠ ${esc(syncError)}</p>` : ''}
        <div class="row">
          <button class="btn" id="syncNow">Sync now</button>
          <button class="btn ghost" id="syncOff">Disconnect</button>
        </div>`;
      $('#syncNow').onclick = () => runSync();
      $('#syncOff').onclick = () => {
        if (!confirm('Stop syncing on this device? Your data stays here and on GitHub.')) return;
        sync = null; storeSync(); setStatus('off'); renderSyncBox();
      };
    }
  };

  /* ---------- menu ---------- */
  const menu = $('#menu');
  $('#menuBtn').onclick = () => { renderSyncBox(); menu.showModal(); };
  $('#closeMenu').onclick = () => menu.close();
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `life-backup-${dayKey()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#importFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.tasks)) throw 0;
      if (!confirm(sync ? 'Add everything from this backup? It will be merged with your synced data.' : 'Replace all data on this device with this backup?')) return;
      const theme = S.theme;
      S = sync ? migrate(merge(S, migrate(data))) : migrate(data);
      S.theme = theme; save(); applyTheme(); menu.close(); render();
    } catch { alert('That file is not a valid backup.'); }
    e.target.value = '';
  };

  /* ---------- boot ---------- */
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('storage', e => {
    if (e.key === KEY && e.newValue) { S = migrate(JSON.parse(e.newValue)); softRender(); }
    if (e.key === SYNC_KEY) { try { sync = JSON.parse(e.newValue); } catch { sync = null; } }
  });
  window.addEventListener('online', () => scheduleSync(0));
  window.addEventListener('offline', () => sync && setStatus('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { softRender(); scheduleSync(0); } });
  setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 60000);
  setInterval(() => softRender(), 60000); // keep "time left" fresh

  /* ---------- live Tehran clock in the top bar (always visible) ---------- */
  const TZ = 'Asia/Tehran';
  const fmt = (loc, o) => { try { return new Intl.DateTimeFormat(loc, { timeZone: TZ, ...o }); } catch { return null; } };
  const fTime = fmt('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const tick = () => {
    const d = new Date();
    if (fTime) $('#clockTime').textContent = fTime.format(d);

  };
  tick(); setInterval(tick, 1000);
  // The bar and the date header both stay at the top; keep the things below them clear.
  const fitSticky = () => {
    const root = document.documentElement.style;
    root.setProperty('--nav-h', $('.topbar').offsetHeight + 'px');
    root.setProperty('--head-h', $('header.top').offsetHeight + 'px');
  };
  new ResizeObserver(fitSticky).observe($('.topbar')); new ResizeObserver(fitSticky).observe($('header.top'));

  applyTheme(); render();
  if (sync) runSync();

  // Keep the installed app up to date: check for a new version whenever it's opened,
  // and reload once when one arrives (unless you're in the middle of typing).
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      const go = () => { if (!reloaded && !editing()) { reloaded = true; location.reload(); } };
      go(); if (!reloaded) document.addEventListener('focusout', () => setTimeout(go, 300));
    });
  }
})();
