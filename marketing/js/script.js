/* ============================================================================
   SparkSocial — marketing site behaviour
   No framework, no build step. Each concern is one init function, called once
   at the bottom.
   ========================================================================= */
'use strict';

/* ── Company details ────────────────────────────────────────────────────────
   Edit here and every place they appear on the page updates. Anything left in
   square brackets is a placeholder that has not been filled in yet.          */
const COMPANY = {
  address: 'Plot 1 Maxwell Street, Ozuoba, Port Harcourt',
  phone: '07037122762',
  email: 'help@sparkai.social',
  /* Used for the map link. Swap for a full Google Maps or Apple Maps URL. */
  mapUrl: 'https://maps.google.com/?q=Plot+1+Maxwell+Street+Ozuoba+Port+Harcourt',
};

/* ── Legal page values ──────────────────────────────────────────────────────
   The open decisions in the privacy policy and terms. Everything else on those
   pages is settled and written into the markup — these are the items that are
   commercial or legal judgements rather than descriptions of how the product
   works.

   Each key fills every `[data-legal="key"]` occurrence. A value still wrapped in
   square brackets renders in a dashed placeholder box, so an unanswered term
   cannot be mistaken for a real one. Both documents also list their own
   outstanding items in a numbered section near the end.                       */
const LEGAL = {
  /* Dates */
  updated: '[DATE]',

  /* Who the contract is with */
  entity: '[REGISTERED COMPANY NAME]',

  /* Privacy — retention periods (section 10) */
  'retention-account': '[PERIOD]',
  'retention-audit': '[PERIOD]',
  'retention-logs': '[PERIOD]',
  'retention-backup': '[PERIOD]',

  /* Privacy — infrastructure and vendors */
  region: '[PRIMARY AZURE REGION]',
  'ai-terms': "[CONFIRM EACH PROVIDER'S TRAINING TERMS]",
  age: '[AGE]',

  /* Terms — commercial */
  'price-notice': '[NOTICE PERIOD]',
  refunds: '[REFUND POLICY]',
  rollover: '[DO / DO NOT]',
  'export-window': '[PERIOD]',

  /* Terms — legal, needs advice */
  'liability-window': '[NUMBER]',
  jurisdiction: '[JURISDICTION]',
  courts: '[COURTS]',
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Contact details ────────────────────────────────────────────────────── */
function initCompany() {
  const set = (key, text) => {
    document.querySelectorAll(`[data-company="${key}"]`).forEach((el) => { el.textContent = text; });
  };
  set('address', COMPANY.address);
  set('phone', COMPANY.phone);
  set('email', COMPANY.email);

  const href = (key, url) => {
    document.querySelectorAll(`[data-company="${key}"]`).forEach((el) => { el.href = url; });
  };
  href('addressLink', COMPANY.mapUrl);
  // Strip spaces and punctuation for the dial link, keep a leading +.
  href('phoneLink', `tel:${COMPANY.phone.replace(/(?!^\+)[^\d]/g, '')}`);
  href('emailLink', `mailto:${COMPANY.email}`);

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
}

/* ── Legal placeholders ─────────────────────────────────────────────────── */
function initLegal() {
  const slots = document.querySelectorAll('[data-legal]');
  if (!slots.length) return;

  slots.forEach((el) => {
    const value = LEGAL[el.dataset.legal];
    if (value) el.textContent = value;
  });

  // An unfilled value is styled as a placeholder rather than left looking like
  // a real term. On a legal page that difference is worth being loud about.
  slots.forEach((el) => {
    if (el.textContent.trim().startsWith('[')) el.setAttribute('data-placeholder', '');
  });
}

/* ── Sticky header ──────────────────────────────────────────────────────── */
function initNavScroll() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  let ticking = false;
  const update = () => {
    nav.classList.toggle('is-stuck', window.scrollY > 12);
    ticking = false;
  };
  update();
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });
}

/* ── Mobile menu ────────────────────────────────────────────────────────── */
function initMobileNav() {
  const toggle = document.getElementById('navToggle');
  const drawer = document.getElementById('mobileNav');
  if (!toggle || !drawer) return;

  const close = () => {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    drawer.hidden = true;
    document.body.style.overflow = '';
  };

  const open = () => {
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    drawer.hidden = false;
    document.body.style.overflow = 'hidden';
  };

  toggle.addEventListener('click', () => {
    toggle.getAttribute('aria-expanded') === 'true' ? close() : open();
  });

  // A tap on the dimmed area outside the panel closes it.
  drawer.addEventListener('click', (e) => { if (e.target === drawer) close(); });
  drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      close();
      toggle.focus();
    }
  });
  // Leaving mobile width with the drawer open would strand a hidden overflow lock.
  window.matchMedia('(min-width: 981px)').addEventListener('change', (e) => { if (e.matches) close(); });
}

/* ── Smooth in-page links ───────────────────────────────────────────────── */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      // Move focus too, or keyboard users stay where they were.
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  });
}

/* ── Scroll reveal ──────────────────────────────────────────────────────── */
function initReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      // Stagger siblings slightly so a grid arrives as a wave, not a slab.
      const siblings = [...entry.target.parentElement.children].filter((c) => c.classList.contains('reveal'));
      const delay = Math.min(siblings.indexOf(entry.target), 5) * 60;
      entry.target.style.transitionDelay = `${delay}ms`;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

  items.forEach((el) => io.observe(el));
}

/* ── Count-up numbers ───────────────────────────────────────────────────── */
function initCounters() {
  const nums = document.querySelectorAll('[data-count]');
  if (!nums.length) return;

  const render = (el, value) => {
    const suffix = el.dataset.suffix || '';
    el.textContent = value.toLocaleString('en') + suffix;
  };

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    nums.forEach((el) => render(el, Number(el.dataset.count)));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const end = Number(el.dataset.count);
      const started = performance.now();
      const dur = 1100;

      const tick = (now) => {
        const t = Math.min((now - started) / dur, 1);
        // easeOutCubic — fast start, settles rather than stopping dead.
        render(el, Math.round(end * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      io.unobserve(el);
    });
  }, { threshold: 0.5 });

  nums.forEach((el) => io.observe(el));
}

/* ── Sparklines ─────────────────────────────────────────────────────────────
   Drawn from a data attribute rather than shipped as SVG files, so a source
   row is one line of HTML and the shape stays in the markup that owns it.   */
function initSparklines() {
  document.querySelectorAll('[data-spark]').forEach((host) => {
    const values = host.dataset.spark.split(',').map(Number);
    if (values.length < 2) return;

    const w = 74;
    const h = 22;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;

    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${points.join(' L')}`);
    svg.appendChild(path);
    host.appendChild(svg);
  });
}

/* ── Workflow tabs ──────────────────────────────────────────────────────── */
function initSteps() {
  const tabs = [...document.querySelectorAll('.steps__tab')];
  if (!tabs.length) return;

  const show = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (!panel) return;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => show(tab));

    // Arrow-key movement is expected of a tablist, and without it the tabs are
    // reachable but not operable the way a screen-reader user will try.
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      show(next);
      next.focus();
    });
  });
}

/* ── FAQ accordion ──────────────────────────────────────────────────────── */
function initFaq() {
  document.querySelectorAll('.faq__q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    });
  });
}

/* ── Trend → content demo ───────────────────────────────────────────────────
   A scripted walk-through of the real flow. There is no model call here and
   the copy is fixed — the point is to show the shape of the interaction, not
   to pretend the marketing page is running the product.                     */
const DRAFTS = {
  linkedin: {
    tag: 'LinkedIn post',
    hook: '"Your next support hire might not be a person."',
    body: [
      'Three small firms we spoke to this month moved their first-response queue to an assistant — and kept every human on the tickets that actually needed one.',
      'The interesting part was not the cost saving. It was that response times stopped depending on who was in the office that day.',
    ],
  },
  x: {
    tag: 'X post',
    hook: '"Small businesses aren\'t replacing support staff. They\'re replacing the queue."',
    body: [
      'First response goes to an assistant. Anything with a real problem behind it goes to a person, faster than before, because the queue is already sorted.',
    ],
  },
  instagram: {
    tag: 'Instagram caption',
    hook: 'The bit nobody tells you about AI support ↓',
    body: [
      'It is not about replacing your team. It is about your customer not waiting until Tuesday because you were busy on Monday.',
      'Swipe for the three things worth automating first — and the one you should not.',
    ],
  },
};

const STAGES = [
  'Reading the conversation across Reddit and X',
  'Checking it against your brand and audience',
  'Pulling your voice settings and guardrails',
  'Writing a first draft',
];

function initDemo() {
  const root = document.querySelector('.demo');
  const run = document.getElementById('demoRun');
  const again = document.getElementById('demoAgain');
  const stage = document.getElementById('demoStage');
  const statusText = document.getElementById('demoStatusText');
  const actions = document.getElementById('demoActions');
  const platform = document.getElementById('demoPlatform');
  if (!root || !run || !stage || !statusText || !actions || !platform) return;

  let running = false;

  const renderResult = () => {
    const draft = DRAFTS[platform.value] || DRAFTS.linkedin;
    stage.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'result';

    const tag = document.createElement('span');
    tag.className = 'result__tag';
    tag.textContent = draft.tag;
    wrap.appendChild(tag);

    const hook = document.createElement('p');
    hook.className = 'result__hook';
    hook.textContent = draft.hook;
    wrap.appendChild(hook);

    draft.body.forEach((para) => {
      const p = document.createElement('p');
      p.className = 'result__body';
      p.textContent = para;
      wrap.appendChild(p);
    });

    stage.appendChild(wrap);
    actions.hidden = false;
    root.classList.remove('is-working');
    root.classList.add('is-done');
    statusText.textContent = 'Draft ready — yours to edit';
    run.textContent = 'Create content';
    running = false;
  };

  const start = () => {
    if (running) return;
    running = true;
    root.classList.remove('is-done');
    root.classList.add('is-working');
    actions.hidden = true;
    run.textContent = 'Working…';
    statusText.textContent = 'Analysing the trend';

    // Reduced motion: skip the theatre, show the outcome.
    if (prefersReducedMotion) {
      stage.innerHTML = '';
      renderResult();
      return;
    }

    const list = document.createElement('ul');
    list.className = 'think';
    stage.innerHTML = '';
    stage.appendChild(list);

    const rows = STAGES.map((label) => {
      const li = document.createElement('li');
      const tick = document.createElement('span');
      tick.className = 'think__tick';
      const text = document.createElement('span');
      text.textContent = label;
      li.append(tick, text);
      list.appendChild(li);
      return li;
    });

    rows.forEach((li, i) => {
      setTimeout(() => li.classList.add('is-in'), i * 420);
      setTimeout(() => {
        li.classList.add('is-done');
        li.querySelector('.think__tick').textContent = '✓';
      }, i * 420 + 560);
    });

    setTimeout(renderResult, rows.length * 420 + 700);
  };

  run.addEventListener('click', start);
  again.addEventListener('click', start);
  // Changing platform after a result would leave the wrong draft on screen.
  platform.addEventListener('change', () => { if (root.classList.contains('is-done')) renderResult(); });
}

/* ── Placeholder links ──────────────────────────────────────────────────────
   Marked in the markup rather than silently pointing at "#", so it is obvious
   in the DOM which destinations still need wiring up before launch.         */
function initPlaceholderLinks() {
  document.querySelectorAll('[data-placeholder-link]').forEach((a) => {
    a.setAttribute('aria-describedby', 'placeholder-note');
    a.addEventListener('click', (e) => e.preventDefault());
  });

  if (document.getElementById('placeholder-note')) return;
  const note = document.createElement('span');
  note.id = 'placeholder-note';
  note.hidden = true;
  note.textContent = 'Link not yet available';
  document.body.appendChild(note);
}

/* ── Go ─────────────────────────────────────────────────────────────────── */
function init() {
  initCompany();
  initLegal();
  initNavScroll();
  initMobileNav();
  initSmoothScroll();
  initReveal();
  initCounters();
  initSparklines();
  initSteps();
  initFaq();
  initDemo();
  initPlaceholderLinks();
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();
