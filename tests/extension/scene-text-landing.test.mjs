/**
 * SL-47 (contract §22.4.7): a move into a scene not yet read lands on the book's text; the scene's record lands when read.
 *
 * Evidence: SL-45's replay of the batch-4 table's t18 (SL-29 book A) -- with the lease sized and the slot given at once, the
 * bar's detail read plus its review still took 98-118 s against the 120 s foreground wait and the move was refused
 * `reading_timeout`; the bar's native text was on its pages all along.
 *
 * - The emitted kernel, over a read PDF whose Tower is known but unread: the move refuses `material_pending` naming the
 *   Tower's index pages and the move's effect; sent again with `_land_on_index` it lands, the receipt says `index`, the
 *   world keeps the Tower in `index_scenes`, and a check there passes the gate; a scene with no index pages is refused even
 *   when flagged, and names no pages.
 * - The extension seam (hybrid-v1, faux Keeper, the emitted kernel, a stub reading bridge): the move lands in one call; the
 *   next step's note carries the pages once and a pending row naming the scene; the scene's reading was queued blocking
 *   with no waiter; once it lands, the next turn's first step carries the scene's record once. With no native text on
 *   the pages, the move keeps the foreground wait.
 * - The reading service over the emitted kernel and a real PDF: `sourcePages` is the document's own native text, and a
 *   blocking ensure is not demoted when its waiter leaves.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { CARRIED_PENDING_SCENE_HEAD, CARRIED_SCENE_TEXT_HEAD, CARRIED_SCENE_RECORD_HEAD, SCENE_TEXT_VIEW_BYTES, readCarriedViews } from "../../runtime/jev/carried-views.ts";
import { createRuntime } from "../../runtime/host.ts";
import { ReadingService } from "../../extensions/module/reading-service.ts";

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
function read(workspace, job, draft, paths, extra = {}) {
	save(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3] });
	save(join(job.work_dir, "draft.json"), draft);
	save(join(job.work_dir, "review.json"), { checked: [{ paths, verdict: "supported", source_refs: REFS, reason: "fixture support" }], missing: [] });
	return ok(workspace, [["module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "completed",
		draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json"), ...extra }]])[0];
}

/**
 * A read PDF: its index names the Dock, the Tower and a Lighthouse; the opening read published the Dock (ready) and knows the
 * Tower (its own page 2) and the Cellar (page 3) without reading them; the Lighthouse is in the index and in no graph node,
 * so nothing names its pages. A campaign stands on the Dock at turn 1.
 */
function harbor(workspace) {
	const pdf = join(workspace, "original.pdf");
	writeFileSync(pdf, textPdf(PAGES));
	const [{ module_id: mid }] = ok(workspace, [["module.source.bind", { source: { path: pdf, page_count: PAGES.length,
		file_sha256: createHash("sha256").update(readFileSync(pdf)).digest("hex") } }]]);
	const claim = (campaign) => ok(workspace, [["module.read.claim", { module_id: mid, owner: "test-host", ...(campaign ? { campaign } : {}) }]])[0];
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "index" }]]);
	read(workspace, claim(), { title: "The Harbor", language: "en", sections: [{ name: "Harbor and tower", pages: [[1, 3]], source_refs: [{ page: 1 }], entities: ["Dock", "Tower", "Lighthouse"] }] }, []);
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
const world = (workspace) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8"));
const turnRecord = (workspace, turn) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));

test("§22.4.7 on the emitted kernel: a move into an unread scene with index pages refuses naming them, lands on them when asked, and the place passes the gate", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "scene-text-kernel-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	harbor(workspace);
	ok(workspace, [["table.open", { campaign: CAMPAIGN }], ["table.player_input", { campaign: CAMPAIGN, text: "I climb to the tower." }]]);
	const [refused] = rpc(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t1-c1", effects: [{ kind: "time", minutes: 1 }, { kind: "move", to: "Tower" }] }]]);
	assert.equal(refused.ok, false);
	assert.equal(refused.error.details.reason, "material_pending");
	assert.deepEqual(refused.error.details.read, { purpose: "detail", focus: "tower" });
	assert.deepEqual(refused.error.details.index, { pages: [2, 1, 3] }, "the scene's own page first, then the index row's, at most three");
	assert.equal(refused.error.details.effect, 1, "the move's index in the batch");
	const [moved] = ok(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t1-c1", effects: [{ kind: "time", minutes: 1 }, { kind: "move", to: "Tower", _land_on_index: true }] }]]);
	assert.equal(moved.world.active_scene, "tower", "the move landed on the book's text");
	assert.deepEqual(moved.scene_text, [{ scene: "tower", pages: [2, 1, 3] }]);
	assert.deepEqual(world(workspace).index_scenes, ["tower"]);
	// The same place passes the material gate of a check there while its record is being read.
	const [checked] = rpc(workspace, [["table.resolve", { campaign: CAMPAIGN, call_id: "t1-c2", action: { intent: "investigate", goal: "look around",
		method: "look around the lamp room", skill: "Spot Hidden", decision: "core-check:ordinary-check" } }]]);
	assert.notEqual(checked.error?.details?.reason, "material_pending", `the Tower is not held: ${JSON.stringify(checked.error)}`);
	ok(workspace, [["table.narrate", { campaign: CAMPAIGN, call_id: "t1-c3", text: "The stair winds up." }]]);
	const receipt = turnRecord(workspace, 1).receipts.find((row) => row.kind === "move");
	assert.equal(receipt.material, "index");
	// A place the index names but no graph node does has no pages of its own: refused even when the host asks, naming none.
	ok(workspace, [["table.player_input", { campaign: CAMPAIGN, text: "I walk to the lighthouse." }]]);
	const [lighthouse] = rpc(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t2-c1", effects: [{ kind: "move", to: "Lighthouse", via: "along the breakwater", _land_on_index: true }] }]]);
	assert.equal(lighthouse.ok, false);
	assert.equal(lighthouse.error.details.reason, "material_pending");
	assert.equal(lighthouse.error.details.index, undefined);
	// The Cellar, known on its own page and never read, would land on it only when the host asks.
	const [cellar] = rpc(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t2-c2", effects: [{ kind: "move", to: "Cellar" }] }]]);
	assert.deepEqual(cellar.error.details.index, { pages: [3] });
	assert.equal(world(workspace).active_scene, "tower");
});

const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});
function distinctNotes(requests) {
	const seen = new Set(), out = [];
	for (const [index, context] of requests.entries()) for (const note of clerkNotes(context)) {
		const key = JSON.stringify(note);
		if (!seen.has(key)) { seen.add(key); out.push({ request: index, note }); }
	}
	return out;
}
const views = (requests, focus) => distinctNotes(requests).flatMap(({ request, note }) => (note.carried?.views ?? []).filter((view) => view.focus === focus).map((view) => ({ request, view })));

async function seam(t, { pageTexts, responses }) {
	const engine = createHybridEngine({ env: process.env, decision: null });
	const requests = [];
	const table = await openTable({ realKernel: true, seedCampaign: false, prepareWorkspace: harbor,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", PI_COC_READ_WAIT_MS: "200" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: responses.map((response) => (context) => { requests.push(context); return response; }) });
	t.after(() => table.dispose());
	let land;
	const settled = new Promise((resolve) => { land = resolve; });
	const ensures = [], extractions = [];
	table.emit("coc:reading-bridge", {
		async ensure(_mid, params, _signal, options) {
			ensures.push({ params, options });
			if (options?.blocking) return { state: "pending", job_id: "read-9", read: { purpose: "detail", focus: params.focus, question: "" }, index: [], settled };
			throw Object.assign(new Error("the source is still being read"), { code: "needs", details: { reason: "reading_timeout", read: { purpose: "detail", focus: params.focus } } });
		},
		reading() { return false; },
		async sourcePages(_mid, pages) { extractions.push(pages); return pages.map((page) => ({ page, text: pageTexts[page - 1] ?? "" })); },
	});
	return { table, requests, ensures, extractions, land };
}
const move = (to) => fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to }] })], { stopReason: "toolUse" });
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });

test("§22.4.7 at the seam: the move lands on the book's text in one call, the note carries the pages once and the pending scene, and the record lands on the next turn once", async (t) => {
	const { table, requests, ensures, extractions, land } = await seam(t, { pageTexts: PAGES,
		responses: [move("Tower"), narrate("You climb the winding stair."), narrate("The lamp room is cold."), narrate("You wait by the lamp.")] });
	await table.session.prompt("I climb to the tower.");

	assert.deepEqual(extractions, [[2, 1, 3]], "the index pages the kernel named, read once");
	const kernelMoves = table.telemetry(CAMPAIGN).filter((row) => row.tool === "apply");
	assert.deepEqual(kernelMoves.map((row) => row.ok), [true], "the Keeper's one apply landed");
	assert.equal(ensures.length, 1, "no foreground wait: the scene's reading was queued once");
	assert.deepEqual([ensures[0].params.focus, ensures[0].params.foreground, ensures[0].options.allowanceMs, ensures[0].options.blocking], ["tower", true, 0, true],
		"blocking, with no waiter");
	const result = table.session.messages.find((message) => message.role === "toolResult" && message.toolName === "apply");
	const body = JSON.parse(result.content.map((block) => block.text ?? "").join(""));
	assert.equal(body.world.active_scene, "tower");
	assert.deepEqual(body.scene_text.map((entry) => [entry.scene, entry.pages, entry.text]), [["tower", [2, 1, 3], undefined]],
		"on the hybrid engine the pages ride the note, not the result");
	const texts = views(requests, "scene_text");
	assert.equal(texts.length, 1, `the pages are carried once: ${JSON.stringify(texts)}`);
	assert.equal(texts[0].request, 1, "on the step after the move");
	assert.deepEqual(Object.values(texts[0].view.view), [PAGES[1], PAGES[0], PAGES[2]]);
	const note = clerkNotes(requests[1]).at(-1);
	assert.ok(note.carried.head.includes(CARRIED_SCENE_TEXT_HEAD));
	assert.deepEqual(note.carried.pending.map((row) => [row.focus, row.scene, row.purpose]), [["tower", "tower", "detail"]], "the pending row names the scene");
	assert.ok(note.carried.head.includes(CARRIED_PENDING_SCENE_HEAD));
	assert.equal(turnRecord(table.workspace, 1).closed_by, "narrate");

	land({ state: "ready", generation: 3 });
	await new Promise((resolve) => setTimeout(resolve, 20));
	await table.session.prompt("I look at the lamp.");
	const records = distinctNotes(requests).filter(({ note }) => note.carried?.head?.includes(CARRIED_SCENE_RECORD_HEAD));
	assert.equal(records.length, 1, "the record is carried once");
	assert.equal(records[0].request, 2, "on the next turn's first model step");
	assert.ok(records[0].note.carried.views.some((view) => view.focus === "scene" && view.name === "tower"), "the scene's own view: the party is there");
	assert.equal(views(requests, "scene_text").length, 1, "the pages are not carried again");
	const rows = table.telemetry(CAMPAIGN).filter((row) => row.lane === "reading" && String(row.event).startsWith("scene_"));
	assert.deepEqual(rows.map((row) => row.event), ["scene_text", "scene_record_landed"]);
	await table.session.prompt("I wait.");
	assert.equal(requests.length, 4);
	// A turn's request holds only its own run's notes (§135.23), so the third turn's request is read on its own.
	assert.ok(!clerkNotes(requests[3]).some((note) => note.carried?.head?.includes(CARRIED_SCENE_RECORD_HEAD)), "and never again");
});

test("§22.4.7 at the seam: pages with no native text keep the foreground wait", async (t) => {
	const { table, ensures, extractions } = await seam(t, { pageTexts: ["", " ", ""],
		responses: [move("Tower"), narrate("The stair is dark."), narrate("You wait.")] });
	await table.session.prompt("I climb to the tower.");
	assert.deepEqual(extractions, [[2, 1, 3]]);
	assert.equal(ensures.length >= 1, true);
	assert.ok(ensures.every((entry) => !entry.options?.blocking), "the wait of §22.4, not a landing");
	assert.equal(JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8")).active_scene, "dock", "the move did not land");
});

test("§22.4.7 the reading service reads a real document's pages, and a blocking ensure keeps its class when its waiter leaves", async (t) => {
	const home = await mkdtemp(join(tmpdir(), "scene-text-service-"));
	const owner = createRuntime({ owner: "preparation", home }, { resourceRoot: REPO, nodeExecutable: process.execPath });
	t.after(async () => { await owner.close(); await rm(home, { recursive: true, force: true }); });
	const client = owner.openKernel(), pdf = join(home, "book.pdf");
	await writeFile(pdf, textPdf(PAGES));
	const { module_id } = await client.call("module.source.bind", { source: { path: pdf, page_count: PAGES.length, file_sha256: createHash("sha256").update(readFileSync(pdf)).digest("hex") } });
	const service = new ReadingService({ home, runtime: owner, call: (method, params) => client.call(method, params), model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {} });
	t.after(() => service.close());
	const pages = await service.sourcePages(module_id, [2, 3]);
	assert.deepEqual(pages.map((page) => [page.page, page.text.trim()]), [[2, PAGES[1]], [3, PAGES[2]]]);

	const calls = [];
	const stub = new ReadingService({ home, model: () => ({ id: "fixture/vision", vision: true }), progress() {}, record() {}, async call(method, params) {
		calls.push({ method, params });
		if (method === "module.read.request") return { state: "reading", job_id: "read-7", generation: 1 };
		if (method === "module.read.claim") return { job_id: null };
		if (method === "module.read.unwait") return { job_id: params.job_id, foreground: false };
		throw new Error(method);
	} });
	t.after(() => stub.close());
	const reply = await stub.ensure("book", { purpose: "detail", focus: "tower", foreground: true }, undefined, { allowanceMs: 0, blocking: true });
	assert.equal(reply.state, "pending");
	await new Promise((resolve) => setTimeout(resolve, 700));
	assert.equal(calls.some((call) => call.method === "module.read.unwait"), false, "never demoted: the party stands in the scene");
	const polls = calls.filter((call) => call.method === "module.read.request");
	assert.ok(polls.length >= 2 && polls.every((call) => call.params.foreground === true), "every poll keeps it blocking");
});

test("§22.4.7 a scene's text is carried under its own ceiling: a whole book page survives, the next is cut and marked", async () => {
  const page = (letter) => letter.repeat(5_000);
  const carried = await readCarriedViews({ call: async () => { throw new Error("nothing is read for a scene's text"); }, people: [],
    sceneTexts: [{ scene: "bar", pages: [{ page: 29, text: page("a") }, { page: 30, text: page("b") }] }] });
  const [view] = carried.views;
  assert.equal(view.focus, "scene_text");
  assert.equal(view.view["page 29"], page("a"), "the first page whole, beyond the 4 KiB of an ordinary view");
  assert.equal(view.truncated, true);
  assert.deepEqual(view.omitted_fields, ["page 30"], "the page that does not fit is dropped whole and named");
  assert.ok(Buffer.byteLength(JSON.stringify(view.view)) <= SCENE_TEXT_VIEW_BYTES);
  assert.equal(carried.reads, 0);
});
