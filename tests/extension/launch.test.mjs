/**
 * 怎么把进程起起来：内核的缺省启动命令（契约第 1 节）与 bin/pi-coc（契约第 9 节）。
 * Both seams capture their selected Node/Pi transport, argv, cwd and environment.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { agentExtensionManifests, desktopSessionExtensionPaths, extensionArgs, PI_ENTRIES, providerExtensionManifests,
	readerProviderExtensionPaths, runtimeEntrypoints, sessionExtensionPaths } from "../../runtime/deployment.mjs";
import { FAKE_KERNEL, openTable } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = realpathSync(join(HERE, "..", ".."));
const VENDORED_PI = PI_ENTRIES.pi;

function scratch(prefix) {
	return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

test("the default kernel command uses captured Node and emitted RPC without Python environment", async (t) => {
	const stubDir = scratch("pi-coc-node-");
	const log = join(stubDir, "node.json");
	const stub = join(stubDir, "selected-node.mjs");
	const nodeBin = join(stubDir, "node-bin");
	symlinkSync(process.execPath, nodeBin);
	writeFileSync(stub, `#!${nodeBin}\nimport {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
writeFileSync(process.env.NODE_STUB_LOG,JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),pythonpath:process.env.PYTHONPATH??null,backend:process.env.PI_COC_RUNTIME}));
await import(pathToFileURL(process.env.FAKE_KERNEL_PATH).href);\n`);
	chmodSync(stub, 0o755);

	const table = await openTable({
		responses: [fauxAssistantMessage("好")],
		env: {
			// 不设 PI_COC_KERNEL_CMD，走扩展自己拼的缺省命令。
			PI_COC_KERNEL_CMD: undefined,
			PI_COC_RUNTIME: undefined,
			PI_COC_NODE_EXECUTABLE: stub,
			PYTHONPATH: undefined,
			NODE_STUB_LOG: log,
			FAKE_KERNEL_PATH: FAKE_KERNEL,
		},
	});
	t.after(async () => {
		await table.dispose();
		rmSync(stubDir, { recursive: true, force: true });
	});

	assert.deepEqual(
		// 记忆车道的缺省派发（补抽，#20）开桌后也会来一次，跟这个用例无关，滤掉。
		table.kernelRequests().map((entry) => entry.method).filter((method) => !method.startsWith("memory.")),
		["kernel.hello", "table.open"],
		"缺省命令也应该真的把桌子开起来",
	);

	const captured = JSON.parse(readFileSync(log, "utf8"));
	assert.deepEqual(captured.args, [
		join(REPO, "build/kernel/rpc.mjs"),
		"--workspace",
		table.workspace,
		"--content",
		join(REPO, "content"),
	]);
	assert.equal(captured.cwd, REPO);
	assert.equal(captured.pythonpath, null);
	assert.equal(captured.backend, 'typescript');
});

/** 造一棵最小的仓库树：启动器 + 守秘人提示 + 假的 pi。 */
function fakeRepo() {
	const root = scratch("pi-coc-launcher-");
	mkdirSync(join(root, "bin"));
	mkdirSync(join(root, "prompts"));
	mkdirSync(join(root, "content"));
	mkdirSync(join(root, "build/runtime"), {recursive: true});
	copyFileSync(join(REPO, "build/runtime/launch.mjs"), join(root, "build/runtime/launch.mjs"));
	// The provider extensions are discovered from the manifests in the tree, so the fake tree carries
	// the real ones: a repo whose manifests went missing must show up here as a missing mount.
	for (const entry of agentExtensionManifests(REPO)) {
		mkdirSync(join(root, "extensions", entry.name), { recursive: true });
		copyFileSync(join(REPO, "extensions", entry.name, "pipiui-extension.json"), join(root, "extensions", entry.name, "pipiui-extension.json"));
	}
	mkdirSync(join(root, "node_modules"), { recursive: true });
	// The launcher starts the vendored Pi's CLI from build/node_modules (ADR-0006), never node_modules/.bin/pi.
	mkdirSync(dirname(join(root, VENDORED_PI)), { recursive: true });
	// The emitted launcher intentionally keeps runtime packages external. The fixture owns an isolated
	// dependency view while its fake vendored Pi CLI remains local to this tree.
	symlinkSync(join(REPO, "node_modules", "typebox"), join(root, "node_modules", "typebox"), "dir");
	symlinkSync(join(REPO, "node_modules", "@earendil-works"), join(root, "node_modules", "@earendil-works"), "dir");
	copyFileSync(join(REPO, "bin", "pi-coc"), join(root, "bin", "pi-coc"));
	chmodSync(join(root, "bin", "pi-coc"), 0o755);
	writeFileSync(join(root, "prompts", "keeper.md"), "# 守秘人\n");
	writeFileSync(join(root, "prompts", "setup.md"), "# 建卡\n");
	const piStub = join(root, VENDORED_PI);
	writeFileSync(piStub, `const fs=require('node:fs');
fs.writeFileSync(process.env.PI_STUB_LOG,[
 'cwd='+process.cwd(),'agentdir='+process.env.PI_CODING_AGENT_DIR,'campaign='+(process.env.PI_COC_CAMPAIGN??'<unset>'),
 'mode='+(process.env.PI_COC_MODE??'<unset>'),'runtime='+process.env.PI_COC_RUNTIME,'grokimage='+(process.env.PI_GROK_BUILD_IMAGE_TOOLS??'<unset>'),
 ...process.argv.slice(2).map(arg=>'arg='+arg)].join('\\n')+'\\n');\n`);
	chmodSync(piStub, 0o755);
	return root;
}

function runLauncher(root, args, extraEnv = {}) {
	const log = join(root, "pi.log");
	const env = { ...process.env, PI_STUB_LOG: log, PI_COC_NODE_EXECUTABLE: process.execPath, PI_COC_HOME: root, ...extraEnv };
	delete env.PI_COC_CAMPAIGN;
	execFileSync(join(root, "bin", "pi-coc"), args, { env, encoding: "utf8" });
	const lines = readFileSync(log, "utf8").trim().split("\n");
	return {
		lines,
		args: lines.filter((line) => line.startsWith("arg=")).map((line) => line.slice(4)),
		value: (key) => lines.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1),
	};
}
/**
 * The provider extensions come first as one group, because the session and every lane child mount
 * that same group from one list. Mount order carries no meaning of its own here: the only ordering
 * question Pi ever had was duplicate tool names, and PI_GROK_BUILD_IMAGE_TOOLS=0 settles that below.
 */
function defaultMounts(root) {
	const providers = providerExtensionManifests(root);
	assert.deepEqual(providers.map(entry => entry.name), ['deepseek', 'grok-build-oauth'],
		'the fake tree must carry the same provider manifests the repo does');
	return ['--no-extensions', ...['kernel', 'mods', 'onboarding', 'module', 'memory', 'npc', 'table', 'npc-journal', 'npc-voice'].flatMap(name => ['-e', join(root, 'build/extensions', name, 'index.mjs')]),
		...providers.flatMap(entry => ['-e', entry.entry]),
		'-e', join(root, 'build/extensions/image-gen/agent/index.mjs'),
		'-e', join(root, 'build/extensions/rerank/agent/index.mjs'),
		'-e', join(root, 'build/extensions/jev/agent/index.mjs')];
}

test("shared extension mount helpers preserve consumer boundaries in source and compiled layouts", () => {
	for (const layout of ["source", "compiled"]) {
		const entrypoints = runtimeEntrypoints(REPO, layout);
		const session = sessionExtensionPaths(entrypoints);
		assert.ok(session.every(isAbsolute), `${layout} session mount paths are absolute`);
		assert.deepEqual(extensionArgs(session), defaultMounts(REPO).slice(1));
		assert.deepEqual(desktopSessionExtensionPaths(entrypoints), [
			join(entrypoints.hostAssets, "kernel", "pipiui-ext-invoke.mjs"),
			...entrypoints.extensions,
			entrypoints.agent,
			...entrypoints.providerExtensions,
			entrypoints.imageGen,
			entrypoints.rerank,
			entrypoints.jev,
		]);
		assert.deepEqual(readerProviderExtensionPaths(entrypoints), entrypoints.providerExtensions);
		assert.equal(readerProviderExtensionPaths(entrypoints).includes(entrypoints.imageGen), false);
		assert.equal(readerProviderExtensionPaths(entrypoints).includes(entrypoints.agent), false);
		assert.equal(readerProviderExtensionPaths(entrypoints).includes(entrypoints.jev), false);
		for (const path of entrypoints.extensions) assert.equal(readerProviderExtensionPaths(entrypoints).includes(path), false);
	}
});

test("bin/pi-coc：写 settings.json、导出战役、拼出 pi 的命令行", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const run = runLauncher(root, ["--campaign", "camp-a", "--mode", "rpc", "--no-session"]);

	assert.equal(run.value("cwd"), root, "cwd 是仓库根");
	assert.equal(run.value("agentdir"), join(root, ".pi", "coc-agent"));
	assert.equal(run.value("campaign"), "camp-a");
	assert.equal(run.value("runtime"), "typescript");
	// Both image-gen and grok-build-oauth are mounted and both define image_gen/image_edit; Pi refuses
	// duplicate tool names, so the launcher must tell grok-build-oauth to leave its two unregistered.
	assert.equal(run.value("grokimage"), "0", "grok-build-oauth is told not to register image_gen/image_edit");
	assert.deepEqual(run.args, [
		"--no-builtin-tools",
		"--no-context-files",
		"--system-prompt",
		join(root, "prompts", "keeper.md"),
		"--session-id",
		"coc-camp-a",
		...defaultMounts(root),
		"--mode",
		"rpc",
		"--no-session",
	]);

	const settings = JSON.parse(readFileSync(join(root, ".pi", "coc-agent", "settings.json"), "utf8"));
	assert.deepEqual(settings, { packages: [root], quietStartup: true, httpIdleTimeoutMs: 60000, cacheWarming: "off" });
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
	// 传输空闲超时必须补上：pi 的缺省是 5 分钟，而宿主的回合看门狗 2 分钟就先中止，
	// 中止是 aborted、永远不重试，于是静默的连接吃掉整个回合（2026-09-15 的 turn 2/7/10）。
	// 放在看门狗下面，同一场静默变成 timeout 错误，pi 现成的重试路径就能接住它。
	assert.equal(settings.httpIdleTimeoutMs, 60000, "静默的连接要在看门狗之前失败，才轮得到重试");
});

test("cache warming defaults off for an existing profile and preserves an explicit policy", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, ".pi", "coc-agent", "settings.json");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ packages: [root], defaultModel: "keep-me" }));
	runLauncher(root, ["--campaign", "cache-policy"]);
	assert.equal(JSON.parse(readFileSync(path, "utf8")).cacheWarming, "off");
	for (const cacheWarming of ["streaming", "idle", "off"]) {
		writeFileSync(path, JSON.stringify({ packages: [root], cacheWarming, defaultModel: "keep-me" }));
		runLauncher(root, ["--campaign", "cache-policy"]);
		const settings = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(settings.cacheWarming, cacheWarming);
		assert.equal(settings.defaultModel, "keep-me");
	}
});

test("bin/pi-coc：运营者自己定的空闲超时不被下一次启动覆盖", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const settingsPath = join(root, ".pi", "coc-agent", "settings.json");
	mkdirSync(dirname(settingsPath), { recursive: true });
	// 0 是 pi 的「disabled」，也是最容易被「没设过就补上」误判掉的那个值。
	writeFileSync(settingsPath, JSON.stringify({ packages: [root], httpIdleTimeoutMs: 0 }, null, 2));

	runLauncher(root, ["--campaign", "camp-c"]);

	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.equal(settings.httpIdleTimeoutMs, 0, "运营者写下的值是他的，不是缺省要抢的位置");
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
		...defaultMounts(root),
		"--mode",
		"rpc",
	]);
});

test("bin/pi-coc preserves explicit extension control flags", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const disabled = runLauncher(root, ["--no-extensions", "--model", "fixture/model"]);
	assert.deepEqual(disabled.args, [
		"--no-builtin-tools",
		"--no-context-files",
		"--system-prompt",
		join(root, "prompts", "keeper.md"),
		"--no-extensions",
		"--model",
		"fixture/model",
	]);

	const explicitValue = runLauncher(root, ["--no-extensions=false"]);
	assert.deepEqual(explicitValue.args, [
		"--no-builtin-tools",
		"--no-context-files",
		"--system-prompt",
		join(root, "prompts", "keeper.md"),
		...defaultMounts(root),
		"--no-extensions=false",
	]);
});

test("bin/pi-coc：没装 pi 时报清楚", (t) => {
	const root = fakeRepo();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	rmSync(join(root, VENDORED_PI));

	assert.throws(
		() => execFileSync(join(root, "bin", "pi-coc"), ["--campaign", "camp-a"], { encoding: "utf8", stdio: "pipe" }),
		(error) => {
			assert.equal(error.status, 1);
			assert.match(error.stderr, /ENOENT/);
			assert.ok(error.stderr.includes(join(root, VENDORED_PI)));
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
		...defaultMounts(root),
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
