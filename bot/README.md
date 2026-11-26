# Life bot — your dashboard in Telegram

A private Telegram bot connected to your Life dashboard. Send it a message and the task appears on your boards on every device.
It reads and writes the same secret gist that dashboard **Sync** uses, so turn on Sync first (⋯ → Sync).

## What it does

- **Any message becomes a task** in an **Inbox** board (created on your first page the first time).
- `#board` puts it on a board: `Call mom #personal`. Names can be shortened (`#pers`).
- `@date` / `@time` set a deadline: `@today`, `@tomorrow`, `@mon`…`@sun`, `@12-05`, `@2026-12-05`, `@9am`, `@18:30`.
  Example: `Essay #study @fri @18:00`
- `/today`: what's late and what's due today. `/week`: the next 7 days.
- `/list` shows all open tasks by board (`/list work` shows one board), with **✓ buttons to tick tasks off**.
- `/boards`, `/note text` (adds a note line, `#board` works too), `/undo` (removes the last thing you added).
- **Morning brief** every day at 08:00 Tehran time, with ✓ buttons.
- Only you can use it. Anyone else who messages it just gets a "private bot" reply.

## Set it up (about 10 minutes, free)

It runs on Cloudflare Workers (the free plan is plenty), so it's always on without a server.

1. **Make the bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name. Copy the **token** it gives you.
2. **GitHub token.** Use a token with only the `gist` permission (the one from dashboard Sync works, or
   [create one](https://github.com/settings/tokens/new?scopes=gist&description=Life%20Telegram%20bot)).
3. **Deploy.** Install [Node.js](https://nodejs.org), then in this `bot` folder:

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

   It prints your bot's address, like `https://life-bot.<you>.workers.dev`.

4. **Add the secrets.** Each command asks for the value:

```bash
npx wrangler secret put TELEGRAM_TOKEN
```

```bash
npx wrangler secret put GITHUB_TOKEN
```

```bash
npx wrangler secret put WEBHOOK_SECRET
```

   For `WEBHOOK_SECRET`, make up a long random password (letters, numbers, `_` and `-` only).

5. **Connect Telegram.** Open `https://life-bot.<you>.workers.dev/setup?secret=<your WEBHOOK_SECRET>` in a browser. It should show `"ok":true`.
6. **Tell it who you are.** Message your bot anything. It replies with your chat id. Then:

```bash
npx wrangler secret put CHAT_ID
```

   Paste that number. Send `/help` to the bot and you're done.

### Options

- **Time zone**: change `TZ` in `wrangler.toml` (default `Asia/Tehran`).
- **Morning brief time**: change `crons` in `wrangler.toml` (it's in UTC; `30 4 * * *` = 08:00 Tehran). Delete the `[triggers]` block to turn it off.
- **Gist**: the bot finds the `life-dashboard.json` gist on its own. To pin it, add `GIST_ID = "…"` under `[vars]`.

Run `npx wrangler deploy` again after changing `wrangler.toml`.
