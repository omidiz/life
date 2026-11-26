/* General tools: making pictures, reading web pages, and long-term memory about the user. */
import { makeImage } from '../ai.js';

const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });

export function generalTools(ctx) {
  return [
    {
      name: 'make_image',
      description: 'Make a picture from a description and send it to the user.',
      input_schema: obj({
        prompt: { type: 'string', description: 'Detailed description of the picture, in English (subject, style, lighting, colours, composition).' },
        shape: { type: 'string', enum: ['square', 'portrait', 'landscape'], description: 'Default square. Portrait for phone wallpapers/posters, landscape for banners/desktop.' },
      }, ['prompt']),
      run: async ({ prompt, shape }) => ({ image: await makeImage(ctx.c, String(prompt), shape), text: 'Done: the picture is sent to the user with your reply.' }),
    },
    {
      name: 'read_webpage',
      description: 'Read the text of a web page (a link the user sent, or a page you know the address of).',
      input_schema: obj({ url: { type: 'string' } }, ['url']),
      run: async ({ url }) => {
        if (!/^https?:\/\//i.test(url)) return 'Only http(s) links can be read.';
        const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LifeBot/1.0)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' } });
        if (!r.ok) return `The page answered with error ${r.status}.`;
        const type = r.headers.get('content-type') || '';
        if (!/text|json|xml/.test(type)) return `This link is not a text page (${type}).`;
        const html = await r.text();
        const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
        const text = html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n').replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
        return `${title ? `Title: ${title}\n\n` : ''}${text.slice(0, 60000)}${text.length > 60000 ? '\n…(cut)' : ''}`;
      },
    },
    {
      name: 'remember',
      description: 'Save a lasting fact about the user or a preference for how to answer (e.g. their name, job, studies, '
        + 'family, goals, likes, "answer shortly"). Use it when the user tells you something worth knowing in future conversations, '
        + 'or asks you to remember something. Not for tasks or reminders (those go on the dashboard).',
      input_schema: obj({ fact: { type: 'string', description: 'One short sentence.' } }, ['fact']),
      run: async ({ fact }) => {
        const list = (await ctx.state.get('memory')) || [];
        list.push({ id: Math.random().toString(36).slice(2, 7), text: String(fact).trim(), at: Date.now() });
        await ctx.state.put('memory', list.slice(-100));
        return 'Saved.';
      },
    },
    {
      name: 'forget',
      description: 'Remove saved facts that are wrong or that the user wants forgotten. Give the exact ids from the memory list.',
      input_schema: obj({ ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
      run: async ({ ids }) => {
        const list = (await ctx.state.get('memory')) || [], drop = new Set([].concat(ids));
        await ctx.state.put('memory', list.filter(m => !drop.has(m.id)));
        return `Removed ${list.length - list.filter(m => !drop.has(m.id)).length}.`;
      },
    },
  ];
}
