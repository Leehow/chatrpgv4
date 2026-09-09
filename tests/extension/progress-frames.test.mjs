/**
 * Progress frames (contract §1): a call made with an onProgress listener opts in with a
 * top-level "progress": true, stage frames arrive on that listener in order without
 * settling the call, and frames sent to a call that never asked are diagnosed, not fatal.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KernelClient } from "../../extensions/kernel/client.ts";
import { progressPartial } from "../../extensions/kernel/progress.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROGRESS_KERNEL = join(HERE, "fixtures", "progress-kernel.mjs");

function makeClient(t, { stages } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "coc-progress-"));
	const log = join(dir, "requests.jsonl");
	const diagnostics = [];
	const client = new KernelClient({
		command: [process.execPath, PROGRESS_KERNEL],
		cwd: dir,
		env: {
			PROGRESS_KERNEL_LOG: log,
			...(stages ? { PROGRESS_KERNEL_STAGES: JSON.stringify(stages) } : {}),
		},
		inheritEnv: false,
		onDiagnostic: (message) => diagnostics.push(message),
	});
	t.after(() => client.close());
	return { client, log, diagnostics };
}

function requests(log) {
	return readFileSync(log, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

test("an opted-in call receives progress frames in order and the final result is unchanged", async (t) => {
	const { client, log } = makeClient(t, { stages: ["load", "validate", "commit"] });
	const frames = [];
	const result = await client.call("table.narrate", { campaign: "test-camp", text: "I open the door." }, (frame) => frames.push(frame));
	assert.deepEqual(result, { method: "table.narrate" });
	assert.deepEqual(frames.map((frame) => frame.stage), ["load", "validate", "commit"]);
	const sent = requests(log);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].progress, true);
	assert.equal(sent[0].method, "table.narrate");
	assert.deepEqual(sent[0].params, { campaign: "test-camp", text: "I open the door." });
});

test("a call without a listener does not opt in and unsolicited frames are diagnosed, not fatal", async (t) => {
	const { client, log, diagnostics } = makeClient(t, { stages: ["load", "write"] });
	const result = await client.call("table.narrate", { campaign: "test-camp", text: "I wait." });
	assert.deepEqual(result, { method: "table.narrate" });
	const sent = requests(log);
	assert.equal(sent.length, 1);
	assert.equal("progress" in sent[0], false);
	assert.ok(diagnostics.some((message) => message.includes("progress frame")), `expected a diagnostic, got: ${diagnostics.join(" | ")}`);
});

test("progressPartial renders the closed narrate stage table and passes unknown stages through", () => {
	assert.equal(progressPartial({ stage: "load" }).content[0].text, "Loading campaign state");
	assert.equal(progressPartial({ stage: "validate" }).content[0].text, "Validating turn");
	assert.equal(progressPartial({ stage: "project" }).content[0].text, "Projecting mechanics");
	assert.equal(progressPartial({ stage: "write" }).content[0].text, "Writing turn record");
	assert.equal(progressPartial({ stage: "commit" }).content[0].text, "Committing turn");
	assert.equal(progressPartial({ stage: "poststep" }).content[0].text, "Writing checkpoint");
	const unknown = progressPartial({ stage: "some_future_stage" });
	assert.equal(unknown.content[0].text, "some_future_stage");
	assert.deepEqual(unknown.details, { stage: "some_future_stage" });
});
