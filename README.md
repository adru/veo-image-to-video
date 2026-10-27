# veo-image-to-video

A small TypeScript library and CLI that turns a still photo into a short video with Google's Veo model on Vertex AI. It covers the parts around the model call that tend to go wrong in practice: fixing the photo's shape, waiting on a long-running job without hanging forever, telling quota errors apart from real failures, handling negative prompts properly, and checking whether the finished clip moved at all.

It is a rewrite of a pipeline I built for a production app, with the infrastructure (job queue, database, CDN) replaced by two small interfaces.

## Why the negative-prompt coverage check exists

Veo takes a prompt and, separately, a `negativePrompt`: things you do not want, like "text, watermark, morphing". That works fine through the API.

Plenty of tools only give you one text box. You write the prompt, you paste it in, and the negatives are gone. Nothing warns you. The clip comes back with a watermark-like smear or a morphing object, and the cause is not visible anywhere.

The usual fix is to turn each negative into a positive sentence and append it: "morphing" becomes "the object keeps its exact shape". That raises two problems this repo handles:

1. **The prompt may already say it.** If it contains "only the camera moves", appending "the object does not rotate" just repeats it, and repetition in a prompt costs attention. So each term can list phrases that count as already covered, and the check looks for them first.
2. **Some terms have no positive wording.** The easy mistake is to skip those quietly. Here they come back in an `unexpressed` list, so you can warn, fail a test, or accept the gap on purpose.

Several terms can share one clause ("text", "watermark" and "caption" all become one sentence about markings), and the clause is added once.

```
$ npx tsx src/cli.ts coverage --subject mug --motion steam \
    --prompt "A white mug of coffee on a wooden table. Steam rises. The mug stays upright."

negativePrompt field: text, watermark, morphing, low quality, spilling, tilting mug, boiling, camera moving

one-box prompt:
A white mug of coffee on a wooden table. Steam rises. The mug stays upright. The only markings
anywhere in the frame are the ones already on the object. It is a clean, well-exposed recording
from the first frame to the last. Nothing leaves the mug. The liquid surface stays still.

clauses added:   4
unexpressed:     morphing, camera moving
```

Here "tilting mug" was already covered by "the mug stays upright", so nothing was added for it, and two terms could not be expressed.

There is also `unaffirmedTerms(registry, table)`, meant for a test: it lists every negative in your registry that has no entry in the table, so adding a term without thinking about the one-box case fails the build.

The negatives composer (`composeNegative`) builds the term list from layers (global, per subject, per motion), removes duplicates, and drops terms the photo contradicts. If the photo shows a labelled package, forbidding "text" would be wrong, so those terms are removed and reported in `suppressed`.

The example terms and prompts in `src/examples.ts` are small generic ones. Real use needs your own registry.

## What else is in here

- **Image prep** (`src/imagePrep.ts`, uses sharp). Veo accepts 16:9 and 9:16 and does not repair other shapes, so a mismatched photo can come back with black bars. The prep step applies EXIF rotation, flattens transparency, and resizes to the exact target canvas. `contain` keeps the whole photo and fills the bars with a blurred copy of itself; `cover` crops.
- **Option validation** (`src/options.ts`). Every field is parsed strictly once. `"8abc"`, `"0"`, `"4K"` and a negative sample count are errors, not silently coerced, because a bad value here can change what you are billed for.
- **Polling** (`src/poll.ts`). Waits before the first check, backs off to a cap, has a hard deadline, and absorbs a few transient errors in a row. The clock is injectable, so tests run instantly.
- **Typed errors** (`src/errors.ts`). `QuotaExhaustedError` (wait and retry), `TransientError` (retry), `UnrecoverableError` (do not), plus `ContentFilteredError` and `PollDeadlineError`. `retryOnQuota` waits out quota errors up to its own deadline.
- **Motion measurement** (`src/measure.ts`). Decodes a small grayscale copy of the clip and measures frame-to-frame change. It reports whether the clip is static, continuous, or moves and then stops, plus the length of any still tail. Needs `ffmpeg` and `ffprobe` on your PATH.

## Architecture

```
            +-----------------+
 photo ---> |  prepareImage   |  resize / orient / flatten
            +--------+--------+
                     v
            +-----------------+      +-------------------+
            |  generateClip   | ---> | VideoModelClient  |  start(), poll()
            |  (pipeline.ts)  |      |  VertexVeoClient  |  REST + google-auth-library
            +---+---------+---+      +-------------------+
                |         |
     retryOnQuota    pollUntilDone
                |
                v
            +-----------+
            |  Storage  |  save()   LocalStorage writes to disk
            +-----------+

 negatives.ts + standalone.ts : pure functions, no network
 measure.ts                   : ffmpeg, no network
```

`VideoModelClient` and `Storage` are the only two seams. A fake client is all the tests need, and a different model backend or a bucket-backed store is one class each.

## Setup

Requires Node 20 or newer. `ffmpeg` is only needed for `measure`.

```sh
npm install
cp .env.example .env     # or export the variables yourself
gcloud auth application-default login
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | yes | Project with Vertex AI enabled |
| `GOOGLE_CLOUD_LOCATION` | no | Defaults to `us-central1` |
| `OUTPUT_GCS_URI` | no | If set, Veo writes to this `gs://` prefix and the client downloads from it; otherwise bytes come back inline |

The CLI does not load `.env` itself; export the variables or use `node --env-file=.env`.

## Usage

```sh
# generate (this costs money; check current Veo pricing)
npx tsx src/cli.ts generate --image photo.jpg \
  --prompt "A ceramic vase on a table. The camera orbits slowly a quarter turn around it." \
  --negative "text, watermark, morphing" \
  --out clip.mp4

# did it move?
npx tsx src/cli.ts measure clip.mp4

# see how negatives would be folded into a one-box prompt
npx tsx src/cli.ts coverage --prompt "..." --subject mug --motion steam
```

Other `generate` flags: `--duration 4|6|8`, `--aspect 9:16|16:9`, `--resolution 720p|1080p`, `--samples 1-4`, `--model`, `--audio`, `--fit contain|cover`.

As a library:

```ts
import { VertexVeoClient, vertexConfigFromEnv, LocalStorage, generateClip } from './src/index.js';

const client = new VertexVeoClient(vertexConfigFromEnv());
const { saved } = await generateClip(client, new LocalStorage('out'), {
  image: await readFile('photo.jpg'),
  prompt: 'Steam rises from a mug.',
  options: { durationSeconds: 6 },
});
```

## Tests

```sh
npm test            # vitest, 54 tests, no network, no credentials
npm run typecheck   # tsc --noEmit
```

The tests cover the negatives composer, the coverage check, option validation, polling and quota retry against a fake client, image prep with generated images, the Vertex client against a stubbed `fetch`, and the motion judge on synthetic frames. The live Veo path and the ffmpeg decoding step were checked by hand, not in the test suite.

## Limitations

- **The live Vertex call is the least tested part.** The request and response shapes follow the REST API as I know it, and are tested against a stub, but model ids, allowed durations and sample counts change between Veo versions. Check `src/options.ts` against the current docs before relying on it.
- **Coverage is substring matching.** `coveredBy` checks whether a phrase appears in the prompt. It cannot tell that a differently worded sentence means the same thing, and it will count a phrase that appears in a negated context. It errs toward adding a clause.
- **Positive clauses are not free.** Naming an unwanted thing, even to forbid it, can put it in the model's attention. Write clauses that avoid the noun where you can, and treat the table as something to tune against real clips.
- **The motion thresholds are guesses.** `DEFAULT_THRESHOLDS` were picked by eye on a few clips. Treat the verdict as a hint and look at the clip.
- **No retry of a whole failed job.** Quota errors on submit are retried; a job that fails after submission is reported, not resubmitted.
- **Polling state is not persisted.** If the process dies mid-poll, the operation continues on Google's side but this code does not resume it.
- **Aspect ratios are 16:9 and 9:16 only**, which is what Veo accepts.

## License

MIT, see [LICENSE](LICENSE).
