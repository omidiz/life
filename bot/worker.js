/* Life — your personal Telegram bot, connected to your Life dashboard.
   Runs as a Cloudflare Worker. Talk to it in Farsi or English; it understands, updates the
   dashboard (through the same gist the dashboard syncs with), reminds you, and briefs you.

   Secrets: TELEGRAM_TOKEN, GITHUB_TOKEN, WEBHOOK_SECRET, CHAT_ID, AI_API_KEY
   Settings in wrangler.toml: TZ, LANG, MORNING, EVENING, AI_URL, AI_MODEL, GIST_ID */
import { think, checkAI } from './brain.js';
import { mdToHtml, splitMd } from './format.js';
import { makeImage, transcribe } from './media.js';
export { ChatRoom } from './room.js';
import { devEnabled, proposalView, applyProposal, undoCommit, buildResult } from './dev.js';
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
    voice: 'برای فهمیدن پیام صوتی باید STT_MODEL را در Cloudflare تنظیم کنی. فعلاً لطفاً بنویس.',
    voiceEmpty: 'چیزی در پیام صوتی نشنیدم.', fileBig: 'این فایل برای خواندن خیلی بزرگ است (حداکثر ۳۰۰ کیلوبایت).',
    fileType: 'فعلاً فقط عکس و فایل‌های متنی (txt، md، csv، json، کد…) را می‌توانم بخوانم.',
    imgHow: 'بعد از /img بنویس چه عکسی می‌خواهی، مثلاً:\n/img a cozy cafe in Tehran at night, watercolor',
    error: 'یک مشکل پیش آمد:', tap: 'برای تیک زدن بزن:',
    added: b => `○ به ${b} اضافه شد:`,
    help: `<b>Life</b> — دستیار هوشمند تو، مثل یک چت‌بات، وصل به داشبوردت.

هر چیزی بپرس یا بخواه، فارسی یا انگلیسی:
• «فرق هوش مصنوعی و یادگیری ماشین چیه؟»
• «یک ایمیل رسمی برای مرخصی بنویس»
• «این متن رو به انگلیسی ترجمه کن: …»
• «یک عکس از یک گربه‌ی فضانورد بکش» 🎨
• یک عکس یا فایل متنی بفرست و درباره‌اش بپرس
• روی یک پیام Reply بزن تا درباره‌ی همان ادامه بدهیم

و داشبوردت را هم مدیریت می‌کنم:
• «فردا ساعت ۵ به مامان زنگ بزنم» · «این هفته چی دارم؟» · «تمرین فیزیک رو انجام دادم»

هر صبح خلاصه‌ی روز و هر شب مرور روز را می‌فرستم و کارهایی که ساعت دارند سر وقت یادآوری می‌شوند.

/new گفتگوی تازه · /img ساختن سریع عکس · /today امروز · /list همه‌ی کارها · /status بررسی اتصال‌ها`,
  },
  en: {
    late: 'Late', today: 'today', tomorrow: 'tomorrow', daysLate: n => `${n} day${n > 1 ? 's' : ''} late`,
    morning: 'Good morning ☀️', evening: 'Good evening 🌙', nothingToday: 'Nothing due today.',
    dueToday: 'Due today', doneToday: n => `✓ ${n} done today`, forTomorrow: 'For tomorrow',
    open: n => `${n} open task${n === 1 ? '' : 's'}.`, noOpen: 'No open tasks 🎉', reminder: '⏰ Reminder',
    btnDone: '✓ Done', btn1h: '+1 hour', btnTmr: 'Tomorrow', ticked: '✓ Done', snoozed: 'OK, I’ll remind you later',
    moved: 'Moved to tomorrow', gone: 'That task is gone.', forgot: 'Fresh start. 🧹',
    voice: 'To understand voice messages, set STT_MODEL in Cloudflare. For now, please type.',
    voiceEmpty: 'I couldn’t hear anything in that voice message.', fileBig: 'That file is too big to read (max 300 KB).',
    fileType: 'For now I can read photos and text files (txt, md, csv, json, code…).',
    imgHow: 'Write what picture you want after /img, e.g.\n/img a cozy cafe at night, watercolor',
    error: 'Something went wrong:', tap: 'Tap to tick off:',
    added: b => `○ Added to ${b}:`,
    help: `<b>Life</b> — your smart assistant, like a chatbot, connected to your dashboard.

Ask or request anything:
• "What’s the difference between AI and machine learning?"
• "Write a formal email asking for a day off"
• "Translate this into Farsi: …"
• "Draw a cat astronaut" 🎨
• Send a photo or a text file and ask about it
• Reply to a message to continue about it

And I manage your dashboard:
• "Call mom tomorrow at 5" · "What do I have this week?" · "I finished the physics homework"

Every morning I send your day and every evening a review; tasks with a time get a reminder.

/new fresh conversation · /img quick picture · /today today · /list all tasks · /status check connections`,
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
const b64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  oga: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm' };

// Everything attached to a message, ready for the model: pictures, voice, audio, video, PDFs, any file.
async function attachments(env, m) {
  const parts = [], labels = [];
  let extraText = '', said = '';
  const photo = m.photo?.at(-1) || (m.sticker && !m.sticker.is_animated && !m.sticker.is_video && m.sticker);
  const voice = m.voice || m.audio || m.video_note;
  const file = m.document || m.video || m.animation;
  if (photo) {
    const { bytes, path } = await download(env, photo.file_id);
    parts.push({ type: 'image_url', image_url: { url: `data:${MIME[path.split('.').pop().toLowerCase()] || 'image/jpeg'};base64,${b64(bytes)}` } });
    labels.push('photo');
  }
  if (voice) {
    const { bytes, path } = await download(env, voice.file_id);
    const ext = path.split('.').pop().toLowerCase();
    if (env.STT_MODEL) said = await transcribe(env, bytes, 'voice.' + ext);
    else if (m.video_note) parts.push({ type: 'file', file: { filename: 'video.mp4', file_data: `data:video/mp4;base64,${b64(bytes)}` } });
    else parts.push({ type: 'input_audio', input_audio: { data: b64(bytes), format: ext === 'oga' ? 'ogg' : ext } });
    labels.push(m.video_note ? 'video message' : 'voice message');
  }
  if (file) {
    const name = file.file_name || (m.video ? 'video.mp4' : 'file');
    const { bytes, path } = await download(env, file.file_id);
    const mime = file.mime_type || MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
    if (mime.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64(bytes)}` } });
    else if (TEXT_FILE.test(name) || mime.startsWith('text/') || /json|xml|csv|yaml|javascript/.test(mime)) extraText = `<file name="${name}">\n${new TextDecoder().decode(bytes)}\n</file>`;
    else parts.push({ type: 'file', file: { filename: name, file_data: `data:${mime};base64,${b64(bytes)}` } });
    labels.push(name);
  }
  return { parts, label: labels.join(', '), extraText, said };
}

// Download a file the user sent to the bot.
async function download(env, fileId) {
  const f = await tg(env, 'getFile', { file_id: fileId });
  if (!f.ok) throw new Error('Telegram does not let bots download files over 20 MB. Send a smaller file, or split it.');
  return { bytes: new Uint8Array(await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`).then(r => r.arrayBuffer())), path: f.result.file_path };
}

// Text-like files (txt, md, csv, json, code…) are read and given to the AI.
const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|ts|py|java|c|cpp|h|cs|go|rs|rb|php|sh|ya?ml|toml|ini|log|sql|srt)$/i;

async function sendPhoto(env, img, caption) {
  if (img.url) return tg(env, 'sendPhoto', { chat_id: env.CHAT_ID, photo: img.url, ...(caption && { caption: caption.slice(0, 1000) }) });
  const form = new FormData();
  form.append('chat_id', env.CHAT_ID);
  form.append('photo', new Blob([img.bytes], { type: img.type }), 'image.' + (img.type.split('/')[1] || 'jpg'));
  if (caption) form.append('caption', caption.slice(0, 1000));
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendPhoto`, { method: 'POST', body: form }).then(r => r.json());
  if (!r.ok) { // too big for a photo: send it as a file
    form.delete('photo'); form.append('document', new Blob([img.bytes], { type: img.type }), 'image.' + (img.type.split('/')[1] || 'jpg'));
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendDocument`, { method: 'POST', body: form });
  }
}

// An AI answer: Markdown → Telegram messages (split if long), then any pictures.
async function sendAnswer(env, { text, images }) {
  for (const img of images) await sendPhoto(env, img);
  for (const part of splitMd(text || '')) await send(env, mdToHtml(part));
}

// Keep "typing…" (or "sending photo…") showing while the AI works.
function busy(env, action = 'typing') {
  const ping = () => tg(env, 'sendChatAction', { chat_id: env.CHAT_ID, action }).catch(() => {});
  ping();
  const timer = setInterval(ping, 4500);
  return () => clearInterval(timer);
}

async function onMessage(env, m) {
  const w = L(env);
  let text = (m.text || m.caption || '').trim();
  const cmd = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;
  const arg = cmd ? text.replace(/^\/\S+\s*/, '') : '';
  if (cmd === 'start' || cmd === 'help') return send(env, w.help);

  if (cmd === 'img' || cmd === 'image') { // quick picture, no AI needed
    if (!arg) return send(env, w.imgHow);
    const stop = busy(env, 'upload_photo');
    try { await sendPhoto(env, await makeImage(env, arg)); } finally { stop(); }
    return;
  }

  const data = await open(env);
  if (cmd === 'today') { const v = todayView(data.s, env); return send(env, v.msg, doneButtons(v.tasks, env)); }
  if (cmd === 'list') { const v = listView(data.s, env); return send(env, v.msg, doneButtons(v.tasks, env)); }
  if (cmd === 'new') { data.bot.chat = []; await data.save(); return send(env, w.forgot); }
  if (cmd === 'status') {
    const ai = await checkAI(env);
    return send(env, [
      `<b>Status</b>`,
      `✓ Telegram`,
      `✓ Dashboard: ${live(data.s.pages).length} pages, ${live(data.s.boards).length} boards, ${openTasks(data.s).length} open tasks`,
      ai,
      `${env.IMAGE_MODEL ? '✓ Pictures: ' + esc(env.IMAGE_MODEL) : '✓ Pictures: free service (Pollinations)'}`,
      `${env.STT_MODEL ? '✓ Voice: ' + esc(env.STT_MODEL) : '✓ Voice: straight to the model'}`,
      `${devEnabled(env) ? '✓ GitHub: can edit ' + esc(env.GITHUB_REPO || 'omidiz/life') : '✗ GitHub: not connected (GITHUB_REPO_TOKEN)'}`,
      data.bot.lastError ? `\nLast problem: <code>${esc(data.bot.lastError)}</code>` : '',
    ].join('\n'));
  }

  // Without an AI key the bot still works as a quick inbox: the message becomes a task.
  if (!env.AI_API_KEY) {
    if (!text) return;
    const tag = text.match(/(^|\s)#(\S+)/), b = (tag && findBoard(data.s, tag[2])) || inbox(data.s);
    const t = addItem(data.s, { title: tag ? text.replace(tag[0], ' ').trim() : text, boardId: b.id });
    await data.save();
    return send(env, `${w.added(esc(b.name))} ${esc(t.title)}`);
  }

  const stop = busy(env);
  try {
    const att = await attachments(env, m);
    if (att.said) { await send(env, `🎤 <i>${esc(att.said)}</i>`); text = [text, att.said].filter(Boolean).join('\n'); }
    if (att.extraText) text = `${text || 'Look at this file.'}\n\n${att.extraText}`;
    if (m.sticker && !text) text = `(sticker ${m.sticker.emoji || ''})`;
    if (m.location) text = `${text} (my location: ${m.location.latitude}, ${m.location.longitude})`.trim();
    if (m.contact) text = `${text} (contact: ${[m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ')} ${m.contact.phone_number})`.trim();
    if (!text && !att.parts.length) return;

    const quoted = m.reply_to_message?.text || m.reply_to_message?.caption;
    const answer = await think(env, data, { text: [quoted && `(replying to: "${quoted}")`, text].filter(Boolean).join('\n'), parts: att.parts, label: att.label });
    const showProposal = data.bot.showProposal; delete data.bot.showProposal;
    await data.save();
    await sendAnswer(env, answer);
    if (showProposal && data.bot.proposal) { const v = proposalView(data.bot.proposal); await send(env, v.text, { reply_markup: v.reply_markup }); }
  } finally { stop(); }
}

// ✅ Apply / ✖ Cancel / ↩️ Undo for changes to the bot's own code.
async function onDevButton(env, q) {
  const [, act, id] = q.data.split(':'), data = await open(env), p = data.bot.proposal;
  const answer = text => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text });
  const clearButtons = () => q.message && tg(env, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
  if (act === 'cancel') { if (p?.id === id) delete data.bot.proposal; await data.save(); await clearButtons(); return answer('✖'); }
  if (act === 'apply') {
    if (!p || p.id !== id) { await clearButtons(); return answer('This proposal is no longer available.'); }
    await answer('…');
    const c = await applyProposal(env, p);
    delete data.bot.proposal;
    data.bot.pendingBuild = { sha: c.sha, at: Date.now() };
    await data.save(); await clearButtons();
    return send(env, `✅ Applied: <a href="${c.url}">${c.sha.slice(0, 7)}</a>\nCloudflare is building the new version (about a minute). I'll tell you when it's live.`,
      { reply_markup: { inline_keyboard: [[{ text: '↩️ Undo', callback_data: `dev:undo:${c.sha}` }]] } });
  }
  if (act === 'undo') {
    await answer('…');
    const c = await undoCommit(env, id);
    data.bot.pendingBuild = { sha: c.sha, at: Date.now() };
    await data.save(); await clearButtons();
    return send(env, `↩️ Undone (${c.sha.slice(0, 7)}). Cloudflare is building the previous version again.`);
  }
}

async function onButton(env, q) {
  if (q.data?.startsWith('dev:')) return onDevButton(env, q);
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

export async function handleUpdate(env, u) {
  try {
    if (u.message) await onMessage(env, u.message);
    else if (u.callback_query) await onButton(env, u.callback_query);
  } catch (e) {
    console.error(e);
    await send(env, `⚠️ ${L(env).error} ${esc(e.message || String(e))}`);
    try { // remembered, so the bot can look into its own problems
      const d = await open(env);
      (d.bot.errors ||= []).push({ at: Date.now(), where: u.message ? 'message' : 'button', message: String(e.stack || e.message || e).slice(0, 800) });
      d.bot.errors = d.bot.errors.slice(-15);
      await d.save();
    } catch {}
  }
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

  // Tell the user when a change to the bot's code is live (or failed to build).
  if (bot.pendingBuild && devEnabled(env)) {
    const r = await buildResult(env, bot.pendingBuild.sha);
    if (r) {
      await send(env, r.ok ? '🚀 The new version is live.' : `❌ Cloudflare could not build the new version, so the old one keeps running.\n<code>${esc(r.text)}</code>${r.url ? `\n<a href="${r.url}">Details</a>` : ''}\nAsk me to fix it, or press Undo.`);
      delete bot.pendingBuild;
    } else if (Date.now() - bot.pendingBuild.at > 30 * 60000) delete bot.pendingBuild;
  }

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
        { command: 'new', description: isFa ? 'شروع گفتگوی تازه' : 'Fresh conversation' },
        { command: 'img', description: isFa ? 'ساختن عکس' : 'Make a picture' },
        { command: 'today', description: isFa ? 'کارهای امروز' : 'Today' },
        { command: 'list', description: isFa ? 'همه‌ی کارهای باز' : 'All open tasks' },
        { command: 'status', description: isFa ? 'بررسی اتصال‌ها' : 'Check connections' },
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
    // Hand the message to the bot's "room" (a Durable Object), which answers it in its own time
    // (up to 15 minutes), one message after another, each only once.
    if (env.ROOM) {
      await env.ROOM.get(env.ROOM.idFromName('chat')).fetch('https://room/update', { method: 'POST', body: JSON.stringify(u) });
      return new Response('ok');
    }
    await handleUpdate(env, u);
    return new Response('ok');
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(tick(env)); },
};
