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
  const COLORS = ['sand', 'mist', 'clay', 'sage', 'lilac', 'stone', 'grey', 'white'];
  const colorFor = i => COLORS[i % (COLORS.length - 1)];
  const defaults = () => ({
    boards: DEFAULT_BOARDS.map((name, i) => ({ id: boardIdFor(name), name, order: i, color: colorFor(i), updated: 0 })),
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
    $('meta[name=theme-color]').content = dark ? '#0a0a0a' : '#ffffff';
  };
  $('#themeBtn').onclick = () => {
    S.theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    store(); applyTheme();
  };

  /* ---------- render ---------- */
  const boards = () => live(S.boards).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
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
  const SHORTCUTS = [[/^#{1,3}\s/, 'heading'], [/^[-*•]\s/, 'bullet'], [/^\[\s?\]\s?/, 'task']];

  const header = () => {
    $('#date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
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
    const text = `<div class="text" contenteditable="plaintext-only" dir="auto" spellcheck="false" data-ph="${esc(TYPES[type].ph)}">${esc(t.title)}</div>`;
    // Small bar under the line you're writing in, to switch what kind of line it is.
    const typebar = `<div class="typebar">${Object.entries(TYPES).map(([k, v]) =>
      `<button class="type ${k === type ? 'on' : ''}" data-act="settype" data-type="${k}" tabindex="-1">${v.label}</button>`).join('')}</div>`;
    const del = `<button class="del" data-act="del" aria-label="Delete">×</button>`;
    if (type !== 'task') return `
      <li class="item ${type}" data-id="${t.id}">
        ${handle}${type === 'bullet' ? '<span class="dot">•</span>' : ''}
        <div class="body">${text}${typebar}</div>${del}
      </li>`;
    const info = dueInfo(t);
    return `
      <li class="item task ${t.done ? 'done' : ''}" data-id="${t.id}">
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
      <section class="board" data-board="${esc(b.id)}" data-color="${b.color}" style="--board: var(--c-${b.color})">
        <div class="board-head">
          <input class="board-name" value="${esc(b.name)}" dir="auto" aria-label="Board name" maxlength="40">
          <div class="board-menu">
            <button class="swatch-btn" data-act="colors" title="Colour" aria-label="Change colour"></button>
            ${i > 0 ? '<button class="mini" data-act="left" title="Move earlier" aria-label="Move earlier">←</button>' : ''}
            ${i < n - 1 ? '<button class="mini" data-act="right" title="Move later" aria-label="Move later">→</button>' : ''}
            <button class="mini" data-act="delboard" title="Delete board" aria-label="Delete board">×</button>
          </div>
          <span class="board-count">${open || ''}</span>
        </div>
        ${picking === b.id ? `<div class="swatches">${COLORS.map(c => `
          <button class="swatch ${c === b.color ? 'on' : ''}" data-act="color" data-color="${c}" style="background: var(--c-${c})" title="${c}" aria-label="${c}"></button>`).join('')}
        </div>` : ''}
        <ul class="items">
          ${items.map(itemHTML).join('') || '<li class="empty">Tap anywhere to write.</li>'}
        </ul>
        <div class="write-here" aria-hidden="true"></div>
      </section>`;
  };

  let renderPending = false, picking = null, dueEditing = null, quiet = false;
  const editing = () => document.activeElement?.matches?.('#boards [contenteditable], #boards .board-name, #boards .due-edit input') || !!drag;
  const render = () => {
    renderPending = false;
    header();
    const list = boards();
    quiet = true; // re-drawing removes the line being edited; that's not the user leaving it
    $('#boards').innerHTML = list.map((b, i) => boardHTML(b, i, list.length)).join('') +
      '<button class="new-board" data-act="newboard">+ New board</button>';
    quiet = false;
  };
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

  /* ---------- events ---------- */
  // Keep the cursor in the line when tapping the type bar.
  $('#boards').addEventListener('pointerdown', e => { if (e.target.closest('.typebar')) e.preventDefault(); });

  $('#boards').addEventListener('click', e => {
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
      t.title = el.textContent; return setType(t, b.dataset.type);
    } else if (act === 'editdue') {
      const id = taskOf(b).id; dueEditing = dueEditing === id ? null : id; render();
      return $(`[data-id="${id}"] .due-edit input`)?.focus();
    } else if (act === 'cleardue') {
      const t = taskOf(b); t.due = null; t.updated = now(); dueEditing = null;
    } else if (act === 'newboard') {
      const list = boards();
      const used = new Set(list.map(x => x.color));
      const color = COLORS.slice(0, -1).find(c => !used.has(c)) || colorFor(list.length);
      const board = { id: 'b-' + uid(), name: 'New board', order: (list.at(-1)?.order ?? -1) + 1, color, updated: now() };
      S.boards.push(board); save(); render();
      const input = $(`[data-board="${board.id}"] .board-name`); input.focus(); input.select();
      return;
    } else if (act === 'colors') {
      const id = boardOf(b).id; picking = picking === id ? null : id; return render();
    } else if (act === 'color') {
      const board = boardOf(b); board.color = b.dataset.color; board.updated = now(); picking = null;
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
    const el = e.target; if (!el.classList.contains('text')) return;
    const t = taskOf(el);
    t.title = el.textContent; t.updated = now();
    const hit = typeOf(t) === 'note' && SHORTCUTS.find(([re]) => re.test(t.title));
    if (hit) { t.title = t.title.replace(hit[0], ''); return setType(t, hit[1]); }
    store();
  });

  // Pasting several lines into a task or list line adds one item per line.
  $('#boards').addEventListener('paste', e => {
    const el = e.target.closest?.('.text'); if (!el) return;
    const t = taskOf(el), lines = (e.clipboardData?.getData('text/plain') || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (typeOf(t) === 'note' || lines.length < 2) return;
    e.preventDefault();
    t.title = (el.textContent + lines[0]).trim(); t.updated = now();
    let prev = t;
    for (const line of lines.slice(1)) prev = insertAfter(prev, typeOf(t), line);
    save(); redrawAndFocus(prev.id);
  });

  $('#boards').addEventListener('keydown', e => {
    const el = e.target;
    if (el.classList.contains('text')) {
      const t = taskOf(el), type = typeOf(t), title = el.textContent.trim();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!title) {
          // Enter on an empty task / list line turns it back into plain text (like most editors)
          if (type !== 'note') setType(t, 'note');
          return;
        }
        t.title = type === 'note' ? el.textContent.replace(/^\s+|\s+$/g, '') : title; t.updated = now();
        const item = insertAfter(t, type === 'heading' ? 'note' : type); store(); redrawAndFocus(item.id);
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
      const raw = e.target.textContent;
      const title = t.type === 'note' ? raw.replace(/^\s+|\s+$/g, '') : raw.replace(/\s+/g, ' ').trim();
      if (!title) remove(t); else t.title = title;
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
    ghost.classList.add('ghost');
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
    for (const k of ['boards', 'tasks', 'notes', 'sessions', 'habits'])
      if (Array.isArray(l[k]) || Array.isArray(r[k])) out[k] = mergeList(l[k], r[k]);
    return out;
  };
  // Forget deleted records after 60 days so the file doesn't grow forever.
  const prune = s => {
    const cutoff = now() - 60 * 864e5;
    for (const k of ['boards', 'tasks']) s[k] = s[k].filter(x => !x.deleted || x.updated > cutoff);
  };
  const pristine = () => S.tasks.length === 0 && S.boards.length === DEFAULT_BOARDS.length &&
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
