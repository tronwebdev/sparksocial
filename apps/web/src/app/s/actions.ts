'use server';

import { headers } from 'next/headers';
import type { SiteFormState } from '@/components/site/SiteContactForm';

const API_URL = process.env.SPARK_API_URL ?? 'http://localhost:8080';

/**
 * The agency website's contact form, sent on to the API's public lead endpoint.
 *
 * A server action rather than a route handler: CLAUDE.md allows exactly two
 * route handlers, both transport proxies, and this needs no third — it runs
 * on the server as the form's own submission. The visitor's address is passed
 * on as `x-forwarded-for` so the API's per-visitor limit counts visitors, not
 * this web server.
 */
export async function sendSiteLead(slug: string, _prev: SiteFormState, form: FormData): Promise<SiteFormState> {
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const body = {
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    company: text('company'),
    message: text('message'),
    website: text('website'),
  };
  if (!body.name || !body.email) return { status: 'error', message: 'Please give your name and email.' };

  const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0]?.trim();
  try {
    const res = await fetch(`${API_URL}/v1/public/sites/${encodeURIComponent(slug)}/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) return { status: 'error', message: 'That’s a few messages in a row — please try again in a little while.' };
    if (res.status === 400) return { status: 'error', message: 'Please check your email address.' };
    if (!res.ok) return { status: 'error', message: 'Your message could not be sent. Please try again, or email us directly.' };
    return { status: 'sent' };
  } catch {
    return { status: 'error', message: 'Your message could not be sent. Please try again, or email us directly.' };
  }
}
