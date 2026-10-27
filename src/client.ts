import type { VeoOptions } from './options.js';

export interface ImageInput {
  bytes: Buffer;
  mimeType: string;
}

export interface VideoRequest {
  prompt: string;
  negativePrompt?: string;
  image: ImageInput;
  options: VeoOptions;
}

export interface GeneratedVideo {
  mimeType: string;
  bytes: Buffer;
}

/** Handle for a long-running operation. `name` is whatever the backend needs to poll it. */
export interface OperationHandle {
  name: string;
}

export type OperationStatus = { done: false } | { done: true; videos: GeneratedVideo[] };

/**
 * The one seam between the pipeline and a model backend. Implementations map
 * their transport errors to the typed errors in ./errors.ts:
 * QuotaExhaustedError, TransientError, UnrecoverableError (ContentFilteredError).
 */
export interface VideoModelClient {
  /** Submit a job. Returns quickly; generation continues server-side. */
  start(request: VideoRequest): Promise<OperationHandle>;
  /** Check a job once. Does not wait. When done, videos are already downloaded. */
  poll(operation: OperationHandle): Promise<OperationStatus>;
}
