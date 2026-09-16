/**
 * 套件唯一的等待词汇：等**被断言的那个条件**，用真实时限，不用「转多少圈」当预算。
 *
 * `npm run test:ext` 是 `node --test`，它按 `availableParallelism() - 1` 并发跑文件（本机 9 个），
 * 其中好几个文件自己还会再生一批子进程。于是整套跑起来时，任何「转 N 圈就该好了」「文件出现了就
 * 该写完了」的假设都变成掷硬币——这正是「整套红、单跑绿」的来源，而那句话一旦成了常态，真回归
 * 就会被当成 flake 放行。
 *
 * 三条规矩：
 * 1. 等的条件必须**就是**下一句要断言的东西；不要等它的替身（遥测行、文件存在、跑了几圈）。
 * 2. 时限是墙钟，不是圈数：机器慢只该让等待变长，不该让结论翻面。
 * 3. 跨进程的握手文件按「能不能解析」判完成，不按「在不在」判完成：`writeFileSync` 会先把文件
 *    截成 0 字节再写，另一个进程此刻 `stat` 得到文件、`readFile` 得到空串。
 */

const POLL_MS = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 轮询到 `probe()` 给出一个真值为止，返回那个值；超时抛错并带上 label。
 * label 写「在等什么」，失败信息才有用。
 */
export async function waitForValue(probe, { timeoutMs = 10_000, label = "条件" } = {}) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await probe();
		if (value) return value;
		if (Date.now() >= deadline) throw new Error(`等 ${label} 超时（${timeoutMs} 毫秒）`);
		await sleep(POLL_MS);
	}
}

/** 与 `waitForValue` 同义，保留旧名字：套件里 38 个文件从 harness.mjs 导入它。 */
export const waitFor = waitForValue;

/**
 * 等一个跨进程写出来的 JSON 握手文件**能解析**为止，返回解析结果。
 *
 * 不要用「存在就读」：写方 `writeFileSync` 的 open(O_TRUNC) 与 write 之间，读方看得见一个空文件，
 * `JSON.parse("")` 抛的正是 `Unexpected end of JSON input`。实测在本机约 1.5% 的读会撞上。
 * 写方请用 `publishJsonSync` 原子发布；这个读法是另一半保险。
 */
export function waitForJson(path, { timeoutMs = 10_000, label = path, fs } = {}) {
	const read = fs?.readFileSync
		? async () => fs.readFileSync(path, "utf8")
		: async () => (await import("node:fs/promises")).readFile(path, "utf8");
	return waitForValue(async () => {
		let text;
		try { text = await read(); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
		try { return { value: JSON.parse(text) }; } catch { return undefined; }
	}, { timeoutMs, label }).then((wrapped) => wrapped.value);
}

/**
 * 原子发布一个 JSON 握手文件：同目录写临时名再 `rename`。读方于是只看得见「没有」或「写完了」，
 * 看不见「写了一半」。跨进程握手一律走这里。
 */
export function publishJsonSync(fs, path, value) {
	const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	fs.writeFileSync(temporary, JSON.stringify(value));
	fs.renameSync(temporary, path);
}
