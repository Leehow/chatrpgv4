/**
 * SL-57 (contract §22.3.3): a detail read refused at review for a fact its page does not state is read once more, in the
 * background, with the reviewer's reasons; refused again, the focus settles `unusable` and the Keeper is told once.
 *
 * Evidence: ticket 29, batches 6 and 7 (血色公路). The church steeple's and the arrival scene's own detail reads were refused
 * at review (`/claims/1/reason`, `/nodes/0/summary`) and stayed `failed` for the rest of each table; nobody re-read with
 * the reviewer's reasons, which were on disk.
 *
 * - The emitted kernel, in a campaign's fork: the refused read is re-queued once, background, with `review_retry` naming the
 *   refused fields and reasons and resuming the failed attempt; a foreground request does not promote it; its claim's packet
 *   carries the reasons; a second refusal settles the focus and queues nothing; the request answers `unusable`; a move into
 *   the settled scene still lands on its index text, and a check there passes; `retry: true` replaces the settlement; a
 *   refusal of another rule is not re-queued.
 * - The host: the reading service hands an `unusable` reply to its waiter; the scene-readings list carries an unusable
 *   settlement once, and not again for the same focus; the note's head says what it means.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { SceneReadings } from "../../extensions/kernel/scene-readings.ts";
import { CARRIED_RECORD_UNUSABLE_HEAD, carriedSection, readCarriedViews } from "../../runtime/jev/carried-views.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const PAGES = ["The harbor dock smells of tar.", "The old tower stands beyond the harbor. A stair winds up to a lamp room.", "Below the tower a cellar floods at high tide."];
const REFS = [{ page: 1 }];

/** A PDF whose pages carry native text (PDF.js reads it), one text line per page. */
function textPdf(lines) {
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${lines.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${lines.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [index, line] of lines.entries()) {
		const stream = `BT /F1 10 Tf 10 100 Td (${line}) Tj ET`;
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
			`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
	}
	let text = "%PDF-1.7\n";
	const offsets = [];
	for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(text), size = objects.length + 1;
	return text + `xref\n0 ${size}\n0000000000 65535 f \n${offsets.map((value) => String(value).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
function rpc(workspace, requests) {
	const input = requests.map(([method, params], index) => JSON.stringify({ id: String(index), method, params })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	return run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
}
function ok(workspace, requests) {
	const frames = rpc(workspace, requests);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
function read(workspace, job, draft, paths) {
	save(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3] });
	save(join(job.work_dir, "draft.json"), draft);
	save(join(job.work_dir, "review.json"), { checked: [{ paths, verdict: "supported", source_refs: REFS, reason: "fixture support" }], missing: [] });
	return ok(workspace, [["module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "completed",
		draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") }]])[0];
}


/** A read PDF whose opening published the Dock and knows the Tower (page 2) and the Cellar (page 3); a campaign on the Dock. */
function harbor(workspace) {
	const pdf = join(workspace, "original.pdf");
	writeFileSync(pdf, textPdf(PAGES));
	const [{ module_id: mid }] = ok(workspace, [["module.source.bind", { source: { path: pdf, page_count: PAGES.length,
		file_sha256: createHash("sha256").update(readFileSync(pdf)).digest("hex") } }]]);
	const claim = () => ok(workspace, [["module.read.claim", { module_id: mid, owner: "test-host" }]])[0];
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "index" }]]);
	read(workspace, claim(), { title: "The Harbor", language: "en", sections: [{ name: "Harbor and tower", pages: [[1, 3]], source_refs: [{ page: 1 }], entities: ["Dock", "Tower"] }] }, []);
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "opening" }]]);
	read(workspace, claim(), { nodes: [
		{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: REFS, properties: { is_entrance: true } },
		{ node_id: "scene-tower", node_kind: "scene", name: "Tower", source_refs: [{ page: 2 }], summary: "An old tower beyond the harbor." },
		{ node_id: "scene-cellar", node_kind: "scene", name: "Cellar", source_refs: [{ page: 3 }], summary: "A cellar somewhere below." }],
		claims: [["scene-dock", "route-to", "scene-tower"], ["scene-tower", "route-to", "scene-cellar"]].map(([subject_id, predicate, node_id]) =>
			({ subject_id, predicate, object: { node_id }, truth_status: "authored-fact", source_refs: REFS })),
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock"] },
		["/nodes/0", "/claims/0", "/claims/1", "/coverage"]);
	const [, saved] = ok(workspace, [["campaign.create", { id: "card-source", module: "the-haunting", pregen: "thomas-hayes", play_language: "en" }],
		["investigator.save", { campaign: "card-source" }]]);
	ok(workspace, [["campaign.create", { id: CAMPAIGN, module: mid, play_language: "en" }],
		["investigator.load", { campaign: CAMPAIGN, library_id: saved.library_id }], ["setup.complete", { campaign: CAMPAIGN }],
		["table.open", { campaign: CAMPAIGN }], ["table.narrate", { campaign: CAMPAIGN, call_id: "t0-c1", text: "The harbor is quiet." }]]);
	return mid;
}
const REFUSED = [{ path: "/nodes/0/summary", verdict: "unsupported", reason: "page 2 says the stair winds up to a lamp room, not a bell" },
	{ path: "/claims/0/reason", verdict: "unsupported", reason: "the page does not say the stair is the only way up" }];
const refusal = (rule = "review_unsupported") => ({ message: "visual review found /nodes/0/summary unsupported (unsupported): page 2 says a lamp room",
	path: "/nodes/0/summary", rule, reason: "reading_failed", refused: REFUSED });

test("§22.3.3 on the emitted kernel: a refused detail read is read once more in the background with the reasons, then settled", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "review-retry-kernel-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	const mid = harbor(workspace);
	const fork = join(workspace, ".coc/module-campaigns", CAMPAIGN, "modules", mid);
	const queue = () => JSON.parse(readFileSync(join(fork, "deepen-queue.json"), "utf8"));
	const meta = () => JSON.parse(readFileSync(join(fork, "module.json"), "utf8"));
	const at = { campaign: CAMPAIGN, module_id: mid };
	const claim = () => ok(workspace, [["module.read.claim", { ...at, owner: "test-host" }]])[0];
	const fail = (job, value) => ok(workspace, [["module.read.finish", { ...at, job_id: job.job_id, lease: job.lease, outcome: "failed", detail: "refused", refusal: value }]])[0];

	ok(workspace, [["module.read.request", { ...at, purpose: "detail", focus: "tower", foreground: true }]]);
	const first = claim();
	assert.equal(first.focus, "tower");
	const refused = fail(first, refusal());
	assert.equal(refused.state, "failed");
	assert.equal(refused.requeued?.reason, "review_refused");
	assert.equal(refused.requeued?.of, first.job_id);
	const retry = queue().find((job) => job.job_id === refused.requeued.job_id);
	assert.equal(retry.state, "queued");
	assert.equal(retry.foreground, false, "background, not blocking");
	assert.deepEqual(retry.review_retry.refused, REFUSED, "the refused fields and the reviewer's reasons");
	assert.equal(retry.resume_from, first.work_dir, "resuming the refused attempt's draft");
	assert.equal(retry.key, first.key, "the same reading identity");

	// A waiter follows it, and a foreground request does not promote it.
	const [followed] = ok(workspace, [["module.read.request", { ...at, purpose: "detail", focus: "tower", foreground: true }]]);
	assert.deepEqual([followed.state, followed.job_id], ["queued", retry.job_id]);
	assert.equal(queue().find((job) => job.job_id === retry.job_id).foreground, false, "never promoted");
	const second = claim();
	assert.equal(second.job_id, retry.job_id);
	assert.deepEqual(second.review_retry.refused, REFUSED, "the reader's packet carries the reasons");

	// Refused again: settled, and nothing more is queued.
	const again = fail(second, refusal());
	assert.equal(again.requeued, undefined, "read once more, not twice");
	assert.equal(queue().filter((job) => job.state === "queued").length, 0);
	const settled = meta().reading.materials.filter((row) => row.status === "unusable");
	assert.deepEqual(settled.map((row) => [row.focus, row.purpose, row.job_id, row.material]), [["tower", "detail", retry.job_id, undefined]]);
	assert.match(settled[0].reason, /lamp room/);
	const [answered] = ok(workspace, [["module.read.request", { ...at, purpose: "detail", focus: "tower", foreground: true }]]);
	assert.deepEqual([answered.state, answered.job_id], ["unusable", undefined]);
	assert.match(answered.reason, /lamp room/);

	// The scene still lands on its index text, and a check there passes; nothing is read for it.
	ok(workspace, [["table.open", { campaign: CAMPAIGN }], ["table.player_input", { campaign: CAMPAIGN, text: "I climb to the tower." }]]);
	const [move] = rpc(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t1-c1", effects: [{ kind: "move", to: "Tower" }] }]]);
	assert.deepEqual([move.error?.details?.reason, move.error?.details?.index?.pages], ["material_pending", [2, 1, 3]], "refused only to land on its pages");
	const [moved] = ok(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t1-c1", effects: [{ kind: "move", to: "Tower", _land_on_index: true }] }]]);
	assert.equal(moved.world.active_scene, "tower");
	const [checked] = rpc(workspace, [["table.resolve", { campaign: CAMPAIGN, call_id: "t1-c2", action: { intent: "investigate", goal: "look around",
		method: "look around the lamp room", skill: "Spot Hidden", decision: "core-check:ordinary-check" } }]]);
	assert.equal(checked.ok, true, JSON.stringify(checked.error));

	// Only an explicit retry replaces the settlement.
	const [fresh] = ok(workspace, [["module.read.request", { ...at, purpose: "detail", focus: "tower", retry: true }]]);
	assert.equal(fresh.state, "queued");
	assert.equal(meta().reading.materials.some((row) => row.status === "unusable"), false);

	// A refusal of another rule is not a fact the page does not state: no retry.
	ok(workspace, [["module.read.request", { ...at, purpose: "detail", focus: "cellar", foreground: true }]]);
	const cellar = claim();
	assert.equal(cellar.focus, "cellar");
	const other = fail(cellar, refusal("mechanics_unsourced"));
	assert.equal(other.requeued, undefined);
	assert.equal(queue().some((job) => job.focus === "cellar" && job.state === "queued"), false);
});

test("§22.3.3 the reading service hands an unusable settlement to its waiter instead of polling on", async (t) => {
	const calls = [];
	const service = new ReadingService({ home: tmpdir(), model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {}, async call(method, params) {
		calls.push({ method, params });
		if (method === "module.read.request") return { state: "unusable", generation: 3, reason: "refused twice at review" };
		if (method === "module.read.claim") return { job_id: null };
		throw new Error(method);
	} });
	t.after(() => service.close());
	const reply = await Promise.race([service.ensure("book", { purpose: "detail", focus: "tower", foreground: true }),
		new Promise((_, reject) => setTimeout(() => reject(new Error("the waiter kept polling")), 2_000))]);
	assert.deepEqual([reply.state, reply.reason], ["unusable", "refused twice at review"]);
	assert.equal(calls.filter((call) => call.method === "module.read.request").length, 1);
});

test("§22.3.3 the Keeper is told a settlement once, and not again for the same focus", async () => {
	const rows = [];
	const readings = new SceneReadings((row) => rows.push(row));
	const unusable = Promise.resolve({ state: "unusable", reason: "refused twice at review" });
	readings.register(CAMPAIGN, "tower", [{ page: 2, text: PAGES[1] }], 4, unusable);
	await new Promise((resolve) => setTimeout(resolve, 5));
	const first = readings.take(CAMPAIGN);
	assert.deepEqual(first.records, [{ scene: "tower", since_turn: 4, unusable: "refused twice at review" }]);
	assert.deepEqual(readings.take(CAMPAIGN).records, [], "carried once");
	// A later landing on the same settled focus says nothing more; another focus is told.
	readings.register(CAMPAIGN, "tower", [{ page: 2, text: PAGES[1] }], 6, unusable);
	readings.register(CAMPAIGN, "old-mae", [], 6, unusable, "Old Mae");
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.deepEqual(readings.take(CAMPAIGN).records, [{ scene: "old-mae", since_turn: 6, person: "Old Mae", unusable: "refused twice at review" }]);
	assert.deepEqual(rows.map((row) => row.event), ["scene_record_unusable", "scene_record_unusable", "person_record_unusable"]);
	// The note's head says what a settlement means.
	const carried = await readCarriedViews({ call: async () => { throw new Error("nothing is read"); }, people: [],
		sceneRecords: [{ scene: "tower", view: { status: "unusable", reason: "refused twice at review" } }] });
	assert.ok(carriedSection(carried).head.includes(CARRIED_RECORD_UNUSABLE_HEAD));
});

test("§22.3.3 the host: a refused detail read's refusal carries the reviewer's reasons, and a retry's reader is given them", async (t) => {
	const { mkdir, readFile, writeFile, appendFile } = await import("node:fs/promises");
	const { KernelError } = await import("../../extensions/kernel/client.ts");
	const { REVIEW_RETRY_ASK } = await import("../../extensions/module/reading-service.ts");
	const home = await mkdtemp(join(tmpdir(), "review-retry-host-")); t.after(() => rm(home, { recursive: true, force: true }));
	const cache = join(home, ".coc", "modules", "book", "cache", "pages");
	await mkdir(cache, { recursive: true });
	const draft = { nodes: [{ node_id: "scene-tower", node_kind: "scene", name: "Tower", summary: "A bell tower.", source_refs: [{ page: 1 }] }], claims: [],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-tower"] };
	const tasks = [];
	const runtime = { contentRoot: join(REPO, "content"), async check() { return { ok: true, required_view_pages: [1] }; },
		async runTask({ request }) {
			tasks.push({ ...request, task: JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8")) });
			const call = `view-${tasks.length}`, path = join(cache, "page-1.png");
			if (request.prompt.phase === "read") {
				await writeFile(join(request.cwd, "draft.json"), JSON.stringify(draft) + "\n");
				await appendFile(join(cache, "requests.jsonl"), JSON.stringify({ file_sha256: "source-sha", path, page: 1, box: [0, 0, 1, 1] }) + "\n");
			} else {
				const task = JSON.parse(await readFile(join(request.cwd, "task.json"), "utf8"));
				await writeFile(join(request.cwd, "review.json"), JSON.stringify({ checked: [{ paths: task.required_review ?? ["/nodes/0/summary"], verdict: "unsupported",
					source_refs: [{ page: 1 }], reason: "page 1 says a lamp room, not a bell" }], missing: [] }) + "\n");
			}
			request.onEvent({ type: "tool_execution_end", toolCallId: call, isError: false, result: { content: [{ type: "image" }], details: { kind: "source_pages", observations: [{ path, page: 1 }] } } });
			await writeFile(request.eventLog + ".images.jsonl", JSON.stringify({ included: [call] }) + "\n");
			return { ok: true, code: 0, timedOut: false, ms: 2, stderr: "", command: [] };
		} };
	const finishes = [], rows = [];
	const service = new ReadingService({ home, runtime, model: () => ({ id: "fixture/vision", vision: true, thinking: "off" }), progress() {}, record: (row) => rows.push(row),
		async call(method, params) {
			assert.equal(method, "module.read.finish");
			finishes.push(params);
			if (params.outcome === "completed") throw new KernelError({ code: "invalid_params", message: "visual review found /nodes/0/summary unsupported (unsupported): page 1 says a lamp room",
				details: { reason: "reading_failed", path: "/nodes/0/summary", rule: "review_unsupported", verdict: "unsupported" } });
			return { state: "failed", requeued: { job_id: "read-8", reason: "review_refused", of: params.job_id } };
		} });
	t.after(() => service.close());
	const job = (id, extra = {}) => ({ job_id: id, key: "tower-key", module_id: "book", purpose: "detail", focus: "tower", question: "", foreground: false, lease: `lease-${id}`,
		work_dir: join(home, "work", id, "attempt-1"), source: { path: join(home, ".coc", "modules", "book", "source.pdf"), page_count: 3, file_sha256: "source-sha" },
		index: [], known_nodes: [], known_claims: [], vocabulary: {}, coverage_domains: [], ...extra });
	const run = async (spec) => {
		await mkdir(spec.work_dir, { recursive: true });
		await writeFile(join(spec.work_dir, "packet.json"), JSON.stringify({ key: spec.key, source: { file_sha256: "source-sha" } }));
		const from = tasks.length;
		await service.runJob(spec, new AbortController().signal, "campaign-a");
		return tasks.slice(from);
	};
	await run(job("read-7"));
	const failed = finishes.filter((params) => params.outcome === "failed");
	assert.equal(failed.length, 1);
	assert.equal(failed[0].refusal.rule, "review_unsupported");
	assert.ok(failed[0].refusal.refused.some((row) => row.path && row.verdict === "unsupported" && row.reason === "page 1 says a lamp room, not a bell"),
		`the reviewer's refused fields and reasons travel with the refusal: ${JSON.stringify(failed[0].refusal)}`);
	assert.deepEqual(rows.filter((row) => row.event === "requeued").map((row) => [row.job_id, row.of, row.reason]), [["read-8", "read-7", "review_refused"]]);

	// The retry's reader gets the reasons in its task and is told what they are.
	const refused = [{ path: "/nodes/0/summary", verdict: "unsupported", reason: "page 1 says a lamp room, not a bell" }];
	const retried = await run(job("read-8", { review_retry: { of: "read-7", message: "refused", refused } }));
	const reader = retried.find((request) => request.prompt.phase === "read");
	assert.deepEqual(reader.task.review_retry, { refused, message: "refused" });
	assert.ok(reader.brief.includes(REVIEW_RETRY_ASK), "the read instruction names the refused fields");
});
