/**
 * 重启后的重开是一条背景链路：`KernelClient.handleExit` 自己发起它，自己就得把它收尾。
 *
 * 内核子进程意外结束时（看门狗杀、崩溃、OOM），客户端重新拉起孩子并把 `onRestart`
 * （`kernel.hello` + `table.open`，见 `extensions/kernel/index.ts`）挂到串行队列上。
 * 那个 promise 只存在 `this.queue` 里，在下一次 `call()` 之前没有任何人接它的拒绝：
 *
 *   - 会话这时关掉（玩家退出 pi、Electron 关窗），`close()` 按约拒掉所有在飞调用，
 *     重开的那个 `kernel.hello` 就成了游离拒绝。宿主进程没有 `unhandledRejection`
 *     处理器，Node 默认把它抬成未捕获异常——一次关机能打掉整个进程。
 *   - 重开自己失败（换了内核之后 `table.open` 就是不行），同样没人接。
 *
 * 两条都不许逃。但「不逃」不等于「吞掉」：关机时的拒绝是预期，重开真的失败是消息，
 * 必须照旧走 `onDiagnostic`——那是客户端已有的那条口子，重启通知本来就走它。
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KernelClient } from "../../extensions/kernel/client.ts";
import { waitFor } from "./wait.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESTART_KERNEL = join(HERE, "fixtures", "restart-kernel.mjs");

/** 收集这一段里逃到进程层的拒绝。断言的是「有没有逃」，不是它长什么样。 */
function watchEscapedRejections(t) {
	const escaped = [];
	const onUnhandled = (reason) => escaped.push(reason);
	process.on("unhandledRejection", onUnhandled);
	t.after(() => process.off("unhandledRejection", onUnhandled));
	return escaped;
}

/** 让微任务与进程的拒绝检查都跑完；Node 在这一轮末尾才判一个拒绝有没有人接。 */
async function settle() {
	for (let round = 0; round < 3; round++) await new Promise((resolve) => setTimeout(resolve, 20));
}

function makeClient(t, { onRestart, exitAfter = 1 } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "coc-restart-"));
	const log = join(dir, "requests.jsonl");
	const diagnostics = [];
	const client = new KernelClient({
		command: [process.execPath, RESTART_KERNEL],
		cwd: dir,
		env: {
			RESTART_KERNEL_STATE: join(dir, "starts"),
			RESTART_KERNEL_LOG: log,
			RESTART_KERNEL_EXIT_AFTER: String(exitAfter),
		},
		inheritEnv: false,
		onDiagnostic: (message) => diagnostics.push(message),
		onRestart: () => onRestart(client),
	});
	t.after(() => client.close());
	return { client, log, diagnostics };
}

const requests = (log) =>
	existsSync(log)
		? readFileSync(log, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
		: [];

test("关机拒掉在飞的重开，这个拒绝不许逃出去", async (t) => {
	const escaped = watchEscapedRejections(t);
	// 重开发出的调用落在重启后的那个孩子上，它永不回话，于是 close() 撞上的是一个真在飞的请求。
	const { client, log, diagnostics } = makeClient(t, {
		onRestart: (kernel) => kernel.callImmediate("kernel.hello"),
	});

	await assert.rejects(() => client.call("table.player_input", { text: "我推门进去" }));
	await waitFor(() => requests(log).some((entry) => entry.start === 2),
		{ label: "重启后的孩子收到重开的第一个调用" });

	await client.close();
	await settle();

	assert.deepEqual(escaped, [], "关机拒掉一个在飞的重开，不产生游离拒绝");
	// 关机时拒掉背景重开是 close() 的本分，不是要报给人看的故障。
	assert.equal(
		diagnostics.filter((line) => line.includes("kernel.hello")).length,
		0,
		"关机路径上的重开拒绝不当故障报",
	);
});

test("重开自己失败时，失败的原文要到诊断上，而不是逃走或被吞掉", async (t) => {
	const escaped = watchEscapedRejections(t);
	// 这句只出现在测试自己抛的错里：断言挂的是「失败的原文走通了」，不是产品措辞。
	const reason = "the reopening could not be replayed";
	const { client, diagnostics } = makeClient(t, {
		onRestart: async () => {
			throw new Error(reason);
		},
	});

	await assert.rejects(() => client.call("table.player_input", { text: "我推门进去" }));
	// 共享的 `waitFor` 超时即抛，所以诊断转储要在这里接住——它是这条断言唯一有用的线索。
	try { await waitFor(() => diagnostics.some((line) => line.includes(reason)), { label: "重开失败报到 onDiagnostic" }); }
	catch { assert.fail(`重开失败要报到 onDiagnostic：${JSON.stringify(diagnostics)}`); }
	await settle();
	assert.deepEqual(escaped, [], "报出来之后也不再逃");
});
