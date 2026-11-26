/* The bot's brain: Claude reads your message (Farsi or English, text or photo),
   looks at your dashboard through these tools, changes it, and answers. */
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import {
  live, isTask, boardList, pageList, findBoard, boardName, createBoard, inbox, addItem, openTasks, byDue,
  notepadText, nowKey, persianDate, weekdayName,
} from './data.js';

const SYSTEM = `You are Life, a personal assistant inside Telegram, connected to the user's personal dashboard "Life".
The dashboard has pages; boards pages hold boards (cards) of items. An item is a task (can be ticked, can have a deadline),
a note line, a heading or a bullet. Notepad pages hold free writing.

How to work:
- Act, don't ask. When the user tells you something to do, remember, buy, study or attend, add it as a task right away.
  Ask a question only when you truly cannot guess (e.g. which of two similar tasks to delete).
- Pick the best existing board from the board list by meaning (e.g. "buy milk" → a shopping or personal board,
  "exam" → study). If nothing fits, leave board empty and it goes to Inbox. Create a board only when the user asks.
- One message can hold several things: add each as its own item.
- Deadlines: due is "YYYY-MM-DD" for a day or "YYYY-MM-DDTHH:MM" (24h, local time) for an exact time.
  A task with a time also works as a reminder: the bot messages the user at that time.
  "remind me in 2 hours" → a task due now + 2 hours. Resolve "tomorrow", "next Saturday", Persian dates
  (e.g. ۱۰ دی) and Persian/Arabic digits into these formats using the current date given below.
- To change, tick off, move or delete something, first find it with find_items, then use update_items with its id.
- For questions ("what do I have this week?", "what did I finish today?", "what did I write about X?"), look it up first.
- A photo may be a handwritten list, a whiteboard, a screenshot or a schedule: pull out the tasks and add them.
- Keep the user's own wording for titles; clean up only obvious typos. Don't add emojis to titles.

How to answer:
- Reply in the language the user wrote in (Farsi → Farsi, English → English).
- Short and clear, like a friendly, capable assistant. Say what you did in one or two lines.
  When you list tasks, one per line with "○ ", with the deadline in a friendly way (today, tomorrow 18:00, Saturday, 2 days late).
- Formatting is Telegram HTML: only <b>, <i>, <u>, <s>, <code> are allowed. No Markdown, no headings, no tables.
  Write & < > in plain text as &amp; &lt; &gt;.
- Never mention ids, tools or JSON.`;

const itemView = (s, t) => ({
  id: t.id, title: t.title, board: boardName(s, t.boardId), type: t.type || 'task',
  ...(isTask(t) && { done: !!t.done, ...(t.doneOn && { doneOn: t.doneOn }), ...(t.due && { due: t.due }) }),
});

function tools(s, env, log) {
  return [
    betaTool({
      name: 'find_items',
      description: 'Search the dashboard items. With no filters, returns all open tasks. Use it before changing anything, and to answer questions.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'Words to look for in the title (any language). Leave empty for all.' },
          board: { type: 'string', description: 'Only this board (name).' },
          status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Tasks: open (default), done, or all. Notes and headings are included only with "all".' },
          due_from: { type: 'string', description: 'Only tasks due on/after this date YYYY-MM-DD.' },
          due_to: { type: 'string', description: 'Only tasks due on/before this date YYYY-MM-DD (use with status open to find late tasks).' },
        },
      },
      run: async ({ text, board, status = 'open', due_from, due_to }) => {
        const b = board ? findBoard(s, board) : null;
        if (board && !b) return `No board called "${board}". Boards: ${boardList(s).map(x => x.name).join(', ')}`;
        const words = (text || '').toLowerCase().split(/\s+/).filter(Boolean);
        const list = live(s.tasks).filter(t => t.title
          && (!b || t.boardId === b.id)
          && (status === 'all' || (isTask(t) && (status === 'done' ? t.done : !t.done)))
          && (!due_from || (t.due && t.due.slice(0, 10) >= due_from))
          && (!due_to || (t.due && t.due.slice(0, 10) <= due_to))
          && words.every(w => t.title.toLowerCase().includes(w)))
          .sort(byDue).slice(0, 100);
        return JSON.stringify(list.map(t => itemView(s, t)));
      },
    }),
    betaTool({
      name: 'add_items',
      description: 'Add one or more items to the dashboard.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['title'],
              properties: {
                title: { type: 'string' },
                board: { type: 'string', description: 'Existing board name. Empty → Inbox.' },
                type: { type: 'string', enum: ['task', 'note', 'heading', 'bullet'], description: 'Default task.' },
                due: { type: 'string', description: 'YYYY-MM-DD or YYYY-MM-DDTHH:MM (tasks only).' },
              },
            },
          },
        },
      },
      run: async ({ items }) => JSON.stringify(items.map(i => {
        const b = findBoard(s, i.board) || inbox(s);
        const t = addItem(s, { title: i.title.trim(), boardId: b.id, type: i.type || 'task', due: validDue(i.due) });
        log.push({ added: t.id });
        return itemView(s, t);
      })),
    }),
    betaTool({
      name: 'update_items',
      description: 'Change existing items by id: rename, set or clear the deadline, move to another board, tick off / untick, or delete.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['changes'],
        properties: {
          changes: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['id'],
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                due: { type: 'string', description: 'New deadline, or "none" to remove it.' },
                board: { type: 'string', description: 'Move to this board.' },
                done: { type: 'boolean', description: 'true = tick off, false = open again.' },
                delete: { type: 'boolean' },
              },
            },
          },
        },
      },
      run: async ({ changes }) => JSON.stringify(changes.map(c => {
        const t = s.tasks.find(x => x.id === c.id && !x.deleted);
        if (!t) return { id: c.id, error: 'not found' };
        if (c.delete) { t.deleted = true; t.updated = Date.now(); return { id: t.id, title: t.title, deleted: true }; }
        if (c.title) t.title = c.title.trim();
        if (c.due !== undefined) t.due = c.due === 'none' || !c.due ? null : validDue(c.due) ?? t.due;
        if (c.board) { const b = findBoard(s, c.board); if (!b) return { id: t.id, error: `no board "${c.board}"` }; t.boardId = b.id; }
        if (c.done !== undefined) { t.type = 'task'; t.done = c.done; t.doneOn = c.done ? nowKey(env).slice(0, 10) : null; }
        t.updated = Date.now();
        return itemView(s, t);
      })),
    }),
    betaTool({
      name: 'create_board',
      description: 'Create a new board. Only when the user asks for one.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['name'],
        properties: { name: { type: 'string' }, page: { type: 'string', description: 'Page to put it on (a new page is made if no page has this name). Empty → first page.' } },
      },
      run: async ({ name, page }) => {
        const existing = findBoard(s, name);
        if (existing && existing.name.toLowerCase() === name.toLowerCase()) return `A board "${existing.name}" already exists.`;
        const b = createBoard(s, name.trim(), page);
        return `Created board "${b.name}" on page "${s.pages.find(p => p.id === b.pageId)?.name}".`;
      },
    }),
    betaTool({
      name: 'read_notepad',
      description: "Read what the user wrote on their notepad pages (read only).",
      inputSchema: { type: 'object', additionalProperties: false, properties: { page: { type: 'string', description: 'Page name; empty for all.' } } },
      run: async ({ page }) => {
        const pages = notepadText(s).filter(p => !page || p.page.toLowerCase().includes(page.toLowerCase()));
        return pages.length ? pages.map(p => `# ${p.page}\n${p.text.slice(0, 12000)}`).join('\n\n') : 'No notepad writing found.';
      },
    }),
  ];
}

const validDue = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(d.trim()) ? d.trim() : null);

// What Claude knows about "now" and the dashboard's shape, sent with every message.
function context(s, env) {
  const now = nowKey(env);
  const boards = pageList(s).filter(p => p.kind !== 'doc').map(p => {
    const bs = boardList(s).filter(b => b.pageId === p.id);
    return `${p.name}: ${bs.map(b => `${b.name} (${openTasks(s, b.id).length} open)`).join(', ') || '(no boards)'}`;
  }).join('\n');
  const late = openTasks(s).filter(t => t.due && t.due.slice(0, 10) < now.slice(0, 10)).length;
  const notepads = pageList(s).filter(p => p.kind === 'doc').map(p => p.name);
  return `<context>
Now: ${weekdayName(env)} ${now.replace('T', ' ')} (${env.TZ || 'Asia/Tehran'}). Persian date: ${persianDate(env)}.
Boards by page:
${boards}
${notepads.length ? `Notepad pages: ${notepads.join(', ')}\n` : ''}Open tasks: ${openTasks(s).length}, late: ${late}.
</context>`;
}

export async function think(env, data, { text, image }) {
  const log = [];
  // A short memory of the conversation (last few exchanges, forgotten after 6 idle hours).
  const fresh = data.bot.chat.filter(m => Date.now() - m.at < 6 * 3600e3).slice(-12);
  const history = fresh.map(m => ({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t }));
  while (history.length && history[0].role !== 'user') history.shift();
  const prompt = `${context(data.s, env)}\n\n${text || '(photo)'}`;

  let reply = env.ANTHROPIC_API_KEY
    ? await claude(env, data, history, prompt, image, log)
    : await openaiCompatible(env, data, history, prompt, image, log);
  reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || '✓';

  data.bot.chat = [...fresh, { r: 'u', t: text || '(sent a photo)', at: Date.now() }, { r: 'a', t: reply, at: Date.now() }].slice(-12);
  data.bot.lastAdded = log.map(l => l.added).filter(Boolean);
  return reply;
}

async function claude(env, data, history, prompt, image, log) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.MODEL || 'claude-opus-5-5';
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } });
  content.push({ type: 'text', text: prompt });

  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    max_iterations: 10,
    output_config: { effort: env.EFFORT || 'low' },
    // If Claude declines a request by mistake, the API retries it on another model.
    ...(/opus|fable|sonnet-5-5/.test(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: tools(data.s, env, log),
    messages: [...history, { role: 'user', content }],
  });
  const msg = await runner.runUntilDone();
  if (msg.stop_reason === 'refusal') return 'Sorry, I can’t help with that one.';
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// Any OpenAI-compatible chat API with tool calling, e.g. NVIDIA's free endpoint (build.nvidia.com).
async function openaiCompatible(env, data, history, prompt, image, log) {
  const url = env.AI_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
  const model = env.AI_MODEL || 'z-ai/glm-5.3-flash';
  const list = tools(data.s, env, log);
  const defs = list.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const user = image
    ? [{ type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } }, { type: 'text', text: prompt }]
    : prompt;
  const messages = [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: user }];

  for (let round = 0; round < 10; round++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, messages, tools: defs, tool_choice: 'auto', max_tokens: 4096, temperature: 0.3, stream: false }),
    });
    if (r.status === 401 || r.status === 403) throw new Error('The AI service rejected the key (AI_API_KEY).');
    if (r.status === 429) throw new Error('The AI service is busy (rate limit). Try again in a minute.');
    if (!r.ok) throw new Error(`AI service error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const msg = (await r.json()).choices?.[0]?.message;
    if (!msg) throw new Error('The AI service sent an empty answer.');
    const calls = msg.tool_calls || [];
    if (!calls.length) return msg.content || '';
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const c of calls) {
      const tool = list.find(t => t.name === c.function?.name);
      let result;
      try {
        const args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function.arguments || {};
        result = tool ? await tool.run(args) : `Unknown tool ${c.function?.name}`;
      } catch (e) { result = `Error: ${e.message}`; }
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(result) });
    }
  }
  return 'Sorry, that took too many steps. Please try again in simpler words.';
}
