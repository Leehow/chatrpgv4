/**
 * 怎么把进程起起来：内核的缺省启动命令（契约第 1 节）与 bin/pi-coc（契约第 9 节）。
 * 两边都用桩程序拦住真正的 uv 与 pi，只看命令行、cwd 与环境。
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { FAKE_KERNEL, openTable } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = realpathSync(join(HERE, "..", ".."));

function scratch(prefix) {
	return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

test("缺省启动命令：uv run --frozen python -m coc.rpc，cwd 是包根，PYTHONPATH 指向 kernel", async (t) => {
	const stubDir = scratch("pi-coc-uv-");
	const log = join(stubDir, "uv.log");
	const stub = join(stubDir, "uv");
	writeFileSync(
		stub,
		[
			"#!/usr/bin/env bash",
			'{ echo "cwd=$(pwd)"; echo "pythonpath=$PYTHONPATH"; printf "arg=%s\\n" "$@"; } > "$UV_STUB_LOG"',
			'exec node "$FAKE_KERNEL_PATH"',
			"",
		].join("\n"),
	);
	chmodSync(stub, 0o755);

	const table = await openTable({
		responses: [fauxAssistantMessage("好")],
		env: {
			// 不设 PI_COC_KERNEL_CMD，走扩展自己拼的缺省命令。
			PI_COC_KERNEL_CMD: undefined,
			PATH: `${stubDir}:${process.env.PATH}`,
			UV_STUB_LOG: log,
			FAKE_KERNEL_PATH: FAKE_KERNEL,
		},
	});
	t.after(() => {
		rmSync(stubDir, { recursive: true, force: true });
		return table.dispose();
	});

	assert.deepEqual(
		// 记忆车道的缺省派发（补抽，#20）开桌后也会来一次，跟这个用例无关，滤掉。
		table.kernelRequests().map((entry) => entry.method).filter((method) => !method.startsWith("memory.")),
		["kernel.hello", "table.open"],
		"缺省命令也应该真的把桌子开起来",
	);

	const lines = readFileSync(log, "utf8").trim().split("\n");
	const args = lines.filter((line) => line.startsWith("arg=")).map((line) => line.slice(4));
	assert.deepEqual(args, [
		"run",
		"--frozen",
		"python",
		"-m",
		"coc.rpc",
		"--workspace",
		table.workspace,
		"--content",
		join(REPO, "content"),
	]);
	assert.equal(lines.find((line) => line.startsWith("cwd=")), `cwd=${REPO}`, "内核在包根里跑");
	assert.equal(lines.find((line) => line.startsWith("pythonpath=")), `pythonpath=${join(REPO, "kernel")}`);
});

/** 造一棵最小的仓库树：启动器 + 守秘人提示 + 假的 pi。 */
function fakeRepo() {
	const root = scratch("pi-coc-launcher-");
	mkdirSync(join(root, "bin"));
	mkdirSync(join(root, "prompts"));
	mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
	copyFileSync(join(REPO, "bin", "pi-coc"), join(root, "bin", "pi-coc"));
	chmodSync(join(root, "bin", "pi-coc"), 0o755);
	writeFileSync(join(root, "prompts", "keeper.md"), "# 守秘人\n");
	writeFileSync(join(root, "prompts", "setup.md"), "# 建卡\n");
	const piStub = join(root, "node_modules", ".bin", "pi");
	writeFileSync(
		piStub,
		[
			"#!/usr/bin/env bash",
			'{ echo "cwd=$(pwd)"; echo "agentdir=$PI_CODING_AGENT_DIR"; echo "campaign=${PI_COC_CAMPAIGN-<unset>}";',
			'  echo "mode=${PI_COC_MODE-<unset>}"; printf "arg=%s\\n" "$@"; } > "$PI_STUB_LOG"',
			"",
		].join("\n"),
	);
	chmodSync(piStub, 0o755);
	return root;
}

function runLauncher(root, args, extraEnv = {}) {
	const log = join(root, "pi.log");
	const env = { ...process.env, PI_STUB_LOG: log, ...extraEnv };
	delete env.PI_COC_CAMPAIGN;
	execFileSync(join(root, "bin", "pi-coc"), args, { env, encoding: "utf8" });
	const lines = readFileSync(log, "utf8").trim().split("\n");
	return {
		lines,
		args: lines.filter((line) => line.startsWith("arg=")).map((line) => line.slice(4)),
		value: (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1),
	};
}

test("bin/pi-coc：写 settings.json、导出战役、拼出 pi 的命令行", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const run = runLauncher(root, ["--campaign", "camp-a", "--mode", "rpc", "--no-session"]);

	assert.equal(run.value("cwd"), root, "cwd 是仓库根");
	assert.equal(run.value("agentdir"), join(root, ".pi", "coc-agent"));
	assert.equal(run.value("campaign"), "camp-a");
	assert.deepEqual(run.args, [
		"--no-builtin-tools",
		"--no-context-files",
		"--system-prompt",
		join(root, "prompts", "keeper.md"),
		"--session-id",
		"coc-camp-a",
		"--mode",
		"rpc",
		"--no-session",
	]);

	const settings = JSON.parse(readFileSync(join(root, ".pi", "coc-agent", "settings.json"), "utf8"));
	assert.deepEqual(settings, { packages: [root], quietStartup: true });
});

test("bin/pi-coc：已有 settings.json 只补 packages，不动别的键", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, ".pi", "coc-agent", "settings.json");
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify({ packages: ["npm:someone-else@1"], defaultModel: "x/y" }, null, 2));

	runLauncher(root, ["--campaign", "camp-b"]);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.deepEqual(settings.packages, ["npm:someone-else@1", root]);
	assert.equal(settings.defaultModel, "x/y", "别人的设置不动");
	assert.equal(settings.quietStartup, undefined, "已有配置不硬塞 quietStartup");
});

test("bin/pi-coc：不给战役就不定 session-id，也不导出 PI_COC_CAMPAIGN", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const run = runLauncher(root, ["--mode", "rpc"]);

	assert.equal(run.value("campaign"), "<unset>");
	assert.deepEqual(run.args, [
		"--no-builtin-tools",
		"--no-context-files",
		"--system-prompt",
		join(root, "prompts", "keeper.md"),
		"--mode",
		"rpc",
	]);
});

test("bin/pi-coc：没装 pi 时报清楚", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	rmSync(join(root, "node_modules", ".bin", "pi"));

	assert.throws(
		() => execFileSync(join(root, "bin", "pi-coc"), ["--campaign", "camp-a"], { encoding: "utf8", stdio: "pipe" }),
		(error) => {
			assert.equal(error.status, 1);
			assert.match(error.stderr, /npm install/);
			return true;
		},
	);
});

test("bin/pi-coc setup：建卡进程另起一页提示、另一个模式、另一个会话（契约 §14.4）", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const run = runLauncher(root, ["setup", "--campaign", "camp-c"]);

	assert.equal(run.value("mode"), "setup", "扩展按 PI_COC_MODE 决定注册什么工具");
	assert.equal(run.value("campaign"), "camp-c");
	assert.deepEqual(run.args, [
		"--no-builtin-tools",
		"--no-context-files",
		"--system-prompt",
		join(root, "prompts", "setup.md"),
		"--session-id",
		"coc-setup-camp-c",
	]);
});

test("bin/pi-coc：不写 setup 就是开桌，模式是 play", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const run = runLauncher(root, ["--campaign", "camp-d"]);

	assert.equal(run.value("mode"), "play");
	assert.equal(run.args[3], join(root, "prompts", "keeper.md"), "开桌用守秘人提示");
	assert.equal(run.args[5], "coc-camp-d", "开桌的会话 id 跟建卡分开");
});
