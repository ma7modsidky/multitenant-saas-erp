/**
 * Whole days remaining in a free trial (ceiling, so the final partial day
 * still counts). 0 once the end date has passed or the date is invalid.
 */
export function trialDaysLeft(trialEndsAt: string): number {
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return 0;
  const ms = end - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
