/**
 * Measures a rendered page: every visible piece of text and every painted box.
 *
 * Loaded into a page by the collector as an ES module and run in place:
 *
 *   await (await import('http://localhost:4388/extract.js?' + Date.now())).run('calendar.live')
 *
 * The same file measures the prototype and the live screen, at the same
 * viewport, so a difference in the dumps is a difference in the designs.
 *
 * ── What is recorded, and why these fields ───────────────────────────────
 *
 * Text, because text is what can be *matched* across the two: a heading says
 * "Agent Command Center" in both, and once paired its position, size, weight,
 * colour and face can be compared directly. A box has no name to pair it by,
 * so boxes are recorded for the human reading the report rather than diffed.
 *
 * Positions are page coordinates (scroll included), rounded. Fonts are the
 * computed value — what the browser actually used, not what a class asked for.
 */

const MAX_Y = 4000;

/**
 * Whitespace collapsed, not removed. Removing it turned the app's token
 * colours — `color(srgb 0.047 0.047 0.047)`, what `color-mix()` computes to —
 * into `color(srgb0.04705880.04705880.0470588)`, which no parser can split,
 * so every token colour was silently left out of every comparison.
 */
function rgbOf(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function mirrored(el) {
  let flip = false;
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const t = getComputedStyle(n).transform;
    // A reflection, not any negative `a`: rotate(180deg) is matrix(-1,0,0,-1)
    // and flips nothing. The sign of the determinant says which it is.
    const m = /^matrix\(([^)]+)\)/.exec(t);
    if (m) {
      const [a, b, c, d] = m[1].split(',').map(Number);
      if (a * d - b * c < 0) flip = !flip;
    }
  }
  return flip;
}

function visible(el, cs, r) {
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  if (Number(cs.opacity) === 0) return false;
  if (r.width < 1 || r.height < 1) return false;
  return true;
}

export async function run(name, collector = 'http://localhost:4388') {
  try {
    await document.fonts.ready;
  } catch {
    /* fonts API absent — measure anyway */
  }

  const texts = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent || !node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;
    const y = r.top + scrollY;
    if (y > MAX_Y) continue;
    seen.add(el);

    // Own text only: a heading's text, not its children's as well.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!own) continue;

    texts.push({
      t: own.slice(0, 90),
      x: Math.round(r.left + scrollX),
      y: Math.round(y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      fs: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      fw: Number(cs.fontWeight) || 400,
      c: rgbOf(cs.color),
      ff: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      lh: cs.lineHeight,
      tag: el.tagName.toLowerCase(),
    });
  }

  const boxes = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const painted =
      (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
      (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      (cs.boxShadow && cs.boxShadow !== 'none') ||
      (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none');
    if (!painted) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;
    // Small enough to keep status pills, swatches and badges — their colour is the point.
    if (r.width * r.height < 120) continue;
    const y = r.top + scrollY;
    if (y > MAX_Y) continue;
    boxes.push({
      x: Math.round(r.left + scrollX),
      y: Math.round(y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      bg: rgbOf(bg),
      // Whole, for `colours.mjs`: a gradient cut at 120 characters loses its
      // last stops, which are the ones that drift.
      grad: cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url(') ? cs.backgroundImage : undefined,
      r: cs.borderTopLeftRadius,
      sh: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : undefined,
      bc:
        parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none'
          ? `${cs.borderTopWidth} ${rgbOf(cs.borderTopColor)}`
          : undefined,
      // A few words from inside, so a report can say which card a colour is on.
      inner: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined,
      // Mirrored by a `scaleX(-1)` on it or an ancestor: its gradient angles are
      // then drawn reflected, and `colours.mjs` compares them that way. The
      // prototype mirrors the whole canvas card this way.
      flip: mirrored(el) || undefined,
    });
  }

  /*
   * Icons. An SVG's paint is in its children's `fill` / `stroke`, which no box
   * or text records — and a mark drawn in the wrong grey is as wrong as a
   * label in the wrong grey.
   */
  const icons = [];
  for (const svg of Array.from(document.body.querySelectorAll('svg'))) {
    const r = svg.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const cs = getComputedStyle(svg);
    if (!visible(svg, cs, r)) continue;
    const y = r.top + scrollY;
    if (y > MAX_Y) continue;
    const paints = new Set();
    // Shapes only, not the <svg> itself: its own computed fill is the inherited
    // default (black) whether or not anything is painted with it, and counting
    // it reported every stroke icon as "filled black".
    for (const node of Array.from(svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse,text,use'))) {
      const ncs = getComputedStyle(node);
      if (ncs.fill && ncs.fill !== 'none' && !ncs.fill.startsWith('url(')) paints.add(`f:${rgbOf(ncs.fill)}`);
      if (ncs.stroke && ncs.stroke !== 'none' && !ncs.stroke.startsWith('url(')) paints.add(`s:${rgbOf(ncs.stroke)}`);
      if (ncs.fill && ncs.fill.startsWith('url(')) paints.add('f:gradient');
      if (paints.size > 8) break;
    }
    icons.push({ x: Math.round(r.left + scrollX), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), paints: [...paints] });
  }

  const dump = {
    name,
    url: location.href,
    viewport: [innerWidth, innerHeight],
    docHeight: document.documentElement.scrollHeight,
    at: new Date().toISOString(),
    texts,
    boxes,
    icons,
  };

  const res = await fetch(`${collector}/dump?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dump),
  });
  return { status: res.status, texts: texts.length, boxes: boxes.length, icons: icons.length, viewport: dump.viewport };
}
