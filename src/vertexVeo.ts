import { GoogleAuth } from 'google-auth-library';
import type {
  GeneratedVideo,
  OperationHandle,
  OperationStatus,
  VideoModelClient,
  VideoRequest,
} from './client.js';
import { ContentFilteredError, QuotaExhaustedError, TransientError, UnrecoverableError } from './errors.js';

export interface VertexConfig {
  project: string;
  location: string;
  /** If set, Veo writes results to this gs:// prefix and we download them from there. */
  outputGcsUri?: string;
}

/** Read config from GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION and OUTPUT_GCS_URI. */
export function vertexConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VertexConfig {
  const project = env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new UnrecoverableError('GOOGLE_CLOUD_PROJECT is not set');
  return {
    project,
    location: env.GOOGLE_CLOUD_LOCATION || 'us-central1',
    outputGcsUri: env.OUTPUT_GCS_URI || undefined,
  };
}

/**
 * Map an HTTP failure to a typed error. 429 and RESOURCE_EXHAUSTED mean
 * "wait for quota"; 5xx and 408 are worth retrying; everything else is a
 * problem with the request itself.
 */
export function classifyHttpError(status: number, body: string): Error {
  const text = body.slice(0, 500);
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(body)) {
    return new QuotaExhaustedError(`Quota exhausted (HTTP ${status}): ${text}`);
  }
  if (status >= 500 || status === 408) return new TransientError(`Server error (HTTP ${status}): ${text}`);
  return new UnrecoverableError(`Request rejected (HTTP ${status}): ${text}`);
}

interface RawVideo {
  gcsUri?: string;
  bytesBase64Encoded?: string;
  mimeType?: string;
}

interface RawOperation {
  name?: string;
  done?: boolean;
  error?: { code?: number; message?: string; status?: string };
  response?: {
    videos?: RawVideo[];
    raiMediaFilteredCount?: number;
    raiMediaFilteredReasons?: string[];
  };
}

export interface VertexDeps {
  fetch?: typeof fetch;
  getAccessToken?: () => Promise<string>;
}

export class VertexVeoClient implements VideoModelClient {
  private readonly fetchFn: typeof fetch;
  private readonly getToken: () => Promise<string>;

  constructor(
    private readonly config: VertexConfig,
    deps: VertexDeps = {},
  ) {
    this.fetchFn = deps.fetch ?? fetch;
    if (deps.getAccessToken) {
      this.getToken = deps.getAccessToken;
    } else {
      const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      this.getToken = async () => {
        const token = await auth.getAccessToken();
        if (!token) throw new UnrecoverableError('No Google credentials found (try: gcloud auth application-default login)');
        return token;
      };
    }
  }

  private modelUrl(model: string, method: string): string {
    const { project, location } = this.config;
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:${method}`;
  }

  private async post(url: string, body: unknown): Promise<RawOperation> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (err instanceof UnrecoverableError) throw err;
      throw new TransientError(`Network error: ${(err as Error).message}`, { cause: err });
    }
    const text = await res.text();
    if (!res.ok) throw classifyHttpError(res.status, text);
    return JSON.parse(text) as RawOperation;
  }

  async start(request: VideoRequest): Promise<OperationHandle> {
    const { options } = request;
    const parameters: Record<string, unknown> = {
      aspectRatio: options.aspectRatio,
      durationSeconds: options.durationSeconds,
      sampleCount: options.sampleCount,
      resolution: options.resolution,
      generateAudio: options.generateAudio,
    };
    if (request.negativePrompt) parameters.negativePrompt = request.negativePrompt;
    if (this.config.outputGcsUri) parameters.storageUri = this.config.outputGcsUri;

    const op = await this.post(this.modelUrl(options.model, 'predictLongRunning'), {
      instances: [
        {
          prompt: request.prompt,
          image: { bytesBase64Encoded: request.image.bytes.toString('base64'), mimeType: request.image.mimeType },
        },
      ],
      parameters,
    });
    if (!op.name) throw new UnrecoverableError('Veo did not return an operation name');
    // The poll call needs the model id too, so carry it in the handle.
    return { name: JSON.stringify({ model: options.model, operation: op.name }) };
  }

  async poll(handle: OperationHandle): Promise<OperationStatus> {
    const { model, operation } = JSON.parse(handle.name) as { model: string; operation: string };
    const op = await this.post(this.modelUrl(model, 'fetchPredictOperation'), { operationName: operation });
    if (!op.done) return { done: false };

    if (op.error) {
      const message = `${op.error.status ?? op.error.code}: ${op.error.message ?? 'operation failed'}`;
      // gRPC code 8 is RESOURCE_EXHAUSTED.
      if (op.error.code === 8 || op.error.status === 'RESOURCE_EXHAUSTED') throw new QuotaExhaustedError(message);
      throw new UnrecoverableError(message);
    }

    const videos = op.response?.videos ?? [];
    if (videos.length === 0) {
      const reasons = op.response?.raiMediaFilteredReasons ?? [];
      if (op.response?.raiMediaFilteredCount) {
        throw new ContentFilteredError('All samples were removed by a safety filter', reasons);
      }
      throw new UnrecoverableError('Operation finished without any video');
    }
    return { done: true, videos: await Promise.all(videos.map((v) => this.loadVideo(v))) };
  }

  private async loadVideo(video: RawVideo): Promise<GeneratedVideo> {
    const mimeType = video.mimeType ?? 'video/mp4';
    if (video.bytesBase64Encoded) return { mimeType, bytes: Buffer.from(video.bytesBase64Encoded, 'base64') };
    if (!video.gcsUri) throw new UnrecoverableError('Video has neither bytes nor a gcsUri');

    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(video.gcsUri);
    if (!match) throw new UnrecoverableError(`Unexpected storage URI: ${video.gcsUri}`);
    const url = `https://storage.googleapis.com/storage/v1/b/${match[1]}/o/${encodeURIComponent(match[2]!)}?alt=media`;
    let res: Response;
    try {
      res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${await this.getToken()}` } });
    } catch (err) {
      throw new TransientError(`Download failed: ${(err as Error).message}`, { cause: err });
    }
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    return { mimeType, bytes: Buffer.from(await res.arrayBuffer()) };
  }
}
