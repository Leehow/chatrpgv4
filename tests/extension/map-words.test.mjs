/**
 * The play language of a session map card (contract §39.2, 2026-09-14).
 *
 * `apply map` makes the Keeper write the card's words in `play_language`. The first-arrival card has
 * no Keeper in its path: the kernel mints it inside `apply move`, out of the module's own authored
 * labels. Retained live evidence (campaign `game-5779d0fd-7dac-41de-b1f5-1a0f05132e2a`, turn 2, a
 * table whose `play_language` is `zh-Hans`) had one map title, nine region labels and three level
 * labels reach the player in English while every other mechanics row that turn was in the play
 * language, because both paths produce the same projection shape and only one of them was ever
 * required to carry projected words.
 *
 * What these tests pin: the kernel says which leg wrote a card's words; the module's authored words
 * ride `table.open` so the lane can run before an arrival needs them; the lane projects and caches
 * them without a language table anywhere; the delivery hop substitutes them; and a card whose words
 * are not ready still goes out -- saying so, and leaving a telemetry row -- rather than quietly
 * shipping the author's language.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
	AUTHORED_MAP_WORDS, KEEPER_MAP_WORDS, acceptedMapTexts, mapCardTexts, mapWordsCachePath,
	mapWordsDigest, prepareMapWords, projectMapCard, readMapWords, validateMapPresentation,
} from "../../extensions/module/map-presentation.ts";
import { issuePresentationReferences, PRESENTATION_REFERENCE_PROTOCOL } from "../../runtime/jev/presentation-references.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor } from "./harness.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const sourceText = source => source.text;
const response = (packet, drop = [], translate = text => `<${text}>`) => ({protocol:PRESENTATION_REFERENCE_PROTOCOL,
	texts:packet.sources.filter(source=>!drop.includes(source.text)).map(source=>({source:source.alias,action:'translate',text:translate(source.text)}))});

/** The kernel halves this seam needs, emitted the way the other kernel-facing suites emit theirs. */
const kernelBundle = await (async () => {
	const directory = await mkdtemp(join(tmpdir(), "map-words-kernel-"));
	const outfile = join(directory, "api.mjs");
	await build({
		stdin: {
			contents: "export {authoredMapWords, AUTHORED_WORDS, KEEPER_WORDS} from './kernel-ts/read/maps.ts';\n"
				+ "export {mechanics} from './kernel-ts/read/mechanics.ts';\n"
				+ "export {ModuleGraph} from './kernel-ts/read/module-graph.ts';\n",
			resolveDir: REPO, sourcefile: "map-words-api.ts",
		},
		outfile, bundle: true, packages: "external", platform: "node", format: "esm", target: "node22", logLevel: "silent",
	});
	return import(pathToFileURL(outfile).href);
})();

/** A module with one published map: two player-safe rooms on two floors, and one room behind reviewed redactions. */
function moduleGraph() {
	return new kernelBundle.ModuleGraph("the-haunting", {
		nodes: [
			{ node_id: "asset-plan", node_kind: "asset", name: "plan", visibility: "player-safe", properties: {} },
			{ node_id: "asset-private", node_kind: "asset", name: "private", visibility: "private", properties: {} },
			{
				node_id: "handout-map", node_kind: "handout", name: "house map", visibility: "player-safe",
				properties: {
					display_name: "Corbitt House Investigator Map",
					map_regions: [
						// Boxes are whole numbers here: a graph off disk carries Python floats, and a bare
						// JavaScript fraction is not one. The geometry is irrelevant to what a card says.
						{ region_id: "upper-west-bedroom", name: "West bedroom", level: "Upper Story", source_asset: "asset-plan", source_box: [0, 0, 1, 1], placement: [0, 0, 1, 1] },
						{ region_id: "ground-entry-hall", name: "Ground-floor entry hall", level: "Ground Floor", source_asset: "asset-plan", source_box: [0, 0, 1, 1], placement: [0, 0, 1, 1] },
						{ region_id: "basement-vault", name: "The vault of the Corbitt line", level: "Basement", source_asset: "asset-private", source_box: [0, 0, 1, 1], placement: [0, 0, 1, 1], safe_after_redactions: true, redactions: [[0, 0, 1, 1]] },
					],
				},
			},
		],
		relations: [],
	}, "digest-1", {});
}

test("the kernel says which leg wrote a map card's words, and the projection carries it", () => {
	assert.equal(kernelBundle.AUTHORED_WORDS, AUTHORED_MAP_WORDS, "the two ends of the seam spell `source` the same way");
	assert.equal(kernelBundle.KEEPER_WORDS, KEEPER_MAP_WORDS, "and `play_language` the same way");

	const arrival = {
		id: "map:house-t2", kind: "map", map: "house", name: "Corbitt House Investigator Map",
		label: "Corbitt House Investigator Map", words: kernelBundle.AUTHORED_WORDS, why: "arrival",
		regions: [{ id: "upper-west-bedroom", label: "West bedroom", level: "Upper Story" }], source_revision: "digest-1",
	};
	const [projected] = kernelBundle.mechanics([arrival]);
	assert.equal(projected.words, AUTHORED_MAP_WORDS, "an arrival card reaches the host marked as the module's own words");
	const [keeper] = kernelBundle.mechanics([{ ...arrival, words: kernelBundle.KEEPER_WORDS, label: "科比特宅邸调查员地图" }]);
	assert.equal(keeper.words, KEEPER_MAP_WORDS, "a card the Keeper wrote says so");
	const [legacy] = kernelBundle.mechanics([{ ...arrival, words: undefined }]);
	assert.equal("words" in legacy, false, "a receipt written before this field keeps its old shape");
});

test("table.open carries the module's own map captions, and never a region behind redactions", () => {
	assert.deepEqual(kernelBundle.authoredMapWords(moduleGraph()), [
		"Corbitt House Investigator Map", "Ground Floor", "Ground-floor entry hall", "Upper Story", "West bedroom",
	], "every caption a player-safe card could print, distinct and ordered");
	assert.equal(kernelBundle.authoredMapWords(moduleGraph()).includes("The vault of the Corbitt line"), false,
		"a private source's room name is module truth and is never sent out to be translated");
	assert.deepEqual(kernelBundle.authoredMapWords(new kernelBundle.ModuleGraph("m", { nodes: [], relations: [] }, "d", {})), [],
		"a module with no published map asks for nothing");
});

test("the card's words are its captions, never its region ids", () => {
	assert.deepEqual(mapCardTexts({
		name: "Corbitt House Investigator Map", label: "Corbitt House Investigator Map",
		regions: [
			{ id: "upper-west-bedroom", label: "West bedroom", level: "Upper Story" },
			{ id: "upper-east-bedroom", label: "East bedroom", level: "Upper Story" },
			{ id: "blank", label: "  " },
		],
		levels: ["Upper Story"],
	}), ["Corbitt House Investigator Map", "East bedroom", "Upper Story", "West bedroom"],
		"one caption written twice is one question; a blank one is nothing to project");
	assert.equal(mapCardTexts({ regions: [{ id: "upper-west-bedroom" }] }).length, 0,
		"a region id is the handle the Keeper names it by, and is never drawn");
});

test("a card is wholly projected or wholly authored, never half of each", () => {
	const card = {
		name: "House", label: "House", words: AUTHORED_MAP_WORDS, levels: ["Upper Story"],
		regions: [{ id: "west", label: "West bedroom", level: "Upper Story" }, { id: "hall", label: "Entry hall" }],
	};
	const whole = projectMapCard(card, { House: "宅邸", "West bedroom": "西卧室", "Upper Story": "二层", "Entry hall": "门厅" });
	assert.equal(whole.projected, true);
	assert.equal(whole.card.label, "宅邸");
	assert.equal(whole.card.name, "宅邸");
	assert.deepEqual(whole.card.levels, ["二层"]);
	assert.deepEqual(whole.card.regions, [{ id: "west", label: "西卧室", level: "二层" }, { id: "hall", label: "门厅" }]);
	assert.equal(whole.card.words, AUTHORED_MAP_WORDS, "the caller decides what the card now claims; this only supplies words");

	const partial = projectMapCard(card, { House: "宅邸", "West bedroom": "西卧室", "Upper Story": "二层" });
	assert.equal(partial.projected, false, "one label short is not a projection");
	assert.deepEqual(partial.card, card, "and the card is handed back untouched rather than half rewritten");
	assert.equal(projectMapCard({ name: "  ", regions: [] }, { "  ": "x" }).projected, false,
		"a card with nothing to say is not a projection either");
});

test("the checker is all-or-nothing, and the lane keeps what validated", () => {
	const catalog=issuePresentationReferences(['a','b']);
	const valid={protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:'text:0',action:'translate',text:'A'},{source:'text:1',action:'translate',text:'B'}]};
	assert.doesNotThrow(()=>validateMapPresentation(valid,catalog.sources));
	for (const bad of [null, {}, {protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[]},
		{protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:'text:0',action:'translate',text:'A'}]},
		{protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:'text:0',action:'translate',text:'A'},{source:'text:1',action:'translate',text:' '}]},
		{protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:'text:0',action:'translate',text:'A'},{source:'text:1',action:'translate',text:'B'},{source:'text:2',action:'translate',text:'C'}]}])
		assert.throws(() => validateMapPresentation(bad, catalog.sources), /Incomplete map word projection/, JSON.stringify(bad));
	assert.deepEqual(acceptedMapTexts({protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:'text:0',action:'translate',text:'A'}]},catalog), { a: "A" },
		"what validated is kept; a blank and an unasked word are not");
});

/** A runner that answers `texts.json` the way the presenter would, minus whatever `drop` names in that round. */
function runner(options = {}) {
	const rounds = [];
	const drop = options.drop ?? [];
	return {
		rounds,
		async run(request) {
			const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
			rounds.push(packet);
			await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet,rounds.length===1?drop:[])));
			return { ok: true };
		},
	};
}

test("the lane projects once per tag, caches it, and afterwards asks only for what is new", async () => {
	const home = await mkdtemp(join(tmpdir(), "map-words-home-"));
	const first = runner();
	const words = await prepareMapWords({ home, play_language: "cc", runner: first.run }, ["West bedroom", "Upper Story", "West bedroom"]);
	assert.equal(first.rounds.length, 1);
	assert.deepEqual(first.rounds[0].sources.map(sourceText), ["Upper Story", "West bedroom"], "the distinct captions, asked once each");
	assert.equal(first.rounds[0].play_language, "cc");
	assert.deepEqual(words, { "Upper Story": "<Upper Story>", "West bedroom": "<West bedroom>" });

	const digest = await mapWordsDigest();
	assert.deepEqual(JSON.parse(await readFile(mapWordsCachePath(home, "cc", digest), "utf8")),
		{ play_language: "cc", digest, texts: words });
	assert.deepEqual(await readMapWords({ home, play_language: "cc" }), words, "and the plain read answers the same thing");

	const second = runner();
	await prepareMapWords({ home, play_language: "cc", runner: second.run }, ["West bedroom"]);
	assert.equal(second.rounds.length, 0, "a caption already in the cache never reaches the model again");

	const third = runner();
	const grown = await prepareMapWords({ home, play_language: "cc", runner: third.run }, ["West bedroom", "Entry hall"]);
	assert.deepEqual(third.rounds[0].sources.map(sourceText), ["Entry hall"], "a later map pays only for the captions it adds");
	assert.deepEqual(grown, { "Upper Story": "<Upper Story>", "West bedroom": "<West bedroom>", "Entry hall": "<Entry hall>" },
		"and the cache grows rather than being replaced");

	assert.deepEqual(await readMapWords({ home, play_language: "dd" }), {},
		"another tag reads nothing rather than borrowing this one's words");
	assert.deepEqual(await readMapWords({ home: "", play_language: "cc" }), {}, "and so does a request with no home");
});

test("a caption two rounds could not project fails the run rather than being answered in the author's language", async () => {
	const home = await mkdtemp(join(tmpdir(), "map-words-home-"));
	const stubborn = {
		rounds: [],
		async run(request) {
			const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
			stubborn.rounds.push(packet);
			await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet,["West bedroom"])));
			return { ok: true };
		},
	};
	await assert.rejects(prepareMapWords({ home, play_language: "cc", runner: stubborn.run }, ["Upper Story", "West bedroom"]),
		/Incomplete map word projection/);
	assert.equal(stubborn.rounds.length, 2, "a near miss costs one more question");
	assert.deepEqual(stubborn.rounds[1].sources.map(sourceText), ["West bedroom"], "and asks only for what is still missing");
	assert.deepEqual(await readMapWords({ home, play_language: "cc" }), { "Upper Story": "<Upper Story>" },
		"what did validate is still cached, so the next card pays only for the rest");

	await assert.rejects(prepareMapWords({ home, play_language: "cc" }, ["Entry hall"]),
		/requires its owner runtime/, "a lane with no runtime says so rather than answering the authored words");
	await assert.rejects(prepareMapWords({ home, play_language: "ZZZZ", runner: runner().run }, ["Entry hall"]),
		/Invalid map word projection request/, "and a tag that is not a tag is refused by shape");
});

test("invalid map labels are repaired in round two without re-asking accepted words", async () => {
	const home = await mkdtemp(join(tmpdir(), "map-words-home-"));
	const packets = [];
	let attempt;
	const result = await prepareMapWords({ home, play_language: "cc", runner: async request => {
		attempt = request.cwd;
		const packet = JSON.parse(await readFile(join(attempt, "texts.json"), "utf8"));
		packets.push(packet);
		assert.equal(request.eventLog, join(attempt, `events-${packets.length}.jsonl`));
		await writeFile(request.eventLog, "owner event\n");
		const output=response(packet);
		if (packets.length === 1) output.texts=output.texts.map(operation=>sourceText(packet.sources.find(source=>source.alias===operation.source))==='West bedroom'?{...operation,text:'x'.repeat(201)}:operation);
		else {
			assert.match(request.brief, /Read findings.json/);
			assert.deepEqual(JSON.parse(await readFile(join(attempt, "findings.json"), "utf8")), {
				error: "these source aliases were not answered with a valid keep or short translation", sources: [packet.sources[0].alias],
			});
		}
		await writeFile(join(attempt, "presentation.json"), JSON.stringify(output));
		return { ok: true };
	} }, ["Upper Story", "West bedroom"]);
	assert.equal(packets.length, 2);
	assert.deepEqual(packets[1].sources.map(sourceText), ["West bedroom"]);
	assert.deepEqual(result, { "Upper Story": "<Upper Story>", "West bedroom": "<West bedroom>" });
	assert.deepEqual((await readdir(attempt)).sort(), ["check.mjs", "events-1.jsonl", "events-2.jsonl", "findings.json", "presentation.json", "texts.json"]);
});

for (const repair of [true, false]) test(`malformed map JSON is retried without accepting it (repair=${repair})`, async () => {
	const home = await mkdtemp(join(tmpdir(), "map-words-home-"));
	let calls = 0;
	const result = prepareMapWords({ home, play_language: "cc", runner: async request => {
		calls++;
		const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
		assert.deepEqual(packet.sources.map(sourceText), ["West bedroom"]);
		if (calls === 2) {
			const findings = JSON.parse(await readFile(join(request.cwd, "findings.json"), "utf8"));
			assert.match(findings.error, /SyntaxError/);
			assert.deepEqual(findings.sources, packet.sources.map(source=>source.alias));
		}
		await writeFile(join(request.cwd, "presentation.json"), calls === 2 && repair
			? JSON.stringify(response(packet)) : "not JSON");
		return { ok: true };
	} }, ["West bedroom"]);
	if (repair) assert.deepEqual(await result, { "West bedroom": "<West bedroom>" });
	else {
		await assert.rejects(result, error => error.code === "preparation_failed"
			&& error.message === "Incomplete map word projection: 1 label were not projected");
		await assert.rejects(readFile(mapWordsCachePath(home, "cc", await mapWordsDigest())), { code: "ENOENT" });
	}
	assert.equal(calls, 2);
});

test("a malformed repair still merges accepted map words with earlier and concurrently cached words before failing", async () => {
	const home = await mkdtemp(join(tmpdir(), "map-words-home-"));
	await prepareMapWords({ home, play_language: "cc", runner: runner().run }, ["Entry hall"]);
	const digest = await mapWordsDigest();
	const path = mapWordsCachePath(home, "cc", digest);
	let calls = 0;
	await assert.rejects(prepareMapWords({ home, play_language: "cc", runner: async request => {
		calls++;
		const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
		if (calls === 1) {
			assert.deepEqual(packet.sources.map(sourceText), ["Upper Story", "West bedroom"]);
			await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet,["West bedroom"])));
		} else {
			assert.deepEqual(packet.sources.map(sourceText), ["West bedroom"]);
			assert.deepEqual(await readMapWords({ home, play_language: "cc" }), { "Entry hall": "<Entry hall>" }, "round-one acceptance has not yet committed");
			await writeFile(path, JSON.stringify({ play_language: "cc", digest, texts: { Kitchen: "<Kitchen>" } }));
			await writeFile(join(request.cwd, "presentation.json"), "not JSON");
		}
		return { ok: true };
	} }, ["Entry hall", "Upper Story", "West bedroom"]), error => error.code === "preparation_failed"
		&& error.message === "Incomplete map word projection: 1 label were not projected");
	assert.equal(calls, 2);
	assert.deepEqual(await readMapWords({ home, play_language: "cc" }), {
		Kitchen: "<Kitchen>", "Entry hall": "<Entry hall>", "Upper Story": "<Upper Story>",
	});
});

for (const aborted of [false, true]) for (const failRound of [1, 2])
	test(`map execution failure keeps its detail and cancellation identity (abort=${aborted}, round=${failRound})`, async () => {
		const home = await mkdtemp(join(tmpdir(), "map-words-home-"));
		const controller = new AbortController();
		let calls = 0;
		await assert.rejects(prepareMapWords({ home, play_language: "cc", model: "owner/model", thinking: "high",
			signal: controller.signal, runner: async request => {
				calls++;
				assert.equal(request.model, "owner/model");
				assert.equal(request.thinking, "high");
				assert.strictEqual(request.signal, controller.signal);
				assert.equal(request.timeoutMs, 120000);
				const packet=JSON.parse(await readFile(join(request.cwd,'texts.json'),'utf8'));
				await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet,["West bedroom"])));
				if (calls < failRound) return { ok: true };
				if (aborted) controller.abort();
				return { ok: aborted, code: 1, stderr: "Model not found", timedOut: false };
			} }, ["Upper Story", "West bedroom"]), error => error.code === (aborted ? "presentation_timeout" : "preparation_failed")
				&& error.message === (aborted ? "The map words could not be projected" : "The map words could not be projected (Model not found)"));
		assert.equal(calls, failRound);
		await assert.rejects(readFile(mapWordsCachePath(home, "cc", await mapWordsDigest())), { code: "ENOENT" },
			"runner failure still exits before the caller's normal partial-cache commit");
		assert.equal((await readdir(join(home, ".coc/map-words/attempts"))).length, 1);
	});

test("empty and cached map requests bypass the runner even without an owner", async () => {
	const home = await mkdtemp(join(tmpdir(), "map-words-home-"));
	const fake = runner();
	assert.deepEqual(await prepareMapWords({ home, play_language: "cc", runner: fake.run }, []), {});
	assert.deepEqual(await prepareMapWords({ home, play_language: "cc" }, ["  ", "x".repeat(201)]), {});
	assert.equal(fake.rounds.length, 0);
	assert.deepEqual(await readdir(home), []);
	await assert.rejects(prepareMapWords({ home, play_language: "cc" }, ["West bedroom"]), error =>
		error.code === "preparation_failed" && error.message === "Map word projection requires its owner runtime");
	assert.deepEqual(await readdir(home), [], "missing owner creates no attempt");
	await prepareMapWords({ home, play_language: "cc", runner: fake.run }, ["West bedroom"]);
	const attempts = await readdir(join(home, ".coc/map-words/attempts"));
	assert.deepEqual(await prepareMapWords({ home, play_language: "cc" }, ["West bedroom"]), { "West bedroom": "<West bedroom>" });
	assert.deepEqual(await prepareMapWords({ home, play_language: "cc", runner: fake.run }, []), { "West bedroom": "<West bedroom>" });
	assert.equal(fake.rounds.length, 1);
	assert.deepEqual(await readdir(join(home, ".coc/map-words/attempts")), attempts);
});

/** A lane child that answers every asked caption, so a table can drive the whole loop without a model. */
async function laneChild() {
	const directory = await mkdtemp(join(tmpdir(), "map-words-lane-"));
	const script = join(directory, "lane.mjs");
	await writeFile(script,
		"import {readFileSync, writeFileSync} from 'node:fs';\n"
		+ "const packet = JSON.parse(readFileSync('texts.json', 'utf8'));\n"
		+ "writeFileSync('presentation.json', JSON.stringify({protocol:'presentation-reference-v1',texts:packet.sources.map(source => ({source:source.alias,action:'translate',text:'[' + packet.play_language + ']' + source.text}))}));\n");
	return JSON.stringify([process.execPath, script]);
}

/** One map view as `look focus=map` hands it to the host, in the shape a first arrival mints. */
const ARRIVAL_VIEW = {
	map: "house-map", name: "Corbitt House Investigator Map", label: "Corbitt House Investigator Map",
	words: AUTHORED_MAP_WORDS, view_id: "v-house", source_revision: "digest-1",
	regions: [{ id: "ground-entry-hall", label: "Ground-floor entry hall", level: "Ground Floor" }],
};

function mapRow(table) {
	const entries = table.entries("coc-mechanics");
	return entries.flatMap(entry => entry.mechanics ?? []).find(row => row.kind === "map");
}

function telemetryIn(home, campaign) {
	const path = join(home, ".coc", "campaigns", campaign, "telemetry.jsonl");
	return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(line => line.trim()).map(line => JSON.parse(line)) : [];
}

test("a first-arrival card reaches the player in the campaign's play language", async t => {
	const home = await mkdtemp(join(tmpdir(), "map-words-table-"));
	const digest = await mapWordsDigest();
	await mkdir(join(home, ".coc/map-words"), { recursive: true });
	// The lane already ran for this tag, as the open-time projection leaves it.
	await writeFile(mapWordsCachePath(home, "zh-Hans", digest), JSON.stringify({
		play_language: "zh-Hans", digest,
		texts: { "Corbitt House Investigator Map": "科比特宅邸调查员地图", "Ground-floor entry hall": "一层门厅", "Ground Floor": "一层" },
	}));
	const table = await openTable({
		env: { PI_COC_HOME: home, FAKE_KERNEL_LOOK_MAPS: JSON.stringify([ARRIVAL_VIEW]) },
		responses: [
			fauxAssistantMessage([fauxToolCall("look", { focus: "map" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅在你面前展开。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("门厅在你面前展开。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我推门进去");

	const row = mapRow(table);
	assert.ok(row, "the card reached the delivery");
	assert.equal(row.label, "科比特宅邸调查员地图");
	assert.equal(row.name, "科比特宅邸调查员地图");
	assert.deepEqual(row.regions, [{ id: "ground-entry-hall", label: "一层门厅", level: "一层" }],
		"the region id is untouched; only what the player reads is projected");
	assert.equal(row.words, KEEPER_MAP_WORDS, "and the card no longer claims to be in the author's language");
	assert.equal(telemetryIn(home, "test-camp").some(entry => entry.lane === "map-words" && entry.reason === "not_projected"), false,
		"a card that was ready owes no notice");
});

test("a card whose words are not ready still ships, says so, and leaves a row", async t => {
	const home = await mkdtemp(join(tmpdir(), "map-words-table-"));
	const table = await openTable({
		env: {
			PI_COC_HOME: home, FAKE_KERNEL_LOOK_MAPS: JSON.stringify([ARRIVAL_VIEW]),
			// The lane exists but answers nothing, so the card's words cannot be ready in time.
			PI_COC_READER_CMD: JSON.stringify([process.execPath, "-e", "process.exitCode=1"]),
		},
		responses: [
			fauxAssistantMessage([fauxToolCall("look", { focus: "map" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅在你面前展开。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("门厅在你面前展开。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我推门进去");

	const row = mapRow(table);
	assert.ok(row, "the picture is worth more than a withheld card, so it still goes");
	assert.equal(row.label, "Corbitt House Investigator Map", "with the author's words, unchanged");
	assert.equal(row.words, AUTHORED_MAP_WORDS, "and saying so, rather than passing them off as the play language");
	const notice = await waitFor(() => telemetryIn(home, "test-camp").find(entry => entry.lane === "map-words" && entry.reason === "not_projected"),
		{ label: "the unprojected-card row" });
	assert.equal(notice.map, "house-map");
	assert.equal(notice.missing, 3, "the title, the region and its level");
	assert.equal(notice.play_language, "zh-Hans");
});

test("a Keeper-written card is never rewritten and never asks the lane for anything", async t => {
	const home = await mkdtemp(join(tmpdir(), "map-words-table-"));
	const table = await openTable({
		env: {
			PI_COC_HOME: home,
			FAKE_KERNEL_LOOK_MAPS: JSON.stringify([{ ...ARRIVAL_VIEW, words: KEEPER_MAP_WORDS, label: "科比特宅邸调查员地图" }]),
			PI_COC_READER_CMD: JSON.stringify([process.execPath, "-e", "process.exitCode=1"]),
		},
		responses: [
			fauxAssistantMessage([fauxToolCall("look", { focus: "map" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅在你面前展开。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("门厅在你面前展开。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我推门进去");

	const row = mapRow(table);
	assert.equal(row.label, "科比特宅邸调查员地图", "the Keeper's own words are left alone");
	assert.equal(row.words, KEEPER_MAP_WORDS);
	assert.deepEqual(telemetryIn(home, "test-camp").filter(entry => entry.lane === "map-words"), [],
		"and nothing is asked of the lane on its behalf");
});

test("the module's captions are projected when the table opens, before any arrival needs them", async t => {
	const home = await mkdtemp(join(tmpdir(), "map-words-table-"));
	const table = await openTable({
		env: {
			PI_COC_HOME: home,
			FAKE_KERNEL_MAP_WORDS: JSON.stringify(["Corbitt House Investigator Map", "Ground-floor entry hall", "Ground Floor"]),
			PI_COC_READER_CMD: await laneChild(),
		},
		responses: [fauxAssistantMessage("桌子开着。")],
	});
	t.after(() => table.dispose());

	const landed = await waitFor(() => telemetryIn(home, "test-camp").find(entry => entry.lane === "map-words" && entry.why === "open"),
		{ label: "the open-time projection" });
	assert.equal(landed.ok, true);
	assert.equal(landed.texts, 3);
	assert.equal(landed.play_language, "zh-Hans");
	const digest = await mapWordsDigest();
	assert.deepEqual(JSON.parse(await readFile(mapWordsCachePath(home, "zh-Hans", digest), "utf8")).texts, {
		"Corbitt House Investigator Map": "[zh-Hans]Corbitt House Investigator Map",
		"Ground Floor": "[zh-Hans]Ground Floor",
		"Ground-floor entry hall": "[zh-Hans]Ground-floor entry hall",
	}, "the whole module's captions are in hand while the player is still reading the opening scene");
	assert.deepEqual((await readdir(join(home, ".coc/map-words"))).filter(name => name.endsWith(".json")).length, 1);
});

/**
 * The real kernel, on the module the defect was found on.
 *
 * Everything above drives the seam with fixtures; this one walks the actual path -- create a
 * `zh-Hans` campaign on the built-in Haunting, open it, move into the ground floor -- and pins both
 * ends of §39.2 on the bytes a player really gets: the open result carries the module's own
 * captions, and the card the arrival mints says they are the module's own.
 */
test("the built-in Haunting hands its own map words to the host, and marks the card it mints", async t => {
	const directory = await mkdtemp(join(tmpdir(), "map-words-kernel-run-"));
	const rpc = join(directory, "rpc.mjs");
	// The emitted kernel loads its native dependencies beside itself, exactly as the other
	// real-kernel suites arrange it.
	await symlink(join(REPO, "node_modules"), join(directory, "node_modules"), "dir");
	await build({
		entryPoints: [join(REPO, "kernel-ts/rpc.ts")], outfile: rpc, bundle: true, packages: "external",
		platform: "node", format: "esm", target: "node22", logLevel: "silent",
	});
	const home = join(directory, "workspace");
	await mkdir(home, { recursive: true });
	const { KernelClient } = await import("../../extensions/kernel/client.ts");
	const client = new KernelClient({
		command: [process.execPath, rpc, "--workspace", home, "--content", join(REPO, "content")],
		cwd: REPO, env: process.env, inheritEnv: false, timeoutMs: 60_000,
	});
	t.after(() => client.close());

	await client.call("campaign.create", { id: "c1", module: "the-haunting", pregen: "thomas-hayes", play_language: "zh-Hans" });
	const open = await client.call("table.open", { campaign: "c1" });
	assert.ok(Array.isArray(open.authored_map_words), "the open result carries the module's own map captions");
	assert.deepEqual(open.authored_map_words, [
		"Basement", "Basement storage", "Corbitt House Investigator Map", "Dining room", "East bedroom",
		"Ground Floor", "Ground-floor entry hall", "Kitchen", "Living room", "Middle bedroom",
		"Upper Story", "Upper landing and stairs", "West bedroom",
	], "the title, nine player-safe rooms and three floors -- exactly what turn 2 put on screen in English");
	assert.equal(open.authored_map_words.includes("Hidden cellar"), false,
		"the room only the Keeper's map shows is never sent out to be translated");

	await client.call("table.narrate", { campaign: "c1", call_id: "t0-c1", text: "调查开始。" });
	await client.call("table.player_input", { campaign: "c1", text: "我走进宅邸一层。" });
	const applied = await client.call("table.apply", {
		campaign: "c1", call_id: "t1-c1", effects: [{ kind: "move", to: "corbitt-house-ground", why: "走进宅邸" }],
	});
	const view = (applied.map_views ?? []).find(row => row.map?.includes("corbitt-house-map"));
	assert.ok(view, "the first arrival placed the depicted map in the delivery");
	assert.equal(view.words, AUTHORED_MAP_WORDS, "and the host-only view says whose words it carries");

	const status = await client.call("table.status", { campaign: "c1" });
	const receipt = status.receipts.find(row => row.kind === "map");
	assert.equal(receipt.why, "arrival");
	assert.equal(receipt.words, AUTHORED_MAP_WORDS, "the receipt does not pass the author's words off as the play language");
	assert.equal(receipt.label, "Corbitt House Investigator Map");
	const projected = (status.mechanics ?? []).find(row => row.kind === "map");
	assert.equal(projected.words, AUTHORED_MAP_WORDS, "and the projection the host reads says the same");
	assert.equal(projected.regions.length, 9, "nine player-safe rooms, as the live table saw");
});
