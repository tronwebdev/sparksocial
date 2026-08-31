/**
 * TOOL NAMES, IN WORDS A PERSON READS.
 *
 * ── What was on screen ────────────────────────────────────────────────────
 *
 * The approval queue asked a brand owner to approve **`recipe.delete`**. The
 * audit log listed `org.create`, `genome.list`, `org.usage.get`, `engage.list`.
 * The usage panel ranked spend by `content.generate_avatar_video`. Those are
 * internal identifiers — the registry's primary keys — and they were being
 * rendered verbatim to somebody deciding whether to let an action happen.
 *
 * A queue that says "approve `recipe.delete`" is asking for consent to something
 * it has not described. That is the part that matters: not that the string is
 * ugly, but that a person cannot approve what they cannot read.
 *
 * ── Why a map and not a transform ─────────────────────────────────────────
 *
 * `recipe.delete` → "Recipe delete" is mechanically easy and wrong in the ways
 * that count. `genome.bootstrap_from_url` is "Read a website to set up a brand".
 * `content.draft` is "Write a post". `org.usage.get` is not a thing a person did
 * at all, it is a screen loading. The useful label is a description of the
 * *effect*, and no transform of the identifier can produce one.
 *
 * ── The fallback is honest rather than pretty ─────────────────────────────
 *
 * An unmapped tool falls back to a de-slugged form of its own name. It will read
 * a little mechanically, and that is better than the two alternatives: hiding the
 * row (so the audit log is no longer complete), or inventing a label from a
 * pattern that gets `genome.list` wrong. The label is always accompanied by the
 * identifier somewhere reachable — the audit log keeps a monospace column — so
 * nothing here removes information, it only stops the identifier being the
 * primary text.
 *
 * In `shared` because two sides need the same words: `apps/web` renders them and
 * the API's own logs and notifications quote them. A queue that says one thing and
 * a notification about the same action that says another is worse than either.
 */

/**
 * Effect descriptions, keyed by tool name.
 *
 * Written in the third person and in the past-tense-neutral form that reads
 * correctly in both places these appear: a queue row ("Delete an automation
 * recipe") and an audit row ("Delete an automation recipe · succeeded"). Not
 * sentences — they sit in a table cell.
 */
const LABELS: Record<string, string> = {
  /* ── Brand and org setup ─────────────────────────────────────────────── */
  'org.create': 'Create a workspace',
  'org.settings.patch': 'Change workspace settings',
  'org.billing.plan.set': 'Change the plan',
  'org.security.sso.configure': 'Configure single sign-on',
  'org.audit.query': 'Read the audit log',
  'org.credits.grant': 'Add credits',
  'org.usage.get': 'Read credit usage',
  'brand.create': 'Add a brand',
  'brand.settings.patch': 'Change brand settings',
  'brand.governance.get': 'Read brand settings',
  'brand.governance.set': 'Change brand settings',
  'brand.export': 'Export a brand',
  'brand.import': 'Import a brand',
  'brand.logo.generate': 'Generate a placeholder logo',
  'brand.knowledge.attach': 'Attach brand knowledge',
  'brand.knowledge.attach_document': 'Read an uploaded document',
  'brand.oauth.connect': 'Connect an account',
  'brand.oauth.disconnect': 'Disconnect an account',
  'brand.engagement.platforms.get': 'Read per-platform engagement settings',
  'brand.engagement.platforms.set': 'Change how SPARK engages on one platform',

  /* ── Genome ──────────────────────────────────────────────────────────── */
  'genome.bootstrap_from_url': 'Read a website to set up a brand',
  'genome.create': 'Set up a brand by answering questions',
  'genome.list': 'List brands',
  'genome.get': 'Read a brand',
  'genome.identity.set': 'Change brand identity',
  'genome.dimensions.patch': 'Change what a brand can make',
  'genome.constraints.patch': 'Change brand limits',
  'genome.offer.set': 'Change the offer',
  'genome.consent.grant': 'Record a likeness consent',
  'genome.consent.revoke': 'Revoke a likeness consent',

  /* ── Assets ──────────────────────────────────────────────────────────── */
  'asset.upload_url': 'Prepare a file upload',
  'asset.ingest_url': 'Add a file to the library',
  'asset.search': 'Search the library',
  'asset.list': 'List library files',
  'asset.gaps': 'Work out which files are missing',
  'asset.reuse': 'Reuse a file in a post',
  'asset.caption.set': 'Edit a file’s caption',
  'asset.archive': 'Archive a file',
  'asset.folder.create': 'Create a folder',
  'asset.folder.list': 'List folders',

  /* ── Campaigns and the calendar ──────────────────────────────────────── */
  'campaign.propose_plan': 'Work out what a campaign could make',
  'campaign.create': 'Create a campaign',
  'campaign.list': 'List campaigns',
  'campaign.rename': 'Rename a campaign',
  'campaign.pause': 'Pause a campaign',
  'campaign.resume': 'Make a campaign active',
  'campaign.duplicate': 'Duplicate a campaign',
  'campaign.report_vs_outcome': 'Compare a campaign to its target',
  'calendar.generate': 'Lay out a campaign calendar',
  'calendar.get': 'Read the calendar',
  'calendar.impact_preview': 'Preview a change to the mix',
  'calendar.recommend_slot': 'Suggest what to post on a day',

  /* ── Making content ──────────────────────────────────────────────────── */
  'content.draft': 'Write a post',
  'content.get': 'Read a post',
  'content.list': 'List posts',
  'content.schedule': 'Schedule a post',
  'content.beat.update': 'Edit a post’s wording',
  'content.variant.split': 'Start an A/B test',
  'content.generate_image': 'Generate an image',
  'content.generate_voiceover': 'Generate a voice-over',
  'content.generate_avatar_video': 'Generate an avatar video',
  'content.generate_broll': 'Generate b-roll',
  'content.generate_dub': 'Generate a dub',
  'content.scene.insert': 'Add a scene',
  'content.scene.remove': 'Remove a scene',
  'content.scene.move': 'Reorder a scene',
  'content.scene.retime': 'Change a scene’s length',
  'content.scene.lower_third': 'Set a scene caption',
  'draft.variants': 'Write alternative versions',
  'draft.repurpose': 'Repurpose a post',
  'playbook.resolve': 'Work out which formats this brand can make',
  'compose.render': 'Render a video',
  'compose.static': 'Render an image',
  'compose.fanout': 'Make platform versions',

  /* ── Publishing ──────────────────────────────────────────────────────── */
  'publish.now': 'Publish a post',
  'publish.rollback': 'Take a post down',
  'publish.status': 'Check a publish',
  'integration.health': 'Check connected accounts',

  /* ── Guardrails and approvals ────────────────────────────────────────── */
  'guardrails.check': 'Check a post against the brand’s rules',
  'approval.decide': 'Approve or reject an action',
  'approval.policy.set': 'Change the approval rules',
  'queue.review.list': 'Read the review queue',
  'agent.approval_mode.set': 'Change the oversight level',
  'agent.pause': 'Pause the agent',
  'agent.explain': 'Explain a decision',

  /* ── Engagement ──────────────────────────────────────────────────────── */
  'engage.ingest': 'Record an inbound message',
  'engage.list': 'Read the inbox',
  'engage.classify': 'Categorise a message',
  'engage.reply.draft': 'Draft a reply',
  'engage.reply.send': 'Send a reply',
  'engage.autohandle': 'Answer a message unattended',
  'engage.escalate': 'Hand a conversation to a person',
  'engage.takeover': 'Take over a conversation',
  'engage.thread': 'Read a conversation',
  'engage.eligibility.check': 'Check whether SPARK may reply yet',
  'engage.opportunity.create': 'Raise a sales opportunity',
  'engage.opportunity.route': 'Send a lead somewhere',
  'engage.audit.query': 'Read the engagement log',

  /* ── Discovery ───────────────────────────────────────────────────────── */
  'trend.fetch': 'Fetch trends',
  'trend.rank': 'Score trends for this brand',
  'trend.detail': 'Read a trend',
  'trend.explain': 'Explain a trend',
  'trend.observe': 'Record a trend’s numbers',
  'trend.repurpose': 'Turn a trend into a post idea',
  'trend.reshare': 'Reshare something that worked',
  'trend.watchlist': 'Watch a trend',
  'trend.safety_filter': 'Filter unsafe trends',
  'trend.hooks': 'Write opening lines for a trend',
  'trend.sources': 'Read which trend sources are live',
  'trend.influencer.watch': 'Watch an account',
  'trend.influencer.review': 'Read what watched accounts posted',

  /* ── Automation ──────────────────────────────────────────────────────── */
  'recipe.validate': 'Check an automation recipe',
  'recipe.create': 'Create an automation recipe',
  'recipe.update': 'Edit an automation recipe',
  'recipe.get': 'Read an automation recipe',
  'recipe.list': 'List automation recipes',
  'recipe.schedule': 'Turn an automation recipe on or off',
  'recipe.delete': 'Delete an automation recipe',
  'recipe.run': 'Run an automation recipe',
  'recipe.output.list': 'Read the automation queue',
  'recipe.output.decide': 'Approve or reject automation output',

  /* ── Capture and finish ──────────────────────────────────────────────── */
  'direct.brief.generate': 'Write a filming brief',
  'direct.session.send': 'Send a filming brief',
  'direct.session.batch': 'Send a batch of filming briefs',
  'direct.media.ingest': 'Receive filmed media',
  'whatsapp.send': 'Send a WhatsApp message',

  /* ── People and the agency layer ─────────────────────────────────────── */
  'team.invite': 'Invite a teammate',
  'team.role.set': 'Change a teammate’s role',
  'team.list': 'List teammates',
  'team.permission.set': 'Change which brands a teammate can reach',
  'team.group.create': 'Create a team group',
  'team.group.update': 'Change a team group',
  'team.group.delete': 'Delete a team group',
  'team.group.list': 'List team groups',
  'whitelabel.link.create': 'Create a client review link',
  'canva.design.list': 'List Canva designs',
  'canva.design.import': 'Import a Canva design',

  /* ── Measurement and learning ────────────────────────────────────────── */
  'analytics.sync': 'Fetch a post’s numbers',
  'analytics.post_metrics': 'Read a post’s numbers',
  'analytics.campaign_report': 'Read a campaign report',
  'analytics.success_metrics': 'Read the success metrics',
  'analytics.brand_series': 'Read the brand’s history',
  'analytics.cta_traffic': 'Read link clicks',
  'learning.record_outcome': 'Record how a post did',
  'learning.recommend': 'Recommend what to make next',
  'learning.freeze': 'Freeze what SPARK has learned',
  'learning.report': 'Read what SPARK has learned',
  'metrics.tool_activity': 'Read tool activity',

  /* ── Human loop ──────────────────────────────────────────────────────── */
  'human.ask': 'Ask the owner a question',
  'human.answer': 'Answer SPARK’s question',
  'human.pending': 'Read SPARK’s open questions',
  'human.notify': 'Send a notification',
  'human.notifications.read': 'Read notifications',
  'human.notifications.mark_read': 'Mark notifications read',
};

/**
 * De-slug an unmapped name: `content.generate_broll` → "Content generate broll".
 *
 * Deliberately mechanical-looking. Anything cleverer would be guessing, and a
 * confident-sounding wrong label on an approval row is worse than an awkward
 * accurate one.
 */
function deslug(name: string): string {
  const words = name.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a person should read where a tool name would otherwise appear. */
export function toolLabel(name: string): string {
  return LABELS[name] ?? deslug(name);
}

/** True when this tool has a real description rather than a de-slugged fallback. */
export function hasToolLabel(name: string): boolean {
  return name in LABELS;
}

/** Every tool this map describes — the guard test reads it. */
export const LABELLED_TOOLS: readonly string[] = Object.keys(LABELS);
