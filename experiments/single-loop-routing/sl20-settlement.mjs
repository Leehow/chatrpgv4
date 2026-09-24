/**
 * SL-20: what the run did after the clerk settled the player's declaration. Reads replay results written by `run.mjs
 * --llm replay` (each run's `run<N>.summary.json` and `run<N>.trace.jsonl`) and, per run, finds the settlement -- the
 * first clerk (policy-origin) write whose candidate a compile selected (`basis.compile`) and which succeeded (the kernel
 * took it; for a resolve, its check did not fail) -- then reports:
 *
 * - the first route question after it: every exit answer with its distribution, whether `continue` / `ask_llm` clears the
 *   gates on its own (§135.2's gates, `runtime/jev/decision-gate.ts`), whether any need was selected;
 * - what the rule of the ruling "Once the clerk has settled the player's declaration, the run leans to finish" would do
 *   there: `finish` unless a need was selected or `continue` / `ask_llm` clears;
 * - the Keeper steps after the settlement: each model step's purpose and reason, and the replayed Keeper's calls;
 * - the run's wall time, LLM steps and the budget summary.
 *
 *   node experiments/single-loop-routing/sl20-settlement.mjs <results dir> [<results dir> ...] [--json]
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const GATE = 0.6, MARGIN_MIN = 0.35, MARGIN_RATIO = 1.8;
const argv = process.argv.slice(2), json = argv.includes('--json'), dirs = argv.filter(value => value !== '--json');
const stepOf = value => Number(/:s(\d+)$/.exec(String(value ?? ''))?.[1] ?? NaN);
const lines = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

/** The gates of `decision-gate.ts`, over a recorded answer. */
function clears(answer) {
  if (!answer?.choice) return false;
  if (answer.confidence === null || answer.confidence === undefined || answer.confidence >= GATE) return true;
  const sorted = Object.entries(answer.probabilities ?? {}).sort((a, b) => b[1] - a[1]);
  if (sorted[0]?.[0] !== answer.choice) return false;
  const top = sorted[0][1], second = sorted[1]?.[1] ?? 0;
  return top >= MARGIN_MIN && top >= MARGIN_RATIO * second;
}

function analyse(dir, file) {
  const summary = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const trace = lines(join(dir, file.replace('.summary.json', '.trace.jsonl')));
  const policyRows = trace.filter(row => row.tool && row.origin === 'policy' && row.lane === undefined);
  const policyCalls = (summary.calls ?? []).filter(call => call.origin === 'policy');
  const writes = policyRows.map((row, index) => ({step: stepOf(row.step), at: Date.parse(row.started_at ?? ''), tool: row.tool, ok: row.ok !== false,
    passed: policyCalls[index]?.passed, obligation: policyCalls[index]?.obligation ?? null, compile: row.basis?.compile ?? null,
    candidate: row.basis?.row?.handle ?? row.basis?.row?.effect?.to ?? row.basis?.path ?? null}));
  const settled = writes.find(write => write.compile && write.ok && !(write.tool === 'resolve' && write.passed === false));
  const events = trace.filter(row => row.lane === 'event');
  const ends = new Map(events.filter(event => event.type === 'step_end').map(event => [event.stepId, event]));
  const infers = events.filter(event => event.type === 'step_start' && event.kind === 'infer')
    .map(event => ({step: stepOf(event.stepId), purpose: event.purpose, reason: ends.get(event.stepId)?.reason ?? null}));
  const routes = trace.filter(row => row.lane === 'route' && row.purpose === 'route').map(row => ({...row, n: stepOf(row.step)}));
  const out = {fixture: summary.fixture, run: summary.run, seed: summary.seed, wall_ms: summary.wall_ms, llm_steps: summary.llm_steps,
    llm_purposes: summary.llm_purposes, elapsed_at_compose: summary.budget?.elapsed_at_compose ?? null, over_budget: summary.budget?.over_budget ?? null,
    writes: writes.map(write => `s${write.step} ${write.tool}${write.ok ? '' : '!'}${write.passed === false ? '(failed)' : write.passed ? '(passed)' : ''}${write.compile ? ` [compile:${write.compile.predicate}]` : ''}`),
    settled: settled ? {step: settled.step, tool: settled.tool, predicate: settled.compile.predicate, candidate: settled.candidate,
      obligation: settled.obligation ? `${settled.obligation.handle}:${settled.obligation.settled ? 'settled' : 'open'}` : null} : null};
  if (!settled) return {...out, exit: null};
  const route = routes.find(row => row.n > settled.step);
  const exit = route?.answers?.exit ?? null;
  const own = exit && ['continue', 'ask_llm'].includes(exit.choice) && clears(exit);
  const selected = route?.selected ?? [];
  const rule = !route ? 'no_route' : selected.length ? 'selected' : own ? `keeper(${exit.choice})` : 'finish';
  const keeper = trace.filter(row => row.lane === 'replay' && typeof row.replay === 'string' && Date.parse(row.at) > settled.at)
    .map(row => `${row.replay}${row.calls ? `[${row.calls.join(',')}]` : ''}`);
  return {...out, route: route ? {step: route.n, reason: route.reason, exit: route.exit, selected} : null,
    exit_answer: exit ? {choice: exit.choice, confidence: exit.confidence, probabilities: exit.probabilities, cleared: clears(exit)} : null,
    rule, today: route ? route.reason : null,
    after: infers.filter(step => step.step > settled.step).map(step => `${step.purpose}:${step.reason}`), keeper};
}

const rows = [];
for (const dir of dirs) for (const file of readdirSync(dir).filter(name => /^run\d+\.summary\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0])))
  if (existsSync(join(dir, file.replace('.summary.json', '.trace.jsonl')))) rows.push({dir, ...analyse(dir, file)});
if (json) console.log(JSON.stringify(rows, null, 1));
else for (const row of rows) {
  const p = row.exit_answer?.probabilities ?? {};
  const dist = ['ask_llm', 'continue', 'finish', 'read_more'].map(key => `${key} ${p[key] ?? '-'}`).join(' / ');
  console.log([`${row.fixture} #${row.run} seed ${row.seed}`, `settled ${row.settled ? `s${row.settled.step} ${row.settled.tool} ${row.settled.predicate}${row.settled.obligation ? ` ${row.settled.obligation}` : ''}` : 'none'}`,
    row.exit_answer ? `exit ${row.exit_answer.choice} c=${row.exit_answer.confidence} (${dist}) cleared=${row.exit_answer.cleared}` : 'exit -',
    `route ${row.route ? `s${row.route.step} ${row.route.reason} sel=[${row.route.selected.join(',')}]` : '-'}`, `rule ${row.rule ?? '-'}`,
    `after [${(row.after ?? []).join(' ')}]`, `keeper [${(row.keeper ?? []).join(' ')}]`,
    `llm ${row.llm_steps} (${row.llm_purposes.join(',')})`, `wall ${(row.wall_ms / 1000).toFixed(1)} s`, `compose@${row.elapsed_at_compose ?? '-'}`].join(' | '));
}
