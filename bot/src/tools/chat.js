/* Deleting messages in this Telegram chat (yours and the bot's), on the user's request. */
import { pick, remove } from '../chatlog.js';

const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });

export function chatTools(ctx) {
  return [{
    name: 'delete_messages',
    description: 'Delete messages in this Telegram chat when the user asks (e.g. "delete the last 10 messages", "clear today’s chat", '
      + '"delete your messages", or replying to a message with "delete this"). Telegram only allows messages from the last 48 hours. '
      + 'Your own reply to this request is sent after, so it stays.',
    input_schema: obj({
      which: { type: 'string', enum: ['replied', 'last', 'recent', 'all'], description:
        'replied: the message the user replied to; last: the newest `count` messages; recent: the last `minutes`; all: everything from the last 48 hours.' },
      count: { type: 'integer', description: 'For last: how many messages (not counting this request).' },
      minutes: { type: 'integer', description: 'For recent: how far back, in minutes.' },
      who: { type: 'string', enum: ['all', 'bot', 'user'], description: 'Whose messages: both (default), only yours (bot), or only the user’s.' },
      include_request: { type: 'boolean', description: 'Also delete the user’s message asking for this. Default true.' },
    }, ['which']),
    run: async ({ which, count, minutes, who = 'all', include_request = true }) => {
      const request = ctx.msgs.map(m => m.message_id);
      let ids;
      if (which === 'replied') {
        const target = ctx.msgs.map(m => m.reply_to_message?.message_id).filter(Boolean);
        if (!target.length) return 'The user did not reply to a message. Ask which messages to delete.';
        ids = target;
      } else {
        const all = await pick(ctx.state, { who, minutes: which === 'recent' ? minutes || 60 : undefined });
        const older = all.filter(id => !request.includes(id));
        ids = which === 'last' ? older.slice(-(count || 1)) : older;
      }
      if (include_request) ids = ids.concat(request);
      if (!ids.length) return 'No messages to delete in that range (only the last 48 hours can be deleted).';
      const n = await ctx.deleteMessages(ids);
      return `Deleted ${n} message(s). Reply with one short line.`;
    },
  }];
}
