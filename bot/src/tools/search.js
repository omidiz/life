/* Web search. Uses the first search service that has a key in Cloudflare:
     TAVILY_API_KEY (tavily.com, built for AI, 1000 free searches a month)
     BRAVE_API_KEY  (api.search.brave.com)
     SERPER_API_KEY (serper.dev, Google results)
   Without a key: DuckDuckGo's simple page (free, but it sometimes refuses Cloudflare), then Wikipedia.
   The AI reads the results and, for details, opens pages with read_webpage. */

const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const clean = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const timeout = () => AbortSignal.timeout(20000);
const UA = 'LifeBot/1.0 (https://workers.dev; personal Telegram assistant)'; // Wikipedia asks bots to say who they are

export const searchService = c => (c.search.tavily ? 'Tavily' : c.search.brave ? 'Brave' : c.search.serper ? 'Serper (Google)' : 'free (DuckDuckGo / Wikipedia, limited)');

async function tavily(c, q, recent, n) {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal: timeout(),
    headers: { Authorization: `Bearer ${c.search.tavily}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, max_results: n, include_answer: true, search_depth: 'advanced', ...(recent && { topic: 'news', days: 14 }) }),
  });
  if (!r.ok) throw new Error(`Tavily error ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return { answer: d.answer, results: (d.results || []).map(x => ({ title: x.title, url: x.url, text: x.content, date: x.published_date })) };
}

async function brave(c, q, recent, n) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}${recent ? '&freshness=pw' : ''}`, {
    signal: timeout(), headers: { 'X-Subscription-Token': c.search.brave, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Brave error ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return { results: (d.web?.results || []).map(x => ({ title: clean(x.title), url: x.url, text: clean(x.description), date: x.age })) };
}

async function serper(c, q, recent, n) {
  const r = await fetch('https://google.serper.dev/search', {
    method: 'POST', signal: timeout(),
    headers: { 'X-API-KEY': c.search.serper, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num: n, ...(recent && { tbs: 'qdr:w' }) }),
  });
  if (!r.ok) throw new Error(`Serper error ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  return { answer: d.answerBox?.answer || d.answerBox?.snippet, results: (d.organic || []).map(x => ({ title: x.title, url: x.link, text: x.snippet, date: x.date })) };
}

// DuckDuckGo's plain HTML page: result links go through //duckduckgo.com/l/?uddg=<real address>.
export function parseDuckDuckGo(html) {
  const results = [], re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|(?=<a[^>]*class="result__a"|$))/g;
  let m;
  while ((m = re.exec(html)) && results.length < 10) {
    let url = m[1].replace(/&amp;/g, '&');
    const real = url.match(/[?&]uddg=([^&]+)/);
    if (real) url = decodeURIComponent(real[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    results.push({ title: clean(m[2]), url, text: clean(m[3]) });
  }
  return results;
}
async function duckduckgo(q) {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST', signal: timeout(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (compatible; LifeBot/1.0)' },
    body: 'q=' + encodeURIComponent(q),
  });
  if (!r.ok) throw new Error(`DuckDuckGo ${r.status}`);
  const results = parseDuckDuckGo(await r.text());
  if (!results.length) throw new Error('DuckDuckGo gave no results (it may be refusing this server)');
  return { results };
}

async function wikipedia(q) {
  const lang = /[؀-ۿ]/.test(q) ? 'fa' : 'en';
  const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=6&srsearch=${encodeURIComponent(q)}`, {
    signal: timeout(), headers: { 'User-Agent': UA, 'Api-User-Agent': UA },
  });
  if (!r.ok) throw new Error(`Wikipedia ${r.status}`);
  const d = await r.json();
  return { note: 'Only Wikipedia was searched (no web search key is set), so this may miss news and recent events.',
    results: (d.query?.search || []).map(x => ({ title: x.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`, text: clean(x.snippet) })) };
}

export async function webSearch(c, q, { recent = false, count = 8 } = {}) {
  const n = Math.max(3, Math.min(10, count || 8));
  if (c.search.tavily) return tavily(c, q, recent, n);
  if (c.search.brave) return brave(c, q, recent, n);
  if (c.search.serper) return serper(c, q, recent, n);
  try { return await duckduckgo(q); } catch (e) { console.log('duckduckgo:', e.message); }
  return wikipedia(q);
}

export function searchTools(ctx) {
  return [{
    name: 'web_search',
    description: 'Search the web. Use it for anything current or that you are not sure of: news, prices, exchange rates, '
      + 'weather, sports, releases, schedules, people, places, products, "latest"/"today" questions, and facts to check. '
      + 'Search in the language that will find the best sources (often English), and search again with other words if needed. '
      + 'For details, open the best results with read_webpage.',
    input_schema: obj({
      query: { type: 'string' },
      recent: { type: 'boolean', description: 'Only recent results (news, last days/weeks).' },
      count: { type: 'integer', description: 'How many results, 3–10 (default 8).' },
    }, ['query']),
    run: async ({ query, recent, count }) => {
      const r = await webSearch(ctx.c, String(query), { recent, count });
      if (!r.results.length && !r.answer) return 'No results. Try other words, or English.';
      return [r.note, r.answer && `Short answer: ${r.answer}`,
        ...r.results.map((x, i) => `${i + 1}. ${x.title}${x.date ? ` (${x.date})` : ''}\n   ${x.url}\n   ${(x.text || '').slice(0, 600)}`)].filter(Boolean).join('\n');
    },
  }];
}
