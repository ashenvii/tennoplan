// ---------------------------------------------------------------------------
// challengeCounts: fill the `|COUNT|` template in Nightwave challenge text.
//
// "Kill |COUNT| Enemies while Aim Gliding" is a template; Public Export Plus
// carries the real requirement as ExportChallenges.requiredCount, keyed by the
// same uniqueName as the codex row. Pure so it can be tested without the build.
// ---------------------------------------------------------------------------

/**
 * Returns the description with every `|COUNT|` replaced, or null when
 * `requiredCount` is not a positive integer (never guess a number).
 */
export function fillChallengeCount(description: string, requiredCount: unknown): string | null {
  if (typeof requiredCount !== 'number' || !Number.isInteger(requiredCount) || requiredCount <= 0) return null;
  return description.split('|COUNT|').join(String(requiredCount));
}
