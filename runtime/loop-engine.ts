/**
 * `PI_COC_LOOP_ENGINE` selects the Keeper's run engine (spec pi-native-single-loop, SL-01):
 *
 * - `legacy` (default, and when unset): Pi's model-first loop, exactly as before;
 * - `hybrid-v1`: Pi's RunDriver (vendored agent-core, ADR-0006) with the product's step policy and ports
 *   (`runtime/jev/hybrid-engine.ts`), started through `runtime/pi-hybrid.ts`.
 *
 * Play only in the first release: a setup session always runs legacy. The two never mix inside a run:
 * the engine is fixed when the Keeper process starts, and the launcher hands the resolved engine to the
 * child so the startup record names the engine that actually ran.
 */
export const LOOP_ENGINES = Object.freeze(['legacy', 'hybrid-v1'] as const);
export type LoopEngine = typeof LOOP_ENGINES[number];
/**
 * The loop protocol each engine speaks, as the startup record names it: agent-core's `RUN_LOOP_PROTOCOL`
 * and `RUN_EVENT_SCHEMA_VERSION` for the driver (pinned equal by tests/extension/single-loop-run-driver.test.mjs;
 * product code that may load from source does not import Pi values).
 */
export const LOOP_PROTOCOLS: Readonly<Record<LoopEngine, string>> = Object.freeze({legacy: 'legacy', 'hybrid-v1': 'hybrid-v1/events-1'});

export function selectLoopEngine(env: Readonly<NodeJS.ProcessEnv>, mode: 'play' | 'setup'): LoopEngine {
  const requested = env.PI_COC_LOOP_ENGINE?.trim() || 'legacy';
  if (!(LOOP_ENGINES as readonly string[]).includes(requested))
    throw new Error(`PI_COC_LOOP_ENGINE must be one of ${LOOP_ENGINES.join(', ')}; got ${requested}`);
  return mode === 'play' ? requested as LoopEngine : 'legacy';
}
