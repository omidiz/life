/* Checks the whole bot with Telegram, GitHub, the AI service and Cloudflare simulated.
   Run from the bot folder:  node test/run.mjs */
import worker, { ChatRoom } from '../src/worker.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- a pretend Cloudflare room (Durable Object) ---------- */
class Storage {
  m = new Map(); alarm = null; room = null;
  async get(k) { return structuredClone(this.m.get(k)); } async put(k, v) { this.m.set(k, structuredClone(v)); } async delete(k) { this.m.delete(k); }
  async list({ prefix, limit }) { return new Map([...this.m].filter(([k]) => k.startsWith(prefix)).sort().slice(0, limit)); }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = t; setTimeout(async () => { this.alarm = null; await this.room.alarm(); }, 0); }
}
const storage = new Storage();
const env = {
  TELEGRAM_TOKEN: 'tok', CHAT_ID: '42', WEBHOOK_SECRET: 'sec', GITHUB_TOKEN: 'gist', GIST_ID: 'g1',
  AI_API_KEY: 'k', AI_URL: 'https://ai.test/v1', AI_MODEL: 'aa', GITHUB_REPO_TOKEN: 'rt', GITHUB_REPO: 'me/life', TZ: 'Asia/Tehran', LANG: 'fa',
};
const room = new ChatRoom({ storage }, env); storage.room = room;
env.ROOM = { idFromName: () => 'x', get: () => ({ fetch: (u, o) => room.fetch(new Request(u, o)) }) };

/* ---------- pretend services ---------- */
const nowLocal = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' }).format(new Date()).replace(' ', 'T');
let gist = { pages: [{ id: 'p-home', name: 'Home', order: 0 }], boards: [{ id: 'b-study', name: 'Study', pageId: 'p-home', order: 0 }], tasks: [] };
const repo = { head: 'c0', commits: { c0: { tree: 't0', parents: [], message: 'init' } }, trees: { t0: { 'bot/wrangler.toml': 'MORNING = "08:00"\n' } }, n: 1 };
let ai = []; // queue of answers: { text } streamed, { tools: [[name, args]] }, or a function(body) → answer
const aiBodies = [], sent = [], calls = [];
const sse = events => new Response(new ReadableStream({ start(ctl) {
  for (const e of events) ctl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: e }] })}\n\n`));
  ctl.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); ctl.close();
} }), { headers: { 'content-type': 'text/event-stream' } });
const J = x => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, o = {}) => {
  const url = String(input?.url || input), method = o.method || 'GET';
  calls.push(url.replace(/bot[^/]+\//, 'bot…/').slice(0, 80));
  if (url.startsWith('https://api.github.com/gists/g1')) {
    if (method === 'PATCH') gist = JSON.parse(JSON.parse(o.body).files['life-dashboard.json'].content);
    return J({ files: { 'life-dashboard.json': { content: JSON.stringify(gist) } } });
  }
  if (url.startsWith('https://api.github.com/repos/me/life')) {
    const p = url.split('/repos/me/life')[1]; let m;
    const b64 = s => Buffer.from(s).toString('base64'), sha = s => 'h' + Buffer.from(s).toString('hex').slice(0, 12);
    if ((m = p.match(/^\/contents\/([^?]*)/))) { const f = repo.trees[repo.commits[repo.head].tree][decodeURI(m[1])]; return f === undefined ? new Response('nf', { status: 404 }) : J({ sha: sha(f), content: b64(f) }); }
    if (p === '/git/ref/heads/main') return J({ object: { sha: repo.head } });
    if ((m = p.match(/^\/git\/commits\/(\w+)$/))) { const c = repo.commits[m[1]]; return J({ tree: { sha: c.tree }, parents: c.parents.map(s => ({ sha: s })), message: c.message }); }
    if (p === '/git/trees') { const b = JSON.parse(o.body), t = { ...repo.trees[b.base_tree] }; for (const e of b.tree) e.sha === null ? delete t[e.path] : (t[e.path] = e.content); const id = 't' + repo.n++; repo.trees[id] = t; return J({ sha: id }); }
    if (p === '/git/commits') { const b = JSON.parse(o.body), id = 'c' + repo.n++; repo.commits[id] = { tree: b.tree, parents: b.parents, message: b.message }; return J({ sha: id }); }
    if (p === '/git/refs/heads/main') { repo.head = JSON.parse(o.body).sha; return J({}); }
    if (p.includes('/check-runs')) return J({ check_runs: [{ name: 'Workers Builds', status: 'completed', conclusion: 'success' }] });
  }
  if (url === 'https://ai.test/v1/chat/completions') {
    const body = JSON.parse(o.body); aiBodies.push(body);
    if (!body.stream) return J({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    let a = ai.shift(); if (typeof a === 'function') a = a(body);
    if (a.status) return new Response(a.body, { status: a.status });
    if (a.tools) return sse(a.tools.map(([name, args], index) => ({ tool_calls: [{ index, id: 'c' + index, function: { name, arguments: JSON.stringify(args) } }] })));
    return sse(a.text.match(/.{1,12}/gs).map(content => ({ content })));
  }
  if (url.includes('pollinations')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
  if (url.includes('example.com')) return new Response('<html><title>Example</title><body><p>Hello page</p></body></html>', { headers: { 'content-type': 'text/html' } });
  if (url.includes('api.telegram.org/file/')) return new Response(new Uint8Array([37, 80, 68, 70]));
  if (url.includes('api.telegram.org/bot')) {
    const m = url.split('/').pop();
    if (m === 'getFile') return J({ ok: true, result: { file_path: 'documents/report.pdf' } });
    const b = o.body instanceof FormData ? { photo: '[bytes]', chat_id: o.body.get('chat_id') } : JSON.parse(o.body);
    if (m !== 'sendChatAction') sent.push({ m, ...b });
    return J({ ok: true, result: { message_id: sent.length } });
  }
  return new Response('unexpected ' + url, { status: 500 });
};

let uid = 100;
const say = async (message, id = uid++) => {
  await worker.fetch(new Request('https://bot.test/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify({ update_id: id, message: { chat: { id: 42 }, message_id: id, ...message } }) }), env);
  await wait(30); while (room.working || storage.alarm) await wait(20);
};
const press = async data => { await worker.fetch(new Request('https://bot.test/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
  body: JSON.stringify({ update_id: uid++, callback_query: { id: 'q', data, message: { chat: { id: 42 }, message_id: 1, reply_markup: { inline_keyboard: [] } } } }) }), env); await wait(30); while (room.working || storage.alarm) await wait(20); };
const lastText = () => [...sent].reverse().find(s => s.text)?.text || '';
const mark = () => { sent.length = 0; calls.length = 0; aiBodies.length = 0; };

/* ---------- the checks ---------- */
mark(); ai.push({ text: 'سلام!' }); await say({ text: 'سلام' });
check('menu: updated by itself on the first message', sent.some(s => s.m === 'setMyCommands' && s.commands.length === 7));
mark(); ai.push({ text: 'باز سلام!' }); await say({ text: 'سلام' });
check('menu: not sent again when unchanged', !sent.some(s => s.m === 'setMyCommands'));
await say({ text: '/new' });

mark(); ai.push({ text: 'سلام! **چطوری؟** چطور می‌تونم کمک کنم؟' });
await say({ text: 'سلام' });
check('chat: answers, streamed and formatted', /<b>چطوری؟<\/b>/.test(lastText()), lastText());
check('chat: plain chat never touches the dashboard', !calls.some(u => u.includes('gists')), calls.join(' '));
check('chat: asks for full strength (stream, deep thinking)', aiBodies[0].stream === true && aiBodies[0].reasoning_effort === 'high');

mark(); ai.push(b => ({ text: b.messages.some(m => m.content === 'سلام') ? 'یادم هست.' : 'یادم نیست.' }));
await say({ text: 'قبلاً چی گفتم؟' });
check('memory: the conversation is remembered', lastText().includes('یادم هست'), lastText());

mark(); ai.push({ tools: [['dashboard_overview', {}], ['add_items', { items: [{ title: 'امتحان ریاضی', board: 'study', due: '2030-01-05' }] }]] }, { text: 'اضافه شد.' });
await say({ text: 'امتحان ریاضی ۱۵ دی' });
check('dashboard: task added to the right board', gist.tasks.some(t => t.title === 'امتحان ریاضی' && t.boardId === 'b-study' && t.due === '2030-01-05'), JSON.stringify(gist.tasks));
check('dashboard: answer sent before saving', sent.findIndex(s => s.text?.includes('اضافه شد')) >= 0);

mark(); ai.push({ tools: [['remember', { fact: 'User studies computer engineering.' }]] }, { text: 'باشه، یادم می‌مونه.' });
await say({ text: 'من مهندسی کامپیوتر می‌خونم، یادت باشه' });
ai.push(b => ({ text: b.messages[0].content.includes('computer engineering') ? 'می‌دونم.' : 'نمی‌دونم.' }));
await say({ text: 'من چی می‌خونم؟' });
check('long-term memory: saved and used later', lastText().includes('می‌دونم'), lastText());
mark(); await say({ text: '/memory' });
check('/memory lists facts', lastText().includes('computer engineering'), lastText());
await press('mem:clear');
check('/memory clear', !((await storage.get('memory')) || []).length);

mark(); ai.push({ tools: [['make_image', { prompt: 'a cat astronaut', shape: 'portrait' }]] }, { text: 'بفرما 🐱' });
await say({ text: 'یک گربه‌ی فضانورد بکش' });
check('pictures: made and sent', sent.some(s => s.m === 'sendPhoto'));
mark(); await say({ text: '/img sunset' });
check('/img sends a picture without the AI', sent.some(s => s.m === 'sendPhoto') && !aiBodies.length);

mark(); ai.push(b => ({ text: JSON.stringify(b.messages.at(-1).content).includes('application/pdf') ? 'PDF رسید.' : 'نرسید.' }));
await say({ document: { file_id: 'f', file_name: 'report.pdf', mime_type: 'application/pdf' }, caption: 'خلاصه کن' });
check('files: a PDF goes to the model', lastText().includes('PDF رسید'), lastText());

mark(); ai.push({ tools: [['read_webpage', { url: 'https://example.com' }]] }, b => ({ text: JSON.stringify(b.messages).includes('Hello page') ? 'خواندم.' : 'نه.' }));
await say({ text: 'این لینک چی می‌گه؟ https://example.com' });
check('links: the page is read', lastText().includes('خواندم'), lastText());

mark(); ai.push({ status: 400, body: 'unknown field reasoning_effort' }, { text: 'باشه.' });
await say({ text: 'تست' });
check('refused settings are dropped and remembered', aiBodies[1] && !aiBodies[1].reasoning_effort && (await storage.get('refused'))?.aa?.includes('reasoning_effort'));
mark(); ai.push({ text: 'دوباره.' }); await say({ text: 'باز' });
check('…and not sent again next time', aiBodies.length === 1 && !aiBodies[0].reasoning_effort);

mark(); ai.push({ text: 'یک بار.' });
const dup = uid++; await say({ text: 'تکرار' }, dup); await say({ text: 'تکرار' }, dup);
check('a message Telegram sends twice is answered once', aiBodies.length === 1);

mark(); await say({ text: '/new' });
check('/new clears the conversation', !((await storage.get('chat')) || []).length);

mark(); await say({ text: '/today' });
check('/today shows the day', lastText().includes('۱۴'), lastText());
mark(); await say({ text: '/status' });
check('/status reports everything', /AI \(aa\)/.test(lastText()) && /Dashboard: 1 pages/.test(lastText()) && /GitHub: can edit/.test(lastText()), lastText());

// reminders and the morning brief
gist.tasks.push({ id: 'r1', boardId: 'b-study', type: 'task', title: 'قرص', due: nowLocal(), done: false, pos: 9, created: 1, updated: 1 });
mark(); env.MORNING = '00:00';
await worker.scheduled({}, env, { waitUntil: p => (globalThis.tick = p) }); await globalThis.tick;
check('reminder sent with buttons', sent.some(s => s.text?.includes('قرص') && s.reply_markup?.inline_keyboard?.[0]?.length === 3));
check('morning brief sent', sent.some(s => s.text?.includes('صبح بخیر')));
mark(); await worker.scheduled({}, env, { waitUntil: p => (globalThis.tick = p) }); await globalThis.tick;
check('…and neither is sent twice', !sent.length, JSON.stringify(sent).slice(0, 200));
await press('snooze:r1');
check('snooze moves the task an hour later', gist.tasks.find(t => t.id === 'r1').due > nowLocal());

// changing its own code
mark(); ai.push({ tools: [['repo_read', { path: 'bot/wrangler.toml' }]] }, { tools: [['propose_change', { summary: 'صبح ساعت ۷', files: [{ path: 'bot/wrangler.toml', content: 'MORNING = "07:00"\n' }] }]] }, { text: 'پیشنهاد دادم.' });
await say({ text: 'خلاصه‌ی صبح ساعت ۷ باشه' });
const proposal = sent.find(s => s.text?.includes('Proposed change'));
check('code: change proposed with Apply / Cancel', !!proposal && proposal.reply_markup.inline_keyboard[0].length === 2);
check('code: nothing written before Apply', repo.head === 'c0');
await press(proposal.reply_markup.inline_keyboard[0][0].callback_data);
check('code: applied as one commit', repo.trees[repo.commits[repo.head].tree]['bot/wrangler.toml'].includes('07:00'));
mark(); await worker.scheduled({}, env, { waitUntil: p => (globalThis.tick = p) }); await globalThis.tick;
check('code: "live" notice after the build', sent.some(s => s.text?.includes('live')));
await press(`dev:undo:${repo.head}`);
check('code: undo restores the file', repo.trees[repo.commits[repo.head].tree]['bot/wrangler.toml'].includes('08:00'));
mark(); ai.push({ tools: [['propose_change', { summary: 'x', files: [{ path: 'bot/a.js', content: 'const k = "sk-abcdefghijklmnopqrstuvwxyz0123"' }] }]] }, b => ({ text: JSON.stringify(b.messages.at(-1)).includes('Refused') ? 'رد شد.' : 'نه!' }));
await say({ text: 'کلید رو بذار تو کد' });
check('code: keys are never written into files', lastText().includes('رد شد'));

// someone else
mark();
await worker.fetch(new Request('https://bot.test/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec' }, body: JSON.stringify({ update_id: uid++, message: { chat: { id: 7 }, text: 'hi' } }) }), env);
check('strangers only get the private-bot reply', sent.length === 1 && sent[0].text.includes('private bot'));

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
