/**
 * Contract §151.3 (ticket 03 of docs/specs/jev-decides-llm-writes.md): the Jev claim-support check of the reading
 * service's verify phase, at the host.
 *
 * The question travels through the real decision adapter to a controlled typed endpoint (`fetch` answers the pinned Jev
 * model, as tests/extension/travel-fill.test.mjs does), and the reading service runs a real verify round (a job resuming
 * its own interrupted attempt, so only the review runs) with a fake vision reviewer. Asserted: which records are
 * eligible and why the others are not; which records Jev was asked about; which paths each vision reviewer was given;
 * what `review.json` holds when `module.read.finish` is called; the evidence file and the telemetry rows.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { createClaimSupport } from "../../extensions/module/claim-support.ts";
import { reviewUnits } from "../../extensions/module/reader-review.ts";
import { claimCandidates, claimSupportMode, readClaimSupportBudget } from "../../runtime/jev/source-claim-support.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const KEY = { EXT_JEV_APIKEY: "test-jev-key" };
const SOURCE_SHA = "c".repeat(64);
const EXTRACTION = "pdfjs-test:native-text-v1";
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
/** The native text of each physical page; page 3 has none (a scanned page), page 4 is the handout's picture. */
const TEXT = {
	1: "The harbor dock smells of tar. A road runs from the dock up to the old tower.",
	2: "The tower keeper, a man of sixty, lives in the lamp room. The old tower was rebuilt in stone.",
	3: "",
	4: "Harbor chart",
};
const GATE = { mode: "shadow", supported_min: 0.9, contradicted_max: 0.1, timeout_ms: 20000, page_text_max_bytes: 12000, record_max_bytes: 6000, max_pages_per_request: 4 };

/**
 * One fragment: a scene and a road the page states (Jev clears both), a keeper Jev is not sure of, a tower whose page
 * contradicts the draft, a lamp on a page with no native text, and a claim citing a region of a page.
 */
function fragment() {
	return {
		nodes: [
			{ node_id: "scene-harbor", node_kind: "scene", name: "Harbor dock", summary: "The dock smells of tar.", visibility: "player-safe", source_refs: [{ page: 1 }], properties: {} },
			{ node_id: "npc-keeper", node_kind: "npc", name: "Tower keeper", summary: "Lives in the lamp room.", visibility: "keeper-only", source_refs: [{ page: 2 }], properties: { age: 60 } },
			{ node_id: "location-tower", node_kind: "location", name: "Old tower", summary: "Built of timber.", visibility: "player-safe", source_refs: [{ page: 2 }], properties: {} },
			{ node_id: "object-lamp", node_kind: "object", name: "Lamp", visibility: "keeper-only", source_refs: [{ page: 3 }], properties: {} },
		],
		claims: [
			{ subject_id: "scene-harbor", predicate: "route-to", object: { node_id: "location-tower" }, truth_status: "authored-fact", visibility: "player-safe", source_refs: [{ page: 1 }],
				reason: "The page says the road runs to the tower." },
			{ subject_id: "npc-keeper", predicate: "present-in", object: { node_id: "location-tower" }, truth_status: "authored-fact", visibility: "keeper-only", source_refs: [{ page: 2, box: [0, 0, 0.5, 0.5] }] },
		],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-harbor"],
	};
}
/** What the controlled endpoint answers for a record, by the name code rendered into its statement. */
function verdictOf(statement) {
	const name = statement.name ?? statement.subject?.name;
	if (name === "Harbor dock") return { supported: 0.97, contradicted: 0.01 };
	if (name === "Tower keeper") return { supported: 0.4, contradicted: 0.05 };
	if (name === "Old tower") return { supported: 0.95, contradicted: 0.8 };
	return { supported: 0.2, contradicted: 0.1 };
}
function installJev(t, { status = 200 } = {}) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		if (status !== 200) return new Response("unavailable", { status });
		const answers = Object.fromEntries(Object.keys(body.questions).map((key) => {
			const [claim, kind] = key.split("_");
			return [key, { type: "noul", noul: verdictOf(body.state.claims[claim].claim)[kind] }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 600, output_tokens: 8 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}
async function contentRoot(t, block = GATE) {
	const root = await mkdtemp(join(tmpdir(), "claim-support-content-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "rulesets", "coc7"), { recursive: true });
	await writeFile(join(root, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, ...(block ? { source_claim_support: block } : {}) }));
	return root;
}
const unitNames = (units) => units.map((paths) => [...paths].sort());

/**
 * A verify-only reading (a job resuming its own interrupted attempt) of `fragment()`, with a fake vision reviewer that
 * supports every assigned path after viewing every page, and the coverage reviewer optionally disputing `extra`.
 * `claimSupport` is the service's dependency, as `extensions/module/index.ts` wires it; absent, the service has none.
 */
async function verifyRound(t, { claimSupport, extra } = {}) {
	const home = await mkdtemp(join(tmpdir(), "claim-support-read-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const key = "job-key-1", previous = join(home, "work", "read-2", "attempt-1"), cwd = join(home, "work", "read-2", "attempt-2");
	const cache = join(home, ".coc", "modules", "book", "cache", "pages");
	for (const dir of [previous, cwd, cache]) await mkdir(dir, { recursive: true });
	const draftBytes = JSON.stringify(fragment()) + "\n";
	await writeFile(join(previous, "draft.json"), draftBytes);
	await writeFile(join(previous, "packet.json"), JSON.stringify({ key, source: { file_sha256: SOURCE_SHA } }));
	await writeFile(join(previous, "read-complete.json"), JSON.stringify({ job_id: "read-2", draft_sha256: sha(draftBytes),
		observations: { file_sha256: SOURCE_SHA, read_pages: [1, 2, 3], full_pages: [], review_pages: [] } }));
	const assigned = [], texts = [], rows = [], finished = [];
	let calls = 0;
	const runtime = {
		contentRoot: join(ROOT, "content"),
		async runTask({ request }) {
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			assigned.push(task.required_review);
			const seen = [1, 2, 3], call = `review-${++calls}`;
			const checked = [{ paths: task.required_review, verdict: "supported", source_refs: seen.map((page) => ({ page })), reason: "fixture support" }];
			if (extra && task.required_review.includes("/coverage")) checked.push(extra);
			await writeFile(join(request.cwd, "review.json"), JSON.stringify({ checked, missing: [] }) + "\n");
			for (const page of seen)
				await appendFile(join(cache, "requests.jsonl"), JSON.stringify({ file_sha256: SOURCE_SHA, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1] }) + "\n");
			request.onEvent?.({ type: "tool_execution_end", toolCallId: call, isError: false,
				result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: seen.map((page) => ({ path: join(cache, `page-${page}.png`), page })) } } });
			await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: [call] }) + "\n");
			return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
		},
		async sourceText({ pages, expected_file_sha256 }) {
			assert.equal(expected_file_sha256, SOURCE_SHA, "native text is pinned to the bound source");
			texts.push(pages);
			return { file_sha256: SOURCE_SHA, extraction_version: EXTRACTION, page_count: 4, errors: [],
				snapshots: pages.map((page) => ({ page, pdf_label: null, text: TEXT[page], text_sha256: sha(TEXT[page]), revision: "r", availability: TEXT[page] ? "text" : "empty" })) };
		},
		async check() { return { ok: true }; },
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const service = new ReadingService({ home, runtime, ...(claimSupport ? { claimSupport } : {}),
		model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }), progress() {}, record(row) { rows.push(row); },
		async call(method, params) {
			if (params.outcome === "completed") finished.push({ ...params, review: JSON.parse(await readFile(params.review_path, "utf8")) });
			return { state: "ready" };
		} });
	t.after(() => service.close());
	await service.runJob({ job_id: "read-2", module_id: "book", purpose: "detail", focus: "harbor", question: "", key, foreground: true, lease: "lease-1",
		work_dir: cwd, resume_from: previous, source: { path: join(home, ".coc", "modules", "book", "source.pdf"), page_count: 4, file_sha256: SOURCE_SHA },
		index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [] }, new AbortController().signal);
	assert.equal(finished.length, 1, "the reading published: " + JSON.stringify(rows.filter(row => row.event !== "review_concurrency" && row.event !== "review_input").slice(-6)));
	return { cwd, assigned, texts, rows, review: finished[0].review };
}
const claimRows = (rows, event = "claim_support") => rows.filter((row) => row.event === event);

test("§151.3 eligibility is structural: coverage, image sources, map regions, a map's kind, region citations and pages without native text keep the vision reviewer", () => {
	const draft = fragment();
	draft.nodes.push({ node_id: "handout-chart", node_kind: "handout", name: "Harbor chart", visibility: "player-safe", source_refs: [{ page: 4 }],
		properties: { image_sources: [{ page: 4, box: [0, 0, 1, 1] }] } });
	draft.nodes.push({ node_id: "location-docks-map", node_kind: "location", name: "Docks", source_refs: [{ page: 1 }],
		properties: { map_regions: [{ id: "north", box: [0, 0, 1, 0.5] }] } });
	// §39.4: a map's kind is read off the printed picture, even on a page whose native text is usable.
	draft.nodes.push({ node_id: "asset-harbor-map", node_kind: "asset", name: "Harbor map", source_refs: [{ page: 1 }], properties: { map_scope: "area" } });
	const units = reviewUnits(draft);
	assert.ok(units.some((paths) => paths.includes("/coverage")), "the fragment has a coverage unit");
	const hasText = (page) => TEXT[page].trim() !== "";
	const { candidates, ineligible } = claimCandidates(draft, units, { known_nodes: [] }, hasText, 6000);
	assert.deepEqual(candidates.map((candidate) => candidate.root).sort(), ["/claims/0", "/nodes/0", "/nodes/1", "/nodes/2"]);
	assert.deepEqual(ineligible, { image_source: 1, map_region: 1, map_scope: 1, no_native_text: 1, region_ref: 1 });
	assert.ok(!candidates.some((candidate) => candidate.paths.includes("/coverage")), "omission review is never asked of Jev");
	assert.deepEqual(claimCandidates(draft, [["/coverage", "/nodes/0"]], { known_nodes: [] }, hasText, 6000).candidates, [],
		"a record reviewed inside the coverage unit stays with the vision reviewer");
	const keeper = candidates.find((candidate) => candidate.root === "/nodes/1");
	assert.deepEqual(keeper.paths.sort(), ["/nodes/1", "/nodes/1/properties/age"], "a record carries every path of its unit group");
	// The statement is rendered by code from the record: names, relation, truth status -- never the author's reason.
	const road = candidates.find((candidate) => candidate.root === "/claims/0");
	assert.deepEqual(road.statement, { subject: { name: "Harbor dock", kind: "scene" }, relation: "route-to", object: { name: "Old tower", kind: "location" }, truth_status: "authored-fact" });
	assert.deepEqual(road.pages, [1]);
	// A record larger than the budget's bound is not asked (never clipped).
	const small = claimCandidates(draft, units, { known_nodes: [] }, hasText, 60);
	assert.deepEqual([small.candidates.length, small.ineligible.record_too_large], [0, 4]);
});

test("§151.3 the mode is the environment's when it names one, else the data's; an unreadable block is off", async (t) => {
	const budget = await readClaimSupportBudget(await contentRoot(t));
	assert.equal(budget.supportedMin, 0.9);
	assert.deepEqual(claimSupportMode({}, budget), { mode: "shadow", source: "data" });
	assert.deepEqual(claimSupportMode({ PI_COC_CLAIM_SUPPORT: "on" }, budget), { mode: "on", source: "env" });
	assert.deepEqual(claimSupportMode({ PI_COC_CLAIM_SUPPORT: "off" }, budget), { mode: "off", source: "env" });
	assert.deepEqual(claimSupportMode({ PI_COC_CLAIM_SUPPORT: "maybe" }, budget), { mode: "shadow", source: "data" });
	assert.equal(await readClaimSupportBudget(await contentRoot(t, null)), undefined);
	assert.equal(await readClaimSupportBudget(await contentRoot(t, { ...GATE, supported_min: 2 })), undefined, "a gate outside [0, 1] is no gate");
	assert.deepEqual(claimSupportMode({}, undefined), { mode: "off", source: "data" });
	const shipped = await readClaimSupportBudget(join(ROOT, "content"));
	assert.ok(shipped && ["on", "shadow"].includes(shipped.mode), "the shipped data carries a readable block");
});

test("§151.3 shadow asks Jev and changes no review outcome: the same units run, review.json is the vision review, the answers sit beside the verdicts", async (t) => {
	const baseline = await verifyRound(t);
	const requests = installJev(t);
	const shadow = await verifyRound(t, { claimSupport: createClaimSupport({ env: { ...KEY }, contentRoot: await contentRoot(t) }) });
	assert.deepEqual(unitNames(shadow.assigned).sort(), unitNames(baseline.assigned).sort(), "every unit still goes to the vision reviewer");
	assert.equal(shadow.assigned.length, 4);
	assert.deepEqual(shadow.review, baseline.review, "shadow writes no row into the review");
	assert.equal(requests.length, 1, "one fanned-out request for the fragment");
	assert.equal(Object.keys(requests[0].questions).length, 8, "two Nouls for each of the four eligible records");
	assert.deepEqual(Object.keys(requests[0].state.pages).sort(), ["p1", "p2"], "the state carries only the cited pages");
	assert.ok(!JSON.stringify(requests[0].state).includes("The page says the road runs"), "the author's reason is not shown");
	assert.deepEqual(shadow.texts.flat().sort(), [1, 2, 3], "native text is read for the pages the fact records cite");
	const evidence = JSON.parse(await readFile(join(shadow.cwd, "claim-support.json"), "utf8"));
	assert.equal(evidence.protocol, "source-claim-support-v1");
	assert.equal(evidence.mode, "shadow");
	assert.deepEqual(evidence.records.map((record) => [record.root, record.cleared, record.vision]).sort(),
		[["/claims/0", true, "supported"], ["/nodes/0", true, "supported"], ["/nodes/1", false, "supported"], ["/nodes/2", false, "supported"]]);
	assert.deepEqual(evidence.pages.map((page) => [page.page, page.text_sha256]), [[1, sha(TEXT[1])], [2, sha(TEXT[2])]]);
	const [asked] = claimRows(shadow.rows), [paired] = claimRows(shadow.rows, "claim_support_paired");
	assert.deepEqual([asked.mode, asked.mode_source, asked.eligible, asked.answered, asked.cleared, asked.skipped_paths], ["shadow", "data", 4, 4, 2, 0]);
	assert.deepEqual(asked.ineligible, { no_native_text: 1, region_ref: 1 });
	assert.deepEqual([paired.cleared_supported, paired.uncleared_supported, paired.jev_rows], [2, 2, 0]);
	assert.equal(baseline.rows.filter((row) => String(row.event).startsWith("claim_support")).length, 0);
});

test("§151.3 on: cleared records skip the vision reviewer, a unit left empty is not run, uncleared and contradicted records still go to vision, and Jev rows carry their evidence", async (t) => {
	const requests = installJev(t);
	const on = await verifyRound(t, { claimSupport: createClaimSupport({ env: { ...KEY, PI_COC_CLAIM_SUPPORT: "on" }, contentRoot: await contentRoot(t) }) });
	assert.equal(requests.length, 1);
	const given = on.assigned.flat();
	for (const path of ["/nodes/0", "/claims/0"]) assert.ok(!given.includes(path), `${path} was cleared and not sent to vision`);
	for (const path of ["/nodes/1", "/nodes/1/properties/age", "/nodes/2", "/nodes/3", "/claims/1", "/coverage"])
		assert.ok(given.includes(path), `${path} still goes to vision`);
	assert.equal(on.assigned.length, 3, "the page-1 unit held only cleared records and was not run");
	const jev = on.review.checked.filter((row) => row.reviewer === "jev");
	assert.deepEqual(jev.map((row) => row.paths).sort(), [["/claims/0"], ["/nodes/0"]]);
	for (const row of jev) {
		assert.equal(row.verdict, "supported");
		assert.deepEqual(row.source_refs, [{ page: 1 }]);
		assert.deepEqual(row.page_text_sha256, { 1: sha(TEXT[1]) });
		assert.equal(row.extraction_version, EXTRACTION);
		assert.deepEqual(row.distribution, { supported: 0.97, contradicted: 0.01 });
	}
	const evidence = JSON.parse(await readFile(join(on.cwd, "claim-support.json"), "utf8"));
	assert.equal(evidence.mode, "on");
	assert.deepEqual(JSON.parse(await readFile(join(on.cwd, "verify-1", "claim-support.json"), "utf8")), evidence, "the round keeps its own copy");
	const [asked, paired] = [claimRows(on.rows)[0], claimRows(on.rows, "claim_support_paired")[0]];
	assert.deepEqual([asked.mode, asked.mode_source, asked.cleared, asked.skipped_paths], ["on", "env", 2, 2]);
	assert.deepEqual([paired.jev_rows, paired.cleared_unreviewed, paired.overruled], [2, 2, 0]);
});

test("§151.3 on: a vision reviewer's negative verdict on a cleared record's path wins; that record gets no Jev row", async (t) => {
	installJev(t);
	const on = await verifyRound(t, { claimSupport: createClaimSupport({ env: { ...KEY, PI_COC_CLAIM_SUPPORT: "on" }, contentRoot: await contentRoot(t) }),
		extra: { paths: ["/nodes/0/summary"], verdict: "unsupported", source_refs: [{ page: 1 }], reason: "The page does not say tar." } });
	const jev = on.review.checked.filter((row) => row.reviewer === "jev");
	assert.deepEqual(jev.map((row) => row.paths), [["/claims/0"]]);
	const [paired] = claimRows(on.rows, "claim_support_paired");
	assert.equal(paired.overruled, 1);
});

test("§151.3 an outage equals off: every record goes to vision and no Jev row is written; with the switch off nothing is asked", async (t) => {
	const requests = installJev(t, { status: 503 });
	const down = await verifyRound(t, { claimSupport: createClaimSupport({ env: { ...KEY, PI_COC_CLAIM_SUPPORT: "on" }, contentRoot: await contentRoot(t) }) });
	assert.ok(requests.length >= 1, "Jev was asked");
	assert.equal(down.assigned.length, 4);
	assert.ok(down.assigned.flat().includes("/nodes/0"));
	assert.equal(down.review.checked.filter((row) => row.reviewer === "jev").length, 0);
	assert.equal(claimRows(down.rows)[0].status, "unanswered");
	const before = requests.length;
	const off = await verifyRound(t, { claimSupport: createClaimSupport({ env: { ...KEY, PI_COC_CLAIM_SUPPORT: "off" }, contentRoot: await contentRoot(t) }) });
	assert.equal(requests.length, before, "off asks nothing");
	assert.equal(off.assigned.length, 4);
	assert.equal(claimRows(off.rows).length, 0);
});
