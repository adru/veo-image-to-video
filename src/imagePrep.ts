import sharp from 'sharp';
import type { AspectRatio } from './options.js';

export interface PrepOptions {
  aspectRatio: AspectRatio;
  /**
   * How to fit a photo whose shape differs from the target.
   * - "cover": crop the overflow (the subject may lose its edges).
   * - "contain": keep the whole photo and fill the bars with a blurred, stretched copy of itself.
   */
  fit?: 'cover' | 'contain';
  /** Length of the long side of the output in pixels. */
  longSide?: number;
  format?: 'jpeg' | 'png';
}

export interface PreparedImage {
  bytes: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  /** True when the photo already had the target shape and was only re-encoded. */
  alreadyMatched: boolean;
}

export function targetSize(aspectRatio: AspectRatio, longSide: number): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number) as [number, number];
  const short = Math.round((longSide * Math.min(w, h)) / Math.max(w, h));
  return w >= h ? { width: longSide, height: short } : { width: short, height: longSide };
}

/**
 * Veo accepts 16:9 or 9:16 and does not repair other shapes: a mismatched
 * photo tends to come back with black bars. So fix the shape before upload.
 * Also applies EXIF orientation, drops alpha (flattened on white) and
 * re-encodes to a format Veo accepts.
 */
export async function prepareImage(input: Buffer, options: PrepOptions): Promise<PreparedImage> {
  const { aspectRatio, fit = 'contain', longSide = 1920, format = 'jpeg' } = options;
  const { width, height } = targetSize(aspectRatio, longSide);

  // rotate() with no argument applies EXIF orientation, then clears the tag.
  const oriented = await sharp(input).rotate().flatten({ background: '#ffffff' }).toBuffer({ resolveWithObject: true });
  const { width: sw = 0, height: sh = 0 } = oriented.info;
  if (!sw || !sh) throw new Error('Could not read image dimensions');

  const alreadyMatched = Math.abs(sw / sh - width / height) < 0.01;
  let pipeline: sharp.Sharp;

  if (fit === 'cover' || alreadyMatched) {
    pipeline = sharp(oriented.data).resize(width, height, { fit: 'cover', position: 'centre' });
  } else {
    const background = await sharp(oriented.data)
      .resize(width, height, { fit: 'cover' })
      .blur(40)
      .toBuffer();
    const foreground = await sharp(oriented.data).resize(width, height, { fit: 'inside' }).toBuffer();
    pipeline = sharp(background).composite([{ input: foreground, gravity: 'centre' }]);
  }

  const encoded = format === 'png' ? pipeline.png() : pipeline.jpeg({ quality: 92 });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return {
    bytes: data,
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    width: info.width,
    height: info.height,
    alreadyMatched,
  };
}
