#!/usr/bin/env -S npx tsx
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { composeNegative } from './negatives.js';
import { composeStandalone } from './standalone.js';
import { EXAMPLE_AFFIRMATIONS, EXAMPLE_REGISTRY } from './examples.js';
import { generateClip } from './pipeline.js';
import { LocalStorage } from './storage.js';
import { VertexVeoClient, vertexConfigFromEnv } from './vertexVeo.js';
import { measureClip } from './measure.js';

const USAGE = `usage:
  cli.ts generate --image photo.jpg --prompt "..." --out clip.mp4
      [--negative "term, term"] [--duration 4|6|8] [--aspect 9:16|16:9]
      [--resolution 720p|1080p] [--samples 1-4] [--model <id>] [--audio]
      [--fit contain|cover]
  cli.ts measure clip.mp4 [more.mp4 ...] [--json]
  cli.ts coverage --prompt "..." --subject mug --motion steam [--has-text] [--has-hands]
      Shows which negatives a one-box prompt already states, which get a
      clause appended, and which stay unexpressed (uses the example registry).`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function generate(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      image: { type: 'string' },
      prompt: { type: 'string' },
      out: { type: 'string' },
      negative: { type: 'string' },
      duration: { type: 'string' },
      aspect: { type: 'string' },
      resolution: { type: 'string' },
      samples: { type: 'string' },
      model: { type: 'string' },
      audio: { type: 'boolean', default: false },
      fit: { type: 'string' },
    },
  });
  if (!values.image || !values.prompt || !values.out) fail(USAGE);
  if (values.fit && values.fit !== 'contain' && values.fit !== 'cover') fail('--fit must be contain or cover');

  const out = path.resolve(values.out);
  const client = new VertexVeoClient(vertexConfigFromEnv());
  const result = await generateClip(client, new LocalStorage(path.dirname(out)), {
    image: await readFile(values.image),
    prompt: values.prompt,
    negativePrompt: values.negative,
    name: path.basename(out),
    options: {
      durationSeconds: values.duration,
      aspectRatio: values.aspect,
      resolution: values.resolution,
      sampleCount: values.samples,
      model: values.model,
      generateAudio: values.audio || undefined,
    },
    prep: { fit: values.fit as 'contain' | 'cover' | undefined },
    poll: { onTick: ({ attempt, elapsedMs }) => console.error(`  still working (check ${attempt}, ${Math.round(elapsedMs / 1000)}s)`) },
    quota: { onWait: ({ waitMs }) => console.error(`  quota exhausted, retrying in ${waitMs / 1000}s`) },
  });
  for (const file of result.saved) console.log(file);
}

async function measure(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, options: { json: { type: 'boolean', default: false } }, allowPositionals: true });
  if (positionals.length === 0) fail(USAGE);
  const all = [];
  for (const file of positionals) {
    const { samples, verdict } = await measureClip(file);
    all.push({ file, verdict });
    if (values.json) continue;
    console.log(`\n${path.basename(file)}  ${samples.width}x${samples.height}, ${samples.durationSeconds.toFixed(1)}s`);
    console.log(`  shape          ${verdict.shape}`);
    console.log(`  frames moving  ${Math.round(verdict.movingFraction * 100)}%`);
    console.log(`  peak / median  ${verdict.peak.toFixed(2)} at ${verdict.peakAt.toFixed(1)}s / ${verdict.median.toFixed(2)}`);
    console.log(`  dead tail      ${verdict.deadTailSeconds.toFixed(1)}s`);
    console.log(
      `  by region      top ${samples.regions.top.toFixed(2)}  middle ${samples.regions.middle.toFixed(2)}  bottom ${samples.regions.bottom.toFixed(2)}`,
    );
    for (const note of verdict.notes) console.log(`  note: ${note}`);
  }
  if (values.json) console.log(JSON.stringify(all, null, 2));
}

function coverage(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      prompt: { type: 'string' },
      subject: { type: 'string', default: 'product' },
      motion: { type: 'string', default: 'orbit' },
      'has-text': { type: 'boolean', default: false },
      'has-hands': { type: 'boolean', default: false },
    },
  });
  if (!values.prompt) fail(USAGE);
  const negative = composeNegative(EXAMPLE_REGISTRY, values.subject!, values.motion!, {
    hasText: values['has-text'],
    hasHands: values['has-hands'],
  });
  const standalone = composeStandalone(values.prompt, negative, EXAMPLE_AFFIRMATIONS);
  console.log(`negativePrompt field: ${negative.text || '(none)'}`);
  if (negative.suppressed.length) console.log(`suppressed by the photo: ${negative.suppressed.join(', ')}`);
  console.log(`\none-box prompt:\n${standalone.text}`);
  console.log(`\nclauses added:   ${standalone.added.length}`);
  console.log(`unexpressed:     ${standalone.unexpressed.join(', ') || '(none)'}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'generate': return generate(rest);
    case 'measure': return measure(rest);
    case 'coverage': return coverage(rest);
    default: fail(USAGE);
  }
}

main().catch((err: Error) => {
  console.error(`${err.name}: ${err.message}`);
  process.exit(1);
});
