/**
 * descriptionTokens: readable fallback for unresolved `|TOKEN|` placeholders.
 *
 * DE's description strings are templates: "Excalibur deals |DAMAGE|% increased
 * damage". The game fills them in at render time and none of our sources carry
 * the values, except the Nightwave challenge counts, which the codex build
 * fills in from Public Export Plus (see peplusOverlay.ts). What is left reaches
 * the app still tokenised.
 *
 * We never guess a number. An unresolved token is shown as its lowercase name
 * in parentheses, so the sentence stays readable and it is clear that a value
 * exists but is not known: "deals (damage)% increased damage". Angle-bracket
 * markup such as <DT_FIRE_COLOR> is a different mechanism and is left to each
 * view's own sanitiser.
 *
 * Issue #7.
 */

/** An identifier wrapped in pipes: |DAMAGE|, |AFFINITY_SHARE|, |val|. */
export const TOKEN_PATTERN = /\|([A-Za-z][A-Za-z0-9_]*)\|/g;

/** `AFFINITY_SHARE` becomes `(affinity share)`. */
export function tokenLabel(name: string): string {
  return `(${name.toLowerCase().replace(/_/g, ' ')})`;
}

/** Replace every unresolved token in `text` with its readable label. */
export function fillDescriptionTokens(text: string): string {
  return text.replace(TOKEN_PATTERN, (_match, name: string) => tokenLabel(name));
}
