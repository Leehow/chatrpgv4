/**
 * An installed opening has a way on (contract §90).
 *
 * BUG-H35/BUG-H38, A-SIDE t6: one 41-page PDF read three times produced three different graphs,
 * and all three published `status: "installed"`, `opening_ready: true`. The ledger's verdict was
 * that the worst draw -- an entrance whose single `route-to` pointed at a scene carrying nothing
 * but a `runtime_projection` record naming `story-graph.json`, a file the module directory does
 * not contain -- should not have installed.
 *
 * The first test below is that exact shape, and it asserts the opposite: it installs, and it
 * should. `runtime_projection.document` is a legacy seven-file label written by `assembleVisual`
 * for every scene node; nothing in the kernel or the extensions ever opens it as a file, and the
 * record it names is inline. An unread neighbour behind the entrance is the normal published
 * shape: `checkOpeningBatch` requires an opening batch to prepare exactly one scene, and
 * `apply move` reads the destination's pages in the foreground through its own material gate.
 * Gating readiness on either would refuse every PDF book the product knows how to make.
 *
 * What `missing` really never accounted for is the case underneath: a start scene that publishes
 * no exit at all. `sceneExits` is then empty, so §49's route rows have nothing to report -- not a
 * locked way, not an unread way, no way -- and the table has no way out of the first scene.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
const REFS = [{ page: 1 }];

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
	const call = (method, params) => new Promise(done => {
		const id = `call-${++ordinal}`;
		waiting.set(id, done);
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

async function bind(kernel, home, marker) {
	const path = join(home, `original-${marker}.pdf`);
	const bytes = Buffer.from(`%PDF-1.7\nsynthetic transport fixture (${marker}); not rendered or played\n`);
	await writeFile(path, bytes);
	const source = { path, file_sha256: createHash("sha256").update(bytes).digest("hex"), page_count: 2 };
	const { module_id } = await kernel.ok("module.source.bind", { source });
	return module_id;
}

/**
 * Bind, index, and submit one opening reading. `onward` is what the book says about where the
 * entrance leads; everything else is held identical across the three books below.
 *
 * The second scene is deliberately the stub shape t6 published: a name, a summary, a source ref,
 * and no prepared material -- it is not in `ready_nodes`, so `materialReady` is false for it and
 * `assembleVisual` gives it the bare `runtime_projection` record naming `story-graph.json`.
 */
async function readOpening(kernel, home, marker, onward) {
	const mid = await bind(kernel, home, marker);
	await kernel.ok("module.read.request", { module_id: mid, purpose: "index", focus: "", question: "" });
	const index = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	await write(join(index.work_dir, "observations.json"),
		{ file_sha256: index.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2] });
	await write(join(index.work_dir, "draft.json"), { title: "The Wave Treader", language: "en",
		sections: [{ name: "The boat and the shore", pages: [[1, 2]], topics: ["opening"],
			entities: ["Wave Treader", "Dunwich", "Gould"], references: [] }] });
	await kernel.ok("module.read.finish", { module_id: mid, job_id: index.job_id, lease: index.lease,
		outcome: "completed", draft_path: join(index.work_dir, "draft.json") });

	await kernel.ok("module.read.request", { module_id: mid, purpose: "opening", focus: "", question: "" });
	const job = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	const claim = ([subject_id, predicate, node_id]) => ({ subject_id, predicate, object: { node_id },
		truth_status: "authored-fact", source_refs: REFS });
	const nodes = [
		{ node_id: "scene-adventure-begins", node_kind: "scene", name: "Adventure begins", source_refs: REFS,
			summary: "A smuggler's boat off the Dunwich shore, minutes before the storm.",
			properties: { is_entrance: true, ...(onward.is_final ? { is_final: true } : {}) } },
		{ node_id: "npc-captain-gould", node_kind: "npc", name: "Captain Gould", source_refs: REFS,
			properties: { mechanics: { profile: { characteristics: { STR: 55 } } } } },
	];
	const claims = [claim(["npc-captain-gould", "present-in", "scene-adventure-begins"])];
	const paths = ["/nodes/0", "/nodes/1", "/nodes/1/properties/mechanics/profile/characteristics/STR",
		"/claims/0", "/coverage"];
	if (onward.route) {
		nodes.push({ node_id: "scene-dunwich-1287", node_kind: "scene", name: "Dunwich, 1287",
			source_refs: [{ page: 2 }], summary: "The time loop the boat falls into." });
		claims.push(claim(["scene-adventure-begins", "route-to", "scene-dunwich-1287"]));
		paths.push("/nodes/2", "/claims/1");
	}
	await write(join(job.work_dir, "observations.json"),
		{ file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2] });
	await write(join(job.work_dir, "draft.json"), { nodes, claims, node_refs: [], coverage: {},
		dependencies: [], critical: [], ready_nodes: ["scene-adventure-begins", "npc-captain-gould"] });
	await write(join(job.work_dir, "review.json"), { missing: [],
		checked: paths.map(path => ({ path, verdict: "supported", source_refs: REFS, reason: "fixture support" })) });
	const finish = { module_id: mid, job_id: job.job_id, lease: job.lease, outcome: "completed",
		draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") };
	return { mid, finish };
}

async function workspace(t) {
	const home = await mkdtemp(join(tmpdir(), "coc-opening-way-on-"));
	const kernel = kernelClient(home);
	t.after(() => { kernel.close(); return rm(home, { recursive: true, force: true }); });
	return { home, kernel };
}

test("the t6 shape installs: an unread neighbour behind the entrance is a way on, and no file redeems it", async t => {
	const { home, kernel } = await workspace(t);
	const { mid, finish } = await readOpening(kernel, home, "t6-shape", { route: true });
	const published = await kernel.ok("module.read.finish", finish);
	assert.equal(published.opening_ready, true);

	const status = await kernel.ok("module.status", { module_id: mid });
	assert.deepEqual(status.opening.missing, []);
	assert.equal(status.opening.start_scene, "scene-adventure-begins");
	assert.equal(status.status, "installed");

	// The exit target carries exactly what t6's did, and the document it names is nowhere on disk.
	const dir = join(home, ".coc", "modules", mid);
	const files = await readdir(dir, { recursive: true });
	const graph = JSON.parse(await readFile(join(dir, files.find(name => name.endsWith("module-graph.json"))), "utf8"));
	const exit = graph.nodes.find(node => node.node_id === "scene-dunwich-1287");
	assert.equal(exit.properties.runtime_projection.document, "story-graph.json");
	assert.equal(exit.properties.runtime_projection.record.scene_id, "dunwich-1287");
	assert.equal(files.filter(name => name.includes("story-graph")).length, 0,
		"no such file is ever written, for any book: the record the label names is inline");

	// And the exit is the entrance's only way on while its own pages are still unread: that is the
	// published shape `checkOpeningBatch` requires, redeemed by `apply move`'s material gate.
	assert.deepEqual(graph.relations.filter(rel => rel.from_node_id === "scene-adventure-begins"
		&& rel.relation_kind === "route-to").map(rel => rel.to_node_id), ["scene-dunwich-1287"]);
});

test("an entrance with no way on is not ready, and the refusal says what to add without saying what to delete", async t => {
	const { home, kernel } = await workspace(t);
	const { mid, finish } = await readOpening(kernel, home, "one-room", { route: false });

	// The publication itself is refused: nothing is installed, and the reader is asked for the
	// one thing the pages can answer.
	const error = await kernel.err("module.read.finish", finish);
	assert.equal(error.code, "invalid_params");
	assert.match(error.message, /way_on/);
	assert.match(error.message, /publishes no way on/);
	assert.match(error.message, /route-to, play-precedes, may-lead-to, alternative-to or hands-off-to/);
	assert.match(error.message, /is_final on this scene/);
	assert.match(error.message, /do not remove anything to satisfy this/);
	assert.doesNotMatch(error.message, /story-graph/,
		"the fix is executed literally: it may not send a reader after a file no book has");

	const status = await kernel.ok("module.status", { module_id: mid });
	assert.equal(status.opening_ready, false);
	assert.notEqual(status.status, "installed");
});

test("a book that ends in its first scene is ready with no exit at all: the gate is accounting, not an opinion", async t => {
	const { home, kernel } = await workspace(t);
	const { mid, finish } = await readOpening(kernel, home, "one-scene-book", { route: false, is_final: true });
	const published = await kernel.ok("module.read.finish", finish);
	assert.equal(published.opening_ready, true);

	const status = await kernel.ok("module.status", { module_id: mid });
	assert.deepEqual(status.opening.missing, []);
	assert.equal(status.status, "installed");
});
