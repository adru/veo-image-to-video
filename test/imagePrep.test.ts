import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareImage, targetSize } from '../src/imagePrep.js';

const solid = (width: number, height: number, color = '#cc3322') =>
  sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

describe('targetSize', () => {
  it('computes portrait and landscape canvases', () => {
    expect(targetSize('9:16', 1920)).toEqual({ width: 1080, height: 1920 });
    expect(targetSize('16:9', 1920)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('prepareImage', () => {
  it('turns a landscape photo into an exact portrait canvas (contain)', async () => {
    const r = await prepareImage(await solid(800, 600), { aspectRatio: '9:16', longSide: 640 });
    expect([r.width, r.height]).toEqual([360, 640]);
    expect(r.alreadyMatched).toBe(false);
    expect(r.mimeType).toBe('image/jpeg');
    const meta = await sharp(r.bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([360, 640, 'jpeg']);
  });

  it('keeps the whole photo with contain: the corners are filled, not black', async () => {
    const r = await prepareImage(await solid(800, 600, '#ffffff'), { aspectRatio: '9:16', longSide: 640 });
    const { data } = await sharp(r.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200); // top-left pixel is part of the blurred fill
  });

  it('crops with cover', async () => {
    const r = await prepareImage(await solid(800, 600), { aspectRatio: '16:9', fit: 'cover', longSide: 640 });
    expect([r.width, r.height]).toEqual([640, 360]);
  });

  it('only re-encodes when the shape already matches', async () => {
    const r = await prepareImage(await solid(540, 960), { aspectRatio: '9:16', longSide: 960 });
    expect(r.alreadyMatched).toBe(true);
    expect([r.width, r.height]).toEqual([540, 960]);
  });

  it('flattens transparency and can emit png', async () => {
    const transparent = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const r = await prepareImage(transparent, { aspectRatio: '16:9', format: 'png', longSide: 320 });
    expect(r.mimeType).toBe('image/png');
    const meta = await sharp(r.bytes).metadata();
    expect(meta.hasAlpha).toBe(false);
  });

  it('applies EXIF orientation before measuring', async () => {
    // 200x100 pixels tagged "rotate 90": displays as 100x200, already portrait-ish.
    const tagged = await sharp(await solid(200, 100)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await prepareImage(tagged, { aspectRatio: '9:16', fit: 'cover', longSide: 320 });
    expect([r.width, r.height]).toEqual([180, 320]);
  });

  it('rejects data that is not an image', async () => {
    await expect(prepareImage(Buffer.from('nope'), { aspectRatio: '9:16' })).rejects.toThrow();
  });
});
