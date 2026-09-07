/**
 * `PI_COC_HOME` (contract §20.7): where `.coc/` lives.
 *
 * It used to be `ctx.cwd` and nothing else, so a book parsed in one directory was invisible from
 * another and an installed application would keep its library wherever it happened to be started.
 * The default does not change — start `pi` in the repository and everything is where it was — but the
 * variable now decides, and it has to reach three places: the kernel subprocess's `--workspace`, the
 * campaign telemetry, and the evidence paths the person is shown.
 */

import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { cocHome } from "../../extensions/lanes/host.ts";
import { kernelCommand } from "../../extensions/kernel/index.ts";
import { openTable } from "./harness.mjs";

function withEnv(values, body) {
	const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return body();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("PI_COC_HOME: unset is the working directory; a path, a relative path and ~ all resolve", () => {
	withEnv({ PI_COC_HOME: undefined }, () => {
		assert.equal(cocHome("/tmp/table"), "/tmp/table", "the default is exactly what it was");
	});
	withEnv({ PI_COC_HOME: "   " }, () => {
		assert.equal(cocHome("/tmp/table"), "/tmp/table", "blank is not a home");
	});
	withEnv({ PI_COC_HOME: "/var/pi-coc" }, () => {
		assert.equal(cocHome("/tmp/table"), "/var/pi-coc");
	});
	withEnv({ PI_COC_HOME: "library" }, () => {
		assert.equal(cocHome("/tmp/table"), "/tmp/table/library", "a relative home hangs off the working directory");
	});
	withEnv({ PI_COC_HOME: "~/Library/pi-coc" }, () => {
		assert.equal(cocHome("/tmp/table"), join(homedir(), "Library", "pi-coc"));
	});
});

test("PI_COC_HOME: the kernel subprocess is given it as its --workspace (contract §1, §20.7)", () => {
	withEnv({ PI_COC_KERNEL_CMD: undefined, PI_COC_HOME: undefined }, () => {
		const command = kernelCommand(cocHome("/tmp/table"));
		assert.equal(command[command.indexOf("--workspace") + 1], "/tmp/table");
	});
	withEnv({ PI_COC_KERNEL_CMD: undefined, PI_COC_HOME: "/var/pi-coc" }, () => {
		const command = kernelCommand(cocHome("/tmp/table"));
		assert.equal(command[0], "uv", "the launch command itself is unchanged");
		assert.equal(command[command.indexOf("--workspace") + 1], "/var/pi-coc", "the module library and the saves move together");
	});
});

test("PI_COC_HOME: a table's telemetry and evidence paths follow the home, not the working directory", async (t) => {
	const table = await openTable({
		uiMode: "tui",
		env: { PI_COC_HOME: "library" },
		responses: [
			fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "门厅里落满灰。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("a sentence after the delivery"),
		],
	});
	t.after(() => table.dispose());

	await table.session.prompt("I step into the hall");

	const home = join(table.workspace, "library");
	assert.ok(
		existsSync(join(home, ".coc", "campaigns", "test-camp", "telemetry.jsonl")),
		"the turn's telemetry is written under the home",
	);
	assert.ok(
		!existsSync(join(table.workspace, ".coc", "campaigns", "test-camp")),
		"and nothing is written beside the working directory any more",
	);

	table.ui.notifications.length = 0;
	await table.session.prompt("/coc evidence");
	const view = table.ui.notifications.at(-1).message;
	assert.match(view, new RegExp(`${home}/\\.coc/campaigns/test-camp$`, "m"), "the person is pointed at the home too");
	assert.match(view, new RegExp(`${home}/\\.coc/playtests$`, "m"));
});
