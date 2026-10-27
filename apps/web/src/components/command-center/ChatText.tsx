import type { ReactNode } from 'react';

/**
 * A SPARK reply, formatted.
 *
 * The model answers in Markdown — `**Status**`, `- ` bullets, `1.` steps —
 * and the drawer printed it as one paragraph of literal asterisks: a
 * `<p>` with `white-space: normal` collapsed every line break, so a reply
 * with five sections arrived as a single wall of text.
 *
 * ── Why a small renderer and not a Markdown library ────────────────────────
 *
 * A reply can quote crawled pages and inbound messages, so it is untrusted
 * text. This builds React elements from a deliberately small grammar —
 * paragraphs, `#` headings, bullet and numbered lists, bold, italic, inline
 * code and `http(s)` links — and never touches `dangerouslySetInnerHTML`, so
 * there is no HTML in a reply that can render as HTML. Anything outside the
 * grammar shows as the text it is, which is the right failure.
 *
 * Colour follows `Spark Chat.dc.html`: the body in the design's `#838383`,
 * with bold and headings in ink so a long answer still has a shape.
 */
export function ChatText({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{blocks(text)}</div>;
}

export type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[]; start: number }
  | { kind: 'table'; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** `|---|:---:|` — a table's header rule, which carries no content. */
const TABLE_RULE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/;

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** Exported for its tests — `chatText.test.ts`. */
export function parse(text: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    /*
      Tables. The prompt asks for none — a 367px panel has no room for one —
      but a prompt is not a guarantee, and a table printed as raw pipes is the
      worst of both. Rows go into one block; the header rule is dropped.
    */
    if (TABLE_ROW.test(line)) {
      if (cur?.kind !== 'table') {
        flush();
        cur = { kind: 'table', rows: [] };
      }
      if (!TABLE_RULE.test(line)) cur.rows.push(cells(line));
      continue;
    }

    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    if (h) {
      flush();
      out.push({ kind: 'h', text: h[1]! });
    } else if (b) {
      if (cur?.kind !== 'ul') {
        flush();
        cur = { kind: 'ul', items: [] };
      }
      cur.items.push(b[1]!);
    } else if (n) {
      if (cur?.kind !== 'ol') {
        flush();
        cur = { kind: 'ol', items: [], start: Number(n[1]) };
      }
      cur.items.push(n[2]!);
    } else if ((cur?.kind === 'ul' || cur?.kind === 'ol') && /^\s{2,}\S/.test(raw)) {
      // An indented continuation belongs to the list item above it.
      cur.items[cur.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (cur?.kind !== 'p') {
        flush();
        cur = { kind: 'p', lines: [] };
      }
      cur.lines.push(line.trim());
    }
  }
  flush();
  return out;
}

function blocks(text: string): ReactNode[] {
  return parse(text).map((b, i) => {
    const gap = i === 0 ? '' : 'mt-[10px]';
    switch (b.kind) {
      case 'h':
        return (
          <p key={i} className={`${gap} font-semibold text-ink`}>
            {inline(b.text)}
          </p>
        );
      case 'ul':
        return (
          <ul key={i} className={`${gap} flex list-disc flex-col gap-[4px] pl-[18px]`}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        );
      case 'table': {
        // A header row with nothing in it ("| | |") is layout, not content.
        const rows = b.rows.filter((r) => r.some((c) => c.length > 0));
        return (
          <div key={i} className={`${gap} flex flex-col gap-[4px]`}>
            {rows.map((r, j) => (
              <div key={j} className="flex gap-[10px]">
                <span className="w-[40%] shrink-0 font-semibold text-ink">{inline(r[0] ?? '')}</span>
                <span className="min-w-0 flex-1">{inline(r.slice(1).join(' · '))}</span>
              </div>
            ))}
          </div>
        );
      }
      case 'ol':
        return (
          <ol key={i} start={b.start} className={`${gap} flex list-decimal flex-col gap-[4px] pl-[20px]`}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ol>
        );
      default:
        return (
          <p key={i} className={gap}>
            {b.lines.map((l, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {inline(l)}
              </span>
            ))}
          </p>
        );
    }
  });
}

/** `**bold**`, `*italic*`/`_italic_`, `` `code` `` and `[text](https://…)`. */
// Underscore emphasis only at word edges, so `content_list` stays a word.
const INLINE = /(\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|\*[^*\s][^*]*\*|(?<!\w)_[^_\s][^_]*_(?!\w)|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((p, i) => {
    if (i % 2 === 0) return p;
    if ((p.startsWith('**') && p.endsWith('**')) || (p.startsWith('__') && p.endsWith('__'))) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith('`')) {
      return (
        <code key={i} className="rounded bg-[#F3F4F8] px-[4px] text-14 text-ink">
          {p.slice(1, -1)}
        </code>
      );
    }
    if (p.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
      const href = m?.[2] ?? '';
      // Only web links. A `javascript:` or `data:` href from an untrusted
      // reply stays text.
      if (m && /^https?:\/\//i.test(href)) {
        return (
          <a key={i} href={href} target="_blank" rel="noreferrer noopener" className="text-link-blue underline">
            {m[1]}
          </a>
        );
      }
      return p;
    }
    return <em key={i}>{p.slice(1, -1)}</em>;
  });
}
