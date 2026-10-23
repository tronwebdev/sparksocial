import { redirect } from 'next/navigation';

/**
 * `/settings/credits` — moved to `/settings/org/billing`.
 *
 * It was never a brand screen. `org_budgets` and `credit_ledger` are both
 * keyed on `org_id` and `org.usage.get` takes no brand, so this page showed a
 * balance shared by every brand in the organisation as though it belonged to
 * whichever one was selected in the cookie.
 *
 * A redirect rather than a deletion: the path is in bookmarks, in the nav
 * history of anyone who used it, and quite possibly in a support reply. A 404
 * would teach them the feature was removed, which is the opposite of true.
 */
export default function CreditsMoved() {
  redirect('/settings/org/billing');
}
