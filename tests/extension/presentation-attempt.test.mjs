/** The shared file protocol is driven by an injected owner, never a model or a spawn backend. */
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPresentationAttempt } from "../../extensions/module/presentation-attempt.ts";

const OK = { ok: true, code: 0, timedOut: false, ms: 1, stderr: "", command: [] };
const json = async path => JSON.parse(await readFile(path, "utf8"));

async function fixture(overrides = {}) {
	const home = await mkdtemp(join(tmpdir(), "presentation-attempt-"));
	const attempt = join(home, "attempt");
	return {
		attempt, checkSource: "// caller-owned checker\n", outputFile: "answer.json", systemPrompt: "/owner/prompt.md",
		prepareRound: async round => {
			await writeFile(join(attempt, "packet.json"), JSON.stringify({ round }));
			return `owner brief ${round}`;
		},
		accept: () => ({ done: true }),
		invalidOutput: (error, round) => ({ error: String(error), round }),
		failure: () => new Error("owner failure"),
		...overrides,
	};
}

test("the helper establishes the attempt and checker, forwards execution settings and stops on acceptance", async () => {
	const controller = new AbortController();
	const requests = [];
	const options = await fixture({ model: "owner/model", thinking: "high", signal: controller.signal });
	options.runner = async request => {
		requests.push(request);
		assert.equal(await readFile(join(request.cwd, "check.mjs"), "utf8"), options.checkSource);
		assert.deepEqual(await json(join(request.cwd, "packet.json")), { round: 1 });
		assert.deepEqual(request, {
			cwd: options.attempt, systemPrompt: options.systemPrompt, model: options.model, thinking: "high",
			signal: controller.signal, timeoutMs: 120000, eventLog: join(options.attempt, "events-1.jsonl"), brief: "owner brief 1",
		});
		await writeFile(request.eventLog, '{"owner":"event"}\n');
		await writeFile(join(request.cwd, "answer.json"), '{"title":"accepted"}');
		return OK;
	};
	options.accept = (value, round) => {
		assert.deepEqual(value, { title: "accepted" });
		assert.equal(round, 1);
		return { done: true };
	};
	await runPresentationAttempt(options);
	assert.equal(requests.length, 1);
	assert.deepEqual((await readdir(options.attempt)).sort(), ["answer.json", "check.mjs", "events-1.jsonl", "packet.json"]);
	assert.equal(await readFile(requests[0].eventLog, "utf8"), '{"owner":"event"}\n');
});

test("a rejected output leaves caller findings before the second packet and preserves both event logs", async () => {
	const options = await fixture();
	const prepared = [], accepted = [];
	const findings = { error: "owner validation failed", remaining: ["one"] };
	options.prepareRound = async round => {
		prepared.push(round);
		if (round === 2) assert.deepEqual(await json(join(options.attempt, "findings.json")), findings);
		return `repair ${round}`;
	};
	options.runner = async request => {
		await writeFile(request.eventLog, `${request.brief}\n`);
		await writeFile(join(request.cwd, "answer.json"), JSON.stringify({ round: prepared.at(-1) }));
		return OK;
	};
	options.accept = async (value, round) => {
		accepted.push(value.round);
		return round === 1 ? { done: false, findings } : { done: true };
	};
	await runPresentationAttempt(options);
	assert.deepEqual(prepared, [1, 2]);
	assert.deepEqual(accepted, [1, 2]);
	assert.equal(await readFile(join(options.attempt, "events-1.jsonl"), "utf8"), "repair 1\n");
	assert.equal(await readFile(join(options.attempt, "events-2.jsonl"), "utf8"), "repair 2\n");
	assert.deepEqual(await json(join(options.attempt, "findings.json")), findings, "successful repair retains its evidence");
});

for (const broken of ["malformed", "absent"]) test(`${broken} JSON is reported to the caller and can be repaired in round two`, async () => {
	const options = await fixture();
	const accepted = [];
	let calls = 0;
	options.runner = async request => {
		calls++;
		if (calls === 1 && broken === "malformed") await writeFile(join(request.cwd, "answer.json"), "not JSON");
		if (calls === 2) {
			const findings = await json(join(request.cwd, "findings.json"));
			assert.equal(findings.round, 1);
			assert.match(findings.error, broken === "malformed" ? /SyntaxError/ : /ENOENT/);
			await writeFile(join(request.cwd, "answer.json"), '{"fixed":true}');
		}
		return OK;
	};
	options.accept = (value, round) => { accepted.push({ value, round }); return { done: true }; };
	await runPresentationAttempt(options);
	assert.equal(calls, 2);
	assert.deepEqual(accepted, [{ value: { fixed: true }, round: 2 }]);
});

for (const broken of ["malformed", "rejected"]) test(`two ${broken} outputs exhaust the attempt without a third call or discarding findings`, async () => {
	const options = await fixture();
	let calls = 0;
	options.runner = async request => {
		calls++;
		await writeFile(join(request.cwd, "answer.json"), broken === "malformed" ? "not JSON" : "{}");
		return OK;
	};
	options.accept = (_value, round) => ({ done: false, findings: { error: "incomplete", round } });
	await runPresentationAttempt(options);
	assert.equal(calls, 2);
	assert.equal((await json(join(options.attempt, "findings.json"))).round, 2);
	assert.equal(await readFile(join(options.attempt, "check.mjs"), "utf8"), options.checkSource);
});

for (const aborted of [false, true]) test(`owner failure identity survives (aborted=${aborted}) without a repair round`, async () => {
	const controller = new AbortController();
	const outcome = { ...OK, ok: false, code: 1, stderr: "provider failure" };
	const expected = Object.assign(new Error("owner-specific detail"), { code: aborted ? "presentation_timeout" : "preparation_failed" });
	let calls = 0;
	const options = await fixture({ signal: controller.signal });
	options.runner = async () => {
		calls++;
		if (aborted) controller.abort();
		return outcome;
	};
	options.failure = (seen, cancelled) => {
		assert.strictEqual(seen, outcome);
		assert.equal(cancelled, aborted);
		return expected;
	};
	await assert.rejects(runPresentationAttempt(options), error => error === expected);
	assert.equal(calls, 1);
	await assert.rejects(readFile(join(options.attempt, "findings.json")), { code: "ENOENT" });
});

test("cancellation takes precedence over an owner reporting success", async () => {
	const controller = new AbortController();
	const expected = new Error("cancelled by owner");
	const options = await fixture({ signal: controller.signal });
	options.runner = async () => { controller.abort(); return OK; };
	options.failure = (outcome, aborted) => {
		assert.strictEqual(outcome, OK);
		assert.equal(aborted, true);
		return expected;
	};
	options.accept = () => assert.fail("cancelled output must not be accepted");
	await assert.rejects(runPresentationAttempt(options), error => error === expected);
});

test("thrown runner and acceptance errors retain their identity instead of being retried as bad JSON", async () => {
	for (const stage of ["runner", "accept"]) {
		const expected = new Error(stage);
		const options = await fixture();
		let calls = 0;
		options.runner = async request => {
			calls++;
			if (stage === "runner") throw expected;
			await writeFile(join(request.cwd, "answer.json"), "{}");
			return OK;
		};
		options.accept = () => { throw expected; };
		await assert.rejects(runPresentationAttempt(options), error => error === expected);
		assert.equal(calls, 1);
	}
});
