/**
 * Composing a negative prompt from layers of terms.
 *
 * Veo accepts a separate `negativePrompt` field. Terms come from several
 * places: a global list, a list per subject, a list per motion. Composing
 * them means ordering, de-duplicating, and dropping terms that would argue
 * with what the photo actually shows (for example, "text" must not be
 * forbidden when the photo is of a labelled package).
 *
 * Dropped terms are returned in `suppressed` so the caller can see them.
 */

export interface NegativeRegistry {
  /** Terms applied to every generation. */
  global: readonly string[];
  /** Terms per kind of subject, e.g. "mug", "product". */
  subjects: Readonly<Record<string, { negatives: readonly string[] }>>;
  /** Terms per kind of motion, e.g. "orbit", "rising steam". */
  motions: Readonly<Record<string, { negatives: readonly string[] }>>;
}

export interface Triage {
  /** The photo contains real lettering: do not forbid text. */
  hasText?: boolean;
  /** The photo contains a person's hand: do not forbid hands. */
  hasHands?: boolean;
}

/** Terms that contradict a photo containing real lettering. */
export const TEXT_CLUSTER = ['text', 'letters', 'caption', 'subtitle', 'watermark'] as const;

/** Terms that contradict a photo containing a hand. */
export const HAND_PRESENT_CLUSTER = ['hand', 'arm', 'person'] as const;

/** Added when a hand is present and the motion does not ask for one, to avoid mangled fingers. */
export const HAND_DEFECT_CLUSTER = ['extra fingers', 'malformed hand'] as const;

export interface NegativeLayer {
  layer: 'global' | 'subject' | 'motion' | 'hand';
  key: string;
  terms: string[];
}

export interface ComposedNegative {
  /** Comma-joined, ready for Veo's `negativePrompt`. */
  text: string;
  /** Final ordered, de-duplicated terms. */
  terms: string[];
  layers: NegativeLayer[];
  /** Terms dropped because the photo contradicts them. */
  suppressed: string[];
}

export function composeNegative(
  registry: NegativeRegistry,
  subject: string,
  motion: string,
  triage: Triage = {},
): ComposedNegative {
  const layers: NegativeLayer[] = [
    { layer: 'global', key: '', terms: [...registry.global] },
    { layer: 'subject', key: subject, terms: [...(registry.subjects[subject]?.negatives ?? [])] },
    { layer: 'motion', key: motion, terms: [...(registry.motions[motion]?.negatives ?? [])] },
  ];
  if (triage.hasHands) {
    layers.push({ layer: 'hand', key: 'present', terms: [...HAND_DEFECT_CLUSTER] });
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const layer of layers) {
    for (const term of layer.terms) {
      if (seen.has(term)) continue;
      seen.add(term);
      ordered.push(term);
    }
  }

  const blocked = new Set<string>();
  if (triage.hasText) TEXT_CLUSTER.forEach((t) => blocked.add(t));
  if (triage.hasHands) HAND_PRESENT_CLUSTER.forEach((t) => blocked.add(t));

  const suppressed: string[] = [];
  const terms = ordered.filter((t) => {
    if (!blocked.has(t)) return true;
    suppressed.push(t);
    return false;
  });

  return { text: terms.join(', '), terms, layers, suppressed };
}
