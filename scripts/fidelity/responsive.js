/**
 * Finds layout breakage at many screen sizes: text spilling out of its box,
 * text clipped mid-word, text on top of other text or on top of a control,
 * controls pushed off the side, and pages that scroll sideways.
 *
 * Loaded into any signed-in page of the app by the collector, and run there:
 *
 *   const m = await import('http://localhost:4388/responsive.js?' + Date.now());
 *   m.sweep(['/home', '/calendar'], m.SIZES)        // fire and forget
 *   m.progress()                                    // poll
 *
 * ── Why iframes ──────────────────────────────────────────────────────────
 *
 * Each route is loaded into a same-origin iframe sized to the device. Media
 * queries resolve against the iframe's own viewport, so a 390px iframe lays
 * the page out exactly as a 390px phone would, and because it is same-origin
 * the session cookie comes with it and its DOM can be read from here. One tab
 * sweeps every route at every size without resizing anything.
 *
 * What it cannot reproduce is anything keyed on the user agent or on touch —
 * those are rare in this app, which lays out on widths alone.
 *
 * ── What counts as a defect ──────────────────────────────────────────────
 *
 *   hscroll    the document is wider than the viewport
 *   offscreen  a control or text that starts or ends outside the viewport,
 *              and is not inside something that scrolls sideways on purpose
 *   clipped    a box with hidden overflow cutting its text, with no ellipsis
 *              to say it was meant
 *   spill      text drawn outside the painted box (background, border or
 *              shadow) it sits in
 *   overlap    two pieces of text drawn on top of each other
 *   covers     text drawn on top of a button, link or field it is not part of
 *
 * Fixed and sticky layers (drawers, toasts, the floating Ask Spark) are left
 * out of the overlap checks: they overlap content by design, and reporting
 * every line they float over would bury the real findings.
 */

export const SIZES = [
  [360, 740],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1280, 600],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
];

const state = { done: 0, total: 0, current: '', issues: 0, errors: [] };
export const progress = () => ({ ...state });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describe(el) {
  const parts = [];
  let e = el;
  for (let i = 0; i < 3 && e && e.tagName !== 'BODY'; i++) {
    const cls = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    parts.unshift(e.tagName.toLowerCase() + (cls ? '.' + cls : ''));
    e = e.parentElement;
  }
  return parts.join(' > ').slice(0, 220);
}

function textOf(el) {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textRect(doc, el) {
  const range = doc.createRange();
  let r = null;
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.textContent.trim()) continue;
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) {
      if (q.width < 1 || q.height < 1) continue;
      r = r
        ? { left: Math.min(r.left, q.left), top: Math.min(r.top, q.top), right: Math.max(r.right, q.right), bottom: Math.max(r.bottom, q.bottom) }
        : { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
    }
  }
  return r;
}

function lineRects(doc, el) {
  const range = doc.createRange();
  const out = [];
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.textContent.trim()) continue;
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) if (q.width >= 1 && q.height >= 1) out.push(q);
  }
  return out;
}

const area = (a) => Math.max(0, a.right - a.left) * Math.max(0, a.bottom - a.top);
const inter = (a, b) => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});

export function analyse(win) {
  const doc = win.document;
  const W = win.innerWidth;
  const issues = [];
  const cs = (e) => win.getComputedStyle(e);

  const layered = (el) => {
    for (let e = el; e && e !== doc.body; e = e.parentElement) {
      const p = cs(e).position;
      if (p === 'fixed' || p === 'sticky') return true;
      if (e.getAttribute('aria-hidden') === 'true') return true;
      if (e.tagName === 'NEXTJS-PORTAL') return true;
    }
    return false;
  };
  const shown = (el) =>
    el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  const srOnly = (el) => {
    const r = el.getBoundingClientRect();
    return r.width <= 1 || r.height <= 1;
  };
  const scrollsX = (el) => {
    for (let e = el.parentElement; e && e !== doc.body; e = e.parentElement) {
      const o = cs(e).overflowX;
      if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
    }
    return false;
  };
  /** The nearest ancestor that hides overflow — text past it is clipped, not spilled. */
  const clippedBy = (el) => {
    for (let e = el.parentElement; e && e !== doc.body; e = e.parentElement) {
      const s = cs(e);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return e;
    }
    return null;
  };
  const painted = (e) => {
    const s = cs(e);
    return (
      (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') ||
      s.backgroundImage !== 'none' ||
      (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') ||
      (parseFloat(s.borderLeftWidth) > 0 && s.borderLeftStyle !== 'none') ||
      (s.boxShadow !== 'none' && /inset/.test(s.boxShadow))
    );
  };

  if (doc.documentElement.scrollWidth > W + 1) {
    issues.push({ kind: 'hscroll', detail: `page is ${doc.documentElement.scrollWidth}px wide in a ${W}px viewport` });
  }

  const texts = [];
  const controls = [];
  for (const el of doc.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg'].includes(el.tagName)) continue;
    if (!shown(el)) continue;
    const isControl = el.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]');
    if (isControl && !srOnly(el)) {
      const r = el.getBoundingClientRect();
      if (r.width >= 8 && r.height >= 8) controls.push({ el, r, layered: layered(el) });
    }
    const t = textOf(el);
    if (!t || srOnly(el)) continue;
    const tr = textRect(doc, el);
    if (!tr) continue;
    texts.push({ el, t, r: tr, layered: layered(el) });
  }

  const at = (r) => ({ x: Math.round(r.left), y: Math.round(r.top + win.scrollY), w: Math.round(r.right - r.left), h: Math.round(r.bottom - r.top) });

  // offscreen
  for (const { el, t, r } of texts) {
    if ((r.right > W + 2 || r.left < -2) && !scrollsX(el) && !clippedBy(el)) {
      issues.push({ kind: 'offscreen', t: t.slice(0, 70), at: at(r), sel: describe(el), detail: `text spans ${Math.round(r.left)}→${Math.round(r.right)} of ${W}` });
    }
  }
  for (const { el, r } of controls) {
    if ((r.right > W + 2 || r.left < -2) && !scrollsX(el) && !clippedBy(el)) {
      issues.push({ kind: 'offscreen', t: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 70), at: at(r), sel: describe(el), detail: `control spans ${Math.round(r.left)}→${Math.round(r.right)} of ${W}` });
    }
  }

  // clipped and spill
  for (const { el, t, r } of texts) {
    const s = cs(el);
    /*
      Ellipsis is a decision, so it is not "clipped" — unless the box has been
      squeezed until the ellipsis is most of what is left. A label showing
      "C…" has stopped being a label.
    */
    if (s.textOverflow === 'ellipsis') {
      const box = el.getBoundingClientRect();
      const full = r.right - r.left;
      const room = box.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      if (full > room + 2 && room < Math.min(full * 0.5, 70)) {
        issues.push({ kind: 'squeezed', t: t.slice(0, 70), at: at(r), sel: describe(el), detail: `${Math.round(room)}px of room for ${Math.round(full)}px of text` });
      }
      continue;
    }
    if (s.webkitLineClamp !== 'none' && s.webkitLineClamp) continue;
    const clip = clippedBy(el);
    const self = s.overflowX !== 'visible' ? el : null;
    const box = self ?? clip;
    if (box) {
      const bs = cs(box);
      if (bs.textOverflow === 'ellipsis' || (bs.webkitLineClamp && bs.webkitLineClamp !== 'none')) continue;
      const b = box.getBoundingClientRect();
      const cutX = r.right - b.right > 3 || b.left - r.left > 3;
      const cutY = r.bottom - b.bottom > 3 || b.top - r.top > 3;
      // A scroller is allowed to have content past its edge — that is what scrolling is.
      const scrolls = /auto|scroll/.test(bs.overflowX + bs.overflowY);
      // Inside a scroller, content past the edge is reachable: not a defect.
      if (scrolls) continue;
      if ((cutX || cutY) && box !== doc.documentElement) {
        issues.push({ kind: 'clipped', t: t.slice(0, 70), at: at(r), sel: describe(el), detail: `text ${at(r).w}x${at(r).h} cut by ${describe(box).split(' > ').pop()} ${Math.round(b.width)}x${Math.round(b.height)}` });
        continue;
      }
    }
    // spill: nearest painted ancestor (or self)
    let p = el;
    while (p && p !== doc.body && !painted(p)) p = p.parentElement;
    if (p && p !== doc.body) {
      const b = p.getBoundingClientRect();
      const out = Math.max(r.right - b.right, b.left - r.left, r.bottom - b.bottom, b.top - r.top);
      if (out > 3 && !(clip && clip.contains(p) === false && !p.contains(clip))) {
        issues.push({ kind: 'spill', t: t.slice(0, 70), at: at(r), sel: describe(el), detail: `${Math.round(out)}px outside ${describe(p).split(' > ').pop()} ${Math.round(b.width)}x${Math.round(b.height)}` });
      }
    }
  }

  /*
    Only the part of a line that is actually drawn: a line hidden by an
    overflow-hidden ancestor is already reported as clipped, and counting it
    again as overlapping whatever sits below the clip doubles every finding.
  */
  const visibleLines = (el) => {
    let lines = lineRects(doc, el).map((q) => ({ left: q.left, top: q.top, right: q.right, bottom: q.bottom }));
    // Its own box first: a `truncate` span clips its own text at the ellipsis.
    for (let e = el; e && e !== doc.body; e = e.parentElement) {
      const s = cs(e);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const b = e.getBoundingClientRect();
      lines = lines.map((q) => inter(q, b)).filter((q) => area(q) > 1);
    }
    return lines;
  };

  // overlap: text on text, line boxes against line boxes
  const flat = texts
    .filter((x) => !x.layered)
    .map((x) => ({ ...x, lines: visibleLines(x.el) }))
    .filter((x) => x.lines.length > 0)
    .map((x) => ({
      ...x,
      r: x.lines.reduce((a, q) => ({ left: Math.min(a.left, q.left), top: Math.min(a.top, q.top), right: Math.max(a.right, q.right), bottom: Math.max(a.bottom, q.bottom) })),
    }));
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i];
      const b = flat[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const box = inter(a.r, b.r);
      if (area(box) < 6) continue;
      let worst = 0;
      for (const la of a.lines) for (const lb of b.lines) worst = Math.max(worst, area(inter(la, lb)) / Math.min(area(la), area(lb)));
      if (worst > 0.18) {
        issues.push({ kind: 'overlap', t: a.t.slice(0, 50), t2: b.t.slice(0, 50), at: at(a.r), sel: describe(a.el), sel2: describe(b.el), detail: `${Math.round(worst * 100)}% of the smaller line` });
      }
    }
  }

  // covers: text over a control it is not part of
  for (const x of flat) {
    for (const c of controls) {
      if (c.layered || c.el.contains(x.el) || x.el.contains(c.el)) continue;
      // A stretched link — a wordless control laid over a whole card so the
      // card is clickable — sits on its text by design.
      if (!(c.el.innerText || '').trim()) continue;
      const box = inter(x.r, c.r);
      const a = area(box);
      if (a < 20) continue;
      if (a / Math.min(area(x.r), area(c.r)) > 0.25) {
        issues.push({ kind: 'covers', t: x.t.slice(0, 50), t2: (c.el.innerText || c.el.getAttribute('aria-label') || c.el.tagName).trim().slice(0, 50), at: at(x.r), sel: describe(x.el), sel2: describe(c.el), detail: `${Math.round((a / Math.min(area(x.r), area(c.r))) * 100)}%` });
      }
    }
  }

  /*
    occluded: something drawn on top of text — an image, a card, a chip,
    a positioned box. The checks above compare text with text and text with
    controls, and missed exactly this: three post thumbnails sitting on a
    campaign title, a send icon on a status chip. The browser already knows
    what is on top, so ask it: hit-test the middle of each line and see
    whether the text, or something containing it, is what comes back.

    elementFromPoint only answers inside the viewport, so the frame scrolls
    each line to its middle first. Wordless controls are a stretched link's
    overlay, and are skipped as they are above.
  */
  const H = win.innerHeight;
  // Every rect above was measured at this scroll; positions are stated from it.
  const sy0 = win.scrollY;
  for (const x of flat) {
    const line = x.lines.find((q) => area(q) > 30);
    if (!line) continue;
    const cy = (line.top + line.bottom) / 2 + sy0;
    const cx = Math.min(Math.max((line.left + line.right) / 2, 1), W - 2);
    win.scrollTo(win.scrollX, Math.max(0, cy - H / 2));
    const vy = cy - win.scrollY;
    const hit = doc.elementFromPoint(cx, vy);
    if (!hit || hit === x.el || x.el.contains(hit) || hit.contains(x.el)) continue;
    if (layered(hit)) continue;
    if (hit.matches('a[href], button, [role=button]') && !(hit.innerText || '').trim()) continue;
    issues.push({
      kind: 'occluded',
      t: x.t.slice(0, 60),
      t2: (hit.innerText || hit.getAttribute('alt') || hit.tagName).trim().slice(0, 40),
      at: { x: Math.round(x.r.left), y: Math.round(x.r.top + sy0), w: Math.round(x.r.right - x.r.left), h: Math.round(x.r.bottom - x.r.top) },
      sel: describe(x.el),
      sel2: describe(hit),
      detail: 'something is drawn over this text',
    });
  }
  win.scrollTo(0, sy0);

  return { issues, texts: texts.length, controls: controls.length, scrollWidth: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight };
}

/**
 * Ready means: the route has arrived (not about:blank), there is real text on
 * it, nothing says it is loading, and the text has not changed for three
 * seconds. Element counts were not enough — a skeleton has plenty of elements
 * and no words, and the first sweep measured forty pages of skeleton.
 */
async function settle(frame, maxMs = 25000) {
  const t0 = Date.now();
  let last = '';
  let stable = 0;
  while (Date.now() - t0 < maxMs) {
    await sleep(1000);
    let doc;
    try {
      doc = frame.contentDocument;
    } catch {
      continue;
    }
    if (!doc || doc.location.href === 'about:blank' || doc.readyState !== 'complete' || !doc.body) continue;
    const txt = (doc.body.innerText || '').trim();
    if (txt.length < 80 || /Opening your account|Loading…|Loading\.\.\.|Compiling/.test(txt)) {
      stable = 0;
      continue;
    }
    /*
      Text *and* network quiet. The shell renders, sits still for a few
      seconds while the tool calls are in flight, then the data lands in one
      burst — text alone called that pause "settled" and measured the shell.
    */
    const sig = `${txt.length}:${frame.contentWindow.performance.getEntriesByType('resource').length}`;
    if (sig === last) stable++;
    else stable = 0;
    last = sig;
    if (stable >= 4) return true;
  }
  return false;
}

export async function check(path, w, h, collector = 'http://localhost:4388', maxMs = 25000) {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;border:0;z-index:2147483647;background:#fff`;
  frame.src = path;
  document.body.appendChild(frame);
  try {
    const settled = await settle(frame, maxMs);
    const win = frame.contentWindow;
    const result = analyse(win);
    const dump = { path, landed: win.location.pathname, size: [w, h], settled, at: new Date().toISOString(), ...result };
    const name = `resp.${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}.${w}x${h}`;
    await fetch(`${collector}/dump?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dump),
    });
    return dump;
  } finally {
    frame.remove();
  }
}

/**
 * Every path at every size, `concurrency` frames at a time. Most of a check
 * is waiting for the page's data, so four frames in flight finish in roughly
 * a quarter of the time without changing what any one of them measures.
 */
export async function sweep(paths, sizes = SIZES, concurrency = 2) {
  const jobs = [];
  for (const p of paths) for (const [w, h] of sizes) jobs.push([p, w, h]);
  state.total = jobs.length;
  state.done = 0;
  state.issues = 0;
  state.errors = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [p, w, h] = jobs[next++];
      state.current = `${p} @ ${w}x${h}`;
      try {
        const d = await check(p, w, h);
        state.issues += d.issues.length;
      } catch (e) {
        state.errors.push(`${p} ${w}x${h}: ${e && e.message}`);
      }
      state.done++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  state.current = 'done';
  return progress();
}
