/**
 * Contract §198's book: Cold Harvest's history in three pages (real table TR-F2 run 2). Its opening chapter was read first as
 * two openings on page 1 (`Briefing One`, `Briefing Two`, both entrances, Captain Aganin `present-in` both; a visitor the
 * book brings in only if the orders are refused, `present-in` the second), and a house on page 2 whose people are linked to
 * the scene that happens there (`First Visit to the House` `occurs-at` the house, the farmer `present-in` that scene).
 * A third scene on page 1, the archive, is no opening, so its clerk is no one the opening places. Then the source-reference
 * bind ran: it reuses an existing entrance only when exactly one cites the entry page, so with two it minted the
 * identity-only anchor `scene-source-entry-1` and made it the only entry -- the opening the campaign opens on.
 *
 * Built through the kernel's own handlers (`raw(method, params)`) in the workspace `home`: the book bound and read, the
 * reference published, and the campaign `CAMPAIGN` set up with a pregen card; `open` also opens the table.
 */
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {withPersonStatements} from './person-statements.mjs';

export const PAGES = [
	'Chapter Two. The captain stands behind a small desk, knocks on it with his knuckles and hands you the orders.',
	'The house at the north end of the farm. The family is asleep inside.',
	'3',
];
export const CAMPAIGN = 'roster';
export const CAPTAIN = 'Captain Aganin';
export const VISITOR = 'Late Visitor';
export const FARMER = 'Pyotr the Farmer';
export const HOUSE = 'The House at the North End';
export const OPENING_ONE = 'Briefing One';
export const OPENING_TWO = 'Briefing Two';
export const HOUSE_SCENE = 'First Visit to the House';
export const CLERK = 'Clerk Orlov';

const refs = page => [{page}];
export const NODES = [
	{node_id: 'scene-briefing-one', node_kind: 'scene', name: OPENING_ONE, source_refs: refs(1), summary: 'The captain briefs the investigators on the arrest.', properties: {is_entrance: true}},
	{node_id: 'scene-briefing-two', node_kind: 'scene', name: OPENING_TWO, source_refs: refs(1), summary: 'The captain briefs the investigators on the harvest.', properties: {is_entrance: true}},
	{node_id: 'npc-captain', node_kind: 'npc', name: CAPTAIN, source_refs: refs(1), summary: 'The commissar behind the desk.'},
	{node_id: 'npc-visitor', node_kind: 'npc', name: VISITOR, source_refs: refs(1), summary: 'Comes in only if the investigators refuse the orders.'},
	{node_id: 'scene-archive', node_kind: 'scene', name: 'The Archive', source_refs: refs(1), summary: 'A back room of files.'},
	{node_id: 'npc-clerk', node_kind: 'npc', name: CLERK, source_refs: refs(1), summary: 'Keeps the files.'},
	{node_id: 'location-house', node_kind: 'location', name: HOUSE, source_refs: refs(2), summary: 'A cottage at the north end of the farm.'},
	{node_id: 'scene-house-visit', node_kind: 'scene', name: HOUSE_SCENE, source_refs: refs(2), summary: 'The family is asleep inside.'},
	{node_id: 'npc-farmer', node_kind: 'npc', name: FARMER, source_refs: refs(2), summary: 'The head of the household.'},
];
const claim = (subject_id, predicate, object, page = 1) => ({subject_id, predicate, object: {node_id: object}, truth_status: 'authored-fact', source_refs: refs(page)});
export const CLAIMS = [
	claim('npc-captain', 'present-in', 'scene-briefing-one'), claim('npc-captain', 'present-in', 'scene-briefing-two'), claim('npc-visitor', 'present-in', 'scene-briefing-two'), claim('npc-clerk', 'present-in', 'scene-archive'),
	claim('npc-farmer', 'present-in', 'scene-house-visit', 2), claim('scene-house-visit', 'occurs-at', 'location-house', 2), claim('scene-briefing-two', 'route-to', 'location-house'),
];

/** The book bound, read as far as its two openings and the house, then bound to the original as a reference (the anchor minted). */
export async function buildRosterBook(raw, home, {open = false} = {}) {
	const sha = value => createHash('sha256').update(value).digest('hex');
	const pdf = join(home, 'roster.pdf');
	await writeFile(pdf, `%PDF-1.7\n% ${PAGES.join(' | ')}\n%%EOF\n`);
	const digest = sha(await readFile(pdf));
	const {module_id: mid} = await raw('module.source.bind', {source: {path: pdf, page_count: PAGES.length, file_sha256: digest}});
	const read = async (purpose, draft, paths) => {
		await raw('module.read.request', {module_id: mid, purpose});
		const job = await raw('module.read.claim', {module_id: mid, owner: 'test-host'});
		await writeFile(join(job.work_dir, 'observations.json'), JSON.stringify({file_sha256: digest, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3]}));
		await writeFile(join(job.work_dir, 'draft.json'), JSON.stringify(draft));
		await writeFile(join(job.work_dir, 'review.json'), JSON.stringify({checked: [{paths: withPersonStatements(draft, paths), verdict: 'supported', source_refs: refs(1), reason: 'fixture support'}], missing: []}));
		return raw('module.read.finish', {module_id: mid, job_id: job.job_id, lease: job.lease, outcome: 'completed',
			draft_path: join(job.work_dir, 'draft.json'), review_path: join(job.work_dir, 'review.json')});
	};
	await read('index', {title: 'The Farm', language: 'en', sections: [{name: 'Chapter Two', pages: [[1, 3]], source_refs: refs(1), entities: [OPENING_ONE, CAPTAIN]}]}, []);
	await read('opening', {nodes: NODES, claims: CLAIMS, node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: NODES.map(node => node.node_id)},
		[...NODES.map((_node, index) => `/nodes/${index}`), ...CLAIMS.map((_claim, index) => `/claims/${index}`), '/coverage']);
	// The reference bind, as the library's guidance setup ran it later: one entry, on the page both openings cite.
	const work = join(home, '.coc', 'modules', mid, 'work', 'reference');
	await mkdir(work, {recursive: true});
	const span = {id: 'p1-0', page: 1, start: 0, end: PAGES[0].length, text: PAGES[0]};
	const packet = {protocol: 'source-reference-v1', source_sha256: digest, extraction_version: 'fixture', purpose: 'guidance', question: 'Start', excerpts: [span],
		fields: Object.fromEntries(['era', 'place', 'premise', 'advice', 'warnings', 'opening'].map(key => [key, [span.id]])),
		entries: [{id: 'scene-source-entry-1', name: 'Chapter Two', page: 1}], partial: true, visual_coverage: 'unassessed', unavailable_pages: []};
	const task = JSON.stringify({purpose: 'guidance', source_reference: 'guidance'}), body = JSON.stringify(packet), guide = 'Chapter Two, 1937.';
	await writeFile(join(work, 'task.json'), task);
	await writeFile(join(work, 'source-reference.json'), body);
	await writeFile(join(work, 'reference-guidance.txt'), guide);
	const public_fields = Object.fromEntries(['era', 'starting_place', 'public_premise', 'creation_advice'].map(key => [key, {status: 'value', text: guide, source_refs: refs(1)}]));
	const checks = Object.fromEntries(['wrong_orientation', 'card_restriction', 'advice_omission', 'warning_omission', 'plot_disclosure', 'causal_conflict']
		.map(key => [key, {status: 'answered', type: 'noul', noul: 0}]));
	await writeFile(join(work, 'source-reference-complete.json'), JSON.stringify({protocol: 'source-reference-v1', kind: 'guidance', source_sha256: digest,
		task_sha256: sha(task), packet_sha256: sha(body), text_sha256: sha(guide), checks_policy: 'material-issues-v1', checks, public_fields}));
	const published = await raw('module.reference.publish', {module_id: mid, work_dir: work, guidance_key: 'e'.repeat(64), play_language: 'en'});
	if (!published.setup_ready) throw new Error(`the fixture's reference bind did not make setup ready: ${JSON.stringify(published)}`);
	await raw('campaign.create', {id: 'card-source', module: 'the-haunting', pregen: 'thomas-hayes', play_language: 'en'});
	const saved = await raw('investigator.save', {campaign: 'card-source'});
	await raw('campaign.create', {id: CAMPAIGN, module: mid, play_language: 'en'});
	await raw('investigator.load', {campaign: CAMPAIGN, library_id: saved.library_id});
	await raw('setup.complete', {campaign: CAMPAIGN});
	const opened = open ? await raw('table.open', {campaign: CAMPAIGN}) : null;
	return {mid, opened};
}
