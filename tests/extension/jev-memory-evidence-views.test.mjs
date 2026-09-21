/** Shared T09 evidence projections retain authority and closed attribution at every consumer. */
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "../..");
let api, bundle;
before(async () => {
	bundle = await mkdtemp(join(tmpdir(), "jev-memory-evidence-"));
	const outfile = join(bundle, "memory-evidence.mjs");
	await build({ stdin: { contents: [
		"export {ModuleGraph} from './kernel-ts/read/module-graph.ts';",
		"export {EntityIndex,memoryEvidenceView,hitView,capsuleMemory,fromOtherLines,promiseObligations} from './kernel-ts/read/memory.ts';",
		"export {continuityAuditContext} from './kernel-ts/mods/continuity-audit.ts';",
	].join("\n"), resolveDir: ROOT, sourcefile: "memory-evidence-entry.ts", loader: "ts" },
		bundle: true, packages: "external", platform: "node", format: "esm", target: "node22", outfile });
	api = await import(pathToFileURL(outfile).href);
});
after(async () => { if (bundle) await rm(bundle, { recursive: true, force: true }); });

const speech = { kind: "speech", speaker: { name: "Mr. Dooley", kind: "npc" } };
const source = { turn: 2, commit: "commit", episode_id: "ep:t2", receipts: [] };
function candidate(overrides = {}) {
	return { id: "mem:t2-1", kind: "promise", subject: "Thomas", knowers: [], entities: ["Thomas"],
		statement: "I will return.", privacy: "player_safe", state: "accurate", confidence: null,
		status: "candidate", source, worldline: "main", loop: 1, valid_from_turn: 2,
		job_id: "extract:c:t2", memory_version: 2, attribution: speech, relations: [], ...overrides };
}

test("legacy rows stay shape-compatible while every v2 malformed or missing attribution fails closed to unknown", () => {
	const legacy = candidate({ memory_version: undefined, attribution: undefined });
	delete legacy.memory_version;
	delete legacy.attribution;
	assert.deepEqual(api.memoryEvidenceView(legacy), { authority: "conversation_report" });
	assert.equal(Object.hasOwn(api.hitView(legacy), "attribution"), false);

	for (const row of [candidate({ attribution: undefined }), candidate({ attribution: { kind: "speech" } }),
		candidate({ attribution: { kind: "speech", speaker: { name: "", kind: "npc" } } }),
		candidate({ attribution: { kind: "player", speaker: { name: "forged", kind: "npc" } } })]) {
		const view = api.memoryEvidenceView(row);
		assert.deepEqual(view, { authority: "conversation_report", attribution: { kind: "unknown" } });
	}
	assert.deepEqual(api.hitView(candidate()).attribution, speech);
});

test("promise, capsule, and cross-line consumers use the shared authority and attribution projection", () => {
	const graph = new api.ModuleGraph("fixture", { nodes: [], relations: [], claims: [] }, "digest", {});
	const index = new api.EntityIndex(graph, [{ id: "thomas", name: "Thomas" }]);
	const playerPromise = candidate({ id: "mem:t1-1", statement: "The player reports a promise.", loop: 0,
		valid_from_turn: 1, attribution: { kind: "player" } });
	const spokenPromise = candidate({ id: "mem:t2-1", statement: "The NPC speaks a promise." });
	const malformed = candidate({ id: "mem:t3-1", kind: "knowledge", statement: "Malformed v2 evidence.", attribution: undefined,
		worldline: "alternate", loop: 1, valid_from_turn: 3 });
	const legacy = candidate({ id: "mem:t0-1", kind: "belief", statement: "Legacy evidence.", memory_version: undefined,
		attribution: undefined, loop: 0, valid_from_turn: 0 });
	delete legacy.memory_version;
	delete legacy.attribution;
	const rows = [legacy, playerPromise, spokenPromise, malformed];

	const obligations = api.promiseObligations(rows);
	assert.deepEqual(obligations.map(row => [row.state, row.authority, row.attribution]), [
		[playerPromise.statement, "conversation_report", { kind: "player" }],
		[spokenPromise.statement, "conversation_report", speech],
	]);
	const capsule = api.capsuleMemory(rows, index, ["Thomas"]);
	assert.ok(capsule.every(row => row.authority === "conversation_report"));
	assert.deepEqual(capsule.find(row => row.id === malformed.id).attribution, { kind: "unknown" });
	assert.equal(Object.hasOwn(capsule.find(row => row.id === legacy.id), "attribution"), false);
	const across = api.fromOtherLines(rows, index, "Thomas", "main", 2, 8);
	assert.ok(across.every(row => row.authority === "conversation_report"));
	assert.deepEqual(across.find(row => row.statement === spokenPromise.statement).attribution, speech);
	assert.deepEqual(across.find(row => row.statement === playerPromise.statement).attribution, { kind: "player" });
});

test("the actual continuity-audit memory and correction projections retain shared evidence metadata", async () => {
	const raw = JSON.parse(await readFile(join(ROOT, "content/starters/the-haunting/module-graph.json"), "utf8"));
	const graph = new api.ModuleGraph("the-haunting", raw, "digest", {});
	const belief = candidate({ id: "mem:t2-1", kind: "belief", subject: "player", entities: [], statement: "The player suspects a link.",
		attribution: { kind: "player" } });
	const correction = candidate({ id: "mem:t2-2", kind: "keeper_correction", subject: "keeper", entities: [],
		statement: "The earlier report was withdrawn.", attribution: { kind: "keeper_narration" }, corrects: [] });
	const world = { active_scene: "commission-briefing", discovered_clues: [], npc_presence: {}, scene_labels: {}, clock: { minutes: 0 } };
	const turn = { player_text: "I reconsider.", receipts: [], capsule: {} };
	const view = api.continuityAuditContext(graph, world, turn, [{ id: "thomas-hayes", name: "托马斯·海斯", equipment: [] }],
		{ "history.json": [], "memory.json": [belief, correction] });
	const projectedBelief = view.memory.find(row => row.statement === belief.statement);
	const projectedCorrection = view.corrections.find(row => row.statement === correction.statement);
	assert.deepEqual({ authority: projectedBelief.authority, attribution: projectedBelief.attribution },
		{ authority: "conversation_report", attribution: { kind: "player" } });
	assert.deepEqual({ authority: projectedCorrection.authority, attribution: projectedCorrection.attribution },
		{ authority: "conversation_report", attribution: { kind: "keeper_narration" } });
});
