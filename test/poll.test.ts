import { describe, expect, it } from 'vitest';
import type { OperationStatus, VideoModelClient } from '../src/client.js';
import { PollDeadlineError, QuotaExhaustedError, TransientError, UnrecoverableError } from '../src/errors.js';
import { pollUntilDone, retryOnQuota, type Clock } from '../src/poll.js';

/** A clock that only moves when someone sleeps. */
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  return { clock, sleeps };
}

function scripted(steps: Array<OperationStatus | Error>): Pick<VideoModelClient, 'poll'> & { calls: number } {
  const c = {
    calls: 0,
    async poll(): Promise<OperationStatus> {
      const step = steps[Math.min(c.calls++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return c;
}

const video = { mimeType: 'video/mp4', bytes: Buffer.from('x') };
const op = { name: 'op-1' };

describe('pollUntilDone', () => {
  it('waits before the first check and backs off up to the cap', async () => {
    const { clock, sleeps } = fakeClock();
    const client = scripted([{ done: false }, { done: false }, { done: false }, { done: false }, { done: true, videos: [video] }]);
    const result = await pollUntilDone(client, op, { clock, initialDelayMs: 1000, factor: 2, maxDelayMs: 3000, deadlineMs: 60_000 });
    expect(result.videos).toHaveLength(1);
    expect(sleeps).toEqual([1000, 2000, 3000, 3000, 3000]);
    expect(client.calls).toBe(5);
  });

  it('throws PollDeadlineError and does not sleep past the deadline', async () => {
    const { clock, sleeps } = fakeClock();
    const client = scripted([{ done: false }]);
    await expect(pollUntilDone(client, op, { clock, initialDelayMs: 4000, factor: 1, deadlineMs: 10_000 })).rejects.toBeInstanceOf(
      PollDeadlineError,
    );
    expect(sleeps).toEqual([4000, 4000, 2000]);
  });

  it('absorbs a few transient errors in a row', async () => {
    const { clock } = fakeClock();
    const client = scripted([new TransientError('blip'), new TransientError('blip'), { done: true, videos: [video] }]);
    const r = await pollUntilDone(client, op, { clock, initialDelayMs: 10 });
    expect(r.done).toBe(true);
  });

  it('gives up when transient errors keep coming', async () => {
    const { clock } = fakeClock();
    const client = scripted([new TransientError('down')]);
    await expect(pollUntilDone(client, op, { clock, initialDelayMs: 10, maxTransientErrors: 2 })).rejects.toBeInstanceOf(TransientError);
    expect(client.calls).toBe(3);
  });

  it('resets the transient counter after a good poll', async () => {
    const { clock } = fakeClock();
    const t = new TransientError('blip');
    const client = scripted([t, { done: false }, t, { done: false }, t, { done: true, videos: [video] }]);
    const r = await pollUntilDone(client, op, { clock, initialDelayMs: 10, maxTransientErrors: 1 });
    expect(r.done).toBe(true);
  });

  it.each([new QuotaExhaustedError('q'), new UnrecoverableError('u')])('rethrows %s at once', async (err) => {
    const { clock } = fakeClock();
    const client = scripted([err]);
    await expect(pollUntilDone(client, op, { clock, initialDelayMs: 10 })).rejects.toBe(err);
    expect(client.calls).toBe(1);
  });
});

describe('retryOnQuota', () => {
  it('waits and retries on quota errors', async () => {
    const { clock, sleeps } = fakeClock();
    let n = 0;
    const out = await retryOnQuota(
      async () => {
        if (++n < 3) throw new QuotaExhaustedError('full');
        return 'ok';
      },
      { clock, backoffMs: 500, deadlineMs: 10_000 },
    );
    expect(out).toBe('ok');
    expect(sleeps).toEqual([500, 500]);
  });

  it('surfaces the quota error once the wait deadline would be passed', async () => {
    const { clock } = fakeClock();
    await expect(
      retryOnQuota(async () => { throw new QuotaExhaustedError('full'); }, { clock, backoffMs: 500, deadlineMs: 1200 }),
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it('does not retry other errors', async () => {
    const { clock, sleeps } = fakeClock();
    let n = 0;
    await expect(retryOnQuota(async () => { n++; throw new UnrecoverableError('bad'); }, { clock })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(n).toBe(1);
    expect(sleeps).toEqual([]);
  });
});
