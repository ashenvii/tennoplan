/**
 * StatLine — renders a Warframe stat string with embedded text-icon codes.
 *
 * Input: `"+60% <DT_RADIATION_COLOR>Radiation"` or
 *        `"+90% Shield Recharge"` or
 *        `"<LOWER_IS_BETTER>-45% Shield Recharge Delay"`
 *
 * Output: same text, with <CODE> markers replaced by inline icon <img>s.
 *
 * Used by:
 *   - ModCardV3 stat lines
 *   - ModDetailModal stat rows
 *   - Future: Riven stat display, mod description bodies, worldstate text
 */

import { Fragment, type ReactNode } from 'react';
import clsx from 'clsx';
import { fillDescriptionTokens } from '@/lib/text/descriptionTokens';
import { TENNOICON_MAP, TENNOICON_TEXT_TOKENS, TENNOICON_FLAG_CODES } from './tennoIconMap';
import styles from './StatLine.module.css';

interface StatLineProps {
  /** Raw stat string with optional <CODE> markers */
  text: string;
  /** Override the wrapper element. Default 'span'. */
  as?: 'span' | 'div' | 'p';
  /** Extra className for the wrapper */
  className?: string;
}

const TOKEN_REGEX = /(<[A-Z0-9_]+>)/g;

export function StatLine({ text, as: As = 'span', className }: StatLineProps) {
  if (!text) return null;

  // Detect <LOWER_IS_BETTER> for styling hook (still strip it from output)
  const isLowerBetter = text.includes('<LOWER_IS_BETTER>');

  // Replace literal "\n" sequences from the data with separator dots
  const normalized = fillDescriptionTokens(text).replace(/\\n/g, ' · ');

  const parts = normalized.split(TOKEN_REGEX);
  const nodes: ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    // Icon code
    const iconUrl = TENNOICON_MAP[part];
    if (iconUrl) {
      nodes.push(
        <img
          key={i}
          src={iconUrl}
          alt=""
          className={styles.icon}
          draggable={false}
          aria-hidden="true"
        />,
      );
      continue;
    }

    // Text-substitution code
    const textSub = TENNOICON_TEXT_TOKENS[part];
    if (textSub !== undefined) {
      nodes.push(<Fragment key={i}>{textSub}</Fragment>);
      continue;
    }

    // Flag / styling-only code — strip silently
    if (TENNOICON_FLAG_CODES.has(part)) continue;

    // Unknown <CODE> — strip silently in prod, log in dev
    if (TOKEN_REGEX.test(part)) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[StatLine] Unknown text-icon code: ${part}`);
      }
      continue;
    }

    // Plain text
    nodes.push(<Fragment key={i}>{part}</Fragment>);
  }

  return (
    <As className={clsx(styles.line, isLowerBetter && styles.lowerIsBetter, className)}>
      {nodes}
    </As>
  );
}
