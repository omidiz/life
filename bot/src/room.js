/* The bot's "room": a Cloudflare Durable Object that receives every Telegram message and the 5-minute timer.
   - Messages are queued and answered one after another, each only once, with up to 15 minutes each.
   - It keeps the bot's own memory: the conversation, what it knows about you, reminders sent, and so on.
     (Your tasks stay in the dashboard's gist; the bot reads them only when needed.) */
import { config } from './config.js';
import { telegram, esc } from './telegram.js';
import { words, commands } from './i18n.js';
import { converse } from './assistant.js';
import { checkAI, makeImage } from './ai.js';
import { openDashboard, live, openTasks, inbox, addItem } from './dashboard.js';
import { todayView, listView, doneButtons, planTick, taskButton } from './planner.js';
import { proposalView, applyProposal, undoCommit, buildResult } from './tools/code.js';

export class ChatRoom {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.working = false;
    const store = ctx.storage;
    this.state = { get: k => store.get(k), put: (k, v) => store.put(k, v), delete: k => store.delete(k) };
  }

  async fetch(req) {
    const path = new URL(req.url).pathname, store = this.ctx.storage;
    if (path === '/tick') { await this.tick(); return new Response('ok'); }
    const u = await req.json(), key = 'u:' + String(u.update_id).padStart(15, '0');
    if (((await store.get('last')) ?? -1) >= u.update_id || (await store.get(key))) return new Response('seen'); // Telegram re-sent it
    await store.put(key, u);
    if (!this.working && !(await store.getAlarm())) await store.setAlarm(Date.now());
    return new Response('ok');
  }

  // Work through the queue, one message at a time.
  async alarm() {
    if (this.working) return;
    this.working = true;
    const store = this.ctx.storage;
    try {
      for (;;) {
        const next = [...(await store.list({ prefix: 'u:', limit: 1 })).entries()][0];
        if (!next) break;
        const [key, u] = next;
        await store.put('last', u.update_id);
        await store.delete(key);
        await this.handle(u);
      }
    } finally {
      this.working = false;
      if ((await store.list({ prefix: 'u:', limit: 1 })).size && !(await store.getAlarm())) await store.setAlarm(Date.now());
    }
  }

  config = async () => config(this.env, await this.state.get('model'));

  async handle(u) {
    const c = await this.config(), tg = telegram(c);
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
    // Invisible direction marks (often copied along with Farsi text) must not hide a command.
    const w = words(c), text = (m.text || m.caption || '').replace(/^[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/, '').trim();
    const cmd = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : null;
    const arg = cmd ? text.replace(/^\/\S+\s*/, '') : '';

    switch (cmd) {
      case 'start': case 'help': return tg.send(w.help);
      case 'new': await this.state.put('chat', []); return tg.send(w.newChat);
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
      case 'status': return tg.send(await this.status(c));
      case 'model': {
        if (arg) { await this.state.put('model', { model: arg, url: c.ai.url }); return tg.send(w.modelSet(esc(arg))); }
        if (c.models.length < 2) return tg.send(w.modelOnlyOne(esc(c.ai.model)));
        return tg.send(w.modelTitle(esc(c.ai.model)), { reply_markup: { inline_keyboard: c.models.map((m, i) => [{
          text: `${m.model === c.ai.model && m.url === c.ai.url ? '● ' : ''}${m.model}${new Set(c.models.map(x => x.url)).size > 1 ? '  · ' + new URL(m.url).hostname : ''}`.slice(0, 60),
          callback_data: `model:${i}`,
        }]) } });
      }
    }

    // Without an AI key the bot still works as a quick inbox: the message becomes a task.
    if (!c.ai.key) {
      if (!text || !c.gist.token) return;
      const d = await openDashboard(c), t = addItem(d.s, { title: text, boardId: inbox(d.s).id });
      await d.save();
      return tg.send(`${w.noAi} ${esc(t.title)}`);
    }

    const stop = tg.busy();
    try { await converse(c, tg, this.state, m, text); } finally { stop(); }
  }

  async status(c) {
    const ok = (good, text) => `${good ? '✓' : '✗'} ${text}`;
    let dash;
    try { const s = (await openDashboard(c)).s; dash = ok(true, `Dashboard: ${live(s.pages).length} pages, ${live(s.boards).length} boards, ${openTasks(s).length} open tasks`); }
    catch (e) { dash = ok(false, `Dashboard: ${esc(e.message)}`); }
    const mem = (await this.state.get('memory')) || [], errors = (await this.state.get('errors')) || [];
    return [
      '<b>Status</b>', ok(true, 'Telegram'), esc(await checkAI(c)), dash,
      ok(true, `Pictures: ${c.image ? esc(c.image.model) : 'free service (Pollinations)'}`),
      ok(true, `Voice: ${c.stt ? esc(c.stt.model) : 'straight to the model'}`),
      ok(!!c.repo, c.repo ? `GitHub: can edit ${esc(c.repo.name)}` : 'GitHub: not connected (GITHUB_REPO_TOKEN)'),
      ok(true, `Memory: ${mem.length} facts`),
      errors.length ? `\nLast problem (${new Date(errors.at(-1).at).toISOString().slice(0, 16).replace('T', ' ')} UTC): <code>${esc(errors.at(-1).message.slice(0, 400))}</code>` : '',
    ].join('\n');
  }

  /* ---------- buttons ---------- */
  async button(c, tg, q) {
    const [kind, act, id] = (q.data || '').split(':');
    if (kind === 'mem') { await this.state.put('memory', []); await tg.answerButton(q.id); if (q.message) await tg.edit(q.message.message_id, words(c).memoryCleared); return; }
    if (kind === 'dev') return this.devButton(c, tg, q, act, id);
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
    const c = await this.config(), tg = telegram(c);
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
