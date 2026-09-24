/**
 * SL-34 (spec pi-native-single-loop, Ruling "Reading never holds a turn"; contract §107.1, §22.4.3, §39.2).
 *
 * On the emitted kernel, over a read PDF whose index marks the Tower with a map: the table moved into the Tower while
 * the map was still being read, and the reader published it afterwards. On the first turn after that publication the
 * kernel mints the late first-arrival card; here, at the extension seam with the hybrid-v1 engine and a faux Keeper:
 * - the host renders its derivative through the same hop as an apply's, and the card rides that turn's delivery;
 * - the Keeper's `coc-clerk` note says the map arrived, once, and nothing private reaches the Keeper;
 * - `look {focus: "map"}` on a map still being read never holds the turn (§22.4.3): the host queues the reading in the
 *   background and answers `map_preparing` at once.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const IMAGE = readFileSync(join(REPO, "tests/kernel/fixtures/bundle-tiny/assets/map-dock.png"));
const REFS = [{ page: 1 }], TOWER = [{ page: 2 }];

/** One kernel process per batch, as a table that stops and reopens: every step goes through the kernel's own RPC. */
function rpc(workspace, requests) {
	const input = requests.map(([method, params], index) => JSON.stringify({ id: String(index), method, params })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`kernel step ${frame.id} (${requests[Number(frame.id)][0]}) failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}
const save = (path, value) => writeFileSync(path, JSON.stringify(value));

/**
 * The reader's side of a job: its observations, draft and independent review in the attempt directory, then the
 * leased finish. Only what a host reader writes; the kernel owns everything it publishes.
 */
function read(workspace, job, draft, paths, extra = {}) {
	save(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2] });
	save(join(job.work_dir, "draft.json"), draft);
	save(join(job.work_dir, "review.json"), { checked: [{ paths, verdict: "supported", source_refs: REFS, reason: "fixture support" }], missing: [] });
	return rpc(workspace, [["module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease, outcome: "completed",
		draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json"), ...extra }]])[0];
}

/** A read PDF, a table that walked into the Tower while its map was unread, and the map the reader published after. */
function towerWithALateMap(published) {
	return (workspace) => {
		const pdf = join(workspace, "original.pdf");
		writeFileSync(pdf, "%PDF-1.7\nSL-34 late map fixture\n");
		const [{ module_id: mid }] = rpc(workspace, [["module.source.bind", { source: { path: pdf, page_count: 2,
			file_sha256: createHash("sha256").update(readFileSync(pdf)).digest("hex") } }]]);
		const claim = (campaign) => rpc(workspace, [["module.read.claim", { module_id: mid, owner: "test-host", ...(campaign ? { campaign } : {}) }]])[0];
		rpc(workspace, [["module.read.request", { module_id: mid, purpose: "index" }]]);
		read(workspace, claim(), { title: "The Harbor", language: "en", sections: [{ name: "Harbor and tower", pages: [[1, 2]], entities: ["Dock", "Tower", "Lena"] }],
			map_candidates: [{ name: "Tower plan", focus: "Tower", pages: [2] }] }, []);
		rpc(workspace, [["module.read.request", { module_id: mid, purpose: "opening" }]]);
		read(workspace, claim(), { nodes: [
			{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: REFS, properties: { is_entrance: true } },
			{ node_id: "scene-tower", node_kind: "scene", name: "Tower", source_refs: TOWER, summary: "An old tower beyond the harbor.", properties: { is_final: true } },
			{ node_id: "npc-lena", node_kind: "npc", name: "Lena", source_refs: REFS, properties: { mechanics: { profile: { characteristics: { STR: 50 } } } } }],
			claims: [["scene-dock", "route-to", "scene-tower"], ["npc-lena", "present-in", "scene-dock"]].map(([subject_id, predicate, node_id]) =>
				({ subject_id, predicate, object: { node_id }, truth_status: "authored-fact", source_refs: REFS })),
			node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock", "npc-lena"] },
			["/nodes/0", "/nodes/2", "/nodes/2/properties/mechanics/profile/characteristics/STR", "/claims/0", "/claims/1", "/coverage"]);
		// A pregen belongs to a starter; the investigator crosses into the PDF table through the library (§14).
		const [, saved] = rpc(workspace, [["campaign.create", { id: "card-source", module: "the-haunting", pregen: "thomas-hayes", play_language: "zh-Hans" }],
			["investigator.save", { campaign: "card-source" }]]);
		rpc(workspace, [["campaign.create", { id: CAMPAIGN, module: mid, play_language: "zh-Hans" }],
			["investigator.load", { campaign: CAMPAIGN, library_id: saved.library_id }], ["setup.complete", { campaign: CAMPAIGN }],
			["table.open", { campaign: CAMPAIGN }], ["table.narrate", { campaign: CAMPAIGN, call_id: "t0-c1", text: "港口静静的。" }],
			["table.player_input", { campaign: CAMPAIGN, text: "我去塔那边。" }],
			["module.read.request", { module_id: mid, campaign: CAMPAIGN, purpose: "detail", focus: "Tower" }]]);
		read(workspace, claim(CAMPAIGN), { nodes: [{ node_id: "scene-tower", node_kind: "scene", name: "Tower", source_refs: TOWER,
			summary: "An old tower beyond the harbor.", properties: { is_final: true } }], claims: [], node_refs: [], coverage: {}, dependencies: [], critical: [],
			ready_nodes: ["scene-tower"] }, ["/nodes/0", "/coverage"], { campaign: CAMPAIGN });
		const [moved] = rpc(workspace, [["table.apply", { campaign: CAMPAIGN, call_id: "t1-c1", effects: [{ kind: "move", to: "Tower" }] }],
			["table.narrate", { campaign: CAMPAIGN, call_id: "t1-c2", text: "塔门半掩着。" }]]);
		assert.equal(moved.world.active_scene, "tower", "the move landed with the Tower's text while its map was unread");
		if (!published) return;
		const job = claim(CAMPAIGN);
		assert.equal(job.material, "map");
		const plate = join(job.work_dir, "tower-plate.png");
		writeFileSync(plate, IMAGE);
		read(workspace, job, { nodes: [
			{ node_id: "asset-tower-plate", node_kind: "asset", name: "Tower plate", visibility: "player-safe", source_refs: TOWER, properties: { image_sources: [{ page: 2 }] } },
			{ node_id: "handout-tower-plan", node_kind: "handout", name: "Tower plan", visibility: "player-safe", source_refs: TOWER, properties: { map_regions: [
				{ region_id: "top-room", name: "Top room", source_asset: "asset-tower-plate", source_box: [0, 0, 1, 1], placement: [0, 0, 1, 1] }] } }],
			claims: [{ subject_id: "handout-tower-plan", predicate: "depicts", object: { node_id: "scene-tower" }, truth_status: "authored-fact", source_refs: TOWER }],
			node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["asset-tower-plate", "handout-tower-plan"] },
			["/nodes/0", "/nodes/1", ...["source_box", "placement"].flatMap((box) => [0, 1, 2, 3].map((n) => `/nodes/1/properties/map_regions/0/${box}/${n}`)), "/claims/0", "/coverage"],
			{ campaign: CAMPAIGN, assets: [{ node_id: "asset-tower-plate", path: plate, sha256: createHash("sha256").update(IMAGE).digest("hex") }] });
	};
}

const clerkNotes = (context) => context.messages.flatMap((message) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block) => block.text ?? "").join("");
	const start = text.indexOf('{"kind":"single_loop_step"');
	return start < 0 ? [] : [JSON.parse(text.slice(start, text.lastIndexOf("}") + 1))];
});
const everything = (context) => JSON.stringify(context.messages);

test("§107.1 at the seam: the map published after the arrival is on the next turn's delivery, and the clerk's note says so once", async (t) => {
	const engine = createHybridEngine({ env: process.env, decision: null });
	const requests = [];
	const table = await openTable({ realKernel: true, seedCampaign: false, prepareWorkspace: towerWithALateMap(true),
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1" }, runDriver: engine.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [(context) => { requests.push(context); return fauxAssistantMessage([fauxToolCall("look", { focus: "scene" })], { stopReason: "toolUse" }); },
			(context) => { requests.push(context); return fauxAssistantMessage([fauxToolCall("narrate", { text: "风从塔顶的小屋里穿过去。" })], { stopReason: "toolUse" }); }] });
	t.after(() => table.dispose());
	await table.session.prompt("我上到塔顶四下看看。");

	const turn = JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "turns/0002.json"), "utf8"));
	const [receipt] = turn.receipts.filter((row) => row.kind === "map");
	assert.ok(receipt, "the late first-arrival card was minted on this turn");
	assert.deepEqual([receipt.map, receipt.late, receipt.scene, receipt.why], ["tower-plan", true, "tower", "arrival"]);

	// The host's map hop rendered the derivative, and the card rode this turn's delivery beside the prose.
	const delivered = table.entries("coc-mechanics").find((entry) => entry.turn === 2);
	const card = delivered?.mechanics.find((row) => row.kind === "map" && row.receipt === receipt.id);
	assert.ok(card, `the map row is in turn 2's mechanics entry: ${JSON.stringify(delivered)}`);
	assert.notEqual(card.view_id, "unavailable", "the flattened derivative was rendered");

	// The Keeper is told once, before its first step, and never sees a private path.
	const notes = [...new Map(requests.flatMap(clerkNotes).filter((note) => note.map_arrived).map((note) => [JSON.stringify(note), note])).values()];
	assert.equal(notes.length, 1, "the note says the map arrived exactly once");
	assert.ok(clerkNotes(requests[0]).some((note) => note.map_arrived), "on the first model step");
	assert.deepEqual(notes[0].map_arrived, [{ map: "tower-plan", scene: "tower", receipt: receipt.id }]);
	assert.match(notes[0].map_arrived_note, /Do not mention a map/);
	for (const context of requests) {
		assert.ok(!everything(context).includes("tower-plate.png"), "no source path reaches the Keeper");
		assert.ok(!everything(context).includes("map_views"), "the host-only payload never reaches the Keeper");
	}
});

test("§22.4.3 at the seam: look focus=map on a map still being read answers map_preparing at once and never waits", async (t) => {
	const table = await openTable({ realKernel: true, seedCampaign: false, prepareWorkspace: towerWithALateMap(false),
		responses: [fauxAssistantMessage([fauxToolCall("look", { focus: "map", name: "Harbor chart" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你在塔下站了一会儿。" })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	const began = Date.now();
	await table.session.prompt("有没有这一带的地图？");
	assert.ok(Date.now() - began < 60_000, "the turn was not held on the map");
	const results = table.rawEntries().filter((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "look");
	const text = JSON.stringify(results.at(-1)?.message.content ?? "");
	assert.match(text, /being prepared in the background/, `the look answered at once that the map is being prepared: ${text}`);
	const row = table.telemetry().find((entry) => entry.tool === "look" && entry.ok === false);
	assert.equal(row?.reason, "map_preparing", `the refusal is typed: ${JSON.stringify(row)}`);
	const queue = JSON.parse(readFileSync(join(table.workspace, ".coc/module-campaigns", CAMPAIGN, "modules/book-1/deepen-queue.json"), "utf8"));
	const looked = queue.filter((job) => job.material === "map" && job.focus === "Harbor chart");
	assert.equal(looked.length, 1, "the map reading is queued in the background");
	assert.equal(looked[0].foreground, false);
});
