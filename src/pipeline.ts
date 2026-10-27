import path from 'node:path';
import type { VideoModelClient } from './client.js';
import { prepareImage, type PrepOptions } from './imagePrep.js';
import { resolveOptions, type RawVeoOptions } from './options.js';
import { pollUntilDone, retryOnQuota, type PollOptions, type QuotaRetryOptions } from './poll.js';
import type { Storage } from './storage.js';

export interface GenerateInput {
  image: Buffer;
  prompt: string;
  negativePrompt?: string;
  /** Output file stem; samples get -1, -2, ... when there is more than one. */
  name?: string;
  options?: RawVeoOptions;
  prep?: Partial<Omit<PrepOptions, 'aspectRatio'>>;
  poll?: PollOptions;
  quota?: QuotaRetryOptions;
}

export interface GenerateResult {
  /** Locators returned by the storage, one per sample. */
  saved: string[];
  operationName: string;
}

/**
 * The whole flow: prepare the photo, submit (waiting out quota), poll until
 * done, store every sample.
 */
export async function generateClip(
  client: VideoModelClient,
  storage: Storage,
  input: GenerateInput,
): Promise<GenerateResult> {
  const options = resolveOptions(input.options);
  const prepared = await prepareImage(input.image, { ...input.prep, aspectRatio: options.aspectRatio });

  const operation = await retryOnQuota(
    () =>
      client.start({
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        image: { bytes: prepared.bytes, mimeType: prepared.mimeType },
        options,
      }),
    input.quota,
  );

  const done = await pollUntilDone(client, operation, input.poll);

  const stem = path.parse(input.name ?? 'clip').name;
  const saved: string[] = [];
  for (const [i, video] of done.videos.entries()) {
    const suffix = done.videos.length > 1 ? `-${i + 1}` : '';
    saved.push(await storage.save(`${stem}${suffix}.mp4`, video.bytes, video.mimeType));
  }
  return { saved, operationName: operation.name };
}
