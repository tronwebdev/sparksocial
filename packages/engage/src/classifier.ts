import { z } from 'zod';
import type { Genome } from '@sparksocial/shared/genome';

/**
 * The four tabs PRD §8.8's `ENG-02` feed sorts a message into. Kept as the
 * classifier's actual output rather than a separate "intent" taxonomy the
 * caller maps afterward — the feed *is* the product surface this drives.
 */
export const EngagementCategory = z.enum(['needs_review', 'suggested_reply', 'auto_handled', 'sales_opportunity']);
export type EngagementCategory = z.infer<typeof EngagementCategory>;

export interface ClassificationResult {
  category: EngagementCategory;
  /** 0-1. How confident the classification is, not how urgent the message is. */
  intentScore: number;
  /** Present for `suggested_reply`/`auto_handled`; absent when a human should write the reply from scratch. */
  suggestedReply?: string;
  /** One sentence, user-facing — the `why` PRD §7.3 requires for every agent-visible decision. */
  reason: string;
}

export interface EngagementClassifier {
  classify(args: { genome: Genome; kind: string; authorHandle: string; text: string }): Promise<ClassificationResult>;
}
