/* Tools for the Life dashboard: find, add, change and organise tasks, notes and boards, and read notepad pages. */
import { live, isTask, boardList, pageList, findBoard, boardName, createBoard, inbox, addItem, openTasks, byDue, notepads } from '../dashboard.js';
import { today } from '../time.js';

const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
// Some models send a list as a JSON string, or one object instead of a list.
const list = x => {
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return []; } }
  return Array.isArray(x) ? x : x && typeof x === 'object' ? [x] : [];
};
const validDue = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(d.trim()) ? d.trim() : null);
const view = (s, t) => ({
  id: t.id, title: t.title, board: boardName(s, t.boardId), type: t.type || 'task',
  ...(isTask(t) && { done: !!t.done, ...(t.doneOn && { doneOn: t.doneOn }), ...(t.due && { due: t.due }) }),
});

export function dashboardTools(ctx) {
  const dash = async () => (await ctx.dashboard()).s;
  return [
    {
      name: 'dashboard_overview',
      description: 'See the dashboard: pages, boards with their number of open tasks, notepad pages, and how many tasks are late.',
      input_schema: obj({}),
      run: async () => {
        const s = await dash(), day = today(ctx.c.tz);
        const boards = pageList(s).filter(p => p.kind !== 'doc').map(p => `${p.name}: ${boardList(s).filter(b => b.pageId === p.id).map(b => `${b.name} (${openTasks(s, b.id).length} open)`).join(', ') || '(no boards)'}`);
        const docs = pageList(s).filter(p => p.kind === 'doc').map(p => p.name);
        const late = openTasks(s).filter(t => t.due && t.due.slice(0, 10) < day).length;
        return `Boards by page:\n${boards.join('\n')}\n${docs.length ? `Notepad pages: ${docs.join(', ')}\n` : ''}Open tasks: ${openTasks(s).length}, late: ${late}.`;
      },
    },
    {
      name: 'find_items',
      description: 'Search dashboard items. With no filters: all open tasks. Use it before changing anything and to answer questions about tasks.',
      input_schema: obj({
        text: { type: 'string', description: 'Words in the title (any language). Empty for all.' },
        board: { type: 'string', description: 'Only this board.' },
        status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Tasks: open (default), done, or all. Notes and headings only with "all".' },
        due_from: { type: 'string', description: 'Due on/after YYYY-MM-DD.' },
        due_to: { type: 'string', description: 'Due on/before YYYY-MM-DD (with status open: late tasks).' },
      }),
      run: async ({ text, board, status = 'open', due_from, due_to }) => {
        const s = await dash(), b = board ? findBoard(s, board) : null;
        if (board && !b) return `No board called "${board}". Boards: ${boardList(s).map(x => x.name).join(', ')}`;
        const words = (text || '').toLowerCase().split(/\s+/).filter(Boolean);
        return JSON.stringify(live(s.tasks).filter(t => t.title
          && (!b || t.boardId === b.id)
          && (status === 'all' || (isTask(t) && (status === 'done' ? t.done : !t.done)))
          && (!due_from || (t.due && t.due.slice(0, 10) >= due_from))
          && (!due_to || (t.due && t.due.slice(0, 10) <= due_to))
          && words.every(w => t.title.toLowerCase().includes(w))).sort(byDue).slice(0, 100).map(t => view(s, t)));
      },
    },
    {
      name: 'add_items',
      description: 'Add tasks, notes, headings or bullets to the dashboard. A task with a time is also a reminder at that time.',
      input_schema: obj({
        items: {
          type: 'array',
          items: obj({
            title: { type: 'string' },
            board: { type: 'string', description: 'Existing board name (by meaning). Empty → Inbox.' },
            type: { type: 'string', enum: ['task', 'note', 'heading', 'bullet'], description: 'Default task.' },
            due: { type: 'string', description: 'YYYY-MM-DD or YYYY-MM-DDTHH:MM (local, 24h). Tasks only.' },
          }, ['title']),
        },
      }, ['items']),
      run: async ({ items }) => {
        const s = await dash();
        return JSON.stringify(list(items).map(i => {
          const b = findBoard(s, i.board) || inbox(s);
          return view(s, addItem(s, { title: String(i.title).trim(), boardId: b.id, type: i.type || 'task', due: validDue(i.due) }));
        }));
      },
    },
    {
      name: 'update_items',
      description: 'Change items by id (from find_items): rename, set or clear the deadline, move to another board, tick off / untick, or delete.',
      input_schema: obj({
        changes: {
          type: 'array',
          items: obj({
            id: { type: 'string' }, title: { type: 'string' },
            due: { type: 'string', description: 'New deadline, or "none" to remove it.' },
            board: { type: 'string', description: 'Move to this board.' },
            done: { type: 'boolean', description: 'true = tick off, false = open again.' },
            delete: { type: 'boolean' },
          }, ['id']),
        },
      }, ['changes']),
      run: async ({ changes }) => {
        const s = await dash();
        return JSON.stringify(list(changes).map(ch => {
          const t = s.tasks.find(x => x.id === ch.id && !x.deleted);
          if (!t) return { id: ch.id, error: 'not found' };
          if (ch.delete) { t.deleted = true; t.updated = Date.now(); return { id: t.id, title: t.title, deleted: true }; }
          if (ch.title) t.title = ch.title.trim();
          if (ch.due !== undefined) t.due = ch.due === 'none' || !ch.due ? null : validDue(ch.due) ?? t.due;
          if (ch.board) { const b = findBoard(s, ch.board); if (!b) return { id: t.id, error: `no board "${ch.board}"` }; t.boardId = b.id; }
          if (ch.done !== undefined) { t.type = 'task'; t.done = ch.done; t.doneOn = ch.done ? today(ctx.c.tz) : null; }
          t.updated = Date.now();
          return view(s, t);
        }));
      },
    },
    {
      name: 'create_board',
      description: 'Create a new board (only when the user asks).',
      input_schema: obj({ name: { type: 'string' }, page: { type: 'string', description: 'Page name (made if missing). Empty → first page.' } }, ['name']),
      run: async ({ name, page }) => {
        const s = await dash(), existing = findBoard(s, name);
        if (existing && existing.name.toLowerCase() === name.toLowerCase()) return `A board "${existing.name}" already exists.`;
        const b = createBoard(s, name.trim(), page);
        return `Created board "${b.name}" on page "${s.pages.find(p => p.id === b.pageId)?.name}".`;
      },
    },
    {
      name: 'read_notepad',
      description: "Read the user's notepad pages on the dashboard (read only).",
      input_schema: obj({ page: { type: 'string', description: 'Page name; empty for all.' } }),
      run: async ({ page }) => {
        const pages = notepads(await dash()).filter(p => !page || p.page.toLowerCase().includes(page.toLowerCase()));
        return pages.length ? pages.map(p => `# ${p.page}\n${p.text.slice(0, 30000)}`).join('\n\n') : 'No notepad writing found.';
      },
    },
  ];
}
