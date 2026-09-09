/** One validated setup table, including its module-source and investigator-source axes. */
import type { KernelContext } from '../context.js';
import { join } from 'node:path';
import { array, row, string, truth, repr, sorted, type Row } from '../read/values.js';
export class SetupSteps {
  readonly steps: Row[];
  readonly byId: Map<string, Row>;
  constructor(readonly path: string, readonly raw: Row) {
    const fail = (message: string): never => { const error = new Error(message); error.name = 'ValueError'; throw error; };
    if (raw.contract !== 'coc.setup-steps.v1') fail(`${path} is not a coc.setup-steps.v1 table`);
    this.steps = [...raw.steps]; this.byId = new Map(this.steps.map(step => [string(step.id), step]));
    const sources = new Set<string>(array(raw.sources)), investigators = new Set<string>(array(raw.investigator_sources));
    if (this.byId.size !== this.steps.length) fail('setup steps: duplicate step id');
    for (const step of this.steps) {
      if (!['ask', 'op'].includes(step.kind)) fail(`setup step ${step.id}: kind must be one of ['ask', 'op']`);
      if (step.kind === 'op' && typeof step.op !== 'string') fail(`setup step ${step.id}: op steps name their kernel method`);
      if (step.only_for != null && !sources.has(step.only_for)) fail(`setup step ${step.id}: only_for must be one of ${repr(sorted(sources))}`);
      if (step.investigator_source != null && !investigators.has(step.investigator_source)) fail(`setup step ${step.id}: investigator_source must be one of ${repr(sorted(investigators))}`);
      for (const need of array(step.needs)) if (!this.byId.has(need)) fail(`setup step ${step.id} needs unknown step ${repr(need)}`);
    }
    const visiting = new Set<string>(), done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      if (visiting.has(id)) fail(`setup steps: cycle through ${id}`);
      visiting.add(id); for (const need of array(this.byId.get(id)!.needs)) visit(need); visiting.delete(id); done.add(id);
    };
    for (const id of this.byId.keys()) visit(id);
    if (!this.byId.has(raw.start)) fail('setup steps: start must name a step');
  }
  static async create(context: KernelContext): Promise<SetupSteps> {
    const path = join(context.content, 'setup', 'steps.json'); return new SetupSteps(path, row(await context.snapshots.readJson(path)));
  }
  step(id: string): Row { return this.byId.get(id)!; }
  applies(id: string, source: string | Iterable<string>): boolean {
    const kinds = new Set(typeof source === 'string' ? [source] : source), step = this.step(id);
    if (step.only_for != null && !kinds.has(step.only_for)) return false;
    if (Array.isArray(step.applies_to) && step.applies_to.length && !step.applies_to.some((kind: string) => kinds.has(kind))) return false;
    return step.investigator_source == null || kinds.has(step.investigator_source);
  }
  order(source: string | Iterable<string>): string[] { return this.steps.filter(step => this.applies(step.id, source)).map(step => step.id); }
  launchLine(campaign: string): string { return string(this.raw.launch_line).replaceAll('{campaign}', campaign); }
  nextLine(id: string): string { const next = row(this.step(id).lines).next; return string(truth(next) ? next : id); }
}
