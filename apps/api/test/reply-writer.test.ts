import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { GOLDEN_SET } from '@sparksocial/playbooks';
import { createReplyWriter } from '../src/reply-writer.js';

/**
 * `brands.sales_qualification` — the four "Lead Qualification Options" checkboxes
 * that were stored, hydrated, rendered, and read by nothing.
 *
 * The reply writer is where they belong: each one authorises the agent to *offer*
 * something in a reply, and until now the model was free to offer any of them or
 * none, whatever the brand had ticked. These tests assert the prompt actually
 * carries the authorisation, and — the part that matters more — that the absence
 * of an authorisation is stated as a prohibition rather than left unsaid.
 */

const genome = GOLDEN_SET.find((c) => c.genome.genome_id === 'gen_saas')!.genome;

/** Captures the prompt the writer would send, and answers with a fixed reply. */
function spy() {
  const create = vi.fn(async (body: { messages: Array<{ content: string }> }) => ({
    content: [{ type: 'tool_use', name: 'record_reply', input: { text: 'Sure — happy to help.' } }],
    stop_reason: 'tool_use',
  }));
  const writer = createReplyWriter({ anthropic: { messages: { create } } as unknown as Anthropic });
  return {
    writer,
    prompt: () => (create.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content,
  };
}

const message = { genome, kind: 'dm', authorHandle: '@someone', messageText: 'How much is it?' };

describe('reply writer — sales qualification', () => {
  it('forbids all four moves when the brand has authorised none', async () => {
    // The default, and every brand's state before the setting was read. A model
    // given no instruction about pricing will sometimes discuss pricing, so
    // silence is not a constraint — the prohibition has to be said.
    const s = spy();
    await s.writer.write(message);
    const p = s.prompt();
    expect(p).toContain('Do not offer a price, a pricing page, a booking link, or ask for their contact details.');
    expect(p).not.toContain('What you may offer:');
  });

  it('authorises exactly what was ticked, and nothing else', async () => {
    const s = spy();
    await s.writer.write({ ...message, salesQualification: ['ask_qualifying_questions'] });
    const p = s.prompt();
    expect(p).toContain('What you may offer:');
    expect(p).toContain('You may ask one question to understand what they need.');
    // The three that were not ticked must not appear as permissions.
    expect(p).not.toContain('invite them to book');
    expect(p).not.toContain('pricing page');
    expect(p).not.toContain('ask for an email');
  });

  it('never implies a URL exists for the two link options', async () => {
    // The system prompt forbids fabricating facts; these two instructions are the
    // ones most likely to provoke it, so they say "do not invent a URL" inline
    // rather than relying on the general rule.
    const s = spy();
    await s.writer.write({ ...message, salesQualification: ['share_booking_link', 'share_pricing_link'] });
    const p = s.prompt();
    expect(p).toContain('do not invent a URL');
    expect(p).toContain('do not invent a price or a URL');
  });

  it('ignores a value that is not one of the four', async () => {
    // The column is jsonb and the enum could widen. An unrecognised entry must
    // not become an empty bullet that reads as a permission with no content.
    const s = spy();
    await s.writer.write({ ...message, salesQualification: ['not_a_real_option'] });
    const p = s.prompt();
    expect(p).toContain('Do not offer a price');
    expect(p).not.toContain('- undefined');
  });

  it('still fences the inbound message as untrusted', async () => {
    // The qualification lines are inserted next to the fenced block; a regression
    // that put them inside it would make attacker text look like brand policy.
    const s = spy();
    await s.writer.write({ ...message, salesQualification: ['ask_qualifying_questions'] });
    const p = s.prompt();
    expect(p).toContain('<untrusted-data');
    expect(p.indexOf('What you may offer:')).toBeLessThan(p.indexOf('<untrusted-data'));
  });
});
