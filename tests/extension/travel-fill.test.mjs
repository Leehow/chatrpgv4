/**
 * Contract §138.9 (BR-05): the host's build step "fill travel minutes".
 *
 * The question over a controlled typed endpoint behind the real decision adapter (`fetch` answers the pinned Jev
 * model); the kernel's one writer (`kernel-ts/modules/route-travel.ts`) as the starter regeneration calls it; and the
 * reading service's publication, whose `module.read.finish` carries the bands of the roads it adds. Asserted: what Jev
 * was asked and shown, what lands on which relation, what `module.read.finish` was sent, and the telemetry row.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { askTravel, createTravelFill, newRoads, readTravelRows, sceneBrief, unfilledRoads, viewOfRelations } from "../../extensions/module/travel-fill.ts";
import { travelBatches, travelCriteria, TRAVEL_ROADS_PER_REQUEST } from "../../runtime/jev/travel-band-domain.ts";
import { applyTravelFill, preserveTravel } from "../../kernel-ts/modules/route-travel.ts";
import { ReadingService } from "../../extensions/module/reading-service.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const CONTENT = join(ROOT, "content");
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const ROWS = await readTravelRows(CONTENT);
const TABLE = JSON.parse(await readFile(join(CONTENT, "rulesets", "coc7", "rules-json", "time-costs.json"), "utf8")).categories;

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}
/** A controlled typed endpoint: `answer(key, question, body)` names the choice and its confidence for every question. */
function installJev(t, answer, status = 200) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		if (status !== 200) return new Response("unavailable", { status });
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria);
			const { choice, confidence } = answer(key, question, body);
			return [key, { type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 800, output_tokens: 10 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

const scene = (id, name, summary, extra = {}) => ({ node_id: id, node_kind: "scene", name, summary, properties: extra });
const road = (id, from, to, properties = {}) => ({ relation_id: id, relation_kind: "route-to", from_node_id: from, to_node_id: to, claim_id: `claim-${id}`, properties });
/** A small graph: an office, a library across town, a far town, and a house's two floors; one road the book timed. */
function graph() {
	return {
		nodes: [
			scene("scene-office", "Knott's Office", "Knott's Office", { runtime_projection: { record: { dramatic_question: "Will they take the job?", location_tags: ["office", "downtown"] } } }),
			scene("scene-library", "Central Library", "Reading rooms of the city library."),
			scene("scene-arkham", "Arkham", "A town a day's ride away."),
			scene("scene-ground", "Ground Floor", "The house's ground floor."),
			scene("scene-upper", "Upper Floor", "The bedrooms upstairs."),
			{ node_id: "location-house", node_kind: "location", name: "Corbitt House" },
			{ node_id: "location-boston", node_kind: "location", name: "Boston" },
			{ node_id: "npc-knott", node_kind: "npc", name: "Knott" },
		],
		relations: [
			road("r-office-library", "scene-office", "scene-library"),
			road("r-library-office", "scene-library", "scene-office"),
			road("r-office-arkham", "scene-office", "scene-arkham"),
			road("r-ground-upper", "scene-ground", "scene-upper", { edge_kind: "stairs" }),
			road("r-ground-office", "scene-ground", "scene-office", { travel_minutes: 12 }),
			road("r-office-ground", "scene-office", "scene-ground"),
			{ relation_id: "r-house", relation_kind: "contains", from_node_id: "location-house", to_node_id: "scene-ground", properties: {} },
			{ relation_id: "r-house-in", relation_kind: "located-in", from_node_id: "location-house", to_node_id: "location-boston", properties: {} },
			{ relation_id: "r-knott", relation_kind: "present-in", from_node_id: "npc-knott", to_node_id: "scene-office", properties: {} },
		],
	};
}
const relation = (g, id) => g.relations.find((r) => r.relation_id === id);

test("the question: the travel rows by their own name and range, the adjacent exit, and scenes as the book describes them", () => {
	const criteria = travelCriteria(ROWS);
	assert.deepEqual(Object.keys(criteria), ["adjacent", "local_travel", "long_travel"]);
	assert.match(criteria.local_travel, new RegExp(`${TABLE.local_travel.min} to ${TABLE.local_travel.max} minutes`));
	assert.match(criteria.long_travel, new RegExp(`${TABLE.long_travel.min} to ${TABLE.long_travel.max} minutes`));
	const roads = unfilledRoads(graph());
	const { batches } = travelBatches({ module: "book", roads, rows: ROWS });
	assert.equal(batches.length, 1);
	const { state, questions } = batches[0].batch;
	assert.equal(questions.length, roads.length);
	for (const question of questions) {
		assert.equal(question.type, "choice");
		assert.deepEqual(question.criteria, criteria);
		assert.match(question.instructions, new RegExp(`roads\\.${question.key}`));
	}
	// Names, summaries, places: never a node id; a summary that only repeats the name gives way to the record's question.
	assert.doesNotMatch(JSON.stringify(state), /scene-|location-|npc-/);
	const office = sceneBrief(viewOfRelations(graph()), "scene-office");
	assert.deepEqual(office, { name: "Knott's Office", summary: "Will they take the job?", tags: ["office", "downtown"] });
	assert.deepEqual(sceneBrief(viewOfRelations(graph()), "scene-ground").places, ["Corbitt House", "Boston"]);
});

test("the roads asked: one per pair of scenes still without minutes, never a road the book or an earlier fill timed", () => {
	const roads = unfilledRoads(graph()).map(({ a, b }) => [a, b]);
	// office-library once for its two relations; office-ground not at all: the book times it one way, and the writer
	// times the other way from that (next test).
	assert.deepEqual(roads, [["scene-library", "scene-office"], ["scene-arkham", "scene-office"], ["scene-ground", "scene-upper"]]);
	const many = { nodes: Array.from({ length: 30 }, (_, i) => scene(`scene-${i}`, `Place ${i}`, `Somewhere ${i}.`)),
		relations: Array.from({ length: 29 }, (_, i) => road(`r${i}`, `scene-${i}`, `scene-${i + 1}`)) };
	const { batches } = travelBatches({ module: "book", roads: unfilledRoads(many), rows: ROWS });
	assert.deepEqual(batches.map(({ roads }) => roads.length), [TRAVEL_ROADS_PER_REQUEST, TRAVEL_ROADS_PER_REQUEST, 29 - 2 * TRAVEL_ROADS_PER_REQUEST]);
});

test("the writer: a travel row lands its default, adjacent lands 0, both directions alike, and a timed road is never touched", () => {
	const g = graph();
	const { filled, skipped } = applyTravelFill(g, [
		{ from: "scene-office", to: "scene-library", band: "local_travel", confidence: 0.91 },
		{ from: "scene-arkham", to: "scene-office", band: "long_travel", confidence: 0.6 },
		{ from: "scene-upper", to: "scene-ground", band: "adjacent", confidence: 0.99 },
		{ from: "scene-office", to: "scene-ground", band: "local_travel", confidence: 0.8 },
		{ from: "scene-office", to: "scene-library", band: "sleep_night", confidence: 0.9 },
	], ROWS);
	assert.equal(relation(g, "r-office-library").properties.travel_minutes, TABLE.local_travel.default);
	assert.equal(relation(g, "r-library-office").properties.travel_minutes, TABLE.local_travel.default);
	assert.deepEqual(relation(g, "r-office-library").properties.travel, { basis: "banded", band: "local_travel", confidence: 0.91 });
	assert.equal(relation(g, "r-office-arkham").properties.travel_minutes, TABLE.long_travel.default);
	assert.deepEqual(relation(g, "r-ground-upper").properties, { edge_kind: "stairs", travel_minutes: 0, travel: { basis: "banded", band: "adjacent", confidence: 0.99 } });
	// The book's 12 minutes stand, and the other direction of the same road takes them as stated, not the band.
	assert.deepEqual(relation(g, "r-ground-office").properties, { travel_minutes: 12 });
	assert.deepEqual(relation(g, "r-office-ground").properties, { travel_minutes: 12, travel: { basis: "stated" } });
	assert.deepEqual(filled.map((item) => [item.relation_id, item.basis]), [["r-office-ground", "stated"], ["r-office-library", "banded"],
		["r-library-office", "banded"], ["r-office-arkham", "banded"], ["r-ground-upper", "banded"]]);
	assert.deepEqual(skipped.map((item) => item.reason), ["no_unfilled_road", "band_unknown"]);
	// The re-assembly of a publication keeps what was filled, and only for the same two nodes.
	const rebuilt = preserveTravel(relation(g, "r-office-library"), { ...road("r-office-library", "scene-office", "scene-library") });
	assert.equal(rebuilt.properties.travel_minutes, TABLE.local_travel.default);
	assert.deepEqual(preserveTravel(relation(g, "r-office-library"), road("r-office-library", "scene-office", "scene-arkham")).properties, {});
});

test("above the gate a road is named; below it, or without a key, the road keeps no minutes and the row says why", async (t) => {
	const roads = unfilledRoads(graph());
	const requests = installJev(t, (key, question) => question.instructions.target.includes("Arkham")
		? { choice: "long_travel", confidence: 0.3 } : question.instructions.target.includes("Upper Floor") ? { choice: "adjacent", confidence: 0.95 } : { choice: "local_travel", confidence: 0.82 });
	const asked = await askTravel({ env: KEY, module: "book", roads, rows: ROWS });
	assert.equal(requests.length, 1);
	assert.deepEqual(asked.entries, [
		{ from: "scene-library", to: "scene-office", band: "local_travel", confidence: 0.82 },
		{ from: "scene-ground", to: "scene-upper", band: "adjacent", confidence: 0.95 },
	]);
	assert.equal(asked.row.lane, "travel-fill");
	assert.equal(asked.row.roads, 3);
	assert.equal(asked.row.banded, 2);
	assert.equal(asked.row.adjacent, 1);
	assert.deepEqual(asked.row.unfilled, { low_confidence: 1 });
	const low = asked.row.answers.find((answer) => answer.outcome === "low_confidence");
	assert.equal(low.band, "long_travel");
	assert.ok(low.distribution && low.confidence === 0.3);
	const bare = await askTravel({ env: {}, module: "book", roads, rows: ROWS });
	assert.equal(requests.length, 1, "no key, no question");
	assert.deepEqual(bare.entries, []);
	assert.deepEqual(bare.row.unfilled, { unconfigured: 3 });
});

test("a failed request leaves every road of it without minutes", async (t) => {
	installJev(t, () => ({ choice: "local_travel", confidence: 0.9 }), 500);
	const asked = await askTravel({ env: KEY, module: "book", roads: unfilledRoads(graph()), rows: ROWS });
	assert.deepEqual(asked.entries, []);
	assert.deepEqual(asked.row.unfilled, { service_error: 3 });
});

test("a publication asks only the roads its draft adds, and never a restated one", () => {
	const job = { known_nodes: graph().nodes, known_claims: [{ subject_id: "scene-office", predicate: "route-to", object: { node_id: "scene-library" } }] };
	const draft = { nodes: [scene("scene-docks", "The Docks", "Wharves on the harbour.")], claims: [
		{ subject_id: "scene-office", predicate: "route-to", object: { node_id: "scene-library" } },
		{ subject_id: "scene-docks", predicate: "route-to", object: { node_id: "scene-office" } },
		{ subject_id: "npc-knott", predicate: "present-in", object: { node_id: "scene-docks" } },
	] };
	const roads = newRoads(job, draft);
	assert.deepEqual(roads.map(({ a, b }) => [a, b]), [["scene-docks", "scene-office"]]);
	assert.deepEqual(roads[0].briefs.map((brief) => brief.name), ["The Docks", "Knott's Office"]);
});

/** The reading service over a scripted reader: one opening draft with two scenes and a road between them. */
async function publish(t, { env, answer, travel } = {}) {
	const home = await mkdtemp(join(tmpdir(), "coc-travel-fill-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const cwd = join(home, "work", "attempt-1"), cache = join(home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(cwd, { recursive: true });
	await mkdir(cache, { recursive: true });
	const requests = answer ? installJev(t, answer) : [];
	const draft = {
		nodes: [
			{ node_id: "scene-opening", node_kind: "scene", name: "Knott's Office", summary: "A landlord's office downtown.", source_refs: [{ page: 4 }], visibility: "player-safe", properties: { is_entrance: true } },
			{ node_id: "scene-harbor", node_kind: "scene", name: "The Harbor", summary: "Wharves across the city.", source_refs: [{ page: 4 }], visibility: "player-safe", properties: {} },
		],
		claims: [{ subject_id: "scene-opening", predicate: "route-to", object: { node_id: "scene-harbor" }, truth_status: "authorial", visibility: "keeper-only", source_refs: [{ page: 4 }] }],
		dependencies: [], critical: [], ready_nodes: ["scene-opening"], coverage: {},
	};
	const runtime = {
		contentRoot: CONTENT,
		async runTask({ request }) {
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			const image = join(cache, "page-4.png"), call = request.prompt.phase === "read" ? "read-1" : `review-${task.required_review.join("-")}`;
			if (request.prompt.phase === "read") {
				await writeFile(join(request.cwd, "draft.json"), JSON.stringify(draft) + "\n");
				await appendFile(join(cache, "requests.jsonl"), JSON.stringify({ file_sha256: "source-sha", path: image, page: 4, box: [0, 0, 1, 1] }) + "\n");
			} else await writeFile(join(request.cwd, "review.json"), JSON.stringify({ checked: [{ paths: task.required_review,
				verdict: "supported", source_refs: [{ page: 4 }], reason: "fixture source support" }], missing: [] }) + "\n");
			request.onEvent?.({ type: "tool_execution_end", toolCallId: call, isError: false,
				result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: [{ path: image, page: 4 }] } } });
			await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: [call] }) + "\n");
			return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
		},
		async check() { return { ok: true }; },
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const finishes = [], rows = [];
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }),
		progress() {}, record(row) { rows.push(row); },
		...(travel !== undefined ? { travel } : env ? { travel: createTravelFill({ env, contentRoot: CONTENT }) } : {}),
		async call(method, params) {
			finishes.push(params);
			return params.outcome === "completed" ? { state: "ready", ...(params.travel ? { travel: { filled: params.travel.length, skipped: [] } } : {}) } : { state: params.outcome };
		} });
	t.after(() => service.close());
	const job = { job_id: "read-1", module_id: "book", purpose: "opening", focus: "scene-opening", foreground: true, lease: "lease-1",
		work_dir: cwd, source: { path: join(home, ".coc", "modules", "book", "source.pdf"), page_count: 8, file_sha256: "source-sha" },
		index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [] };
	await service.runJob(job, new AbortController().signal, "c1");
	const completed = finishes.find((params) => params.outcome === "completed");
	return { completed, finishes, rows: rows.filter((row) => row.lane === "travel-fill"), requests };
}

test("the reading service sends the named band of the road it adds with the same publication", async (t) => {
	const { completed, rows, requests } = await publish(t, { env: KEY, answer: () => ({ choice: "local_travel", confidence: 0.88 }) });
	assert.equal(requests.length, 1);
	assert.deepEqual(completed.travel, [{ from: "scene-harbor", to: "scene-opening", band: "local_travel", confidence: 0.88 }]);
	assert.deepEqual(rows.map((row) => row.event), ["asked", "published"]);
	assert.equal(rows[0].job_id, "read-1");
	assert.equal(rows[0].campaign, "c1");
	assert.equal(rows[1].filled, 1);
});

test("below the gate, without a key, or when the step throws, the reading publishes exactly as before", async (t) => {
	const low = await publish(t, { env: KEY, answer: () => ({ choice: "local_travel", confidence: 0.2 }) });
	assert.ok(low.completed && !("travel" in low.completed));
	assert.deepEqual(low.rows.map((row) => [row.event, row.unfilled]), [["asked", { low_confidence: 1 }]]);
	const bare = await publish(t, { env: {} });
	assert.ok(bare.completed && !("travel" in bare.completed));
	assert.deepEqual(bare.rows.map((row) => row.unfilled), [{ unconfigured: 1 }]);
	const broken = await publish(t, { travel: async () => { throw new Error("step failed"); } });
	assert.ok(broken.completed && !("travel" in broken.completed));
	assert.deepEqual(broken.rows, []);
});
