import { redirect } from 'next/navigation';

/**
 * `/settings/org` — moved to `/organization`, its own screen outside the
 * brand ones. Kept as a redirect so links and bookmarks still land.
 */
export default function OrgMoved() {
  redirect('/organization');
}
