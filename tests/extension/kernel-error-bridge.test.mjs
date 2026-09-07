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
	assert.equal(isKernelError(Object.assign(new Error("filesystem failure"), { code: "ENOENT" })), false);
});
