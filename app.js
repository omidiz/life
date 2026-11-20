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
    tasks: [],   // {id, boardId, title, done, doneOn, created, updated, deleted?}
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
      if (!t.boardId) t.boardId = boardIdFor(t.area || s.boards[0]?.name || 'Tasks');
      if (!s.boards.some(b => b.id === t.boardId)) // task points at a board we don't have: recreate it
        s.boards.push({ id: t.boardId, name: t.area || 'Tasks', order: s.boards.length, color: colorFor(s.boards.length), updated: 0 });
    });
    return s;
  };

  let S;
  try { S = migrate(JSON.parse(localStorage.getItem(KEY))); } catch { S = defaults(); }
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
  // Finished tasks stay visible (crossed out) for the rest of the day, then tidy themselves away.
  const visibleTasks = boardId => {
    const today = dayKey();
    return live(S.tasks)
      .filter(t => t.boardId === boardId && (!t.done || t.doneOn === today))
      .sort((a, b) => a.done - b.done || dueTime(a) - dueTime(b) || a.created - b.created);
  };

  /* ---------- deadlines ---------- */
  // t.due is 'YYYY-MM-DD' (whole day) or 'YYYY-MM-DDTHH:MM' (exact time), or null.
  const dueDate = due => due.length > 10 ? new Date(due) : new Date(due + 'T23:59:59');
  const dueTime = t => (t.due ? dueDate(t.due).getTime() : Infinity);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const dueInfo = t => {
    if (!t.due) return null;
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
  const dueFields = (due, prefix = '') => `
    <input type="date" name="${prefix}date" value="${due ? due.slice(0, 10) : ''}" aria-label="Deadline date">
    <input type="time" name="${prefix}time" value="${due && due.length > 10 ? due.slice(11, 16) : ''}" aria-label="Deadline time (optional)">`;
  const readDue = (date, time) => (date ? date + (time ? 'T' + time : '') : null);

  const header = () => {
    $('#date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const ids = new Set(boards().map(b => b.id));
    const tasks = live(S.tasks).filter(t => ids.has(t.boardId));
    const open = tasks.filter(t => !t.done).length;
    const doneToday = tasks.filter(t => t.doneOn === dayKey()).length;
    const late = tasks.filter(t => dueInfo(t)?.level === 'late').length;
    const today = tasks.filter(t => !t.done && t.due && t.due.slice(0, 10) === dayKey() && dueInfo(t).level !== 'late').length;
    $('#summary').textContent = `${open} to do` + (today ? ` · ${today} due today` : '') + (late ? ` · ${late} late` : '') +
      (doneToday ? ` · ${doneToday} done today` : '');
  };

  const boardHTML = (b, i, n) => {
    const tasks = visibleTasks(b.id);
    const open = tasks.filter(t => !t.done).length;
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
        <ul class="tasks">
          ${tasks.map(t => `
            <li class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
              <button class="check" data-act="toggle" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${t.done ? '✓' : ''}</button>
              <div class="body">
                <span class="text" contenteditable="plaintext-only" dir="auto" spellcheck="false">${esc(t.title)}</span>
                ${(info => info ? `<button class="due ${info.level}" data-act="editdue">${[esc(info.when), info.left && `<b>${info.left}</b>`].filter(Boolean).join(' · ')}</button>` : '')(dueInfo(t))}
                ${dueEditing === t.id ? `<form class="due-edit" data-form="due">${dueFields(t.due)}
                  <button class="pill" type="submit">Save</button>
                  ${t.due ? '<button class="pill ghost" type="button" data-act="cleardue">Remove</button>' : ''}
                </form>` : ''}
              </div>
              <button class="tool" data-act="editdue" title="Deadline" aria-label="Set deadline">${clockIcon}</button>
              <button class="del" data-act="del" aria-label="Delete task">×</button>
            </li>`).join('') || '<li class="empty">Nothing here yet.</li>'}
        </ul>
        <form class="add" data-form="task">
          <div class="add-row">
            <input name="title" placeholder="+ Add a task" autocomplete="off" dir="auto" enterkeyhint="done">
            <button type="button" class="tool ${addDue === b.id ? 'on' : ''}" data-act="adddue" title="Add a deadline" aria-label="Add a deadline">${clockIcon}</button>
          </div>
          ${addDue === b.id ? `<div class="due-edit">${dueFields(null)}<span class="muted">optional</span></div>` : ''}
        </form>
      </section>`;
  };

  let renderPending = false, picking = null, dueEditing = null, addDue = null;
  const editing = () => document.activeElement?.matches?.('#boards [contenteditable], #boards .board-name, #boards .add input:not(:placeholder-shown), #boards .due-edit input');
  const render = () => {
    renderPending = false;
    header();
    const list = boards();
    $('#boards').innerHTML = list.map((b, i) => boardHTML(b, i, list.length)).join('') +
      '<button class="new-board" data-act="newboard">+ New board</button>';
  };
  // Never yank the text out from under the user when synced data arrives.
  const softRender = () => (editing() ? (renderPending = true) : render());
  $('#boards').addEventListener('focusout', () => setTimeout(() => { if (renderPending && !editing()) render(); }, 0));

  const boardOf = el => S.boards.find(b => b.id === el.closest('[data-board]')?.dataset.board);
  const taskOf = el => S.tasks.find(t => t.id === el.closest('[data-id]')?.dataset.id);
  const remove = x => { x.deleted = true; x.updated = now(); };
  const focusAdd = id => $(`[data-board="${CSS.escape(id)}"] .add input`)?.focus();

  /* ---------- events ---------- */
  $('#boards').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'toggle') {
      const t = taskOf(b); t.done = !t.done; t.doneOn = t.done ? dayKey() : null; t.updated = now();
    } else if (act === 'del') {
      remove(taskOf(b));
    } else if (act === 'editdue') {
      const id = taskOf(b).id; dueEditing = dueEditing === id ? null : id; render();
      return $(`[data-id="${id}"] .due-edit input`)?.focus();
    } else if (act === 'cleardue') {
      const t = taskOf(b); t.due = null; t.updated = now(); dueEditing = null;
    } else if (act === 'adddue') {
      const board = boardOf(b), title = $(`[data-board="${CSS.escape(board.id)}"] .add input[name=title]`).value;
      addDue = addDue === board.id ? null : board.id; render();
      const input = $(`[data-board="${CSS.escape(board.id)}"] .add input[name=title]`); input.value = title;
      return addDue ? $(`[data-board="${CSS.escape(board.id)}"] .add input[type=date]`)?.focus() : input.focus();
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
      const count = live(S.tasks).filter(t => t.boardId === board.id && !t.done).length;
      if (!confirm(`Delete "${board.name}"${count ? ` and its ${count} task${count > 1 ? 's' : ''}` : ''}?`)) return;
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
    const f = e.target.elements;
    if (e.target.dataset.form === 'due') {
      const t = taskOf(e.target); t.due = readDue(f.date.value, f.time.value); t.updated = now();
      dueEditing = null; save(); return render();
    }
    const title = f.title.value.trim(), board = boardOf(e.target);
    if (!title || !board) return;
    const due = f.date ? readDue(f.date.value, f.time.value) : null;
    S.tasks.push({ id: uid(), boardId: board.id, title, due, done: false, doneOn: null, created: now(), updated: now() });
    addDue = null; save(); render(); focusAdd(board.id);
  });

  // Editing task text in place
  $('#boards').addEventListener('input', e => {
    if (e.target.classList.contains('text')) {
      const t = taskOf(e.target); t.title = e.target.textContent; t.updated = now(); store();
    }
  });
  $('#boards').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.classList.contains('text') || e.target.classList.contains('board-name'))) {
      e.preventDefault(); e.target.blur();
    }
    if (e.key === 'Escape' && e.target.matches('.add input')) { e.target.value = ''; e.target.blur(); }
  });
  $('#boards').addEventListener('focusout', e => {
    if (e.target.classList.contains('text')) {
      const t = taskOf(e.target);
      const title = e.target.textContent.replace(/\s+/g, ' ').trim();
      if (!title) remove(t); else t.title = title;
      t.updated = now(); save();
      if (!title) setTimeout(render, 0);
    } else if (e.target.classList.contains('board-name')) {
      const board = boardOf(e.target), name = e.target.value.trim();
      if (name && name !== board.name) { board.name = name; board.updated = now(); save(); }
      else if (!name) e.target.value = board.name;
    }
  });

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

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
