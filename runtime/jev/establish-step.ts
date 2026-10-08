/**
 * Contract §203.4: the establishing duty where a run now stands, when it moved there after its capsule was read.
 *
 * The capsule a run begins with carries `mods.establish` for the place it began in, when that place is owed. The common
 * arrival is a move inside the run (the clerk's move of a declared action, or the Keeper's own `apply move`): the capsule
 * said nothing about the new place, and TR-F2 run 3's arrivals (2026-10-08) were written as two sentences. Asked once per
 * scene per run, read from the kernel (`table.establish.view`), as §168.5's first-sight step is.
 */
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

export interface EstablishStepRun {runId: string; turn?: number; scene?: string; firstScene?: string; establishScenes?: Set<string>}
export interface EstablishStepDeps {
  /** The campaign the run's kernel bridge is bound to. */
  campaign?: string;
  /** A kernel read on the run's campaign. */
  call: (method: string) => Promise<Row>;
  record: (row: Row) => void;
  stepId: string;
}

/** The step note's `establish` (`{head, place, why, owes, package}`), or undefined when nothing new is owed to this step. */
export async function establishStep(run: EstablishStepRun, deps: EstablishStepDeps): Promise<Row | undefined> {
  if (!deps.campaign || run.turn === undefined) return undefined;
  if (!run.scene || run.firstScene === undefined || run.scene === run.firstScene) return undefined;
  const asked = run.establishScenes ??= new Set<string>();
  if (asked.has(run.scene)) return undefined;
  asked.add(run.scene);
  let answer: Row;
  try { answer = await deps.call('table.establish.view'); }
  catch (error) {
    deps.record({lane: 'run', event: 'read_failed', method: 'table.establish.view', error: String((error as Error)?.message ?? error).slice(0, 200)});
    return undefined;
  }
  const item = object(answer.establish);
  if (!Object.keys(item).length) return undefined;
  deps.record({lane: 'run', event: 'establish', run: run.runId, step: deps.stepId, scene: run.scene, why: Array.isArray(item.why) ? item.why : []});
  return {head: typeof answer.head === 'string' ? answer.head : '', ...item};
}
