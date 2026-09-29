/**
 * Schema 2 subreview placement (contract §130.8), checked against the two artifacts a live reviewer
 * submitted on 2026-09-23 (installed build 67a281c3e, narration-audit 1.2.30). No model calls.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import auditSubmit from '../../extensions/mods/audit-submit.ts';
import {AUDIT_SUBREVIEWS, AUDIT_SUBREVIEW_PLACEMENT, auditArtifactIssues, buildAuditReferences, materializeAuditReferences, placeAuditSubreviews,
    auditReferenceIssues} from '../../kernel-ts/mods/audit-references.ts';
import {continuityArtifactErrors, normalizeContinuityArtifact} from '../../kernel-ts/mods/audit-result.ts';

const fixture = name => new URL(`./fixtures/audit-subreview-placement/${name}`, import.meta.url);
const load = async name => JSON.parse(await readFile(fixture(name), 'utf8'));
const retained = async () => {
    const request = await load('request.json'), files = {'context.json': await load('context.json')};
    return {request, files, catalog: buildAuditReferences(request, files)};
};
const MOVED = ['intelligibility_review', 'player_address_review', 'speech_review', 'locus_review'];
// What the shared semantic validator says about the report once its shape is accepted: the two
// errors the retained nested resubmission hit, which the placement refusal had hidden from the repair.
const RETAINED_SEMANTIC = ['/continuity_review/locus_review/locus_source', '/continuity_review/verdict'];

function semanticPaths(value, request, files, catalog) {
    const normalized = normalizeContinuityArtifact(value, files, catalog.speechTexts);
    return auditReferenceIssues(continuityArtifactErrors(normalized, request.input.text, files, catalog.speechTexts)).map(issue => issue.path).sort();
}

async function submitTool(request, files, control = {max_requests: 6, max_artifact_repairs: 1, status_file: 'status.json'}) {
    const cwd = await mkdtemp(join(tmpdir(), 'audit-placement-'));
    // The retained request names nine evidence files; the review reads only the focused context here.
    await writeFile(join(cwd, 'request.json'), JSON.stringify({...request, continuity_review: {...request.continuity_review, files: ['context.json']}}));
    await writeFile(join(cwd, 'context.json'), JSON.stringify(files['context.json']));
    await writeFile(join(cwd, 'control.json'), JSON.stringify(control));
    const tools = new Map(), priorCwd = process.cwd(), priorControl = process.env.PI_COC_AUDIT_CONTROL;
    try {
        process.chdir(cwd);
        process.env.PI_COC_AUDIT_CONTROL = join(cwd, 'control.json');
        auditSubmit({on() {}, registerTool(definition) { tools.set(definition.name, definition); }, sendMessage() {}});
    } finally {
        process.chdir(priorCwd);
        if (priorControl === undefined) delete process.env.PI_COC_AUDIT_CONTROL;
        else process.env.PI_COC_AUDIT_CONTROL = priorControl;
    }
    return {cwd, submit: tools.get('submit_audit')};
}

test('the retained top-level submission is moved into continuity_review, not refused', async () => {
    const {request, files, catalog} = await retained(), submitted = await load('submitted-top-level.json');
    for (const key of MOVED) assert.ok(Object.hasOwn(submitted, key), `the fixture carries ${key} at the top level`);
    const placed = placeAuditSubreviews(submitted);
    assert.deepEqual(placed.errors, []);
    assert.deepEqual(Object.keys(placed.value).sort(), ['continuity_review', 'findings', 'missing', 'schema']);
    for (const key of MOVED) assert.deepEqual(placed.value.continuity_review[key], submitted[key]);
    const result = materializeAuditReferences(submitted, catalog);
    assert.deepEqual(result.errors, []);
    assert.equal(result.value.continuity_review.speech_review.lines.length, 5);
    assert.equal(result.value.continuity_review.locus_review.locus, "Knott's Office");
    assert.deepEqual(semanticPaths(result.value, request, files, catalog), RETAINED_SEMANTIC);
});

test('the retained nested submission validates its placement and keeps the same semantic errors', async () => {
    const {request, files, catalog} = await retained(), submitted = await load('submitted-nested.json');
    assert.deepEqual(Object.keys(submitted).sort(), ['continuity_review', 'findings', 'missing', 'schema']);
    assert.equal(placeAuditSubreviews(submitted).value, submitted, 'a correctly placed report is returned untouched');
    const result = materializeAuditReferences(submitted, catalog);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(semanticPaths(result.value, request, files, catalog), RETAINED_SEMANTIC);
});

test('submit_audit spends the one repair on the real errors, and the repaired report is accepted', async () => {
    const {request, files} = await retained(), submitted = await load('submitted-top-level.json');
    const {cwd, submit} = await submitTool(request, files);
    const first = await submit.execute('first', {result: submitted});
    assert.equal(first.isError, true);
    assert.deepEqual(first.details.errors.map(issue => issue.path).sort(), RETAINED_SEMANTIC);
    assert.ok(first.details.errors.every(issue => !/^\/(intelligibility|player_address|speech|locus)_review/.test(issue.path)));
    const repaired = structuredClone(submitted);
    repaired.locus_review.locus_source = null;
    repaired.continuity_review.verdict = 'revise';
    const second = await submit.execute('repair', {result: repaired});
    assert.equal(second.terminate, true);
    assert.equal(second.details.kind, 'audit_submission');
    assert.deepEqual(JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8')), repaired, 'the raw submission is retained as submitted');
});

test('a duplicate equal to the nested one is dropped; a differing one names the only place it may live', async () => {
    const {catalog} = await retained(), nested = await load('submitted-nested.json');
    const equal = {...structuredClone(nested), speech_review: structuredClone(nested.continuity_review.speech_review)};
    assert.deepEqual(placeAuditSubreviews(equal).value, nested);
    assert.deepEqual(materializeAuditReferences(equal, catalog).errors, []);
    const differing = {...structuredClone(nested), speech_review: structuredClone(nested.continuity_review.speech_review)};
    differing.speech_review.lines[0].reason = 'A different judgment.';
    const refused = materializeAuditReferences(differing, catalog);
    assert.equal(refused.value, undefined);
    const issue = refused.errors.find(error => error.path === '/speech_review');
    assert.ok(issue);
    assert.ok(issue.message.includes('/continuity_review/speech_review'));
});

test('copied v1 fields stay refused and every refusal names the path it expects', async () => {
    const {catalog} = await retained(), nested = await load('submitted-nested.json');
    for (const place of ['nested', 'top-level']) {
        const value = structuredClone(nested), review = {verdict: 'pass', quote: null};
        if (place === 'nested') value.continuity_review.intelligibility_review = review;
        else { delete value.continuity_review.intelligibility_review; value.intelligibility_review = review; }
        const refused = materializeAuditReferences(value, catalog);
        assert.equal(refused.value, undefined, place);
        const quote = refused.errors.find(error => error.path === '/continuity_review/intelligibility_review/quote');
        assert.ok(quote, place);
        assert.ok(quote.message.includes('/continuity_review/intelligibility_review/source'), place);
    }
    const conflict = structuredClone(nested);
    conflict.continuity_review.conflicts = [{claim: 'Copied prose.', reason: 'Conflicts.', evidence_sources: []}];
    const claim = materializeAuditReferences(conflict, catalog).errors.find(error => error.path === '/continuity_review/conflicts/0/claim');
    assert.ok(claim.message.includes('/continuity_review/conflicts/0/claim_source'));
    const stray = {...structuredClone(nested), verdict: 'pass'};
    const top = materializeAuditReferences(stray, catalog).errors.find(error => error.path === '/verdict');
    assert.ok(['schema', 'missing', 'findings', 'continuity_review'].every(key => top.message.includes(key)));
    const deep = structuredClone(nested);
    deep.continuity_review.speech_review.locus_review = deep.continuity_review.locus_review;
    const misplaced = materializeAuditReferences(deep, catalog).errors.find(error => error.path === '/continuity_review/speech_review/locus_review');
    assert.ok(misplaced.message.includes('/continuity_review/locus_review'));
});

test('the prompt, the tool description and the package state one placement sentence', async () => {
    for (const key of AUDIT_SUBREVIEWS) assert.ok(AUDIT_SUBREVIEW_PLACEMENT.includes(key));
    const {request, files} = await retained(), {submit} = await submitTool(request, files);
    assert.ok(submit.parameters.properties.result.description.includes(AUDIT_SUBREVIEW_PLACEMENT));
    const host = await readFile(new URL('../../extensions/mods/index.ts', import.meta.url), 'utf8');
    const schema2 = host.slice(host.indexOf('job.continuity_schema === 2 ?'), host.indexOf('JSON.stringify({candidate: input.text, context: job.focus}) :'));
    assert.ok(schema2.includes('${AUDIT_SUBREVIEW_PLACEMENT}'), 'the schema 2 brief interpolates the shared sentence');
    const auditor = await readFile(new URL('../../mods/narration-audit/auditor.md', import.meta.url), 'utf8');
    assert.ok(auditor.includes(AUDIT_SUBREVIEW_PLACEMENT), 'a changed sentence needs a re-issued narration-audit package');
});

// §130.9: the retained first submission, plus one leftover v1 field and one differing duplicate.
async function everyFaultAtOnce() {
    const submitted = await load('submitted-top-level.json');
    submitted.intelligibility_review.quote = null;
    submitted.continuity_review.speech_review = structuredClone(submitted.speech_review);
    submitted.continuity_review.speech_review.lines[0].reason = 'A different judgment.';
    return submitted;
}
const EVERY_FAULT = ['/continuity_review/intelligibility_review/quote', '/continuity_review/locus_review/locus_source',
    '/continuity_review/verdict', '/speech_review'];

test('one refusal carries placement, shape and content errors ordered by path; the repair is accepted next', async () => {
    const {request, files} = await retained(), {cwd, submit} = await submitTool(request, files);
    const first = await submit.execute('first', {result: await everyFaultAtOnce()});
    assert.equal(first.isError, true);
    assert.deepEqual(first.details.errors.map(issue => issue.path), EVERY_FAULT, 'every fault, in path order, in the first response');
    assert.equal(JSON.parse(first.content[0].text).errors.length, EVERY_FAULT.length);
    const repaired = await load('submitted-top-level.json');
    repaired.locus_review.locus_source = null;
    repaired.continuity_review.verdict = 'revise';
    const second = await submit.execute('repair', {result: repaired});
    assert.equal(second.details.kind, 'audit_submission');
    assert.equal(JSON.parse(await readFile(join(cwd, 'status.json'), 'utf8')).artifact_repairs, 1);
});

test('a failed selector is reported once, not again as the content rule it breaks', async () => {
    const {request, files, catalog} = await retained(), submitted = await load('submitted-top-level.json');
    submitted.locus_review.locus_source = null;
    submitted.continuity_review.verdict = 'revise';
    submitted.continuity_review.conflicts = [{claim_source: 'input:0', reason: 'Contradicts the record.', evidence_sources: ['context:0']}];
    assert.deepEqual(auditArtifactIssues(submitted, request, files, catalog).errors.map(issue => issue.path),
        ['/continuity_review/conflicts/0/claim_source']);
});

test('an exhausted repair keeps the last error list on the status and in the unavailable cause', async () => {
    const {request, files} = await retained(), {cwd, submit} = await submitTool(request, files);
    const bad = await everyFaultAtOnce();
    assert.equal((await submit.execute('first', {result: bad})).details.kind, 'audit_artifact_error');
    const last = await submit.execute('second', {result: bad});
    assert.equal(last.details.kind, 'audit_unavailable');
    assert.equal(last.terminate, true);
    const status = JSON.parse(await readFile(join(cwd, 'status.json'), 'utf8'));
    assert.deepEqual(status.errors.map(issue => issue.path), EVERY_FAULT);
    for (const path of EVERY_FAULT) assert.ok(status.unavailable.includes(path), `the cause names ${path}`);
    assert.equal(last.details.unavailable, status.unavailable);
});

// §130.10 (2026-09-29): retained rejections from table pl-v-0929 (fast model opencode-go/deepseek-v4.1-flash,
// thinking off), copied from `.coc/mods/jobs/<job>/`: the job's request.json and context.json unchanged, and
// the rejected artifact as submitted.json. As in the fixtures above, the review reads only the focused context.
const dropFixture = async name => {
    const at = file => new URL(`./fixtures/audit-drop-inapplicable/${name}/${file}`, import.meta.url);
    const read = async file => JSON.parse(await readFile(at(file), 'utf8'));
    const request = await read('request.json'), files = {'context.json': await read('context.json')};
    return {request, files, submitted: await read('submitted.json')};
};
const DROP_CASES = {
    // Every error the job ended with was an extra sub-review: outcome, location and reentry.
    '4724a1f7-extras-only': ['outcome_review', 'location_review', 'reentry_review'],
    // Extra sub-reviews carrying their own nested faults (an empty speech_review, a copied field in location_review).
    '7a3b8ff4-extras-with-nested-errors': ['speech_review', 'outcome_review', 'location_review', 'reentry_review'],
    // outcome_commitments requires outcome_review here: it is kept and validated; only location and reentry go.
    'bbe8e88a-required-outcome-kept': ['location_review', 'reentry_review'],
};

for (const [name, dropped] of Object.entries(DROP_CASES)) test(`retained ${name}: unrequested sub-reviews are dropped and the review is accepted`, async () => {
    const {request, files, submitted} = await dropFixture(name), before = structuredClone(submitted);
    const {cwd, submit} = await submitTool(request, files);
    const outcome = await submit.execute('first', {result: submitted});
    assert.equal(outcome.details.kind, 'audit_submission', JSON.stringify(outcome.details.errors ?? outcome.content));
    assert.deepEqual(submitted, before, 'the submission object is not mutated');
    const written = JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8'));
    assert.deepEqual(written.continuity_review, Object.fromEntries(Object.entries(before.continuity_review).filter(([key]) => !dropped.includes(key))),
        'result.json is the dropped version and nothing else changed');
    const status = JSON.parse(await readFile(join(cwd, 'status.json'), 'utf8'));
    assert.deepEqual([...status.dropped_subreviews].sort(), [...dropped].sort());
    assert.equal(status.artifact_repairs, 0);
});

test('retained bbe8e88a: the kept, required outcome_review is still validated', async () => {
    const {request, files, submitted} = await dropFixture('bbe8e88a-required-outcome-kept');
    const missingSelector = structuredClone(submitted); delete missingSelector.continuity_review.outcome_review.claim_sources;
    const {submit} = await submitTool(request, files);
    const refused = await submit.execute('first', {result: missingSelector});
    assert.equal(refused.details.kind, 'audit_artifact_error');
    assert.deepEqual(refused.details.errors.map(issue => issue.path).filter(path => path.includes('outcome_review')),
        ['/continuity_review/outcome_review/claim_sources', '/continuity_review/outcome_review/claim_sources']);
    const absent = structuredClone(submitted); delete absent.continuity_review.outcome_review;
    const required = await (await submitTool(request, files)).submit.execute('first', {result: absent});
    assert.ok(required.details.errors.some(issue => issue.path === '/continuity_review/outcome_review'), 'a missing required sub-review is still an error');
});

test('retained 1a356283: the drop does not hide a real content error in the rest of the review', async () => {
    const {request, files, submitted} = await dropFixture('1a356283-content-error-remains');
    const {cwd, submit} = await submitTool(request, files);
    const refused = await submit.execute('first', {result: submitted});
    assert.equal(refused.details.kind, 'audit_artifact_error');
    assert.deepEqual(refused.details.errors.map(issue => issue.path), ['/continuity_review/verdict'], 'a pass beside two missing objects');
    assert.deepEqual(JSON.parse(await readFile(join(cwd, 'status.json'), 'utf8')).dropped_subreviews.sort(), ['location_review', 'outcome_review']);
});

test('retained 4724a1f7: a dropped revise never escalates the aggregate verdict', async () => {
    const {request, files, submitted} = await dropFixture('4724a1f7-extras-only');
    submitted.continuity_review.outcome_review = {verdict: 'revise', basis: 'unsupported_positive_result', claim_sources: ['draft:0']};
    const {cwd, submit} = await submitTool(request, files);
    assert.equal((await submit.execute('first', {result: submitted})).details.kind, 'audit_submission');
    const written = JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8'));
    assert.equal(written.continuity_review.verdict, 'pass');
    assert.equal(Object.hasOwn(written.continuity_review, 'outcome_review'), false);
});
