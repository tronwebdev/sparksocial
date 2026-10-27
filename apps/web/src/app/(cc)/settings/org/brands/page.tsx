import { redirect } from 'next/navigation';

/** Moved to `/organization/brands` — see `/settings/org`. */
export default function OrgMoved() {
  redirect('/organization/brands');
}
