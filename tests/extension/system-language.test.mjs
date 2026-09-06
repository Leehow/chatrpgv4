/**
 * 系统语言守卫（契约 §16.1）。
 *
 * 用户 2026-09-06 的裁定：系统语言是英文。代码、提示词、工具描述、宿主消息、启动器帮助
 * 一律英文；玩家看到的字由守秘人按战役的 `play_language` 写，不由代码里的字面量决定。
 * 这条守卫扫 `extensions/**`、`bin/*`、`prompts/**` 的**原文**（注释也算），命中 CJK 即失败。
 *
 * 内核那一侧（`kernel/**`、`content/setup/*.json` 等）由 `tests/kernel/test_system_language.py`
 * 守；模组内容与规则术语表是数据，两边都不受限。
 */

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * 中日韩字符：CJK 符号与标点（含【】、。「」）、假名、韩文字母与音节、统一表意文字与扩展 A、
 * 兼容表意文字、全角与半角形（含全角标点与全角 ASCII）。
 * `§ — ≤ × →` 这类不在里面，代码里照用。
 */
const CJK = /[ᄀ-ᇿ　-〿぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿＀-￯]/u;

/** 扫哪些地方：目录整棵扫，文件单个扫。 */
const SCOPE = ["extensions", "bin", "prompts"];

function walk(path) {
	const stats = statSync(path);
	if (!stats.isDirectory()) return [path];
	return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

function offences(path) {
	const rows = [];
	const text = readFileSync(path, "utf8");
	for (const [index, line] of text.split("\n").entries()) {
		if (CJK.test(line)) rows.push(`${relative(REPO, path)}:${index + 1}  ${line.trim().slice(0, 80)}`);
	}
	return rows;
}

test("系统语言：extensions、bin、prompts 里没有一个中日韩字符（契约 §16.1）", () => {
	const files = SCOPE.flatMap((entry) => walk(join(REPO, entry)));
	assert.ok(files.length >= 15, `扫到的文件太少（${files.length}），路径大概写错了`);
	const found = files.flatMap(offences);
	assert.deepEqual(found, [], `这些行还是中文（系统语言是英文）：\n${found.join("\n")}`);
});

test("守卫本身认得出中日韩字符：正则不是摆设", () => {
	// 变异测试：把这条改成永真的正则，上面那个用例就再也杀不死任何东西。
	for (const sample of ["【明骰】", "回合已关闭", "カタカナ", "한글", "全角ＡＢＣ", "、"]) {
		assert.ok(CJK.test(sample), `应该命中：${sample}`);
	}
	for (const sample of ["contract §16.1", "roll 44/55 pass", "difficulty <= 55", "a -> b", "café"]) {
		assert.ok(!CJK.test(sample), `不该命中：${sample}`);
	}
});
