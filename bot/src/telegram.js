/* Talking to Telegram: messages, live-growing answers, photos, files, "typing…". */
import { mdToHtml, splitMd } from './format.js';

export const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// Keep Latin dates and times left-to-right inside Farsi text.
export const ltr = x => `⁦${x}⁩`;

export function telegram(c, onSent) {
  const api = (method, body) => fetch(`https://api.telegram.org/bot${c.telegramToken}/${method}`, {
    method: 'POST', ...(body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }).then(r => r.json()).catch(e => ({ ok: false, description: e.message }));
  const chat_id = c.chatId;
  const plain = html => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  const t = {
    api,
    async send(html, extra = {}) {
      const body = { chat_id, text: html.slice(0, 4096), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra };
      let r = await api('sendMessage', body);
      if (!r.ok) { delete body.parse_mode; body.text = plain(html).slice(0, 4096); r = await api('sendMessage', body); } // bad HTML: send as plain text
      if (r.ok && r.result?.message_id) await onSent?.(r.result.message_id);
      return r;
    },
    async edit(id, html, extra = {}) {
      const r = await api('editMessageText', { chat_id, message_id: id, text: html.slice(0, 4096), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
      if (r.ok || /not modified/.test(r.description || '')) return r;
      return api('editMessageText', { chat_id, message_id: id, text: plain(html).slice(0, 4096), ...extra });
    },
    del: id => api('deleteMessage', { chat_id, message_id: id }),
    delMany: ids => api('deleteMessages', { chat_id, message_ids: ids }),
    buttons: (id, rows) => api('editMessageReplyMarkup', { chat_id, message_id: id, reply_markup: { inline_keyboard: rows } }),
    answerButton: (id, text = '') => api('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 190) }),
    action: (action = 'typing') => api('sendChatAction', { chat_id, action }),

    // Keep "typing…" showing while work goes on. Returns a function that stops it.
    busy(action = 'typing') {
      t.action(action);
      const timer = setInterval(() => t.action(action), 4500);
      return () => clearInterval(timer);
    },

    async sendPhoto(img, caption) {
      let r;
      if (img.url) r = await api('sendPhoto', { chat_id, photo: img.url, ...(caption && { caption }) });
      else {
        const make = field => {
          const f = new FormData();
          f.append('chat_id', chat_id);
          f.append(field, new Blob([img.bytes], { type: img.type }), 'image.' + (img.type.split('/')[1] || 'jpg'));
          if (caption) f.append('caption', caption.slice(0, 1000));
          return f;
        };
        r = await api('sendPhoto', make('photo'));
        if (!r.ok) r = await api('sendDocument', make('document')); // too big for a photo: send as a file
      }
      if (r.ok && r.result?.message_id) await onSent?.(r.result.message_id);
      return r;
    },

    async download(fileId) {
      const f = await api('getFile', { file_id: fileId });
      if (!f.ok) throw new Error('Telegram does not let bots download files over 20 MB. Send a smaller file, or split it.');
      const r = await fetch(`https://api.telegram.org/file/bot${c.telegramToken}/${f.result.file_path}`);
      return { bytes: new Uint8Array(await r.arrayBuffer()), path: f.result.file_path };
    },

    // An answer that appears as it is written: one message that grows (edited about once a second),
    // continued in new messages when longer than Telegram allows.
    live() {
      const ids = [], shown = [];
      let text = '', last = 0, timer = null, chain = Promise.resolve();
      const flush = async final => {
        last = Date.now();
        const chunks = splitMd(text);
        for (let i = 0; i < chunks.length; i++) {
          const html = mdToHtml(chunks[i]) + (!final && i === chunks.length - 1 ? ' ▍' : '');
          if (shown[i] === html || !html.trim()) continue;
          if (ids[i]) await t.edit(ids[i], html);
          else ids[i] = (await t.send(html))?.result?.message_id;
          shown[i] = html;
        }
      };
      return {
        update(next) {
          text = next;
          if (!timer) timer = setTimeout(() => { timer = null; chain = chain.then(() => flush(false)); }, Math.max(0, 900 - (Date.now() - last)));
        },
        async finish(final) {
          clearTimeout(timer); timer = null;
          await chain;
          if (final !== undefined) text = final;
          if (text.trim()) await flush(true);
        },
      };
    },
  };
  return t;
}
