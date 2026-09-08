import {
  PROPOSAL_SERVICE_LABELS,
  type ProposalLineItem,
} from '@sparksocial/shared/agencyPipeline';

/**
 * Money, and a proposal rendered as something a person can paste into an email.
 *
 * ── Why "copy as text" is the primary way to send ─────────────────────────
 *
 * `proposal.share` mints a real expiring credential, and there is no page that
 * serves it: the tool proxy is deliberately not public (`middleware.ts`), and
 * CLAUDE.md allows exactly two route handlers under `src/app/api`, so a third
 * one to read a proposal by token is not a thing to add here. A public viewer
 * needs its own unauthenticated surface on `apps/api`, which is a security
 * decision with its own review rather than a side effect of building a modal.
 *
 * Meanwhile the agency's actual need — get the offer in front of the client
 * today — is met by handing them the text. So that is the primary action, the
 * link is shown with the truth attached, and neither pretends to be the other.
 */

/**
 * Minor units to a readable amount.
 *
 * `Intl.NumberFormat` with the currency style rather than a hand-rolled
 * `toFixed`, so JPY (no minor unit) and BHD (three) come out right instead of
 * being silently divided by 100 twice or not at all. An unknown code falls back
 * to printing the code, which is better than throwing on somebody's real
 * currency.
 */
export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(
      cents / 100,
    );
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

/** The same, without the symbol — for inputs, where a symbol is chrome. */
export const majorUnits = (cents: number): string => (cents / 100).toFixed(2);

/**
 * A typed amount to integer minor units.
 *
 * Rounds rather than truncates, because `19.999` typed into a price field means
 * 20.00 to the person typing it, and `Math.round` on the scaled value avoids
 * the classic `0.1 * 3` float residue reaching a contract total. Returns
 * `undefined` for anything that is not a number, so a half-typed value does not
 * silently become 0 in the totals.
 */
export function parseMoney(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (cleaned === '' || cleaned === '.') return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

export interface ProposalForText {
  title: string;
  currency: string;
  termMonths: number;
  lineItems: ProposalLineItem[];
  monthlyCents: number;
  oneOffCents: number;
  totalContractCents: number;
  notes?: string;
}

/**
 * The proposal as plain text.
 *
 * Deliberately plain rather than HTML or Markdown: it is going into whatever
 * mail client the agency already uses, and every one of them mangles pasted
 * HTML differently while all of them keep line breaks. The one piece of
 * structure that matters — which lines recur and which do not — is carried in
 * words, because that is the distinction a client misreads.
 */
export function proposalToText(p: ProposalForText, agencyFor: string): string {
  const lines: string[] = [];

  lines.push(p.title);
  lines.push('');
  lines.push(`Prepared for ${agencyFor}`);
  lines.push(`Term: ${p.termMonths} ${p.termMonths === 1 ? 'month' : 'months'}`);
  lines.push('');
  lines.push('What is included');

  for (const li of p.lineItems) {
    const label = li.description?.trim() || PROPOSAL_SERVICE_LABELS[li.service];
    const qty = li.quantity > 1 ? ` x${li.quantity}` : '';
    const each = money(li.unitCents, p.currency);
    const per = li.recurrence === 'monthly' ? ' per month' : ' one-off';
    lines.push(`  - ${label}${qty}: ${each}${per}`);
  }

  lines.push('');
  if (p.monthlyCents > 0) lines.push(`Monthly: ${money(p.monthlyCents, p.currency)}`);
  if (p.oneOffCents > 0) lines.push(`One-off: ${money(p.oneOffCents, p.currency)}`);
  lines.push(
    `Total over ${p.termMonths} ${p.termMonths === 1 ? 'month' : 'months'}: ${money(p.totalContractCents, p.currency)}`,
  );

  if (p.notes?.trim()) {
    lines.push('');
    lines.push(p.notes.trim());
  }

  return lines.join('\n');
}
