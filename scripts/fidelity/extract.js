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

function rgbOf(value) {
  return value.replace(/\s+/g, '');
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
    if (r.width * r.height < 1500) continue;
    const y = r.top + scrollY;
    if (y > MAX_Y) continue;
    boxes.push({
      x: Math.round(r.left + scrollX),
      y: Math.round(y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      bg: rgbOf(bg),
      grad: cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 120) : undefined,
      r: cs.borderTopLeftRadius,
      sh: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 80) : undefined,
    });
  }

  const dump = {
    name,
    url: location.href,
    viewport: [innerWidth, innerHeight],
    docHeight: document.documentElement.scrollHeight,
    at: new Date().toISOString(),
    texts,
    boxes,
  };

  const res = await fetch(`${collector}/dump?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dump),
  });
  return { status: res.status, texts: texts.length, boxes: boxes.length, viewport: dump.viewport };
}
