/**
 * Did the clip actually move? A generated clip can be technically valid and
 * visually a still photo. This decodes a small grayscale copy of the clip
 * with ffmpeg and looks at how much each frame differs from the one before.
 *
 * Needs `ffmpeg` and `ffprobe` on PATH.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const SAMPLE_FPS = 8;
export const SAMPLE_WIDTH = 64;

export interface ClipSamples {
  width: number;
  height: number;
  durationSeconds: number;
  /** Mean absolute pixel difference (0-255) between each sampled frame and the previous one. */
  diffs: number[];
  /** Same, split by third of the frame height (top, middle, bottom), averaged over time. */
  regions: { top: number; middle: number; bottom: number };
}

export interface MotionThresholds {
  /** A frame pair counts as "moving" above this mean difference. */
  moving: number;
  /** Below this fraction of moving frames the clip is called static. */
  staticFraction: number;
  /** A dead tail longer than this many seconds is flagged. */
  deadTailSeconds: number;
}

export const DEFAULT_THRESHOLDS: MotionThresholds = { moving: 0.6, staticFraction: 0.1, deadTailSeconds: 1.5 };

export type MotionShape = 'static' | 'continuous' | 'burst-then-still' | 'irregular';

export interface MotionVerdict {
  shape: MotionShape;
  movingFraction: number;
  median: number;
  peak: number;
  peakAt: number;
  deadTailSeconds: number;
  notes: string[];
}

export function judgeMotion(clip: Pick<ClipSamples, 'diffs' | 'regions'>, t: MotionThresholds = DEFAULT_THRESHOLDS): MotionVerdict {
  const { diffs } = clip;
  const notes: string[] = [];
  if (diffs.length === 0) {
    return { shape: 'static', movingFraction: 0, median: 0, peak: 0, peakAt: 0, deadTailSeconds: 0, notes: ['No frames to compare.'] };
  }

  const movingFlags = diffs.map((d) => d > t.moving);
  const movingFraction = movingFlags.filter(Boolean).length / diffs.length;
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const peak = sorted[sorted.length - 1] ?? 0;
  const peakAt = (diffs.indexOf(peak) + 1) / SAMPLE_FPS;

  let tail = 0;
  while (tail < movingFlags.length && !movingFlags[movingFlags.length - 1 - tail]) tail++;
  const deadTailSeconds = tail / SAMPLE_FPS;

  let shape: MotionShape;
  if (movingFraction < t.staticFraction) shape = 'static';
  else if (deadTailSeconds >= t.deadTailSeconds && tail < movingFlags.length) shape = 'burst-then-still';
  else if (movingFraction > 0.7) shape = 'continuous';
  else shape = 'irregular';

  if (shape === 'static') notes.push('Almost nothing moved. The prompt may be too timid, or the motion too small to see.');
  if (shape === 'burst-then-still') notes.push(`Motion stops ${deadTailSeconds.toFixed(1)}s before the end.`);
  if (peak > 12 && median < 2) notes.push('One large spike with little else: possibly a scene cut rather than motion.');

  return { shape, movingFraction, median, peak, peakAt, deadTailSeconds, notes };
}

/** Pure part of the decoder: raw grayscale frames in, per-pair differences out. */
export function diffFrames(raw: Buffer, width: number, height: number): Pick<ClipSamples, 'diffs' | 'regions'> {
  const size = width * height;
  const count = Math.floor(raw.length / size);
  const diffs: number[] = [];
  const regionSums = [0, 0, 0];
  const third = Math.floor(height / 3);

  for (let f = 1; f < count; f++) {
    const a = (f - 1) * size;
    const b = f * size;
    let total = 0;
    for (let i = 0; i < size; i++) {
      const d = Math.abs((raw[b + i] ?? 0) - (raw[a + i] ?? 0));
      total += d;
      const row = Math.floor(i / width);
      regionSums[Math.min(2, Math.floor(row / Math.max(1, third)))]! += d;
    }
    diffs.push(total / size);
  }
  const pairs = Math.max(1, count - 1);
  const regionSize = third * width * pairs || 1;
  return {
    diffs,
    regions: { top: regionSums[0]! / regionSize, middle: regionSums[1]! / regionSize, bottom: regionSums[2]! / regionSize },
  };
}

export async function sampleClip(file: string): Promise<ClipSamples> {
  let probe;
  try {
    probe = await run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json', file,
    ]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('ffprobe/ffmpeg not found on PATH. Install ffmpeg to measure clips.');
    }
    throw err;
  }
  const info = JSON.parse(probe.stdout) as { streams?: Array<{ width: number; height: number }>; format?: { duration?: string } };
  const stream = info.streams?.[0];
  if (!stream) throw new Error(`No video stream in ${file}`);

  const height = Math.max(2, Math.round((SAMPLE_WIDTH * stream.height) / stream.width / 2) * 2);
  const { stdout } = await run(
    'ffmpeg',
    [
      '-v', 'error', '-i', file,
      '-vf', `fps=${SAMPLE_FPS},scale=${SAMPLE_WIDTH}:${height},format=gray`,
      '-f', 'rawvideo', '-',
    ],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
  );
  return {
    width: stream.width,
    height: stream.height,
    durationSeconds: Number(info.format?.duration ?? 0),
    ...diffFrames(stdout, SAMPLE_WIDTH, height),
  };
}

export async function measureClip(file: string, thresholds?: MotionThresholds) {
  const samples = await sampleClip(file);
  return { samples, verdict: judgeMotion(samples, thresholds) };
}
