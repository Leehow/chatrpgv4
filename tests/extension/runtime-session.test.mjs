import assert from "node:assert/strict";
import { test } from "node:test";
import { openTable } from "./harness.mjs";
import { createRuntime, kernelCommand } from "../../runtime/host.ts";

for (const mode of ["setup", "play"]) {
	test(`${mode} publishes one owner on the existing bridge and revokes it on shutdown`, async () => {
		const table = await openTable({ mode });
		const bridge = table.runtimeBridges().find(row => row.call);
		assert.ok(bridge?.runtime);
		assert.equal(bridge.runtime.home, table.workspace);
		if (mode === "setup") assert.ok(!table.kernelRequests().some(row => row.method === "table.open"));
		const client = bridge.runtime.openKernel();
		await bridge.call("kernel.hello", {});
		assert.equal(bridge.runtime.openKernel(), client);
		await table.dispose();
		const revoked = table.runtimeBridges().at(-1);
		assert.equal(revoked.call, undefined);
		assert.equal(revoked.runtime, undefined);
		await assert.rejects(bridge.call("kernel.hello", {}), /closed/);
		assert.throws(() => bridge.runtime.openKernel(), /closed/);
	});
}

test("a selected TypeScript runtime cannot fall back when its compiled entry is absent", () => {
	const env = { ...process.env, PI_COC_RUNTIME: "typescript", PI_COC_KERNEL_CMD: undefined };
	const command = kernelCommand(process.cwd(), { env, kernelEntrypoint: "missing-kernel-entry.mjs" });
	assert.equal(command[0], process.execPath);
	assert.ok(command[1].endsWith("missing-kernel-entry.mjs"));
	assert.throws(() => createRuntime({ owner: "check", home: process.cwd() }, {
		env, kernelEntrypoint: "missing-kernel-entry.mjs",
	}), /Runtime configuration failed/);
});
