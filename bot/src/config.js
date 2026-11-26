/* Every setting in one place, with its default. Secrets and most settings live in Cloudflare
   (life-bot → Settings → Variables and Secrets); TZ, LANG, MORNING, EVENING and GITHUB_REPO in wrangler.toml. */
export function config(env) {
  const aiUrl = (env.AI_URL || 'https://integrate.api.nvidia.com/v1').trim().replace(/\/+$/, '');
  const aiBase = aiUrl.replace(/\/chat\/completions$/, '');
  return {
    telegramToken: env.TELEGRAM_TOKEN,
    chatId: env.CHAT_ID,
    webhookSecret: env.WEBHOOK_SECRET,
    tz: env.TZ || 'Asia/Tehran',
    lang: env.LANG === 'en' ? 'en' : 'fa',
    morning: env.MORNING ?? '08:00', // "" turns it off
    evening: env.EVENING ?? '21:00',
    ai: {
      url: /\/chat\/completions$/.test(aiUrl) ? aiUrl : aiUrl + '/chat/completions',
      model: env.AI_MODEL || 'z-ai/glm-5.3-flash',
      key: env.AI_API_KEY,
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
