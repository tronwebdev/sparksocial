import { createWhatsAppTransport, createStubTransport, type MessageTransport } from '@sparksocial/capture';
import { envSet, envStr } from './env.js';

/**
 * The real WhatsApp Cloud API transport when both `WHATSAPP_PHONE_NUMBER_ID`
 * and `WHATSAPP_TOKEN` are configured, the stub otherwise — same "unset →
 * stub fallback" rule as `ayrshareAdapterClient()`, and the exact behavior
 * `.env.example`'s own comment on these two vars already promises.
 *
 * Deliberately independent of `WHATSAPP_APP_SECRET` (the inbound webhook's
 * gate, in `index.ts`): a brand can receive replies without being able to
 * send, or vice versa during setup, and conflating the two into one flag
 * would make a half-configured integration look fully off.
 */
let memo: MessageTransport | undefined;

export function whatsappTransportClient(): MessageTransport {
  return (memo ??= buildWhatsAppTransport());
}

function buildWhatsAppTransport(): MessageTransport {
  if (!envSet('WHATSAPP_PHONE_NUMBER_ID') || !envSet('WHATSAPP_TOKEN')) {
    console.warn(
      '[warn] WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN not both set — using the in-memory stub transport. ' +
        'No capture session or message has actually left the system.',
    );
    return createStubTransport();
  }
  return createWhatsAppTransport({
    phoneNumberId: envStr('WHATSAPP_PHONE_NUMBER_ID', ''),
    accessToken: envStr('WHATSAPP_TOKEN', ''),
  });
}
