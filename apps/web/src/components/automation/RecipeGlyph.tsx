import type { RecipeKind } from './recipeMeta';

/**
 * The three recipe marks, traced from `recipeIcons` in the prototype's script —
 * a wand with sparkles, a folder with a plus, and the RSS arc.
 *
 * One component rather than three inline blobs, because the same glyph is drawn
 * at 30px on a recipe card, 19px in a queue chip and 15px on the launch modal's
 * badge, and three copies would drift.
 */
export function RecipeGlyph({ kind, size = 30 }: { kind: RecipeKind; size?: number }) {
  if (kind === 'auto_trend') {
    return (
      <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden>
        <path d="m19 4 1.2 3.2L23.4 8.4 20.2 9.6 19 12.8 17.8 9.6 14.6 8.4l3.2-1.2L19 4Z" fill="currentColor" />
        <path d="M16.5 13.5 4 26" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path
          d="m24.5 14.5.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2ZM9.5 4.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === 'bulk_connector') {
    return (
      <svg width={size} height={size} viewBox="0 0 30 28" fill="none" aria-hidden>
        <path
          d="M2.5 7A3.5 3.5 0 0 1 6 3.5h5.4l3.2 3.7h9.4A3.5 3.5 0 0 1 27.5 10.7v10.1a3.5 3.5 0 0 1-3.5 3.5H6a3.5 3.5 0 0 1-3.5-3.5V7Z"
          stroke="currentColor"
          strokeWidth="2.4"
        />
        <path d="M15 12v8M11 16h8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 21a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 3 21ZM1 8.6A14.4 14.4 0 0 1 15.4 23M1 1.4A21.6 21.6 0 0 1 22.6 23"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
