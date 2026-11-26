/* The connection to the AI service: any OpenAI-compatible API (9Router, NVIDIA, OpenRouter, Gemini, OpenAI…).
   runAgent() is the heart of the bot: it streams the model's answer, runs the tools the model asks for,
   and loops until the model has answered. */

const TOO_SLOW = 'The AI service is too slow right now. Try again, or choose a faster model (AI_MODEL).';

async function post(url, key, body, ms) {
  if (ms < 1000) throw new Error(TOO_SLOW);
  try {
    return await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(ms),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error(TOO_SLOW);
    throw new Error(`Could not reach the AI service: ${e.message}`);
  }
}

const hideThinking = s => s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

// Read an answer, streamed (server-sent events, passed to onText as it grows) or all at once.
async function readReply(r, onText) {
  if (!(r.headers.get('content-type') || '').includes('event-stream')) {
    const msg = (await r.json()).choices?.[0]?.message;
    if (!msg) throw new Error('The AI service sent an empty answer.');
    return msg;
  }
  const reader = r.body.getReader(), dec = new TextDecoder();
  const msg = { content: '', tool_calls: [], images: [] };
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.error) throw new Error(`AI service error: ${ev.error.message || JSON.stringify(ev.error).slice(0, 200)}`);
      const d = ev.choices?.[0]?.delta || ev.choices?.[0]?.message || {};
      if (typeof d.content === 'string' && d.content) { msg.content += d.content; onText(hideThinking(msg.content)); }
      for (const im of d.images || []) msg.images.push(im);
      for (const tc of d.tool_calls || []) {
        const cur = msg.tool_calls[tc.index ?? msg.tool_calls.length] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
      }
    }
  }
  msg.tool_calls = msg.tool_calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return msg;
}

// Pictures a model drew itself come back with its answer.
function picturesIn(msg) {
  const list = [...(msg.images || []), ...(Array.isArray(msg.content) ? msg.content.filter(c => c.type === 'image_url') : [])];
  return list.map(im => {
    const u = im.image_url?.url || im.url, m = u?.match(/^data:([^;]+);base64,(.+)$/);
    return m ? { bytes: Uint8Array.from(atob(m[2]), ch => ch.charCodeAt(0)), type: m[1] } : u ? { url: u } : null;
  }).filter(Boolean);
}

const parseArgs = a => (typeof a === 'string' ? JSON.parse(a || '{}') : a || {});

/* Run one turn of the conversation.
   tools: [{ name, description, input_schema, run(args) }]
   refused: settings this service said no to, per model (kept by the caller between turns)
   Returns { text, images }. */
export async function runAgent(c, { messages, tools, onText = () => {}, refused = {}, onToolError = () => {} }) {
  const { url, model, key } = c.ai;
  const defs = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  // Full strength by default: deep thinking and long answers, streamed. Anything refused is dropped and remembered.
  const extras = { stream: true, max_tokens: c.ai.maxTokens, ...(c.ai.reasoning && { reasoning_effort: c.ai.reasoning }) };
  for (const k of refused[model] || []) delete extras[k];
  const deadline = Date.now() + 12 * 60000, images = [];
  let shown = ''; // everything the user has seen, across tool rounds

  for (let round = 0; round < 30; round++) {
    const r = await post(url, key, { model, messages, ...(defs.length && { tools: defs, tool_choice: 'auto' }), ...extras, stream: !!extras.stream }, deadline - Date.now());
    if (r.status === 400 && Object.keys(extras).length) {
      const body = (await r.text()).toLowerCase(), keys = Object.keys(extras);
      const k = keys.find(k => body.includes(k)) || (keys.includes('reasoning_effort') ? 'reasoning_effort' : keys.find(k => k !== 'stream') || keys[0]);
      delete extras[k];
      refused[model] = [...new Set([...(refused[model] || []), k])];
      round--; continue;
    }
    if (r.status === 400) throw new Error(`The AI service refused the request: ${(await r.text()).slice(0, 300)}`);
    if (r.status === 401 || r.status === 403) throw new Error('The AI service rejected the key (AI_API_KEY).');
    if (r.status === 404) throw new Error(`The AI service doesn't know this address or model (AI_URL / AI_MODEL: ${model}).`);
    if (r.status === 429) throw new Error('The AI service is busy (rate limit). Try again in a minute.');
    if (!r.ok) throw new Error(`AI service error ${r.status}: ${(await r.text()).slice(0, 200)}`);

    const before = shown ? shown + '\n\n' : '';
    const msg = await readReply(r, text => onText(before + text));
    images.push(...picturesIn(msg));
    const content = Array.isArray(msg.content) ? msg.content.filter(x => x.type === 'text').map(x => x.text).join('\n') : msg.content || '';
    if (hideThinking(content)) shown = before + hideThinking(content);
    const calls = msg.tool_calls || [];
    if (!calls.length) return { text: shown, images };

    messages.push({ role: 'assistant', content, tool_calls: calls });
    for (const call of calls) {
      const tool = tools.find(t => t.name === call.function?.name);
      let result;
      try {
        result = tool ? await tool.run(parseArgs(call.function.arguments)) : `Unknown tool ${call.function?.name}`;
      } catch (e) {
        result = `Error: ${e.message}. Check the inputs and try again.`;
        onToolError(call.function?.name, e, call.function?.arguments);
      }
      if (result && typeof result === 'object' && result.image) { images.push(result.image); result = result.text; }
      console.log('tool', call.function?.name, String(call.function?.arguments).slice(0, 300), '→', String(result).slice(0, 300));
      messages.push({ role: 'tool', tool_call_id: call.id, content: String(result) });
    }
  }
  return { text: shown || 'Sorry, that took too many steps. Please try again in simpler words.', images };
}

// For /status: one tiny request, with how long it took or what went wrong.
export async function checkAI(c) {
  if (!c.ai.key) return '✗ AI: no AI_API_KEY';
  const t0 = Date.now();
  try {
    const r = await post(c.ai.url, c.ai.key, { model: c.ai.model, messages: [{ role: 'user', content: 'Reply with just: ok' }], max_tokens: 200, stream: false }, 25000);
    if (!r.ok) return `✗ AI (${c.ai.model}): error ${r.status} — ${(await r.text()).slice(0, 300).replace(/[<>&]/g, '')}`;
    return `✓ AI (${c.ai.model}): answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  } catch (e) { return `✗ AI (${c.ai.model}): ${e.message}`; }
}

/* ---------- pictures and voice ---------- */
const SIZES = { square: [1024, 1024], portrait: [832, 1216], landscape: [1216, 832] };

export async function makeImage(c, prompt, shape = 'square') {
  const [w, h] = SIZES[shape] || SIZES.square;
  if (c.image) {
    const r = await fetch(c.image.url, {
      method: 'POST', signal: AbortSignal.timeout(120000),
      headers: { Authorization: `Bearer ${c.image.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.image.model, prompt, n: 1, size: `${w}x${h}` }),
    });
    if (!r.ok) throw new Error(`image service error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = (await r.json()).data?.[0];
    if (d?.b64_json) return { bytes: Uint8Array.from(atob(d.b64_json), ch => ch.charCodeAt(0)), type: 'image/png' };
    if (d?.url) return fetchImage(d.url);
    throw new Error('the image service sent no picture');
  }
  // Free fallback: Pollinations (no key; adds a small watermark).
  return fetchImage(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 1e9)}`);
}
async function fetchImage(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) throw new Error(`could not make the picture (${r.status})`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), type };
}

export async function transcribe(c, bytes, name = 'voice.ogg') {
  const form = new FormData();
  form.append('model', c.stt.model);
  form.append('file', new Blob([bytes], { type: 'audio/ogg' }), name);
  const r = await fetch(c.stt.url, { method: 'POST', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${c.stt.key}` }, body: form });
  if (!r.ok) throw new Error(`voice service error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()).text || '').trim();
}
