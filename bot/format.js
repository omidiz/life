/* AI models write Markdown; Telegram shows a small set of HTML tags.
   Turn one into the other, and cut long answers into messages Telegram accepts (max 4096 characters). */

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(t) {
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = esc(t)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt, url) => `<a href="${url.replace(/"/g, '&quot;')}">${txt}</a>`)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<b>$1</b>')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

export function mdToHtml(md) {
  const out = [];
  const parts = md.split(/^```[^\n]*\n?/m); // even = text, odd = code
  parts.forEach((part, i) => {
    if (i % 2) { out.push(`<pre>${esc(part.replace(/\n$/, ''))}</pre>`); return; }
    out.push(part.split('\n').map(line => {
      let m;
      if ((m = line.match(/^\s{0,3}#{1,6}\s+(.*)$/))) return `<b>${inline(m[1].replace(/#+\s*$/, ''))}</b>`;
      if ((m = line.match(/^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/))) return `${m[1]}${m[2] === ' ' ? '○' : '✓'} ${inline(m[3])}`;
      if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) return `${m[1]}• ${inline(m[2])}`;
      if ((m = line.match(/^\s*>\s?(.*)$/))) return `<blockquote>${inline(m[1])}</blockquote>`;
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return '──────────';
      if (/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/.test(line)) return ''; // table divider
      if (/^\s*\|.*\|\s*$/.test(line)) return inline(line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).join('  ·  '));
      return inline(line);
    }).join('\n').replace(/<\/blockquote>\n<blockquote>/g, '\n'));
  });
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// Split Markdown into pieces of at most `max` characters, at paragraph or line breaks when possible.
export function splitMd(md, max = 3500) {
  const chunks = [];
  let rest = md.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    let piece = rest.slice(0, cut);
    // keep code blocks whole: close an open ``` and reopen it in the next piece
    if ((piece.match(/^```/gm) || []).length % 2) { chunks.push(piece + '\n```'); rest = '```\n' + rest.slice(cut).trimStart(); continue; }
    chunks.push(piece);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
