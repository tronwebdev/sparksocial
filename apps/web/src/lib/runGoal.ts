'use client';

/**
 * A run's goal, as something a person would read.
 *
 * `agent.run.list` returns the goal *as it was given to the agent*, and the
 * goals this app mints are written for a model: the Draft Panel sends
 *
 *   "Edit content item e7c14d12-6755-44c6-ac1a-fbddbcaacfa4 in genome
 *    9bcf18fc-a707-4dc2-a49c-37699c624776. Now: can you make this less pushy
 *    Use the content.* tools. Change only what I asked for, and say what you
 *    changed"
 *
 * — two UUIDs, a tool instruction and a house style rule wrapped around six
 * words the user actually typed. Rendering that raw put identifiers on screen
 * that mean nothing to anyone and buried the request.
 *
 * So this keeps the part the user wrote and names the post instead of its id.
 * It rewrites rather than truncates, because the useful half is in the middle:
 *
 *   - `Edit content item <uuid>` → `Edit "<the post's summary>"`, resolved from
 *     `content.list`; `Edit a post` when that id is not in the list (deleted,
 *     or another brand's).
 *   - `in genome <uuid>` — dropped. The brand is the one you are looking at.
 *   - `Now:` — the marker the panel puts before the user's own words, so
 *     everything after it is the request and leads the label.
 *   - The trailing scaffolding (`Use the content.* tools…`, `Change only what
 *     I asked for…`) — dropped. It is instructions to the agent, not content.
 *
 * A goal with none of these patterns is left exactly as it is: a user who typed
 * "what is my agent waiting on?" should see that sentence.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function humaniseGoal(goal: string, titles: Map<string, string>): string {
  let subject: string | null = null;

  const item = goal.match(new RegExp(`content item (${UUID.source})`, 'i'));
  if (item) {
    const title = titles.get(item[1]!.toLowerCase());
    subject = title ? `Edit “${title}”` : 'Edit a post';
  }

  /* Everything after `Now:` is what the user typed; the scaffolding that
     follows it is fixed text the panel appends. */
  let request = goal;
  const now = goal.indexOf('Now:');
  if (now >= 0) request = goal.slice(now + 4);
  request = request
    .replace(/Use the [\w.*]+ tools\.?/gi, '')
    .replace(/Change only what I asked for[^.]*\.?/gi, '')
    .replace(/and say what you changed\.?/gi, '')
    .replace(new RegExp(`in genome ${UUID.source}\.?`, 'gi'), '')
    .replace(new RegExp(`content item ${UUID.source}`, 'gi'), 'a post')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.,;:\s]+/, '');

  if (subject && request) return `${subject} — ${request}`;
  if (subject) return subject;
  return request || goal;
}

/**
 * Which of the design's four row icons a run gets.
 *
 * `SparkSocial Dashboard.dc.html` draws a semantic glyph per activity row — a
 * magenta flame for a trend, a blue calendar for scheduling, an orange chart
 * for leads, a purple bubble for replies. There is no event *type* in
 * `agent_runs` to key that on, so it is read off the goal, which is the text
 * that describes the work. A goal that matches nothing gets the neutral spark,
 * rather than being forced into whichever category matched loosest.
 */
export type RunKind = 'trend' | 'calendar' | 'engagement' | 'leads' | 'content' | 'spark';

export function runKind(goal: string, agent?: string): RunKind {
  const g = goal.toLowerCase();
  if (/trend|discover/.test(g)) return 'trend';
  if (/schedul|calendar|slot|plan the (week|month)/.test(g)) return 'calendar';
  if (/comment|repl(y|ies)|dm|inbox|engage/.test(g)) return 'engagement';
  if (/lead|intent/.test(g)) return 'leads';
  if (/draft|content item|caption|post|assemble|render/.test(g)) return 'content';
  if (agent && agent !== 'spark') return 'content';
  return 'spark';
}
