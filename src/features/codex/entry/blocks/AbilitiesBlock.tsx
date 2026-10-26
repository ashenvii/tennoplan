/**
 * AbilitiesBlock — numbered list of warframe abilities.
 *
 * Reads from entry.abilities (populated by the worker enricher from
 * calamity raw `abilities` arrays). Skipped when the list is empty —
 * not all categories carry abilities, and a sentinel with one precept
 * still benefits from the same shape.
 */

import { useMemo } from 'react';
import type { CodexEntry } from '../../types';
import type { Ability } from '@/core/domain/tennoplanApi';
import { getIconUrl } from '@/lib/icons/IconResolver';
import { fillDescriptionTokens } from '@/lib/text/descriptionTokens';
import styles from './AbilitiesBlock.module.css';

interface AbilitiesBlockProps {
  entry: CodexEntry;
}

export function AbilitiesBlock({ entry }: AbilitiesBlockProps) {
  const abilities = entry.abilities;
  if (!abilities || abilities.length === 0) return null;

  return (
    <section className={styles.root} aria-labelledby="codex-abilities-label">
      <h2 id="codex-abilities-label" className="typo-section-label">Abilities</h2>
      <ol className={styles.list}>
        {abilities.map((ability, idx) => (
          <AbilityRow key={`${ability.name}-${idx}`} index={idx + 1} ability={ability} />
        ))}
      </ol>
    </section>
  );
}

interface AbilityRowProps {
  index:   number;
  ability: Ability;
}

function AbilityRow({ index, ability }: AbilityRowProps) {
  const desc    = useMemo(() => sanitize(ability.description), [ability.description]);
  const iconUrl = ability.imageName ? getIconUrl(ability.imageName) : null;

  return (
    <li className={styles.ability}>
      <div className={styles.iconSlot} aria-hidden="true">
        {iconUrl
          ? <img src={iconUrl} alt="" className={styles.abilityIcon} width={32} height={32} />
          : <span className={styles.numberBadge}>{index}</span>
        }
      </div>
      <div className={styles.meta}>
        <h3 className={styles.name}>{ability.name}</h3>
        {desc && <p className={styles.description}>{desc}</p>}
      </div>
    </li>
  );
}

function sanitize(raw: string): string {
  return fillDescriptionTokens(raw)
    .replace(/<[A-Z0-9_]+>/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
