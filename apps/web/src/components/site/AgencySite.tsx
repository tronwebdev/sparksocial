import type { CSSProperties } from 'react';
import { SiteContactForm } from './SiteContactForm';

/**
 * An agency's public website — what `<slug>.sparkai.social` and a bound
 * custom domain render.
 *
 * One page, styled by the launch wizard's choices: the colours, the title
 * font, the template (three looks) and the layout style (where the hero puts
 * its weight). The copy comes from `agency.site.generate` and is editable.
 *
 * A server component with one client island, the contact form. It loads no
 * auth SDK and makes no third-party request: the fonts are the app's own and
 * the logo arrives inlined, fetched server-side so Clerk's URL — which carries
 * the org id — never reaches the visitor.
 */

export interface PublicSite {
  slug: string;
  name: string;
  tagline: string;
  contact: { email?: string; phone?: string };
  style: { colors: string[]; titleFont: string; layout: number; template: number };
  content: {
    headline: string;
    subheadline: string;
    services: Array<{ title: string; description: string }>;
    about: string;
    ctaLabel: string;
    contactHeading: string;
  };
  hasLogo: boolean;
}

const DEFAULT_COLORS = ['#3157D6', '#A341FF', '#93E1F2'];

const TITLE_FONT: Record<string, string> = {
  Asgard: 'var(--ss-font-display), var(--ss-font-sans), system-ui, sans-serif',
  Inter: 'var(--ss-font-sans), system-ui, sans-serif',
  'Space Grotesk': 'var(--ss-font-sans), system-ui, sans-serif',
  'Playfair Display': 'Georgia, "Times New Roman", serif',
  'DM Serif': 'Georgia, "Times New Roman", serif',
};

/** Readable text on a colour: dark ink on light swatches, white on dark ones. */
function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0C0C0C' : '#FFFFFF';
}

export function AgencySite({ site, logo, sendLead }: { site: PublicSite; logo?: string; sendLead: Parameters<typeof SiteContactForm>[0]['action'] }) {
  const [primary = DEFAULT_COLORS[0]!, secondary = primary, accent = secondary] =
    site.style.colors.length ? site.style.colors : DEFAULT_COLORS;
  const template = site.style.template % 3;
  const layout = site.style.layout % 3;
  const titleFont = TITLE_FONT[site.style.titleFont] ?? TITLE_FONT.Inter!;
  const { content } = site;

  const vars = { '--site-primary': primary, '--site-on-primary': onColor(primary) } as CSSProperties;

  /* The three templates: clean on white, bold on ink, soft on a tint of the palette. */
  const hero: CSSProperties =
    template === 1
      ? { background: '#0C0C0C', color: '#FFFFFF' }
      : template === 2
        ? { background: `linear-gradient(135deg, ${primary}22 0%, ${secondary}26 55%, ${accent}30 100%)`, color: '#0C0C0C' }
        : { background: '#FFFFFF', color: '#0C0C0C' };
  const muted = template === 1 ? 'rgba(255,255,255,0.7)' : '#5B5B5B';

  const Mark = ({ size }: { size: number }) =>
    logo ? (
      // eslint-disable-next-line @next/next/no-img-element -- an inlined data URI, not a remote image
      <img src={logo} alt={`${site.name} logo`} width={size} height={size} className="rounded-[10px] object-contain" style={{ width: size, height: size }} />
    ) : (
      <span
        aria-hidden
        className="flex items-center justify-center rounded-[10px] font-bold"
        style={{ width: size, height: size, background: primary, color: onColor(primary), fontSize: size * 0.45 }}
      >
        {site.name.slice(0, 1).toUpperCase()}
      </span>
    );

  const cta = (
    <a
      href="#contact"
      className="inline-flex h-[52px] items-center rounded-[12px] px-[26px] text-16 font-semibold transition-opacity hover:opacity-90"
      style={{ background: 'var(--site-primary)', color: 'var(--site-on-primary)' }}
    >
      {content.ctaLabel}
    </a>
  );

  const heroText = (
    <div className={layout === 1 ? 'mx-auto max-w-[760px] text-center' : 'max-w-[640px]'}>
      {/* Not when it is the headline again, which a model will sometimes write. */}
      {site.tagline && site.tagline.trim().toLowerCase() !== content.headline.trim().toLowerCase() ? (
        <p className="text-14 font-semibold uppercase tracking-[0.08em]" style={{ color: template === 1 ? accent : primary }}>
          {site.tagline}
        </p>
      ) : null}
      <h1 className="mt-[14px] text-40 font-bold leading-[1.1] sm:text-48" style={{ fontFamily: titleFont }}>
        {content.headline}
      </h1>
      {content.subheadline ? (
        <p className="mt-[18px] text-18 leading-[1.5]" style={{ color: muted }}>
          {content.subheadline}
        </p>
      ) : null}
      <div className="mt-[28px]">{cta}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white font-sans text-ink" style={vars}>
      <header className="border-b" style={{ ...hero, borderColor: template === 1 ? 'rgba(255,255,255,0.1)' : 'rgba(131,131,131,0.15)' }}>
        <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-4 py-[18px] sm:px-6">
          <span className="flex min-w-0 items-center gap-[12px]">
            <Mark size={40} />
            <span className="truncate text-18 font-bold" style={{ fontFamily: titleFont }}>
              {site.name}
            </span>
          </span>
          <a href="#contact" className="shrink-0 text-15 font-semibold underline-offset-4 hover:underline">
            Contact
          </a>
        </div>
      </header>

      {/* ── hero: split, centred, or text beside the services ─────────── */}
      <section style={hero}>
        <div className="mx-auto max-w-[1120px] px-4 py-[72px] sm:px-6 sm:py-[96px]">
          {layout === 0 ? (
            <div className="grid items-center gap-[48px] md:grid-cols-[1.3fr_1fr]">
              {heroText}
              <div
                aria-hidden
                className="hidden aspect-square w-full max-w-[380px] justify-self-end rounded-[28px] md:flex md:items-center md:justify-center"
                style={{ background: `linear-gradient(150deg, ${primary}, ${secondary} 60%, ${accent})` }}
              >
                <span className="rounded-[22px] bg-white/90 p-[18px] shadow-lg">
                  <Mark size={120} />
                </span>
              </div>
            </div>
          ) : layout === 2 ? (
            <div className="grid gap-[40px] md:grid-cols-[1.2fr_1fr]">
              {heroText}
              <ul className="grid content-start gap-[12px]">
                {content.services.slice(0, 3).map((s) => (
                  <li
                    key={s.title}
                    className="rounded-[14px] p-[18px]"
                    style={{ background: template === 1 ? 'rgba(255,255,255,0.06)' : '#FFFFFF', boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.2)' }}
                  >
                    <p className="text-16 font-semibold">{s.title}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            heroText
          )}
        </div>
      </section>

      {/* ── services ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1120px] px-4 py-[72px] sm:px-6">
        <h2 className="text-28 font-bold" style={{ fontFamily: titleFont }}>
          What we do
        </h2>
        <ul className="mt-[28px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {content.services.map((s, i) => (
            <li key={s.title} className="rounded-[16px] bg-white p-[24px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(131,131,131,0.22)' }}>
              <span
                aria-hidden
                className="flex h-[40px] w-[40px] items-center justify-center rounded-[10px] text-15 font-bold"
                /* Primary and secondary only: the third swatch is often a pale accent, too light for a numeral. */
                style={{ background: `${[primary, secondary][i % 2]}1F`, color: [primary, secondary][i % 2] }}
              >
                {i + 1}
              </span>
              <p className="mt-[16px] text-18 font-semibold">{s.title}</p>
              {s.description ? <p className="mt-[8px] text-15 leading-[1.55] text-ink-muted">{s.description}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      {content.about ? (
        <section style={{ background: template === 1 ? '#F4F5F7' : `${primary}0D` }}>
          <div className="mx-auto max-w-[820px] px-4 py-[64px] sm:px-6">
            <h2 className="text-28 font-bold" style={{ fontFamily: titleFont }}>
              About {site.name}
            </h2>
            <p className="mt-[16px] whitespace-pre-line text-17 leading-[1.65] text-ink-muted">{content.about}</p>
          </div>
        </section>
      ) : null}

      {/* ── contact ───────────────────────────────────────────────────── */}
      <section id="contact" className="mx-auto max-w-[1120px] scroll-mt-[24px] px-4 py-[72px] sm:px-6">
        <div className="grid gap-[40px] md:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-28 font-bold" style={{ fontFamily: titleFont }}>
              {content.contactHeading || 'Get in touch'}
            </h2>
            <p className="mt-[12px] text-16 leading-[1.6] text-ink-muted">
              Leave your details and {site.name} will get back to you.
            </p>
            <ul className="mt-[24px] space-y-[8px] text-16">
              {site.contact.email ? (
                <li>
                  <a href={`mailto:${site.contact.email}`} className="font-semibold underline-offset-4 hover:underline">
                    {site.contact.email}
                  </a>
                </li>
              ) : null}
              {site.contact.phone ? (
                <li>
                  <a href={`tel:${site.contact.phone.replace(/[^\d+]/g, '')}`} className="font-semibold underline-offset-4 hover:underline">
                    {site.contact.phone}
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
          <SiteContactForm action={sendLead} ctaLabel={content.ctaLabel} />
        </div>
      </section>

      <footer className="border-t" style={{ borderColor: 'rgba(131,131,131,0.15)' }}>
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-[24px] text-14 text-ink-muted sm:px-6">
          <span>
            © {new Date().getFullYear()} {site.name}
          </span>
          <span>Built with SparkSocial</span>
        </div>
      </footer>
    </div>
  );
}
