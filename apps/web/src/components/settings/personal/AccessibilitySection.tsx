'use client';

import { useEffect } from 'react';
import { PrefGroup, PrefRow } from './fields';
import { useLocalPrefs } from './prefs';

/**
 * `Settings PS Accessibility` — 1093 tall, the same switch rows as
 * Notifications plus a text-size control.
 *
 * Everything here is stored per **browser**, not per account: a person who
 * turns motion off on a machine that struggles with it should not have that
 * follow them to one that does not. See `prefs.ts`.
 *
 * The settings actually apply, which is the point of the screen — reduced
 * motion sets `data-reduce-motion` on the document root (the same switch
 * `prefers-reduced-motion` already flips in `tokens.css`), and text size sets
 * the root font size that every `rem` in the app is measured against.
 */

const DEFAULTS = {
  reduceMotion: false,
  highContrast: false,
  largerText: false,
  underlineLinks: false,
  keyboardHints: true,
};

export function AccessibilitySection() {
  const { prefs, set } = useLocalPrefs('ss-a11y', DEFAULTS);

  /* Applied on mount and on every change — a preference screen whose settings
     take effect only after a reload is one people assume is broken. */
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-reduce-motion', prefs.reduceMotion);
    root.toggleAttribute('data-high-contrast', prefs.highContrast);
    root.toggleAttribute('data-underline-links', prefs.underlineLinks);
    root.style.fontSize = prefs.largerText ? '18px' : '';
    return () => {
      root.style.fontSize = '';
    };
  }, [prefs]);

  return (
    <div className="grid grid-cols-1 gap-[30px]">
      <PrefGroup title="Motion and colour">
        <PrefRow
          title="Reduce motion"
          detail="Turns off the app's transitions and animations. Your system setting already does this; here you can turn it off on a machine that does not."
          on={prefs.reduceMotion}
          onToggle={() => set({ reduceMotion: !prefs.reduceMotion })}
        />
        <PrefRow
          title="Increase contrast"
          detail="Darkens secondary text and strengthens every hairline border."
          on={prefs.highContrast}
          onToggle={() => set({ highContrast: !prefs.highContrast })}
        />
        <PrefRow
          title="Underline links"
          detail="Marks links by more than colour alone."
          on={prefs.underlineLinks}
          onToggle={() => set({ underlineLinks: !prefs.underlineLinks })}
        />
      </PrefGroup>

      <PrefGroup title="Text">
        <PrefRow
          title="Larger text"
          detail="Raises the base size from 16px to 18px. Everything measured in rem grows with it."
          on={prefs.largerText}
          onToggle={() => set({ largerText: !prefs.largerText })}
        />
      </PrefGroup>

      <PrefGroup title="Editor">
        <PrefRow
          title="Show keyboard hints"
          detail="Displays the shortcut beside actions that have one."
          on={prefs.keyboardHints}
          onToggle={() => set({ keyboardHints: !prefs.keyboardHints })}
        />
      </PrefGroup>

      <p className="text-16 leading-[1.5]" style={{ color: 'rgb(131,131,131)' }}>
        These apply immediately and are remembered in this browser only — they are about the screen
        in front of you, so they deliberately do not follow you to another machine. There is no Save:
        each switch takes effect the moment you set it.
      </p>
    </div>
  );
}
