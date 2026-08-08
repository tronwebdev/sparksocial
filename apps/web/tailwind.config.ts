import type { Config } from 'tailwindcss';

/**
 * Every colour here is a `var(--ss-*)` and **no hex appears in this file**. That is
 * the rule that makes light/dark a single class toggle rather than a parallel set
 * of `dark:` variants on every component — see `src/styles/tokens.css`.
 *
 * shadcn's conventional names (`background`, `foreground`, `ring`, `input`, …) are
 * mapped onto the same variables so `npx shadcn add <x>` output drops in without
 * rewriting, instead of growing a second colour vocabulary alongside ours.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // shadcn aliases → SparkSocial tokens
        background: 'var(--ss-bg)',
        foreground: 'var(--ss-fg)',
        border: 'var(--ss-border)',
        input: 'var(--ss-field)',
        ring: 'var(--ss-ring)',
        primary: {
          DEFAULT: 'var(--ss-primary)',
          foreground: 'var(--ss-fg-on-primary)',
        },
        muted: {
          DEFAULT: 'var(--ss-surface-muted)',
          foreground: 'var(--ss-fg-muted)',
        },
        accent: {
          DEFAULT: 'var(--ss-accent-cyan)',
          foreground: 'var(--ss-fg)',
        },
        destructive: {
          DEFAULT: 'var(--ss-danger)',
          foreground: 'var(--ss-white)',
        },

        // SparkSocial semantics
        surface: {
          DEFAULT: 'var(--ss-surface)',
          muted: 'var(--ss-surface-muted)',
        },
        canvas: 'var(--ss-canvas)',
        ink: {
          DEFAULT: 'var(--ss-fg)',
          muted: 'var(--ss-fg-muted)',
          subtle: 'var(--ss-fg-subtle)',
          placeholder: 'var(--ss-fg-placeholder)',
          heading: 'var(--ss-fg-heading)',
        },
        brand: {
          purple: 'var(--ss-accent-purple)',
          cyan: 'var(--ss-accent-cyan)',
          pink: 'var(--ss-accent-pink)',
        },
        success: 'var(--ss-success)',
        warn: 'var(--ss-warn)',
        info: 'var(--ss-info)',
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
