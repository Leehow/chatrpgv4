/**
 * SL-56 (contract §22.4.7.1): a check or write on a person not yet read lands on the book's text; the record lands when read.
 *
 * Evidence: the batch-7 血色公路 table (ticket 29), t10 and t11. The Keeper placed a man the book had not yet named
 * (`apply npc`, established `table`) and checked him; the `resolve` was refused `material_pending` for a detail read of the
 * Keeper's own appellation and waited 124.5 s, then 131.4 s on the same job, which was still running at table end.
 *
 * - The emitted kernel, over a read PDF: a table person is not held (t10's shape); a book person not yet read is refused
 *   naming the person and their index pages, lands when the host asks, joins `index_people`, and a second check passes
 *   without landing; an index-only person lands only on a passage whose sentence holds the name, and is then registered
 *   `from_passage`.
 * - The extension seam (hybrid-v1, faux Keeper, the emitted kernel, a stub reading bridge over page texts): the check lands in
 *   one call, the next step's note carries the page text once and a pending row naming the person, and after the read lands
 *   the next turn's first step carries the record once; a person whose name the text nowhere holds keeps the wait.
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
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";
import { CARRIED_PENDING_PERSON_HEAD, CARRIED_PERSON_RECORD_HEAD, CARRIED_PERSON_TEXT_HEAD } from "../../runtime/jev/carried-views.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const PAGES = ["The harbor dock smells of tar. Old Mae mends nets by the water.",
	"The old tower stands beyond the harbor. Its keeper, Silas Marsh, trims the lamp.",
	"Below the tower a cellar floods at high tide."];
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

/**
 * A read PDF: its index names the Dock, the Tower, Silas Marsh and a Harbormaster; the opening read published the Dock
 * (ready) and knows Old Mae (an npc on page 1) without reading her. Silas Marsh and the Harbormaster are in the index and
 * in no graph node; page 2 names Silas Marsh, and no page names a harbormaster. A campaign stands on the Dock at turn 1.
 */
function harbor(workspace) {
	const pdf = join(workspace, "original.pdf");
	writeFileSync(pdf, textPdf(PAGES));
	const [{ module_id: mid }] = ok(workspace, [["module.source.bind", { source: { path: pdf, page_count: PAGES.length,
		file_sha256: createHash("sha256").update(readFileSync(pdf)).digest("hex") } }]]);
	const claim = () => ok(workspace, [["module.read.claim", { module_id: mid, owner: "test-host" }]])[0];
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "index" }]]);
	read(workspace, claim(), { title: "The Harbor", language: "en", sections: [{ name: "Harbor and tower", pages: [[1, 3]], source_refs: [{ page: 1 }],
		entities: ["Dock", "Tower", "Silas Marsh", "Harbormaster"] }] }, []);
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "opening" }]]);
	read(workspace, claim(), { nodes: [
		{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: REFS, properties: { is_entrance: true } },
		{ node_id: "scene-tower", node_kind: "scene", name: "Tower", source_refs: [{ page: 2 }], summary: "An old tower beyond the harbor." },
		{ node_id: "npc-old-mae", node_kind: "npc", name: "Old Mae", source_refs: REFS, summary: "A net mender on the dock." }],
		claims: [{ subject_id: "scene-dock", predicate: "route-to", object: { node_id: "scene-tower" }, truth_status: "authored-fact", source_refs: REFS }],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock"] },
		["/nodes/0", "/claims/0", "/coverage"]);
	const [, saved] = ok(workspace, [["campaign.create", { id: "card-source", module: "the-haunting", pregen: "thomas-hayes", play_language: "en" }],
		["investigator.save", { campaign: "card-source" }]]);
	ok(workspace, [["campaign.create", { id: CAMPAIGN, module: mid, play_language: "en" }],
		["investigator.load", { campaign: CAMPAIGN, library_id: saved.library_id }], ["setup.complete", { campaign: CAMPAIGN }],
		["table.open", { campaign: CAMPAIGN }], ["table.narrate", { campaign: CAMPAIGN, call_id: "t0-c1", text: "The harbor is quiet." }]]);
	return mid;
}
const world = (workspace) => JSON.parse(readFileSync(join(workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8"));
const check = (target, call_id, extra = {}) => ["table.resolve", { campaign: CAMPAIGN, call_id, ...extra, action: { intent: "investigate", goal: "size them up",
	method: "watch them for a while", skill: "Spot Hidden", decision: "core-check:ordinary-check", target } }];

const place = (name, call_id, extra = {}, declared = {}) => ["table.apply", { campaign: CAMPAIGN, call_id, ...extra, effects: [{ kind: "npc", name, to: "here", ...declared, why: "the page puts them here" }] }];

test("§22.4.7.1 on the emitted kernel: a table person is not held; a book person lands on the text the host found, once", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "person-text-kernel-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	harbor(workspace);
	ok(workspace, [["table.open", { campaign: CAMPAIGN }], ["table.player_input", { campaign: CAMPAIGN, text: "I watch the man at the end of the bench." }]]);

	// t10's shape: a man the book has not named, established by the table, then checked. Nothing is read for him.
	ok(workspace, [place("the man at the far end", "t1-c1", {}, { walk_on: true })]);
	const [tablePerson] = rpc(workspace, [check("the man at the far end", "t1-c2")]);
	assert.equal(tablePerson.ok, true, `a table person is not book material: ${JSON.stringify(tablePerson.error)}`);

	// A book person not yet read: a check and a write are refused naming the person and their index pages.
	const [refused] = rpc(workspace, [check("Old Mae", "t1-c3")]);
	assert.equal(refused.ok, false);
	assert.equal(refused.error.details.reason, "material_pending");
	assert.deepEqual(refused.error.details.read, { purpose: "detail", focus: "old-mae" });
	assert.deepEqual(refused.error.details.person, { key: "Old Mae", name: "Old Mae", names: ["Old Mae"], book: true });
	assert.deepEqual(refused.error.details.index, { pages: [1] }, "her own page");
	const [write] = rpc(workspace, [place("Old Mae", "t1-c4")]);
	assert.deepEqual([write.error.details.reason, write.error.details.person.book, write.error.details.index.pages], ["material_pending", true, [1]]);
	// The host asks on the check: she lands on her page at the gate (written before any roll), and the world keeps her among
	// the people played on the book's text; the check itself then meets the scene (she has not been placed here yet).
	const [landed] = rpc(workspace, [check("Old Mae", "t1-c3", { _land_on_text: [{ key: refused.error.details.person.key }] })]);
	assert.notEqual(landed.error?.details?.reason, "material_pending", JSON.stringify(landed.error));
	assert.deepEqual(world(workspace).index_people, ["old-mae"]);
	// From then on a write and a check pass without landing.
	const [placed] = ok(workspace, [place("Old Mae", "t1-c4")]);
	assert.equal(placed.person_text, undefined, "nothing landed again");
	const [again] = rpc(workspace, [check("Old Mae", "t1-c5")]);
	assert.equal(again.ok, true, `a check on her passes: ${JSON.stringify(again.error)}`);

	// An index-only person: refused naming the index row's pages; the host's ask alone is not enough, nor a sentence that does
	// not hold the name; a passage that names him lands him and registers him from it.
	const [silas] = rpc(workspace, [check("Silas Marsh", "t1-c6")]);
	assert.deepEqual([silas.error.details.reason, silas.error.details.person.book, silas.error.details.index.pages], ["material_pending", false, [1, 2, 3]]);
	const [bare] = rpc(workspace, [place("Silas Marsh", "t1-c7", { _land_on_text: [{ key: "Silas Marsh" }] })]);
	assert.equal(bare.error?.details?.reason, "material_pending", "an index-only name needs a sentence that holds it");
	const [elsewhere] = rpc(workspace, [place("Silas Marsh", "t1-c7", { _land_on_text: [{ key: "Silas Marsh", passage: { page: 3, sentence: PAGES[2] } }] })]);
	assert.equal(elsewhere.error?.details?.reason, "material_pending", "a sentence that does not hold the name is no passage");
	const passage = { scene: null, page: 2, label: null, sentence: "Its keeper, Silas Marsh, trims the lamp." };
	const [named] = ok(workspace, [place("Silas Marsh", "t1-c7", { _land_on_text: [{ key: "Silas Marsh", passage }] })]);
	assert.equal(named.receipts.length, 1);
	assert.deepEqual(named.person_text, [{ person: "Silas Marsh", focus: "Silas Marsh", pages: [1, 2, 3], passage }]);
	const entry = world(workspace).table_people.find((row) => row.name === "Silas Marsh");
	assert.deepEqual(entry?.from_passage, passage, "registered provisionally from the passage (§11.5.4)");
	assert.deepEqual(world(workspace).index_people, ["old-mae", "Silas Marsh"]);
	const [checked] = rpc(workspace, [check("Silas Marsh", "t1-c8")]);
	assert.equal(checked.ok, true, `and a check on him passes: ${JSON.stringify(checked.error)}`);
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

async function seam(t, { responses }) {
	const engine = createHybridEngine({ env: process.env, decision: null });
	const requests = [];
	const table = await openTable({ realKernel: true, seedCampaign: false, prepareWorkspace: harbor,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", PI_COC_READ_WAIT_MS: "200" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
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
		async sourcePages(_mid, pages) { extractions.push(pages); return pages.map((page) => ({ page, text: PAGES[page - 1] ?? "" })); },
	});
	return { table, requests, ensures, extractions, land };
}
const placeOn = (name) => fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "npc", name, to: "here", why: "he comes down from the tower" }] })], { stopReason: "toolUse" });
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });

test("§22.4.7.1 at the seam: the write lands on the book's text in one call, the note carries it once with a pending row naming the person, and the record lands once", async (t) => {
	const { table, requests, ensures, extractions, land } = await seam(t, {
		responses: [placeOn("Silas Marsh"), narrate("The keeper squints at you."), narrate("He turns back to the lamp."), narrate("You wait.")] });
	await table.session.prompt("I size up the lamp keeper.");

	assert.deepEqual(extractions, [[1, 2, 3]], "the index pages the kernel named, read once");
	const writes = table.telemetry(CAMPAIGN).filter((row) => row.tool === "apply" && !row.event);
	assert.deepEqual(writes.map((row) => row.ok), [true], "the Keeper's one write landed");
	assert.equal(ensures.length, 1, "no foreground wait: the person's reading was queued once");
	assert.deepEqual([ensures[0].params.focus, ensures[0].options.allowanceMs, ensures[0].options.blocking], ["Silas Marsh", 0, true], "blocking, with no waiter");
	const texts = views(requests, "person_text");
	assert.equal(texts.length, 1, `the page text is carried once: ${JSON.stringify(texts)}`);
	assert.equal(texts[0].request, 1, "on the step after the write");
	assert.equal(texts[0].view.name, "Silas Marsh");
	assert.deepEqual(Object.values(texts[0].view.view), PAGES);
	const note = clerkNotes(requests[1]).at(-1);
	assert.ok(note.carried.head.includes(CARRIED_PERSON_TEXT_HEAD));
	assert.deepEqual(note.carried.pending.map((row) => [row.focus, row.person, row.purpose]), [["Silas Marsh", "Silas Marsh", "detail"]], "the pending row names the person");
	assert.ok(note.carried.head.includes(CARRIED_PENDING_PERSON_HEAD));
	const registered = JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8")).table_people.find((row) => row.name === "Silas Marsh");
	assert.equal(registered?.from_passage?.page, 2, "registered provisionally from the page that names him");
	assert.deepEqual(table.telemetry(CAMPAIGN).filter((row) => row.event === "person_text").map((row) => [row.person, row.source, row.pages]), [["Silas Marsh", "index", [1, 2, 3]]]);

	land({ state: "ready", generation: 3 });
	await new Promise((resolve) => setTimeout(resolve, 20));
	await table.session.prompt("I watch him work.");
	const records = views(requests, "person_record");
	assert.equal(records.length, 1, "the record is carried once");
	assert.equal(records[0].request, 2, "on the next turn's first model step");
	assert.deepEqual(records[0].view.view.status, "landed");
	assert.ok(clerkNotes(requests[2]).some((row) => row.carried?.head?.includes(CARRIED_PERSON_RECORD_HEAD)));
	assert.equal(views(requests, "person_text").length, 1, "the page text is not carried again");
	await table.session.prompt("I wait.");
	assert.ok(!clerkNotes(requests[3]).some((row) => (row.carried?.views ?? []).some((view) => view.focus === "person_record")), "and never again");
	assert.deepEqual(table.telemetry(CAMPAIGN).filter((row) => row.lane === "reading" && String(row.event).startsWith("person_record")).map((row) => row.event), ["person_record_landed"]);
});

test("§22.4.7.1 at the seam: a person the book's text nowhere names keeps the foreground wait", async (t) => {
	const { table, ensures, extractions } = await seam(t, { responses: [placeOn("Harbormaster"), narrate("Nobody answers to that."), narrate("You wait.")] });
	await table.session.prompt("I look for the harbormaster.");
	assert.deepEqual(extractions, [[1, 2, 3]], "the index pages were read and hold no sentence naming him");
	assert.ok(ensures.length >= 1 && ensures.every((entry) => !entry.options?.blocking), "the wait of §22.4, not a landing");
	assert.equal(table.telemetry(CAMPAIGN).filter((row) => row.event === "person_text").length, 0);
	const world = JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "world.json"), "utf8"));
	assert.equal((world.table_people ?? []).some((row) => row.name === "Harbormaster"), false, "nobody is registered");
});
