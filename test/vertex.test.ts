import { describe, expect, it } from 'vitest';
import { ContentFilteredError, QuotaExhaustedError, TransientError, UnrecoverableError } from '../src/errors.js';
import { VertexVeoClient, classifyHttpError, vertexConfigFromEnv } from '../src/vertexVeo.js';
import { resolveOptions } from '../src/options.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function client(responses: Response[], calls: Array<{ url: string; body: any }> = []) {
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return responses.shift()!;
  }) as unknown as typeof fetch;
  return new VertexVeoClient({ project: 'p', location: 'us-central1' }, { fetch: fetchFn, getAccessToken: async () => 't' });
}

const request = { prompt: 'a', image: { bytes: Buffer.from('i'), mimeType: 'image/jpeg' }, options: resolveOptions() };

describe('classifyHttpError', () => {
  it('maps status codes to typed errors', () => {
    expect(classifyHttpError(429, '')).toBeInstanceOf(QuotaExhaustedError);
    expect(classifyHttpError(400, 'RESOURCE_EXHAUSTED')).toBeInstanceOf(QuotaExhaustedError);
    expect(classifyHttpError(503, '')).toBeInstanceOf(TransientError);
    expect(classifyHttpError(403, '')).toBeInstanceOf(UnrecoverableError);
  });
});

describe('vertexConfigFromEnv', () => {
  it('requires a project and defaults the location', () => {
    expect(() => vertexConfigFromEnv({})).toThrow(UnrecoverableError);
    expect(vertexConfigFromEnv({ GOOGLE_CLOUD_PROJECT: 'x' })).toEqual({ project: 'x', location: 'us-central1', outputGcsUri: undefined });
  });
});

describe('VertexVeoClient', () => {
  it('submits, then polls with the same model', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const c = client([json(200, { name: 'ops/1' }), json(200, { done: false })], calls);
    const handle = await c.start({ ...request, negativePrompt: 'blur' });
    expect(calls[0]!.url).toContain(':predictLongRunning');
    expect(calls[0]!.body.parameters.negativePrompt).toBe('blur');
    expect(await c.poll(handle)).toEqual({ done: false });
    expect(calls[1]!.url).toContain(':fetchPredictOperation');
    expect(calls[1]!.body.operationName).toBe('ops/1');
  });

  it('returns inline videos', async () => {
    const c = client([json(200, { name: 'ops/1' }), json(200, { done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from('mp4').toString('base64') }] } })]);
    const status = await c.poll(await c.start(request));
    expect(status.done && status.videos[0]!.bytes.toString()).toBe('mp4');
  });

  it('maps an operation-level quota error and a safety filter', async () => {
    const quota = client([json(200, { name: 'o' }), json(200, { done: true, error: { code: 8, message: 'q' } })]);
    await expect(quota.poll(await quota.start(request))).rejects.toBeInstanceOf(QuotaExhaustedError);
    const filtered = client([json(200, { name: 'o' }), json(200, { done: true, response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['x'] } })]);
    await expect(filtered.poll(await filtered.start(request))).rejects.toBeInstanceOf(ContentFilteredError);
  });
});
