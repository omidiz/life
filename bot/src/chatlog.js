/* The messages in the chat (yours and the bot's) from the last 48 hours, so they can be deleted on request.
   Telegram lets a bot delete both sides of a private chat, but only messages under 48 hours old. */
const WINDOW = 47.5 * 3600e3;

export async function record(state, id, who, at = Date.now()) {
  if (!id) return;
  const list = ((await state.get('sent')) || []).filter(x => x.at > Date.now() - WINDOW);
  if (!list.some(x => x.id === id)) list.push({ id, at, who });
  await state.put('sent', list.slice(-1000));
}

// Which messages: the newest `count`, those from the last `minutes`, from 'bot', 'user' or 'all'; or exactly `ids`.
export async function pick(state, { count, minutes, who = 'all', ids } = {}) {
  let list = ((await state.get('sent')) || []).filter(x => x.at > Date.now() - WINDOW).sort((a, b) => a.id - b.id);
  if (ids) return list.filter(x => ids.includes(x.id)).map(x => x.id).concat(ids.filter(id => !list.some(x => x.id === id)));
  if (who !== 'all') list = list.filter(x => (x.who || 'bot') === who);
  if (minutes) list = list.filter(x => x.at > Date.now() - minutes * 60000);
  if (count) list = list.slice(-count);
  return list.map(x => x.id);
}

// Delete them (100 at a time, as Telegram allows) and forget them. Returns how many were deleted.
export async function remove(tg, state, ids) {
  ids = [...new Set(ids)];
  let n = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    if ((await tg.delMany(chunk)).ok) n += chunk.length;
  }
  const gone = new Set(ids);
  await state.put('sent', ((await state.get('sent')) || []).filter(x => !gone.has(x.id)));
  return n;
}
