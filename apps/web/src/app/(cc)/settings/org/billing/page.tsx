import { redirect } from 'next/navigation';

/** Moved to `/organization/billing` — see `/settings/org`. */
export default function OrgMoved() {
  redirect('/organization/billing');
}
