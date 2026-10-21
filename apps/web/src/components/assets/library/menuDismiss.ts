/**
 * Whether a click anywhere on the page should close the folder ⋯ menu.
 *
 * Its own line of code, rather than a closure inside the effect, because the bug
 * it fixes was invisible from the component: the folder menu never opened at
 * all on the deployed build. Clicking ⋯ left `aria-expanded` at `false`, and a
 * direct `.click()` from the console did the same.
 *
 * The cause is a timing one. The effect that registers the dismiss listener
 * only runs once a menu is open, which reads as safe — the listener cannot
 * exist before the click that opened it. But React attaches its own handler at
 * the root container, inside `body`, and flushes the resulting passive effect
 * before the click has finished propagating to `window`. The listener is
 * therefore in place in time to receive the very click that opened the menu.
 *
 * So the listener has to recognise the button. `data-folder-menu` marks it, its
 * own `onMenu` keeps toggling, and a second click still closes. Menu *items*
 * are deliberately not marked: each opens a dialog, and the menu should go with
 * them.
 */
export function closesFolderMenu(target: Element | null): boolean {
  return !target?.closest('[data-folder-menu]');
}
