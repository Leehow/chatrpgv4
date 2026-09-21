/** Host selector submission and targeted views; no model calls or simulated gameplay. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import auditSubmit from '../../extensions/mods/audit-submit.ts';
import {auditEvidenceView} from '../../extensions/mods/audit-evidence.ts';
import {buildAuditReferences} from '../../kernel-ts/mods/audit-references.ts';

test('schema 2 focused evidence joins aliases by retained structural path', () => {
    const files = {'memory.json': [
        {subject: 'Door', statement: 'It remains shut.'},
        {subject: 'Door', statement: 'It remains shut.'}
    ]};
    const v1 = auditEvidenceView('memory', files, ['Door']);
    assert.equal(v1.entries[0].sources, undefined);
    const v2 = auditEvidenceView('memory', files, ['Door'], [], 2);
    assert.equal(v2.entries.length, 2);
    assert.equal(v2.entries[0].sources.find(source => source.text === 'It remains shut.').file, 'memory.json');
    assert.notEqual(
        v2.entries[0].sources.find(source => source.text === 'It remains shut.').alias,
        v2.entries[1].sources.find(source => source.text === 'It remains shut.').alias,
        'equal text at separate structural paths keeps separate host-issued aliases'
    );
    assert.ok(v2.entries.every(entry => entry.sources.every(source => Object.keys(source).sort().join(',') === 'alias,file,text')));
    assert.ok(!JSON.stringify(v2).includes('"path"'));
    assert.ok(!JSON.stringify(v2).includes('"start"'));
    assert.ok(!JSON.stringify(v2).includes('"end"'));
    assert.match(v2.note, /Select sources\[\]\.alias/);
});

test('each focused evidence family exposes aliases from its own pinned subtree', () => {
    const files = {
        'world.json': {objects: {definitions: {tool: {name: 'Crowbar', category: 'item'}},
            instances: {old: {name: 'Old crowbar', definition: 'tool', state: {condition: 'intact'}}}}},
        'current.json': {party: [{name: 'Investigator', weapons: [{name: 'Folding knife', display_name: 'Pocket knife'}]}]},
        'history.json': [{turn: 4, player_text: 'Leave it.', rendered_text: 'The book remains.'}],
        'effective.json': {graph: {nodes: [{name: 'Archive', node_kind: 'scene', summary: 'A closed archive.',
            properties: {runtime_projection: {record: {handle: 'archive', aliases: ['Records room']}}}}]}}
    };
    const cases = [
        ['objects', ['Old crowbar'], [], 'world.json'],
        ['objects', ['Pocket knife'], [], 'current.json'],
        ['history', [], [4], 'history.json'],
        ['source', ['Records room'], [], 'effective.json']
    ];
    for (const [kind, names, turns, file] of cases) {
        const view = auditEvidenceView(kind, files, names, turns, 2);
        assert.equal(view.entries.length, 1, `${kind} returns the structurally matched row`);
        assert.ok(view.entries[0].sources.length > 0, `${kind} returns selectable sources`);
        assert.ok(view.entries[0].sources.every(source => source.file === file));
    }
});

test('schema 2 submit validates aliases and retains the raw selector artifact', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'jev-audit-host-'));
    const request = {input: {text: 'His childhood was described.'}, continuity_review: {schema: 2, files: ['memory.json']}};
    const files = {'memory.json': [{statement: 'The childhood account was withdrawn.'}]};
    await writeFile(join(cwd, 'request.json'), JSON.stringify(request));
    await writeFile(join(cwd, 'memory.json'), JSON.stringify(files['memory.json']));
    await writeFile(join(cwd, 'control.json'), JSON.stringify({max_requests: 2, max_artifact_repairs: 1, status_file: 'status.json'}));
    const catalog = buildAuditReferences(request, files);
    const artifact = {schema: 2, missing: [], findings: [], continuity_review: {
        verdict: 'revise', summary: 'The retained correction conflicts with the draft.', conflicts: [{
            claim_source: catalog.sources.draft[0].alias,
            reason: 'The retained correction withdrew this account.',
            evidence_sources: [catalog.sources.evidence[0].alias]
        }]
    }};
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
    const submit = tools.get('submit_audit');
    const invalid = structuredClone(artifact);
    invalid.continuity_review.conflicts[0].evidence_sources = ['memory:999'];
    const rejected = await submit.execute('invalid', {result: invalid});
    assert.equal(rejected.isError, true);
    assert.ok(rejected.details.errors.some(error => error.path === '/continuity_review/conflicts/0/evidence_sources/0'));
    const accepted = await submit.execute('valid', {result: artifact});
    assert.equal(accepted.terminate, true);
    const retained = JSON.parse(await readFile(join(cwd, 'result.json'), 'utf8'));
    assert.deepEqual(retained, artifact);
    assert.equal(retained.schema, 2);
    assert.equal(retained.continuity_review.conflicts[0].claim, undefined);
    assert.equal(retained.continuity_review.conflicts[0].evidence, undefined);
});

test('schema 2 semantic repair errors point back to selector fields', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'jev-audit-repair-'));
    const request = {input: {text: 'You hear a bell.'}, continuity_review: {schema: 2, files: ['context.json']}};
    const files = {'context.json': {outcome_commitments: {requires_review: true, failed_rolls: [{skill: 'Listen', passed: false}]}}};
    await writeFile(join(cwd, 'request.json'), JSON.stringify(request));
    await writeFile(join(cwd, 'context.json'), JSON.stringify(files['context.json']));
    await writeFile(join(cwd, 'control.json'), JSON.stringify({max_requests: 1, max_artifact_repairs: 1, status_file: 'status.json'}));
    const catalog = buildAuditReferences(request, files);
    const artifact = {schema: 2, missing: [], findings: [], continuity_review: {
        verdict: 'pass', summary: 'The failed roll was respected.', conflicts: [],
        outcome_review: {verdict: 'pass', basis: 'failed_rolls_respected', claim_sources: [catalog.sources.draft[0].alias]}
    }};
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
    const rejected = await tools.get('submit_audit').execute('repair', {result: artifact});
    assert.equal(rejected.isError, true);
    assert.ok(rejected.details.errors.some(error => error.path === '/continuity_review/outcome_review/claim_sources'));
    assert.ok(rejected.details.errors.every(error => !error.path.includes('/claims') && !/^(Copy|Name) /.test(error.message)));
});
