import { PollDeadlineError, QuotaExhaustedError, TransientError } from './errors.js';
import type { OperationHandle, OperationStatus, VideoModelClient } from './client.js';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface PollOptions {
  /** Total time allowed before giving up. */
  deadlineMs?: number;
  /** Wait before the first check. Generation never finishes in seconds, so do not poll at once. */
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Each wait is the previous one times this, up to maxDelayMs. */
  factor?: number;
  /** Consecutive transient errors tolerated before the error is rethrown. */
  maxTransientErrors?: number;
  clock?: Clock;
  onTick?: (info: { attempt: number; elapsedMs: number }) => void;
}

export const DEFAULT_POLL: Required<Omit<PollOptions, 'clock' | 'onTick'>> = {
  deadlineMs: 10 * 60_000,
  initialDelayMs: 15_000,
  maxDelayMs: 30_000,
  factor: 1.5,
  maxTransientErrors: 5,
};

/**
 * Poll until the operation is done, with growing waits and a hard deadline.
 * A few transient errors in a row are absorbed (a blip must not throw away
 * a job that is already paid for). Quota and unrecoverable errors are
 * rethrown at once. Past the deadline, PollDeadlineError.
 */
export async function pollUntilDone(
  client: Pick<VideoModelClient, 'poll'>,
  operation: OperationHandle,
  options: PollOptions = {},
): Promise<Extract<OperationStatus, { done: true }>> {
  const o = { ...DEFAULT_POLL, ...options };
  const clock = options.clock ?? systemClock;
  const startedAt = clock.now();
  const deadlineAt = startedAt + o.deadlineMs;

  let delay = o.initialDelayMs;
  let transient = 0;

  for (let attempt = 1; ; attempt++) {
    const remaining = deadlineAt - clock.now();
    if (remaining <= 0) throw new PollDeadlineError(operation.name, o.deadlineMs);
    await clock.sleep(Math.min(delay, remaining));
    delay = Math.min(delay * o.factor, o.maxDelayMs);

    try {
      const status = await client.poll(operation);
      transient = 0;
      options.onTick?.({ attempt, elapsedMs: clock.now() - startedAt });
      if (status.done) return status;
    } catch (err) {
      if (err instanceof TransientError && ++transient <= o.maxTransientErrors) continue;
      throw err;
    }
  }
}

export interface QuotaRetryOptions {
  /** How long to keep waiting for quota to come back. */
  deadlineMs?: number;
  backoffMs?: number;
  clock?: Clock;
  onWait?: (info: { waitMs: number }) => void;
}

/**
 * Run `fn`; if it fails with QuotaExhaustedError, wait and run it again until
 * the deadline. Quota is shared and refills, so a short wait often works.
 * Anything else, and quota past the deadline, is rethrown.
 */
export async function retryOnQuota<T>(fn: () => Promise<T>, options: QuotaRetryOptions = {}): Promise<T> {
  const { deadlineMs = 15 * 60_000, backoffMs = 30_000 } = options;
  const clock = options.clock ?? systemClock;
  const deadlineAt = clock.now() + deadlineMs;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof QuotaExhaustedError) || clock.now() + backoffMs >= deadlineAt) throw err;
      options.onWait?.({ waitMs: backoffMs });
      await clock.sleep(backoffMs);
    }
  }
}
