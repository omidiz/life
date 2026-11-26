/* The bot's "room": a Cloudflare Durable Object that receives every Telegram message and
   answers them one by one in the background, with up to 15 minutes per message
   (a normal Worker must finish in about 30 seconds). It also makes sure each message
   is answered only once, even if Telegram sends it again. */
import { handleUpdate } from './worker.js';

export class ChatRoom {
  constructor(state, env) { this.state = state; this.env = env; this.working = false; }

  async fetch(req) {
    const u = await req.json(), store = this.state.storage;
    const key = 'u:' + String(u.update_id).padStart(15, '0');
    if ((await store.get('last') ?? -1) >= u.update_id || await store.get(key)) return new Response('seen');
    await store.put(key, u);
    if (!this.working && !(await store.getAlarm())) await store.setAlarm(Date.now());
    return new Response('ok');
  }

  async alarm() {
    if (this.working) return;
    this.working = true;
    const store = this.state.storage;
    try {
      for (;;) {
        const next = [...(await store.list({ prefix: 'u:', limit: 1 })).entries()][0];
        if (!next) break;
        const [key, u] = next;
        await store.put('last', u.update_id);
        await store.delete(key);
        await handleUpdate(this.env, u);
      }
    } finally {
      this.working = false;
      // a message that arrived at the very end gets its own turn
      if ((await store.list({ prefix: 'u:', limit: 1 })).size && !(await store.getAlarm())) await store.setAlarm(Date.now());
    }
  }
}
