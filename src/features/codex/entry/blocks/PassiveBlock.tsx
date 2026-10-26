/**
 * PassiveBlock — warframe/sentinel passive ability description.
 *
 * WFCD's passiveDescription is the raw in-game templated string. Two
 * markup conventions to handle:
 *
 *   • Angle-bracket tags — <DT_FIRE_COLOR>, <AFFINITY_SHARE>, etc.
 *     These are DE colour / style hints. We strip them; they carry no
 *     reader-meaningful content once outside the game UI.
 *
 *   • Pipe-delimited placeholders — |STRENGTH|, |DURATION|, |RANGE|.
 *     These are runtime variable substitutions the game UI replaces
 *     with the actual numeric value at render time. None of our sources
 *     carry the passive values, so we never guess one: each token is
 *     shown as a lowercase label in parentheses, "(damage)%", styled
 *     inline (italic) so the reader can see a value exists but is not
 *     known. The label comes from lib/text/descriptionTokens, shared
 *     with every other view that shows description text.
 *
 * Returns null when no passiveDescription is present.
 */

import { useMemo, type ReactNode } from 'react';
import { TOKEN_PATTERN, tokenLabel } from '@/lib/text/descriptionTokens';
import type { CodexEntry } from '../../types';
import styles from './PassiveBlock.module.css';

interface PassiveBlockProps {
  entry: CodexEntry;
}

export function PassiveBlock({ entry }: PassiveBlockProps) {
  const segments = useMemo(
    () => toSegments(entry.passiveDescription),
    [entry.passiveDescription],
  );
  if (segments.length === 0) return null;

  return (
    <section className={styles.root} aria-labelledby="codex-passive-label">
      <h2 id="codex-passive-label" className={`typo-section-label ${styles.label}`}>Passive</h2>
      <p className={styles.body}>{renderSegments(segments)}</p>
    </section>
  );
}

// ─── Parsing ─────────────────────────────────────────────────────

type Segment =
  | { type: 'text';        value: string }
  | { type: 'placeholder'; value: string };

/**
 * Strip angle-bracket tags + whitespace junk, then split the cleaned
 * text into a sequence of literal text segments and placeholder tokens
 * so the renderer can style each placeholder individually.
 */
function toSegments(raw: string | undefined): Segment[] {
  if (!raw) return [];

  const cleaned = raw
    .replace(/<\/?[A-Z0-9_]+>/g, '')   // strip DE colour / style tags
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const segments: Segment[] = [];
  const re = new RegExp(TOKEN_PATTERN);        // |STRENGTH|, |DURATION|, …
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(cleaned)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: cleaned.slice(lastIdx, match.index) });
    }
    segments.push({ type: 'placeholder', value: tokenLabel(match[1]) });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < cleaned.length) {
    segments.push({ type: 'text', value: cleaned.slice(lastIdx) });
  }
  return segments;
}

// ─── Rendering ───────────────────────────────────────────────────

function renderSegments(segments: Segment[]): ReactNode {
  return segments.map((seg, i) =>
    seg.type === 'text'
      ? <span key={i}>{seg.value}</span>
      : <em  key={i} className={styles.placeholder}>{seg.value}</em>
  );
}
