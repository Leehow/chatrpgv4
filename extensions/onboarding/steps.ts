/**
 * 七步表（契约 §14.4）：顺序、可用动作、拒绝语、下一步说明全从这里派生。
 *
 * 表住在内核的 `content/setup/steps.json`，扩展经 `setup.steps` 拿到它。
 * 这个文件只做一件事：把表读成一个闸门。**任何顺序信息都不在这里写第二遍**——
 * 下面没有任何一处写着「choose-source 在 create-campaign 前面」或者「pdf 才要绑定」，
 * 那些都从每一行的 `needs` 与 `applies_to` 算出来。测试从表生成用例（契约 §14.10）。
 *
 * 表的一行（宽容读法，几种写法都收，读不出来的字段按缺省走）：
 *
 * ```json
 * {"id": "bind-source", "kind": "op", "applies_to": ["pdf"],
 *  "needs": ["build-bundle", "create-campaign"],
 *  "ops": [{"method": "module.bind", "params": ["bundle", "module_id?"]},
 *          {"method": "module.plan", "params": ["module_id"]}],
 *  "receipt": "module_id", "label": "绑定资料包", "instruction": "…"}
 * ```
 *
 * - `needs`：字符串数组，或 `{"pdf": [...], "starter": [...]}`（按来源分岔的前置），
 *   或 `[{"step": "...", "when": "pdf"}]`。
 * - `applies_to`：这一步只在哪几种来源里出现；不写就是每次都要。
 * - `kind`：`ask`（问玩家，没有内核调用）、`external`（等宿主的技能产出东西）、`op`（调内核）。
 * - `op` / `ops`：一步可以是两次调用（表里 `bind-source` 就是 `module.bind` 再 `module.plan`）。
 *   每个 op 自己带 `params` 最好；只有一份步骤级 `params` 时，它归第一个 op，
 *   后面的 op 只拿得到已经在手的身份键（`module_id`、`campaign`）。
 * - `params` 的一项可以是 `"title?"`（问号 = 可省）或 `{"name": "title", "required": false}`，
 *   可以带 `from`（从前面步骤的回执里取值的路径，如 `source.module_id`）。
 */

export type StepKind = "ask" | "external" | "op";

export interface ParamSpec {
	name: string;
	required: boolean;
	/** 从已完成步骤的回执里取值的路径，点号分段。 */
	from?: string;
	description?: string;
}

export interface OpSpec {
	method: string;
	params: ParamSpec[];
}

export interface Step {
	id: string;
	kind: StepKind;
	ops: OpSpec[];
	/** 按来源分岔的前置；`*` 是所有来源都要的。 */
	needs: Record<string, string[]>;
	/** 只在这几种来源里出现；空表示每次都要。 */
	appliesTo?: string[];
	params: ParamSpec[];
	receipt?: string;
	label?: string;
	instruction?: string;
	/** 表自己写了拒绝语就用表的；没写就按 id 与前置拼一句。 */
	rejection?: string;
}

/** 闸门要知道的全部状态：哪些步做完了，来源是哪一种。 */
export interface GateState {
	completed: ReadonlySet<string>;
	sourceKind?: string;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeParam(raw: unknown): ParamSpec | undefined {
	const name = asString(raw);
	if (name) {
		// `title?` = 可省。
		return name.endsWith("?") ? { name: name.slice(0, -1), required: false } : { name, required: true };
	}
	const row = asRecord(raw);
	const named = asString(row.name) ?? asString(row.param) ?? asString(row.id);
	if (!named) return undefined;
	const optional = row.optional === true || row.required === false;
	return {
		name: named.endsWith("?") ? named.slice(0, -1) : named,
		required: !optional && !named.endsWith("?"),
		...(asString(row.from) ? { from: asString(row.from) as string } : {}),
		...(asString(row.description) ? { description: asString(row.description) as string } : {}),
	};
}

function normalizeParams(raw: unknown): ParamSpec[] {
	if (Array.isArray(raw)) {
		return raw.map(normalizeParam).filter((param): param is ParamSpec => param !== undefined);
	}
	const row = asRecord(raw);
	const params: ParamSpec[] = [];
	for (const [name, spec] of Object.entries(row)) {
		const normalized = normalizeParam({ ...asRecord(spec), name });
		if (normalized) params.push(normalized);
	}
	return params;
}

function normalizeNeeds(raw: unknown): Record<string, string[]> {
	const needs: Record<string, string[]> = {};
	const push = (key: string, id: string | undefined) => {
		if (!id) return;
		(needs[key] ??= []).push(id);
	};
	if (Array.isArray(raw)) {
		for (const entry of raw) {
			const plain = asString(entry);
			if (plain) {
				push("*", plain);
				continue;
			}
			const row = asRecord(entry);
			const id = asString(row.step) ?? asString(row.id);
			const when = row.when ?? row.source ?? row.kind;
			const keys = Array.isArray(when)
				? when.map((value) => asString(value)).filter((value): value is string => value !== undefined)
				: asString(when)
					? [asString(when) as string]
					: ["*"];
			for (const key of keys) push(key, id);
		}
		return needs;
	}
	const plain = asString(raw);
	if (plain) {
		push("*", plain);
		return needs;
	}
	for (const [key, value] of Object.entries(asRecord(raw))) {
		if (Array.isArray(value)) {
			for (const entry of value) push(key, asString(entry));
		} else {
			push(key, asString(value));
		}
	}
	return needs;
}

function normalizeOps(row: Record<string, unknown>, stepParams: ParamSpec[]): OpSpec[] {
	const declared = row.ops ?? row.op;
	const raw = Array.isArray(declared) ? declared : declared === undefined || declared === null ? [] : [declared];
	const ops: OpSpec[] = [];
	for (const entry of raw) {
		const method = asString(entry) ?? asString(asRecord(entry).method) ?? asString(asRecord(entry).op);
		if (!method) continue;
		const own = asRecord(entry).params;
		ops.push({ method, params: own === undefined ? [] : normalizeParams(own) });
	}
	// 只有一份步骤级 params 时：第一个 op 收下它，后面的 op 由调用方补身份键。
	if (ops.length > 0 && ops[0].params.length === 0 && stepParams.length > 0) {
		ops[0] = { method: ops[0].method, params: stepParams };
	}
	return ops;
}

function normalizeKind(raw: unknown, ops: OpSpec[]): StepKind {
	const kind = asString(raw);
	if (kind === "ask" || kind === "external" || kind === "op") return kind;
	return ops.length > 0 ? "op" : "ask";
}

/** `setup.steps` 的结果（`{steps: [...]}` 或者直接一个数组）读成闸门要的形状。 */
export function normalizeSteps(raw: unknown): Step[] {
	const rows = Array.isArray(raw) ? raw : Array.isArray(asRecord(raw).steps) ? (asRecord(raw).steps as unknown[]) : [];
	const steps: Step[] = [];
	for (const entry of rows) {
		const row = asRecord(entry);
		const id = asString(row.id) ?? asString(row.step);
		if (!id) continue;
		const params = normalizeParams(row.params);
		const ops = normalizeOps(row, params);
		// 内核的表用 `only_for: "pdf"`（单值）说同一件事。
		const appliesRaw = row.applies_to ?? row.appliesTo ?? row.sources ?? row.only_for;
		const appliesTo = Array.isArray(appliesRaw)
			? appliesRaw.map((value) => asString(value)).filter((value): value is string => value !== undefined)
			: asString(appliesRaw)
				? [asString(appliesRaw) as string]
				: undefined;
		steps.push({
			id,
			kind: normalizeKind(row.kind, ops),
			ops,
			needs: normalizeNeeds(row.needs),
			...(appliesTo && appliesTo.length > 0 ? { appliesTo } : {}),
			params,
			...(asString(row.receipt) ? { receipt: asString(row.receipt) as string } : {}),
			...(asString(row.label) ? { label: asString(row.label) as string } : {}),
			...(asString(row.instruction) ? { instruction: asString(row.instruction) as string } : {}),
			...(asString(row.rejection) ? { rejection: asString(row.rejection) as string } : {}),
		});
	}
	return steps;
}

/** 这一步在这种来源下要不要做。来源还没定时，只认没有 `applies_to` 的步。 */
export function applies(step: Step, sourceKind: string | undefined): boolean {
	if (!step.appliesTo || step.appliesTo.length === 0) return true;
	if (!sourceKind) return false;
	return step.appliesTo.includes(sourceKind);
}

/** 这一步在这种来源下的前置。 */
export function needsOf(step: Step, sourceKind: string | undefined): string[] {
	const shared = step.needs["*"] ?? [];
	const branch = sourceKind ? (step.needs[sourceKind] ?? []) : [];
	return [...new Set([...shared, ...branch])];
}

/** 前置里还没做完的那些。 */
export function missingNeeds(step: Step, state: GateState, steps?: Step[]): string[] {
	// 前置里有一步在这种来源下根本不出现（starter 车道没有 build-opening）：视为已满足，
	// 与内核 `only_for` 的规则一致。
	const byId = new Map((steps ?? []).map((s) => [s.id, s] as const));
	return needsOf(step, state.sourceKind).filter((id) => {
		if (state.completed.has(id)) return false;
		const needed = byId.get(id);
		return !(needed && !applies(needed, state.sourceKind));
	});
}

/** 现在可以做的步：适用、没做过、前置齐了。表里的顺序就是它们的顺序。 */
export function allowedSteps(steps: Step[], state: GateState): Step[] {
	return steps.filter(
		(step) => applies(step, state.sourceKind) && !state.completed.has(step.id) && missingNeeds(step, state, steps).length === 0,
	);
}

/** 下一步：可做的里面表里排最前的那个。 */
export function nextStep(steps: Step[], state: GateState): Step | undefined {
	return allowedSteps(steps, state)[0];
}

/** 这一步要的参数：ask／external 用步骤级的，op 用它第一个还没做的 op 的。 */
function paramNames(step: Step): string {
	const params = step.params.length > 0 ? step.params : (step.ops[0]?.params ?? []);
	if (params.length === 0) return "";
	return params.map((param) => (param.required ? param.name : `${param.name}（可省）`)).join("、");
}

/**
 * 下一步说明。第一句永远是「下一步：<id>」——模型要填的就是这个 id，
 * 表里的 `instruction`（写给人看的那句）接在后面，参数最后。
 */
export function instructionFor(step: Step | undefined): string {
	if (!step) return "建卡的步都做完了。";
	const label = step.label ? `（${step.label}）` : "";
	const params = paramNames(step);
	const head = `下一步：${step.id}${label}。`;
	const detail = step.instruction ? `${step.instruction}` : "";
	return [head, detail, params ? `要的参数：${params}。` : ""].filter(Boolean).join("");
}

/**
 * 表里出现过的来源种类：`applies_to` 的值，加上按来源分岔的 `needs` 的键。
 * 玩家能选的就是这几种；这一侧不另立词表（契约 §14.4：顺序与分岔只写在表里）。
 */
export function sourceKinds(steps: Step[]): string[] {
	const kinds = new Set<string>();
	for (const step of steps) {
		for (const kind of step.appliesTo ?? []) kinds.add(kind);
		for (const key of Object.keys(step.needs)) {
			if (key !== "*") kinds.add(key);
		}
	}
	return [...kinds];
}

/** 状态行上的一行进度：做完几步、下一步是哪一步（契约 §14.4）。 */
export function progressLine(steps: Step[], state: GateState): string | undefined {
	const applicable = steps.filter((step) => applies(step, state.sourceKind) || state.completed.has(step.id));
	if (applicable.length === 0) return undefined;
	const done = applicable.filter((step) => state.completed.has(step.id)).length;
	const next = nextStep(steps, state);
	return `建卡 ${done}/${applicable.length}　${next ? `下一步 ${next.id}` : "已就绪"}`;
}

export type GateVerdict = { ok: true; step: Step } | { ok: false; reason: string };

/** 拒绝语末尾一律带上「现在该做哪一步」，两句都只从表来。 */
function withNext(steps: Step[], state: GateState, head: string): string {
	const next = nextStep(steps, state);
	return next ? `${head}${instructionFor(next)}` : `${head}建卡的步都做完了。`;
}

/**
 * 闸门（契约 §14.4）：`step` 不在表里、前置未满足、或重复已完成的步 →
 * 带该步的拒绝语与「下一步」，不改状态。
 */
export function gate(steps: Step[], state: GateState, id: string): GateVerdict {
	const step = steps.find((row) => row.id === id);
	if (!step) {
		const all = steps.map((row) => row.id).join("、");
		return { ok: false, reason: withNext(steps, state, `建卡表里没有「${id}」这一步。表里依次是：${all}。`) };
	}
	if (step.rejection && (state.completed.has(step.id) || missingNeeds(step, state).length > 0)) {
		return { ok: false, reason: withNext(steps, state, `${step.rejection}`) };
	}
	if (state.completed.has(step.id)) {
		return { ok: false, reason: withNext(steps, state, `${step.id} 已经做过了，不重做。`) };
	}
	const missing = missingNeeds(step, state);
	if (missing.length > 0) {
		const declared = needsOf(step, state.sourceKind).join("、");
		return {
			ok: false,
			reason: withNext(
				steps,
				state,
				`${step.id} 还不能做：表里它的前置是 ${declared}，其中 ${missing.join("、")} 还没做完。`,
			),
		};
	}
	if (!applies(step, state.sourceKind)) {
		const only = (step.appliesTo ?? []).join("、");
		const kind = state.sourceKind ?? "还没定";
		return { ok: false, reason: withNext(steps, state, `${step.id} 只在来源是 ${only} 时才有；这次的来源是 ${kind}。`) };
	}
	return { ok: true, step };
}
