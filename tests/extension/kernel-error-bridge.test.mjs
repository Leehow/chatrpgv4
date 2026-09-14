import assert from "node:assert/strict";
import { test } from "node:test";
import { KernelError, isKernelError } from "../../extensions/kernel/client.ts";

test("RPC error details survive separately loaded extension module instances", async () => {
	const { KernelError: OtherKernelError } = await import("../../extensions/kernel/client.ts?other-extension-instance");
	const error = new OtherKernelError({ code: "needs_choice", message: "conflicting source value", fix: "compare both references", details: { path: "/nodes/npc-one/summary" } });
	assert.equal(error instanceof KernelError, false);
	assert.equal(isKernelError(error), true);
	assert.equal(error.details.path, "/nodes/npc-one/summary");
	assert.match(error.toToolText(), /compare both references/);
	assert.match(error.toToolText(), /^retryable: false$/m);
	assert.match(error.toToolText(), /^next: change_input$/m);
	const invalid = new KernelError({ code: "invalid_params", message: "bad input" });
	assert.match(invalid.toToolText(), /^retryable: false$/m);
	assert.match(invalid.toToolText(), /^next: change_input$/m);
	const internal = new KernelError({ code: "internal", message: "disk failure" });
	assert.match(internal.toToolText(), /^retryable: false$/m);
	assert.match(internal.toToolText(), /^next: stop$/m);
	assert.equal(isKernelError(Object.assign(new Error("filesystem failure"), { code: "ENOENT" })), false);
});
