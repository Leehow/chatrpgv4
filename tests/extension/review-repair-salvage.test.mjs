/**
 * §151.2 (spec jev-decides-llm-writes D-B B1-B3, B6) at the reading service's job runner, with a fake runtime and a fake
 * kernel whose publication gate refuses exactly what the review refused.
 *
 * Evidence (Blood05, 2026-09-28): on pages 19-20 the review refused 3 of 29 claims (relations the page does not state)
 * and listed nothing missing; the job paid a 156 s full re-author and re-reviewed every unit. Pages 15-16 were authored
 * again after every interruption, because an interrupted author leaves a draft but no read checkpoint.
 *
 * - A refusal without `missing` repairs only the refused records, and the re-review reuses the units nobody touched.
 * - A repair that changes a record the review did not refuse is refused; the round's read runs again as today's full repair.
 * - A review with `missing` keeps today's full round.
 * - An interrupted attempt whose draft passes the checker, with every required page delivered, skips the author;
 *   one required page not delivered does not.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { KernelError } from "../../extensions/kernel/client.ts";
import { TARGETED_REPAIR_ASK, checkTargetedRepair, repairDecision } from "../../extensions/module/targeted-repair.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const SHA = "source-sha";

const node = (node_id, node_kind, page, extra = {}) => ({ node_id, node_kind, name: node_id, summary: `${node_id} as printed.`, source_refs: [{ page }],
	visibility: "keeper-only", properties: {}, ...extra });
const claim = (subject_id, predicate, target, page) => ({ subject_id, predicate, object: { node_id: target }, truth_status: "authorial",
	visibility: "keeper-only", source_refs: [{ page }] });
/** Two page groups: the dock (page 4) with a refused relation, and the tower (page 6) nobody disputes. */
function candidate() {
	return { nodes: [node("scene-dock", "scene", 4), node("npc-sailor", "npc", 4), node("location-tower", "location", 6), node("npc-keeper", "npc", 6)],
		claims: [claim("npc-sailor", "present-in", "scene-dock", 4), claim("npc-keeper", "located-in", "location-tower", 6)],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock", "npc-sailor", "location-tower", "npc-keeper"] };
}
const recordPages = draft => [...new Set([...draft.nodes, ...draft.claims].flatMap(row => row.source_refs.map(ref => ref.page)))].sort((a, b) => a - b);

/** A reader child that "views" `pages`: the event the runtime would emit, the page log and the successful delivery. */
async function deliver(request, cache, pages, call) {
	for (const page of pages)
		await appendFile(join(cache, "requests.jsonl"), JSON.stringify({ file_sha256: SHA, path: join(cache, `page-${page}.png`), page, box: [0, 0, 1, 1] }) + "\n");
	request.onEvent?.({ type: "tool_execution_end", toolCallId: call, isError: false,
		result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: pages.map(page => ({ path: join(cache, `page-${page}.png`), page })) } } });
	await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ delivery: "succeeded", included: [call] }) + "\n");
}

/**
 * `author(task, onDisk, pass)` returns the draft a read writes (pass counts every read run); `verdict(path, unit, reads)`
 * the reviewer's verdict for one assigned pointer and `missing(unit, reads)` the unit's missing list, given how many
 * reads have run (1 during the first round's review). `views(pass)` are pages the author views beyond its records'.
 * `plans` holds the review plan on disk as each read starts (the plan of the review that read repairs).
 */
async function runFixture(t, { author, verdict = () => "supported", missing = () => [], views = () => [], job: extra = {}, before } = {}) {
	const home = await mkdtemp(join(tmpdir(), "coc-review-repair-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const cwd = join(home, "work", "read-1", extra.attempt ?? "attempt-1"), cache = join(home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(cwd, { recursive: true });
	await mkdir(cache, { recursive: true });
	await before?.({ home, cwd, cache });
	const reads = [], units = [], rows = [], finishes = [], plans = [];
	let calls = 0;
	const runtime = {
		contentRoot: join(ROOT, "content"),
		async runTask({ request }) {
			calls++;
			const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
			if (request.prompt.phase === "read") {
				const onDisk = JSON.parse(await readFile(join(request.cwd, "draft.json"), "utf8").catch(() => "null"));
				reads.push({ task, brief: request.brief, onDisk, eventLog: request.eventLog });
				plans.push(await readFile(join(request.cwd, "review-plan.json"), "utf8").catch(() => null));
				const draft = author(task, onDisk, reads.length);
				await writeFile(join(request.cwd, "draft.json"), JSON.stringify(draft) + "\n");
				await deliver(request, cache, [...new Set([...recordPages(draft), ...views(reads.length)])], `read-${calls}`);
				return { ok: true, code: 0, timedOut: false, ms: 5, stderr: "", command: [] };
			}
			const draft = JSON.parse(await readFile(join(request.cwd, "draft.json"), "utf8"));
			const pages = task.review_scope_pages?.length ? task.review_scope_pages : recordPages(draft);
			units.push(task.required_review);
			await deliver(request, cache, pages, `review-${calls}`);
			await writeFile(join(request.cwd, "review.json"), JSON.stringify({ checked: task.required_review.map(path => ({ paths: [path],
				verdict: verdict(path, task.required_review, reads.length), source_refs: pages.map(page => ({ page })), reason: `fixture review of ${path}` })),
				missing: missing(task.required_review, reads.length) }) + "\n");
			return { ok: true, code: 0, timedOut: false, ms: 3, stderr: "", command: [] };
		},
		async check({ draft }) {
			const value = JSON.parse(await readFile(draft, "utf8"));
			return { ok: true, required_view_pages: recordPages(value) };
		},
		async sourceInfo() { throw new Error("not a guidance job"); },
	};
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }),
		progress() {}, record(row) { rows.push(row); },
		async call(method, params) {
			if (method !== "module.read.finish") return {};
			finishes.push(params);
			if (params.outcome !== "completed") return { state: params.outcome };
			// The publication gate: a non-supported row or a missing item refuses the reading.
			const review = JSON.parse(await readFile(params.review_path, "utf8"));
			if (review.missing.length) throw new KernelError({ code: "invalid_params", message: "the independent review found missing or incorrect material: " + JSON.stringify(review.missing),
				details: { reason: "reading_failed", path: "/review/missing" } });
			const refused = review.checked.find(row => row.verdict !== "supported");
			if (refused) throw new KernelError({ code: "invalid_params", message: `visual review found ${refused.paths[0]} unsupported (${refused.verdict}): ${refused.reason}`,
				details: { reason: "reading_failed", path: refused.paths[0], rule: "review_unsupported" } });
			return { state: "ready" };
		} });
	t.after(() => service.close());
	await service.runJob({ job_id: "read-1", key: "job-key", module_id: "book", purpose: "detail", focus: "Dock", question: "", foreground: false, lease: "lease-1",
		work_dir: cwd, source: { path: join(home, ".coc", "modules", "book", "source.pdf"), page_count: 8, file_sha256: SHA },
		index: {}, known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [], ...extra }, new AbortController().signal);
	return { cwd, reads, units, rows, finishes, plans, accounting: rows.filter(row => row.event === "job_accounting") };
}

const refuseSailorAtDock = path => path === "/claims/0" ? "unsupported" : "supported";
const withoutSailorClaim = () => { const draft = candidate(); draft.claims = [draft.claims[1]]; return draft; };

test("§151.2.2 a refusal without missing repairs only the refused record, and the re-review reuses the units nobody touched", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => pass === 1 ? candidate() : withoutSailorClaim(),
		// Round 1 refuses the sailor's relation; the re-review supports everything it is asked.
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailorAtDock(path) : "supported",
	});
	assert.equal(result.reads.length, 2, "one author, one targeted repair");
	const repair = result.reads[1].task.repair;
	assert.equal(repair.kind, "targeted");
	assert.deepEqual(repair.refused.map(row => row.path), ["/claims/0"], "the brief names only the refused path");
	assert.equal(repair.refused[0].verdict, "unsupported");
	assert.match(repair.refused[0].reason, /fixture review of \/claims\/0/);
	assert.deepEqual(repair.pages, [4], "the refused record's own page, not the whole candidate's");
	assert.ok(result.reads[1].brief.includes(TARGETED_REPAIR_ASK));
	assert.doesNotMatch(result.reads[1].brief, /Read findings\.json/);
	// Round 1 is one page-set unit and coverage (§187.8.1). Round 2 reviews coverage only: every surviving record is unchanged
	// and lost only a connected record, so each reuses its own verdict record by record.
	const second = result.units.slice(2).map(paths => paths.join(",")).sort();
	assert.deepEqual(second, ["/coverage"]);
	assert.ok(result.rows.some(row => row.phase === "verify" && row.round === 2 && row.reused === true));
	const review = JSON.parse(await readFile(join(result.cwd, "review.json"), "utf8"));
	const tower = review.checked.find(row => row.paths.includes("/claims/0"));
	assert.equal(tower.verdict, "supported", "the reused tower review answers for the keeper's claim at its new position");
	assert.equal(result.finishes.filter(call => call.outcome === "completed").length, 2);
	assert.equal(result.finishes.at(-1).outcome, "failed", "the finally replay after a publication is unchanged");
	const repairRow = result.rows.find(row => row.event === "repair");
	assert.deepEqual([repairRow.repair, repairRow.refused, repairRow.pages], ["targeted", ["/claims/0"], [4]]);
	// §151.2.4: the job's accounting row.
	assert.equal(result.accounting.length, 1);
	const [spent] = result.accounting;
	assert.equal(spent.repair, "targeted");
	assert.equal(spent.units_reused, 1);
	assert.equal(spent.units_run, 3, "two units in round 1, coverage in round 2");
	assert.equal(spent.author_ms, 10);
	assert.equal(spent.salvaged, false);
	assert.ok(spent.review_wall_ms >= 0);
	assert.deepEqual(spent.jev, {});
});

test("§151.2.2 a targeted repair that changes a record the review did not refuse is refused and the round reads in full", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => {
			if (pass === 1) return candidate();
			const draft = withoutSailorClaim();
			// The targeted pass also rewrites the tower, which the review supported.
			if (pass === 2) draft.nodes[2] = { ...draft.nodes[2], summary: "A tower rewritten for style." };
			return draft;
		},
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailorAtDock(path) : "supported",
	});
	assert.equal(result.reads.length, 3, "the author, the refused targeted pass, and today's full repair in the same round");
	assert.equal(result.reads[1].task.repair.kind, "targeted");
	const refusedRow = result.rows.find(row => row.event === "targeted_repair_refused");
	assert.ok(refusedRow, "the refusal is its own row");
	assert.deepEqual(refusedRow.changed, ["/nodes/2"]);
	assert.equal(refusedRow.round, 2);
	const full = result.reads[2];
	assert.equal(full.task.repair.kind, undefined, "the fallback is today's repair task");
	assert.match(full.brief, /Read findings\.json if present and address its concrete findings/);
	assert.deepEqual(full.onDisk, candidate(), "the full repair starts from the reviewed candidate, not the refused edit");
	assert.notEqual(full.eventLog, result.reads[1].eventLog, "each pass keeps its own delivery log");
	assert.equal(result.finishes.filter(call => call.outcome === "completed").length, 2, "the round bound is unchanged");
	assert.equal(result.accounting[0].repair, "full");
	assert.deepEqual(result.rows.filter(row => row.event === "repair").map(row => [row.repair, row.reason]), [["targeted", undefined], ["full", "targeted_refused"]]);
});

test("§151.2.2 a review that reports missing material keeps today's full round", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => pass === 1 ? candidate() : withoutSailorClaim(),
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailorAtDock(path) : "supported",
		missing: (unit, reads) => unit.includes("/coverage") && reads === 1 ? ["The harbor master's warning on page 4 is absent."] : [],
	});
	assert.equal(result.reads.length, 2);
	assert.equal(result.reads[1].task.repair.kind, undefined, "omissions need reading, not a record repair");
	assert.match(result.reads[1].brief, /Read findings\.json/);
	const row = result.rows.find(row => row.event === "repair");
	assert.deepEqual([row.repair, row.reason], ["full", "missing"]);
});

/** An interrupted attempt of the same job: its draft, its author's event log and delivery log, and no checkpoint. */
function interrupted(draft, viewed) {
	return async ({ home, cache }) => {
		const attempt = join(home, "work", "read-1", "attempt-1");
		await mkdir(attempt, { recursive: true });
		await writeFile(join(attempt, "packet.json"), JSON.stringify({ job_id: "read-1", key: "job-key", source: { file_sha256: SHA } }));
		await writeFile(join(attempt, "draft.json"), JSON.stringify(draft) + "\n");
		await writeFile(join(attempt, "findings.json"), JSON.stringify({ error: "internal: The runtime owner or operation is closed or cancelled", details: { reason: "runtime_closed" } }));
		await writeFile(join(attempt, "read-1.jsonl"), [
			JSON.stringify({ type: "tool_execution_start", toolCallId: "call-pdf", toolName: "pdf" }),
			JSON.stringify({ type: "tool_execution_end", toolCallId: "call-pdf", toolName: "pdf", isError: false,
				result: { content: [{ type: "text" }, { type: "image" }], details: { kind: "source_pages", observations: viewed.map(page => ({ page, box: [0, 0, 1, 1], path: join(cache, `page-${page}.png`) })) } } }),
		].join("\n") + "\n");
		await writeFile(join(attempt, "read-1.jsonl.images.jsonl"), [
			JSON.stringify({ delivery: "attempted", candidates: ["call-pdf"], bytes: 10, count: 1 }),
			JSON.stringify({ delivery: "succeeded", included: ["call-pdf"], host_pages: [], bytes: 10 }),
		].join("\n") + "\n");
	};
}

test("§151.2.3 an interrupted attempt whose draft passes the checker with every required page delivered skips the author", async t => {
	let home;
	const result = await runFixture(t, {
		before: async context => { home = context.home; await interrupted(candidate(), [4, 6])(context); },
		author: () => { throw new Error("the author must not run again"); },
		job: { attempt: "attempt-2", get resume_from() { return join(home, "work", "read-1", "attempt-1"); } },
	});
	assert.equal(result.reads.length, 0, "the salvaged draft goes straight to review");
	assert.ok(result.units.some(paths => paths.includes("/coverage")), "the coverage review guards an author stopped early");
	const checkpoint = JSON.parse(await readFile(join(result.cwd, "read-complete.json"), "utf8"));
	assert.equal(checkpoint.salvaged, true);
	assert.equal(checkpoint.job_id, "read-1");
	assert.deepEqual(checkpoint.observations.read_pages, [4, 6]);
	const row = result.rows.find(row => row.event === "salvaged");
	assert.deepEqual([row.pages, row.required], [[4, 6], [4, 6]]);
	assert.ok(result.finishes.some(call => call.outcome === "completed"));
	assert.equal(result.accounting[0].salvaged, true);
	assert.equal(result.accounting[0].author_ms, 0);
});

test("§151.2.3 one required page the interrupted author never received means the author reads again", async t => {
	let home;
	const result = await runFixture(t, {
		before: async context => { home = context.home; await interrupted(candidate(), [4])(context); },
		author: () => candidate(),
		job: { attempt: "attempt-2", get resume_from() { return join(home, "work", "read-1", "attempt-1"); } },
	});
	assert.equal(result.reads.length, 1, "the author runs");
	const row = result.rows.find(row => row.event === "salvage_refused");
	assert.deepEqual([row.reason, row.missing], ["pages", [6]]);
	assert.equal(result.rows.some(row => row.event === "salvaged"), false);
	assert.equal(JSON.parse(await readFile(join(result.cwd, "read-complete.json"), "utf8")).salvaged, undefined);
	assert.equal(result.accounting[0].salvaged, false);
	assert.ok(existsSync(join(result.cwd, "read-1.jsonl.images.jsonl")));
});

test("§151.2.2 the host check: a removed refused node takes its claims and ids with it, and kept pointers follow their records", () => {
	const reviewed = { nodes: [node("npc-ghost", "npc", 4), node("scene-dock", "scene", 4), node("npc-keeper", "npc", 6)],
		claims: [claim("npc-ghost", "present-in", "scene-dock", 4), claim("npc-keeper", "present-in", "scene-dock", 6)],
		node_refs: ["npc-ghost"], coverage: {}, dependencies: [], ready_nodes: ["npc-ghost", "scene-dock", "npc-keeper"],
		critical: ["/nodes/2/summary", "/claims/1", "/nodes/0/summary"] };
	// The review refused the ghost: the page names no such person. Its claim, ids and pointer go; the keeper moves up.
	const repaired = { ...reviewed, nodes: reviewed.nodes.slice(1), claims: [reviewed.claims[1]], node_refs: [], ready_nodes: ["scene-dock", "npc-keeper"],
		critical: ["/nodes/1/summary", "/claims/0"] };
	assert.deepEqual(checkTargetedRepair(reviewed, repaired, ["/nodes/0"]), { ok: true });
	assert.deepEqual(checkTargetedRepair(reviewed, { ...repaired, critical: ["/nodes/2/summary", "/claims/1"] }, ["/nodes/0"]),
		{ ok: false, paths: ["/critical"] }, "a pointer left at its old position now names another record");
	assert.deepEqual(checkTargetedRepair(reviewed, { ...repaired, claims: [] }, ["/nodes/0"]),
		{ ok: false, paths: ["/claims/1", "/critical"] }, "a claim of a kept node is not the refused node's to take (and its pointer dangles)");
	assert.deepEqual(checkTargetedRepair(reviewed, { ...repaired, ready_nodes: ["scene-dock"] }, ["/nodes/0"]), { ok: false, paths: ["/ready_nodes"] });
	assert.deepEqual(checkTargetedRepair(reviewed, { ...repaired, nodes: [...repaired.nodes, node("npc-stranger", "npc", 4)] }, ["/nodes/0"]),
		{ ok: false, paths: ["/nodes/2"] }, "a new person is not a correction of the refused one");
	assert.deepEqual(checkTargetedRepair(reviewed, { ...repaired, coverage: { actors: "prepared" } }, ["/nodes/0"]), { ok: false, paths: ["/coverage"] });
	// Corrected in place instead: the refused node keeps its id and its claim may stay.
	const corrected = { ...reviewed, nodes: [{ ...reviewed.nodes[0], summary: "Only a rumour of a ghost." }, ...reviewed.nodes.slice(1)] };
	assert.deepEqual(checkTargetedRepair(reviewed, corrected, ["/nodes/0"]), { ok: true });
});

test("§151.2.2 only what the publication gate would refuse is repaired; a contest or advisory finding is not a refusal", () => {
	const draft = candidate();
	const row = (path, verdict, extra = {}) => ({ paths: [path], verdict, source_refs: [{ page: 4 }], reason: "r", ...extra });
	const classification = { classification_fields: { node: ["properties/delivery_kind"] } };
	const contested = repairDecision(draft, { checked: [row("/nodes/0/properties/delivery_kind", "contested"), row("/claims/0", "unsupported")], missing: [] },
		{ vocabulary: classification });
	assert.deepEqual(contested.refused.map(entry => entry.path), ["/claims/0"]);
	const advisory = repairDecision(draft, { checked: [row("/nodes/1", "unsupported", { impact: "presentation" }), row("/claims/0", "unsupported", { impact: "logic" })], missing: [] },
		{ review_policy: "module-logic-v1" });
	assert.deepEqual(advisory.refused.map(entry => entry.path), ["/claims/0"]);
	assert.deepEqual(repairDecision(draft, { checked: [row("/coverage", "unsupported")], missing: [] }, {}), { kind: "full", reason: "not_a_record" });
	assert.deepEqual(repairDecision(draft, { checked: [row("/claims/0", "supported")], missing: [] }, {}), { kind: "full", reason: "no_refusal" });
	const unit = repairDecision(draft, { checked: [row("/claims/0", "unsupported")], missing: [] }, { source_unit: { first: 3, last: 4 }, pages: [3, 4] });
	assert.deepEqual(unit.pages, [3, 4], "a source unit's assigned pages, which the checker requires every read of the unit to view");
});

// ---------------------------------------------------------------------------------------------------
// §186.4: the coverage verdict is carried across a records-only targeted repair.
//
// Evidence (App home, 2026-10-02..10-06): the coverage unit is 31 % of review units and 40 % of review uncached tokens;
// 229 of 791 jobs ran it again in a later round, because its identity is the whole candidate and any repair changes it.
// ---------------------------------------------------------------------------------------------------

const refuseSailor = path => path === "/nodes/1" ? "unsupported" : "supported";
/** The refused sailor corrected in place: same node id, no record added or removed, nothing else touched. */
const sailorCorrected = () => { const draft = candidate(); draft.nodes[1] = { ...draft.nodes[1], summary: "A sailor, as page 4 prints him." }; return draft; };
const coverageRuns = result => result.units.filter(paths => paths.includes("/coverage")).length;
const carryRefusals = result => result.rows.filter(row => row.event === "coverage_carry_refused").map(row => row.reason);

test("§186.4 a records-only targeted repair carries the coverage verdict, and the gate's review holds it with its origin", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => pass === 1 ? candidate() : sailorCorrected(),
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailor(path) : "supported",
	});
	assert.equal(result.reads[1].task.repair.kind, "targeted");
	assert.equal(coverageRuns(result), 1, "the coverage reviewer ran in round 1 only");
	assert.deepEqual(result.units.slice(2), [["/nodes/0", "/nodes/1", "/claims/0"]],
		"round 2 runs only the corrected record and the records whose context holds it (§187.8.1: one page-set unit in round 1)");
	const carried = result.rows.find(row => row.phase === "verify" && row.round === 2 && row.carried_from);
	assert.ok(carried, "the carried unit has its verify row");
	assert.equal(carried.reused, true);
	const roundOnePlan = result.plans[1];
	assert.ok(roundOnePlan, "the round-1 plan was on disk when the repair read began");
	assert.deepEqual(carried.carried_from, { round: 1, plan_digest: createHash("sha256").update(roundOnePlan).digest("hex") });
	assert.deepEqual(carried.pages, [4, 6], "the pages the round-1 coverage reviewer viewed");
	// The review the gate reads: the round-1 coverage row, as written, with its origin.
	const finish = result.finishes.filter(call => call.outcome === "completed").at(-1);
	const review = JSON.parse(await readFile(finish.review_path, "utf8"));
	const coverage = review.checked.filter(row => row.paths.includes("/coverage"));
	assert.equal(coverage.length, 1);
	assert.deepEqual(coverage[0], { paths: ["/coverage"], verdict: "supported", source_refs: [{ page: 4 }, { page: 6 }], reason: "fixture review of /coverage",
		carried_from: carried.carried_from });
	assert.deepEqual(review.missing, []);
	const observations = JSON.parse(await readFile(join(result.cwd, "observations.json"), "utf8"));
	assert.deepEqual([...observations.review_pages].sort((a, b) => a - b), [4, 6], "the carried pages are evidence the gate reads");
	// The round-2 plan records the carried unit like any other, so a later round can carry it again.
	const plan = JSON.parse(await readFile(join(result.cwd, "review-plan.json"), "utf8"));
	assert.equal(plan.round, 2);
	const unit = plan.units.find(entry => entry.paths.includes("/coverage"));
	assert.deepEqual([unit.checked, unit.missing, unit.pages, typeof unit.scope], [1, 0, [4, 6], "string"]);
	assert.deepEqual(carryRefusals(result), []);
	const [spent] = result.accounting;
	assert.deepEqual([spent.units_run, spent.units_reused], [3, 1], "two units in round 1; in round 2 one runs (the tower's record reused inside it) and coverage is carried");
});

test("§186.4 a targeted repair the host refused is followed by a full read: coverage runs even when that read only corrects the refused record", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => {
			if (pass === 1) return candidate();
			const draft = sailorCorrected();
			if (pass === 2) draft.nodes[2] = { ...draft.nodes[2], summary: "A tower rewritten for style." };
			return draft;
		},
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailor(path) : "supported",
	});
	assert.equal(result.reads.length, 3, "the author, the refused targeted pass and the full read");
	assert.ok(result.rows.some(row => row.event === "targeted_repair_refused"));
	assert.equal(coverageRuns(result), 2, "a full repair is not a targeted repair the host accepted");
	assert.equal(result.rows.some(row => row.carried_from), false);
});

test("§186.4 a targeted repair that deletes the refused record runs coverage", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => pass === 1 ? candidate() : withoutSailorClaim(),
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailorAtDock(path) : "supported",
	});
	assert.equal(result.reads[1].task.repair.kind, "targeted");
	assert.equal(result.rows.some(row => row.event === "targeted_repair_refused"), false, "the host accepted the repair");
	assert.equal(coverageRuns(result), 2);
	assert.deepEqual(carryRefusals(result), ["records"]);
});

test("§186.4 a targeted repair that replaces the refused relation with another adds a record: coverage runs", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => {
			const draft = candidate();
			if (pass > 1) draft.claims[0] = { ...draft.claims[0], predicate: "works-at" };
			return draft;
		},
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailorAtDock(path) : "supported",
	});
	assert.equal(result.rows.some(row => row.event === "targeted_repair_refused"), false, "one replacement for one refused record");
	assert.equal(coverageRuns(result), 2);
	assert.deepEqual(carryRefusals(result), ["records"]);
});

test("§186.4 a targeted repair whose author viewed another page changes the review scope: coverage runs", async t => {
	const result = await runFixture(t, {
		author: (_task, _onDisk, pass) => pass === 1 ? candidate() : sailorCorrected(),
		verdict: (path, _unit, reads) => reads === 1 ? refuseSailor(path) : "supported",
		views: pass => pass === 2 ? [5] : [],
	});
	assert.equal(result.rows.some(row => row.event === "targeted_repair_refused"), false);
	assert.equal(coverageRuns(result), 2);
	assert.deepEqual(carryRefusals(result), ["scope"], "the scope is compared before the carried reviewer's pages are");
});
