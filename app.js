/* Life — a minimal personal dashboard. All data lives in localStorage. */
(() => {
  const KEY = 'life-dashboard-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const dayKey = (d = new Date()) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const defaults = () => ({
    areas: ['Study', 'Work', 'Personal', 'Health'],
    tasks: [],
    habits: [
      { id: uid(), name: 'Read 20 min', log: {} },
      { id: uid(), name: 'Exercise', log: {} },
    ],
    notes: [],
    focus: {},      // { 'YYYY-MM-DD': 'text' }
    sessions: {},   // { 'YYYY-MM-DD': { area: minutes } }
    theme: null,
  });

  let S;
  try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY)) || {}); }
  catch { S = defaults(); }
  const save = () => localStorage.setItem(KEY, JSON.stringify(S));

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
    save(); applyTheme();
  };

  /* ---------- header ---------- */
  const header = () => {
    const now = new Date();
    $('#date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const h = now.getHours();
    $('#greet').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };

  /* ---------- shared task pieces ---------- */
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
      const open = S.tasks.filter(t => !t.done);
      const todays = S.tasks.filter(t => t.due && t.due <= today && (!t.done || t.doneOn === today));
      const doneToday = S.tasks.filter(t => t.doneOn === today).length;
      const habitsDone = S.habits.filter(h => h.log[today]).length;
      const mins = Object.values(S.sessions[today] || {}).reduce((a, b) => a + b, 0);
      return `
        <h2>Today's focus</h2>
        <input class="focus-input" id="focusInput" placeholder="What matters most today?" value="${esc(S.focus[today] || '')}">

        <h2>Overview</h2>
        <div class="stats">
          <div class="stat"><b>${doneToday}</b><span>done today · ${open.length} open</span></div>
          <div class="stat"><b>${habitsDone}/${S.habits.length}</b><span>habits</span></div>
          <div class="stat"><b>${mins}</b><span>focus minutes</span></div>
        </div>

        <h2>Due today</h2>
        ${addTaskForm(today)}
        <ul class="list">${todays.length ? todays.sort(byDue).map(taskItem).join('') : '<li class="empty">Nothing due. Enjoy the calm.</li>'}</ul>

        <h2>Habits</h2>
        <ul class="list">${S.habits.map(h => `
          <li class="item ${h.log[today] ? 'done' : ''}" data-habit="${h.id}">
            <button class="check" data-act="habit" data-day="${today}">${h.log[today] ? '✓' : ''}</button>
            <span class="title">${esc(h.name)}</span>
            <span class="tag">${streak(h)} day streak</span>
          </li>`).join('') || '<li class="empty">No habits yet.</li>'}
        </ul>`;
    },

    tasks() {
      let list = S.tasks.filter(t => taskFilter === 'All' || t.area === taskFilter);
      const done = list.filter(t => t.done);
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
        ${S.habits.map(h => `
          <div class="habit" data-habit="${h.id}">
            <div class="habit-head">
              <span>${esc(h.name)} <span class="muted">· ${streak(h)} day streak</span></span>
              <button class="del" data-act="delhabit" aria-label="Delete">×</button>
            </div>
            <div class="days">${days.map(d => {
              const k = dayKey(d);
              return `<button class="day ${h.log[k] ? 'on' : ''} ${k === today ? 'today' : ''}" data-act="habit" data-day="${k}">
                ${d.toLocaleDateString(undefined, { weekday: 'narrow' })}<br>${d.getDate()}</button>`;
            }).join('')}</div>
          </div>`).join('') || '<p class="empty">Add a habit to start tracking.</p>'}`;
    },

    notes() {
      return `
        <button class="btn" data-act="newnote">+ New note</button>
        <h2>Notes</h2>
        ${S.notes.slice().sort((a, b) => b.updated - a.updated).map(n => `
          <div class="note" data-note="${n.id}">
            <textarea placeholder="Write something…">${esc(n.text)}</textarea>
            <div class="note-foot">
              <span class="muted">${new Date(n.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <button class="del" data-act="delnote" aria-label="Delete">×</button>
            </div>
          </div>`).join('') || '<p class="empty">No notes yet.</p>'}`;
    },

    focus() {
      const week = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        for (const [a, m] of Object.entries(S.sessions[dayKey(d)] || {})) week[a] = (week[a] || 0) + m;
      }
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
    if (!h.log[dayKey(d)]) d.setDate(d.getDate() - 1); // today not done yet doesn't break streak
    while (h.log[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  };

  /* ---------- focus timer ---------- */
  const timer = { len: 1500, left: 1500, running: false, end: 0, area: null, iv: null };
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const tick = () => {
    timer.left = Math.max(0, Math.round((timer.end - Date.now()) / 1000));
    const el = $('#time'); if (el) el.textContent = fmt(timer.left);
    document.title = timer.running ? `${fmt(timer.left)} · Life` : 'Life';
    if (timer.left === 0) finishTimer();
  };
  const finishTimer = () => {
    clearInterval(timer.iv); timer.running = false;
    const mins = Math.round(timer.len / 60);
    if (mins > 5) { // breaks aren't logged
      const k = dayKey(); S.sessions[k] = S.sessions[k] || {};
      const a = timer.area || S.areas[0];
      S.sessions[k][a] = (S.sessions[k][a] || 0) + mins; save();
    }
    timer.left = timer.len; document.title = 'Life';
    try { navigator.vibrate?.(300); new Notification('Focus session complete'); } catch {}
    render();
  };

  /* ---------- render ---------- */
  const render = () => {
    header();
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#view').innerHTML = (views[tab] || views.today)();
  };

  const findTask = el => S.tasks.find(t => t.id === el.closest('[data-id]')?.dataset.id);
  const findHabit = el => S.habits.find(h => h.id === el.closest('[data-habit]')?.dataset.habit);
  const findNote = el => S.notes.find(n => n.id === el.closest('[data-note]')?.dataset.note);

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
    if (act === 'toggle') { const t = findTask(b); t.done = !t.done; t.doneOn = t.done ? dayKey() : null; }
    else if (act === 'del') { const t = findTask(b); S.tasks = S.tasks.filter(x => x !== t); }
    else if (act === 'habit') { const h = findHabit(b), k = b.dataset.day; h.log[k] ? delete h.log[k] : (h.log[k] = true); }
    else if (act === 'delhabit') { const h = findHabit(b); if (!confirm(`Delete habit "${h.name}"?`)) return; S.habits = S.habits.filter(x => x !== h); }
    else if (act === 'newnote') { S.notes.push({ id: uid(), text: '', updated: Date.now() }); save(); render(); $('.note textarea')?.focus(); return; }
    else if (act === 'delnote') { const n = findNote(b); if (n.text && !confirm('Delete this note?')) return; S.notes = S.notes.filter(x => x !== n); }
    else if (act === 'showdone') { showDone = !showDone; return render(); }
    else if (act === 'timer') {
      if (timer.running) { clearInterval(timer.iv); timer.running = false; document.title = 'Life'; }
      else {
        timer.area = $('#focusArea').value; timer.running = true; timer.end = Date.now() + timer.left * 1000;
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
      S.tasks.push({ id: uid(), title: d.title.trim(), area: d.area, due: d.due || null, done: false, created: Date.now() });
    } else if (f.dataset.form === 'habit' && d.name.trim()) {
      S.habits.push({ id: uid(), name: d.name.trim(), log: {} });
    } else return;
    save(); render();
    $('#view [name=title], #view [name=name]')?.focus();
  });

  $('#view').addEventListener('input', e => {
    if (e.target.id === 'focusInput') { S.focus[dayKey()] = e.target.value; save(); }
    else if (e.target.closest('.note')) { const n = findNote(e.target); n.text = e.target.value; n.updated = Date.now(); save(); }
  });
  $('#view').addEventListener('change', e => { if (e.target.id === 'focusArea') timer.area = e.target.value; });

  /* ---------- data menu ---------- */
  const menu = $('#menu');
  const renderAreas = () => {
    $('#areaList').innerHTML = S.areas.map((a, i) => `
      <div class="item"><span class="title">${esc(a)}</span><button class="del" data-i="${i}" aria-label="Remove">×</button></div>`).join('');
  };
  $('#menuBtn').onclick = () => { renderAreas(); menu.showModal(); };
  $('#closeMenu').onclick = () => { menu.close(); render(); };
  $('#areaList').onclick = e => {
    const i = e.target.dataset.i; if (i == null) return;
    if (S.areas.length <= 1) return alert('Keep at least one area.');
    S.areas.splice(+i, 1); if (!S.areas.includes(taskFilter)) taskFilter = 'All';
    save(); renderAreas();
  };
  $('#areaForm').onsubmit = e => {
    e.preventDefault(); const v = $('#areaInput').value.trim();
    if (v && !S.areas.includes(v)) { S.areas.push(v); save(); renderAreas(); }
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
      if (!confirm('Replace all data on this device with this backup?')) return;
      S = Object.assign(defaults(), data); save(); applyTheme(); menu.close(); render();
    } catch { alert('That file is not a valid backup.'); }
    e.target.value = '';
  };

  /* ---------- boot ---------- */
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('storage', e => { if (e.key === KEY) { S = Object.assign(defaults(), JSON.parse(e.newValue)); render(); } });
  setInterval(header, 60000);
  applyTheme(); render();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
