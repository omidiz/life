/* The bot's own words (LANG = "fa" or "en"). In conversation the AI answers in whatever language you write. */
const fa = n => n.toLocaleString('fa-IR');

const T = {
  fa: {
    late: 'عقب‌افتاده', today: 'امروز', tomorrow: 'فردا', daysLate: n => `${fa(n)} روز دیر`,
    morning: 'صبح بخیر ☀️', evening: 'شب بخیر 🌙', nothingToday: 'امروز کاری با مهلت نداری.',
    dueToday: 'مهلت امروز', doneToday: n => `✓ امروز ${fa(n)} کار انجام دادی`, forTomorrow: 'برای فردا',
    open: n => `${fa(n)} کار باز داری.`, noOpen: 'هیچ کار بازی نداری 🎉', reminder: '⏰ یادآوری', tap: 'برای تیک زدن بزن:',
    btnDone: '✓ انجام شد', btn1h: '+۱ ساعت', btnTmr: 'فردا', ticked: '✓ انجام شد', snoozed: 'باشه، یک ساعت دیگر یادت می‌اندازم',
    moved: 'رفت برای فردا', gone: 'این کار دیگر نیست.', newChat: 'گفتگوی تازه 🧹 (چیزهایی که درباره‌ات به خاطر سپرده‌ام می‌مانند؛ /memory)',
    cleaned: n => `🧹 ${fa(n)} پیام اخیر ربات پاک شد.`, cleanEmpty: '🧹 پیامی از ربات برای پاک کردن نیست (ربات فقط پیام‌های خودش در ۴۸ ساعت گذشته را می‌تواند پاک کند).',
    error: 'یک مشکل پیش آمد:', imgHow: 'بعد از /img بنویس چه عکسی می‌خواهی، مثلاً:\n/img a cozy cafe in Tehran at night, watercolor',
    memoryEmpty: 'هنوز چیزی درباره‌ات به خاطر نسپرده‌ام. هر وقت بخواهی بگو «یادت باشه که …».',
    memoryTitle: '🧠 <b>چیزهایی که درباره‌ات می‌دانم</b>', memoryClear: '🗑 پاک کردن همه', memoryCleared: 'همه پاک شد.',
    modelTitle: m => `🤖 مدل فعلی: <b>${m}</b>\n\nبرای عوض کردن، یکی را انتخاب کن (گفتگو ادامه پیدا می‌کند).\nردیف آخر حالت است: ⚡ سریع کم فکر می‌کند و زودتر جواب می‌دهد؛ 🧠 تمام توان با بیشترین قدرت مدل فکر می‌کند و جواب می‌دهد.`,
    clearProblems: '🗑 پاک کردن خطاهای ثبت‌شده', fast: '⚡ سریع', deep: '🧠 تمام توان', thinkSet: l => `از حالا: ${l}`,
    modelSet: m => `🤖 از حالا با <b>${m}</b> حرف می‌زنی.`, modelOnlyOne: m => `🤖 مدل فعلی: <b>${m}</b>\n\nحالت را از دکمه‌های پایین انتخاب کن. فقط یک مدل تعریف شده. برای اضافه کردن مدل‌های بیشتر، AI_MODELS یا AI2_MODEL را در Cloudflare بگذار (راهنما: README). یا بنویس:\n/model اسم-مدل`,
    noAi: 'برای گفتگو، کلید هوش مصنوعی (AI_API_KEY) را در Cloudflare بگذار. فعلاً پیامت به Inbox داشبورد رفت:',
    help: `<b>Life</b> — دستیار هوشمند شخصی تو.

هر چیزی بپرس یا بخواه، فارسی یا انگلیسی، مثل ChatGPT یا Gemini:
• سؤال، توضیح، آموزش، ترجمه، نوشتن ایمیل و متن، برنامه‌ریزی، کدنویسی
• «یک عکس از گربه‌ی فضانورد بکش» 🎨 یا /img
• عکس، ویس، PDF، فایل یا لینک بفرست و درباره‌اش بپرس
• روی یک پیام Reply بزن تا درباره‌ی همان ادامه بدهیم
• «یادت باشه که …» تا همیشه به خاطر بسپارم

داشبورد Life:
• «فردا ساعت ۵ به مامان زنگ بزنم» · «این هفته چی دارم؟» · «تمرین فیزیک رو انجام دادم»
• هر صبح خلاصه‌ی روز، هر شب مرور روز، و یادآوری سر وقت

/new گفتگوی تازه · /clean پاک کردن پیام‌ها · /model عوض کردن مدل · /img عکس · /memory حافظه · /today امروز · /list کارها · /status وضعیت`,
  },
  en: {
    late: 'Late', today: 'today', tomorrow: 'tomorrow', daysLate: n => `${n} day${n > 1 ? 's' : ''} late`,
    morning: 'Good morning ☀️', evening: 'Good evening 🌙', nothingToday: 'Nothing due today.',
    dueToday: 'Due today', doneToday: n => `✓ ${n} done today`, forTomorrow: 'For tomorrow',
    open: n => `${n} open task${n === 1 ? '' : 's'}.`, noOpen: 'No open tasks 🎉', reminder: '⏰ Reminder', tap: 'Tap to tick off:',
    btnDone: '✓ Done', btn1h: '+1 hour', btnTmr: 'Tomorrow', ticked: '✓ Done', snoozed: 'OK, I’ll remind you in an hour',
    moved: 'Moved to tomorrow', gone: 'That task is gone.', newChat: 'Fresh conversation 🧹 (what I remember about you stays; /memory)',
    cleaned: n => `🧹 Deleted ${n} recent bot message${n === 1 ? '' : 's'}.`, cleanEmpty: '🧹 No recent bot messages to delete (Telegram only lets bots delete their own messages from the last 48 hours).',
    error: 'Something went wrong:', imgHow: 'Write what picture you want after /img, e.g.\n/img a cozy cafe at night, watercolor',
    memoryEmpty: 'I haven’t saved anything about you yet. Say “remember that …” any time.',
    memoryTitle: '🧠 <b>What I know about you</b>', memoryClear: '🗑 Forget everything', memoryCleared: 'All forgotten.',
    modelTitle: m => `🤖 Current model: <b>${m}</b>\n\nPick one to switch (the conversation carries on).\nThe last row is the mode: ⚡ fast thinks little and answers sooner; 🧠 full power uses everything the model has.`,
    clearProblems: '🗑 Clear recorded problems', fast: '⚡ Fast', deep: '🧠 Full power', thinkSet: l => `From now on: ${l}`,
    modelSet: m => `🤖 From now on you’re talking to <b>${m}</b>.`, modelOnlyOne: m => `🤖 Current model: <b>${m}</b>\n\nPick a mode below. Only one model is set up. To add more, set AI_MODELS or AI2_MODEL in Cloudflare (see README), or write:\n/model model-name`,
    noAi: 'To chat, add the AI key (AI_API_KEY) in Cloudflare. For now your message went to the dashboard Inbox:',
    help: `<b>Life</b> — your personal smart assistant.

Ask or request anything, like ChatGPT or Gemini:
• questions, explanations, learning, translation, emails and texts, planning, code
• "Draw a cat astronaut" 🎨 or /img
• send a photo, voice message, PDF, file or link and ask about it
• reply to a message to continue about it
• "Remember that …" and I will, for good

Your Life dashboard:
• "Call mom tomorrow at 5" · "What do I have this week?" · "I finished the physics homework"
• a morning brief, an evening review, and reminders on time

/new fresh chat · /clean clean chat · /model switch model · /img picture · /memory memory · /today today · /list tasks · /status status`,
  },
};
export const words = c => T[c.lang];

// The command menu (the "Menu" button in Telegram). The bot keeps it up to date by itself.
export const commands = c => [
  ['new', 'گفتگوی تازه', 'Fresh conversation'], ['clean', 'پاک کردن پیام‌های اخیر ربات', 'Delete recent bot messages'], ['model', 'مدل و حالت (سریع / تمام توان)', 'AI model and mode (fast / full power)'], ['img', 'ساختن عکس', 'Make a picture'], ['memory', 'چیزهایی که درباره‌ات می‌دانم', 'What I remember about you'],
  ['today', 'کارهای امروز', 'Today'], ['list', 'همه‌ی کارهای باز', 'All open tasks'], ['status', 'وضعیت اتصال‌ها', 'Check connections'], ['help', 'راهنما', 'Help'],
].map(([command, fa, en]) => ({ command, description: c.lang === 'fa' ? fa : en }));
