import { OptionValidationError } from './errors.js';

export const VALID_DURATIONS = [4, 6, 8] as const;
export const VALID_RESOLUTIONS = ['720p', '1080p'] as const;
export const VALID_ASPECT_RATIOS = ['16:9', '9:16'] as const;
export const VALID_MODELS = ['veo-3.1-generate-001', 'veo-3.1-fast-generate-001'] as const;

export const MIN_SAMPLE_COUNT = 1;
export const MAX_SAMPLE_COUNT = 4;

export type Resolution = (typeof VALID_RESOLUTIONS)[number];
export type AspectRatio = (typeof VALID_ASPECT_RATIOS)[number];
export type VeoModel = (typeof VALID_MODELS)[number];

export interface VeoOptions {
  model: VeoModel;
  durationSeconds: number;
  sampleCount: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  generateAudio: boolean;
}

export const DEFAULT_OPTIONS: VeoOptions = {
  model: 'veo-3.1-fast-generate-001',
  durationSeconds: 8,
  sampleCount: 1,
  resolution: '1080p',
  aspectRatio: '9:16',
  generateAudio: false,
};

/** Loose input, as it arrives from a CLI or an HTTP body: everything may be a string. */
export type RawVeoOptions = Partial<Record<keyof VeoOptions, unknown>>;

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

/**
 * Integers only. Number.parseInt("8abc") is 8 and Number("") is 0, and both
 * have been the start of a billing surprise somewhere, so parse strictly.
 */
function strictInt(raw: unknown, field: string): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n)) throw new OptionValidationError(field, `${field} must be an integer`);
  return n;
}

function oneOf<T extends string | number>(raw: unknown, allowed: readonly T[], field: string): T {
  const value = typeof allowed[0] === 'number' ? strictInt(raw, field) : String(raw);
  if (!(allowed as readonly unknown[]).includes(value)) {
    throw new OptionValidationError(field, `${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function bool(raw: unknown, field: string): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new OptionValidationError(field, `${field} must be true or false`);
}

/**
 * Fill defaults and validate every field exactly once. Unknown values are
 * rejected, not silently replaced: a typo in `resolution` should fail loudly
 * instead of quietly generating something else.
 */
export function resolveOptions(raw: RawVeoOptions = {}, defaults: VeoOptions = DEFAULT_OPTIONS): VeoOptions {
  const pick = <K extends keyof VeoOptions>(key: K) => (isBlank(raw[key]) ? undefined : raw[key]);

  const model = pick('model');
  const duration = pick('durationSeconds');
  const samples = pick('sampleCount');
  const resolution = pick('resolution');
  const aspect = pick('aspectRatio');
  const audio = pick('generateAudio');

  let sampleCount = defaults.sampleCount;
  if (samples !== undefined) {
    sampleCount = strictInt(samples, 'sampleCount');
    if (sampleCount < MIN_SAMPLE_COUNT || sampleCount > MAX_SAMPLE_COUNT) {
      throw new OptionValidationError(
        'sampleCount',
        `sampleCount must be between ${MIN_SAMPLE_COUNT} and ${MAX_SAMPLE_COUNT}`,
      );
    }
  }

  return {
    model: model === undefined ? defaults.model : oneOf(model, VALID_MODELS, 'model'),
    durationSeconds: duration === undefined ? defaults.durationSeconds : oneOf(duration, VALID_DURATIONS, 'durationSeconds'),
    sampleCount,
    resolution: resolution === undefined ? defaults.resolution : oneOf(resolution, VALID_RESOLUTIONS, 'resolution'),
    aspectRatio: aspect === undefined ? defaults.aspectRatio : oneOf(aspect, VALID_ASPECT_RATIOS, 'aspectRatio'),
    generateAudio: audio === undefined ? defaults.generateAudio : bool(audio, 'generateAudio'),
  };
}
