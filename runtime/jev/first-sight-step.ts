/**
 * Contract §168.5: the first sight owed where a run now stands, when it moved there after its capsule was read.
 *
 * The capsule the run began with carried the first sight of the scene it began in. On the installed App's Blood Road
 * table (2026-10-02, turn 1) the clerk moved the party from the prologue to the Esso station mid-run: the station's
 * description reached the Keeper only as a scene view, nothing said it was the player's first sight of it, the prose gave
 * none of what the book describes there, and no check ran after the delivery. Asked once per scene per run, read from
 * the kernel (`table.first_sight.view`), and handed over through the kernel extension's view, which leaves out items
 * whose check is still running and notes the rest for this turn's check.
 */
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

export interface FirstSightStepRun {runId: string; turn?: number; scene?: string; firstScene?: string; sightScenes?: Set<string>}
export interface FirstSightViewPort {campaign: string; view: (capsule: Row) => Row}
export interface FirstSightStepDeps {
  /** The campaign the run's kernel bridge is bound to. */
  campaign?: string;
  port?: FirstSightViewPort;
  /** A kernel read on the run's campaign. */
  call: (method: string) => Promise<Row>;
  record: (row: Row) => void;
  stepId: string;
}

/** The step note's `first_sight` (`{head, place?, people?}`), or undefined when nothing new is owed to this step. */
export async function firstSightStep(run: FirstSightStepRun, deps: FirstSightStepDeps): Promise<Row | undefined> {
  const {port} = deps;
  if (!port || !deps.campaign || port.campaign !== deps.campaign || run.turn === undefined) return undefined;
  if (!run.scene || run.firstScene === undefined || run.scene === run.firstScene) return undefined;
  const asked = run.sightScenes ??= new Set<string>();
  if (asked.has(run.scene)) return undefined;
  asked.add(run.scene);
  let answer: Row;
  try { answer = await deps.call('table.first_sight.view'); }
  catch (error) {
    deps.record({lane: 'run', event: 'read_failed', method: 'table.first_sight.view', error: String((error as Error)?.message ?? error).slice(0, 200)});
    return undefined;
  }
  const section = object(answer.first_sight);
  if (!Object.keys(section).length) return undefined;
  let kept: Row;
  try { kept = object(object(port.view({turn: {number: run.turn}, first_sight: section})).first_sight); }
  catch { kept = section; }
  deps.record({lane: 'run', event: 'first_sight', run: run.runId, step: deps.stepId, scene: run.scene,
    place: Object.hasOwn(kept, 'place'), people: Array.isArray(kept.people) ? kept.people.length : 0});
  if (!Object.keys(kept).length) return undefined;
  return {head: typeof answer.head === 'string' ? answer.head : '', ...kept};
}
