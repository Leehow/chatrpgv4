/**
 * A player-bound `message` is written by the layer that emits it (§48).
 *
 * Four raw English sentences reached players in one day, on four unrelated paths: a preparation
 * banner, an upload, a turn transport, and the right-hand sheet. That is not four forgotten
 * strings, it is one missing rule -- service failures never went through the presentation lane at
 * all, because a caught exception's own text was being copied straight into the field §23 shows.
 *
 * The worst of them named an internal tool at the player: the right-hand sheet showed a read
 * failure, the generic caption, and under the fold `kernel table.view did not answer within 15000
 * ms`. The caption was generic because `internal` is a kernel code the product's words do not
 * carry -- that part is the designed visible gap -- but the fold underneath was the kernel
 * client's own diagnostic, method name and deadline and all.
 *
 * The rule is a field discipline settled at the producer, never a guess about what a string looks
 * like: the **code** travels (it is an identifier, and an unregistered one falls back to
 * `errors.unknown`, a gap a player can name), this layer's own **message** travels, and text from
 * a layer below travels as **detail**, which is logged and never placed in an answer a renderer
 * reads. A refusal this layer minted itself is already both, and passes whole.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { registerSheetPanel } from "../../pipicoc/sheet.ts";
import { KernelClient } from "../../extensions/kernel/client.ts";

/** The pack's invoke handlers, registered on the well-known registry the way PipiUI does. */
function sheetPack() {
	const symbol = Symbol.for("pipiui.ext-invoke.registry");
	const prior = globalThis[symbol];
	const handlers = new Map();
	globalThis[symbol] = { version: 1, register(_id, method, handler) { handlers.set(method, handler); return () => {}; } };
	const pi = { events: new EventEmitter(), on() {} };
	try { registerSheetPanel(pi, {}); } finally { globalThis[symbol] = prior; }
	return { pi, sheet: handlers.get("sheet") };
}

/** A bound table whose `table.view` fails the way the real one did. */
async function tableThatFails(thrown) {
	const home = await mkdtemp(join(tmpdir(), "pipicoc-service-error-"));
	await mkdir(join(home, ".coc", "campaigns", "c1"), { recursive: true });
	const { pi, sheet } = sheetPack();
	pi.events.emit("coc:kernel-bridge", {
		campaign: "c1",
		runtime: { contentRoot: home, home, signal: new AbortController().signal },
		call: async () => { throw thrown; },
	});
	return sheet;
}

/** Every string this answer would put in front of a player, wherever a renderer reads one. */
const spoken = answer => JSON.stringify({ code: answer.code, reason: answer.reason, status: answer.status });

test("the sheet never repeats the kernel's own diagnostic at the player", async () => {
	// Exactly what a real table was shown, minted in `extensions/kernel/client.ts`.
	const kernelTimeout = Object.assign(new Error("kernel table.view did not answer within 15000 ms"), { code: "internal" });
	const sheet = await tableThatFails(kernelTimeout);
	const answer = await sheet({});

	assert.equal(answer.status, "error");
	// The code still travels: it is an identifier, and one the words do not carry is a visible gap.
	assert.equal(answer.code, "internal");
	// The diagnostic does not. Not the method name, not the deadline, not the sentence.
	assert.doesNotMatch(spoken(answer), /table\.view/, "the kernel's method name is not a player's word");
	assert.doesNotMatch(spoken(answer), /15000/, "nor is an internal deadline");
	assert.doesNotMatch(spoken(answer), /did not answer within/);
	// What is there instead is this layer's own English, one sentence, the same every time.
	assert.equal(typeof answer.reason, "string");
	assert.ok(answer.reason.trim(), "the fold still has a sentence in it");
	const second = await (await tableThatFails(Object.assign(new Error("kernel table.view blew up at /Users/someone/secret/path.ts:12"),
		{ code: "internal" })))({});
	assert.equal(second.reason, answer.reason, "the sentence belongs to the boundary, not to the exception");
	assert.doesNotMatch(spoken(second), /secret/, "a path in a stack is never a player's word either");
});

test("a refusal the sheet minted itself passes whole, because it was written to be said", async () => {
	// No bridge at all: the layer's own refusal, code and sentence both its own.
	const answer = await sheetPack().sheet({});
	assert.equal(answer.code, "table_not_open");
	assert.equal(answer.reason, "the table is not open", "an authored sentence is not replaced by a generic one");
});

test("a kernel call that never answers tells the diagnostic sink, so dropping it downstream loses nothing", async t => {
	// The sheet stops repeating this text at the player only because it is kept here. A boundary
	// that drops a diagnostic and nothing records it has not moved the text, it has lost it.
	const dir = mkdtempSync(join(tmpdir(), "coc-kernel-timeout-"));
	const diagnostics = [];
	const client = new KernelClient({
		// A kernel that reads its input and answers nothing at all.
		command: [process.execPath, "-e", "process.stdin.resume()"],
		cwd: dir,
		inheritEnv: false,
		timeoutMs: 60,
		onDiagnostic: message => diagnostics.push(message),
	});
	t.after(() => client.close());

	await assert.rejects(client.call("table.view", { campaign: "c1" }), /did not answer within/);
	assert.ok(diagnostics.some(line => line.includes("table.view") && line.includes("60")),
		`the timeout is in the diagnostic sink: ${JSON.stringify(diagnostics)}`);
});
