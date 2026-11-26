/* Tools for the Life dashboard: find, add, change and organise tasks, notes and boards, and read notepad pages. */
import { live, isTask, boardList, pageList, findBoard, findPage, boardName, createBoard, createPage, deleteBoard, deletePage, inbox, addItem, openTasks, byDue,
  COLORS, sheetIds, addSheet, markdownToDoc, notepadSheets } from '../dashboard.js';
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
      description: 'Create a new board (a card on a boards page).',
      input_schema: obj({
        name: { type: 'string' },
        page: { type: 'string', description: 'Boards page to put it on (made if missing). Empty → first page.' },
        color: { type: 'string', enum: COLORS },
      }, ['name']),
      run: async ({ name, page, color }) => {
        const s = await dash(), existing = findBoard(s, name);
        if (existing && existing.name.toLowerCase() === name.toLowerCase()) return `A board "${existing.name}" already exists.`;
        const b = createBoard(s, name.trim(), page);
        if (COLORS.includes(color)) b.color = color;
        return `Created board "${b.name}" on page "${s.pages.find(p => p.id === b.pageId)?.name}".`;
      },
    },
    {
      name: 'manage_board',
      description: 'Change a board: rename it, change its colour, move it to another page, or delete it with everything on it '
        + '(delete only when the user clearly asked for that board to be deleted).',
      input_schema: obj({
        board: { type: 'string', description: 'The board’s current name.' },
        rename: { type: 'string' }, color: { type: 'string', enum: COLORS },
        page: { type: 'string', description: 'Move to this boards page (made if missing).' },
        delete: { type: 'boolean' },
      }, ['board']),
      run: async ({ board, rename, color, page, delete: del }) => {
        const s = await dash(), b = findBoard(s, board);
        if (!b) return `No board called "${board}". Boards: ${boardList(s).map(x => x.name).join(', ')}`;
        if (del) { const n = openTasks(s, b.id).length; deleteBoard(s, b); return `Deleted board "${b.name}" (it had ${n} open tasks).`; }
        if (rename) b.name = rename.trim();
        if (COLORS.includes(color)) b.color = color;
        if (page) {
          let p = pageList(s).filter(x => x.kind !== 'doc').find(x => x.name.toLowerCase() === page.toLowerCase()) || findPage(s, page);
          if (p?.kind === 'doc') return `"${p.name}" is a notepad page; boards go on boards pages.`;
          p ||= createPage(s, page.trim());
          b.pageId = p.id; delete b.x; delete b.y; // the dashboard finds it a free spot
        }
        b.updated = Date.now();
        return `Board is now "${b.name}", colour ${b.color}, on page "${s.pages.find(p => p.id === b.pageId)?.name}".`;
      },
    },
    {
      name: 'manage_page',
      description: 'Pages are the tabs at the top of the dashboard: a boards page holds boards; a notepad page holds sheets to write on. '
        + 'Create, rename, move or delete a page (delete only when the user clearly asked for that page; it deletes everything on it).',
      input_schema: obj({
        action: { type: 'string', enum: ['create', 'rename', 'move', 'delete'] },
        name: { type: 'string', description: 'The page (for create: its name).' },
        kind: { type: 'string', enum: ['boards', 'notepad'], description: 'For create. Default boards.' },
        new_name: { type: 'string', description: 'For rename.' },
        position: { type: 'integer', description: 'For move: 1 = first tab.' },
      }, ['action', 'name']),
      run: async ({ action, name, kind, new_name, position }) => {
        const s = await dash();
        if (action === 'create') {
          if (findPage(s, name)?.name.toLowerCase() === name.toLowerCase()) return `A page "${name}" already exists.`;
          const p = createPage(s, name.trim(), kind);
          return `Created ${kind === 'notepad' ? 'notepad' : 'boards'} page "${p.name}".`;
        }
        const p = findPage(s, name);
        if (!p) return `No page called "${name}". Pages: ${pageList(s).map(x => x.name).join(', ')}`;
        if (action === 'delete') {
          if (pageList(s).length < 2) return 'This is the only page; it cannot be deleted.';
          const nb = live(s.boards).filter(b => b.pageId === p.id).length;
          deletePage(s, p);
          return `Deleted page "${p.name}"${nb ? ` and its ${nb} board(s)` : ''}.`;
        }
        if (action === 'rename') { if (!new_name) return 'Give new_name.'; p.name = new_name.trim(); }
        if (action === 'move') {
          const order = pageList(s).filter(x => x.id !== p.id);
          order.splice(Math.max(0, Math.min(order.length, (position || 1) - 1)), 0, p);
          order.forEach((x, i) => { if (x.order !== i) { x.order = i; x.updated = Date.now(); } });
        }
        p.updated = Date.now();
        return `Pages now: ${pageList(s).map(x => x.name).join(', ')}.`;
      },
    },
    {
      name: 'read_notepad',
      description: "Read the user's notepad pages, sheet by sheet.",
      input_schema: obj({ page: { type: 'string', description: 'Page name; empty for all notepad pages.' } }),
      run: async ({ page }) => {
        const s = await dash();
        const pages = pageList(s).filter(p => p.kind === 'doc' && (!page || p.name.toLowerCase().includes(page.toLowerCase())));
        if (!pages.length) return page ? `No notepad page called "${page}".` : 'There are no notepad pages.';
        return pages.map(p => `# Page "${p.name}"\n` + notepadSheets(p).map(x => `--- sheet ${x.n} ---\n${x.text.slice(0, 30000) || '(empty)'}`).join('\n')).join('\n\n');
      },
    },
    {
      name: 'write_notepad',
      description: 'Write on a notepad page. Text is Markdown: # heading, ## subheading, - list, 1. list, - [ ] task, - [x] done task, '
        + '> quote, **bold**, *italic*. Modes: append (add at the end of the sheet, default), replace (rewrite the whole sheet; '
        + 'read it first and keep what should stay), new_sheet (a new sheet on the page). Creates the notepad page if it does not exist.',
      input_schema: obj({
        page: { type: 'string', description: 'Notepad page name.' },
        text: { type: 'string' },
        mode: { type: 'string', enum: ['append', 'replace', 'new_sheet'] },
        sheet: { type: 'integer', description: 'Which sheet (1 = first). Default the first; for append, the last.' },
      }, ['page', 'text']),
      run: async ({ page, text, mode = 'append', sheet }) => {
        const s = await dash();
        let p = pageList(s).find(x => x.kind === 'doc' && x.name.toLowerCase() === page.toLowerCase()) || pageList(s).filter(x => x.kind === 'doc').find(x => x.name.toLowerCase().includes(page.toLowerCase()));
        const created = !p;
        if (!p) p = createPage(s, page.trim(), 'notepad');
        let ids = sheetIds(p);
        if (!ids.length || mode === 'new_sheet') { addSheet(p); ids = sheetIds(p); }
        const id = mode === 'new_sheet' ? ids.at(-1) : ids[Math.min(ids.length, Math.max(1, sheet || (mode === 'append' ? ids.length : 1))) - 1];
        const d = (p.sheets[id] ||= { doc: '', ink: null }), html = markdownToDoc(text);
        const empty = !d.doc || /^(<div data-t="p" dir="auto"><br><\/div>)*$/.test(d.doc);
        d.doc = mode === 'replace' || empty ? html : d.doc + html;
        p.updated = Date.now();
        return `${created ? `Created notepad page "${p.name}" and wrote` : 'Wrote'} on sheet ${ids.indexOf(id) + 1} of "${p.name}".`;
      },
    },
  ];
}
