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
        success: alpha('--ss-success'),
        warn: alpha('--ss-warn'),
        info: alpha('--ss-info'),
      },

      fontFamily: {
        sans: ['var(--ss-font-sans)', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--ss-font-display)', 'Comfortaa', 'sans-serif'],
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
        'canvas-wash': 'var(--ss-grad-canvas)',
        'cta-wash': 'var(--ss-grad-cta)',
        'brand-wash': 'var(--ss-grad-brand)',
      },

      boxShadow: {
        hairline: 'var(--ss-shadow-hairline)',
        card: 'var(--ss-shadow-card)',
        menu: 'var(--ss-shadow-menu)',
        overlay: 'var(--ss-shadow-overlay)',
      },

      spacing: {
        rail: 'var(--ss-rail)',
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
