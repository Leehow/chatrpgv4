#!/usr/bin/env node
/**
 * FR-01 / FR-05 of docs/specs/forward-only-reconciliation-tickets.md (contract §158.2): replay a retained post-delivery
 * continuity review through the live reviewer, as a job that asks for owed state, and read what it names.
 *
 * The retained job is the installed App's turn 26 of Dust to Dust (default below): the delivery told the player
 * 「车停在栏外。波街公墓就在眼前」 and landed no move. That review ran narration-audit 1.2.31, which had no `owed`.
 * Here the same job directory is copied and made the job a 1.2.32 package would have pinned:
 *
 * - `context.json` gains `owed_review` (the kernel's own definition sentence, nothing open, the rules' bands);
 * - `request.json` gains `continuity_review.owed` and the sources the host would issue (`buildAuditReferences`, now with
 *   the `person` family);
 * - `prompt.md` is the retained one with the 1.2.31 `auditor.md` replaced in place by the shipped one;
 * - the brief is the product's (`continuityBrief`), and the child is launched by the product's `runReader`, with the
 *   reviewer lane's model on the App (`opencode-go/deepseek-v4.1-flash`, recorded on the turn's telemetry row).
 *
 * Every run's submission is re-checked with the kernel's validator (`auditArtifactIssues`). Outcomes are fixed before any
 * run (tests/play README: pre-register): PASS = checked, with an owed move to 勘查波街公墓 (the scene `locus_review`
 * selected) or a place naming 波街公墓, quoting an arrival sentence; WRONG_PLACE = checked, owed move elsewhere;
 * NO_MOVE = checked, no owed move; UNAVAILABLE = no checked submission.
 *
 * Live model calls, Mac only. Credentials: the source-mode agent home (`.pi/coc-agent`), never printed.
 *
 * Usage: node tests/play/owed-review-probe.mjs [--job <retained job dir>] [--runs 3] [--model provider/id] [--out <dir>]
 */
import {chmod, copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildAuditReferences, auditArtifactIssues} from '../../kernel-ts/mods/audit-references.ts';
import {continuityBrief} from '../../extensions/mods/index.ts';
import {runReader} from '../../extensions/module/reader.ts';
import {composeRuntimeContext} from '../../runtime/host.ts';
import {ROUTE_TRAVEL_ROWS} from '../../kernel-ts/modules/route-travel.ts';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

const REPO = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2), arg = (name, fallback) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : fallback; };
const JOB = arg('job', join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/.coc/mods/jobs/f7a10203af2b5a4f8ad7e2f7f5ab66cea0c4fb7edd10de9e0bda9a4196591ea9'));
const RUNS = Number(arg('runs', '3')), MODEL = arg('model', 'opencode-go/deepseek-v4.1-flash');
const OUT = resolve(arg('out', join(REPO, '.coc/playtests', `owed-review-probe-${new Date().toISOString().replace(/[:.]/g, '-')}`)));
const EVIDENCE = ['context.json', 'original.json', 'effective.json', 'world.json', 'current.json', 'history.json', 'handouts.json', 'notes.json', 'memory.json'];
const TARGET = '勘查波街公墓';

/** The kernel's definition sentence, bundled because kernel modules import by their emitted `.js` names. */
async function kernelDefinition() {
    const dir = join(OUT, '.bundle');
    await mkdir(dir, {recursive: true});
    await build({stdin: {contents: "export {OWED_REVIEW_DEFINITION} from './kernel-ts/mods/continuity-audit.ts';", resolveDir: REPO, sourcefile: 'probe.ts'},
        outfile: join(dir, 'kernel.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent'});
    return (await import(pathToFileURL(join(dir, 'kernel.mjs')).href)).OWED_REVIEW_DEFINITION;
}
/** The closed bands of §158.2, read from the shipped rules as the kernel's `owedBands` reads them. */
function bands() {
    const table = JSON.parse(readFileSync(join(REPO, 'content/rulesets/coc7/rules-json/time-costs.json'), 'utf8'));
    const rows = Object.keys(table.categories);
    return {travel_bands: ['adjacent', ...ROUTE_TRAVEL_ROWS.filter(row => rows.includes(row))], time_bands: rows.filter(row => !ROUTE_TRAVEL_ROWS.includes(row))};
}

async function prepare(run, definition) {
    const dir = join(OUT, `run-${run}`, 'job');
    await mkdir(dir, {recursive: true});
    const files = {};
    for (const name of EVIDENCE) {
        const value = JSON.parse(await readFile(join(JOB, name), 'utf8'));
        if (name === 'context.json') value.owed_review = {requires_review: true, definition, open: [], ...bands()};
        files[name] = value;
        await writeFile(join(dir, name), JSON.stringify(value));
        await chmod(join(dir, name), 0o400);
    }
    const retained = JSON.parse(await readFile(join(JOB, 'request.json'), 'utf8'));
    const request = {...retained, continuity_review: {...retained.continuity_review, owed: true}};
    delete request.continuity_review.sources;
    request.continuity_review.sources = buildAuditReferences(request, files).sources;
    await writeFile(join(dir, 'request.json'), JSON.stringify(request));
    // The retained prompt with the 1.2.31 package text swapped for the shipped one; the other contributors are untouched.
    const prompt = await readFile(join(JOB, 'prompt.md'), 'utf8');
    const old = execFileSync('git', ['show', 'abde51d98:mods/narration-audit/auditor.md'], {cwd: REPO, encoding: 'utf8'});
    const shipped = await readFile(join(REPO, 'mods/narration-audit/auditor.md'), 'utf8');
    // Contributors are joined in package order, so the 1.2.31 text sits wherever narration-audit came; it is replaced in place.
    const at = prompt.indexOf(old);
    if (at < 0 || prompt.indexOf(old, at + 1) >= 0) throw new Error('the retained prompt does not hold the 1.2.31 auditor text exactly once');
    await writeFile(join(dir, 'prompt.md'), prompt.slice(0, at) + shipped + prompt.slice(at + old.length));
    const control = 'audit-control-1.json';
    await writeFile(join(dir, control), JSON.stringify({max_requests: 6, max_artifact_repairs: 1, status_file: 'audit-status-1.json'}));
    return {dir, files, request, control};
}

const classify = (checked) => {
    if (!checked) return 'UNAVAILABLE';
    const move = (checked.owed ?? []).find(entry => entry.kind === 'move');
    if (!move) return 'NO_MOVE';
    return move.to === TARGET || (typeof move.place === 'string' && move.place.includes('波街公墓')) ? 'PASS' : 'WRONG_PLACE';
};

async function main() {
    await mkdir(OUT, {recursive: true});
    await writeFile(join(OUT, 'preregistered.md'), `# Pre-registered outcomes\n\nPASS: checked, owed move to ${TARGET} or a place naming 波街公墓, quoting an arrival sentence.\nWRONG_PLACE: checked, owed move elsewhere.\nNO_MOVE: checked, no owed move.\nUNAVAILABLE: no checked submission.\n`);
    const definition = await kernelDefinition(), home = join(OUT, 'home');
    await mkdir(home, {recursive: true});
    const context = composeRuntimeContext({owner: 'preparation', home}, {resourceRoot: REPO, env: {...process.env, PI_COC_HOME: home}});
    const rows = [];
    for (let run = 1; run <= RUNS; run++) {
        const {dir, files, request, control} = await prepare(run, definition);
        const job = {continuity_schema: 2, continuity_owed: true, focus: {...files['context.json'], sources: request.continuity_review.sources}};
        const began = Date.now();
        const outcome = await runReader({cwd: dir, brief: continuityBrief(job, {max_requests: 6}, {text: request.input.text}), model: MODEL, pinnedModel: true,
            systemPrompt: join(dir, 'prompt.md'), tools: 'read,write,edit,bash', audit: {control}, timeoutMs: 15 * 60_000, afterDelivery: true,
            eventLog: join(dir, 'audit-agent-1.jsonl')}, context).catch(error => ({error: String(error)}));
        const status = existsSync(join(dir, 'audit-status-1.json')) ? JSON.parse(await readFile(join(dir, 'audit-status-1.json'), 'utf8')) : {};
        let checked, errors = [];
        if (status.submitted && existsSync(join(dir, 'result.json'))) {
            const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
            ({checked, errors} = auditArtifactIssues(result, request, files, buildAuditReferences(request, files)));
        }
        const row = {run, ms: Date.now() - began, verdict: classify(checked), submitted: !!status.submitted, requests: status.requests ?? null,
            artifact_repairs: status.artifact_repairs ?? null, unavailable: status.unavailable || null, errors: errors.slice(0, 8),
            owed: checked?.owed ?? null, locus_review: checked?.continuity_review?.locus_review ?? null, findings: checked?.findings?.map(finding => finding.reason) ?? null,
            outcome: {code: outcome?.code ?? null, error: outcome?.error ?? null, timedOut: outcome?.timedOut ?? null}};
        rows.push(row);
        await writeFile(join(OUT, `run-${run}`, 'row.json'), JSON.stringify(row, null, 1));
        console.log(JSON.stringify({run, verdict: row.verdict, ms: row.ms, requests: row.requests, owed: row.owed}));
    }
    const counts = rows.reduce((all, row) => ({...all, [row.verdict]: (all[row.verdict] ?? 0) + 1}), {});
    await writeFile(join(OUT, 'summary.json'), JSON.stringify({job: JOB, model: MODEL, runs: RUNS, counts, rows}, null, 1));
    console.log(JSON.stringify({out: OUT, counts}));
}
await main();
