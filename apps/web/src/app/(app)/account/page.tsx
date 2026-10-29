import { redirect } from 'next/navigation';

/**
 * `/account` — folded into `/organization`.
 *
 * It was a second organisation page that nothing linked to, holding the four
 * things Account Settings lacked: plan and policies, members, moving a brand,
 * and the client roster. Each has a section there now. A redirect rather than a
 * deletion, so an old bookmark still lands.
 */
export default function AccountMoved() {
  redirect('/organization');
}
