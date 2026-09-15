/**
 * A destination's identity has to survive to whoever judges a move (contract §32).
 *
 * The module writes what a scene is: `the-haunting`'s `scene-newspaper-morgue` carries
 * `destination_identity.canonical_name` "Boston Globe offices" and five aliases for the same place.
 * Until 2026-09-15 that field had no reader anywhere in the product -- `entityView` stripped the
 * whole projection record -- so the action-admission reviewer was handed
 * `{"handle":"newspaper-morgue","label":"newspaper-morgue","summary":"scene newspaper morgue"}`:
 * the slug, the slug again, and the slug de-slugged. Three turns of a live table stalled on it, and
 * then two more from the opposite side, with the reviewer reading the one node as the single room
 * its slug names:
 *
 *   turn 83: "I push open the door of the Globe and go to Wilmot's counter"
 *            -> not_authorized: the lobby is not the clipping-room scene.
 *   turn 86: "I go to the clipping room; on the way in I ask Wilmot's permission first"
 *            -> not_authorized: "Direct morgue move skips that."
 *
 * A place refused from both sides cannot be reached by any wording the player has. Both directions
 * are covered here, and both travel the product path: a real kernel over the module on disk, the
 * real extension tool path, and the exact text the review model was handed.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const MODULE_GRAPH = join(ROOT, "content/starters/the-haunting/module-graph.json");

/** The product kernel over its own RPC, one workspace, requests in order. */
function kernel(t, requests) {
	const workspace = mkdtempSync(join(tmpdir(), "coc-place-identity-"));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	const run = spawnSync(
		process.execPath,
		[join(ROOT, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(ROOT, "content")],
		{ cwd: ROOT, input: requests.map((request, index) => JSON.stringify({ id: String(index), ...request })).join("\n") + "\n", encoding: "utf8" },
	);
	const answers = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
	assert.equal(answers.length, requests.length, `${run.stderr}\n${run.stdout}`);
	return answers;
}

/** The authored material this whole seam exists to carry. Read it, do not restate it. */
const authoredIdentity = async (sceneNodeId) => {
	const graph = JSON.parse(await readFile(MODULE_GRAPH, "utf8"));
	const node = graph.nodes.find((entry) => entry.node_id === sceneNodeId);
	assert.ok(node, `${sceneNodeId} is in the module on disk`);
	const identity = node.properties?.runtime_projection?.record?.destination_identity;
	assert.ok(identity?.canonical_name, `${sceneNodeId} carries an authored destination identity`);
	return identity;
};

/** The extension's own modules, compiled the way the product compiles them. */
async function loadExtensionApi(t) {
	const temporary = await mkdtemp(join(tmpdir(), "coc destination identity "));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	const outfile = join(temporary, "api.mjs");
	await build({
		stdin: {
			contents: `export {admissionSystemPrompt, admissionRequest, registeredDestination} from ${JSON.stringify(join(ROOT, "extensions/kernel/admission.ts"))};`,
			resolveDir: ROOT,
			sourcefile: "destination-identity-api.ts",
			loader: "ts",
		},
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "silent",
	});
	return import(pathToFileURL(outfile).href);
}

/** The `registered_destination=` payload out of one reviewed proposal line. */
function registeredPayload(line) {
	const marker = "registered_destination=";
	const at = line.indexOf(marker);
	assert.notEqual(at, -1, `the reviewed move carries a registered destination: ${line}`);
	return JSON.parse(line.slice(at + marker.length));
}

const CAMPAIGN = "destination-identity";
/** The player's own words from the two stalled turns, in the language the table was played in. */
const EXTERIOR = "我推开环球报的门，先去威尔莫特的柜台。";
const INTERIOR_WITH_GATEKEEPER = "我去剪报室，但进门先找到威尔莫特问他允不允许，我不绕过他。";

function turn(playerFacing) {
	return [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "newspaper-morgue", travel_minutes: 20 }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: playerFacing })], { stopReason: "toolUse" }),
		fauxAssistantMessage("守秘人自写的收尾，应被内核的交付替换。"),
	];
}

test("the reviewer is handed the place the module authored, not the handle's slug", async (t) => {
	const identity = await authoredIdentity("scene-newspaper-morgue");
	const table = await openTable({
		realKernel: true,
		campaign: CAMPAIGN,
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙放下，说前一家租户出了事。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("开场之后的多余正文。"),
			...turn("你走进报社的大厅。"),
			...turn("威尔莫特抬起头。"),
		],
		// The live table refused the first of these two turns, so the second proposed the same move
		// again. Scripted the same way here: a landed move would make the second one a rename of the
		// scene underfoot, which is not a proposal and is never reviewed.
		laneResponses: { admission: [fauxAssistantMessage(JSON.stringify({ verdict: "not_authorized", grounds: "scripted refusal, as the live table answered", missing: "which door they go in by" }))] },
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });

	// Both stalled directions, each as its own turn through the real tool path.
	await table.session.prompt(EXTERIOR);
	await table.session.prompt(INTERIOR_WITH_GATEKEEPER);

	const requests = table.lanes.admission.requests();
	assert.equal(requests.length, 2, `each turn's move was reviewed once: ${requests.length}`);
	for (const [index, request] of requests.entries()) {
		const line = request.split("\n").find((row) => row.includes("registered_destination="));
		const payload = registeredPayload(line);
		// The handle still travels -- it is what `apply` will be given -- but it is no longer the
		// only thing the reviewer can read the destination off.
		assert.equal(payload.handle, "newspaper-morgue", `turn ${index}: the handle is still named`);
		assert.equal(payload.canonical_name, identity.canonical_name, `turn ${index}: the module's own name for the place reaches the review`);
		for (const alias of identity.aliases)
			assert.ok(payload.also_called.includes(alias), `turn ${index}: the alias ${JSON.stringify(alias)} reaches the review`);
		// Direction A is decided by this: the player's words name the Globe, and only an alias ties
		// that to a scene handled `newspaper-morgue`.
		assert.ok(payload.also_called.some((name) => /Globe/i.test(name)), `turn ${index}: ${JSON.stringify(payload)}`);
	}
	// The words that stalled the table are the words the review was asked about.
	assert.ok(requests[0].includes(EXTERIOR), "the exterior turn's own words reached the review");
	assert.ok(requests[1].includes(INTERIOR_WITH_GATEKEEPER), "the interior-plus-gatekeeper turn's own words reached the review");
});

test("a scene answers to the names the module gives its place, so a Keeper can look the destination up by one", async (t) => {
	const identity = await authoredIdentity("scene-newspaper-morgue");
	const alias = identity.aliases[0];
	const table = await openTable({
		realKernel: true,
		campaign: `${CAMPAIGN}-lookup`,
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙放下。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("开场之后的多余正文。"),
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "module", query: alias, expected_kind: "scene" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "报社在城的另一头。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("多余正文。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt(`我们去${alias}。`);

	const result = table.session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "lookup")
		.map((message) => message.details)
		.at(-1);
	assert.ok(result, "the lookup reached the real kernel");
	// Not found is not neutral here: that branch tells the Keeper to *prepare* the destination,
	// which adapts a second scene into the campaign for a place the book already registered.
	assert.notEqual(result.status, "not_found", `${JSON.stringify(alias)} is a registered scene: ${JSON.stringify(result)}`);
	assert.ok(result.entities.some((entity) => entity.name === "newspaper-morgue"), JSON.stringify(result.entities?.map((entity) => entity.name)));
	const found = result.entities.find((entity) => entity.name === "newspaper-morgue");
	assert.equal(found.destination_identity.canonical_name, identity.canonical_name);
});

test("the move rule tells the reviewer what a registered scene is the grain of", async (t) => {
	const api = await loadExtensionApi(t);
	const prompt = api.admissionSystemPrompt();

	// The names, so the reviewer reads the destination off them and not off the handle.
	assert.match(prompt, /canonical_name is the module's own name for the place/);
	assert.match(prompt, /also_called/);
	assert.match(prompt, /handle is a file name/);
	// The grain, so a move to a scene is arrival at the place, not a claim about how far inside.
	// Direction B is decided by this: without it, "I go to the clipping room but see Wilmot first"
	// reads as a move that skips the gatekeeper, and the identity alone does not answer it.
	assert.match(prompt, /A registered scene is the module's whole grain for a place/);
	assert.match(prompt, /threshold/);
	assert.match(prompt, /remain proposals of their own, judged on their own/);
	assert.match(prompt, /refused from both sides cannot be reached by any wording/);
});

test("a move to a name the module already owns lands on the registered scene, with nothing adapted", async (t) => {
	const identity = await authoredIdentity("scene-newspaper-morgue");
	const table = await openTable({
		realKernel: true,
		campaign: `${CAMPAIGN}-move`,
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "诺特把钥匙放下。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("多余正文。"),
			// The name the player used, handed straight to `move.to`: no lookup, no adaptation.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: identity.aliases[0], via: "走过去" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你走进报社。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("多余正文。"),
		],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	await table.session.prompt(`我们去${identity.aliases[0]}。`);

	const record = JSON.parse(await readFile(join(table.workspace, ".coc/campaigns", `${CAMPAIGN}-move`, "turns", "0001.json"), "utf8"));
	const move = record.receipts.find((receipt) => receipt.kind === "move");
	assert.ok(move, JSON.stringify(record.receipts));
	assert.equal(move.to, "newspaper-morgue", JSON.stringify(move));
	// And the receipt names the place, not the slug, so the Keeper writing the arrival has it.
	assert.equal(move.to_label, identity.canonical_name, JSON.stringify(move));
	const world = JSON.parse(await readFile(join(table.workspace, ".coc/campaigns", `${CAMPAIGN}-move`, "world.json"), "utf8"));
	assert.equal(world.active_scene, "newspaper-morgue", JSON.stringify(world.active_scene));
	// Nothing was adapted for a place the module already had.
	assert.deepEqual(world.adaptation?.records ?? [], [], JSON.stringify(world.adaptation));
});

test("a place the module already registers is not adapted a second time", async (t) => {
	const campaign = "place-containment";
	const prepare = (name, request) => ({
		method: "adaptation.prepare",
		params: { campaign, name, purpose: "new_destination", request, anchors: ["scene: commission-briefing"] },
	});
	const [created, opened, , sameBuilding, elsewhere] = kernel(t, [
		{ method: "campaign.create", params: { id: campaign, module: "the-haunting", pregen: "thomas-hayes", play_language: "en", title: "containment" } },
		{ method: "table.open", params: { campaign } },
		{ method: "table.player_input", params: { campaign, text: "I go into the Globe and stand at Wilmot's counter." } },
		// The live request, word for word in substance: the lobby and the counter of the Globe.
		prepare("Boston Globe lobby", "The player stands in the lobby at Wilmot's counter and does not go past the iron door."),
		// A place of its own, whose name no registered identity covers.
		prepare("Innsmouth ferry landing", "The player takes the coast road to a harbour town the commission never named."),
	]);
	assert.equal(created.ok, true, JSON.stringify(created));
	assert.equal(opened.ok, true, JSON.stringify(opened));

	assert.equal(sameBuilding.ok, false, JSON.stringify(sameBuilding));
	assert.equal(sameBuilding.error.details.reason, "same_place", JSON.stringify(sameBuilding.error));
	assert.equal(sameBuilding.error.details.scene, "newspaper-morgue", JSON.stringify(sameBuilding.error.details));
	// The refusal has to be actionable, or the Keeper mints the duplicate through another door.
	assert.match(sameBuilding.error.fix, /Move to "newspaper-morgue"/);
	assert.match(sameBuilding.error.fix, /narrate the part the player named/);

	// A genuinely different place is still the adaptation path's business: the guard must not be
	// the new way to refuse everything.
	assert.notEqual(elsewhere.ok === false && elsewhere.error.details?.reason, "same_place", JSON.stringify(elsewhere));
});

test("a destination with no authored identity is described exactly as it was before", async (t) => {
	const api = await loadExtensionApi(t);
	// The addition is additive: a module that names no place for a scene loses nothing and gains
	// no empty fields to reason about.
	const bare = api.registeredDestination("cellar", { name: "cellar", display_name: "地窖", summary: "scene cellar" });
	assert.deepEqual(bare, { requested: "cellar", handle: "cellar", label: "地窖", summary: "scene cellar" });
	const proposal = api.admissionRequest("apply", { effects: [{ kind: "move", to: "cellar" }] }, { party: ["Alice"], destinations: [bare] });
	assert.match(proposal.lines[0], /registered_destination=\{"handle":"cellar","label":"地窖","summary":"scene cellar"\}/);
});
