import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, resolveOptions } from '../src/options.js';
import { OptionValidationError } from '../src/errors.js';

describe('resolveOptions', () => {
  it('returns defaults for empty input', () => {
    expect(resolveOptions()).toEqual(DEFAULT_OPTIONS);
    expect(resolveOptions({ durationSeconds: '', sampleCount: null })).toEqual(DEFAULT_OPTIONS);
  });

  it('accepts numeric strings, as they arrive from a CLI', () => {
    const r = resolveOptions({ durationSeconds: '6', sampleCount: '2', generateAudio: 'true' });
    expect(r.durationSeconds).toBe(6);
    expect(r.sampleCount).toBe(2);
    expect(r.generateAudio).toBe(true);
  });

  it.each([
    ['durationSeconds', '5'],
    ['durationSeconds', '8abc'],
    ['sampleCount', '0'],
    ['sampleCount', '-5'],
    ['sampleCount', '99'],
    ['sampleCount', '1.5'],
    ['resolution', '4K'],
    ['aspectRatio', '1:1'],
    ['model', 'veo-9'],
    ['generateAudio', 'yes'],
  ])('rejects %s = %s', (field, value) => {
    expect(() => resolveOptions({ [field]: value })).toThrow(OptionValidationError);
  });

  it('names the offending field', () => {
    try {
      resolveOptions({ resolution: '4K' });
    } catch (e) {
      expect((e as OptionValidationError).field).toBe('resolution');
    }
  });

  it('does not treat sampleCount "0" as unset', () => {
    expect(() => resolveOptions({ sampleCount: '0' })).toThrow();
  });
});
