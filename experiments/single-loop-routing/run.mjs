/**
 * Replay a fixture turn through the single-loop routing.
 *
 *   node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 3 --llm replay [--admission lane|jev] [--out <dir>]
 *     [--compile on|off]   (SL-13: `off` runs the engine without the typed-feature compile of contract §135.30, the SL-12 policy)
 *     [--prescreen on|off] (SL-13 follow-up: `off` launches with the Jev preselect setting off, as live gate #4 did: the run's
 *                          read attaches no prescreen material; default `on`, the owner's App)
 *     [--arm after|before] [--latency none|live]   (SL-10: `before` sets the time budget out of reach and the bookkeeping
 *     admission fast path off; `live` makes the replayed Keeper and admission lane wait their recorded live times)
 *     [--lane replay|live] [--lane-model <provider/model>]   (SL-24: `live` puts every admission review to the real lane
 *     model, default opencode-go/deepseek-v4.1-flash, instead of replaying the recorded verdicts; a call the live table
 *     refused only with `review_timeout` is replayed, and a `review_pending` refusal is resent once, as its fix says)
 *     [--reader none|live] [--reader-model <provider/model>] [--wait-answer <ms>]   (SL-36: `live` gives the reading service a
 *     real reader, default grok-build/grok-4.7-build-fast with the App's credential copied; `--wait-answer` waits for a pending
 *     consultation to settle before each `--then` turn)
 *   node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 3 [--llm none] [--driver prototype]
 *
 * `--llm replay` runs the PRODUCT driver (SL-02): a real Pi session with PI_COC_LOOP_ENGINE=hybrid-v1, the
 * product's hybrid engine and the kernel extension over the emitted kernel (`product-entry.ts`). `--driver
 * prototype`, or `--llm none`, runs the prototype's own `runTurn` (`run-entry.ts`), which is bundled with esbuild
 * into a temporary file next to the repository's node_modules first. Both need a built runtime
 * (`npm run build:runtime`) and the App's Jev key (read from the profile's secret vault).
 */
import {mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2), value = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
if (value('--llm') === 'replay' && value('--driver') !== 'prototype') {
  const {main} = await import(pathToFileURL(join(import.meta.dirname, 'product-entry.ts')).href);
  await main(argv);
} else {
  const scratch = mkdtempSync(join(tmpdir(), 'single-loop-routing-bundle-'));
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(scratch, 'node_modules'), 'dir');
    await build({entryPoints: [join(import.meta.dirname, 'run-entry.ts')], outfile: join(scratch, 'run-entry.mjs'), bundle: true, packages: 'external',
      format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent', define: {'import.meta.dirname': JSON.stringify(import.meta.dirname)}});
    const {main} = await import(pathToFileURL(join(scratch, 'run-entry.mjs')).href);
    await main(argv);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}
