/* The bot's "room": a Cloudflare Durable Object that receives every Telegram message and the 5-minute timer.
   - It reads your messages live, like a person: messages that come together (forwards, albums, quick
     follow-ups) are answered together, and a new message stops an answer in progress, so "do X" followed
     by "no, don't" ends with X not done. Commands and buttons run in order. Each message is handled once.
   - It keeps the bot's own memory: the conversation, what it knows about you, reminders sent, and so on.
     (Your tasks stay in the dashboard's gist; the bot reads them only when needed.) */
import { config } from './config.js';
import { telegram, esc } from './telegram.js';
import { words, commands } from './i18n.js';
import { converse } from './assistant.js';
import { checkAI, makeImage, Interrupted } from './ai.js';
import { openDashboard, live, openTasks, inbox, addItem } from './dashboard.js';
import { todayView, listView, doneButtons, planTick, taskButton } from './planner.js';
import { proposalView, applyProposal, undoCommit, buildResult } from './tools/code.js';
import { searchService } from './tools/search.js';

const COMMANDS = new Set(['start', 'help', 'new', 'clean', 'img', 'image', 'memory', 'today', 'list', 'status', 'model']);
// Invisible direction marks (often copied along with Farsi text) must not hide a command.
const clean = t => String(t || '').replace(/^[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/, '').trim();
const commandOf = m => { const t = clean(m.text || m.caption); return t.startsWith('/') ? t.slice(1).split(/[\s@]/)[0].toLowerCase() : null; };
// A message for the conversation (not a command, not a button).
const isChat = u => !!u.message && !COMMANDS.has(commandOf(u.message));
const comesInGroups = m => !!(m.media_group_id || m.forward_origin || m.forward_from || m.forward_sender_name || m.forward_from_chat);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.working = false;
    this.current = null;  // the answer being written now (an AbortController), so a new message can stop it
    this.carry = [];      // messages of an answer that was stopped: they are answered again together with the new ones
    this.earlier = [];    // what that stopped answer had already done
    this.lastArrival = 0;
    const store = ctx.storage;
    this.state = { get: k => store.get(k), put: (k, v) => store.put(k, v), delete: k => store.delete(k) };
  }

  async fetch(req) {
    const path = new URL(req.url).pathname, store = this.ctx.storage;
    if (path === '/tick') { await this.tick(); return new Response('ok'); }
    const u = await req.json(), key = 'u:' + String(u.update_id).padStart(15, '0');
    if (((await store.get('last')) ?? -1) >= u.update_id || (await store.get(key))) return new Response('seen'); // Telegram re-sent it
    await store.put(key, u);
    this.lastArrival = Date.now();
    if (isChat(u) && this.current) this.current.abort(); // a new message: stop the answer in progress and read everything together
    if (!this.working && !(await store.getAlarm())) await store.setAlarm(Date.now());
    return new Response('ok');
  }

  async queue() { return [...(await this.ctx.storage.list({ prefix: 'u:' })).entries()]; }

  // Work through the queue: a run of conversation messages becomes one answer; commands and buttons one by one.
  async alarm() {
    if (this.working) return;
    this.working = true;
    const store = this.ctx.storage;
    try {
      for (;;) {
        let q = await this.queue();
        if (!q.length && !this.carry.length) break;
        if (q.length && !isChat(q[0][1]) && !this.carry.length) {
          const [key, u] = q[0];
          await store.put('last', u.update_id); await store.delete(key);
          await this.handle(u);
          continue;
        }
        // Forwards and albums arrive as several messages within a moment: wait until they have all come in.
        for (let waited = 0; waited < 4000 && q.some(([, u]) => u.message && comesInGroups(u.message)) && Date.now() - this.lastArrival < 900; waited += 300) {
          await sleep(300); q = await this.queue();
        }
        const run = [];
        for (const [key, u] of q) { if (!isChat(u)) break; run.push(u); await store.put('last', u.update_id); await store.delete(key); }
        await this.conversation([...this.carry, ...run.map(u => u.message)]);
      }
    } finally {
      this.working = false;
      if ((await store.list({ prefix: 'u:', limit: 1 })).size && !(await store.getAlarm())) await store.setAlarm(Date.now());
    }
  }

  // One answer to one or more messages. If a newer message stops it, the messages are kept for the next round.
  async conversation(msgs) {
    const c = await this.config(), tg = telegram(c, id => this.trackSent(id));
    await this.keepMenuFresh(c, tg);
    const controller = new AbortController();
    this.current = controller;
    const stopTyping = tg.busy();
    try {
      await this.chat(c, tg, msgs, controller.signal);
      this.carry = []; this.earlier = [];
    } catch (e) {
      if (e instanceof Interrupted) { this.carry = msgs; this.earlier = e.done; return; }
      this.carry = []; this.earlier = [];
      console.error(e);
      await tg.send(`⚠️ ${words(c).error} ${esc(e.message || String(e))}`);
      await this.logError('message', e);
    } finally { this.current = null; stopTyping(); }
  }

  async chat(c, tg, msgs, stop) {
    // Without an AI key the bot still works as a quick inbox: each message becomes a task.
    if (!c.ai.key) {
      const texts = msgs.map(m => clean(m.text || m.caption)).filter(Boolean);
      if (!texts.length || !c.gist.token) return;
      const d = await openDashboard(c);
      for (const t of texts) addItem(d.s, { title: t, boardId: inbox(d.s).id });
      await d.save();
      return tg.send(`${words(c).noAi} ${esc(texts.join(' · '))}`);
    }
    await converse(c, tg, this.state, msgs, { stop, earlier: this.earlier });
  }

  // Speed: ⚡ fast (low) or 🧠 full power (the default: AI_REASONING, or high).
  config = async () => config(this.env, await this.state.get('model'), (await this.state.get('think')) === 'low' ? 'low' : null);

  async handle(u) {
    const c = await this.config(), tg = telegram(c, id => this.trackSent(id));
    await this.keepMenuFresh(c, tg);
    try {
      if (u.message) await this.message(c, tg, u.message);
      else if (u.callback_query) await this.button(c, tg, u.callback_query);
    } catch (e) {
      console.error(e);
      await tg.send(`⚠️ ${words(c).error} ${esc(e.message || String(e))}`);
      await this.logError(u.message ? 'message' : 'button', e);
    }
  }

  // Remember recent bot message IDs so /clean can delete them (Telegram allows up to 48 hours).
  async trackSent(id) {
    if (!id) return;
    const cutoff = Date.now() - 47.5 * 3600e3;
    const list = ((await this.state.get('sent')) || []).filter(x => x.at > cutoff);
    if (!list.some(x => x.id === id)) list.push({ id, at: Date.now() });
    await this.state.put('sent', list.slice(-500));
  }

  async cleanChat(c, tg) {
    const w = words(c), cutoff = Date.now() - 47.5 * 3600e3;
    const ids = [...new Set(((await this.state.get('sent')) || []).filter(x => x.at > cutoff).map(x => x.id))];
    let n = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      if ((await tg.delMany(chunk)).ok) n += chunk.length;
    }
    await this.state.put('sent', []);
    return tg.send(n ? w.cleaned(n) : w.cleanEmpty);
  }

  // When a new version changes the command menu, update it in Telegram (no need to open /setup again).
  async keepMenuFresh(c, tg) {
    const menu = JSON.stringify(commands(c));
    if ((await this.state.get('menu')) === menu) return;
    const r = await tg.api('setMyCommands', { commands: commands(c) });
    if (r.ok) await this.state.put('menu', menu);
  }

  async logError(where, e) {
    const list = (await this.state.get('errors')) || [];
    list.push({ at: Date.now(), where, message: String(e.stack || e.message || e).slice(0, 800) });
    await this.state.put('errors', list.slice(-15));
  }

  /* ---------- messages and commands ---------- */
  async message(c, tg, m) {
    const w = words(c), text = clean(m.text || m.caption);
    const cmd = commandOf(m);
    const arg = cmd ? text.replace(/^\/\S+\s*/, '') : '';

    switch (cmd) {
      case 'start': case 'help': return tg.send(w.help);
      case 'new': await this.state.put('chat', []); return tg.send(w.newChat);
      case 'clean': return this.cleanChat(c, tg);
      case 'img': case 'image': {
        if (!arg) return tg.send(w.imgHow);
        const stop = tg.busy('upload_photo');
        try { return await tg.sendPhoto(await makeImage(c, arg)); } finally { stop(); }
      }
      case 'memory': {
        const mem = (await this.state.get('memory')) || [];
        if (!mem.length) return tg.send(w.memoryEmpty);
        return tg.send(`${w.memoryTitle}\n\n${mem.map(x => `• ${esc(x.text)}`).join('\n')}`, { reply_markup: { inline_keyboard: [[{ text: w.memoryClear, callback_data: 'mem:clear' }]] } });
      }
      case 'today': case 'list': {
        const s = (await openDashboard(c)).s, v = cmd === 'today' ? todayView(c, s) : listView(c, s);
        return tg.send(v.msg, doneButtons(v.tasks));
      }
      case 'status': {
        const errors = (await this.state.get('errors')) || [];
        return tg.send(await this.status(c), errors.length ? { reply_markup: { inline_keyboard: [[{ text: w.clearProblems, callback_data: 'errors:clear' }]] } } : {});
      }
      case 'model': {
        if (arg) { await this.state.put('model', { model: arg, url: c.ai.url }); return tg.send(w.modelSet(esc(arg))); }
        return tg.send(c.models.length < 2 ? w.modelOnlyOne(esc(c.ai.model)) : w.modelTitle(esc(c.ai.model)), { reply_markup: { inline_keyboard: [
          ...(c.models.length < 2 ? [] : c.models.map((m, i) => [{
            text: `${m.model === c.ai.model && m.url === c.ai.url ? '● ' : ''}${m.model}${new Set(c.models.map(x => x.url)).size > 1 ? '  · ' + new URL(m.url).hostname : ''}`.slice(0, 60),
            callback_data: `model:${i}`,
          }])),
          // speed: how long the model thinks before it starts writing
          [['low', w.fast], ['full', w.deep]].map(([v, label]) => ({ text: ((c.ai.reasoning === 'low') === (v === 'low') ? '● ' : '') + label, callback_data: `think:${v}` })),
        ] } });
      }
    }

    return this.conversation([m]); // anything else is for the conversation
  }

  async status(c) {
    const ok = (good, text) => `${good ? '✓' : '✗'} ${text}`;
    let dash;
    try { const s = (await openDashboard(c)).s; dash = ok(true, `Dashboard: ${live(s.pages).length} pages, ${live(s.boards).length} boards, ${openTasks(s).length} open tasks`); }
    catch (e) { dash = ok(false, `Dashboard: ${esc(e.message)}`); }
    const mem = (await this.state.get('memory')) || [], errors = (await this.state.get('errors')) || []; // only problems from the last 3 hours are shown
    return [
      '<b>Status</b>', ok(true, 'Telegram'), esc(await checkAI(c)), dash,
      ok(true, `Web search: ${esc(searchService(c))}`),
      ok(true, `Pictures: ${c.image ? esc(c.image.model) : 'free service (Pollinations)'}`),
      ok(true, `Voice: ${c.stt ? esc(c.stt.model) : 'straight to the model'}`),
      ok(!!c.repo, c.repo ? `GitHub: can edit ${esc(c.repo.name)}` : 'GitHub: not connected (GITHUB_REPO_TOKEN)'),
      ok(true, `Memory: ${mem.length} facts`),
      errors.length && Date.now() - errors.at(-1).at < 3 * 3600e3 ? `\nLast problem (${new Date(errors.at(-1).at).toISOString().slice(0, 16).replace('T', ' ')} UTC): <code>${esc(errors.at(-1).message.slice(0, 400))}</code>` : '',
    ].join('\n');
  }

  /* ---------- buttons ---------- */
  async button(c, tg, q) {
    const [kind, act, id] = (q.data || '').split(':');
    if (kind === 'errors') { await this.state.put('errors', []); await tg.answerButton(q.id, '✓'); if (q.message) await tg.buttons(q.message.message_id, []); return; }
    if (kind === 'mem') { await this.state.put('memory', []); await tg.answerButton(q.id); if (q.message) await tg.edit(q.message.message_id, words(c).memoryCleared); return; }
    if (kind === 'dev') return this.devButton(c, tg, q, act, id);
    if (kind === 'think') {
      await this.state.put('think', act);
      const label = act === 'low' ? words(c).fast : words(c).deep;
      await tg.answerButton(q.id, label);
      if (q.message) await tg.edit(q.message.message_id, words(c).thinkSet(label));
      return;
    }
    if (kind === 'model') {
      const m = c.models[+act];
      if (!m) return tg.answerButton(q.id, '?');
      await this.state.put('model', { model: m.model, url: m.url });
      await tg.answerButton(q.id, '✓ ' + m.model);
      if (q.message) await tg.edit(q.message.message_id, words(c).modelSet(esc(m.model)));
      return;
    }
    return taskButton(c, tg, q, kind, act); // done:/snooze:/tmr:<task id>
  }

  // ✅ Apply / ✖ Cancel / ↩️ Undo for changes to the bot's own code.
  async devButton(c, tg, q, act, id) {
    const p = await this.state.get('proposal');
    const clear = () => q.message && tg.buttons(q.message.message_id, []);
    if (!c.repo) return tg.answerButton(q.id, 'GitHub is not connected.');
    if (act === 'cancel') { if (p?.id === id) await this.state.delete('proposal'); await clear(); return tg.answerButton(q.id, '✖'); }
    if (act === 'apply') {
      if (!p || p.id !== id) { await clear(); return tg.answerButton(q.id, 'This proposal is no longer available.'); }
      await tg.answerButton(q.id, '…');
      const done = await applyProposal(c, p);
      await this.state.delete('proposal');
      await this.state.put('pendingBuild', { sha: done.sha, at: Date.now() });
      await clear();
      return tg.send(`✅ Applied: <a href="${done.url}">${done.sha.slice(0, 7)}</a>\nCloudflare is building the new version (about a minute). I'll tell you when it's live.`,
        { reply_markup: { inline_keyboard: [[{ text: '↩️ Undo', callback_data: `dev:undo:${done.sha}` }]] } });
    }
    if (act === 'undo') {
      await tg.answerButton(q.id, '…');
      const done = await undoCommit(c, id);
      await this.state.put('pendingBuild', { sha: done.sha, at: Date.now() });
      await clear();
      return tg.send(`↩️ Undone (${done.sha.slice(0, 7)}). Cloudflare is building the previous version again.`);
    }
  }

  /* ---------- every 5 minutes ---------- */
  async tick() {
    const c = await this.config(), tg = telegram(c, id => this.trackSent(id));
    try { await planTick(c, tg, this.state); } catch (e) { await this.logError('reminders', e); }
    // Tell the user when a change to the bot's code is live (or failed to build).
    const pending = await this.state.get('pendingBuild');
    if (pending && c.repo) {
      try {
        const r = await buildResult(c, pending.sha);
        if (r) {
          await tg.send(r.ok ? '🚀 The new version is live.' : `❌ Cloudflare could not build the new version, so the old one keeps running.\n<code>${esc(r.text)}</code>${r.url ? `\n<a href="${r.url}">Details</a>` : ''}\nAsk me to fix it, or press Undo.`);
          await this.state.delete('pendingBuild');
        } else if (Date.now() - pending.at > 30 * 60000) await this.state.delete('pendingBuild');
      } catch (e) { await this.logError('build check', e); }
    }
  }
}
