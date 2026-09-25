/**
 * SL-48 (contract §22.4.8): a scene's detail read writes the scene's own index row; a move into it lands on its own pages.
 *
 * Evidence: SL-47's replay and SL-29A batch 5 (血色公路): the bar's node cited only the town's arrival page (17), which
 * names it once; its own pages (28-30) were found by its detail reader, which was refused at review, and no index row named
 * the bar, so every move into it landed on the arrival page.
 *
 * On the emitted kernel, over a six-page text PDF whose index row names only the Dock:
 * - before any reading, a move into the Bar names the page that merely named it ([1]);
 * - a detail reading of the Bar refused after its read phase (viewed 4-6, its draft citing 5 and 6, and 2, unviewed) writes
 *   the Bar's own row, and a move into the Bar in a campaign made afterwards names [5, 6] and lands on them;
 * - a draft without the scene's node falls back to the pages viewed (the Cellar: 3, 4);
 * - a reading that failed before its read phase writes nothing (the Attic keeps [1]);
 * - a completed reading writes the row from the published draft (the Loft: 2);
 * - the next reader's packet index carries the rows.
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

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGES = ["Main street: the dock, a bar, a cellar door, an attic and a loft.", "The loft above the stables.", "A cellar under the church.",
	"Town hall and the barber.", "The Last Stop bar: counter and plates.", "The bar's rooms for rent."];

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
const refs = (...pages) => pages.map((page) => ({ page }));
const claim = (workspace, mid) => ok(workspace, [["module.read.claim", { module_id: mid, owner: "test-host" }]])[0];
function finish(workspace, job, { observations, draft, review, outcome = "completed", refusal }) {
	if (observations) save(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, full_pages: observations, review_pages: observations, read_pages: observations });
	if (draft) save(join(job.work_dir, "draft.json"), draft);
	if (review) save(join(job.work_dir, "review.json"), review);
	return ok(workspace, [["module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome,
		...(outcome === "completed" ? { draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") } : { detail: "refused", refusal }) }]])[0];
}
const route = (node_id) => ({ subject_id: "scene-dock", predicate: "route-to", object: { node_id }, truth_status: "authored-fact", visibility: "player-safe", source_refs: refs(1) });
const SCENES = ["bar", "cellar", "attic", "loft"];

/** Six pages; the index row names only the Dock; the opening knows the Bar, Cellar, Attic and Loft by page 1 alone. */
function town(workspace) {
	const pdf = join(workspace, "original.pdf");
	writeFileSync(pdf, textPdf(PAGES));
	const [{ module_id: mid }] = ok(workspace, [["module.source.bind", { source: { path: pdf, page_count: PAGES.length,
		file_sha256: createHash("sha256").update(readFileSync(pdf)).digest("hex") } }]]);
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "index" }]]);
	finish(workspace, claim(workspace, mid), { observations: [1, 2, 3, 4, 5, 6], review: { checked: [], missing: [] },
		draft: { title: "The Town", language: "en", sections: [{ name: "Town", pages: [[1, 6]], source_refs: refs(1), entities: ["Dock"] }] } });
	ok(workspace, [["module.read.request", { module_id: mid, purpose: "opening" }]]);
	finish(workspace, claim(workspace, mid), { observations: [1], review: { checked: [{ paths: ["/nodes/0", ...SCENES.map((_, i) => `/claims/${i}`), "/coverage"],
		verdict: "supported", source_refs: refs(1), reason: "fixture support" }], missing: [] },
		draft: { nodes: [{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: refs(1), properties: { is_entrance: true } },
			...SCENES.map((name) => ({ node_id: `scene-${name}`, node_kind: "scene", name: name[0].toUpperCase() + name.slice(1), source_refs: refs(1), visibility: "player-safe" }))],
		claims: SCENES.map((name) => route(`scene-${name}`)), node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock"] } });
	return mid;
}
function campaign(workspace, mid, id) {
	const [, saved] = ok(workspace, [["campaign.create", { id: `${id}-card`, module: "the-haunting", pregen: "thomas-hayes", play_language: "en" }],
		["investigator.save", { campaign: `${id}-card` }]]);
	ok(workspace, [["campaign.create", { id, module: mid, play_language: "en" }],
		["investigator.load", { campaign: id, library_id: saved.library_id }], ["setup.complete", { campaign: id }],
		["table.open", { campaign: id }], ["table.narrate", { campaign: id, call_id: "t0-c1", text: "The dock is quiet." }],
		["table.open", { campaign: id }], ["table.player_input", { campaign: id, text: "I look down the street." }]]);
}
/** The pages a move into `to` names (the refusal's `details.index`), without landing. */
function landingPages(workspace, id, to, call) {
	const [refused] = rpc(workspace, [["table.apply", { campaign: id, call_id: call, effects: [{ kind: "move", to }] }]]);
	assert.equal(refused.ok, false, `${to} is not read`);
	assert.equal(refused.error.details.reason, "material_pending");
	return refused.error.details.index?.pages;
}
const rows = (workspace, mid) => JSON.parse(readFileSync(join(workspace, ".coc/modules", mid, "module.json"), "utf8")).reading.scene_index ?? [];

test("§22.4.8 on the emitted kernel: a scene's detail read writes its own index row, and a move into it lands on its own pages", async (t) => {
	const workspace = await mkdtemp(join(tmpdir(), "scene-own-pages-"));
	t.after(() => rm(workspace, { recursive: true, force: true }));
	const mid = town(workspace);
	campaign(workspace, mid, "before");
	assert.deepEqual(landingPages(workspace, "before", "Bar", "t1-c1"), [1], "never read: the page that named it");

	const detail = (focus) => { ok(workspace, [["module.read.request", { module_id: mid, purpose: "detail", focus, retry: true }]]); return claim(workspace, mid); };
	const refusal = { message: "visual review found /nodes/0 unsupported (unsupported): fixture", path: "/nodes/0", rule: "review_unsupported", reason: "reading_failed" };
	// The Bar: refused after reading 4-6; its draft cites 5, 6 and an unviewed 2.
	finish(workspace, detail("Bar"), { outcome: "failed", refusal, observations: [4, 5, 6],
		draft: { nodes: [{ node_id: "scene-bar", node_kind: "scene", name: "Bar", source_refs: refs(5, 6, 2) }], claims: [] } });
	// The Cellar: refused; its draft has no node for the scene, so the pages viewed stand.
	finish(workspace, detail("Cellar"), { outcome: "failed", refusal, observations: [3, 4],
		draft: { nodes: [{ node_id: "npc-sexton", node_kind: "npc", name: "Sexton", source_refs: refs(3) }], claims: [] } });
	// The Attic: failed before its read phase wrote anything.
	finish(workspace, detail("Attic"), { outcome: "failed", refusal });
	// The Loft: completed; the published draft cites page 2, viewed 2 and 3.
	const loft = { nodes: [{ node_id: "scene-loft", node_kind: "scene", name: "Loft", source_refs: refs(2), summary: "A loft above the stables.", visibility: "player-safe" }],
		claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-loft"] };
	finish(workspace, detail("Loft"), { observations: [2, 3], draft: loft,
		review: { checked: [{ paths: ["/nodes/0", "/nodes/0/summary", "/coverage"], verdict: "supported", source_refs: refs(2), reason: "fixture support" }], missing: [] } });

	const written = Object.fromEntries(rows(workspace, mid).map((row) => [row.name, row]));
	assert.deepEqual(Object.keys(written).sort(), ["Bar", "Cellar", "Loft"], "a reading that never read writes no row");
	assert.deepEqual(written.Bar, { name: "Bar", pages: [[4, 5]], topics: [], entities: ["scene-bar"], references: [], state: "indexed", scene: "scene-bar", job_id: written.Bar.job_id });
	assert.deepEqual(written.Cellar.pages, [[2, 3]], "no node for the scene: the pages viewed");
	assert.deepEqual(written.Loft.pages, [[1, 1]], "a completed reading: the published draft's citation");
	// The next reader sees the rows in its packet's index.
	const next = JSON.parse(readFileSync(join(detail("Attic").work_dir, "packet.json"), "utf8"));
	assert.ok(next.index.some((row) => row.scene === "scene-bar" && JSON.stringify(row.pages) === "[[4,5]]"), JSON.stringify(next.index));

	// A campaign made afterwards: the Bar lands on its own pages, the Cellar on the pages viewed, the Attic still on page 1.
	campaign(workspace, mid, "after");
	assert.deepEqual(landingPages(workspace, "after", "Bar", "t1-c1"), [5, 6]);
	assert.deepEqual(landingPages(workspace, "after", "Cellar", "t1-c2"), [3, 4]);
	assert.deepEqual(landingPages(workspace, "after", "Attic", "t1-c3"), [1]);
	const [moved] = ok(workspace, [["table.apply", { campaign: "after", call_id: "t1-c4", effects: [{ kind: "move", to: "Bar", _land_on_index: true }] }]]);
	assert.equal(moved.world.active_scene, "bar");
	assert.deepEqual(moved.scene_text, [{ scene: "bar", pages: [5, 6] }]);
});
