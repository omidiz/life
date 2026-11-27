/* Tools for working on the bot's own code (and the dashboard's) in the GitHub repository.
   The AI can read files and *propose* a change; nothing is written until you press ✅ in Telegram.
   After a change: ↩️ Undo, and a message when Cloudflare has built (or failed to build) the new version.

   Needs the secret GITHUB_REPO_TOKEN: a fine-grained GitHub token for this one repository with
   "Contents: Read and write" (and "Checks: Read" to hear about builds). GITHUB_REPO names the repo. */

const repo = c => c.repo.name;
const branch = c => c.repo.branch;

async function gh(c, path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${repo(c)}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${c.repo.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'life-telegram-bot' },
  });
  if (r.status === 404 && opts.allow404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));
const clean = p => String(p || '').replace(/^\/+|\/+$/g, '');

async function current(c, path) { // { sha, text } or null if the file doesn't exist
  const f = await gh(c, `/contents/${encodeURI(clean(path))}?ref=${branch(c)}`, { allow404: true });
  if (!f) return null;
  if (Array.isArray(f)) throw new Error(`${path} is a folder`);
  return { sha: f.sha, text: f.content ? decode(f.content) : decode((await gh(c, `/git/blobs/${f.sha}`)).content) };
}

/* ---------- a small line diff, to show you what would change ---------- */
function diff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  let s = 0; while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0; while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const xs = x.slice(s, x.length - e), ys = y.slice(s, y.length - e);
  if (xs.length * ys.length > 4e6) return { added: ys.length, removed: xs.length, lines: [...xs.map(l => '- ' + l), ...ys.map(l => '+ ' + l)] };
  const dp = Array.from({ length: xs.length + 1 }, () => new Uint32Array(ys.length + 1));
  for (let i = xs.length - 1; i >= 0; i--) for (let j = ys.length - 1; j >= 0; j--)
    dp[i][j] = xs[i] === ys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lines = []; let i = 0, j = 0, added = 0, removed = 0;
  while (i < xs.length || j < ys.length) {
    if (i < xs.length && j < ys.length && xs[i] === ys[j]) { i++; j++; lines.push(null); }
    else if (j < ys.length && (i >= xs.length || dp[i][j + 1] > dp[i + 1][j])) { lines.push('+ ' + ys[j++]); added++; }
    else { lines.push('- ' + xs[i++]); removed++; }
  }
  return { added, removed, lines: lines.filter(Boolean) };
}

/* ---------- tools for the AI ---------- */
export function codeTools(ctx) {
  const c = ctx.c;
  return [
    {
      name: 'repo_list', readOnly: true,
      description: "List files in the user's GitHub repository (the bot's own code is in bot/, the dashboard app at the top level).",
      input_schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', description: 'Folder, e.g. "bot". Empty for the top.' } } },
      run: async ({ path }) => {
        const list = await gh(c, `/contents/${encodeURI(clean(path))}?ref=${branch(c)}`);
        return (Array.isArray(list) ? list : [list]).map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}${f.size ? ` (${f.size} bytes)` : ''}`).join('\n');
      },
    },
    {
      name: 'repo_read', readOnly: true,
      description: 'Read a file from the repository. Always read a file before proposing changes to it.',
      input_schema: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' } } },
      run: async ({ path }) => {
        const f = await current(c, path);
        if (!f) return `${path} does not exist.`;
        return f.text.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
      },
    },
    {
      name: 'propose_change',
      description: 'Propose a change to the repository: the user sees a summary and the differences, and applies it with a button. Give the COMPLETE new content of each changed file (not a fragment, no line numbers). Cloudflare rebuilds the bot about a minute after it is applied.',
      input_schema: {
        type: 'object', additionalProperties: false, required: ['summary', 'files'],
        properties: {
          summary: { type: 'string', description: 'What changes and why, in the user\'s language, 1–4 short lines.' },
          files: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['path'],
              properties: {
                path: { type: 'string' },
                content: { type: 'string', description: 'The whole new file.' },
                delete: { type: 'boolean' },
              },
            },
          },
        },
      },
      run: async ({ summary, files }) => {
        files = typeof files === 'string' ? JSON.parse(files) : files;
        if (!Array.isArray(files) || !files.length) return 'No files given.';
        const changes = [];
        for (const f of files) {
          const path = clean(f.path), now = await current(c, path);
          if (!f.delete && typeof f.content !== 'string') return `No content for ${path}.`;
          if (f.delete && !now) return `${path} does not exist.`;
          if (/\b(sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|gh[pous]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|\d{8,10}:[A-Za-z0-9_-]{30,})/.test(f.content || ''))
            return `Refused: ${path} would contain a key or token. Keys belong in Cloudflare secrets, never in code.`;
          if (!f.delete && now && now.text === f.content) continue;
          changes.push({ path, content: f.delete ? null : f.content.replace(/\r\n/g, '\n'), sha: now?.sha || null, before: now?.text ?? '' });
        }
        if (!changes.length) return 'Nothing would change: the files already have this content.';
        await ctx.state.put('proposal', { id: Math.random().toString(36).slice(2, 8), summary, changes, at: Date.now() });
        ctx.out.showProposal = true;
        return 'The proposal is shown to the user with Apply / Cancel buttons. Tell them briefly what it does; do not repeat the code.';
      },
    },
    {
      name: 'bot_errors', readOnly: true,
      description: 'The last problems the bot ran into (newest last), to find and fix bugs.',
      input_schema: { type: 'object', additionalProperties: false, properties: {} },
      run: async () => ((await ctx.state.get('errors')) || []).map(e => `${new Date(e.at).toISOString()} ${e.where}: ${e.message}`).join('\n') || 'No problems recorded.',
    },
  ];
}

// The proposal as a Telegram message: summary, files with +/− counts, and the changed lines.
export function proposalView(p) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let budget = 3000;
  const parts = p.changes.map(c => {
    if (c.content === null) return `🗑 <b>${esc(c.path)}</b> (delete)`;
    const d = diff(c.before, c.content);
    const shown = d.lines.slice(0, 60).join('\n').slice(0, Math.max(0, budget));
    budget -= shown.length;
    return `${c.sha ? '✏️' : '🆕'} <b>${esc(c.path)}</b>  +${d.added} −${d.removed}` + (shown ? `\n<pre>${esc(shown)}${d.lines.length > 60 || shown.length < d.lines.join('\n').length ? '\n…' : ''}</pre>` : '');
  });
  return {
    text: `🛠 <b>Proposed change</b>\n${esc(p.summary)}\n\n${parts.join('\n\n')}`.slice(0, 4000),
    reply_markup: { inline_keyboard: [[{ text: '✅ Apply', callback_data: `dev:apply:${p.id}` }, { text: '✖ Cancel', callback_data: `dev:cancel:${p.id}` }]] },
  };
}

// Write the proposal as one commit on the branch.
export async function applyProposal(c, p) {
  for (const ch of p.changes) {
    const now = await current(c, ch.path);
    if ((now?.sha || null) !== ch.sha) throw new Error(`${ch.path} changed since this was proposed. Ask again so it starts from the latest version.`);
  }
  const ref = await gh(c, `/git/ref/heads/${branch(c)}`), head = ref.object.sha;
  const base = await gh(c, `/git/commits/${head}`);
  const tree = await gh(c, '/git/trees', { method: 'POST', body: JSON.stringify({
    base_tree: base.tree.sha,
    tree: p.changes.map(c => c.content === null ? { path: c.path, mode: '100644', type: 'blob', sha: null } : { path: c.path, mode: '100644', type: 'blob', content: c.content }),
  }) });
  const commit = await gh(c, '/git/commits', { method: 'POST', body: JSON.stringify({
    message: `${p.summary.split('\n')[0].slice(0, 70)}\n\n${p.summary}\n\n(Made from Telegram by the Life bot.)`, tree: tree.sha, parents: [head],
  }) });
  await gh(c, `/git/refs/heads/${branch(c)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  return { sha: commit.sha, url: commit.html_url || `https://github.com/${repo(c)}/commit/${commit.sha}` };
}

// Undo = a new commit that puts back the files as they were before (history is kept).
export async function undoCommit(c, sha) {
  const head = (await gh(c, `/git/ref/heads/${branch(c)}`)).object.sha;
  if (head !== sha) throw new Error('Something else was changed after this, so it can’t be undone safely here. Use GitHub or Cloudflare (Deployments → Rollback).');
  const done = await gh(c, `/git/commits/${sha}`), parent = await gh(c, `/git/commits/${done.parents[0].sha}`);
  const commit = await gh(c, '/git/commits', { method: 'POST', body: JSON.stringify({ message: `Undo: ${done.message.split('\n')[0]}`, tree: parent.tree.sha, parents: [sha] }) });
  await gh(c, `/git/refs/heads/${branch(c)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  return { sha: commit.sha };
}

// Has Cloudflare finished building this commit? null = not yet / can't tell.
export async function buildResult(c, sha) {
  const r = await gh(c, `/commits/${sha}/check-runs`, { allow404: true }).catch(() => null);
  const runs = r?.check_runs || [];
  if (!runs.length || runs.some(x => x.status !== 'completed')) return null;
  const bad = runs.find(x => !['success', 'neutral', 'skipped'].includes(x.conclusion));
  return bad ? { ok: false, text: `${bad.name}: ${bad.conclusion}. ${(bad.output?.summary || bad.output?.title || '').slice(0, 500)}`, url: bad.details_url || bad.html_url } : { ok: true };
}
