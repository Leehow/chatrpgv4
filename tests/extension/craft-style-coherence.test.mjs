/** §30.7d style coherence: the four exchange-coherence directives are the only craft directives,
 *  and the axes/floor lines the capsule carries are the decided 2026-09-24 lines, verbatim.
 *  Runs against the real TextGraph built from content/craft, never fixture objects. */
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, test} from 'node:test';
import {build} from 'esbuild';

const ROOT = resolve(import.meta.dirname, '../..');
const temporary = await mkdtemp(join(tmpdir(), 'craft-style-coherence-'));
after(() => rm(temporary, {recursive: true, force: true}));
await symlink(join(ROOT, 'node_modules'), join(temporary, 'node_modules'), 'dir');

await build({
	stdin: {contents: `export {DirectorGraph, TextGraph} from './kernel-ts/read/content.ts';
export {jsonDigest, parsePythonJson} from './kernel-ts/json.ts';`, resolveDir: ROOT, sourcefile: 'craft-style-coherence.ts'},
	outfile: join(temporary, 'kernel.mjs'), bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent',
});
const api = await import(pathToFileURL(join(temporary, 'kernel.mjs')).href);

const CONTENT = join(ROOT, 'content');
const parse = path => api.parsePythonJson(readFileSync(path, 'utf8'));
const graph = parse(join(CONTENT, 'craft/text-graph.json'));
const manifest = parse(join(CONTENT, 'craft/text-graph-manifest.json'));
const table = parse(join(CONTENT, 'craft/beat-directives.json'));
const director = new api.DirectorGraph(parse(join(CONTENT, 'director/director-graph.json')), parse(join(CONTENT, 'director/director-graph-manifest.json')));
const craft = new api.TextGraph(graph, manifest, table, director.beats);

// The decided 2026-09-24 exchange-coherence lines (.coc/evaluations/craft-default-on-20260924/candidate.json), fixed here.
const EXPECTED_AXES = [
	'style-axis:avoid-translationese|write natural, complete sentences with clear speakers and relationships',
	'style-axis:avoid-ai-summary-voice|give the exchange its next meaningful response or settled consequence',
	'style-axis:avoid-log-style-summary|choose scene detail for what the player is doing and can perceive',
	'style-axis:avoid-semantic-repetition|let established NPC intentions and relationships shape their wording and register',
	'style-axis:avoid-abstract-psychological-explanation|vary focus and rhythm with the scene; plain answers, narration, dialogue and purposeful silence are all available',
	'style-axis:prefer-observable-behavior|preserve source truth, player agency and the actual settled outcome',
];
const EXPECTED_DIRECTIVES = [
	['exchange-response', "start from the world's uptake of the declaration; a necessary bridge is not a replay of the player's whole input"],
	['voice-with-purpose', 'let each relevant speaker answer, ask, offer, evade or refuse from their established position; their words can carry the beat without a compulsory gesture'],
	['selective-detail', 'make the relevant person, object or space intelligible; choose details that change perception or meaning rather than filling a sensory or atmosphere quota'],
	['clarity-and-completion', 'carry the settled result to its actual endpoint; reread for clear agency, speaker transitions and natural play_language'],
];
const EXPECTED_BRIEFS = [
	['exchange-response', 'Answer the declaration through the world, not a replay.'],
	['voice-with-purpose', 'Let established voices answer; gestures are optional.'],
	['selective-detail', 'Choose relevant detail, not a sensory or atmosphere quota.'],
	['clarity-and-completion', 'Complete the settled result; keep agency and speakers clear.'],
];
const EXPECTED_FLOOR = [
	"uptake: make clear how the world receives the player's chosen action or words without requiring the whole declaration to be spoken or performed twice",
	'answer: show the actual settled result and answer the selected exchange; quiet play needs no new event and an offer is not a debt',
	'voice: use the touched person\'s own speech or meaningful silence; preserve who said what and who knows what',
	'handoff: complete the selected goal or stop at a genuinely new unselected consequential decision, with enough public context to judge',
];
const RETIRED_DIRECTIVE_IDS = [
	'observable-before-interpretation', 'player-action-uptake', 'rewrite-abstract-explanation-to-action',
	'skill-interpretation-after-visible-evidence', 'final-prose-guard-before-output', 'repetition-policy',
	'action-uptake-review', 'rewrite-ai-summary-voice', 'rewrite-camera-direction-staging',
	'rewrite-passive-translation-ese', 'rewrite-abstract-psychological-explanation',
];
const EXPECTED_RELATION_COUNT = 18;
const PROTECTED_NODE_IDS = [
	'agency-claim-type:forced-behavior', 'beat-type:anticipation', 'coverage-field:action-realization',
	'narration-budget-mode:climax-or-madness', 'narration-budget-trigger:bout-of-madness', 'obligation-kind:first-impression',
	'obligation-source-kind:amount', 'play-register:pulp', 'player-input-handling:abstract-completed',
	'realization-mode:concealed-no-player-visible-beat', 'render-prohibition:expository-choice-summary',
	'render-slot:active-motion', 'review-rule:abstract-psychological-explanation', 'roll-visibility-class:consequence-public',
	'segment-type:asset-delta', 'substantive-effect-status:applied', 'text-threshold:excerpt-repair-min-match',
	'style-axis:avoid-translationese', 'style-axis:prefer-observable-behavior',
];

function assertStyle(style, directives = EXPECTED_DIRECTIVES) {
	assert.deepEqual(style.directives.map(d => d.id), directives.map(([id]) => id));
	assert.deepEqual(style.directives.map(d => d.line), directives.map(([, line]) => line));
	assert.deepEqual(style.floor, EXPECTED_FLOOR);
	assert.equal(style.floor.length, 4);
}

test('the graph digest and node counts in the manifest describe the real nodes', () => {
	assert.equal(api.jsonDigest(graph), manifest.graph_content_digest);
	const counts = {};
	for (const node of graph.nodes) counts[node.node_kind] = (counts[node.node_kind] || 0) + 1;
	assert.deepEqual(manifest.node_counts, counts);
	assert.equal(manifest.node_counts['craft-directive'], 4);
});

test('the full style carries exactly the four exchange-coherence directives with the decided lines', () => {
	assertStyle(craft.style('zh-Hans', 'purist', 'REVEAL', true));
});

test('every Director beat carries the same four directives in one order, with axes and floor verbatim', () => {
	const expected = EXPECTED_AXES.map(entry => entry.split('|')[1]);
	for (const beat of director.beats) {
		const style = craft.style('zh-Hans', 'purist', beat, false);
		assertStyle(style, EXPECTED_BRIEFS);
		assert.deepEqual(style.axes, expected);
		assert.ok(Buffer.byteLength(JSON.stringify(style)) <= 1536, 'the brief fits without dropping a directive');
	}
});

test('legacy tables keep their line fallback and malformed brief maps are rejected', () => {
	const {brief_directive_lines, ...legacy} = table;
	const old = new api.TextGraph(graph, manifest, legacy, director.beats);
	assertStyle(old.style('en', 'purist', 'REVEAL', false));
	for (const brief of [{}, {...brief_directive_lines, unexpected: 'Foreign'}, {...brief_directive_lines, 'exchange-response': ''}])
		assert.throws(() => new api.TextGraph(graph, manifest, {...table, brief_directive_lines: brief}, director.beats), /brief_directive_lines/);
});

test('the six general craft principles project identically for any play language', () => {
	const expected = EXPECTED_AXES.map(entry => entry.split('|')[1]);
	for (const language of ['zh-Hans', 'en-US', 'fr-CA', 'und-x-new'])
		assert.deepEqual(craft.style(language, 'purist', 'REVEAL', true).axes, expected);
	assert.ok(craft.axes.every(axis => axis.properties.language_applicability === 'all'));
});

test('the eleven retired rewrite-lane directives are gone from nodes, table lines and relations', () => {
	const nodeIds = new Set(graph.nodes.map(n => n.node_id));
	for (const id of RETIRED_DIRECTIVE_IDS) {
		assert.equal(nodeIds.has(`craft-directive:${id}`), false, `node craft-directive:${id} should be retired`);
		assert.equal(id in table.directive_lines, false, `directive_lines.${id} should be retired`);
		assert.equal(Object.values(table.beats).some(ids => ids.includes(id)), false, `beats still name ${id}`);
	}
	for (const relation of graph.relations) {
		assert.equal(RETIRED_DIRECTIVE_IDS.some(id => relation.from_node_id === `craft-directive:${id}` || relation.to_node_id === `craft-directive:${id}`),
			false, `relation ${relation.relation_id} still references a retired directive`);
	}
	assert.equal(graph.relations.length, EXPECTED_RELATION_COUNT);
});

test('no non-craft node or relation was lost: counts per kind and protected ids hold', () => {
	const byKind = {};
	for (const node of graph.nodes) (byKind[node.node_kind] ??= []).push(node.node_id);
	for (const [kind, count] of Object.entries(manifest.node_counts)) {
		if (kind === 'craft-directive') continue;
		assert.equal(byKind[kind].length, count, `node_kind ${kind} lost nodes`);
	}
	const nodeIds = new Set(graph.nodes.flatMap(n => n.node_id));
	for (const id of PROTECTED_NODE_IDS) assert.equal(nodeIds.has(id), true, `protected node ${id} is missing`);
	const relations = new Set(graph.relations.map(r => `${r.from_node_id}->${r.to_node_id}`));
	for (const [from, to] of [['amount', 'roll'], ['check', 'roll'], ['concealed-roll', 'roll'], ['first-impression', 'first-impression'], ['sanity-bout', 'sanity-bout']])
		assert.equal(relations.has(`obligation-source-kind:${from}->obligation-kind:${to}`), true, `obligation relation for ${from} missing`);
	assert.equal(graph.relations.filter(r => r.relation_kind === 'renders-settled-output').length, 3);
	assert.equal(graph.relations.filter(r => r.from_node_id?.startsWith('narration-budget-trigger:')).length, 10);
});
