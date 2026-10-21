import { describe, expect, it } from 'vitest';
import { closesFolderMenu } from '../src/components/assets/library/menuDismiss';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), 'apps/web', rel), 'utf8');

/** The two bits of `Element` the predicate touches. */
function el(selectors: string[]): Element {
  return { closest: (s: string) => (selectors.includes(s) ? el(selectors) : null) } as unknown as Element;
}

describe('the folder menu stays open when it is opened', () => {
  it('does not close on the ⋯ button that opened it', () => {
    // The bug: React flushes the effect that registers the dismiss listener
    // before the opening click finishes propagating to `window`, so the
    // listener receives that click and closed the menu every time.
    expect(closesFolderMenu(el(['[data-folder-menu]']))).toBe(false);
  });

  it('closes on anything else, including the menu items', () => {
    // Rename, Share, Members and Delete each open a dialog; the menu should go
    // with them, so they are deliberately not marked.
    expect(closesFolderMenu(el([]))).toBe(true);
    expect(closesFolderMenu(null)).toBe(true);
  });

  it('is wired to the button it names', () => {
    // The predicate passing on a fake element proves nothing if the attribute
    // is not on the real button, or the screen still inlines its own check.
    expect(read('src/components/assets/library/FolderCards.tsx')).toContain('data-folder-menu');
    expect(read('src/components/assets/AssetsLibraryScreen.tsx')).toContain('closesFolderMenu(event.target');
  });
});
