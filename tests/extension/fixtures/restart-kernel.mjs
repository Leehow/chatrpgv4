#!/usr/bin/env node
/**
 * 一个「死一次，之后不再回话」的假内核，专给重启那条背景链路用。
 *
 * 第一次启动：收到第 RESTART_KERNEL_EXIT_AFTER 个请求时不答就 `process.exit(1)`——真内核被
 * 看门狗杀掉也是死在一个请求中间——让 `KernelClient.handleExit` 走重启与 `onRestart` 重开。
 * 第二次及以后启动：请求照记，但永不回答——于是重开发出的那个调用会一直在飞，
 * 直到 `close()` 把它拒掉。那正是这条回归要看的瞬间。
 *
 * 环境变量：
 *   RESTART_KERNEL_STATE      记进程启动次数的文件（必需）
 *   RESTART_KERNEL_LOG        每个请求追加一行 {start, method}
 *   RESTART_KERNEL_EXIT_AFTER 第一次启动收到第几个请求时退出，缺省 1
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const STATE = process.env.RESTART_KERNEL_STATE;
const LOG = process.env.RESTART_KERNEL_LOG;
const EXIT_AFTER = Number(process.env.RESTART_KERNEL_EXIT_AFTER ?? 1);

const starts = (existsSync(STATE) ? Number(readFileSync(STATE, "utf8")) : 0) + 1;
writeFileSync(STATE, String(starts));
/** 只有第一个孩子会回话；重启之后的那个把调用挂在半空。 */
const stall = starts > 1;

let received = 0;
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (line.trim()) answer(JSON.parse(line));
		index = buffer.indexOf("\n");
	}
});

function answer(request) {
	if (LOG) appendFileSync(LOG, `${JSON.stringify({ start: starts, method: request.method })}\n`);
	if (stall) return;
	received += 1;
	// 不答就走：一个没回话的在飞请求正是真内核被杀时留下的形状。
	if (received >= EXIT_AFTER) process.exit(1);
	process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result: { method: request.method } })}\n`);
}
