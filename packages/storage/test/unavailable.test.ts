import { describe, expect, it } from 'vitest';
import { ToolError } from '@sparksocial/shared/types';
import { storageUnavailable } from '../src/azure.js';

/**
 * What a person sees when the storage identity is missing.
 *
 * ── What was on screen ────────────────────────────────────────────────────
 *
 * `DefaultAzureCredential` fails with a `ChainedTokenCredential` aggregate that
 * names every credential source it tried. Under a "Upload a logo" button, in red,
 * a brand owner was reading:
 *
 *   *"ChainedTokenCredential authentication failed. CredentialUnavailableError:
 *   EnvironmentCredential is unavailable… Visual Studio Code Authentication is not
 *   available. Ensure you have have Azure Resources Extension installed in VS
 *   Code… Azure CLI could not be found. Please visit https://aka.ms/azure-cli…"*
 *
 * Seven hundred characters instructing a fishmonger to install a VS Code
 * extension. Every word of it is useful — to whoever deployed the container — so
 * the fix is not to discard it but to send it where it is useful and put one
 * sentence where the person is.
 *
 * These tests assert both halves, because getting one right and the other wrong
 * is the likely regression: a message that says nothing *and* a log that says
 * nothing is worse than what it replaced.
 */

/** Trimmed from the text that was actually on screen. */
const CHAINED = new Error(
  'ChainedTokenCredential authentication failed. CredentialUnavailableError: EnvironmentCredential is ' +
    'unavailable. No underlying credential could be used. To troubleshoot, visit ' +
    'https://aka.ms/azsdk/js/identity/environmentcredential/troubleshoot. CredentialUnavailableError: ' +
    'ManagedIdentityCredential: Authentication failed. Message : Error(s): Not Available - Timestamp: Not ' +
    'Available - Description: Unable to load the proper Managed Identity. - Correlation ID: ' +
    'f59504e8-4688-43ca-ab7f-18547a3a3358. CredentialUnavailableError: Azure CLI could not be found. ' +
    "Please visit https://aka.ms/azure-cli for installation instructions and then, once installed, " +
    "authenticate to your Azure account using 'az login'.",
);

/** What an assigned-but-unauthorised identity returns instead. */
const FORBIDDEN = new Error(
  'Server failed to authenticate the request. Status: 403 (This request is not authorized to perform this ' +
    'operation using this permission.) ErrorCode: AuthorizationPermissionMismatch',
);

describe('storageUnavailable', () => {
  it('is a ToolError with its own code', () => {
    // Its own code rather than `UPSTREAM_FAILED`, so the UI can react without
    // parsing prose and a log search finds every instance of this one problem.
    const err = storageUnavailable(CHAINED, 'sparkstaging');
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe('STORAGE_UNAVAILABLE');
  });

  it('says nothing to the user about Azure, credentials, or their setup', () => {
    const { message } = storageUnavailable(CHAINED, 'sparkstaging');
    expect(message).not.toMatch(
      /azure|credential|managed identity|az login|vs code|correlation|aka\.ms|token|403/i,
    );
  });

  it('tells the user the one thing they need: it is not their file', () => {
    /**
     * The actionable content of a failure nobody but an operator can fix. Without
     * it the natural conclusion is "my logo is the problem", and the next thing
     * tried is a different logo, which fails identically.
     */
    const { message } = storageUnavailable(CHAINED, 'sparkstaging');
    expect(message).toMatch(/nothing is wrong with your file/i);
    expect(message).toMatch(/try again/i);
  });

  it('stays short enough to read', () => {
    // The thing it replaces was ~700 characters. A cap is crude, but the failure
    // mode here is prose growing back.
    expect(storageUnavailable(CHAINED, 'sparkstaging').message.length).toBeLessThan(200);
  });

  it('keeps the whole aggregate for the log', () => {
    /**
     * Discarding it would trade an unreadable screen for an undiagnosable one.
     * Safe to keep: `apps/api/src/app.ts` serialises only `code` and `message`
     * to the client, so `meta` is server-side by construction rather than by
     * anybody remembering to strip it.
     */
    const details = storageUnavailable(CHAINED, 'sparkstaging').meta as { cause?: string };
    expect(details.cause).toContain('ChainedTokenCredential');
    expect(details.cause).toContain('Correlation ID');
  });

  it('distinguishes no identity from an identity without the role', () => {
    /**
     * Both surface at the first upload after a deploy and they need different
     * commands. Collapsing them sends an operator to assign an identity that is
     * already assigned.
     */
    const missing = storageUnavailable(CHAINED, 'sparkstaging').meta as { operator?: string };
    expect(missing.operator).toMatch(/assign a managed identity/i);
    expect(missing.operator).toMatch(/az login/i);

    const unauthorised = storageUnavailable(FORBIDDEN, 'sparkstaging').meta as { operator?: string };
    expect(unauthorised.operator).toMatch(/Storage Blob Delegator/);
    expect(unauthorised.operator).toMatch(/Storage Blob Data Contributor/);
  });

  it('names the account in the operator note, since an org may have several', () => {
    const details = storageUnavailable(CHAINED, 'sparkstaging').meta as { operator?: string; account?: string };
    expect(details.account).toBe('sparkstaging');
    expect(details.operator).toContain('sparkstaging');
  });

  it('handles a thrown non-Error', () => {
    // Azure SDKs reject with plain objects in places. Stringifying beats crashing
    // the error path itself.
    expect(() => storageUnavailable('boom', 'acct')).not.toThrow();
    expect((storageUnavailable('boom', 'acct').meta as { cause?: string }).cause).toBe('boom');
  });
});
