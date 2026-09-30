import {readJevApiKey} from '../extensions/jev/agent/config.js';
/**
 * `PI_COC_LOOP_ENGINE` selects the Keeper's run engine (spec pi-native-single-loop, SL-01):
 *
 * - `legacy` (explicit control, private experiments, or setup without Jev): Pi's model-first loop;
 * - `hybrid-v1`: Pi's RunDriver (vendored agent-core, ADR-0006) started through `runtime/pi-hybrid.ts`, with the
 *   product's step policy and ports for play (`runtime/jev/hybrid-engine.ts`) and, for a setup session, the setup
 *   policy `coc-setup-v1` and its own ports (`runtime/jev/setup-engine.ts`, contract §151.6). Setup never runs the
 *   play policy: that one needs a world `setup.confirm` has not created yet.
 *
 * Setup runs driven only when a Jev credential is readable: with none there is nothing to drive it, so even an
 * explicit `hybrid-v1` runs setup on legacy. The two never mix inside a run: the engine is fixed when the Keeper
 * process starts, and the launcher hands the resolved engine to the child so the startup record names the engine
 * that actually ran.
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
  const privateLegacy=env.PI_COC_JEV_S0==='1'||env.PI_COC_TASK_RUNTIME==='1';
  const jev=!!readJevApiKey(env);
  // Normal play keeps the check owner even without credentials; unavailability is not LLM authority (§159).
  const requested = env.PI_COC_LOOP_ENGINE?.trim() || (!privateLegacy&&(mode==='play'||jev)?'hybrid-v1':'legacy');
  if (!(LOOP_ENGINES as readonly string[]).includes(requested))
    throw new Error(`PI_COC_LOOP_ENGINE must be one of ${LOOP_ENGINES.join(', ')}; got ${requested}`);
  if (mode === 'play') return requested as LoopEngine;
  // §151.6: a setup session is driven with Jev available and no explicit legacy switch; otherwise legacy as before.
  return requested === 'hybrid-v1' && jev && !privateLegacy ? 'hybrid-v1' : 'legacy';
}
