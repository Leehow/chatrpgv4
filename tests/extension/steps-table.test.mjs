/**
 * 内核的真表（content/setup/steps.json）必须能被建卡扩展的闸门读懂：
 * 顺序信息只写一次，所以这里断言的是「按表算出来的允许步」，不抄步骤名。
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { allowedSteps, axisProducts, declaredSources, gate, missingNeeds, normalizeSteps, sourceKinds } from "../../extensions/onboarding/steps.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(readFileSync(join(HERE, "..", "..", "content", "setup", "steps.json"), "utf8"));

test("真表：starter 车道建完战役就能建调查员，pdf 车道要先读开场", () => {
	const steps = normalizeSteps(TABLE.steps);
	assert.equal(steps.length, TABLE.steps.length);
	const byId = new Map(steps.map((s) => [s.id, s]));
	const investigator = byId.get("create-investigator");
	assert.ok(investigator);

	const starter = { completed: new Set(["choose-source", "create-campaign"]), sourceKind: "starter" };
	assert.deepEqual(missingNeeds(investigator, starter, steps), [], "build-opening 在 starter 车道不出现，视为已满足");
	assert.ok(allowedSteps(steps, starter).some((s) => s.id === "create-investigator"));
	assert.ok(!allowedSteps(steps, starter).some((s) => s.id === "build-opening"), "only_for: pdf 的步不进 starter 车道");

	const pdf = { completed: new Set(["choose-source", "create-campaign"]), sourceKind: "pdf" };
	assert.deepEqual(missingNeeds(investigator, pdf, steps), ["build-opening"]);
	assert.ok(allowedSteps(steps, pdf).some((s) => s.id === "build-bundle"));
});

test("真表：来源词表取自表自己声明的 sources，不从步骤反推（#32）", () => {
	const steps = normalizeSteps(TABLE.steps);
	const declared = declaredSources(TABLE);
	assert.deepEqual(declared, TABLE.sources, "表声明什么就是什么");
	assert.ok(declared.includes("starter") && declared.includes("module") && declared.includes("pdf"));

	// 反推只看得见 only_for，而只有 pdf 专属的步骤带这个键：starter 与 module 会整个消失，
	// 于是「选了 starter」被判成 pdf，玩家被要求去找一份他没有的资料包。
	const inferred = sourceKinds(steps);
	assert.ok(!inferred.includes("starter"), "反推确实丢了 starter，这就是 #32 的根因");
	assert.deepEqual(sourceKinds(steps, declared), TABLE.sources, "给了声明就用声明");
	assert.deepEqual(sourceKinds(steps, []), inferred, "没有声明才退回反推");
});

test("真表：starter 车道能真的走到 create-campaign，闸门不自相矛盾（#32）", () => {
	const steps = normalizeSteps(TABLE.steps);
	const state = { completed: new Set(["choose-source"]), sourceKind: "starter" };

	// 闸门自己算出来的下一步就是它；那它就必须放行。
	const next = allowedSteps(steps, state)[0];
	assert.equal(next?.id, "create-campaign");

	const verdict = gate(steps, state, "create-campaign");
	assert.equal(verdict.ok, true, "starter 车道里 bind-source 根本不存在，不能拿它挡路");
});

test("真表：建完卡就能收工，另一条取卡的路不再挡着 complete（#32、§21.5）", () => {
	const steps = normalizeSteps(TABLE.steps);
	const done = new Set(["choose-source", "create-campaign", "create-investigator"]);

	// 两条取卡的路都还没走时，两条都开着，模型可以挑。
	const open = allowedSteps(steps, { completed: new Set(["choose-source", "create-campaign"]), sourceKind: "starter" });
	assert.ok(open.some((s) => s.id === "create-investigator"));
	assert.ok(open.some((s) => s.id === "browse-library"));

	// 走了「新建」这条之后，「从库载入」那条整条离场，complete 不再欠它。
	const settled = { completed: done, sourceKind: "starter", investigatorSource: "new" };
	assert.deepEqual(missingNeeds(byIdOf(steps, "complete"), settled, steps), []);
	assert.equal(gate(steps, settled, "complete").ok, true, "建完卡就该能收工");
	assert.ok(!allowedSteps(steps, settled).some((s) => s.id === "load-investigator"), "另一条路已经不在表上");
});

function byIdOf(steps, id) {
	const step = steps.find((s) => s.id === id);
	assert.ok(step, `真表里应该有 ${id}`);
	return step;
}

test("真表：翻了一下空库不算选定了那条路，还能回头建卡（#32）", () => {
	const steps = normalizeSteps(TABLE.steps);
	// 两条取卡的路都承诺同一份收据，那份收据才是「真的拿到人了」的标志。
	assert.deepEqual([...axisProducts(steps)], ["investigator_id"]);
	const browse = steps.find((s) => s.id === "browse-library");
	assert.ok(browse && !axisProducts(steps).has(browse.receipt), "翻库只产出一份名单，不产出人");

	// 翻过库之后仍然可以建卡：库是空的时候，这是唯一的活路。
	const looked = { completed: new Set(["choose-source", "create-campaign", "browse-library"]), sourceKind: "starter" };
	assert.equal(gate(steps, looked, "create-investigator").ok, true);
});

test("真表：参数的必选与可省从表读，不靠猜", () => {
	const steps = normalizeSteps(TABLE.steps);
	const create = steps.find((s) => s.id === "create-campaign");
	const params = create.ops[0].params;
	const required = new Set(params.filter((p) => p.required).map((p) => p.name));
	assert.ok(required.has("id") && required.has("module"));
	assert.ok(!required.has("title") && !required.has("register"), "title/register 在表里标了可省");
});
