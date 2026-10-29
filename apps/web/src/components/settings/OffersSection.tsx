'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { invoke } from '@/lib/tools';
import { useSelectedGenome } from '@/lib/useSelectedGenome';
import { userMessage } from '@/lib/errorCopy';

/**
 * What the brand is actually selling, and the line that asks for it.
 *
 * ── Why this screen did not exist ─────────────────────────────────────────
 *
 * `GenomeOffer` has held `products: Array<{ name, price?, cta_url? }>` since
 * the schema was written, and nothing in the product could write a second
 * entry — or a first one. The only reachable offer field was `primary_cta`,
 * and only through the campaign wizard's missing-facts prompt, which appears
 * mid-wizard and vanishes once answered. So a brand selling four things could
 * describe none of them, and the one field it could set had to be found by
 * accident.
 *
 * Fourteen playbooks read `genome:offer.primary_cta` as a `source` beat —
 * meaning "use the business's actual words, never invent one" — so this is not
 * decoration. A brand with no CTA has fourteen formats it cannot draft.
 *
 * ── The panel this replaced ──────────────────────────────────────────────
 *
 * Brand Kits had an `OfferPanel` doing half of this: it set `primary_cta` and
 * nothing else, and it could not show what was already stored — its own
 * comment said so, because when it was written no tool returned a genome's
 * offer. This screen was added without noticing it, which left two controls
 * over one field in two places, neither hinting the other existed.
 *
 * `genome.get` returns the offer now. That is what made this screen possible
 * and what made the old one actively misleading: it rendered an empty box
 * whether or not a CTA was set, so it read as "none" for a brand that had one.
 * It is gone, and this is the one place.
 *
 * ── Why products are replaced wholesale ───────────────────────────────────
 *
 * `genome.offer.set` takes the whole array, so this editor holds the list in
 * state and saves all of it at once. The alternative — a tool per row — would
 * need stable product ids, and products have none: they are a list of names on
 * a genome, not rows in a table. Editing in place and saving once matches what
 * the data actually is, and makes "add three products" one write rather than
 * three chances to half-finish.
 */

interface Product {
  name: string;
  price?: string;
  cta_url?: string;
}

/** The genome's offer, as `genome.get` returns it. */
interface Offer {
  products?: Product[];
  primary_cta?: string;
}

export function OffersSection() {
  const { genome, loading: genomeLoading, error: genomeError } = useSelectedGenome();
  const genomeId = genome?.genomeId;

  const [products, setProducts] = useState<Product[]>([]);
  const [cta, setCta] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!genomeId) return;
    const res = await invoke<{ genome: { offer?: Offer } }>('genome.get', { genomeId });
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? userMessage(res.error) : 'You cannot read this brand.');
      setLoaded(true);
      return;
    }
    const offer = res.output.genome.offer ?? {};
    setProducts(offer.products ?? []);
    setCta(offer.primary_cta ?? '');
    setLoaded(true);
  }, [genomeId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * A blank row is not an offer. Rows with no name are dropped on save rather
   * than rejected: an empty row at the bottom is how people leave an editor
   * they have finished with, and refusing to save over it would be scolding
   * somebody for tidiness.
   */
  async function save() {
    if (!genomeId || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);

    const cleaned = products
      .map((p) => ({
        name: p.name.trim(),
        ...(p.price?.trim() ? { price: p.price.trim() } : {}),
        ...(p.cta_url?.trim() ? { cta_url: p.cta_url.trim() } : {}),
      }))
      .filter((p) => p.name.length > 0);

    const res = await invoke(
      'genome.offer.set',
      { genomeId, offer: { products: cleaned, primary_cta: cta.trim() } },
      crypto.randomUUID(),
    );
    setBusy(false);
    if (res.status !== 'succeeded') {
      setError(res.status === 'failed' ? userMessage(res.error) : 'You do not have permission to change this brand.');
      return;
    }
    // Reflect what was stored, not what was typed — see `brand.settings.patch`,
    // which returned the input and reported a write that never happened.
    setProducts(cleaned);
    setSaved(true);
  }

  const update = (i: number, patch: Partial<Product>) =>
    setProducts((list) => list.map((p, n) => (n === i ? { ...p, ...patch } : p)));

  if (genomeLoading || !loaded) {
    return <p className="text-16 text-ink-muted">Loading…</p>;
  }

  if (genomeError || !genomeId) {
    return <p className="text-16 text-ink-muted">{genomeError ?? 'Pick a brand first.'}</p>;
  }

  return (
    <div className="flex flex-col gap-[28px]">
      {/* ── The call to action ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-18 font-semibold text-ink">Call to action</h2>
        <p className="mt-[6px] max-w-[62ch] text-15 text-ink-muted">
          The line that closes a post &mdash; &ldquo;Book now&rdquo;, &ldquo;DM for prices&rdquo;. SPARK uses it
          word for word and will not invent one, so fourteen post formats cannot be drafted until it is set.
        </p>
        <Input
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          placeholder="Book a free demo"
          aria-label="Primary call to action"
          className="mt-[14px] max-w-[420px]"
        />
      </section>

      {/* ── What the brand sells ────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-18 font-semibold text-ink">Offers</h2>
          <span className="text-13 text-ink-muted">
            {products.length === 0
              ? 'None yet'
              : `${products.length} offer${products.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <p className="mt-[6px] max-w-[62ch] text-15 text-ink-muted">
          Each product, service or package this brand sells. SPARK writes about these by name, and a campaign
          can point at any one of them.
        </p>

        <ul className="mt-[16px] flex flex-col gap-[12px]">
          {products.map((p, i) => (
            <li
              key={i}
              className="rounded-[12px] bg-white p-[16px] shadow-[inset_0_0_0_1px_rgba(131,131,131,0.22)]"
            >
              <div className="flex flex-wrap items-end gap-[12px]">
                <label className="grid min-w-[200px] flex-1 gap-[6px]">
                  <span className="text-13 font-medium text-ink">Name</span>
                  <Input
                    value={p.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="Revenue Workforce plan"
                  />
                </label>
                <label className="grid w-[140px] gap-[6px]">
                  <span className="text-13 font-medium text-ink">Price</span>
                  <Input
                    value={p.price ?? ''}
                    onChange={(e) => update(i, { price: e.target.value })}
                    placeholder="£49/mo"
                  />
                </label>
                <label className="grid min-w-[200px] flex-1 gap-[6px]">
                  <span className="text-13 font-medium text-ink">Link</span>
                  <Input
                    value={p.cta_url ?? ''}
                    onChange={(e) => update(i, { cta_url: e.target.value })}
                    placeholder="https://…"
                    type="url"
                  />
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setProducts((list) => list.filter((_, n) => n !== i))}
                  aria-label={`Remove ${p.name || `offer ${i + 1}`}`}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <Button
          size="sm"
          variant="outline"
          className="mt-[14px]"
          onClick={() => setProducts((list) => [...list, { name: '' }])}
        >
          + Add an offer
        </Button>
      </section>

      <div className="flex flex-wrap items-center gap-[14px]">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {saved ? <span className="text-14 text-success">Saved.</span> : null}
        {error ? <span className="text-14 text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
