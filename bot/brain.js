/* The bot's brain: an AI model you chat with about anything (Farsi or English, text, photos, files),
   which can also make pictures and manage your dashboard through these tools. */
// A tool the AI can call: a name, what it does, its inputs (JSON Schema) and the code that runs.
const tool = t => t;
import { makeImage } from './media.js';
import {
  live, isTask, boardList, pageList, findBoard, boardName, createBoard, inbox, addItem, openTasks, byDue,
  notepadText, nowKey, persianDate, weekdayName,
} from './data.js';

const SYSTEM = `You are Life, the user's own smart assistant in Telegram, like ChatGPT, Claude or Gemini in a chat app.
You can talk about anything: answer questions, explain, teach, translate, write and edit texts, brainstorm, plan,
solve problems, write code, give advice, look at photos and files the user sends, and make pictures.
You are also connected to the user's personal dashboard "Life" and can manage it.

Talking:
- Reply in the language the user writes in (Farsi → Farsi, English → English), naturally, like a smart, warm friend.
- Match the length to the question: short for small talk and simple questions, complete and well structured
  for real questions (steps, lists, examples, code). Don't pad, don't repeat the question.
- Write in Markdown: **bold**, *italic*, lists, \`code\` and \`\`\` code blocks \`\`\`. Headings are fine for long answers. Avoid tables.
- You remember the recent conversation; use it. Be honest when you don't know something or when it may be out of date.

Pictures:
- When the user asks for a picture, drawing, photo, logo, wallpaper, poster, illustration, etc., call make_image.
  Write the prompt in English, detailed (subject, style, lighting, colours, composition), even if the user wrote in Farsi.
  For text inside an image, keep it short. After the tool, reply with one short line (the picture is sent by itself).

The dashboard (use these tools only when the message is about tasks, plans, reminders or notes):
- Pages hold boards (cards) of items. An item is a task (can be ticked, can have a deadline), a note, a heading or a bullet.
- When the user tells you something to do, remember, buy, study or attend, add it as a task right away; don't ask.
- Pick the best board by meaning (shopping → personal, exam → study). If none fits, leave board empty (→ Inbox).
  Create a board only when asked. One message can hold several tasks: add each.
- Deadlines: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (24h, local). A task with a time is also a reminder at that time.
  "remind me in 2 hours" → due now + 2 hours. Resolve tomorrow, next Saturday, Persian dates (۱۰ دی) and Persian digits.
- To change, tick off, move or delete, first find_items, then update_items with the id.
- A photo of a list, a whiteboard or a schedule: add its tasks only if the user wants that; otherwise just talk about it.
- When you list tasks: one per line with "○ ", deadlines in a friendly way (today, tomorrow 18:00, 2 days late).
- Never mention ids, tools or JSON.`;

const itemView = (s, t) => ({
  id: t.id, title: t.title, board: boardName(s, t.boardId), type: t.type || 'task',
  ...(isTask(t) && { done: !!t.done, ...(t.doneOn && { doneOn: t.doneOn }), ...(t.due && { due: t.due }) }),
});

function tools(s, env, log, out) {
  return [
    tool({
      name: 'make_image',
      description: 'Make a picture from a description and send it to the user.',
      input_schema: {
        type: 'object', additionalProperties: false, required: ['prompt'],
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the picture, in English.' },
          shape: { type: 'string', enum: ['square', 'portrait', 'landscape'], description: 'Default square. Portrait for phone wallpapers/posters, landscape for banners/desktop.' },
        },
      },
      run: async ({ prompt, shape }) => {
        if (out.images.length >= 4) return 'Limit reached: at most 4 pictures per message.';
        out.images.push(await makeImage(env, String(prompt), shape));
        return 'Done: the picture will be sent to the user right after your reply.';
      },
    }),
    tool({
      name: 'find_items',
      description: 'Search the dashboard items. With no filters, returns all open tasks. Use it before changing anything, and to answer questions.',
      input_schema: {
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
    tool({
      name: 'add_items',
      description: 'Add one or more items to the dashboard.',
      input_schema: {
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
      run: async ({ items }) => JSON.stringify(list(items).map(i => {
        const b = findBoard(s, i.board) || inbox(s);
        const t = addItem(s, { title: i.title.trim(), boardId: b.id, type: i.type || 'task', due: validDue(i.due) });
        log.push({ added: t.id });
        return itemView(s, t);
      })),
    }),
    tool({
      name: 'update_items',
      description: 'Change existing items by id: rename, set or clear the deadline, move to another board, tick off / untick, or delete.',
      input_schema: {
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
      run: async ({ changes }) => JSON.stringify(list(changes).map(c => {
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
    tool({
      name: 'create_board',
      description: 'Create a new board. Only when the user asks for one.',
      input_schema: {
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
    tool({
      name: 'read_notepad',
      description: "Read what the user wrote on their notepad pages (read only).",
      input_schema: { type: 'object', additionalProperties: false, properties: { page: { type: 'string', description: 'Page name; empty for all.' } } },
      run: async ({ page }) => {
        const pages = notepadText(s).filter(p => !page || p.page.toLowerCase().includes(page.toLowerCase()));
        return pages.length ? pages.map(p => `# ${p.page}\n${p.text.slice(0, 12000)}`).join('\n\n') : 'No notepad writing found.';
      },
    }),
  ];
}

// Some models send a list as a JSON string, or one object instead of a list.
const list = x => {
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { return []; } }
  return Array.isArray(x) ? x : x && typeof x === 'object' ? [x] : [];
};

const validDue = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(d.trim()) ? d.trim() : null);

// What the AI knows about "now" and the dashboard's shape, sent with every message.
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
  const log = [], out = { images: [] };
  // The recent conversation (last 20 messages, forgotten after a day without talking; /new clears it).
  const fresh = data.bot.chat.filter(m => Date.now() - m.at < 24 * 3600e3).slice(-20);
  const history = fresh.map(m => ({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t }));
  while (history.length && history[0].role !== 'user') history.shift();
  const prompt = `${context(data.s, env)}\n\n${text || '(photo)'}`;

  const reply = (await chat(env, data, history, prompt, image, log, out))
    .replace(/<think>[\s\S]*?<\/think>/g, '').trim() || (out.images.length ? '' : '✓');

  const short = x => (x.length > 3000 ? x.slice(0, 3000) + ' …' : x);
  data.bot.chat = [...fresh,
    { r: 'u', t: short(text || '(sent a photo)') + (image ? ' [photo]' : ''), at: Date.now() },
    { r: 'a', t: short(reply || '(sent a picture)') + (out.images.length ? ` [sent ${out.images.length} picture(s)]` : ''), at: Date.now() },
  ].slice(-20);
  return { text: reply, images: out.images };
}

// Works with any OpenAI-compatible chat API that supports tool calling:
// NVIDIA (default), OpenRouter, Groq, Google Gemini, OpenAI, DeepSeek, Mistral…
// Set AI_URL, AI_MODEL and AI_API_KEY in the Cloudflare dashboard to switch.
async function chat(env, data, history, prompt, image, log, out) {
  const url = aiUrl(env);
  const model = env.AI_MODEL || 'z-ai/glm-5.3-flash';
  const list = tools(data.s, env, log, out);
  const defs = list.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const user = image
    ? [{ type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } }, { type: 'text', text: prompt }]
    : prompt;
  const messages = [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: user }];
  let extras = { max_tokens: 8192, temperature: 0.6 }; // dropped if a provider doesn't accept them
  const deadline = Date.now() + 55000;

  for (let round = 0; round < 10; round++) {
    const r = await post(env, url, { model, messages, tools: defs, tool_choice: 'auto', stream: false, ...extras }, deadline - Date.now());
    if (r.status === 400 && Object.keys(extras).length) { extras = {}; round--; continue; }
    if (r.status === 401 || r.status === 403) throw new Error('The AI service rejected the key (AI_API_KEY).');
    if (r.status === 404) throw new Error(`The AI service doesn't know this address or model (AI_URL / AI_MODEL: ${model}).`);
    if (r.status === 429) throw new Error('The AI service is busy (rate limit). Try again in a minute.');
    if (!r.ok) throw new Error(`AI service error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const msg = (await r.json()).choices?.[0]?.message;
    if (!msg) throw new Error('The AI service sent an empty answer.');
    const calls = msg.tool_calls || [];
    if (!calls.length) return msg.content || '';
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const c of calls) {
      const t = list.find(t => t.name === c.function?.name);
      let result;
      try {
        const args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function.arguments || {};
        result = t ? await t.run(args) : `Unknown tool ${c.function?.name}`;
      } catch (e) {
        result = `Error: ${e.message}. Check the inputs and try again.`;
        data.bot.lastError = `${c.function?.name}: ${e.message} — input: ${String(c.function?.arguments).slice(0, 300)}`;
      }
      console.log('tool', c.function?.name, String(c.function?.arguments).slice(0, 500), '→', String(result).slice(0, 300));
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(result) });
    }
  }
  return 'Sorry, that took too many steps. Please try again in simpler words.';
}

async function post(env, url, body, ms) {
  if (ms < 1000) throw new Error('The AI service is too slow right now. Try again, or choose a faster model (AI_MODEL).');
  try {
    return await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(ms),
      headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('The AI service is too slow right now. Try again, or choose a faster model (AI_MODEL).');
    throw new Error(`Could not reach the AI service: ${e.message}`);
  }
}

// AI_URL can be the full address or just the base (…/v1), as many services show it.
function aiUrl(env) {
  const u = (env.AI_URL || 'https://integrate.api.nvidia.com/v1').trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(u) ? u : u + '/chat/completions';
}

// For /status: one tiny request, with how long it took or what went wrong.
export async function checkAI(env) {
  if (!env.AI_API_KEY) return '✗ AI: no AI_API_KEY secret (messages go straight to Inbox)';
  const url = aiUrl(env);
  const model = env.AI_MODEL || 'z-ai/glm-5.3-flash';
  const t0 = Date.now();
  try {
    const r = await post(env, url, { model, messages: [{ role: 'user', content: 'Reply with just: ok' }], max_tokens: 200, stream: false }, 25000);
    const text = await r.text();
    if (!r.ok) return `✗ AI (${model}): error ${r.status} — ${text.slice(0, 300).replace(/[<>&]/g, '')}`;
    return `✓ AI (${model}): answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  } catch (e) {
    return `✗ AI (${model}): ${e.message}`;
  }
}
