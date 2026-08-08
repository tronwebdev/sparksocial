import localFont from 'next/font/local';

/**
 * `next/font/local` rather than `public/` + a hand-written `@font-face`.
 *
 * The reason that matters here specifically: the loader computes `size-adjust`
 * fallback metrics, which removes the layout shift between the fallback and the
 * real face. P0's exit criterion is a pixel-accurate side-by-side against the
 * prototype, and a font-swap reflow desyncs every measurement in that comparison.
 * It also self-hosts with an immutable hashed URL and emits the preload link.
 *
 * Onest is variable (100–1000), so the axis is exposed rather than shipping
 * static cuts — the prototype uses 400/500/600/700 across its screens.
 */

export const onest = localFont({
  src: '../fonts/Onest-Variable.ttf',
  weight: '100 1000',
  variable: '--ss-font-sans',
  display: 'swap',
  fallback: ['-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
});

/**
 * Display face. Used for exactly three things in the prototype: the "Sparksocial"
 * wordmark (27.49px in the shell, 37.5px on the login card) and Auth's two hero
 * titles (48.5 / 39.2px). Not a body font — never set it on a paragraph.
 */
export const mollwish = localFont({
  src: '../fonts/CS-Mollwish.otf',
  weight: '400',
  variable: '--ss-font-display',
  display: 'swap',
  fallback: ['Comfortaa', 'sans-serif'],
});
