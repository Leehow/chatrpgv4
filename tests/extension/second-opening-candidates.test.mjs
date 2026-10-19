/**
 * A module's second authored opening is a start candidate, and the chosen opening is the table's scene
 * (contract §225; amends §14.14, §14.19, §22.9).
 *
 * The 1937 NKVD book (pdf-source-latency-opening-20261010): the reader brought the second briefing
 * (p.10 §2.2) into the graph related to the first by `alternative-to` and nothing else -- no
 * `is_entrance`, not in `entry_scene_ids`. `startSceneCandidates` admitted only those, so the book kept
 * one candidate, setup asked no question, `campaign.create` landed the first briefing as
 * `opening_scene`, and the Keeper handed the arrest warrant (card #1) in the opening that has none.
 *
 * The first test reads the kernel function directly over a synthetic graph; the rest drive the emitted
 * kernel (`build/kernel/rpc.mjs`) through the product path: bind, index, opening reading, status, create.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const REPO = resolve(import.meta.dirname, "../..");
const REFS = [{ page: 1 }];

/** The kernel's own `startSceneCandidates` and `resolveStartScene`, bundled from `kernel-ts/write/source.ts`. */
async function kernelApi(t) {
	const out = await mkdtemp(join(tmpdir(), "coc-second-opening-api-"));
	await symlink(join(REPO, "node_modules"), join(out, "node_modules"), "dir");
	t.after(() => rm(out, { recursive: true, force: true }));
	const file = join(out, "api.mjs");
	await build({ stdin: { contents: [
		`export { startSceneCandidates } from ${JSON.stringify(join(REPO, "kernel-ts/write/source.ts"))};`,
		`export { resolveStartScene } from ${JSON.stringify(join(REPO, "kernel-ts/modules/visual.ts"))};`,
		`export { loadModuleContract } from ${JSON.stringify(join(REPO, "kernel-ts/modules/contract.ts"))};`,
		`export { snapshots } from ${JSON.stringify(join(REPO, "kernel-ts/snapshots.ts"))};`].join("\n"),
		resolveDir: REPO, sourcefile: "second-opening-api.ts", loader: "ts" },
		outfile: file, bundle: true, packages: "external", platform: "node", format: "esm", target: "node22", logLevel: "silent" });
	const api = await import(pathToFileURL(file).href);
	const contract = await api.loadModuleContract({ content: join(REPO, "content"), snapshots: api.snapshots });
	return { api, dossier: contract.graph.actor_dossier, contract };
}

const scene = (node_id, name, properties = {}) => ({ node_id, node_kind: "scene", name, summary: `${name}.`, properties, source_refs: REFS });
const relation = (from_node_id, relation_kind, to_node_id) => ({ relation_id: `rel-${from_node_id}-${relation_kind}-${to_node_id}`, relation_kind, from_node_id, to_node_id, properties: {} });

test("a scene related to an entrance by `alternative-to` is a start candidate, in either direction and to its closure (§225.1)", async (t) => {
	const { api, dossier, contract } = await kernelApi(t);
	// The NKVD shape: one declared entrance, the second briefing `alternative-to` it with no entrance mark of its own,
	// a third reading of the first briefing `alternative-to` the second, and an `alternative-to` between two later scenes.
	const graph = { module_id: "book-1", nodes: [
		{ node_id: "module-book-1", node_kind: "module", name: "Book", properties: { entry_scene_ids: ["scene-source-entry-9"] }, source_refs: REFS },
		scene("scene-source-entry-9", "The investigators", { is_entrance: true }),
		scene("scene-investigator-introduction-2", "Investigator introduction 2", { keeper_notes: "A second authored opening." }),
		scene("scene-opening-1", "Opening 1"),
		scene("scene-farm", "The farm"),
		scene("scene-farm-by-night", "The farm by night"),
		{ node_id: "npc-aganin", node_kind: "npc", name: "Aganin", properties: {}, source_refs: REFS },
	], claims: [], relations: [
		relation("scene-investigator-introduction-2", "alternative-to", "scene-source-entry-9"),
		relation("scene-opening-1", "alternative-to", "scene-investigator-introduction-2"),
		relation("scene-farm-by-night", "alternative-to", "scene-farm"),
		relation("scene-source-entry-9", "route-to", "scene-farm"),
		relation("npc-aganin", "alternative-to", "scene-source-entry-9"),
	] };
	const candidates = api.startSceneCandidates(graph, dossier);
	assert.deepEqual(candidates.map((row) => row.node_id), ["scene-investigator-introduction-2", "scene-opening-1", "scene-source-entry-9"],
		"the alternatives of the entrance, and the alternative of that alternative; a farm's night variant and a person are not openings");
	const second = candidates.find((row) => row.node_id === "scene-investigator-introduction-2");
	assert.equal(second.name, "Investigator introduction 2");
	assert.equal(typeof second.scene, "string");
	assert.equal(api.resolveStartScene(graph, second.scene, contract), "scene-investigator-introduction-2", "the second opening can be chosen by its handle");
	assert.equal(api.resolveStartScene(graph, "Investigator introduction 2", contract), "scene-investigator-introduction-2", "or by its name");

	// The relation read the other way round admits the same scene.
	const reversed = { ...graph, relations: [relation("scene-source-entry-9", "alternative-to", "scene-investigator-introduction-2")] };
	assert.deepEqual(api.startSceneCandidates(reversed, dossier).map((row) => row.node_id), ["scene-investigator-introduction-2", "scene-source-entry-9"]);

	// A book with one entrance and no alternative is unchanged: one candidate, no question.
	const alone = { ...graph, relations: [relation("scene-source-entry-9", "route-to", "scene-farm")] };
	assert.deepEqual(api.startSceneCandidates(alone, dossier).map((row) => row.node_id), ["scene-source-entry-9"]);
});

/** A JSONL client for the product kernel, the transport the onboarding host uses. */
function kernelClient(workspace) {
	const child = spawn(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace,
		"--content", join(REPO, "content")], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
	child.stdout.setEncoding("utf8");
	const waiting = new Map();
	let pending = "";
	child.stdout.on("data", (chunk) => {
		pending += chunk;
		let end;
		while ((end = pending.indexOf("\n")) >= 0) {
			const line = pending.slice(0, end).trim();
			pending = pending.slice(end + 1);
			if (!line) continue;
			let reply;
			try { reply = JSON.parse(line); } catch { continue; }
			if (reply.progress) continue;
			waiting.get(reply.id)?.(reply);
			waiting.delete(reply.id);
		}
	});
	let ordinal = 0;
	const call = (method, params) => new Promise((resolve) => {
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

async function bind(kernel, home) {
	const path = join(home, "original-two-briefings.pdf");
	const bytes = Buffer.from("%PDF-1.7\nsynthetic transport fixture (two briefings); not rendered or played\n");
	await writeFile(path, bytes);
	const source = { path, file_sha256: createHash("sha256").update(bytes).digest("hex"), page_count: 2 };
	const { module_id } = await kernel.ok("module.source.bind", { source });
	return module_id;
}

async function observed(job) {
	await write(join(job.work_dir, "observations.json"), { file_sha256: job.source.file_sha256, read_pages: [1, 2], full_pages: [1, 2], review_pages: [1, 2] });
}

async function submit(kernel, job, draft, paths) {
	await observed(job);
	await write(join(job.work_dir, "draft.json"), draft);
	await write(join(job.work_dir, "review.json"), { missing: [], checked: paths.map((path) => ({ path, verdict: "supported", source_refs: REFS, reason: "fixture support" })) });
	return kernel.ok("module.read.finish", { module_id: job.module_id, job_id: job.job_id, lease: job.lease,
		outcome: "completed", draft_path: join(job.work_dir, "draft.json"), review_path: join(job.work_dir, "review.json") });
}

/**
 * The NKVD shape on the product kernel: the Briefing is the one marked entrance; the Second Briefing is
 * `alternative-to` it and nothing more; the Farm is where either leads. Both briefings are read.
 */
async function twoBriefings(kernel, home) {
	const mid = await bind(kernel, home);
	await kernel.ok("module.read.request", { module_id: mid, purpose: "index", focus: "", question: "" });
	const index = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	await observed(index);
	await write(join(index.work_dir, "draft.json"), { title: "Two briefings", language: "en",
		sections: [{ name: "The briefings and the farm", pages: [[1, 2]], topics: ["opening"], entities: ["Briefing", "Second Briefing", "Farm", "Aganin"], references: [] }] });
	await kernel.ok("module.read.finish", { module_id: mid, job_id: index.job_id, lease: index.lease, outcome: "completed", draft_path: join(index.work_dir, "draft.json") });

	await kernel.ok("module.read.request", { module_id: mid, purpose: "opening", focus: "", question: "" });
	const job = await kernel.ok("module.read.claim", { module_id: mid, owner: "test-host" });
	const draft = {
		nodes: [
			{ node_id: "scene-briefing", node_kind: "scene", name: "Briefing", summary: "The captain hands over the warrant.", source_refs: REFS, properties: { is_entrance: true } },
			{ node_id: "scene-second-briefing", node_kind: "scene", name: "Second Briefing", summary: "No warrant: find out why the harvest failed.", source_refs: [{ page: 2 }],
				properties: { keeper_notes: "A second authored opening, not a continuation of the first." } },
			{ node_id: "scene-farm", node_kind: "scene", name: "Farm", summary: "The state farm.", source_refs: [{ page: 2 }], properties: {} },
			{ node_id: "npc-aganin", node_kind: "npc", name: "Aganin", source_refs: REFS, properties: { mechanics: { profile: { characteristics: { STR: 50 } } } } },
		],
		claims: [["scene-second-briefing", "alternative-to", "scene-briefing"], ["scene-briefing", "route-to", "scene-farm"], ["scene-second-briefing", "route-to", "scene-farm"],
			["npc-aganin", "present-in", "scene-briefing"], ["npc-aganin", "present-in", "scene-second-briefing"]].map(
			([subject_id, predicate, node_id]) => ({ subject_id, predicate, object: { node_id }, truth_status: "authored-fact", source_refs: REFS })),
		node_refs: [], coverage: {}, dependencies: [], critical: [], ready_nodes: ["scene-briefing", "scene-second-briefing", "scene-farm", "npc-aganin"],
	};
	await submit(kernel, job, draft, ["/nodes/0", "/nodes/1", "/nodes/2", "/nodes/3", "/nodes/3/properties/mechanics/profile/characteristics/STR",
		"/claims/0", "/claims/1", "/claims/2", "/claims/3", "/claims/4", "/coverage"]);
	return mid;
}

async function workspace(t) {
	const home = await mkdtemp(join(tmpdir(), "coc-second-opening-"));
	const kernel = kernelClient(home);
	t.after(() => { kernel.close(); return rm(home, { recursive: true, force: true }); });
	return { home, kernel };
}

test("the product kernel reports both briefings as opening candidates and the chosen second one is the campaign's opening scene (§225.1-2)", async (t) => {
	const { home, kernel } = await workspace(t);
	const mid = await twoBriefings(kernel, home);

	const status = await kernel.ok("module.status", { module_id: mid });
	assert.deepEqual(status.opening_candidates.map((row) => row.node_id), ["scene-briefing", "scene-second-briefing"],
		`the second briefing is a candidate though only alternative-to marks it: ${JSON.stringify(status.opening_candidates)}`);
	const second = status.opening_candidates.find((row) => row.node_id === "scene-second-briefing");

	// The library choice the setup host records for a campaign that already exists resolves the second opening too.
	const chosen = await kernel.ok("module.opening.choose", { module_id: mid, scene: second.scene });
	assert.equal(chosen.start_scene, "scene-second-briefing");

	const campaign = "c-second-briefing";
	const created = await kernel.ok("campaign.create", { id: campaign, module: mid, start_scene: second.scene, play_language: "en" });
	const meta = JSON.parse(await readFile(join(home, ".coc", "campaigns", campaign, "campaign.json"), "utf8"));
	assert.equal(typeof meta.opening_scene, "string");
	assert.equal(created.campaign.opening_scene, meta.opening_scene);
	// §185.4: a name-free campaign shows a book scene by its interim handle, `scene-` + six hex digits of sha256(node id).
	// The opening and the world's active scene are the second briefing's handle, not the first's.
	const interim = (id) => `scene-${createHash("sha256").update(id).digest("hex").slice(0, 6)}`;
	assert.equal(meta.opening_scene, interim("scene-second-briefing"), "opening_scene names the second briefing");
	assert.notEqual(meta.opening_scene, interim("scene-briefing"), "and not the briefing the player did not choose");
	const world = JSON.parse(await readFile(join(home, ".coc", "campaigns", campaign, "world.json"), "utf8"));
	assert.equal(world.active_scene, meta.opening_scene, "the table's active scene is the chosen opening, so the capsule's scene assets are its");

	// A choice the book does not offer is still refused with the candidates.
	const refused = await kernel.err("module.opening.choose", { module_id: mid, scene: "the cellar" });
	assert.equal(refused.code, "needs_choice");
	assert.deepEqual(refused.details.candidates.map((row) => row.node_id), ["scene-briefing", "scene-second-briefing"]);
});
