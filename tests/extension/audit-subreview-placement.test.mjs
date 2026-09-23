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
import {AUDIT_SUBREVIEWS, AUDIT_SUBREVIEW_PLACEMENT, buildAuditReferences, materializeAuditReferences, placeAuditSubreviews,
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
    const normalized = normalizeContinuityArtifact(value, files);
    return auditReferenceIssues(continuityArtifactErrors(normalized, request.input.text, files, catalog.speechTexts)).map(issue => issue.path).sort();
}

async function submitTool(request, files) {
    const cwd = await mkdtemp(join(tmpdir(), 'audit-placement-'));
    // The retained request names nine evidence files; the review reads only the focused context here.
    await writeFile(join(cwd, 'request.json'), JSON.stringify({...request, continuity_review: {...request.continuity_review, files: ['context.json']}}));
    await writeFile(join(cwd, 'context.json'), JSON.stringify(files['context.json']));
    await writeFile(join(cwd, 'control.json'), JSON.stringify({max_requests: 6, max_artifact_repairs: 1, status_file: 'status.json'}));
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
