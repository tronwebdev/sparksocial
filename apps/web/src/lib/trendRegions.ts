/**
 * The regions a trend search can be narrowed to — ISO 3166 codes, as
 * `trend.rank`'s `region` takes them. Google Trends and Pinterest honour it;
 * the global feeds ignore it, which is why "Global" is the default.
 *
 * One list for Discovery and the AutoTrend wizard, which had its own copy.
 */
export const TREND_REGION_OPTIONS = [
  { value: '', label: 'Global' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'IN', label: 'India' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'BR', label: 'Brazil' },
] as const;
