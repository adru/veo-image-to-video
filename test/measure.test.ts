import { describe, expect, it } from 'vitest';
import { SAMPLE_FPS, diffFrames, judgeMotion } from '../src/measure.js';

const W = 4;
const H = 6;
const frame = (v: number) => Buffer.alloc(W * H, v);

describe('diffFrames', () => {
  it('is zero for identical frames and the pixel delta otherwise', () => {
    const still = diffFrames(Buffer.concat([frame(10), frame(10), frame(10)]), W, H);
    expect(still.diffs).toEqual([0, 0]);
    const moving = diffFrames(Buffer.concat([frame(10), frame(30)]), W, H);
    expect(moving.diffs).toEqual([20]);
    expect(moving.regions.top).toBeCloseTo(20);
  });
});

describe('judgeMotion', () => {
  const regions = { top: 0, middle: 0, bottom: 0 };
  it('calls an unmoving clip static', () => {
    expect(judgeMotion({ diffs: new Array(40).fill(0.05), regions }).shape).toBe('static');
  });
  it('calls steady motion continuous', () => {
    expect(judgeMotion({ diffs: new Array(40).fill(3), regions }).shape).toBe('continuous');
  });
  it('detects motion that stops early', () => {
    const diffs = [...new Array(20).fill(3), ...new Array(20).fill(0)];
    const v = judgeMotion({ diffs, regions });
    expect(v.shape).toBe('burst-then-still');
    expect(v.deadTailSeconds).toBeCloseTo(20 / SAMPLE_FPS);
  });
});
