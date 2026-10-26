/**
 * DescriptionBlock — sanitized prose description / lore.
 *
 * Removes DE's worldstate tag markup (`<TAG>`) and decodes escaped
 * line breaks, then renders as calm body text. The measure is capped
 * at ~72 characters so reading stays comfortable on wide canvases.
 *
 * Returns null when no description is present rather than rendering
 * a "no description available" placeholder — the absence is the
 * right signal.
 */

import { useMemo } from 'react';
import { fillDescriptionTokens } from '@/lib/text/descriptionTokens';
import type { CodexEntry } from '../../types';
import styles from './DescriptionBlock.module.css';

interface DescriptionBlockProps {
  entry: CodexEntry;
}

export function DescriptionBlock({ entry }: DescriptionBlockProps) {
  const text = useMemo(() => sanitizeDescription(entry.description), [entry.description]);
  if (!text) return null;

  return (
    <section className={styles.root} aria-labelledby="codex-description-label">
      <h2 id="codex-description-label" className="typo-section-label">Description</h2>
      <p className={styles.body}>{text}</p>
    </section>
  );
}

function sanitizeDescription(raw: string | undefined): string {
  if (!raw) return '';
  return fillDescriptionTokens(raw)
    .replace(/<[A-Z0-9_]+>/g, '')   // strip <TAG> markers
    .replace(/\\n/g, ' ')           // turn escaped newlines into spaces
    .replace(/\\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
