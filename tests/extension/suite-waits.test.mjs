/**
 * 守着套件自己的等待方式。
 *
 * `npm run test:ext` 就是 `node --test "tests/extension/**\/*.test.mjs"`：文件按
 * `availableParallelism() - 1` 并发跑（本机 10 核 → 9 个子进程），其中好几个文件自己还会再生
 * 一批子进程。整套跑起来时 CPU 是共享的，于是每一个「转 N 圈就该好了」的等待都变成掷硬币，
 * 而「整套红、单跑绿」一旦成了常态，真回归就会被当作 flake 放行——这条守卫存在，是为了不让
 * 下一个这样的等待再写进来。
 *
 * 一条规矩：**等待的边界是墙钟，不是圈数。** 机器慢只该让等待变长，不该让结论翻面。
 * 圈数封顶的自旋（`for (let i = 0; i < 200; i++) await tick()`）一定要禁：它数的是事件循环转了
 * 几圈，而它在等的通常是一次真实 I/O——两者之间没有任何关系。没有上限、条件就是下一句断言的
 * 那个自旋是允许的：它慢，但不会给出错误答案。
 */
import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const YIELD = /setImmediate\s*\(|process\.nextTick\s*\(|\btick\s*\(\s*\)/;
const COUNTED = /(?:for|while)\s*\([^)]*[<>]=?\s*\d/;

const sources = async () => {
	const names = (await readdir(HERE)).filter(name => name.endsWith(".mjs"));
	return Promise.all(names.map(async name => [name, await readFile(join(HERE, name), "utf8")]));
};

test("no test waits by counting event-loop turns: a wait's bound is wall clock", async () => {
	const offences = [];
	for (const [name, source] of await sources()) {
		if (name === "suite-waits.test.mjs") continue;
		source.split("\n").forEach((line, index) => {
			// The loop header and the yield have to be the same statement: a single `await tick()`
			// for deterministic ordering is fine, and so is a counted loop that does real work.
			if (COUNTED.test(line) && YIELD.test(line)) offences.push(`${name}:${index + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(offences, [], [
		"A loop capped by an iteration count that only yields a turn is a budget, not a wait:",
		"it counts event-loop turns while the thing it waits for is real I/O, so it answers",
		"differently depending on who else is on the CPU. Wait for the condition the next",
		"assertion names, with waitFor from ./wait.mjs.",
	].join(" "));
});

test("the suite has one wait vocabulary, and it lives in wait.mjs", async () => {
	const definers = [];
	for (const [name, source] of await sources()) {
		if (name === "wait.mjs") continue;
		if (/(?:function|const)\s+waitFor(?:Value|Json)?\s*[=(]/.test(source)) definers.push(name);
	}
	assert.deepEqual(definers, [], "waitFor belongs to tests/extension/wait.mjs; import it instead of forking a dialect");
});
