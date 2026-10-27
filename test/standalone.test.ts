import { describe, expect, it } from 'vitest';
import { composeStandalone, unaffirmedTerms, type AffirmationTable } from '../src/standalone.js';
import { EXAMPLE_AFFIRMATIONS, EXAMPLE_REGISTRY } from '../src/examples.js';

const table: AffirmationTable = {
  spilling: { clause: 'Nothing leaves the mug.' },
  splashing: { clause: 'Nothing leaves the mug.' },
  zooming: { coveredBy: ['the camera is locked off'] },
  tilting: { coveredBy: ['stays upright'], clause: 'The mug stays upright.' },
};

describe('composeStandalone', () => {
  it('appends a clause for a term the prompt does not state', () => {
    const r = composeStandalone('A mug on a table.', { terms: ['spilling'] }, table);
    expect(r.text).toBe('A mug on a table. Nothing leaves the mug.');
    expect(r.added).toEqual(['Nothing leaves the mug.']);
    expect(r.unexpressed).toEqual([]);
  });

  it('adds a shared clause only once', () => {
    const r = composeStandalone('A mug.', { terms: ['spilling', 'splashing'] }, table);
    expect(r.added).toHaveLength(1);
  });

  it('adds nothing when the prompt already covers the term (case-insensitive)', () => {
    const r = composeStandalone('The Camera Is Locked Off.', { terms: ['zooming', 'tilting'] }, table);
    expect(r.text).toContain('The Camera Is Locked Off.');
    expect(r.added).toEqual(['The mug stays upright.']);
    expect(r.unexpressed).toEqual([]);
  });

  it('skips the clause when covered even if one exists', () => {
    const r = composeStandalone('The mug stays upright.', { terms: ['tilting'] }, table);
    expect(r.added).toEqual([]);
    expect(r.text).toBe('The mug stays upright.');
  });

  it('reports a term with no table entry as unexpressed instead of dropping it', () => {
    const r = composeStandalone('A mug.', { terms: ['spilling', 'glitter'] }, table);
    expect(r.unexpressed).toEqual(['glitter']);
  });

  it('reports a covered-only term as unexpressed when its phrase is absent', () => {
    const r = composeStandalone('A mug.', { terms: ['zooming'] }, table);
    expect(r.unexpressed).toEqual(['zooming']);
    expect(r.text).toBe('A mug.');
  });

  it('leaves the prompt untouched when there are no terms', () => {
    expect(composeStandalone('A mug.', { terms: [] }, table).text).toBe('A mug.');
  });
});

describe('unaffirmedTerms', () => {
  it('lists registry terms with no table entry, sorted and unique', () => {
    const missing = unaffirmedTerms(
      { global: ['b', 'spilling'], subjects: { x: { negatives: ['a', 'b'] } }, motions: { y: { negatives: ['zooming'] } } },
      table,
    );
    expect(missing).toEqual(['a', 'b']);
  });

  it('the example registry has exactly one known gap', () => {
    expect(unaffirmedTerms(EXAMPLE_REGISTRY, EXAMPLE_AFFIRMATIONS)).toEqual(['camera moving']);
  });
});
