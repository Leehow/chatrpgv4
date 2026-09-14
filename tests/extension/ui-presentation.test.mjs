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
			const skip = new Set(rounds.length === 1 ? drop : []);
			const texts = Object.fromEntries(packet.texts.filter(text => !skip.has(text)).map(text => [text, `<${text}>`]));
			await writeFile(join(request.cwd, "presentation.json"), JSON.stringify({ texts }));
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
	assert.deepEqual(validateUiPresentation({ texts: { a: "A", b: "B" } }, ["a", "b"]), { a: "A", b: "B" });
	for (const bad of [null, {}, { texts: [] }, { texts: { a: "A" } }, { texts: { a: "A", b: "  " } }, { texts: { a: "A", b: "B", c: "C" } }])
		assert.throws(() => validateUiPresentation(bad, ["a", "b"]), /Incomplete UI word projection/, JSON.stringify(bad));
	assert.deepEqual(acceptedUiTexts({ texts: { a: "A", b: " ", c: "C" } }, ["a", "b"]), { a: "A" },
		"what validated is kept; a blank and an unasked word are not");
});

test("a tag with nothing to read is projected once and cached in the shape the loader reads back", async () => {
	const { contentRoot, home } = await fixture();
	const fake = runner();
	const result = await prepareUiWords({ home, contentRoot, play_language: "cc", runner: fake.run });

	assert.equal(fake.rounds.length, 1, "one round is enough when the answer is complete");
	assert.deepEqual(fake.rounds[0].texts, ["Clues", "Name", "Refresh", "Something went wrong"],
		"the distinct authored strings, asked once each");
	assert.deepEqual(fake.rounds[0].captions.filter(row => row.text === "Clues"),
		[{ surface: "errors", key: "stale", text: "Clues" }, { surface: "sheet", key: "clues", text: "Clues" }],
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
	assert.deepEqual(fake.rounds[1].texts, ["Refresh"], "only the caption that was dropped");
	assert.deepEqual(fake.rounds[1].captions, [{ surface: "sheet", key: "refresh", text: "Refresh" }]);
	assert.equal(result.texts.sheet.refresh, "<Refresh>");
	assert.equal(result.texts.sheet.clues, "<Clues>", "the first round's words survived the miss");
	const findings = JSON.parse(await readFile(join((await attemptDir(home)), "findings.json"), "utf8"));
	assert.deepEqual(findings.texts, ["Refresh"], "the round is told exactly what it still owes");
});

test("a caption the second round still drops fails the projection, and nothing is cached", async () => {
	const { contentRoot, home } = await fixture();
	const stubborn = {
		rounds: [],
		async run(request) {
			const packet = JSON.parse(await readFile(join(request.cwd, "texts.json"), "utf8"));
			stubborn.rounds.push(packet);
			await writeFile(join(request.cwd, "presentation.json"),
				JSON.stringify({ texts: Object.fromEntries(packet.texts.filter(text => text !== "Refresh").map(text => [text, `<${text}>`])) }));
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

test('partial seeds project from the authored source and fill newly added captions',async()=>{
 const {home,contentRoot}=await fixture();
 await writeFile(join(contentRoot,'ui/bb/sheet.json'),JSON.stringify({clues:'bb Clues'}));
 assert.equal((await resolveUiWords({home,contentRoot,tag:'bb'})).projected,false);
 const fake=runner();
 await prepareUiWords({home,contentRoot,play_language:'bb',runner:fake.run});
 assert.equal(fake.rounds.length,1);
 assert.ok(fake.rounds[0].texts.includes('Refresh'));
 assert.ok(fake.rounds[0].texts.includes('Clues'));
 assert.ok(!fake.rounds[0].texts.includes('bb Clues'));
 const complete=await resolveUiWords({home,contentRoot,tag:'bb'});
 assert.equal(complete.projected,true);
 assert.equal(complete.words.sheet.clues,'bb Clues');
 assert.equal(complete.words.sheet.refresh,'<Refresh>');
});

test('a projected caption must preserve every placeholder including repetition',()=>{
 for(const value of ['Turn','Turn {other}','Turn {n} {n}'])
  assert.throws(()=>validateUiPresentation({texts:{'Turn {n}':value}},['Turn {n}']));
 assert.deepEqual(acceptedUiTexts({texts:{'Turn {n}':'Turn','Line {name}':'<{name}>'}},['Turn {n}','Line {name}']),{'Line {name}':'<{name}>'});
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
			assert.deepEqual(findings.texts, packet.texts);
		}
		await writeFile(join(attempt, "presentation.json"), packets.length === 2 && repair
			? JSON.stringify({ texts: Object.fromEntries(packet.texts.map(text => [text, `<${text}>`])) }) : "not JSON");
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
		const texts = Object.fromEntries(packet.texts.map(text => [text, `<${text}>`]));
		if (packets.length === 1) texts["Turn {n}"] = "Turn";
		else {
			const findings = JSON.parse(await readFile(join(request.cwd, "findings.json"), "utf8"));
			assert.deepEqual(findings, { error: "these source strings were not answered with a non-empty string", texts: ["Turn {n}"] });
		}
		await writeFile(join(request.cwd, "presentation.json"), JSON.stringify({ texts }));
		return { ok: true };
	} });
	assert.equal(packets.length, 2);
	assert.deepEqual(packets[1].texts, ["Turn {n}"]);
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
				await writeFile(join(request.cwd, "presentation.json"), JSON.stringify({ texts: { Clues: "<Clues>" } }));
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
