/* Life — personal Telegram bot.
   Runs as a Cloudflare Worker. It reads and writes the same secret gist the dashboard
   syncs with, using the same record format (every record has `updated`, deletes are
   tombstones), so the dashboard merges the bot's changes like another device's.

   Secrets (wrangler secret put …): TELEGRAM_TOKEN, GITHUB_TOKEN, CHAT_ID, WEBHOOK_SECRET
   Optional vars: GIST_ID (found automatically if missing), TZ (default Asia/Tehran) */

const FILE = 'life-dashboard.json';
const COLORS = ['grey', 'sage', 'clay', 'lilac', 'mist', 'sand', 'stone', 'white'];
const uid = () => Math.random().toString(36).slice(2, 10);
const live = arr => (arr || []).filter(x => !x.deleted);
const isTask = t => (t.type || 'task') === 'task';
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ---------- dates in the user's time zone ---------- */
const tzOf = env => env.TZ || 'Asia/Tehran';
const dayKey = (env, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tzOf(env), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (key, n) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = key => new Date(key + 'T12:00:00Z').getUTCDay();
const FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Pull "@today", "@tomorrow", "@fri", "@12-05", "@2026-12-05", "@18:00" out of a message.
function parseDue(text, env) {
  const today = dayKey(env);
  let date = null, time = null;
  const rest = text.replace(/(^|\s)@(\S+)/g, (m, sp, tok) => {
    const t = tok.toLowerCase();
    let hit;
    if (t === 'today') date = today;
    else if (t === 'tomorrow' || t === 'tmr') date = addDays(today, 1);
    else if (FULL.some(d => d.startsWith(t) && t.length >= 3)) {
      const want = FULL.findIndex(d => d.startsWith(t));
      date = addDays(today, ((want - weekday(today) + 7) % 7) || 7);
    } else if ((hit = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) date = `${hit[1]}-${hit[2].padStart(2, '0')}-${hit[3].padStart(2, '0')}`;
    else if ((hit = t.match(/^(\d{1,2})[-/](\d{1,2})$/))) {
      let d = `${today.slice(0, 4)}-${hit[1].padStart(2, '0')}-${hit[2].padStart(2, '0')}`;
      if (d < today) d = `${+today.slice(0, 4) + 1}${d.slice(4)}`;
      date = d;
    } else if ((hit = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/)) && (hit[2] || hit[3])) {
      let h = +hit[1]; if (hit[3] === 'pm' && h < 12) h += 12; if (hit[3] === 'am' && h === 12) h = 0;
      time = `${String(h).padStart(2, '0')}:${hit[2] || '00'}`;
    } else return m;
    return sp;
  }).replace(/\s+/g, ' ').trim();
  if (time && !date) date = today;
  return { text: rest, due: date ? (time ? `${date}T${time}` : date) : null };
}

const dueLabel = (due, env) => {
  if (!due) return '';
  const today = dayKey(env), day = due.slice(0, 10), time = due.length > 10 ? ' ' + due.slice(11, 16) : '';
  const diff = Math.round((new Date(day) - new Date(today)) / 864e5);
  if (diff < 0) return ` — <b>${-diff} day${diff < -1 ? 's' : ''} late</b>`;
  if (diff === 0) return ` — due today${time}`;
  if (diff === 1) return ` — tomorrow${time}`;
  return ` — ${day}${time}`;
};

/* ---------- GitHub gist (the dashboard's sync file) ---------- */
async function gh(env, path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'life-telegram-bot' },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}
async function gistId(env) {
  if (env.GIST_ID) return env.GIST_ID;
  for (let page = 1; page <= 10; page++) {
    const list = await gh(env, `/gists?per_page=100&page=${page}`);
    const g = list.find(g => g.files?.[FILE]);
    if (g) return (env.GIST_ID = g.id);
    if (list.length < 100) break;
  }
  throw new Error('No life-dashboard.json gist found. Turn on Sync in the dashboard first (⋯ → Sync).');
}
async function load(env) {
  const g = await gh(env, `/gists/${await gistId(env)}`);
  const f = g.files[FILE];
  const text = f.truncated ? await fetch(f.raw_url).then(r => r.text()) : f.content;
  const s = JSON.parse(text || '{}');
  for (const k of ['pages', 'boards', 'tasks']) s[k] ||= [];
  return s;
}
// Re-read right before writing and keep the newest version of each record, so an edit
// made on another device a moment ago isn't lost.
async function save(env, mine) {
  const remote = await load(env);
  const out = { ...remote, ...mine };
  for (const k of ['pages', 'boards', 'tasks', 'notes', 'sessions', 'habits']) {
    if (!Array.isArray(remote[k]) && !Array.isArray(mine[k])) continue;
    const m = new Map((remote[k] || []).map(x => [x.id, x]));
    for (const x of mine[k] || []) { const o = m.get(x.id); if (!o || (x.updated || 0) > (o.updated || 0)) m.set(x.id, x); }
    out[k] = [...m.values()];
  }
  await gh(env, `/gists/${await gistId(env)}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(out) } } }) });
}

/* ---------- reading and changing the data ---------- */
const boardList = s => live(s.boards).sort((a, b) => {
  const pa = s.pages.find(p => p.id === a.pageId)?.order ?? 0, pb = s.pages.find(p => p.id === b.pageId)?.order ?? 0;
  return pa - pb || a.order - b.order;
});
const findBoard = (s, name) => {
  const n = name.toLowerCase().replace(/[-_]/g, ' ');
  const list = boardList(s).map(b => [b, b.name.toLowerCase()]);
  return (list.find(([, x]) => x === n) || list.find(([, x]) => x.startsWith(n)) || list.find(([, x]) => x.includes(n)))?.[0];
};
// Messages without a #board go to an "Inbox" board, made on the first page the first time.
function inbox(s) {
  let b = s.boards.find(b => b.id === 'b-inbox');
  if (b && !b.deleted) return b;
  const first = live(s.pages).sort((a, b) => a.order - b.order)[0]?.id || 'p-home';
  const order = Math.min(0, ...live(s.boards).map(x => x.order)) - 1;
  if (b) Object.assign(b, { deleted: false, pageId: first, updated: Date.now() });
  else s.boards.push(b = { id: 'b-inbox', name: 'Inbox', pageId: first, order, color: COLORS[0], updated: Date.now() });
  return b;
}
const openTasks = (s, boardId) => live(s.tasks).filter(t => isTask(t) && !t.done && t.title && (!boardId || t.boardId === boardId));
const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.pos - b.pos;

function addItem(s, env, raw, type = 'task') {
  let text = raw.trim(), board;
  const tag = text.match(/(^|\s)#([^\s#]+)/);
  if (tag) { board = findBoard(s, tag[2]); if (board) text = text.replace(tag[0], ' ').trim(); }
  board ||= inbox(s);
  const { text: title, due } = type === 'task' ? parseDue(text, env) : { text, due: null };
  if (!title) return null;
  const pos = Math.max(-1, ...s.tasks.filter(t => t.boardId === board.id).map(t => t.pos ?? 0)) + 1;
  const t = { id: uid(), boardId: board.id, type, title, due, done: false, doneOn: null, pos, created: Date.now(), updated: Date.now() };
  s.tasks.push(t);
  return { t, board };
}

/* ---------- Telegram ---------- */
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
const send = (env, text, extra = {}) => tg(env, 'sendMessage', { chat_id: env.CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
const doneButtons = tasks => ({ inline_keyboard: tasks.slice(0, 30).map(t => [{ text: '✓ ' + t.title.slice(0, 40), callback_data: 'done:' + t.id }]) });
const lines = (s, env, tasks, showBoard = true) => tasks.map(t => {
  const b = showBoard ? s.boards.find(b => b.id === t.boardId)?.name : '';
  return `○ ${esc(t.title)}${dueLabel(t.due, env)}${b ? `  <i>${esc(b)}</i>` : ''}`;
}).join('\n');

const HELP = `<b>Life bot</b> — your dashboard in Telegram.

Just send a message and it becomes a task in <b>Inbox</b>.
<code>Call mom #personal @tomorrow</code> — task on the Personal board, due tomorrow
<code>Essay #study @fri @18:00</code> — due Friday at 18:00
Dates: @today @tomorrow @mon…@sun @12-05 @2026-12-05, times: @9am @18:30

/today — overdue and due today
/week — due in the next 7 days
/list — all open tasks (or <code>/list work</code> for one board)
/boards — your boards
/note text — add a note line (use #board too)
/done — tick tasks off with buttons
/undo — remove the last thing you added`;

function brief(s, env) {
  const today = dayKey(env), open = openTasks(s);
  const late = open.filter(t => t.due && t.due.slice(0, 10) < today).sort(byDue);
  const due = open.filter(t => t.due && t.due.slice(0, 10) === today).sort(byDue);
  const doneToday = live(s.tasks).filter(t => t.doneOn === today).length;
  let msg = `<b>Today, ${today}</b>\n`;
  if (late.length) msg += `\n<b>Late</b>\n${lines(s, env, late)}\n`;
  if (due.length) msg += `\n<b>Due today</b>\n${lines(s, env, due)}\n`;
  if (!late.length && !due.length) msg += `\nNothing due today. ${open.length} open task${open.length === 1 ? '' : 's'} in total.`;
  if (doneToday) msg += `\n✓ ${doneToday} done today`;
  return { msg, tasks: [...late, ...due] };
}

async function onMessage(env, m) {
  const text = (m.text || m.caption || '').trim();
  if (!text) return send(env, 'Send me text and I will put it on your dashboard.');
  const [cmd0, ...restParts] = text.split(/\s+/);
  const cmd = cmd0.startsWith('/') ? cmd0.slice(1).split('@')[0].toLowerCase() : null;
  const arg = restParts.join(' ').trim();

  if (cmd === 'start' || cmd === 'help') return send(env, HELP);
  const s = await load(env);

  if (cmd === 'today') { const { msg, tasks } = brief(s, env); return send(env, msg, tasks.length ? { reply_markup: doneButtons(tasks) } : {}); }
  if (cmd === 'week') {
    const today = dayKey(env), end = addDays(today, 7);
    const list = openTasks(s).filter(t => t.due && t.due.slice(0, 10) <= end).sort(byDue);
    return send(env, list.length ? `<b>Next 7 days</b>\n${lines(s, env, list)}` : 'Nothing due in the next 7 days.', list.length ? { reply_markup: doneButtons(list) } : {});
  }
  if (cmd === 'list' || cmd === 'done') {
    const board = arg ? findBoard(s, arg) : null;
    if (arg && !board) return send(env, `No board called “${esc(arg)}”. /boards lists them.`);
    const list = openTasks(s, board?.id).sort(byDue);
    if (!list.length) return send(env, board ? `Nothing open on ${esc(board.name)}.` : 'No open tasks. 🎉');
    let msg;
    if (board) msg = `<b>${esc(board.name)}</b>\n${lines(s, env, list, false)}`;
    else msg = boardList(s).map(b => [b, list.filter(t => t.boardId === b.id)]).filter(([, l]) => l.length)
      .map(([b, l]) => `<b>${esc(b.name)}</b>\n${lines(s, env, l, false)}`).join('\n\n');
    return send(env, msg + (cmd === 'done' || list.length <= 30 ? '\n\nTap to tick off:' : ''), { reply_markup: doneButtons(list) });
  }
  if (cmd === 'boards') {
    const pages = live(s.pages).sort((a, b) => a.order - b.order);
    const msg = pages.map(p => {
      const bs = boardList(s).filter(b => b.pageId === p.id);
      return bs.length ? `<b>${esc(p.name)}</b>\n` + bs.map(b => `• ${esc(b.name)} (${openTasks(s, b.id).length})  <code>#${esc(b.name.toLowerCase().replace(/\s+/g, '-'))}</code>`).join('\n') : '';
    }).filter(Boolean).join('\n\n');
    return send(env, msg || 'No boards yet.');
  }
  if (cmd === 'undo') {
    const last = live(s.tasks).filter(t => t.viaBot).sort((a, b) => b.created - a.created)[0];
    if (!last || Date.now() - last.created > 864e5) return send(env, 'Nothing to undo.');
    last.deleted = true; last.updated = Date.now(); await save(env, s);
    return send(env, `Removed “${esc(last.title)}”.`);
  }
  if (cmd && cmd !== 'note' && cmd !== 'add') return send(env, 'I don’t know that command. /help');

  const r = addItem(s, env, cmd ? arg : text, cmd === 'note' ? 'note' : 'task');
  if (!r) return send(env, cmd === 'note' ? 'Write the note after /note.' : 'Write the task after /add.');
  r.t.viaBot = true;
  await save(env, s);
  return send(env, `${r.t.type === 'note' ? '✎ Note' : '○ Task'} added to <b>${esc(r.board.name)}</b>: ${esc(r.t.title)}${dueLabel(r.t.due, env)}`);
}

async function onCallback(env, q) {
  const [act, id] = (q.data || '').split(':');
  if (act !== 'done') return tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
  const s = await load(env), t = s.tasks.find(t => t.id === id);
  if (!t || t.deleted) return tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'That task is gone.' });
  if (!t.done) { t.done = true; t.doneOn = dayKey(env); t.updated = Date.now(); await save(env, s); }
  await tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text: '✓ ' + t.title.slice(0, 180) });
  // Drop the ticked task's button from the message.
  const kb = q.message?.reply_markup?.inline_keyboard?.filter(row => row[0]?.callback_data !== q.data);
  if (q.message) await tg(env, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: kb || [] } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // One-time setup: open https://<worker>/setup?secret=<WEBHOOK_SECRET> in a browser.
    if (url.pathname === '/setup') {
      if (url.searchParams.get('secret') !== env.WEBHOOK_SECRET) return new Response('Wrong secret', { status: 403 });
      const hook = await tg(env, 'setWebhook', { url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
      await tg(env, 'setMyCommands', { commands: [
        ['today', 'Overdue and due today'], ['week', 'Due in the next 7 days'], ['list', 'All open tasks'], ['done', 'Tick tasks off'],
        ['boards', 'Your boards'], ['note', 'Add a note'], ['undo', 'Remove the last thing added'], ['help', 'How to use the bot'],
      ].map(([command, description]) => ({ command, description })) });
      return Response.json(hook);
    }
    if (url.pathname !== '/telegram' || req.method !== 'POST') return new Response('Life bot is running.');
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });

    const u = await req.json();
    const chat = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
    // Personal bot: anyone else gets their chat id (handy for first setup) and nothing more.
    if (String(chat) !== String(env.CHAT_ID)) {
      if (u.message) await tg(env, 'sendMessage', { chat_id: chat, text: `This is a private bot. Your chat id is ${chat}.` });
      return new Response('ok');
    }
    try {
      if (u.message) await onMessage(env, u.message);
      else if (u.callback_query) await onCallback(env, u.callback_query);
    } catch (e) {
      await send(env, '⚠️ ' + esc(e.message || String(e)));
    }
    return new Response('ok');
  },

  // Morning brief (time set in wrangler.toml).
  async scheduled(_event, env) {
    const s = await load(env);
    const { msg, tasks } = brief(s, env);
    await send(env, 'Good morning ☀️\n\n' + msg, tasks.length ? { reply_markup: doneButtons(tasks) } : {});
  },
};

export { parseDue, addItem, brief, dayKey };
