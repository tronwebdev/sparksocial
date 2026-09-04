import type { Config } from 'tailwindcss';

/**
 * Every colour here is a `var(--ss-*)` and **no hex appears in this file**. That is
 * the rule that makes light/dark a single class toggle rather than a parallel set
 * of `dark:` variants on every component — see `src/styles/tokens.css`.
 *
 * shadcn's conventional names (`background`, `foreground`, `ring`, `input`, …) are
 * mapped onto the same variables so `npx shadcn add <x>` output drops in without
 * rewriting, instead of growing a second colour vocabulary alongside ours.
 *
 * ── Why every colour goes through `alpha()` ───────────────────────────────
 *
 * A bare `var(--x)` cannot take Tailwind's opacity modifier. Tailwind builds
 * `bg-warn/10` by injecting an alpha channel into the colour, which it can only
 * do if the value tells it where the alpha goes — so with a plain variable it
 * emits something invalid and the browser resolves it to **transparent**.
 *
 * That was live for a long time and invisible precisely because it fails open:
 * every tinted panel in the product — the amber "held for review" blocks, the
 * green publish receipts, the red rollback notices, 36 utilities across 10 files
 * — rendered with no fill at all. Found by measuring a computed style in the
 * browser (`bg-warn/10` → `rgba(0, 0, 0, 0)`), not by reading the CSS.
 *
 * `color-mix` fixes it without touching `tokens.css`, which matters: 22 places
 * in `.tsx` use `var(--ss-*)` directly, and switching the variables to
 * space-separated RGB channels — the other standard fix — would have broken
 * every one of them. With no modifier Tailwind substitutes `1`, so
 * `calc(1 * 100%)` returns the colour exactly as before.
 */
const alpha = (token: string) => `color-mix(in srgb, var(${token}) calc(<alpha-value> * 100%), transparent)`;
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // shadcn aliases → SparkSocial tokens
        background: alpha('--ss-bg'),
        foreground: alpha('--ss-fg'),
        border: alpha('--ss-border'),
        input: alpha('--ss-field'),
        ring: alpha('--ss-ring'),
        primary: {
          DEFAULT: alpha('--ss-primary'),
          foreground: alpha('--ss-fg-on-primary'),
        },
        muted: {
          DEFAULT: alpha('--ss-surface-muted'),
          foreground: alpha('--ss-fg-muted'),
        },
        accent: {
          DEFAULT: alpha('--ss-accent-cyan'),
          foreground: alpha('--ss-fg'),
        },
        destructive: {
          DEFAULT: alpha('--ss-danger'),
          foreground: alpha('--ss-white'),
        },

        // SparkSocial semantics
        surface: {
          DEFAULT: alpha('--ss-surface'),
          muted: alpha('--ss-surface-muted'),
        },
        canvas: alpha('--ss-canvas'),
        ink: {
          DEFAULT: alpha('--ss-fg'),
          muted: alpha('--ss-fg-muted'),
          subtle: alpha('--ss-fg-subtle'),
          placeholder: alpha('--ss-fg-placeholder'),
          heading: alpha('--ss-fg-heading'),
        },
        brand: {
          purple: alpha('--ss-accent-purple'),
          cyan: alpha('--ss-accent-cyan'),
          pink: alpha('--ss-accent-pink'),
        },
        // Brand Home's three metric tints. Already rgba, so they go in raw
        // rather than through `alpha()` — the opacity is the design's own.
        'kpi-1': 'var(--ss-dash-kpi-1)',
        'kpi-2': 'var(--ss-dash-kpi-2)',
        'kpi-3': 'var(--ss-dash-kpi-3)',
        'seg-track': 'var(--ss-dash-seg-track)',
        'cal-sunday': 'var(--ss-cal-sunday)',
        'cal-amber': 'var(--ss-cal-day-amber)',
        'cal-cyan': 'var(--ss-cal-day-cyan)',
        'cal-purple': 'var(--ss-cal-day-purple)',
        'attn': 'var(--ss-cc-attn-bg)',
        'attn-ring': 'var(--ss-cc-attn-ring)',

        success: alpha('--ss-success'),
        warn: alpha('--ss-warn'),
        info: alpha('--ss-info'),
      },

      fontFamily: {
        sans: ['var(--ss-font-sans)', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--ss-font-display)', 'Comfortaa', 'sans-serif'],
      },

      /**
       * The project type scale. Onest at these seven sizes is the whole
       * vocabulary — headings, sub-headings, primary and secondary text, labels,
       * field text. Only size, weight and colour change between them; family,
       * line-height and letter-spacing never do.
       *
       * `line-height: 100%` and `letter-spacing: 0` are baked into every step so
       * a caller cannot get them wrong by omission. That is the point of naming
       * them at all: `text-18` is a contract, `text-[18px]` is a guess that
       * silently inherits whatever line-height is in scope.
       *
       * Named by px because the design specifies px — a `sm`/`base`/`lg` scale
       * would need a translation table nobody maintains. Tailwind's own
       * `text-sm`/`text-base` still exist; prefer these for anything the design
       * governs.
       */
      fontSize: {
        13: ['13px', { lineHeight: '100%', letterSpacing: '0' }],
        14: ['14px', { lineHeight: '100%', letterSpacing: '0' }],
        16: ['16px', { lineHeight: '100%', letterSpacing: '0' }],
        18: ['18px', { lineHeight: '100%', letterSpacing: '0' }],
        20: ['20px', { lineHeight: '100%', letterSpacing: '0' }],
        22: ['22px', { lineHeight: '100%', letterSpacing: '0' }],
        26: ['26px', { lineHeight: '100%', letterSpacing: '0' }],
      },

      // Measured across the prototype: 10px is the default by a wide margin
      // (413 uses), 15 is inputs, 20 is the primary CTA, 30 is the canvas card.
      borderRadius: {
        DEFAULT: '10px',
        md: '12px',
        lg: '15px',
        xl: '20px',
        '2xl': '30px',
        '3xl': '40px',
      },

      // Keys must not collide with `colors` above — `canvas` is already a colour,
      // so the gradient is `canvas-wash`. A shared key makes `bg-canvas` ambiguous.
      backgroundImage: {
        'nav-active': 'var(--ss-grad-nav-active)',
        'agent-banner': 'var(--ss-grad-agent-banner)',
        'post-card': 'var(--ss-grad-post-card)',
        'canvas-wash': 'var(--ss-grad-canvas)',
        'cta-wash': 'var(--ss-grad-cta)',
        'brand-wash': 'var(--ss-grad-brand)',
        'progress-wash': 'var(--ss-grad-progress)',
      },

      boxShadow: {
        hairline: 'var(--ss-shadow-hairline)',
        card: 'var(--ss-shadow-card)',
        menu: 'var(--ss-shadow-menu)',
        overlay: 'var(--ss-shadow-overlay)',
      },

      spacing: {
        rail: 'var(--ss-rail)',
        // Brand Home's vertical cascade — see the block in tokens.css. Named
        // because six components share the grid and an arbitrary value in one
        // of them has nothing to be checked against.
        'dash-gutter': 'var(--ss-dash-gutter)',
        'dash-head-top': 'var(--ss-dash-head-top)',
        'dash-head-bottom': 'var(--ss-dash-head-bottom)',
        'dash-band-top': 'var(--ss-dash-band-top)',
        'dash-band-gap': 'var(--ss-dash-band-gap)',
        'dash-card-gap': 'var(--ss-dash-card-gap)',
        'dash-col-gap': 'var(--ss-dash-col-gap)',
        'dash-label-gap': 'var(--ss-dash-label-gap)',
        'dash-banner': 'var(--ss-dash-banner)',
        'dash-kpi': 'var(--ss-dash-kpi)',
        'dash-tab-top': 'var(--ss-dash-tab-top)',
        'dash-tab-bottom': 'var(--ss-dash-tab-bottom)',
        'dash-row-inset': 'var(--ss-dash-row-inset)',
        'dash-row': 'var(--ss-dash-row)',
        'cal-inset': 'var(--ss-cal-inset)',
        'cal-cell': 'var(--ss-cal-cell)',
        'cal-cell-gap': 'var(--ss-cal-cell-gap)',
        'dash-row-body': 'var(--ss-dash-row-body)',
        'dash-panel-inset': 'var(--ss-dash-panel-inset)',
        // Command Center chrome — see the block in tokens.css.
        'cc-chrome-x': 'var(--ss-cc-chrome-x)',
        'cc-chrome-r': 'var(--ss-cc-chrome-r)',
        'cc-top-mark': 'var(--ss-cc-top-mark)',
        'cc-top-back': 'var(--ss-cc-top-back)',
        'cc-top-pill': 'var(--ss-cc-top-pill)',
        'cc-chrome-h': 'var(--ss-cc-chrome-h)',
        'cc-content-x': 'var(--ss-cc-content-x)',
        'cc-content-top': 'var(--ss-cc-content-top)',
        'cc-chrome-gap': 'var(--ss-cc-chrome-gap)',
        'cc-band-x': 'var(--ss-cc-band-x)',
        'cc-band-gap': 'var(--ss-cc-band-gap)',
        // Auth geometry, measured from the Figma captures — see tokens.css.
        'auth-card': 'var(--ss-auth-card)',
        'auth-gutter': 'var(--ss-auth-gutter)',
        'auth-control': 'var(--ss-auth-control)',
        'auth-glass-pad': 'var(--ss-auth-glass-pad)',
        'auth-glass': 'var(--ss-auth-glass)',
      },

      animation: {
        'float-a': 'ss-float-a 7s ease-in-out infinite',
        'float-b': 'ss-float-b 8s ease-in-out infinite',
        breathe: 'ss-breathe 4s ease-in-out infinite',
        twinkle: 'ss-twinkle 3s ease-in-out infinite',
        'menu-in': 'ss-menu-in 0.18s ease-out',
        'toast-in': 'ss-toast-in 0.22s ease-out',
        'drawer-in': 'ss-drawer-in 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
        'drawer-in-left': 'ss-drawer-in-left 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
        // F5's ten. Durations and easings are the prototypes' own where they
        // applied them inline; the four they only declared get timings picked to
        // match the ones they did.
        shimmer: 'ss-shimmer 1.6s ease-in-out infinite',
        'fade-in': 'ss-fade-in 0.2s ease',
        'modal-in': 'ss-modal-in 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
        'pop-in': 'ss-pop-in 0.35s ease',
        pulse: 'ss-pulse 1.8s ease-in-out infinite',
        dot: 'ss-dot 1.1s ease-in-out infinite',
        spin: 'ss-spin 0.8s linear infinite',
        // The prototypes' own 6s is for a decorative ring, not a busy spinner.
        'spin-slow': 'ss-spin 6s linear infinite',
        upload: 'ss-upload 2.4s ease-out forwards',
        'card-out': 'ss-card-out 0.2s ease forwards',
      },

      transitionTimingFunction: {
        // The prototype's nav-glow easing. Used anywhere something slides.
        shell: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
