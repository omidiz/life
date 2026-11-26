/* The dashboard's data, read from and written to the same secret gist the dashboard syncs with.
   Same record format as the app: every record has `updated`, deletes are tombstones,
   so the dashboard merges the bot's changes like another device's. */

export const FILE = 'life-dashboard.json';
const BOT_FILE = 'life-bot.json'; // the bot's own memory, in the same gist (the dashboard ignores it)
const COLORS = ['grey', 'sage', 'clay', 'lilac', 'mist', 'sand', 'stone', 'white'];

export const uid = () => Math.random().toString(36).slice(2, 10);
export const live = arr => (arr || []).filter(x => !x.deleted);
export const isTask = t => (t.type || 'task') === 'task';
export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ---------- time, in the user's time zone ---------- */
const tz = env => env.TZ || 'Asia/Tehran';
const parts = (env, d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: tz(env), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(d).map(p => [p.type, p.value]));
export const dayKey = (env, d = new Date()) => { const p = parts(env, d); return `${p.year}-${p.month}-${p.day}`; };
export const nowKey = (env, d = new Date()) => { const p = parts(env, d); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
export const addDays = (key, n) => { const d = new Date(key.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Shift a local 'YYYY-MM-DDTHH:MM' by some minutes (pure calendar math, no time zone needed).
export const addMinutes = (key, min) => new Date(new Date(key + ':00Z').getTime() + min * 60000).toISOString().slice(0, 16);
export const persianDate = (env, d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: tz(env), weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`; // پنجشنبه ۵ آذر ۱۴۰۵
};
export const weekdayName = (env, d = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: tz(env), weekday: 'long' }).format(d);

/* ---------- GitHub gist ---------- */
async function gh(env, path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'life-telegram-bot' },
  });
  if (r.status === 401) throw new Error('GitHub rejected the token (GITHUB_TOKEN).');
  if (!r.ok) throw new Error(`GitHub error ${r.status}`);
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
  throw new Error('Could not find the dashboard data. Turn on Sync in the dashboard first (⋯ → Sync).');
}
const fileText = async f => (!f ? '' : f.truncated ? fetch(f.raw_url).then(r => r.text()) : f.content);

async function fetchAll(env) {
  const g = await gh(env, `/gists/${await gistId(env)}`);
  const s = JSON.parse((await fileText(g.files[FILE])) || '{}');
  for (const k of ['pages', 'boards', 'tasks']) s[k] ||= [];
  let bot = {};
  try { bot = JSON.parse((await fileText(g.files[BOT_FILE])) || '{}'); } catch {}
  bot.chat ||= []; bot.reminded ||= {};
  return { s, bot };
}

// Load once per message; call save() at the end. Only what changed is written.
export async function open(env) {
  const { s, bot } = await fetchAll(env);
  const before = JSON.stringify(s), botBefore = JSON.stringify(bot);
  return {
    s, bot,
    async save() {
      const dataChanged = JSON.stringify(this.s) !== before, botChanged = JSON.stringify(this.bot) !== botBefore;
      if (!dataChanged && !botChanged) return;
      const files = {};
      if (dataChanged) {
        // Re-read right before writing and keep the newest version of each record,
        // so an edit made on another device a moment ago isn't lost.
        const remote = (await fetchAll(env)).s, out = { ...remote, ...this.s };
        for (const k of ['pages', 'boards', 'tasks', 'notes', 'sessions', 'habits']) {
          if (!Array.isArray(remote[k]) && !Array.isArray(this.s[k])) continue;
          const m = new Map((remote[k] || []).map(x => [x.id, x]));
          for (const x of this.s[k] || []) { const o = m.get(x.id); if (!o || (x.updated || 0) > (o.updated || 0)) m.set(x.id, x); }
          out[k] = [...m.values()];
        }
        files[FILE] = { content: JSON.stringify(out) };
      }
      if (botChanged) files[BOT_FILE] = { content: JSON.stringify(this.bot) };
      await gh(env, `/gists/${await gistId(env)}`, { method: 'PATCH', body: JSON.stringify({ files }) });
    },
  };
}

/* ---------- reading and changing the dashboard ---------- */
export const pageList = s => live(s.pages).sort((a, b) => a.order - b.order);
export const boardList = s => live(s.boards).sort((a, b) => {
  const pa = s.pages.find(p => p.id === a.pageId)?.order ?? 0, pb = s.pages.find(p => p.id === b.pageId)?.order ?? 0;
  return pa - pb || a.order - b.order;
});
const norm = x => String(x).toLowerCase().replace(/[-_#]/g, ' ').replace(/\s+/g, ' ').trim();
export const findBoard = (s, name) => {
  if (!name) return null;
  const n = norm(name), list = boardList(s).map(b => [b, norm(b.name)]);
  return (list.find(([, x]) => x === n) || list.find(([, x]) => x.startsWith(n)) || list.find(([, x]) => x.includes(n)))?.[0] || null;
};
export const findPage = (s, name) => {
  if (!name) return null;
  const n = norm(name), list = pageList(s).map(p => [p, norm(p.name)]);
  return (list.find(([, x]) => x === n) || list.find(([, x]) => x.startsWith(n)))?.[0] || null;
};
export const boardName = (s, id) => s.boards.find(b => b.id === id)?.name || '?';

export function createBoard(s, name, pageName) {
  let page = findPage(s, pageName) || live(s.pages).filter(p => p.kind !== 'doc').sort((a, b) => a.order - b.order)[0];
  if (pageName && !findPage(s, pageName)) { // a new boards page
    page = { id: 'p-' + uid(), name: pageName, order: (pageList(s).at(-1)?.order ?? -1) + 1, updated: Date.now() };
    s.pages.push(page);
  }
  if (!page) { page = { id: 'p-home', name: 'Home', order: 0, updated: Date.now() }; s.pages.push(page); }
  const n = live(s.boards).length;
  const b = { id: 'b-' + uid(), name, pageId: page.id, order: Math.max(-1, ...live(s.boards).filter(x => x.pageId === page.id).map(x => x.order)) + 1, color: COLORS[n % (COLORS.length - 1)], updated: Date.now() };
  s.boards.push(b);
  return b;
}
// Things without a board go to an "Inbox" board, made on the first page the first time.
export function inbox(s) {
  const b = s.boards.find(b => b.id === 'b-inbox');
  if (b && !b.deleted) return b;
  const first = live(s.pages).filter(p => p.kind !== 'doc').sort((a, b) => a.order - b.order)[0]?.id || 'p-home';
  const order = Math.min(0, ...live(s.boards).map(x => x.order)) - 1;
  if (b) { Object.assign(b, { deleted: false, pageId: first, updated: Date.now() }); return b; }
  const nb = { id: 'b-inbox', name: 'Inbox', pageId: first, order, color: COLORS[0], updated: Date.now() };
  s.boards.push(nb);
  return nb;
}
export function addItem(s, { title, boardId, type = 'task', due = null }) {
  const pos = Math.max(-1, ...s.tasks.filter(t => t.boardId === boardId).map(t => t.pos ?? 0)) + 1;
  const t = { id: uid(), boardId, type, title, due: type === 'task' ? due : null, done: false, doneOn: null, pos, created: Date.now(), updated: Date.now() };
  s.tasks.push(t);
  return t;
}
export const openTasks = (s, boardId) => live(s.tasks).filter(t => isTask(t) && !t.done && t.title && (!boardId || t.boardId === boardId));
export const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.pos ?? 0) - (b.pos ?? 0);

// Notepad pages: plain text of each sheet, for reading only.
export const notepadText = s => pageList(s).filter(p => p.kind === 'doc').map(p => ({
  page: p.name,
  text: Object.values(p.sheets || {}).map(x => String(x.doc || '')
    .replace(/<\/(p|div|h\d|li|blockquote)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean).join('\n\n---\n\n'),
})).filter(p => p.text);
