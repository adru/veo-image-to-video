/**
 * Small, generic example data. Replace with your own; this exists so the CLI
 * and the tests have something concrete to run against.
 */
import type { NegativeRegistry } from './negatives.js';
import type { AffirmationTable } from './standalone.js';

export const EXAMPLE_REGISTRY: NegativeRegistry = {
  global: ['text', 'watermark', 'morphing', 'low quality'],
  subjects: {
    product: { negatives: ['warping object', 'duplicated object'] },
    mug: { negatives: ['spilling', 'tilting mug'] },
  },
  motions: {
    orbit: { negatives: ['zooming', 'object rotating'] },
    steam: { negatives: ['boiling', 'camera moving'] },
  },
};

const NO_LETTERING = 'The only markings anywhere in the frame are the ones already on the object.';
const SAME_OBJECT = 'the same object, the same size';

export const EXAMPLE_AFFIRMATIONS: AffirmationTable = {
  text: { clause: NO_LETTERING },
  watermark: { clause: NO_LETTERING },
  morphing: { coveredBy: [SAME_OBJECT] },
  'low quality': { clause: 'It is a clean, well-exposed recording from the first frame to the last.' },
  'warping object': { coveredBy: [SAME_OBJECT], clause: 'The object keeps its exact shape throughout.' },
  'duplicated object': { coveredBy: [SAME_OBJECT] },
  spilling: { clause: 'Nothing leaves the mug.' },
  'tilting mug': { coveredBy: ['the mug stays upright'], clause: 'The mug stays upright throughout.' },
  zooming: { coveredBy: ['the camera orbits at a constant distance'] },
  'object rotating': { coveredBy: ['only the camera moves'], clause: 'Only the camera moves; the object stays still.' },
  boiling: { clause: 'The liquid surface stays still.' },
  // 'camera moving' is deliberately absent: it shows up as `unexpressed`.
};

export const EXAMPLE_PROMPTS = {
  orbit: 'A product photo of a ceramic vase on a table. The camera orbits at a constant distance, slowly, a quarter turn around it. Only the camera moves.',
  steam: 'A white mug of coffee on a wooden table. Thin steam rises and fades above the cup. The mug stays upright and the camera is still.',
  pan: 'A pair of sneakers on a plain background. The camera slides slowly left to right.',
} as const;
