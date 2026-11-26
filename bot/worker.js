/* Life — your personal Telegram bot, connected to your Life dashboard.
   Runs as a Cloudflare Worker. Talk to it in Farsi or English; it understands, updates the
   dashboard (through the same gist the dashboard syncs with), reminds you, and briefs you.

   Secrets: TELEGRAM_TOKEN, GITHUB_TOKEN, WEBHOOK_SECRET, CHAT_ID, AI_API_KEY
   Settings in wrangler.toml: TZ, LANG, MORNING, EVENING, AI_URL, AI_MODEL, GIST_ID */
import { think } from './brain.js';
import { open, esc, live, isTask, boardList, boardName, openTasks, byDue, dayKey, nowKey, addDays, addMinutes, persianDate, inbox, addItem, findBoard } from './data.js';

/* ---------- words (Farsi by default, LANG = "en" for English) ---------- */
const fa = n => n.toLocaleString('fa-IR');
const T = {
  fa: {
    late: 'عقب‌افتاده', today: 'امروز', tomorrow: 'فردا', daysLate: n => `${fa(n)} روز دیر`,
    morning: 'صبح بخیر ☀️', evening: 'شب بخیر 🌙', nothingToday: 'امروز کاری با مهلت نداری.',
    dueToday: 'مهلت امروز', doneToday: n => `✓ امروز ${fa(n)} کار انجام دادی`, forTomorrow: 'برای فردا',
    open: n => `${fa(n)} کار باز داری.`, noOpen: 'هیچ کار بازی نداری 🎉', reminder: '⏰ یادآوری',
    btnDone: '✓ انجام شد', btn1h: '+۱ ساعت', btnTmr: 'فردا', ticked: '✓ انجام شد', snoozed: 'باشه، بعداً یادت می‌اندازم',
    moved: 'رفت برای فردا', gone: 'این کار دیگر نیست.', forgot: 'گفتگو از اول شروع شد. 🧹',
    voice: 'فعلاً پیام صوتی را نمی‌فهمم. لطفاً بنویس، یا عکس بفرست.', error: 'یک مشکل پیش آمد:', tap: 'برای تیک زدن بزن:',
    added: b => `○ به ${b} اضافه شد:`,
    help: `<b>Life</b> — دستیار شخصی‌ات، وصل به داشبورد.

هر چیزی بنویس، مثل حرف زدن معمولی:
• «فردا ساعت ۵ به مامان زنگ بزنم»
• «شیر، نان و تخم‌مرغ بخرم»
• «امتحان ریاضی شنبه‌ی بعد، بذار تو درس»
• «این هفته چی دارم؟»
• «تمرین فیزیک رو انجام دادم»
• «دو ساعت دیگه یادم بنداز قرص بخورم»
• «تو یادداشت‌هام درباره‌ی پروژه چی نوشتم؟»
• یک عکس از لیست یا برنامه بفرست تا کارهایش اضافه شود.

هر روز صبح خلاصه‌ی روز و شب مرور روز را می‌فرستم. کارهایی که ساعت دارند سر وقت یادآوری می‌شوند.

/today امروز · /list همه‌ی کارها · /new شروع گفتگوی تازه`,
  },
  en: {
    late: 'Late', today: 'today', tomorrow: 'tomorrow', daysLate: n => `${n} day${n > 1 ? 's' : ''} late`,
    morning: 'Good morning ☀️', evening: 'Good evening 🌙', nothingToday: 'Nothing due today.',
    dueToday: 'Due today', doneToday: n => `✓ ${n} done today`, forTomorrow: 'For tomorrow',
    open: n => `${n} open task${n === 1 ? '' : 's'}.`, noOpen: 'No open tasks 🎉', reminder: '⏰ Reminder',
    btnDone: '✓ Done', btn1h: '+1 hour', btnTmr: 'Tomorrow', ticked: '✓ Done', snoozed: 'OK, I’ll remind you later',
    moved: 'Moved to tomorrow', gone: 'That task is gone.', forgot: 'Fresh start. 🧹',
    voice: 'I can’t understand voice messages yet. Please type it, or send a photo.', error: 'Something went wrong:', tap: 'Tap to tick off:',
    added: b => `○ Added to ${b}:`,
    help: `<b>Life</b> — your personal assistant, connected to your dashboard.

Just write, like talking to a person:
• "Call mom tomorrow at 5"
• "Buy milk, bread and eggs"
• "Math exam next Saturday, put it in Study"
• "What do I have this week?"
• "I finished the physics homework"
• "Remind me to take my pills in 2 hours"
• "What did I write in my notes about the project?"
• Send a photo of a list or a schedule and I'll add its tasks.

Every morning I send your day, every evening a short review. Tasks with a time get a reminder on time.

/today today · /list all tasks · /new fresh conversation`,
  },
};
const L = env => T[env.LANG === 'en' ? 'en' : 'fa'];
// Keep Latin dates and times left-to-right inside Farsi text (otherwise 2026-11-26 shows as 26-11-2026).
const ltr = x => `\u2066${x}\u2069`;

/* ---------- Telegram ---------- */
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
async function send(env, text, extra = {}) {
  const body = { chat_id: env.CHAT_ID, text: text.slice(0, 4000), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra };
  const r = await tg(env, 'sendMessage', body);
  if (!r.ok) { // bad HTML from the model: send it as plain text instead
    delete body.parse_mode; body.text = text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').slice(0, 4000);
    return tg(env, 'sendMessage', body);
  }
  return r;
}
const doneButtons = (tasks, env) => tasks.length ? { reply_markup: { inline_keyboard: tasks.slice(0, 20).map(t => [{ text: '✓ ' + t.title.slice(0, 40), callback_data: 'done:' + t.id }]) } } : {};

/* ---------- lists ---------- */
function dueLabel(due, env) {
  if (!due) return '';
  const w = L(env), today = dayKey(env), time = due.length > 10 ? ' ' + ltr(due.slice(11, 16)) : '';
  const diff = Math.round((new Date(due.slice(0, 10)) - new Date(today)) / 864e5);
  if (diff < 0) return ` — <b>${w.daysLate(-diff)}</b>`;
  if (diff === 0) return ` — ${w.today}${time}`;
  if (diff === 1) return ` — ${w.tomorrow}${time}`;
  return ` — ${ltr(due.slice(0, 10))}${time}`;
}
const lines = (s, env, tasks, showBoard = true) => tasks.map(t => `○ ${esc(t.title)}${dueLabel(t.due, env)}${showBoard ? `  <i>${esc(boardName(s, t.boardId))}</i>` : ''}`).join('\n');

function todayView(s, env, greeting = '') {
  const w = L(env), today = dayKey(env), open = openTasks(s);
  const late = open.filter(t => t.due && t.due.slice(0, 10) < today).sort(byDue);
  const due = open.filter(t => t.due && t.due.slice(0, 10) === today).sort(byDue);
  const doneN = live(s.tasks).filter(t => t.doneOn === today).length;
  let msg = `${greeting ? greeting + '\n' : ''}<b>${persianDate(env)}</b>  ·  ${ltr(today)}\n`;
  if (late.length) msg += `\n<b>${w.late}</b>\n${lines(s, env, late)}\n`;
  if (due.length) msg += `\n<b>${w.dueToday}</b>\n${lines(s, env, due)}\n`;
  if (!late.length && !due.length) msg += `\n${w.nothingToday} ${w.open(open.length)}`;
  if (doneN) msg += `\n${w.doneToday(doneN)}`;
  return { msg, tasks: [...late, ...due] };
}
function eveningView(s, env) {
  const w = L(env), today = dayKey(env), tmr = addDays(today, 1);
  const done = live(s.tasks).filter(t => isTask(t) && t.doneOn === today);
  const next = openTasks(s).filter(t => t.due && t.due.slice(0, 10) <= tmr).sort(byDue);
  if (!done.length && !next.length) return null;
  let msg = `${w.evening}\n`;
  if (done.length) msg += `\n${w.doneToday(done.length)}\n${done.map(t => `<s>${esc(t.title)}</s>`).join('\n')}\n`;
  if (next.length) msg += `\n<b>${w.forTomorrow}</b>\n${lines(s, env, next)}`;
  return { msg, tasks: next };
}
function listView(s, env) {
  const open = openTasks(s).sort(byDue);
  if (!open.length) return { msg: L(env).noOpen, tasks: [] };
  const msg = boardList(s).map(b => [b, open.filter(t => t.boardId === b.id)]).filter(([, l]) => l.length)
    .map(([b, l]) => `<b>${esc(b.name)}</b>\n${lines(s, env, l, false)}`).join('\n\n');
  return { msg: msg + `\n\n${L(env).tap}`, tasks: open };
}

/* ---------- messages ---------- */
async function photoOf(env, m) {
  const fileId = m.photo?.at(-1)?.file_id || (m.document?.mime_type?.startsWith('image/') && m.document.file_id);
  if (!fileId) return null;
  const f = await tg(env, 'getFile', { file_id: fileId });
  const buf = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`).then(r => r.arrayBuffer());
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const ext = f.result.file_path.split('.').pop().toLowerCase();
  const type = m.document?.mime_type || ({ png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/jpeg');
  return { type, data: btoa(bin) };
}

async function onMessage(env, m) {
  const w = L(env);
  if (m.voice || m.audio || m.video_note) return send(env, w.voice);
  const text = (m.text || m.caption || '').trim();
  const cmd = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;
  if (cmd === 'start' || cmd === 'help') return send(env, w.help);

  const data = await open(env);
  if (cmd === 'today') { const v = todayView(data.s, env); return send(env, v.msg, doneButtons(v.tasks, env)); }
  if (cmd === 'list') { const v = listView(data.s, env); return send(env, v.msg, doneButtons(v.tasks, env)); }
  if (cmd === 'new') { data.bot.chat = []; await data.save(); return send(env, w.forgot); }

  // Without an AI key the bot still works as a quick inbox: the message becomes a task.
  if (!env.AI_API_KEY) {
    if (!text) return;
    const tag = text.match(/(^|\s)#(\S+)/), b = (tag && findBoard(data.s, tag[2])) || inbox(data.s);
    const t = addItem(data.s, { title: tag ? text.replace(tag[0], ' ').trim() : text, boardId: b.id });
    await data.save();
    return send(env, `${w.added(esc(b.name))} ${esc(t.title)}`);
  }

  tg(env, 'sendChatAction', { chat_id: env.CHAT_ID, action: 'typing' });
  const image = await photoOf(env, m);
  if (!text && !image) return;
  const reply = await think(env, data, { text: [m.reply_to_message?.text && `(replying to: "${m.reply_to_message.text.slice(0, 500)}")`, text].filter(Boolean).join('\n'), image });
  await data.save();
  return send(env, reply);
}

async function onButton(env, q) {
  const w = L(env), [act, id] = (q.data || '').split(':');
  const data = await open(env), t = data.s.tasks.find(t => t.id === id && !t.deleted);
  const answer = text => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text });
  if (!t) return answer(w.gone);
  let note;
  if (act === 'done') { t.done = true; t.doneOn = dayKey(env); note = `${w.ticked}: ${t.title}`; }
  if (act === 'snooze') { t.due = addMinutes(nowKey(env), 60); note = w.snoozed; }
  if (act === 'tmr') { t.due = addDays(dayKey(env), 1) + (t.due?.length > 10 ? t.due.slice(10) : ''); note = w.moved; }
  t.updated = Date.now();
  await data.save();
  await answer(note.slice(0, 190));
  // Take the button away so the message shows what's left.
  const kb = (q.message?.reply_markup?.inline_keyboard || []).filter(row => !row.some(b => b.callback_data?.endsWith(':' + id)));
  if (q.message) await tg(env, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: kb } });
}

/* ---------- every 5 minutes: reminders, morning brief, evening review ---------- */
async function tick(env) {
  const w = L(env), data = await open(env), { s, bot } = data;
  const now = nowKey(env), today = now.slice(0, 10), hm = now.slice(11);

  // Reminders: tasks with a time that has just come (within the last 2 hours, once per deadline).
  for (const t of openTasks(s)) {
    if (!t.due || t.due.length <= 10 || t.due > now || t.due < addMinutes(now, -120) || bot.reminded[t.id] === t.due) continue;
    bot.reminded[t.id] = t.due;
    await send(env, `${w.reminder}\n<b>${esc(t.title)}</b>  <i>${esc(boardName(s, t.boardId))}</i>`, { reply_markup: { inline_keyboard: [[
      { text: w.btnDone, callback_data: 'done:' + t.id }, { text: w.btn1h, callback_data: 'snooze:' + t.id }, { text: w.btnTmr, callback_data: 'tmr:' + t.id },
    ]] } });
  }
  for (const id of Object.keys(bot.reminded)) if (!s.tasks.some(t => t.id === id && !t.deleted && !t.done)) delete bot.reminded[id];

  const morning = env.MORNING ?? '08:00', evening = env.EVENING ?? '21:00';
  if (morning && hm >= morning && bot.morningOn !== today) {
    bot.morningOn = today;
    const v = todayView(s, env, w.morning); await send(env, v.msg, doneButtons(v.tasks, env));
  }
  if (evening && hm >= evening && bot.eveningOn !== today) {
    bot.eveningOn = today;
    const v = eveningView(s, env); if (v) await send(env, v.msg, doneButtons(v.tasks, env));
  }
  await data.save();
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // One-time setup: open https://<your-worker>/setup?secret=<WEBHOOK_SECRET> in a browser.
    if (url.pathname === '/setup') {
      if (!env.WEBHOOK_SECRET || url.searchParams.get('secret') !== env.WEBHOOK_SECRET) return new Response('Wrong secret', { status: 403 });
      const hook = await tg(env, 'setWebhook', { url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
      const isFa = env.LANG !== 'en';
      await tg(env, 'setMyCommands', { commands: [
        { command: 'today', description: isFa ? 'کارهای امروز' : 'Today' },
        { command: 'list', description: isFa ? 'همه‌ی کارهای باز' : 'All open tasks' },
        { command: 'new', description: isFa ? 'شروع گفتگوی تازه' : 'Fresh conversation' },
        { command: 'help', description: isFa ? 'راهنما' : 'Help' },
      ] });
      return Response.json(hook);
    }
    if (url.pathname !== '/telegram' || req.method !== 'POST') return new Response('Life bot is running.');
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });

    const u = await req.json();
    const chat = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
    // Personal bot: anyone else only learns their chat id (handy for setup).
    if (!env.CHAT_ID || String(chat) !== String(env.CHAT_ID)) {
      if (u.message) await tg(env, 'sendMessage', { chat_id: chat, text: `This is a private bot. Your chat id is ${chat}` });
      return new Response('ok');
    }
    try {
      if (u.message) await onMessage(env, u.message);
      else if (u.callback_query) await onButton(env, u.callback_query);
    } catch (e) {
      console.error(e);
      await send(env, `⚠️ ${L(env).error} ${esc(e.message || String(e))}`);
    }
    return new Response('ok');
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
};
