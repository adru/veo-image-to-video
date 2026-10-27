/**
 * Negative-prompt coverage for tools with one text box.
 *
 * Veo's API has a separate `negativePrompt` field. Many UIs do not: there is
 * one box, and whatever you paste is the whole prompt. Paste the prompt alone
 * and every negative is silently gone.
 *
 * The fix is to say each negative as a positive sentence ("Nothing is poured"
 * instead of the term "pouring"). Two cases make that more than string
 * concatenation:
 *
 *  1. The prompt may already say it. If the prompt contains "locked off and
 *     completely still", appending "The camera does not move" only repeats it.
 *     Each term can list `coveredBy` phrases; if the prompt contains one, the
 *     term is expressed already and adds nothing.
 *  2. Some terms have no positive wording yet. Those are NOT dropped quietly.
 *     They come back in `unexpressed`, so a caller can warn, fail a test, or
 *     decide to accept the gap on purpose.
 *
 * Several terms may share one clause; it is added once.
 */
import type { ComposedNegative } from './negatives.js';

export interface Affirmation {
  /** Phrases that, if already present in the prompt (case-insensitive), express the term. */
  coveredBy?: string[];
  /** A positive sentence to append when nothing in the prompt covers the term. */
  clause?: string;
}

export type AffirmationTable = Readonly<Record<string, Affirmation>>;

export interface StandalonePrompt {
  /** The prompt with any needed clauses appended. */
  text: string;
  /** Clauses that were appended, in order, without duplicates. */
  added: string[];
  /** Terms that neither the prompt nor the table could express. */
  unexpressed: string[];
}

export function composeStandalone(
  prompt: string,
  negative: Pick<ComposedNegative, 'terms'>,
  table: AffirmationTable,
): StandalonePrompt {
  const haystack = prompt.toLowerCase();
  const added: string[] = [];
  const unexpressed: string[] = [];

  for (const term of negative.terms) {
    const entry = table[term];
    if (!entry) {
      unexpressed.push(term);
      continue;
    }
    if (entry.coveredBy?.some((phrase) => haystack.includes(phrase.toLowerCase()))) continue;
    if (!entry.clause) {
      // Only coveredBy phrases exist and none matched: the term is lost.
      unexpressed.push(term);
      continue;
    }
    if (!added.includes(entry.clause)) added.push(entry.clause);
  }

  return { text: added.length ? `${prompt} ${added.join(' ')}` : prompt, added, unexpressed };
}

/**
 * Terms in a registry that the table has no entry for. Run this in a test so
 * adding a negative term without a positive wording fails loudly.
 */
export function unaffirmedTerms(
  registry: {
    global?: readonly string[];
    subjects?: Readonly<Record<string, { negatives?: readonly string[] }>>;
    motions?: Readonly<Record<string, { negatives?: readonly string[] }>>;
  },
  table: AffirmationTable,
): string[] {
  const groups: Array<readonly string[]> = [
    registry.global ?? [],
    ...Object.values(registry.subjects ?? {}).map((s) => s.negatives ?? []),
    ...Object.values(registry.motions ?? {}).map((m) => m.negatives ?? []),
  ];
  const missing = new Set<string>();
  for (const terms of groups) for (const term of terms) if (!table[term]) missing.add(term);
  return [...missing].sort();
}
