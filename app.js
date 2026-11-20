/* Life — a minimal personal dashboard.
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
  const dayKey = (d = new Date()) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const live = arr => arr.filter(x => !x.deleted);

  const defaults = () => ({
    areas: ['Study', 'Work', 'Personal', 'Health'],
    areasUpdated: 0,
    tasks: [],      // {id,title,area,due,done,doneOn,created,updated,deleted?}
    habits: [       // fixed ids so two fresh devices don't duplicate them
      { id: 'h-read', name: 'Read 20 min', log: {}, updated: 0 },
      { id: 'h-exercise', name: 'Exercise', log: {}, updated: 0 },
    ],              // log: { 'YYYY-MM-DD': {on, t} }
    notes: [],      // {id,text,updated,deleted?}
    focus: {},      // { 'YYYY-MM-DD': {text, t} }
    sessions: [],   // {id,day,area,mins,updated}
    theme: null,    // per device, never synced
  });

  // Bring older saved data up to the current shape.
  const migrate = raw => {
    const s = Object.assign(defaults(), raw || {});
    s.areasUpdated ||= 0;
    s.tasks.forEach(t => { t.updated ??= t.created || 0; });
    s.notes.forEach(n => { n.updated ??= 0; });
    s.habits.forEach(h => {
      h.updated ??= 0; h.log ||= {};
      for (const k in h.log) if (typeof h.log[k] !== 'object') h.log[k] = { on: !!h.log[k], t: 0 };
    });
    for (const k in s.focus) if (typeof s.focus[k] === 'string') s.focus[k] = { text: s.focus[k], t: 0 };
    if (!Array.isArray(s.sessions)) {
      const arr = [];
      for (const [day, m] of Object.entries(s.sessions)) for (const [area, mins] of Object.entries(m)) arr.push({ id: uid(), day, area, mins, updated: 0 });
      s.sessions = arr;
    }
    return s;
  };

  let S;
  try { S = migrate(JSON.parse(localStorage.getItem(KEY))); } catch { S = defaults(); }
  const store = () => localStorage.setItem(KEY, JSON.stringify(S));
  const save = () => { store(); scheduleSync(); };

  let tab = location.hash.slice(1) || 'today';
  let taskFilter = 'All';
  let showDone = false;

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

  /* ---------- header ---------- */
  const header = () => {
    const d = new Date();
    $('#date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const h = d.getHours();
    $('#greet').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };

  /* ---------- shared pieces ---------- */
  const isOn = (h, k) => !!h.log[k]?.on;
  const minutesOn = day => live(S.sessions).filter(s => s.day === day).reduce((a, s) => a + s.mins, 0);

  const taskItem = t => {
    const today = dayKey();
    let due = '';
    if (t.due) {
      const late = !t.done && t.due < today;
      const label = t.due === today ? 'Today' : new Date(t.due + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      due = `<span class="tag ${late ? 'late' : ''}">${late ? 'Late · ' : ''}${label}</span>`;
    }
    return `<li class="item ${t.done ? 'done' : ''}" data-id="${t.id}">
      <button class="check" data-act="toggle" aria-label="Toggle">${t.done ? '✓' : ''}</button>
      <span class="title">${esc(t.title)}</span>
      ${due}<span class="tag">${esc(t.area)}</span>
      <button class="del" data-act="del" aria-label="Delete">×</button>
    </li>`;
  };
  const areaOptions = sel => S.areas.map(a => `<option ${a === sel ? 'selected' : ''}>${esc(a)}</option>`).join('');
  const addTaskForm = (defaultDue = '') => `
    <form class="add-task" data-form="task">
      <input name="title" placeholder="Add a task…" autocomplete="off" required>
      <select name="area">${areaOptions(taskFilter !== 'All' ? taskFilter : S.areas[0])}</select>
      <input name="due" type="date" value="${defaultDue}">
      <button class="btn">Add</button>
    </form>`;

  /* ---------- views ---------- */
  const views = {
    today() {
      const today = dayKey();
      const tasks = live(S.tasks), habits = live(S.habits);
      const open = tasks.filter(t => !t.done);
      const todays = tasks.filter(t => t.due && t.due <= today && (!t.done || t.doneOn === today));
      const doneToday = tasks.filter(t => t.doneOn === today).length;
      const habitsDone = habits.filter(h => isOn(h, today)).length;
      return `
        <h2>Today's focus</h2>
        <input class="focus-input" id="focusInput" placeholder="What matters most today?" value="${esc(S.focus[today]?.text || '')}">

        <h2>Overview</h2>
        <div class="stats">
          <div class="stat"><b>${doneToday}</b><span>done today · ${open.length} open</span></div>
          <div class="stat"><b>${habitsDone}/${habits.length}</b><span>habits</span></div>
          <div class="stat"><b>${minutesOn(today)}</b><span>focus minutes</span></div>
        </div>

        <h2>Due today</h2>
        ${addTaskForm(today)}
        <ul class="list">${todays.length ? todays.sort(byDue).map(taskItem).join('') : '<li class="empty">Nothing due. Enjoy the calm.</li>'}</ul>

        <h2>Habits</h2>
        <ul class="list">${habits.map(h => `
          <li class="item ${isOn(h, today) ? 'done' : ''}" data-habit="${h.id}">
            <button class="check" data-act="habit" data-day="${today}">${isOn(h, today) ? '✓' : ''}</button>
            <span class="title">${esc(h.name)}</span>
            <span class="tag">${streak(h)} day streak</span>
          </li>`).join('') || '<li class="empty">No habits yet.</li>'}
        </ul>`;
    },

    tasks() {
      let list = live(S.tasks).filter(t => taskFilter === 'All' || t.area === taskFilter);
      const done = list.filter(t => t.done).sort((a, b) => b.updated - a.updated);
      list = list.filter(t => !t.done).sort(byDue);
      return `
        ${addTaskForm()}
        <div class="filters">
          ${['All', ...S.areas].map(a => `<button class="chip ${a === taskFilter ? 'active' : ''}" data-filter="${esc(a)}">${esc(a)}</button>`).join('')}
        </div>
        <ul class="list">${list.map(taskItem).join('') || '<li class="empty">No open tasks.</li>'}</ul>
        ${done.length ? `<h2><button data-act="showdone" class="muted">${showDone ? '▾' : '▸'} Completed (${done.length})</button></h2>
          ${showDone ? `<ul class="list">${done.map(taskItem).join('')}</ul>` : ''}` : ''}`;
    },

    habits() {
      const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
      const today = dayKey();
      return `
        <form class="row" data-form="habit">
          <input name="name" placeholder="New habit…" autocomplete="off" required>
          <button class="btn">Add</button>
        </form>
        <h2>Last 7 days</h2>
        ${live(S.habits).map(h => `
          <div class="habit" data-habit="${h.id}">
            <div class="habit-head">
              <span>${esc(h.name)} <span class="muted">· ${streak(h)} day streak</span></span>
              <button class="del" data-act="delhabit" aria-label="Delete">×</button>
            </div>
            <div class="days">${days.map(d => {
              const k = dayKey(d);
              return `<button class="day ${isOn(h, k) ? 'on' : ''} ${k === today ? 'today' : ''}" data-act="habit" data-day="${k}">
                ${d.toLocaleDateString(undefined, { weekday: 'narrow' })}<br>${d.getDate()}</button>`;
            }).join('')}</div>
          </div>`).join('') || '<p class="empty">Add a habit to start tracking.</p>'}`;
    },

    notes() {
      return `
        <button class="btn" data-act="newnote">+ New note</button>
        <h2>Notes</h2>
        ${live(S.notes).sort((a, b) => b.created - a.created || b.updated - a.updated).map(n => `
          <div class="note" data-note="${n.id}">
            <textarea placeholder="Write something…">${esc(n.text)}</textarea>
            <div class="note-foot">
              <span class="muted">${new Date(n.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <button class="del" data-act="delnote" aria-label="Delete">×</button>
            </div>
          </div>`).join('') || '<p class="empty">No notes yet.</p>'}`;
    },

    focus() {
      const since = new Date(); since.setDate(since.getDate() - 6);
      const from = dayKey(since), week = {};
      for (const s of live(S.sessions)) if (s.day >= from) week[s.area] = (week[s.area] || 0) + s.mins;
      const max = Math.max(1, ...Object.values(week));
      return `
        <div class="timer">
          <div class="mode">
            ${[25, 50, 5].map(m => `<button class="chip ${timer.len === m * 60 ? 'active' : ''}" data-len="${m}">${m} min</button>`).join('')}
          </div>
          <div class="time" id="time">${fmt(timer.left)}</div>
          <div class="row">
            <select id="focusArea">${areaOptions(timer.area)}</select>
            <button class="btn" data-act="timer">${timer.running ? 'Pause' : 'Start'}</button>
            <button class="btn ghost" data-act="reset">Reset</button>
          </div>
        </div>
        <h2>This week</h2>
        ${Object.keys(week).length ? Object.entries(week).sort((a, b) => b[1] - a[1]).map(([a, m]) => `
          <div style="margin-bottom:10px">
            <div class="row" style="justify-content:space-between"><span>${esc(a)}</span><span class="muted">${Math.floor(m / 60)}h ${m % 60}m</span></div>
            <div style="height:4px;background:var(--line);border-radius:2px;margin-top:4px">
              <div style="height:100%;width:${(m / max) * 100}%;background:var(--fg);border-radius:2px"></div>
            </div>
          </div>`).join('') : '<p class="empty">Finish a focus session to see it here.</p>'}`;
    },
  };

  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created;
  const streak = h => {
    let n = 0; const d = new Date();
    if (!isOn(h, dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet doesn't break the streak
    while (isOn(h, dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  };

  /* ---------- focus timer ---------- */
  const timer = { len: 1500, left: 1500, running: false, end: 0, area: null, iv: null };
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const tick = () => {
    timer.left = Math.max(0, Math.round((timer.end - now()) / 1000));
    const el = $('#time'); if (el) el.textContent = fmt(timer.left);
    document.title = timer.running ? `${fmt(timer.left)} · Life` : 'Life';
    if (timer.left === 0) finishTimer();
  };
  const finishTimer = () => {
    clearInterval(timer.iv); timer.running = false;
    const mins = Math.round(timer.len / 60);
    if (mins > 5) S.sessions.push({ id: uid(), day: dayKey(), area: timer.area || S.areas[0], mins, updated: now() }); // breaks aren't logged
    save();
    timer.left = timer.len; document.title = 'Life';
    try { navigator.vibrate?.(300); new Notification('Focus session complete'); } catch {}
    render();
  };

  /* ---------- render ---------- */
  let renderPending = false;
  const typing = () => document.activeElement?.matches?.('#view input[type=text], #view input:not([type]), #view textarea');
  const render = () => {
    renderPending = false;
    header();
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#view').innerHTML = (views[tab] || views.today)();
  };
  // Don't yank the text box out from under the user when synced data arrives.
  const softRender = () => (typing() ? (renderPending = true) : render());
  $('#view').addEventListener('focusout', () => setTimeout(() => { if (renderPending && !typing()) render(); }, 0));

  const findTask = el => S.tasks.find(t => t.id === el.closest('[data-id]')?.dataset.id);
  const findHabit = el => S.habits.find(h => h.id === el.closest('[data-habit]')?.dataset.habit);
  const findNote = el => S.notes.find(n => n.id === el.closest('[data-note]')?.dataset.note);
  const remove = x => { x.deleted = true; x.updated = now(); };

  /* ---------- events ---------- */
  $('#tabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.tab; history.replaceState(null, '', '#' + tab); render();
  };

  $('#view').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.filter) { taskFilter = b.dataset.filter; return render(); }
    if (b.dataset.len) {
      if (timer.running) return;
      timer.len = timer.left = +b.dataset.len * 60; return render();
    }
    if (act === 'toggle') { const t = findTask(b); t.done = !t.done; t.doneOn = t.done ? dayKey() : null; t.updated = now(); }
    else if (act === 'del') remove(findTask(b));
    else if (act === 'habit') { const h = findHabit(b), k = b.dataset.day; h.log[k] = { on: !isOn(h, k), t: now() }; }
    else if (act === 'delhabit') { const h = findHabit(b); if (!confirm(`Delete habit "${h.name}"?`)) return; remove(h); }
    else if (act === 'newnote') { S.notes.push({ id: uid(), text: '', created: now(), updated: now() }); save(); render(); $('.note textarea')?.focus(); return; }
    else if (act === 'delnote') { const n = findNote(b); if (n.text && !confirm('Delete this note?')) return; remove(n); }
    else if (act === 'showdone') { showDone = !showDone; return render(); }
    else if (act === 'timer') {
      if (timer.running) { clearInterval(timer.iv); timer.running = false; document.title = 'Life'; }
      else {
        timer.area = $('#focusArea').value; timer.running = true; timer.end = now() + timer.left * 1000;
        timer.iv = setInterval(tick, 500);
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      }
      return render();
    }
    else if (act === 'reset') { clearInterval(timer.iv); timer.running = false; timer.left = timer.len; document.title = 'Life'; return render(); }
    else return;
    save(); render();
  });

  $('#view').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    if (f.dataset.form === 'task' && d.title.trim()) {
      S.tasks.push({ id: uid(), title: d.title.trim(), area: d.area, due: d.due || null, done: false, created: now(), updated: now() });
    } else if (f.dataset.form === 'habit' && d.name.trim()) {
      S.habits.push({ id: uid(), name: d.name.trim(), log: {}, updated: now() });
    } else return;
    save(); render();
    $('#view [name=title], #view [name=name]')?.focus();
  });

  $('#view').addEventListener('input', e => {
    if (e.target.id === 'focusInput') { S.focus[dayKey()] = { text: e.target.value, t: now() }; save(); }
    else if (e.target.closest('.note')) { const n = findNote(e.target); n.text = e.target.value; n.updated = now(); save(); }
  });
  $('#view').addEventListener('change', e => { if (e.target.id === 'focusArea') timer.area = e.target.value; });

  /* ================= sync (GitHub Gist) ================= */
  let sync = null;
  try { sync = JSON.parse(localStorage.getItem(SYNC_KEY)); } catch {}
  const storeSync = () => sync ? localStorage.setItem(SYNC_KEY, JSON.stringify(sync)) : localStorage.removeItem(SYNC_KEY);
  let syncState = 'off', syncError = '';

  const setStatus = (state, err = '') => {
    syncState = state; syncError = err;
    const el = $('#syncStatus');
    const label = { off: '', syncing: 'syncing…', ok: 'synced', offline: 'offline', error: 'sync error' }[state];
    el.textContent = label; el.className = 'sync-status' + (state === 'error' ? ' err' : '');
    el.title = err || (sync?.last ? 'Last synced ' + new Date(sync.last).toLocaleString() : '');
    if ($('#menu').open) renderSyncBox();
  };

  const gh = async (path, opts = {}) => {
    const r = await fetch('https://api.github.com' + path, {
      cache: 'no-store', ...opts,
      headers: { Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    });
    if (r.status === 401) throw new Error('GitHub rejected the token. Create a new one and reconnect.');
    if (r.status === 403 || r.status === 404) throw new Error(`GitHub refused access (${r.status}). Make sure the token has the "gist" permission.`);
    if (!r.ok) throw new Error(`GitHub error ${r.status}`);
    return r.json();
  };

  // --- merging: newest version of each record wins; deletes are records too ---
  const newer = (a, b) => (!a ? b : !b ? a : (b.updated || 0) > (a.updated || 0) ? b : a);
  const mergeMap = (a = {}, b = {}) => { const o = { ...a }; for (const k in b) if (!o[k] || (b[k].t || 0) > (o[k].t || 0)) o[k] = b[k]; return o; };
  const mergeList = (a = [], b = [], fn = newer) => {
    const m = new Map(a.map(x => [x.id, x]));
    for (const x of b) m.set(x.id, m.has(x.id) ? fn(m.get(x.id), x) : x);
    return [...m.values()];
  };
  const mergeHabit = (a, b) => ({ ...newer(a, b), log: mergeMap(a.log, b.log) });
  const merge = (l, r) => ({
    ...l,
    areas: (r.areasUpdated || 0) > (l.areasUpdated || 0) ? r.areas : l.areas,
    areasUpdated: Math.max(l.areasUpdated || 0, r.areasUpdated || 0),
    tasks: mergeList(l.tasks, r.tasks),
    notes: mergeList(l.notes, r.notes),
    sessions: mergeList(l.sessions, r.sessions),
    habits: mergeList(l.habits, r.habits, mergeHabit),
    focus: mergeMap(l.focus, r.focus),
  });
  // Forget deleted records after 60 days so the file doesn't grow forever.
  const prune = s => {
    const cutoff = now() - 60 * 864e5;
    for (const k of ['tasks', 'notes', 'habits', 'sessions']) s[k] = s[k].filter(x => !x.deleted || x.updated > cutoff);
  };
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
      catch (e) { if (!/404/.test(e.message)) throw e; sync.gistId = null; await findOrCreateGist(); g = await gh(`/gists/${sync.gistId}`); }
      const f = g.files?.[FILE];
      let remoteText = f?.content || '';
      if (f?.truncated) remoteText = await fetch(f.raw_url, { cache: 'no-store' }).then(r => r.text());
      const before = payload();
      if (remoteText) S = merge(S, migrate(JSON.parse(remoteText)));
      prune(S); store();
      const after = payload();
      if (after !== remoteText) {
        await gh(`/gists/${sync.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: after } } }) });
      }
      if (after !== before) softRender();
      sync.last = now(); storeSync(); setStatus('ok');
    } catch (e) {
      setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e));
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
          <li><a href="https://github.com/settings/tokens/new?scopes=gist&description=Life%20dashboard%20sync" target="_blank" rel="noopener">Create a GitHub token</a> with only the <b>gist</b> box ticked. Set "Expiration" to "No expiration" or a long time.</li>
          <li>Copy it and paste it below. Do the same on every device (you can reuse the same token).</li>
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
        if (!confirm('Stop syncing on this device? Your data stays here and in the gist.')) return;
        sync = null; storeSync(); setStatus('off'); renderSyncBox();
      };
    }
  };

  /* ---------- menu ---------- */
  const menu = $('#menu');
  const renderAreas = () => {
    $('#areaList').innerHTML = S.areas.map((a, i) => `
      <div class="item"><span class="title">${esc(a)}</span><button class="del" data-i="${i}" aria-label="Remove">×</button></div>`).join('');
  };
  $('#menuBtn').onclick = () => { renderSyncBox(); renderAreas(); menu.showModal(); };
  $('#closeMenu').onclick = () => { menu.close(); render(); };
  $('#areaList').onclick = e => {
    const i = e.target.dataset.i; if (i == null) return;
    if (S.areas.length <= 1) return alert('Keep at least one area.');
    S.areas.splice(+i, 1); S.areasUpdated = now();
    if (!S.areas.includes(taskFilter)) taskFilter = 'All';
    save(); renderAreas();
  };
  $('#areaForm').onsubmit = e => {
    e.preventDefault(); const v = $('#areaInput').value.trim();
    if (v && !S.areas.includes(v)) { S.areas.push(v); S.areasUpdated = now(); save(); renderAreas(); }
    $('#areaInput').value = '';
  };
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
      S = sync ? merge(S, migrate(data)) : migrate(data);
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(0); });
  setInterval(() => { if (document.visibilityState === 'visible') runSync(); }, 60000);
  setInterval(header, 60000);

  applyTheme(); render();
  if (sync) runSync();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
