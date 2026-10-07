/**
 * Contract §151.3's evidence amendment at the kernel's publication gate (`module.read.finish`), on the TS kernel bundled
 * from source: a `reviewer: "jev"` row is source evidence only for an eligible record, with the page-text digests and
 * extraction version of the host's native-text record of the bound source (`claim-support.json` in the reading's work
 * directory), and never for a path a vision row did not support. Every other jev row refuses the publication with a
 * stable rule. A jev row reviews a path but never settles a contest mark: Jev never judged the classification.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

const REPO = resolve(import.meta.dirname, "../..");
const bundle = await mkdtemp(join(tmpdir(), "claim-support-gate-kernel-"));
after(() => rm(bundle, { recursive: true, force: true }));
await symlink(join(REPO, "node_modules"), join(bundle, "node_modules"), "dir");
const KERNEL = join(bundle, "rpc.mjs");
await build({ entryPoints: [join(REPO, "kernel-ts/rpc.ts")], outfile: KERNEL, bundle: true, packages: "external", platform: "node", format: "esm", target: "node22", logLevel: "silent" });

const PAGES = ["The harbor dock smells of tar.", "The Last Stop bar. The owner, Mae, pours coffee behind the counter.", "A menu drawn in chalk."];
const EXTRACTION = "pdfjs-test:native-text-v1";
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

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
	const run = spawnSync(process.execPath, [KERNEL, "--workspace", workspace, "--content", join(REPO, "content")], { cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	return run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
}
function ok(workspace, requests) {
	const frames = rpc(workspace, requests);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
const refs = (...pages) => pages.map((page) => ({ page }));
const claimJob = (workspace, mid) => ok(workspace, [["module.read.claim", { module_id: mid, owner: "test-host" }]])[0];
function finish(workspace, job, draft, review, evidence) {
	save(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, read_pages: [1, 2, 3], full_pages: [1, 2, 3], review_pages: [1, 2, 3] });
	save(join(job.work_dir, "draft.json"), draft);
	save(join(job.work_dir, "review.json"), review);
	if (evidence) save(join(job.work_dir, "claim-support.json"), evidence);
	return rpc(workspace, [["module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "completed",
		draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") }]])[0];
}

/** A bound PDF with the Dock as its entrance, read and published, so a detail read of the Bar can follow. */
function book(workspace) {
	const pdf = join(workspace, "original.pdf");
	writeFileSync(pdf, textPdf(PAGES));
	const file_sha256 = createHash("sha256").update(readFileSync(pdf)).digest("hex");
	const [{ module_id: mid }] = ok(workspace, [["module.source.bind", { source: { path: pdf, page_count: PAGES.length, file_sha256 } }]]);
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "index" }]]);
	const index = claimJob(workspace, mid);
	assert.ok(finish(workspace, index, { title: "The Town", language: "en", sections: [{ name: "Town", pages: [[1, 3]], source_refs: refs(1), entities: ["Dock"] }] }, { checked: [], missing: [] }).ok);
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "opening" }]]);
	const opening = claimJob(workspace, mid);
	const draft = { nodes: [{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: refs(1), properties: { is_entrance: true } },
		{ node_id: "scene-bar", node_kind: "scene", name: "Bar", source_refs: refs(2), summary: "A bar.", visibility: "player-safe" }],
		claims: [{ subject_id: "scene-dock", predicate: "route-to", object: { node_id: "scene-bar" }, truth_status: "authored-fact", visibility: "player-safe", source_refs: refs(1) }],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock"] };
	const opened = finish(workspace, opening, draft, { checked: [{ paths: ["/nodes/0", "/nodes/1", "/claims/0", "/coverage"], verdict: "supported", source_refs: refs(1, 2), reason: "fixture" }], missing: [] });
	assert.ok(opened.ok, JSON.stringify(opened.error));
	return { mid, file_sha256 };
}
function detail(workspace, mid, question) {
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "detail", focus: "Bar", question, retry: true }]]);
	const job = claimJob(workspace, mid), packetPath = join(job.work_dir, "packet.json"), packet = JSON.parse(readFileSync(packetPath, "utf8"));
	delete packet.review_policy; // the retained per-field review semantics; the gate's jev rule is the same under either policy
	writeFileSync(packetPath, JSON.stringify(packet));
	return job;
}
/** The Bar's detail: its owner and a road (text on page 2), a chalk menu drawn as an image, and a clue with a classification. */
function barDraft() {
	return {
		nodes: [
			{ node_id: "scene-bar", node_kind: "scene", name: "Bar", summary: "The Last Stop bar.", visibility: "player-safe", source_refs: refs(2), properties: {} },
			{ node_id: "npc-mae", node_kind: "npc", name: "Mae", summary: "The owner; pours coffee.", visibility: "keeper-only", source_refs: refs(2), properties: {} },
			{ node_id: "handout-menu", node_kind: "handout", name: "Chalk menu", visibility: "player-safe", source_refs: refs(3), properties: { image_sources: [{ page: 3, box: [0, 0, 1, 1] }] } },
			{ node_id: "clue-coffee", node_kind: "clue", name: "Coffee", summary: "Mae pours coffee.", visibility: "player-safe", source_refs: refs(2), properties: { delivery_kind: "npc_dialogue" } },
		],
		claims: [{ subject_id: "npc-mae", predicate: "present-in", object: { node_id: "scene-bar" }, truth_status: "authored-fact", visibility: "keeper-only", source_refs: refs(2) }],
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-bar", "npc-mae", "clue-coffee"],
	};
}
function evidenceOf(file_sha256, pages = { 2: PAGES[1] }) {
	return { protocol: "source-claim-support-v1", source_sha256: file_sha256, extraction_version: EXTRACTION, mode: "on",
		pages: Object.entries(pages).map(([page, text]) => ({ page: Number(page), text, text_sha256: sha(text) })) };
}
function jevRow(paths, page = 2, text = PAGES[1], extra = {}) {
	return { paths, verdict: "supported", reviewer: "jev", source_refs: refs(page), page_text_sha256: { [page]: sha(text) }, extraction_version: EXTRACTION,
		distribution: { supported: 0.97, contradicted: 0.01 }, reason: "Jev claim-support check", ...extra };
}
/** Vision supports every path the Jev rows do not name; the Jev rows follow. */
function review(jev, visionPaths = ["/nodes/0", "/nodes/2", "/nodes/3", "/coverage"], extra = []) {
	return { checked: [{ paths: visionPaths, verdict: "supported", source_refs: refs(2, 3), reason: "fixture" }, ...extra, ...jev], missing: [] };
}
const graphOf = (workspace, mid) => {
	const meta = JSON.parse(readFileSync(join(workspace, ".coc/modules", mid, "module.json"), "utf8"));
	return JSON.parse(readFileSync(join(workspace, ".coc/modules", mid, meta.graph_file), "utf8"));
};
const refusal = (frame) => [frame.ok, frame.error?.details?.rule, frame.error?.details?.path];

test("§151.3 the gate accepts Jev rows for eligible records whose digests match the bound source's native text, and refuses every other Jev row by rule", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "claim-support-gate-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	const { mid, file_sha256 } = book(workspace), draft = barDraft(), evidence = evidenceOf(file_sha256);

	// No evidence file: the digests have nothing to match.
	const bare = finish(workspace, detail(workspace, mid, "no evidence"), draft, review([jevRow(["/nodes/1"]), jevRow(["/claims/0"])]));
	assert.deepEqual(refusal(bare), [false, "review_jev_evidence", "/nodes/1"]);
	// An image-sourced record keeps the vision standard; so does a path that is no record at all.
	const image = finish(workspace, detail(workspace, mid, "image"), draft, review([jevRow(["/nodes/2"], 3, PAGES[2])], ["/nodes/0", "/nodes/1", "/nodes/3", "/claims/0", "/coverage"]),
		evidenceOf(file_sha256, { 2: PAGES[1], 3: PAGES[2] }));
	assert.deepEqual(refusal(image), [false, "review_jev_ineligible", "/nodes/2"]);
	const coverage = finish(workspace, detail(workspace, mid, "coverage"), draft, review([jevRow(["/coverage"])], ["/nodes/0", "/nodes/1", "/nodes/2", "/nodes/3", "/claims/0"]), evidence);
	assert.deepEqual(refusal(coverage), [false, "review_jev_ineligible", "/coverage"]);
	// Jev clears; it never refuses.
	const negative = finish(workspace, detail(workspace, mid, "negative"), draft, review([jevRow(["/nodes/1"], 2, PAGES[1], { verdict: "unsupported" }), jevRow(["/claims/0"])]), evidence);
	assert.deepEqual(refusal(negative), [false, "review_jev_ineligible", "/nodes/1"]);
	// A digest that is not the native text on record, a text that does not hash to its digest, another source, another extraction.
	const wrongDigest = finish(workspace, detail(workspace, mid, "digest"), draft, review([jevRow(["/nodes/1"], 2, "The owner is Joe."), jevRow(["/claims/0"])]), evidence);
	assert.deepEqual(refusal(wrongDigest), [false, "review_jev_evidence", "/nodes/1"]);
	const tampered = finish(workspace, detail(workspace, mid, "tampered"), draft, review([jevRow(["/nodes/1"]), jevRow(["/claims/0"])]),
		{ ...evidence, pages: [{ page: 2, text: "The owner is Joe.", text_sha256: sha(PAGES[1]) }] });
	assert.deepEqual(refusal(tampered), [false, "review_jev_evidence", "/nodes/1"]);
	const foreign = finish(workspace, detail(workspace, mid, "foreign"), draft, review([jevRow(["/nodes/1"]), jevRow(["/claims/0"])]), evidenceOf("d".repeat(64)));
	assert.deepEqual(refusal(foreign), [false, "review_jev_evidence", "/nodes/1"]);
	const version = finish(workspace, detail(workspace, mid, "version"), draft, review([jevRow(["/nodes/1"], 2, PAGES[1], { extraction_version: "pdfjs-other" }), jevRow(["/claims/0"])]), evidence);
	assert.deepEqual(refusal(version), [false, "review_jev_evidence", "/nodes/1"]);
	// A vision reviewer that did not support a path overrules Jev on it.
	const overruled = finish(workspace, detail(workspace, mid, "overruled"), draft, review([jevRow(["/nodes/1"]), jevRow(["/claims/0"])], undefined,
		[{ paths: ["/nodes/1/summary"], verdict: "unsupported", source_refs: refs(2), reason: "The page does not call her the owner." }]), evidence);
	assert.deepEqual(refusal(overruled), [false, "review_jev_overruled", "/nodes/1"]);

	// The accepted shape: the owner and her claim are reviewed by Jev alone, against page 2's native text.
	const accepted = finish(workspace, detail(workspace, mid, "accepted"), draft, review([jevRow(["/nodes/1"]), jevRow(["/claims/0"])]), evidence);
	assert.ok(accepted.ok, JSON.stringify(accepted.error));
	assert.ok(graphOf(workspace, mid).nodes.some((node) => node.node_id === "npc-mae"), "the Jev-cleared record is published");
});

test("§186.6 a Jev row never reviews a record carrying a classification field, so it never settles the contest mark a vision reviewer left there", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "claim-support-mark-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	const { mid, file_sha256 } = book(workspace), draft = barDraft();
	const contest = { paths: ["/nodes/3/properties/delivery_kind"], verdict: "contested", source_refs: refs(2), reason: "The page never says how it is delivered." };
	const first = finish(workspace, detail(workspace, mid, "contest"), draft,
		review([], ["/nodes/0", "/nodes/1", "/nodes/2", "/nodes/3", "/claims/0", "/coverage"], [contest]));
	assert.ok(first.ok, JSON.stringify(first.error));
	assert.deepEqual(Object.keys(graphOf(workspace, mid).contested ?? {}), ["/nodes/clue-coffee/properties/delivery_kind"]);
	// The clue carries `properties/delivery_kind`, a declared classification field: the record keeps the vision standard.
	const again = finish(workspace, detail(workspace, mid, "again"), draft, review([jevRow(["/nodes/3"])], ["/nodes/0", "/nodes/1", "/nodes/2", "/claims/0", "/coverage"]),
		evidenceOf(file_sha256));
	assert.deepEqual(refusal(again), [false, "review_jev_ineligible", "/nodes/3"]);
	assert.match(again.error.message, /classification_field/);
	assert.deepEqual(Object.keys(graphOf(workspace, mid).contested ?? {}), ["/nodes/clue-coffee/properties/delivery_kind"], "only a vision `supported` settles the mark");
	// The same clue without the classification field is an ordinary text record again.
	const plainDraft = barDraft();
	delete plainDraft.nodes[3].properties.delivery_kind;
	const cleared = finish(workspace, detail(workspace, mid, "plain"), plainDraft, review([jevRow(["/nodes/3"])], ["/nodes/0", "/nodes/1", "/nodes/2", "/claims/0", "/coverage"]),
		evidenceOf(file_sha256));
	assert.ok(cleared.ok, JSON.stringify(cleared.error));
});
