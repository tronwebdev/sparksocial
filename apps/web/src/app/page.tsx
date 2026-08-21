import { redirect } from 'next/navigation';

/**
 * Lands on `DASH-B-01` (PRD §8.3), not on the Command Center.
 *
 * This redirected to `/agents` — a supervision surface for an agent that is
 * already running. A brand with no campaign saw controls for something doing
 * nothing, which is exactly the state §8.3's "prominent CTA to create first
 * campaign if not active" exists for.
 */
export default function Home() {
  redirect('/home');
}
