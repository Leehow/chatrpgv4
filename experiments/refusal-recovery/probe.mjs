#!/usr/bin/env node
// Contract §197 (refusal recovery), live reviewer probe: the product's admission lane on the refusals TR-F2 run 2 and real
// table run 3 got wrong, with the system prompt before §197 (`--old`, a module exporting `admissionSystemPrompt`) and after
// it (extensions/kernel/admission.ts), on the same reviewer input. The input is built by the product's own
// `admissionRequest`, `lineProposal` and `buildAdmissionInput` from a case file (`--cases`) that a builder writes from the
// tables' evidence (turn records, session tool calls, the registered destinations the admission rows printed); the case
// file stays outside the repository because it carries the tables' prose.
//
// The judgement is the model's; this measures what it answers. Output is sanitized by construction: id, prompt, run,
// player_words, verdict, open_choice, recovery, ms, or the failure reason -- no grounds or missing (they quote the player).
//
//   node experiments/refusal-recovery/probe.mjs --cases <cases.json> --auth <auth.json> --models-store <models-store.json>
//     --old <old-admission-module.ts> --out <out.jsonl> [--model openai-codex/gpt-6-luna] [--thinking off] [--runs 3]
//     [--concurrency 4] [--cap 60000] [--only <id,id>] [--debug <file outside the repository>]
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '../..');
const argv = process.argv.slice(2), arg = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const casesPath = arg('--cases'), authPath = arg('--auth'), storePath = arg('--models-store'), oldPath = arg('--old'), outPath = arg('--out');
const model = arg('--model', 'openai-codex/gpt-6-luna'), thinking = arg('--thinking', 'off');
const runs = Number(arg('--runs', '3')), concurrency = Number(arg('--concurrency', '4')), cap = Number(arg('--cap', '60000'));
const only = arg('--only') ? new Set(arg('--only').split(',')) : undefined, debugPath = arg('--debug');
if (!casesPath || !outPath || !argv.includes('--dry') && (!authPath || !storePath)) throw new Error('--cases and --out are required, and --auth and --models-store unless --dry');

const { ModelRuntime, ModelRegistry } = await import(`${ROOT}/build/node_modules/@earendil-works/pi-coding-agent/dist/index.js`);
const admission = await import(`${ROOT}/extensions/kernel/admission.ts`);
const { runLane } = await import(`${ROOT}/extensions/lanes/subsession.ts`);
const prompts = { new: admission.admissionSystemPrompt() };
if (oldPath) prompts.old = (await import(pathToFileURL(oldPath).href)).admissionSystemPrompt();

process.env.PI_COC_ADMISSION_MODEL = model;
process.env.PI_COC_ADMISSION_MODEL_THINKING = thinking;

const cases = JSON.parse(readFileSync(casesPath, 'utf8')).filter((value) => !only || only.has(value.id));
const jobs = [];
for (const value of cases) for (const prompt of Object.keys(prompts)) for (let run = 1; run <= runs; run++) jobs.push({ value, prompt, run });
writeFileSync(outPath, '');
process.stderr.write(`${cases.length} cases x ${Object.keys(prompts).length} prompts x ${runs} runs = ${jobs.length} calls, model=${model} thinking=${thinking}\n`);

function inputOf(value) {
	const effects = value.effects;
	const targets = new Set(effects.filter((effect) => effect.kind === 'move').map((effect) => effect.to));
	const scope = { party: value.context.investigators.map((row) => row.name), scene: { label: value.context.scene },
		destinations: value.destinations ? Object.values(value.destinations).filter((row) => targets.has(row.requested)) : [] };
	const proposal = admission.admissionRequest('apply', { effects }, scope);
	const line = proposal.lines.length > 1 ? admission.lineProposal(proposal, value.line) : proposal;
	return { line: line.lines[0], input: admission.buildAdmissionInput(line, value.context) };
}

if (argv.includes('--dry')) { for (const value of cases) { const { line } = inputOf(value); process.stdout.write(`${value.id}: ${line.slice(0, 160)}\n`); } process.exit(0); }
// Read the credentials the product's way (the lane runner resolves the model through the registry); nothing is printed.
const runtime = await ModelRuntime.create({ authPath, modelsPath: null, modelsStorePath: storePath, refreshOnCreate: false });
const registry = new ModelRegistry(runtime);
let next = 0;
async function worker() {
	while (next < jobs.length) {
		const { value, prompt, run } = jobs[next++];
		const { input } = inputOf(value);
		const ctx = { cwd: ROOT, model: undefined, modelRegistry: registry, sessionManager: { getSessionId: () => `refusal-recovery-probe-${value.id}-${prompt}-${run}` } };
		const began = Date.now();
		const lane = await runLane({ ctx, envName: 'PI_COC_ADMISSION_MODEL', lane: 'admission', systemPrompt: prompts[prompt], input, timeoutMs: cap, shape: admission.shapeVerdict });
		const row = { id: value.id, expect: value.expect, prompt, run, ms: Date.now() - began,
			...(lane.ok ? { verdict: lane.value.verdict, ...(lane.value.open_choice ? { open_choice: lane.value.open_choice } : {}), ...(lane.value.player_words ? { player_words: lane.value.player_words } : {}), ...(lane.value.recovery ? { recovery: lane.value.recovery } : {}) }
				: { failed: lane.reason }) };
		appendFileSync(outPath, `${JSON.stringify(row)}\n`);
		// `--debug <file>`: the reviewer's own words, for diagnosis only; keep that file outside the repository.
		if (debugPath) appendFileSync(debugPath, `${JSON.stringify({ id: value.id, prompt, run, ...(lane.ok ? { grounds: lane.value.grounds, missing: lane.value.missing } : { detail: lane.detail }) })}\n`);
		process.stderr.write(`${row.id} ${prompt} ${run}: ${row.verdict ?? row.failed}${row.open_choice ? ` (${row.open_choice})` : ''} ${row.ms} ms\n`);
	}
}
await Promise.all(Array.from({ length: concurrency }, worker));
