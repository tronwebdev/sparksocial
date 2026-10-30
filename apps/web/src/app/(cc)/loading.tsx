import { SparkLoader } from '@/components/brand/SparkLoader';

/**
 * Shown inside the shell while a page's segment loads on navigation. There was
 * no route loading state at all, so a slow page kept the previous one on
 * screen with nothing saying a click had registered.
 */
export default function Loading() {
  return <SparkLoader label="Loading…" className="min-h-[60vh]" />;
}
