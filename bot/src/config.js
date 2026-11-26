/* Every setting in one place, with its default. Secrets and most settings live in Cloudflare
   (life-bot → Settings → Variables and Secrets); TZ, LANG, MORNING, EVENING and GITHUB_REPO in wrangler.toml. */
const fullUrl = u => { u = u.trim().replace(/\/+$/, ''); return /\/chat\/completions$/.test(u) ? u : u + '/chat/completions'; };

// All the AI models you can switch between with /model:
// - AI_MODEL (+ AI_URL, AI_API_KEY): the main one
// - AI_MODELS: more models on the same service, comma-separated (e.g. "gpt-5, gemini-3-pro")
// - AI2_MODEL (+ AI2_URL, AI2_API_KEY), AI3_…, up to AI9_: models on other services
//   (AIn_URL and AIn_API_KEY default to the main ones)
export function models(env) {
  const mainUrl = fullUrl(env.AI_URL || 'https://integrate.api.nvidia.com/v1');
  const list = [{ model: env.AI_MODEL || 'z-ai/glm-5.3-flash', url: mainUrl, key: env.AI_API_KEY }];
  for (const m of String(env.AI_MODELS || '').split(',').map(x => x.trim()).filter(Boolean)) list.push({ model: m, url: mainUrl, key: env.AI_API_KEY });
  for (let i = 2; i <= 9; i++) {
    if (env[`AI${i}_MODEL`]) list.push({ model: env[`AI${i}_MODEL`].trim(), url: env[`AI${i}_URL`] ? fullUrl(env[`AI${i}_URL`]) : mainUrl, key: env[`AI${i}_API_KEY`] || env.AI_API_KEY });
  }
  const seen = new Set();
  return list.filter(m => { const k = m.model + ' ' + m.url; if (seen.has(k)) return false; seen.add(k); return true; });
}

// pick: the model chosen with /model ({ model, url }), or nothing for the main one.
export function config(env, pick) {
  const aiUrl = (env.AI_URL || 'https://integrate.api.nvidia.com/v1').trim().replace(/\/+$/, '');
  const aiBase = aiUrl.replace(/\/chat\/completions$/, '');
  const all = models(env);
  const chosen = (pick && (all.find(m => m.model === pick.model && m.url === pick.url) || all.find(m => m.model === pick.model)
    || { model: pick.model, url: all[0].url, key: all[0].key })) || all[0];
  return {
    telegramToken: env.TELEGRAM_TOKEN,
    chatId: env.CHAT_ID,
    webhookSecret: env.WEBHOOK_SECRET,
    tz: env.TZ || 'Asia/Tehran',
    lang: env.LANG === 'en' ? 'en' : 'fa',
    morning: env.MORNING ?? '08:00', // "" turns it off
    evening: env.EVENING ?? '21:00',
    models: all,
    ai: {
      url: chosen.url,
      model: chosen.model,
      key: chosen.key,
      reasoning: env.AI_REASONING === '' ? null : env.AI_REASONING || 'high',
      maxTokens: +env.AI_MAX_TOKENS || 32000,
    },
    image: env.IMAGE_MODEL
      ? { model: env.IMAGE_MODEL, url: env.IMAGE_URL || aiBase + '/images/generations', key: env.IMAGE_API_KEY || env.AI_API_KEY }
      : null, // → the free Pollinations service
    stt: env.STT_MODEL
      ? { model: env.STT_MODEL, url: env.STT_URL || aiBase + '/audio/transcriptions', key: env.STT_API_KEY || env.AI_API_KEY }
      : null, // → voice goes straight to the chat model
    gist: { token: env.GITHUB_TOKEN, id: env.GIST_ID },
    repo: env.GITHUB_REPO_TOKEN ? { token: env.GITHUB_REPO_TOKEN, name: env.GITHUB_REPO || 'omidiz/life', branch: env.GITHUB_BRANCH || 'main' } : null,
  };
}
