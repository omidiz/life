/* Life bot — your personal AI assistant in Telegram, connected to your Life dashboard.
   Runs on Cloudflare Workers. This file is only the front door:
   - /telegram  Telegram delivers messages here; they go to the bot's room (room.js), which answers them.
   - /setup     one-time: connects Telegram to this address and sets the command menu.
   - every 5 minutes (cron): reminders, morning brief, evening review — also in the room.
   Settings: config.js. The assistant itself: assistant.js. */
import { config } from './config.js';
import { telegram } from './telegram.js';
import { commands } from './i18n.js';
export { ChatRoom } from './room.js';

const room = env => env.ROOM.get(env.ROOM.idFromName('chat'));

export default {
  async fetch(req, env) {
    const url = new URL(req.url), c = config(env);

    if (url.pathname === '/setup') {
      if (!c.webhookSecret || url.searchParams.get('secret') !== c.webhookSecret) return new Response('Wrong secret', { status: 403 });
      const tg = telegram(c);
      const hook = await tg.api('setWebhook', { url: `${url.origin}/telegram`, secret_token: c.webhookSecret, allowed_updates: ['message', 'callback_query'] });
      const menu = await tg.api('setMyCommands', { commands: commands(c) });
      return Response.json({ webhook: hook, menu });
    }

    if (url.pathname !== '/telegram' || req.method !== 'POST') return new Response('Life bot is running.');
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== c.webhookSecret) return new Response('Forbidden', { status: 403 });

    const u = await req.json();
    const chat = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
    if (!c.chatId || String(chat) !== String(c.chatId)) { // a personal bot: others only learn their chat id
      if (u.message) await telegram({ ...c, chatId: chat }).api('sendMessage', { chat_id: chat, text: `This is a private bot. Your chat id is ${chat}` });
      return new Response('ok');
    }
    await room(env).fetch('https://room/update', { method: 'POST', body: JSON.stringify(u) });
    return new Response('ok');
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(room(env).fetch('https://room/tick', { method: 'POST' }));
  },
};
