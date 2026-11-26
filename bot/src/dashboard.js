/* The Life dashboard's data, in the same secret gist the dashboard syncs with.
   Same record format as the app: every record has `updated`, deletes are tombstones,
   so the dashboard merges the bot's changes like another device's.
   Loaded only when needed (a tool or the reminders ask for it), never for plain chat. */
const FILE = 'life-dashboard.json';
const COLORS = ['grey', 'sage', 'clay', 'lilac', 'mist', 'sand', 'stone', 'white'];

export const uid = () => Math.random().toString(36).slice(2, 10);
export const live = arr => (arr || []).filter(x => !x.deleted);
export const isTask = t => (t.type || 'task') === 'task';

async function gh(c, path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${c.gist.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'life-telegram-bot' },
  });
  if (r.status === 401) throw new Error('GitHub rejected the token (GITHUB_TOKEN).');
  if (!r.ok) throw new Error(`GitHub error ${r.status}`);
  return r.json();
}
let knownGist = null;
async function gistId(c) {
  if (c.gist.id || knownGist) return c.gist.id || knownGist;
  if (!c.gist.token) throw new Error('The dashboard is not connected (GITHUB_TOKEN).');
  for (let page = 1; page <= 10; page++) {
    const list = await gh(c, `/gists?per_page=100&page=${page}`);
    const g = list.find(g => g.files?.[FILE]);
    if (g) return (knownGist = g.id);
    if (list.length < 100) break;
  }
  throw new Error('Could not find the dashboard data. Turn on Sync in the dashboard first (⋯ → Sync).');
}
async function fetchData(c) {
  const f = (await gh(c, `/gists/${await gistId(c)}`)).files[FILE];
  const text = !f ? '' : f.truncated ? await fetch(f.raw_url).then(r => r.text()) : f.content;
  const s = JSON.parse(text || '{}');
  for (const k of ['pages', 'boards', 'tasks']) s[k] ||= [];
  return s;
}

// Open the dashboard: { s, save() }. save() writes only if something changed, merging record by record
// with whatever is in the gist right then, so an edit made on another device a moment ago isn't lost.
export async function openDashboard(c) {
  const s = await fetchData(c), before = JSON.stringify(s);
  return {
    s,
    async save() {
      if (JSON.stringify(s) === before) return;
      const remote = await fetchData(c), out = { ...remote, ...s };
      for (const k of ['pages', 'boards', 'tasks', 'notes', 'sessions', 'habits']) {
        if (!Array.isArray(remote[k]) && !Array.isArray(s[k])) continue;
        const m = new Map((remote[k] || []).map(x => [x.id, x]));
        for (const x of s[k] || []) { const o = m.get(x.id); if (!o || (x.updated || 0) > (o.updated || 0)) m.set(x.id, x); }
        out[k] = [...m.values()];
      }
      await gh(c, `/gists/${await gistId(c)}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(out) } } }) });
    },
  };
}

/* ---------- reading and changing ---------- */
export const pageList = s => live(s.pages).sort((a, b) => a.order - b.order);
export const boardList = s => live(s.boards).sort((a, b) => {
  const pa = s.pages.find(p => p.id === a.pageId)?.order ?? 0, pb = s.pages.find(p => p.id === b.pageId)?.order ?? 0;
  return pa - pb || a.order - b.order;
});
const norm = x => String(x).toLowerCase().replace(/[-_#]/g, ' ').replace(/\s+/g, ' ').trim();
const fuzzy = (list, name) => {
  if (!name) return null;
  const n = norm(name), l = list.map(x => [x, norm(x.name)]);
  return (l.find(([, x]) => x === n) || l.find(([, x]) => x.startsWith(n)) || l.find(([, x]) => x.includes(n)))?.[0] || null;
};
export const findBoard = (s, name) => fuzzy(boardList(s), name);
export const findPage = (s, name) => fuzzy(pageList(s), name);
export const boardName = (s, id) => s.boards.find(b => b.id === id)?.name || '?';
const firstBoardsPage = s => live(s.pages).filter(p => p.kind !== 'doc').sort((a, b) => a.order - b.order)[0];

export function createBoard(s, name, pageName) {
  let page = findPage(s, pageName);
  if (pageName && !page) { page = { id: 'p-' + uid(), name: pageName, order: (pageList(s).at(-1)?.order ?? -1) + 1, updated: Date.now() }; s.pages.push(page); }
  page ||= firstBoardsPage(s);
  if (!page) { page = { id: 'p-home', name: 'Home', order: 0, updated: Date.now() }; s.pages.push(page); }
  const b = {
    id: 'b-' + uid(), name, pageId: page.id, updated: Date.now(), color: COLORS[live(s.boards).length % (COLORS.length - 1)],
    order: Math.max(-1, ...live(s.boards).filter(x => x.pageId === page.id).map(x => x.order)) + 1,
  };
  s.boards.push(b);
  return b;
}
// Things without a board go to an "Inbox" board, made on the first page the first time.
export function inbox(s) {
  const b = s.boards.find(b => b.id === 'b-inbox');
  if (b && !b.deleted) return b;
  const pageId = firstBoardsPage(s)?.id || 'p-home', order = Math.min(0, ...live(s.boards).map(x => x.order)) - 1;
  if (b) { Object.assign(b, { deleted: false, pageId, updated: Date.now() }); return b; }
  const nb = { id: 'b-inbox', name: 'Inbox', pageId, order, color: COLORS[0], updated: Date.now() };
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

// Notepad pages as plain text (read only).
export const notepads = s => pageList(s).filter(p => p.kind === 'doc').map(p => ({
  page: p.name,
  text: Object.values(p.sheets || {}).map(x => String(x.doc || '')
    .replace(/<\/(p|div|h\d|li|blockquote)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean).join('\n\n---\n\n'),
})).filter(p => p.text);
