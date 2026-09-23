/**
 * The startup record of a Keeper session (spec pi-native-single-loop, user story 35): which engine and
 * which Pi the table runs on, written once as the campaign's `lane: "startup"` telemetry row when the
 * table opens. The Pi facts come from the package the session actually runs (the vendored build under
 * the resource root, ADR-0006), whose `package.json` the build stamps with its base and patch digest.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PI_PACKAGE_ROOT } from './deployment.mjs';
import { LOOP_ENGINES, LOOP_PROTOCOLS, type LoopEngine } from './loop-engine.ts';

export interface StartupRecord {
  lane: 'startup';
  loop_engine: LoopEngine;
  loop_protocol_version: string;
  pi: { version: string | null; base_tag: string | null; base_commit: string | null; patch_series_digest: string | null; vendored: boolean };
  layout: string;
}

export function startupRecord(resourceRoot: string, env: Readonly<NodeJS.ProcessEnv>): StartupRecord {
  const requested = env.PI_COC_LOOP_ENGINE?.trim() || 'legacy';
  const engine: LoopEngine = (LOOP_ENGINES as readonly string[]).includes(requested) ? requested as LoopEngine : 'legacy';
  let manifest: Record<string, any> = {};
  try { manifest = JSON.parse(readFileSync(join(resourceRoot, PI_PACKAGE_ROOT, 'package.json'), 'utf8')); }
  catch { /* A tree without the vendored build reports nulls rather than guessing. */ }
  const piCoc = manifest.piCoc ?? {};
  return {
    lane: 'startup',
    loop_engine: engine,
    loop_protocol_version: LOOP_PROTOCOLS[engine],
    pi: { version: typeof manifest.version === 'string' ? manifest.version : null, base_tag: piCoc.base?.tag ?? null,
      base_commit: piCoc.base?.commit ?? null, patch_series_digest: piCoc.patchSeriesDigest ?? null, vendored: piCoc.vendored === true },
    layout: env.PI_COC_LAYOUT?.trim() || 'source',
  };
}
