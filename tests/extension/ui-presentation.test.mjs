/**
 * The caption projection lane (contract §23, 2026-09-09).
 *
 * `content/ui/<source>/` is the only authored set of words; every other tag is produced by a
 * tool-enabled presenter run and cached per home. These tests drive that lane against a fake runner
 * -- no model, no subprocess -- and pin the four things the ruling turns on: a full projection is
 * cached in the shape the loader reads back, one dropped caption costs one more question and not
 * the tag, and the two tags that must never reach the model (the authored one, and one the product
 * ships a seed for) write nothing at all.
 */
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	acceptedUiTexts, assembleUiWords, prepareUiWords, uiCaptions, uiSourceTexts, validateUiPresentation,
} from "../../extensions/module/ui-presentation.ts";
// The ask size is read through the namespace so that a build without it fails the tests that use
// it, not every test in this file at link time.
import * as uiLane from "../../extensions/module/ui-presentation.ts";
import { issuePresentationReferences, PRESENTATION_REFERENCE_PROTOCOL } from "../../runtime/jev/presentation-references.ts";
import { resolveUiWords, uiWordsCachePath, uiWordsDigest } from "../../runtime/ui-words.ts";

/** Two invented tags: `aa` is authored, `bb` ships a seed, and `cc` has to be projected. */
async function fixture() {
	const contentRoot = await mkdtemp(join(tmpdir(), "ui-lane-content-"));
	await writeFile(join(contentRoot, "languages.json"), JSON.stringify({ source: "aa", default: "aa", suggested: ["aa"] }));
	await mkdir(join(contentRoot, "ui/aa"), { recursive: true });
	await mkdir(join(contentRoot, "ui/bb"), { recursive: true });
	await mkdir(join(contentRoot, "setup"), { recursive: true });
	await writeFile(join(contentRoot, "ui/aa/sheet.json"), JSON.stringify({ clues: "Clues", refresh: "Refresh", "item.name": "Name" }));
	await writeFile(join(contentRoot, "ui/aa/errors.json"), JSON.stringify({ unknown: "Something went wrong", stale: "Clues" }));
	await writeFile(join(contentRoot, "ui/bb/sheet.json"), JSON.stringify({ clues: "bb Clues", refresh: "bb Refresh", "item.name": "bb Name" }));
	await writeFile(join(contentRoot, "ui/bb/errors.json"), JSON.stringify({ unknown: "bb wrong", stale: "bb Clues" }));
	await writeFile(join(contentRoot, "setup/ui-presentation.md"), "Project the captions into play_language.");
	const home = await mkdtemp(join(tmpdir(), "ui-lane-home-"));
	return { contentRoot, home };
}

const sourceText = source => "text" in source ? source.text : source.pieces.map(piece => "text" in piece ? piece.text : piece.value).join("");
const translated = source => "text" in source
	? { source: source.alias, action: "translate", text: `<${source.text}>` }
	: { source: source.alias, action: "translate", pieces: [
		{ text: "<" }, ...source.pieces.map(piece => "text" in piece ? { text: piece.text } : { token: piece.token }), { text: ">" },
	] };
const response = (packet, drop = []) => ({ protocol: PRESENTATION_REFERENCE_PROTOCOL,
	texts: packet.sources.filter(source => !drop.includes(sourceText(source))).map(translated) });

/**
 * A runner that answers `texts.json` the way the presenter would, minus whatever `drop` names in
 * that round. It records what it was asked for, so a re-ask can be told from a repeat.
 */
function runner(options = {}) {
	const rounds = [];
	const drop = options.drop ?? [];
	return {
		rounds,
		async run(request) {
			const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
			rounds.push(packet);
			await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet, rounds.length === 1 ? drop : [])));
			return { ok: true };
		},
	};
}

test("the captions are rows, one per place a word appears, and the questions are the distinct strings", async () => {
	const words = { sheet: { clues: "Clues", refresh: "Refresh" }, errors: { stale: "Clues", blank: "  " } };
	assert.deepEqual(uiCaptions(words), [
		{ surface: "errors", key: "stale", text: "Clues" },
		{ surface: "sheet", key: "clues", text: "Clues" },
		{ surface: "sheet", key: "refresh", text: "Refresh" },
	], "a blank caption is nothing to project, and the order is stable");
	assert.deepEqual(uiSourceTexts(uiCaptions(words)), ["Clues", "Refresh"], "one caption written twice is one question");
	assert.deepEqual(assembleUiWords(uiCaptions(words), { Clues: "C", Refresh: " " }),
		{ errors: { stale: "C" }, sheet: { clues: "C" } }, "a caption the model left blank is left out, not blanked");
});

test("the checker is all-or-nothing, and the pipeline keeps what validated", () => {
	const catalog = issuePresentationReferences(["a", "b"], {protectSyntax:true});
	const valid = {protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:"text:0",action:"translate",text:"A"},{source:"text:1",action:"translate",text:"B"}]};
	assert.doesNotThrow(() => validateUiPresentation(valid, catalog.sources));
	for (const bad of [null, {}, {protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[]},
		{protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:"text:0",action:"translate",text:"A"}]},
		{protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:"text:0",action:"translate",text:" "},{source:"text:1",action:"translate",text:"B"}]},
		{protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:"text:0",action:"translate",text:"A"},{source:"text:1",action:"translate",text:"B"},{source:"text:2",action:"translate",text:"C"}]}])
		assert.throws(() => validateUiPresentation(bad, catalog.sources), /Incomplete UI word projection/, JSON.stringify(bad));
	assert.deepEqual(acceptedUiTexts({protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[{source:"text:0",action:"translate",text:"A"}]},catalog), { a: "A" },
		"what validated is kept; a blank and an unasked word are not");
});

test("a tag with nothing to read is projected once and cached in the shape the loader reads back", async () => {
	const { contentRoot, home } = await fixture();
	const fake = runner();
	const result = await prepareUiWords({ home, contentRoot, play_language: "cc", runner: fake.run });

	assert.equal(fake.rounds.length, 1, "one round is enough when the answer is complete");
	assert.deepEqual(fake.rounds[0].sources.map(sourceText), ["Clues", "Something went wrong", "Name", "Refresh"],
		"the distinct authored strings, asked once each, in caption order (surface, then key; §23.3)");
	const cluesAlias = fake.rounds[0].sources.find(source => sourceText(source) === "Clues").alias;
	assert.deepEqual(fake.rounds[0].captions.filter(row => row.source === cluesAlias),
		[{ surface: "errors", key: "stale", source: cluesAlias }, { surface: "sheet", key: "clues", source: cluesAlias }],
		"each row says where its caption appears, so a short word can be told apart");
	assert.equal(fake.rounds[0].play_language, "cc");

	const digest = await uiWordsDigest(contentRoot);
	assert.equal(result.play_language, "cc");
	assert.equal(result.digest, digest);
	assert.deepEqual(result.texts, {
		errors: { unknown: "<Something went wrong>", stale: "<Clues>" },
		sheet: { clues: "<Clues>", refresh: "<Refresh>", "item.name": "<Name>" },
	}, "a key with a dot in it survives the round trip");

	const cached = JSON.parse(await readFile(uiWordsCachePath(home, "cc", digest), "utf8"));
	assert.deepEqual(cached, { play_language: "cc", digest, texts: result.texts });

	// The loader now answers this tag projected, without going near the lane again.
	const loaded = await resolveUiWords({ contentRoot, home, tag: "cc" });
	assert.equal(loaded.source, "cache");
	assert.equal(loaded.projected, true);
	assert.equal(loaded.words.sheet.clues, "<Clues>");
	const second = runner();
	await prepareUiWords({ home, contentRoot, play_language: "cc", runner: second.run });
	assert.equal(second.rounds.length, 0, "a cached tag never asks again");
});

test("one dropped caption is asked once more, and the words already accepted are not asked again", async () => {
	const { contentRoot, home } = await fixture();
	const fake = runner({ drop: ["Refresh"] });
	const result = await prepareUiWords({ home, contentRoot, play_language: "cc", runner: fake.run });
	assert.equal(fake.rounds.length, 2, "a near miss costs one more question");
	assert.deepEqual(fake.rounds[1].sources.map(sourceText), ["Refresh"], "only the caption that was dropped");
	assert.deepEqual(fake.rounds[1].captions, [{ surface: "sheet", key: "refresh", source: fake.rounds[1].sources[0].alias }]);
	assert.equal(result.texts.sheet.refresh, "<Refresh>");
	assert.equal(result.texts.sheet.clues, "<Clues>", "the first round's words survived the miss");
	const findings = JSON.parse(await readFile(join((await attemptDir(home)), "findings.json"), "utf8"));
	assert.deepEqual(findings.sources, [fake.rounds[1].sources[0].alias], "the round is told exactly what it still owes");
});

test("a caption the second round still drops fails the projection, and nothing is cached", async () => {
	const { contentRoot, home } = await fixture();
	const stubborn = {
		rounds: [],
		async run(request) {
			const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
			stubborn.rounds.push(packet);
			await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet,["Refresh"])));
			return { ok: true };
		},
	};
	await assert.rejects(prepareUiWords({ home, contentRoot, play_language: "cc", runner: stubborn.run }),
		/Incomplete UI word projection: 1 caption/);
	assert.equal(stubborn.rounds.length, 2, "two rounds and no more");
	const digest = await uiWordsDigest(contentRoot);
	await assert.rejects(readFile(uiWordsCachePath(home, "cc", digest), "utf8"), /ENOENT/,
		"a partial projection is not a cache: the panel keeps the authored words");
});

test("the authored tag and a shipped seed never reach the model, and write nothing", async () => {
	const { contentRoot, home } = await fixture();
	const digest = await uiWordsDigest(contentRoot);

	const authored = runner();
	const source = await prepareUiWords({ home, contentRoot, play_language: "aa", runner: authored.run });
	assert.equal(authored.rounds.length, 0, "the authored tag is the source; there is nothing to project it from");
	assert.deepEqual(source, { play_language: "aa", digest, texts: (await resolveUiWords({ contentRoot, tag: "aa" })).words });
	await assert.rejects(readFile(uiWordsCachePath(home, "aa", digest), "utf8"), /ENOENT/);

	const seeded = runner();
	const seed = await prepareUiWords({ home, contentRoot, play_language: "bb", runner: seeded.run });
	assert.equal(seeded.rounds.length, 0, "a shipped seed is already this tag's cache");
	assert.equal(seed.texts.sheet.clues, "bb Clues");
	await assert.rejects(readFile(uiWordsCachePath(home, "bb", digest), "utf8"), /ENOENT/);
});

test("the lane asks by shape, and a run with no owner runtime says so rather than answering English", async () => {
	const { contentRoot, home } = await fixture();
	for (const tag of ["", "ZH", "zh_Hans", "a", 7, null])
		await assert.rejects(prepareUiWords({ home, contentRoot, play_language: tag, runner: runner().run }),
			(error) => error.code === "invalid_params", `${String(tag)} is not a tag`);
	await assert.rejects(prepareUiWords({ home: "", contentRoot, play_language: "cc", runner: runner().run }),
		(error) => error.code === "invalid_params", "a projection needs a home to cache into");
	await assert.rejects(prepareUiWords({ home, contentRoot, play_language: "cc" }),
		(error) => error.code === "preparation_failed" && /owner runtime/.test(error.message));
});

/** The one attempt directory this home's lane wrote, so a test can read what the round was told. */
async function attemptDir(home) {
	const root = join(home, ".coc/ui-words/attempts");
	const [only] = await readdir(root);
	return join(root, only);
}

test("a seed that lacks keys is asked those keys only, beside the seed's own words (§23.3)", async () => {
	const { home, contentRoot } = await fixture();
	// `bb` keeps sheet.clues and errors.unknown. Its gap is sheet.refresh, sheet.item.name and
	// errors.stale, whose English ("Clues") the seed already answers at sheet.clues.
	await writeFile(join(contentRoot, "ui/bb/sheet.json"), JSON.stringify({ clues: "bb Clues" }));
	await writeFile(join(contentRoot, "ui/bb/errors.json"), JSON.stringify({ unknown: "bb wrong" }));
	assert.equal((await resolveUiWords({ home, contentRoot, tag: "bb" })).projected, false);
	const fake = runner();
	const result = await prepareUiWords({ home, contentRoot, play_language: "bb", runner: fake.run });

	assert.equal(fake.rounds.length, 1);
	const [packet] = fake.rounds;
	assert.deepEqual(packet.sources.map(sourceText), ["Clues", "Name", "Refresh"],
		"only the English of the captions the seed lacks; the reader would discard anything else");
	assert.deepEqual(packet.captions.map(row => `${row.surface}.${row.key}`), ["errors.stale", "sheet.item.name", "sheet.refresh"],
		"a text the seed answers at one key is asked for the gap's row only");
	assert.deepEqual(packet.established_words, { errors: { unknown: "bb wrong" }, sheet: { clues: "bb Clues" } },
		"the seed rides whole as context");

	const digest = await uiWordsDigest(contentRoot);
	const cached = JSON.parse(await readFile(uiWordsCachePath(home, "bb", digest), "utf8"));
	assert.deepEqual(cached.texts, { errors: { stale: "<Clues>" }, sheet: { refresh: "<Refresh>", "item.name": "<Name>" } },
		"the cache carries the gap's keys and nothing the seed answers");
	assert.deepEqual(result, cached);
	const complete = await resolveUiWords({ home, contentRoot, tag: "bb" });
	assert.equal(complete.projected, true);
	assert.equal(complete.source, "cache");
	assert.deepEqual(complete.words, {
		errors: { unknown: "bb wrong", stale: "<Clues>" },
		sheet: { clues: "bb Clues", refresh: "<Refresh>", "item.name": "<Name>" },
	});
});

/** A source tag with more distinct captions than one ask holds; `cc` ships no seed. */
async function wideFixture(count) {
	const contentRoot = await mkdtemp(join(tmpdir(), "ui-lane-wide-"));
	await writeFile(join(contentRoot, "languages.json"), JSON.stringify({ source: "aa", default: "aa", suggested: ["aa"] }));
	await mkdir(join(contentRoot, "ui/aa"), { recursive: true });
	await mkdir(join(contentRoot, "setup"), { recursive: true });
	await writeFile(join(contentRoot, "ui/aa/alpha.json"), JSON.stringify(Object.fromEntries(
		Array.from({ length: count }, (_, index) => [`k${String(index).padStart(2, "0")}`, label(index)]))));
	// The first caption's text again on a later surface: one question, asked where it first appears.
	await writeFile(join(contentRoot, "ui/aa/zeta.json"), JSON.stringify({ again: label(0) }));
	await writeFile(join(contentRoot, "setup/ui-presentation.md"), "Project the captions into play_language.");
	return { contentRoot, home: await mkdtemp(join(tmpdir(), "ui-lane-home-")) };
}
const label = index => `Caption ${String(index).padStart(2, "0")}`;
const labels = (from, count) => Array.from({ length: count }, (_, index) => label(from + index));

/** §23.3's ask size, measured on the slowest lane model tried; the lane's constant must be this one. */
const ASK = 12;

test("the lane's ask size is the contract's (§23.3)", () => {
	assert.equal(uiLane.UI_ASK_SOURCES, ASK);
});

test("a gap wider than one ask is asked in consecutive asks, each seeing what the earlier ones accepted (§23.3)", async () => {
	const { contentRoot, home } = await wideFixture(2 * ASK + 6);
	const cache = uiWordsCachePath(home, "cc", await uiWordsDigest(contentRoot));
	const asks = [];
	const result = await prepareUiWords({ home, contentRoot, play_language: "cc", runner: async request => {
		await assert.rejects(readFile(cache), { code: "ENOENT" }, "nothing is cached before the last ask lands");
		const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
		asks.push({ cwd: request.cwd, packet });
		await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet)));
		return { ok: true };
	} });

	assert.deepEqual(asks.map(ask => ask.packet.sources.map(sourceText)), [labels(0, ASK), labels(ASK, ASK), labels(2 * ASK, 6)],
		"consecutive asks in caption order, none over the bound, every source once");
	assert.equal(new Set(asks.map(ask => ask.cwd)).size, 3, "each ask is an attempt of its own");
	const [first] = asks[0].packet.sources;
	assert.deepEqual(asks[0].packet.captions.filter(row => row.source === first.alias).map(row => `${row.surface}.${row.key}`),
		["alpha.k00", "zeta.again"], "a text shown twice is asked once, with both of its rows");
	assert.deepEqual(asks[0].packet.established_words, {}, "a tag with no seed starts with no established word");
	assert.equal(asks[1].packet.established_words.alpha.k00, `<${label(0)}>`, "a later ask is handed the earlier asks' words");
	assert.equal(asks[1].packet.established_words.zeta.again, `<${label(0)}>`);
	assert.equal(Object.keys(asks[2].packet.established_words.alpha).length, 2 * ASK);
	assert.equal(asks[2].packet.established_words.alpha[`k${2 * ASK}`], undefined, "an ask is never handed a word for its own captions");

	const cached = JSON.parse(await readFile(cache, "utf8"));
	assert.equal(Object.keys(cached.texts.alpha).length, 2 * ASK + 6);
	assert.equal(cached.texts.zeta.again, `<${label(0)}>`);
	assert.deepEqual(result, cached);
	assert.equal((await resolveUiWords({ contentRoot, home, tag: "cc" })).projected, true);
});

test("an ask still short after its second round ends the projection, and later asks never run (§23.3)", async () => {
	const { contentRoot, home } = await wideFixture(2 * ASK + 6);
	const stubborn = label(ASK + 1);
	const packets = [];
	await assert.rejects(prepareUiWords({ home, contentRoot, play_language: "cc", runner: async request => {
		const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
		packets.push(packet);
		await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(response(packet, [stubborn])));
		return { ok: true };
	} }), error => error.code === "preparation_failed"
		&& error.message === "Incomplete UI word projection: 7 captions were not projected",
		"the second ask's remainder and the six sources of the ask that never ran");
	assert.equal(packets.length, 3, "the first ask once, the second twice, the third never");
	assert.deepEqual(packets[2].sources.map(sourceText), [stubborn]);
	await assert.rejects(readFile(uiWordsCachePath(home, "cc", await uiWordsDigest(contentRoot))), { code: "ENOENT" },
		"a partial projection is still not a cache");
});

test("a translation carries exactly its source's braces, and the run's checker names the alias (§23.3)", () => {
	const catalog = issuePresentationReferences(["Beyond plain JSON", "Roll", "Turn {n}"], { protectSyntax: true });
	const [json, roll, turn] = catalog.sources;
	const token = source => source.pieces.find(piece => "token" in piece).token;
	const rows = {
		[json.alias]: { source: json.alias, action: "translate", pieces: [{ text: "Mas alla del simple " }, { token: token(json) }] },
		[roll.alias]: { source: roll.alias, action: "translate", text: "Tirada" },
		[turn.alias]: { source: turn.alias, action: "translate", pieces: [{ text: "Turno " }, { token: token(turn) }] },
	};
	const answer = changed => ({ protocol: PRESENTATION_REFERENCE_PROTOCOL, texts: Object.values({ ...rows, ...changed }) });
	assert.doesNotThrow(() => validateUiPresentation(answer({}), catalog.sources));
	assert.deepEqual(acceptedUiTexts(answer({}), catalog),
		{ "Beyond plain JSON": "Mas alla del simple JSON", Roll: "Tirada", "Turn {n}": "Turno {n}" });

	for (const [alias, row, why] of [
		[json.alias, { source: json.alias, action: "translate", pieces: [{ text: "Mas alla del simple {" }, { token: token(json) }, { text: "}" }] },
			"a notation token between generated braces reads as an unfilled {JSON} placeholder"],
		[roll.alias, { source: roll.alias, action: "translate", text: "Tirada {n}" }, "an invented placeholder"],
		[turn.alias, { source: turn.alias, action: "translate", pieces: [{ text: "Turno {" }, { token: token(turn) }, { text: "}" }] },
			"a placeholder token between generated braces"],
	]) {
		assert.throws(() => validateUiPresentation(answer({ [alias]: row }), catalog.sources),
			error => error.code === "preparation_failed" && error.message.startsWith("Incomplete UI word projection: ")
				&& error.message.includes(alias) && /brace/.test(error.message), why);
		const accepted = acceptedUiTexts(answer({ [alias]: row }), catalog);
		assert.equal(Object.keys(accepted).length, 2, `the host refuses the same row and keeps the others: ${why}`);
	}
});

test('a projected caption must preserve every placeholder including repetition',()=>{
 const catalog=issuePresentationReferences(['Turn {n}','Line {name}'],{protectSyntax:true});
 const [turn,line]=catalog.sources;
 for(const operation of [
  {source:turn.alias,action:'translate',text:'Turn'},
  {source:turn.alias,action:'translate',pieces:[{text:'Turn '},{token:'token:999'}]},
  {source:turn.alias,action:'translate',pieces:[{text:'Turn '},{token:turn.pieces.find(piece=>'token' in piece).token},{token:turn.pieces.find(piece=>'token' in piece).token}]},
 ]) assert.throws(()=>validateUiPresentation({protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[operation]},[turn]));
 const value={protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[
  {source:turn.alias,action:'translate',text:'Turn'},translated(line),
 ]};
 assert.deepEqual(acceptedUiTexts(value,catalog),{'Line {name}':'<Line {name}>'});
});

for (const repair of [true, false]) test(`malformed UI output is retried, with complete-only caching (repair=${repair})`, async () => {
	const { contentRoot, home } = await fixture();
	const digest = await uiWordsDigest(contentRoot);
	const cache = uiWordsCachePath(home, "cc", digest);
	const packets = [];
	let attempt;
	const run = async request => {
		attempt = request.cwd;
		const packet = JSON.parse(await readFile(join(attempt, "texts.json"), "utf8"));
		packets.push(packet);
		assert.equal(request.eventLog, join(attempt, `events-${packets.length}.jsonl`));
		assert.equal(request.timeoutMs, 120000);
		await writeFile(request.eventLog, "owner event\n");
		await assert.rejects(readFile(cache), { code: "ENOENT" });
		if (packets.length === 2) {
			assert.match(request.brief, /Read findings.json/);
			const findings = JSON.parse(await readFile(join(attempt, "findings.json"), "utf8"));
			assert.match(findings.error, /SyntaxError/);
			assert.deepEqual(findings.sources, packet.sources.map(source=>source.alias));
		}
		await writeFile(join(attempt, "presentation.json"), packets.length === 2 && repair
			? JSON.stringify(response(packet)) : "not JSON");
		return { ok: true };
	};
	const result = prepareUiWords({ home, contentRoot, play_language: "cc", runner: run });
	if (repair) assert.equal((await result).texts.sheet.refresh, "<Refresh>");
	else {
		await assert.rejects(result, error => error.code === "preparation_failed"
			&& error.message === "Incomplete UI word projection: 4 captions were not projected");
		await assert.rejects(readFile(cache), { code: "ENOENT" });
	}
	assert.equal(packets.length, 2);
	assert.deepEqual(packets[1], packets[0], "no malformed words were accepted");
	assert.deepEqual((await readdir(attempt)).sort(), ["check.mjs", "events-1.jsonl", "events-2.jsonl", "findings.json", "presentation.json", "texts.json"]);
});

test("a UI caption that loses a placeholder is repaired without re-asking accepted captions", async () => {
	const { contentRoot, home } = await fixture();
	await writeFile(join(contentRoot, "ui/aa/sheet.json"), JSON.stringify({ turn: "Turn {n}", refresh: "Refresh" }));
	const packets = [];
	const result = await prepareUiWords({ home, contentRoot, play_language: "cc", runner: async request => {
		const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
		packets.push(packet);
		const output=response(packet);
		if (packets.length === 1) {
			const turn=packet.sources.find(source=>sourceText(source)==='Turn {n}');
			output.texts=output.texts.map(operation=>operation.source===turn.alias?{source:turn.alias,action:'translate',pieces:[{text:'Turn'}]}:operation);
		}
		else {
			const findings = JSON.parse(await readFile(join(request.cwd, "findings.json"), "utf8"));
			assert.deepEqual(findings, { error: "these source aliases were not answered with a valid keep or translation operation", sources: [packet.sources[0].alias] });
		}
		await writeFile(join(request.cwd, "presentation.json"), JSON.stringify(output));
		return { ok: true };
	} });
	assert.equal(packets.length, 2);
	assert.deepEqual(packets[1].sources.map(sourceText), ["Turn {n}"]);
	assert.equal(result.texts.sheet.turn, "<Turn {n}>");
	assert.equal(result.texts.sheet.refresh, "<Refresh>");
});

for (const aborted of [false, true]) for (const failRound of [1, 2])
	test(`UI execution failure preserves its code and message without caching (abort=${aborted}, round=${failRound})`, async () => {
		const { contentRoot, home } = await fixture();
		const controller = new AbortController();
		let calls = 0;
		await assert.rejects(prepareUiWords({ home, contentRoot, play_language: "cc", model: "owner/model", thinking: "high",
			signal: controller.signal, runner: async request => {
				calls++;
				assert.equal(request.model, "owner/model");
				assert.equal(request.thinking, "high");
				assert.strictEqual(request.signal, controller.signal);
				assert.equal(request.timeoutMs, 120000);
				const packet=JSON.parse(await readFile(join(request.cwd,'texts.json'),'utf8'));
				const source=packet.sources.find(source=>sourceText(source)==='Clues')??packet.sources[0];
				await writeFile(join(request.cwd, "presentation.json"), JSON.stringify({protocol:PRESENTATION_REFERENCE_PROTOCOL,texts:[translated(source)]}));
				if (calls < failRound) return { ok: true };
				if (aborted) controller.abort();
				return { ok: aborted, code: 1, stderr: "Model not found", timedOut: false };
			} }), error => error.code === (aborted ? "presentation_timeout" : "preparation_failed")
				&& error.message === "The UI words could not be projected");
		assert.equal(calls, failRound);
		await assert.rejects(readFile(uiWordsCachePath(home, "cc", await uiWordsDigest(contentRoot))), { code: "ENOENT" });
		assert.ok((await readdir(await attemptDir(home))).includes("check.mjs"), "failed attempts remain readable");
	});

test("UI source, seed and cache bypasses require no runner or attempt directory", async () => {
	const { contentRoot, home } = await fixture();
	for (const tag of ["aa", "bb"]) await prepareUiWords({ home, contentRoot, play_language: tag });
	assert.deepEqual(await readdir(home), []);
	await assert.rejects(prepareUiWords({ home, contentRoot, play_language: "cc" }), error =>
		error.code === "preparation_failed" && error.message === "UI word projection requires its owner runtime");
	assert.deepEqual(await readdir(home), [], "missing owner does not create an attempt");
	await prepareUiWords({ home, contentRoot, play_language: "cc", runner: runner().run });
	const attempts = await readdir(join(home, ".coc/ui-words/attempts"));
	const cached = await prepareUiWords({ home, contentRoot, play_language: "cc" });
	assert.equal(cached.texts.sheet.refresh, "<Refresh>");
	assert.deepEqual(await readdir(join(home, ".coc/ui-words/attempts")), attempts);
});

test("the run's checker refuses an unchanged pieces translation, as the host does (§23.3, decision 4)", () => {
	// Ask 13 of the first live run: a caption made only of placeholders, answered `translate` with its
	// own pieces. check.mjs said valid, the host refused the row, and the projection failed twice over.
	const catalog = issuePresentationReferences(["{family} {transition}"], { protectSyntax: true });
	const [session] = catalog.sources;
	const [family, transition] = session.pieces.filter(piece => "token" in piece).map(piece => piece.token);
	const answer = row => ({ protocol: PRESENTATION_REFERENCE_PROTOCOL, texts: [row] });
	const unchanged = answer({ source: session.alias, action: "translate", pieces: [{ token: family }, { text: " " }, { token: transition }] });
	assert.throws(() => validateUiPresentation(unchanged, catalog.sources), error => error.code === "preparation_failed"
		&& error.message.includes(session.alias) && /\bkeep\b/.test(error.message));
	assert.deepEqual(acceptedUiTexts(unchanged, catalog), {}, "the host refuses it too");
	for (const row of [{ source: session.alias, action: "keep" },
		{ source: session.alias, action: "translate", pieces: [{ token: transition }, { text: " / " }, { token: family }] }]) {
		assert.doesNotThrow(() => validateUiPresentation(answer(row), catalog.sources));
		assert.equal(Object.keys(acceptedUiTexts(answer(row), catalog)).length, 1);
	}
});
