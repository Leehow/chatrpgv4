#!/usr/bin/env node
/**
 * 假读者：站在真的子 `pi` 进程那个位置上（契约 §14.5），只做读者对外可见的那件事——
 * 在工作目录里写下 `shard.json`，然后退出。真读者是 `pi -p …`，由 `PI_COC_READER_CMD`
 * 换成这个脚本（跟 `PI_COC_KERNEL_CMD` 同一个套路），接缝写在 docs/pi-host-contract.md 第 3.2 节。
 *
 * 最后一个参数是 `module.packet` 给的 brief，原样记进日志：重跑那一轮有没有把上一轮的
 * findings 带上，测试看的就是这一行。
 *
 * 环境变量：
 *   FAKE_READER_LOG    每跑一次追加一行 JSON：{cwd, brief, argv}
 *   FAKE_READER_FAIL   命中的 section（工作目录名）直接非零退出，不写分片；多个用逗号分开
 *   FAKE_READER_OUT    写哪个文件，缺省 shard.json
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);
const brief = argv[argv.length - 1] ?? "";
const cwd = process.cwd();
const section = basename(cwd);

if (process.env.FAKE_READER_LOG) {
	appendFileSync(process.env.FAKE_READER_LOG, `${JSON.stringify({ cwd, section, brief, argv })}\n`);
}

const failing = (process.env.FAKE_READER_FAIL ?? "")
	.split(",")
	.map((row) => row.trim())
	.filter(Boolean);
if (failing.includes(section)) {
	process.stderr.write(`fake-reader: ${section} 这一轮故意没跑成\n`);
	process.exit(3);
}

writeFileSync(
	join(cwd, process.env.FAKE_READER_OUT ?? "shard.json"),
	`${JSON.stringify({ section, wrote_at: new Date().toISOString() }, null, 2)}\n`,
);
process.stdout.write(`${section} 写完了\n`);
