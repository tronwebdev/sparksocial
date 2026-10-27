import { redirect } from 'next/navigation';

/** Moved to `/organization/audit` — see `/settings/org`. */
export default function OrgMoved() {
  redirect('/organization/audit');
}
