/**
 * SL-49 (contract §22.3.2): a reviewer's disagreement on a classification is a recorded conflict, not a refusal.
 *
 * Evidence: SL-29A batch 5 (血色公路), the bar's detail read `read-6`, refused at publication in both rounds. Round 2's
 * merged review disputed four pointers: the long-pig clue's root `/nodes/4` (its reason about `delivery_kind`), the
 * `selection` of both check rules, and the root of the clue's `discoverable-at` claim `/claims/4`. The draft here is a
 * structural replica of that draft (the same kinds, fields, pointers and claims, in English; no book text), and the first
 * review has the recorded review's shape exactly.
 *
 * - The recorded shape still refuses: a record's root is a fact, whatever its reason names. The refusal names `/nodes/4`,
 *   the verdict as written and the reviewer's reason, with `rule: "review_unsupported"`.
 * - The dispute named on the field (`/nodes/4/properties/delivery_kind`, `contested`) and the two `selection` disputes
 *   (the earlier word `contradicted`) publish: the reader's values stay, the graph carries three marks, and `look
 *   focus=scene` at the bar shows them under `where.contested` with the note.
 * - `unsupported` on a fact field refuses; `contested` on a fact field refuses (a fact is on the page or not).
 * - A later reading whose review supports the clue settles its mark and keeps the others.
 * - The host: a verdict outside the protocol's words is a schema error; the focused review input carries the declared
 *   classification fields.
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
import { checkReviewEvidence, detailReviewInput } from "../../extensions/module/reader-review.ts";
import { classificationMatcher } from "../../kernel-ts/modules/review-verdicts.ts";
import { CARRIED_VIEW_BYTES, SCENE_FIELD_ORDER, fitView } from "../../runtime/jev/carried-views.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "bar-camp";
const PAGES = ["Main street. The bar stands across the road.", "The Last Stop bar: a long counter, license plates over the mirror.",
	"Keeper notes: the owner buys meat from the store; the Keeper may decide what is served, or the player may make a Luck roll."];

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
const ALL_PAGES = PAGES.map((_, index) => index + 1);

/** Every JSON pointer under `value` (objects and leaves), as a review lists the fields it checked. */
function pointers(value, at) {
	const out = [at];
	if (Array.isArray(value)) value.forEach((item, index) => out.push(...pointers(item, `${at}/${index}`)));
	else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) out.push(...pointers(item, `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
	return out;
}
/** A review that supports every pointer of the draft except the disputed ones, then lists the disputes. */
function review(draft, disputes) {
	const disputed = new Set(disputes.flatMap((entry) => entry.paths));
	const all = [...["nodes", "claims"].flatMap((collection) => draft[collection].flatMap((item, index) => pointers(item, `/${collection}/${index}`))), "/coverage"];
	return { checked: [{ paths: all.filter((path) => !disputed.has(path)), verdict: "supported", source_refs: [{ page: 2 }], reason: "fixture support" },
		...disputes.map((entry) => ({ source_refs: [{ page: 3 }], ...entry }))], missing: [] };
}
function claim(workspace, mid, campaign) {
	return ok(workspace, [["module.read.claim", { module_id: mid, owner: "test-host", ...(campaign ? { campaign } : {}) }]])[0];
}
function finish(workspace, job, draft, reviewed, outcome = "completed") {
	save(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, read_pages: ALL_PAGES, full_pages: ALL_PAGES, review_pages: ALL_PAGES });
	save(join(job.work_dir, "draft.json"), draft);
	save(join(job.work_dir, "review.json"), reviewed);
	return rpc(workspace, [["module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome,
		draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") }]])[0];
}
const refs = (...pages) => pages.map((page) => ({ page }));
const rel = (subject_id, predicate, node_id, visibility = "keeper-only") => ({ subject_id, predicate, object: { node_id }, truth_status: "authored-fact", visibility, source_refs: refs(2) });

/** The bar's detail draft, structurally as `read-6` round 2 wrote it: the scene, two people, two clues, two check rules. */
function barDraft(mid) {
	const check = (path, extra) => ({ check: { scope: "actor", values: [{ path, label: path.split(".")[1] }], selection: "maximum", ...extra } });
	return {
		nodes: [
			{ node_id: "scene-bar", node_kind: "scene", name: "Bar", summary: "An old saloon with plates over the mirror.", visibility: "player-safe", source_refs: refs(2, 3),
				properties: { dramatic_question: "Where did the plates come from?", exit_conditions: "The door is open.", keeper_notes: "Food until nine; the owner buys meat from the store." } },
			{ node_id: "npc-owner", node_kind: "npc", name: "Owner", summary: "Runs the bar.", visibility: "keeper-only", source_refs: refs(2), properties: { fear: "Things at the edge of town.", secret: "Paid to keep quiet." } },
			{ node_id: "npc-cook", node_kind: "npc", name: "Cook", summary: "Cooks well.", visibility: "keeper-only", source_refs: refs(2, 3), properties: { fear: "Suspects something.", secret: "Does not know what the meat is." } },
			{ node_id: "clue-plates", node_kind: "clue", name: "Plates of the missing", summary: "Some plates belong to missing people.", visibility: "player-safe", source_refs: refs(2),
				properties: { delivery_kind: "skill_check", skill: "Spot Hidden", difficulty: "hard", delivery: "Offered only when asked about a particular person." } },
			{ node_id: "clue-meat", node_kind: "clue", name: "The meat on the menu", summary: "The store sometimes supplies other meat.", visibility: "keeper-only", source_refs: refs(3),
				properties: { delivery_kind: "skill_check", skill: "Luck", delivery: "The Keeper may decide without a roll." } },
			{ node_id: "rule-spot-plates", node_kind: "rule", name: "Spot the plates", summary: "A hard Spot Hidden roll when asked.", visibility: "keeper-only", source_refs: refs(2),
				properties: { mechanics: check("skills.Spot Hidden", { difficulty: "hard", results: { hard: { book: "Notices the plates." }, extreme: { book: "Notices the plates." },
					critical: { book: "Notices the plates." } }, book: "Only when asked." }) } },
			{ node_id: "rule-meat-luck", node_kind: "rule", name: "Keeper's choice or Luck", summary: "The Keeper decides, or a Luck roll.", visibility: "keeper-only", source_refs: refs(3),
				properties: { mechanics: check("characteristics.Luck", { difficulty_unstated: true, book: "The Keeper may decide without a roll." }) } },
		],
		claims: [rel(`module-${mid}`, "contains", "scene-bar", "player-safe"), rel("npc-owner", "present-in", "scene-bar"), rel("npc-cook", "present-in", "scene-bar"),
			rel("clue-plates", "discoverable-at", "scene-bar", "player-safe"), rel("clue-meat", "discoverable-at", "scene-bar"),
			rel("scene-bar", "uses-rule", "rule-spot-plates"), rel("scene-bar", "uses-rule", "rule-meat-luck")],
		node_refs: [`module-${mid}`], coverage: { structure: "partial" }, dependencies: [],
		critical: ["/nodes/0/summary", "/nodes/3/properties/delivery_kind", "/nodes/4/summary", "/claims/4"],
		ready_nodes: ["scene-bar", "npc-owner", "npc-cook", "clue-plates", "clue-meat", "rule-spot-plates", "rule-meat-luck"],
	};
}
const DELIVERY = "The node makes it a skill check; the page gives the Keeper's choice or a Luck roll.";
const SELECTION = "The page says they may roll; it names no maximum.";
/** Round 2 of `read-6`, as recorded: the verdict words, pointers and grouping of the four disputes. */
const RECORDED_DISPUTES = [
	{ paths: ["/nodes/4"], verdict: "contradicted", reason: DELIVERY },
	{ paths: ["/nodes/5/properties/mechanics/check/selection"], verdict: "contradicted", reason: SELECTION },
	{ paths: ["/nodes/6/properties/mechanics/check/selection"], verdict: "contradicted", reason: SELECTION },
	{ paths: ["/claims/4"], verdict: "contradicted", reason: "The Keeper knows it; the investigators do not learn it here." },
];

/** A read PDF: the Dock (ready, the entrance) with a route to the Bar, known only by the page that names it. */
function town(workspace) {
	const pdf = join(workspace, "original.pdf");
	writeFileSync(pdf, textPdf(PAGES));
	const [{ module_id: mid }] = ok(workspace, [["module.source.bind", { source: { path: pdf, page_count: PAGES.length,
		file_sha256: createHash("sha256").update(readFileSync(pdf)).digest("hex") } }]]);
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "index" }]]);
	const index = claim(workspace, mid);
	const indexed = finish(workspace, index, { title: "The Town", language: "en", sections: [{ name: "Town", pages: [[1, 3]], source_refs: refs(1), entities: ["Dock"] }] }, { checked: [], missing: [] });
	assert.ok(indexed.ok, JSON.stringify(indexed.error));
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "opening" }]]);
	const opening = claim(workspace, mid), draft = { nodes: [
		{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: refs(1), properties: { is_entrance: true } },
		{ node_id: "scene-bar", node_kind: "scene", name: "Bar", source_refs: refs(1), summary: "A bar across the road.", visibility: "player-safe" }],
		claims: [rel("scene-dock", "route-to", "scene-bar", "player-safe")], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock"] };
	const opened = finish(workspace, opening, draft, { checked: [{ paths: ["/nodes/0", "/claims/0", "/coverage"], verdict: "supported", source_refs: refs(1), reason: "fixture support" }], missing: [] });
	assert.ok(opened.ok, JSON.stringify(opened.error));
	return mid;
}
const library = (workspace, mid) => {
	const meta = JSON.parse(readFileSync(join(workspace, ".coc/modules", mid, "module.json"), "utf8"));
	return { meta, graph: JSON.parse(readFileSync(join(workspace, ".coc/modules", mid, meta.graph_file), "utf8")) };
};
const queueOf = (workspace, mid) => JSON.parse(readFileSync(join(workspace, ".coc/modules", mid, "deepen-queue.json"), "utf8"));

test("§22.3.2 on the emitted kernel: a root dispute refuses naming it; classification disputes publish with marks the Keeper sees; a later reading settles one", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "review-contested-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	const mid = town(workspace);
	const detail = (question) => {
		ok(workspace, [["module.read.request", { module_id: mid, purpose: "detail", focus: "Bar", ...(question ? { question } : {}), retry: true }]]);
		return claim(workspace, mid);
	};

	// The recorded shape: refused at the clue's root, with its reason; the classification disputes did not refuse it.
	const draft = barDraft(mid), first = detail();
	const declared = JSON.parse(readFileSync(join(REPO, "content/modules/module-graph-contract-v3.json"), "utf8")).classification_fields;
	assert.deepEqual(JSON.parse(readFileSync(join(first.work_dir, "packet.json"), "utf8")).vocabulary.classification_fields, declared,
		"the reader's packet carries the declaration the gate reads");
	const recorded = finish(workspace, first, draft, review(draft, RECORDED_DISPUTES));
	assert.equal(recorded.ok, false);
	assert.equal(recorded.error.details.reason, "reading_failed");
	assert.equal(recorded.error.details.path, "/nodes/4", "the refusal names the disputed record, not '/'");
	assert.equal(recorded.error.details.rule, "review_unsupported");
	assert.equal(recorded.error.details.verdict, "contradicted");
	assert.match(recorded.error.message, /visual review found \/nodes\/4 unsupported \(contradicted\): The node makes it a skill check/);
	assert.equal(library(workspace, mid).graph.contested, undefined, "a refused reading publishes nothing");
	// Without the two root disputes, the classification disputes alone publish (the earlier word `contradicted` included).
	const selectionsOnly = finish(workspace, detail("selections only"), draft, review(draft, RECORDED_DISPUTES.slice(1, 3)));
	assert.ok(selectionsOnly.ok, JSON.stringify(selectionsOnly.error));
	assert.deepEqual(Object.keys(library(workspace, mid).graph.contested), ["/nodes/rule-meat-luck/properties/mechanics/check/selection",
		"/nodes/rule-spot-plates/properties/mechanics/check/selection"]);

	// The same review with the clue's dispute on its field: published, the reader's value kept, three marks.
	const fielded = [{ paths: ["/nodes/4/properties/delivery_kind"], verdict: "contested", reason: DELIVERY }, ...RECORDED_DISPUTES.slice(1, 3)];
	const published = finish(workspace, detail("the meat"), draft, review(draft, fielded));
	assert.ok(published.ok, JSON.stringify(published.error));
	const { graph, meta } = library(workspace, mid);
	const meat = graph.nodes.find((node) => node.node_id === "clue-meat");
	assert.equal(meat.properties.delivery_kind, "skill_check", "the reader's value is the published one");
	assert.deepEqual(Object.keys(graph.contested), ["/nodes/clue-meat/properties/delivery_kind", "/nodes/rule-meat-luck/properties/mechanics/check/selection",
		"/nodes/rule-spot-plates/properties/mechanics/check/selection"]);
	const mark = graph.contested["/nodes/clue-meat/properties/delivery_kind"];
	assert.deepEqual({ value: mark.value, verdict: mark.verdict, reason: mark.reason, generation: mark.generation },
		{ value: "skill_check", verdict: "contested", reason: DELIVERY, generation: meta.generation });
	assert.deepEqual(mark.source_refs, [{ source_id: `pdf:${mid}`, pdf_index: 2 }]);

	// The Keeper sees the marks in the scene view of the bar.
	const [, saved] = ok(workspace, [["campaign.create", { id: "card-source", module: "the-haunting", pregen: "thomas-hayes", play_language: "en" }],
		["investigator.save", { campaign: "card-source" }]]);
	ok(workspace, [["campaign.create", { id: CAMPAIGN, module: mid, play_language: "en" }],
		["investigator.load", { campaign: CAMPAIGN, library_id: saved.library_id }], ["setup.complete", { campaign: CAMPAIGN }],
		["table.open", { campaign: CAMPAIGN }], ["table.narrate", { campaign: CAMPAIGN, call_id: "t0-c1", text: "The dock is quiet." }],
		["table.open", { campaign: CAMPAIGN }], ["table.player_input", { campaign: CAMPAIGN, text: "I cross to the bar." }],
		["table.apply", { campaign: CAMPAIGN, call_id: "t1-c1", effects: [{ kind: "move", to: "Bar" }] }]]);
	const [view] = ok(workspace, [["table.look", { campaign: CAMPAIGN, focus: "scene" }]]);
	assert.equal(view.where.scene, "bar");
	assert.deepEqual(view.where.contested.map((row) => [row.record, row.field, row.value]).sort(), [
		["meat", "properties/delivery_kind", "skill_check"], ["meat-luck", "properties/mechanics/check/selection", "maximum"],
		["spot-plates", "properties/mechanics/check/selection", "maximum"]], JSON.stringify(view.where.contested));
	assert.ok(view.where.contested.every((row) => typeof row.reason === "string" && row.reason.length > 0));
	assert.match(view.where.contested_note, /classified/);

	// A later reading whose review supports the clue settles its mark; the others stay.
	const clueOnly = { nodes: [draft.nodes[4]], claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["clue-meat"] };
	const settled = finish(workspace, detail("the meat again"), clueOnly, review(clueOnly, []));
	assert.ok(settled.ok, JSON.stringify(settled.error));
	assert.deepEqual(Object.keys(library(workspace, mid).graph.contested), ["/nodes/rule-meat-luck/properties/mechanics/check/selection",
		"/nodes/rule-spot-plates/properties/mechanics/check/selection"]);

	// A fact the page does not state refuses; so does a contest on a fact field.
	const unsupportedFact = finish(workspace, detail("difficulty"), draft, review(draft, [{ paths: ["/nodes/3/properties/difficulty"], verdict: "unsupported", reason: "The page prints no difficulty." }]));
	assert.equal(unsupportedFact.ok, false);
	assert.deepEqual([unsupportedFact.error.details.path, unsupportedFact.error.details.rule, unsupportedFact.error.details.verdict],
		["/nodes/3/properties/difficulty", "review_unsupported", "unsupported"]);
	const contestedFact = finish(workspace, detail("summary"), draft, review(draft, [{ paths: ["/nodes/0/summary"], verdict: "contested", reason: "Worded otherwise." }]));
	assert.equal(contestedFact.ok, false);
	assert.deepEqual([contestedFact.error.details.path, contestedFact.error.details.verdict], ["/nodes/0/summary", "contested"]);
	// A word outside the verdicts is never a contest, even on a classification field.
	const unknownWord = finish(workspace, detail("word"), draft, review(draft, [{ paths: ["/nodes/5/properties/mechanics/check/selection"], verdict: "maybe", reason: "Unsure." }]));
	assert.equal(unknownWord.ok, false);
	assert.deepEqual([unknownWord.error.details.path, unknownWord.error.details.verdict], ["/nodes/5/properties/mechanics/check/selection", "maybe"]);
	assert.ok(queueOf(workspace, mid).some((job) => job.state === "running"), "a refused finish leaves the attempt to its owner");
});

test("§22.3.2 at the host: a verdict outside the protocol's words is the reviewer's slip; the focused review input carries the declared classification fields", () => {
	const draft = { nodes: [{ node_id: "clue-meat", node_kind: "clue", name: "Meat", source_refs: [{ page: 3 }], properties: { delivery_kind: "skill_check" } }], claims: [] };
	const entry = (verdict) => ({ checked: [{ paths: ["/nodes/0"], verdict, source_refs: [{ page: 3 }], reason: "r" }], missing: [] });
	for (const verdict of ["supported", "contested", "unsupported", "contradicted", "unclear"])
		assert.doesNotThrow(() => checkReviewEvidence(entry(verdict), ["/nodes/0"], new Set([3]), [], draft), verdict);
	for (const verdict of ["maybe", undefined])
		assert.throws(() => checkReviewEvidence(entry(verdict), ["/nodes/0"], new Set([3]), [], draft), /schema error in the review/);
	// Not only an assigned pointer: the field under the assigned record is accepted.
	assert.doesNotThrow(() => checkReviewEvidence({ checked: [{ paths: ["/nodes/0"], verdict: "supported", source_refs: [{ page: 3 }], reason: "r" },
		{ paths: ["/nodes/0/properties/delivery_kind"], verdict: "contested", source_refs: [{ page: 3 }], reason: "r" }], missing: [] }, ["/nodes/0"], new Set([3]), [], draft));
	const declared = JSON.parse(readFileSync(join(REPO, "content/modules/module-graph-contract-v3.json"), "utf8")).classification_fields;
	assert.ok(declared.node.includes("properties/delivery_kind"));
	const input = detailReviewInput({ purpose: "detail", vocabulary: { classification_fields: declared } }, draft, ["/nodes/0"]);
	assert.deepEqual(input.task.classification_fields, declared);
});

test("§22.3.2: a classification field is matched token for token against the declared patterns; the carried scene view keeps the marks ahead of the prose", () => {
	const declared = JSON.parse(readFileSync(join(REPO, "content/modules/module-graph-contract-v3.json"), "utf8")).classification_fields;
	const classifies = classificationMatcher(declared.node);
	assert.equal(classifies("/nodes/3/properties/delivery_kind"), true);
	assert.equal(classifies("/nodes/5/properties/mechanics/check/selection"), true);
	assert.equal(classifies("/nodes/2/properties/obligation/demand/1/selection"), true, "* stands for one token");
	assert.equal(classifies("/nodes/3/properties/delivery_kind/0"), false, "exact, not a prefix");
	assert.equal(classifies("/nodes/3/properties"), false);
	assert.equal(classifies("/nodes/3"), false, "a record's root is a fact");
	assert.equal(classifies("/nodes/5/properties/mechanics/check/difficulty"), false);
	assert.equal(classifies("/claims/4/predicate"), false);
	assert.equal(classifies("/claims/4"), false);
	// As `look` gives it: the marks come last in `where`, after the notes.
	const view = { where: { scene: "bar", display_name: "Bar", summary: "s", exits: [], affordances: [], assets: [], dramatic_question: "q",
		keeper_notes: ["x".repeat(3000)], material: "ready", contested: [{ record: "meat", field: "properties/delivery_kind", value: "skill_check", reason: "r".repeat(900) }],
		contested_note: "n".repeat(200) }, present: [] };
	const fitted = fitView(view, CARRIED_VIEW_BYTES, SCENE_FIELD_ORDER);
	assert.equal(fitted.truncated, true);
	assert.deepEqual(fitted.view.where.contested, view.where.contested, JSON.stringify(fitted.omitted_fields));
	assert.equal(fitted.view.where.contested_note, view.where.contested_note);
	assert.ok(fitted.omitted_fields.includes("where.keeper_notes"));
});
