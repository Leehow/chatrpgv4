/**
 * Readiness is `missing`; `findings` is an opinion about the book (contract §45).
 *
 * BUG-039, two real tables: a Masks import whose opening neighbourhood held 22 nodes, an empty
 * `missing`, and one `clue_supports_nothing` -- a clue the book never connects to a conclusion.
 * That single quality finding turned `opening_ready` false, which turned the already-prepared
 * opening into a refused `module.read.request` (`state: "blocked"`, `missing: []`), which the host
 * recorded as a failed preparation. The tables could not take a turn: `turn.json` stayed at
 * `player_text: null` with an empty `turns/`, so the player's sentence was not kept anywhere.
 *
 * The shape that matters is the sequence, not the arithmetic: the opening is prepared and ready,
 * and *then* a later background detail reading of the same book brings a clue in. Nothing about
 * the table changed; more of the source was read. So these tests walk the product path -- bind,
 * index, opening, detail, campaign, setup, table -- and end on the only fact that settles it:
 * the player's own words reach `turn.json`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
const REFS = [{ page: 1 }];

/** A JSONL client for the product kernel, the transport `createRealCampaign` uses. */
function kernelClient(workspace) {
	const child = spawn(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace,
		"--content", join(REPO, "content")], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
	child.stdout.setEncoding("utf8");
	const waiting = new Map();
	let pending = "";
	child.stdout.on("data", chunk => {
		pending += chunk;
		let end;
		while ((end = pending.indexOf("\n")) >= 0) {
			const line = pending.slice(0, end).trim();
			pending = pending.slice(end + 1);
			if (!line) continue;
			let reply;
			try { reply = JSON.parse(line); } catch { continue; }
			waiting.get(reply.id)?.(reply);
			waiting.delete(reply.id);
		}
	});
	let ordinal = 0;
	const call = (method, params) => new Promise(resolve => {
		const id = `call-${++ordinal}`;
		waiting.set(id, resolve);
		child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
	});
	return {
		close: () => { child.stdin.end(); child.kill(); },
		err: async (method, params) => {
			const reply = await call(method, params);
			assert.equal(reply.ok, false, `${method} was expected to be refused`);
			return reply.error;
		},
		ok: async (method, params) => {
			const reply = await call(method, params);
			assert.equal(reply.ok, true, `${method}: ${JSON.stringify(reply.error)}`);
			return reply.result;
		},
	};
}

const write = (path, value) => writeFile(path, JSON.stringify(value), "utf8");

async function bind(kernel, home, marker = "the harbor") {
	const path = join(home, `original-${marker.replaceAll(" ", "-")}.pdf`);
	const bytes = Buffer.from(`%PDF-1.7\nsynthetic transport fixture (${marker}); not rendered or played\n`);
	await writeFile(path, bytes);
	const source = { path, file_sha256: createHash("sha256").update(bytes).digest("hex"), page_count: 2 };
	const { module_id } = await kernel.ok("module.source.bind", { source });
	return module_id;
}

async function observed(job, extra = {}) {
	await write(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256,
		read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2], ...extra });
}

async function finish(kernel, job) {
	return kernel.ok("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
		outcome: "completed", draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") });
}

/** The reviewed submission for one reading: every required pointer supported by an observed page. */
async function submit(kernel, job, draft, paths) {
	await observed(job);
	await write(join(job.work_dir, "draft.json"), draft);
	await write(join(job.work_dir, "review.json"), { missing: [],
		checked: paths.map(path => ({ path, verdict: "supported", source_refs: REFS, reason: "fixture support" })) });
	return finish(kernel, job);
}

/**
 * Bind, index, and prepare an opening whose neighbourhood is whole: Dock, Tower, Lena.
 * `entrances: 2` marks the Tower as a second entrance, which is the book naming two openings --
 * the case `missing` is for, and the one the kernel refuses to guess at.
 */
async function preparedBook(kernel, home, { entrances = 1, marker = "the harbor" } = {}) {
	const mid = await bind(kernel, home, marker);
	await kernel.ok("module.read.request", { module_id: mid, purpose: "index", focus: "", question: "" });
	const index = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	await observed(index);
	await write(join(index.work_dir, "draft.json"), { title: "The Harbor", language: "en",
		sections: [{ name: "The harbor and the tower", pages: [[1, 2]], topics: ["opening"],
			entities: ["Dock", "Tower", "Lena"], references: [] }] });
	await kernel.ok("module.read.finish", { module_id: mid, job_id: index.job_id, lease: index.lease,
		outcome: "completed", draft_path: join(index.work_dir, "draft.json") });

	await kernel.ok("module.read.request", { module_id: mid, purpose: "opening", focus: "", question: "" });
	const job = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	const draft = {
		nodes: [
			{ node_id: "scene-dock", node_kind: "scene", name: "Dock", source_refs: REFS, properties: { is_entrance: true } },
			{ node_id: "scene-tower", node_kind: "scene", name: "Tower", source_refs: [{ page: 2 }],
				summary: "An old tower beyond the harbor.",
				properties: entrances > 1 ? { is_entrance: true } : { is_final: true } },
			{ node_id: "npc-lena", node_kind: "npc", name: "Lena", source_refs: REFS,
				properties: { mechanics: { profile: { characteristics: { STR: 50 } } } } },
		],
		claims: [["scene-dock", "route-to", "scene-tower"], ["npc-lena", "present-in", "scene-dock"]].map(
			([subject_id, predicate, node_id]) => ({ subject_id, predicate, object: { node_id },
				truth_status: "authored-fact", source_refs: REFS })),
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-dock", "npc-lena"],
	};
	const result = await submit(kernel, job, draft, ["/nodes/0", "/nodes/2",
		"/nodes/2/properties/mechanics/profile/characteristics/STR", "/claims/0", "/claims/1", "/coverage"]);
	assert.equal(result.opening_ready, entrances === 1, "the whole opening neighbourhood is prepared");
	return mid;
}

/**
 * The later detail reading: one more clue of the book, placed in the opening scene and supporting
 * no conclusion. This is the real sequence -- the book is being read further, and nothing about
 * the table has changed.
 */
async function readOneMoreClue(kernel, mid) {
	await kernel.ok("module.read.request", { module_id: mid, purpose: "detail", focus: "Larkin",
		question: "What did the research note say?" });
	const job = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	const draft = {
		nodes: [{ node_id: "clue-larkin-research-destroyed", node_kind: "clue", name: "Larkin's research is destroyed",
			summary: "The research notes were burned before the investigators arrived.", source_refs: REFS,
			visibility: "keeper-only", properties: { delivery_kind: "physical_evidence" } }],
		claims: [{ subject_id: "clue-larkin-research-destroyed", predicate: "discoverable-at",
			object: { node_id: "scene-dock" }, truth_status: "authored-fact", source_refs: REFS }],
		node_refs: [], coverage: {}, dependencies: [], critical: [],
		ready_nodes: ["clue-larkin-research-destroyed"],
	};
	return submit(kernel, job, draft, ["/nodes/0", "/claims/0", "/coverage"]);
}

async function workspace(t) {
	const home = await mkdtemp(join(tmpdir(), "coc-opening-readiness-"));
	const kernel = kernelClient(home);
	t.after(() => { kernel.close(); return rm(home, { recursive: true, force: true }); });
	return { home, kernel };
}

test("a clue the book connects to no conclusion is reported, and does not revoke a prepared opening", async t => {
	const { home, kernel } = await workspace(t);
	const mid = await preparedBook(kernel, home);
	await readOneMoreClue(kernel, mid);

	const status = await kernel.ok("module.status", { module_id: mid });
	// The opinion is reported, in the same record, where `module.status` already reads it.
	assert.deepEqual(status.opening.finding_counts, { clue_supports_nothing: 1 });
	assert.equal(status.opening.findings[0].subject, "clue-larkin-research-destroyed");
	// Nothing the opening points at is absent, so the table can open on it.
	assert.deepEqual(status.opening.missing, []);
	assert.equal(status.opening.opening_ready, true);
	assert.equal(status.opening_ready, true);
});

test("readiness and its record agree: `opening_ready` is false exactly when `missing` names something", async t => {
	const { home, kernel } = await workspace(t);
	const mid = await preparedBook(kernel, home);
	await readOneMoreClue(kernel, mid);
	const withClue = (await kernel.ok("module.status", { module_id: mid })).opening;
	assert.equal(withClue.opening_ready, !withClue.missing.length);
	assert.ok(withClue.findings.length, "this book does carry an opinion, or the equivalence proves nothing");

	// The other direction, on the same kernel: a book that names two openings has something the
	// kernel will not guess at, so it is not ready and says which. Without this the equivalence
	// above would hold just as well for a constant `true`.
	const ambiguous = await preparedBook(kernel, home, { entrances: 2, marker: "two openings" });
	const twoWays = (await kernel.ok("module.status", { module_id: ambiguous })).opening;
	assert.equal(twoWays.opening_ready, false);
	assert.deepEqual(twoWays.findings, [], "this refusal is not an opinion about the graph");
	assert.deepEqual(twoWays.missing, ["start_scene_ambiguous:scene-dock,scene-tower"]);
	assert.equal(twoWays.opening_ready, !twoWays.missing.length);
});

test("a prepared opening stays requestable after the book is read further, instead of blocking with nothing named", async t => {
	const { home, kernel } = await workspace(t);
	const mid = await preparedBook(kernel, home);
	await readOneMoreClue(kernel, mid);

	// This is the call the host makes when it prepares the opening for a table. It used to answer
	// `state: "blocked", missing: []` -- a refusal naming nothing, which the reading service turned
	// into `needs`/`reading_failed` and the overlay into a failed preparation with no way out.
	const requested = await kernel.ok("module.read.request",
		{ module_id: mid, purpose: "opening", focus: "Dock", question: "" });
	assert.equal(requested.state, "ready");
	assert.deepEqual(requested.missing, []);
});

test("the table opens on that book and the player's own words reach the turn record", async t => {
	const { home, kernel } = await workspace(t);
	const mid = await preparedBook(kernel, home);
	await readOneMoreClue(kernel, mid);

	const campaign = "c-readiness";
	await kernel.ok("campaign.create", { id: campaign, module: mid, start_scene: "Dock", play_language: "en" });
	const profile = { name: "Helen", occupation: "Journalist", age: 29, sex: "female",
		concept: "A cautious local reporter seeking rent money.", own_language: "English",
		occupation_skills: ["Art and Craft (Photography)", "History", "Language (Own)", "Library Use",
			"Psychology", "Persuade", "Spot Hidden", "Listen"],
		interest_skills: ["Accounting", "Law", "First Aid", "Drive Auto"],
		backstory: { personal_description: "A practical coat", ideology_beliefs: "Evidence before rumors",
			significant_people: "An editor friend", scenario_bound: "Meeting Lena at the dock" },
		key_connection: { backstory_field: "significant_people", summary: "The editor friend" },
		equipment: ["Press card", "Notebook", "Camera", "Flashlight"] };
	const draft = await kernel.ok("setup.draft", { campaign, profile });
	await kernel.ok("setup.previewed", { campaign, revision: draft.revision });
	await kernel.ok("setup.confirm", { campaign, revision: draft.revision, consent: "approved" });

	// The gate that stranded two real tables. It reads the same readiness the status above reports.
	const handoff = await kernel.ok("setup.complete", { campaign });
	assert.equal(handoff.module_id, mid);

	await kernel.ok("table.open", { campaign });
	const said = "Helen sits down at the dock and asks Lena about the burned notes.";
	await kernel.ok("table.player_input", { campaign, text: said });
	const turn = JSON.parse(await readFile(join(home, ".coc", "campaigns", campaign, "turn.json"), "utf8"));
	assert.equal(turn.player_text, said, "a refused turn keeps the player's sentence nowhere");
	assert.ok(turn.turn >= 1);
});
