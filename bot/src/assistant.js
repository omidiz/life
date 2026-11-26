/* The assistant: who it is, what it remembers, what it can do, and one conversation turn
   (read the message and its attachments → think with the AI and its tools → answer live). */
import { runAgent, transcribe } from './ai.js';
import { openDashboard } from './dashboard.js';
import { generalTools } from './tools/general.js';
import { dashboardTools } from './tools/dashboard.js';
import { codeTools, proposalView } from './tools/code.js';
import { now, weekday, persianDate } from './time.js';
import { esc } from './telegram.js';

const PERSONA = `You are Life, the user's own personal AI assistant in Telegram — like ChatGPT, Claude or Gemini in a chat app,
but personal: you know the user, remember what matters, and can act for them.

How you talk:
- Reply in the language the user writes in (Farsi → Farsi, English → English), naturally, like a smart, warm friend.
- Match the length to the message: short for small talk and simple questions; complete and well structured for real
  questions (steps, lists, examples, code). No padding, don't repeat the question, no needless disclaimers.
- Write in Markdown: **bold**, *italic*, lists, \`code\`, \`\`\` code blocks \`\`\`, and headings for long answers. Avoid tables.
- Think as carefully as the question deserves and give your best, most complete answer.
- Be honest when you don't know something or when it may be out of date; read a web page when a link is given.
- The user may send photos, voice messages, PDFs, documents, spreadsheets, audio, video, code or links: read them fully and use them.
- Never mention your tools, ids or JSON.

Memory:
- "What you know about the user" below is your long-term memory. Use it naturally; don't recite it.
- When the user tells you a lasting fact about themselves or a preference for your answers, or asks you to remember
  something, save it with remember (one short sentence). If a saved fact is wrong or they want it gone, use forget.

Pictures:
- When asked for a picture, drawing, photo, logo, wallpaper, poster or illustration, call make_image with a detailed
  English prompt (subject, style, lighting, colours, composition), even if the user wrote in Farsi. Keep any text in
  the picture short. Afterwards reply with one short line; the picture is sent by itself.

The Life dashboard (the user's web app: pages as tabs; boards pages hold boards of tasks and notes; notepad pages hold
sheets to write on. Use these tools when the message is about tasks, plans, reminders, boards, pages or notes):
- When the user tells you something to do, remember to do, buy, study or attend, add it as a task right away; don't ask.
- Pick the board by meaning (dashboard_overview lists them; shopping → personal, exam → study). None fits → leave empty (Inbox).
  Create a board only when asked. Several things in one message → several tasks.
- Deadlines: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (24h, local). A task with a time is also a reminder at that time.
  "remind me in 2 hours" → due now + 2 hours. Resolve tomorrow, next Saturday, Persian dates (۱۰ دی) and Persian digits.
- To change, tick off, move or delete: find_items first, then update_items with the id.
- You can also organise the dashboard itself: create, rename, recolour, move or delete boards (manage_board) and pages
  (manage_page), and read or write notepad sheets (read_notepad, write_notepad, in Markdown). When asked to write
  something "in the notes/sheet", write the real content there, then say briefly what you wrote and where.
- Delete a board or a page only when the user clearly asked to delete that one; they hold the user's work.
- When you list tasks: one per line with "○ ", deadlines in a friendly way (today, tomorrow 18:00, 2 days late).`;

const CODE = `

Your own code — you can improve yourself:
- The GitHub repository holds you in bot/: src/worker.js (web entry), src/room.js (message queue, commands, buttons,
  timer), src/assistant.js (you: these instructions and a conversation turn), src/ai.js (the AI service, streaming,
  pictures, voice), src/tools/*.js (your tools), src/planner.js (reminders, briefs, task lists), src/dashboard.js
  (dashboard data), src/telegram.js, src/format.js, src/i18n.js (the bot's fixed texts), src/config.js (settings),
  wrangler.toml, README.md (the Farsi guide). The dashboard web app is at the top level (index.html, app.js, style.css).
- When the user asks to change how you or the dashboard work, or something is broken: look (repo_list, repo_read,
  bot_errors), find the cause, then propose_change with the complete new content of each file. Change only what is
  needed, keep the rest and the style exactly, and keep the JavaScript valid.
- Nothing changes until the user presses Apply; Cloudflare then rebuilds you in about a minute.
- Never put keys, tokens or passwords in files: they belong in Cloudflare (Settings → Variables and Secrets), set by the user.`;

async function system(c, state) {
  const memory = (await state.get('memory')) || [];
  const t = now(c.tz);
  return PERSONA + (c.repo ? CODE : '')
    + `\n\nWhat you know about the user:\n${memory.length ? memory.map(m => `- [${m.id}] ${m.text}`).join('\n') : '(nothing yet)'}`
    + `\n\nNow: ${weekday(c.tz)} ${t.replace('T', ' ')} (${c.tz}); Persian date: ${persianDate(c.tz)}.`;
}

/* ---------- what came with the message ---------- */
const b64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  oga: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm' };
const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|tsx|jsx|py|java|kt|c|cpp|h|cs|go|rs|rb|php|swift|sh|ya?ml|toml|ini|env|log|sql|srt|vtt|tex)$/i;
const extOf = path => path.split('.').pop().toLowerCase();

async function attachments(c, tg, m) {
  const parts = [], labels = [];
  let text = '', heard = '';
  const photo = m.photo?.at(-1) || (m.sticker && !m.sticker.is_animated && !m.sticker.is_video && m.sticker);
  const voice = m.voice || m.audio || m.video_note;
  const file = m.document || m.video || m.animation;
  if (photo) {
    const { bytes, path } = await tg.download(photo.file_id);
    parts.push({ type: 'image_url', image_url: { url: `data:${MIME[extOf(path)] || 'image/jpeg'};base64,${b64(bytes)}` } });
    labels.push('photo');
  }
  if (voice) {
    const { bytes, path } = await tg.download(voice.file_id), ext = extOf(path);
    if (c.stt) heard = await transcribe(c, bytes, 'voice.' + ext);
    else if (m.video_note) parts.push({ type: 'file', file: { filename: 'video.mp4', file_data: `data:video/mp4;base64,${b64(bytes)}` } });
    else parts.push({ type: 'input_audio', input_audio: { data: b64(bytes), format: ext === 'oga' ? 'ogg' : ext } });
    labels.push(m.video_note ? 'video message' : 'voice message');
  }
  if (file) {
    const name = file.file_name || (m.video ? 'video.mp4' : 'file');
    const { bytes, path } = await tg.download(file.file_id);
    const mime = file.mime_type || MIME[extOf(path)] || 'application/octet-stream';
    if (mime.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64(bytes)}` } });
    else if (TEXT_FILE.test(name) || mime.startsWith('text/') || /json|xml|csv|yaml|javascript/.test(mime)) text = `<file name="${name}">\n${new TextDecoder().decode(bytes)}\n</file>`;
    else parts.push({ type: 'file', file: { filename: name, file_data: `data:${mime};base64,${b64(bytes)}` } });
    labels.push(name);
  }
  return { parts, label: labels.join(', '), text, heard };
}

/* ---------- the conversation so far ---------- */
const KEEP = { messages: 60, chars: 150000, days: 7 };

async function history(state) {
  let chat = ((await state.get('chat')) || []).filter(x => Date.now() - x.at < KEEP.days * 864e5).slice(-KEEP.messages);
  while (chat.reduce((n, x) => n + x.t.length, 0) > KEEP.chars) chat = chat.slice(2);
  while (chat.length && chat[0].r !== 'u') chat = chat.slice(1);
  return chat;
}

/* ---------- one turn ---------- */
export async function converse(c, tg, state, m, text) {
  const att = await attachments(c, tg, m);
  if (att.heard) { await tg.send(`🎤 <i>${esc(att.heard)}</i>`); text = [text, att.heard].filter(Boolean).join('\n'); }
  if (att.text) text = `${text || 'Look at this file.'}\n\n${att.text}`;
  if (m.sticker && !text) text = `(sticker ${m.sticker.emoji || ''})`;
  if (m.location) text = `${text} (my location: ${m.location.latitude}, ${m.location.longitude})`.trim();
  if (m.contact) text = `${text} (contact: ${[m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ')} ${m.contact.phone_number})`.trim();
  if (!text && !att.parts.length) return;
  const quoted = m.reply_to_message?.text || m.reply_to_message?.caption;
  if (quoted) text = `(replying to: "${quoted}")\n${text}`;

  // Tools get the dashboard only if they need it (loaded once per turn).
  let dash = null;
  const ctx = { c, state, out: {}, dashboard: () => (dash ||= openDashboard(c)) };
  const tools = [...generalTools(ctx), ...(c.gist.token ? dashboardTools(ctx) : []), ...(c.repo ? codeTools(ctx) : [])];

  const past = await history(state);
  const messages = [
    { role: 'system', content: await system(c, state) },
    ...past.map(x => ({ role: x.r === 'u' ? 'user' : 'assistant', content: x.t })),
    { role: 'user', content: att.parts.length ? [...att.parts, { type: 'text', text: text || '(see the attachment)' }] : text },
  ];
  const refused = (await state.get('refused')) || {};
  const errors = [];
  const live = tg.live();
  const answer = await runAgent(c, {
    messages, tools, refused, onText: t => live.update(t),
    onToolError: (name, e, args) => errors.push({ at: Date.now(), where: 'tool ' + name, message: `${e.message} — input: ${String(args).slice(0, 300)}` }),
  });

  // Answer first; saving comes after, so the user never waits for it.
  await live.finish(answer.text || (answer.images.length ? '' : '✓'));
  for (const img of answer.images) await tg.sendPhoto(img);
  const proposal = ctx.out.showProposal && (await state.get('proposal'));
  if (proposal) { const v = proposalView(proposal); await tg.send(v.text, { reply_markup: v.reply_markup }); }

  if (dash) await (await dash).save();
  const cut = x => (x.length > 20000 ? x.slice(0, 20000) + ' …' : x);
  await state.put('chat', [...past,
    { r: 'u', t: cut(text || '(sent an attachment)') + (att.label ? ` [${att.label}]` : ''), at: Date.now() },
    { r: 'a', t: cut(answer.text || '(sent a picture)') + (answer.images.length ? ` [sent ${answer.images.length} picture(s)]` : ''), at: Date.now() },
  ]);
  await state.put('refused', refused);
  if (errors.length) await state.put('errors', [...((await state.get('errors')) || []), ...errors].slice(-15));
}
