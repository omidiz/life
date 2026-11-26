/* Making pictures and hearing voice messages.
   Pictures: with IMAGE_MODEL set, an OpenAI-compatible /images/generations API (e.g. 9Router);
   otherwise the free Pollinations service (no key; adds a small watermark).
   Voice: with STT_MODEL set, an OpenAI-compatible /audio/transcriptions API. */

const base = env => (env.AI_URL || 'https://integrate.api.nvidia.com/v1').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');

const SIZES = { square: [1024, 1024], portrait: [832, 1216], landscape: [1216, 832] };

export async function makeImage(env, prompt, shape = 'square') {
  const [w, h] = SIZES[shape] || SIZES.square;
  if (env.IMAGE_MODEL) {
    const r = await fetch(env.IMAGE_URL || base(env) + '/images/generations', {
      method: 'POST', signal: AbortSignal.timeout(50000),
      headers: { Authorization: `Bearer ${env.IMAGE_API_KEY || env.AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.IMAGE_MODEL, prompt, n: 1, size: `${w}x${h}` }),
    });
    if (!r.ok) throw new Error(`image service error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = (await r.json()).data?.[0];
    if (d?.b64_json) return { bytes: Uint8Array.from(atob(d.b64_json), c => c.charCodeAt(0)), type: 'image/png' };
    if (d?.url) return fetchImage(d.url);
    throw new Error('the image service sent no picture');
  }
  const seed = Math.floor(Math.random() * 1e9);
  return fetchImage(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?width=${w}&height=${h}&nologo=true&seed=${seed}`);
}

async function fetchImage(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(50000) });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) throw new Error(`could not make the picture (${r.status})`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), type };
}

export async function transcribe(env, bytes, name = 'voice.ogg') {
  const form = new FormData();
  form.append('model', env.STT_MODEL);
  form.append('file', new Blob([bytes], { type: 'audio/ogg' }), name);
  const r = await fetch(env.STT_URL || base(env) + '/audio/transcriptions', {
    method: 'POST', signal: AbortSignal.timeout(40000),
    headers: { Authorization: `Bearer ${env.STT_API_KEY || env.AI_API_KEY}` }, body: form,
  });
  if (!r.ok) throw new Error(`voice service error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()).text || '').trim();
}
