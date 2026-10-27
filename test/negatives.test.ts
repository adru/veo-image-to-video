import { describe, expect, it } from 'vitest';
import { composeNegative, type NegativeRegistry } from '../src/negatives.js';

const registry: NegativeRegistry = {
  global: ['text', 'watermark', 'morphing'],
  subjects: { mug: { negatives: ['spilling', 'morphing'] } },
  motions: { orbit: { negatives: ['zooming', 'person'] } },
};

describe('composeNegative', () => {
  it('orders global, subject, motion and removes duplicates', () => {
    const r = composeNegative(registry, 'mug', 'orbit');
    expect(r.terms).toEqual(['text', 'watermark', 'morphing', 'spilling', 'zooming', 'person']);
    expect(r.text).toBe('text, watermark, morphing, spilling, zooming, person');
  });

  it('drops the lettering cluster when the photo has real text, and reports it', () => {
    const r = composeNegative(registry, 'mug', 'orbit', { hasText: true });
    expect(r.terms).not.toContain('text');
    expect(r.terms).not.toContain('watermark');
    expect(r.suppressed).toEqual(['text', 'watermark']);
  });

  it('drops person terms when a hand is in the photo and adds hand-defect terms', () => {
    const r = composeNegative(registry, 'mug', 'orbit', { hasHands: true });
    expect(r.terms).not.toContain('person');
    expect(r.suppressed).toEqual(['person']);
    expect(r.terms).toContain('extra fingers');
    expect(r.layers.at(-1)?.layer).toBe('hand');
  });

  it('tolerates unknown subject and motion keys', () => {
    const r = composeNegative(registry, 'nope', 'nada');
    expect(r.terms).toEqual(['text', 'watermark', 'morphing']);
  });
});
