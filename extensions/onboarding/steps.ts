/**
 * The seven-step table (contract §14.4): order, available actions, refusal text and next-step
  * instructions are all derived from here.
 *
 * The table lives in the kernel's `content/setup/steps.json`, and the extension gets it through `setup.steps`.
 * This file does one thing: read that table into a gate. **No ordering information is written a
 * second time here** — nowhere below does it say "choose-source comes before create-campaign" or
 * "only pdf needs binding"; all of that is computed from each row's `needs` and `applies_to`.
  * The tests generate their cases from the table too (contract §14.10).
 *
 * One row of the table (read leniently: several spellings are accepted, and an unreadable field takes its default):
 *
 * ```json
 * {"id": "bind-source", "kind": "op", "applies_to": ["pdf"],
 *  "needs": ["build-bundle", "create-campaign"],
 *  "ops": [{"method": "module.bind", "params": ["bundle", "module_id?"]},
 *          {"method": "module.plan", "params": ["module_id"]}],
 *  "receipt": "module_id", "label": "bind the bundle", "instruction": "..."}
 * ```
 *
 * - `needs`: an array of strings, or `{"pdf": [...], "starter": [...]}` (prerequisites forking by source),
 *   or `[{"step": "...", "when": "pdf"}]`.
 * - `applies_to`: which sources this step appears in; unwritten means always.
 * - `kind`: `ask` (ask the player, no kernel call), `external` (wait for the host's skill to produce something), `op` (call the kernel).
 * - `op` / `ops`: one step may be two calls (`bind-source` in the table is `module.bind` then `module.plan`).
 *   Each op is best off carrying its own `params`; with one step-level `params` it belongs to the first op,
 *   and the later ops only get the identity keys already in hand (`module_id`, `campaign`).
 * - an entry of `params` may be `"title?"` (the question mark means omissible) or `{"name": "title", "required": false}`,
 *   and may carry `from` (a path into an earlier step's receipt, such as `source.module_id`).
 */

export type StepKind = "ask" | "external" | "op";

export interface ParamSpec {
	name: string;
	required: boolean;
	/** A path into the receipts of completed steps, dot separated. */
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
	/** Prerequisites forking by source; `*` is what every source needs. */
	needs: Record<string, string[]>;
	/** Appears only in these sources; empty means always. */
	appliesTo?: string[];
	params: ParamSpec[];
	receipt?: string;
	label?: string;
	instruction?: string;
	/** Use the table's own refusal text when it has one; otherwise compose one from the id and the prerequisites. */
	rejection?: string;
}

/** Everything the gate needs to know: which steps are done, and which source this is. */
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
		// `title?` means omissible.
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
	// With one step-level params: the first op takes it, and the caller fills identity keys into the later ops.
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

/** Read the `setup.steps` result (`{steps: [...]}` or a bare array) into the shape the gate wants. */
export function normalizeSteps(raw: unknown): Step[] {
	const rows = Array.isArray(raw) ? raw : Array.isArray(asRecord(raw).steps) ? (asRecord(raw).steps as unknown[]) : [];
	const steps: Step[] = [];
	for (const entry of rows) {
		const row = asRecord(entry);
		const id = asString(row.id) ?? asString(row.step);
		if (!id) continue;
		const params = normalizeParams(row.params);
		const ops = normalizeOps(row, params);
		// The kernel's table says the same thing with `only_for: "pdf"` (a single value).
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

/** Whether this step is needed for this source. While the source is undecided, only steps without `applies_to` count. */
export function applies(step: Step, sourceKind: string | undefined): boolean {
	if (!step.appliesTo || step.appliesTo.length === 0) return true;
	if (!sourceKind) return false;
	return step.appliesTo.includes(sourceKind);
}

/** This step's prerequisites for this source. */
export function needsOf(step: Step, sourceKind: string | undefined): string[] {
	const shared = step.needs["*"] ?? [];
	const branch = sourceKind ? (step.needs[sourceKind] ?? []) : [];
	return [...new Set([...shared, ...branch])];
}

/** The prerequisites not yet done. */
export function missingNeeds(step: Step, state: GateState, steps?: Step[]): string[] {
	// A prerequisite that does not appear at all for this source (the starter lane has no build-opening)
	// counts as satisfied, matching the kernel's `only_for` rule.
	const byId = new Map((steps ?? []).map((s) => [s.id, s] as const));
	return needsOf(step, state.sourceKind).filter((id) => {
		if (state.completed.has(id)) return false;
		const needed = byId.get(id);
		return !(needed && !applies(needed, state.sourceKind));
	});
}

/** The steps available now: applicable, not done, prerequisites met. The table's order is their order. */
export function allowedSteps(steps: Step[], state: GateState): Step[] {
	return steps.filter(
		(step) => applies(step, state.sourceKind) && !state.completed.has(step.id) && missingNeeds(step, state, steps).length === 0,
	);
}

/** The next step: the first available one in table order. */
export function nextStep(steps: Step[], state: GateState): Step | undefined {
	return allowedSteps(steps, state)[0];
}

/** The parameters this step wants: ask and external use the step-level ones, op uses its first pending op's. */
function paramNames(step: Step): string {
	const params = step.params.length > 0 ? step.params : (step.ops[0]?.params ?? []);
	if (params.length === 0) return "";
	return params.map((param) => (param.required ? param.name : `${param.name} (optional)`)).join(", ");
}

/**
 * The next-step instruction. The first sentence is always "Next step: <id>" — that id is what the
 * model has to fill in — followed by the table's own `instruction` (the sentence written for a human), with the parameters last.
 */
export function instructionFor(step: Step | undefined): string {
	if (!step) return "Every setup step is done.";
	const label = step.label ? ` (${step.label})` : "";
	const params = paramNames(step);
	const head = `Next step: ${step.id}${label}. `;
	const detail = step.instruction ? `${step.instruction}` : "";
	return [head, detail, params ? ` Parameters wanted: ${params}.` : ""].filter(Boolean).join("");
}

/**
 * The source kinds the player may pick. The table declares them in its own `sources` list, and that
 * list is the answer whenever it is there: a source whose lane needs no extra steps (an installed
 * starter, a book already in the store) appears in no step's `applies_to`, so inferring the
 * vocabulary from the steps alone silently loses it — which is how naming a starter came back as a
 * PDF and asked the player for a bundle (#32). Inference stays as the fallback for a table with no
 * `sources` key. This side still keeps no vocabulary of its own (contract §14.4).
 */
export function sourceKinds(steps: Step[], declared?: readonly string[]): string[] {
	const named = (declared ?? []).filter((kind) => typeof kind === "string" && kind.length > 0);
	if (named.length > 0) return [...new Set(named)];
	const kinds = new Set<string>();
	for (const step of steps) {
		for (const kind of step.appliesTo ?? []) kinds.add(kind);
		for (const key of Object.keys(step.needs)) {
			if (key !== "*") kinds.add(key);
		}
	}
	return [...kinds];
}

/** The `sources` list a `setup.steps` result declares, empty when the table does not say. */
export function declaredSources(raw: unknown): string[] {
	const rows = asRecord(raw).sources;
	if (!Array.isArray(rows)) return [];
	return rows.map((row) => asString(row)).filter((row): row is string => row !== undefined && row.length > 0);
}

/** One progress line for the status bar: how many steps are done and which is next (contract §14.4). */
export function progressLine(steps: Step[], state: GateState): string | undefined {
	const applicable = steps.filter((step) => applies(step, state.sourceKind) || state.completed.has(step.id));
	if (applicable.length === 0) return undefined;
	const done = applicable.filter((step) => state.completed.has(step.id)).length;
	const next = nextStep(steps, state);
	return `setup ${done}/${applicable.length}  ${next ? `next ${next.id}` : "ready"}`;
}

export type GateVerdict = { ok: true; step: Step } | { ok: false; reason: string };

/** Every refusal ends with which step to do now, and both sentences come only from the table. */
function withNext(steps: Step[], state: GateState, head: string): string {
	const next = nextStep(steps, state);
	return next ? `${head}${instructionFor(next)}` : `${head}Every setup step is done.`;
}

/**
 * The gate (contract §14.4): a `step` not in the table, an unmet prerequisite, or a repeat of a
 * completed step gets that step's refusal text plus the next step, and changes no state.
 */
export function gate(steps: Step[], state: GateState, id: string): GateVerdict {
	const step = steps.find((row) => row.id === id);
	if (!step) {
		const all = steps.map((row) => row.id).join(", ");
		return { ok: false, reason: withNext(steps, state, `The setup table has no step "${id}". In order it holds: ${all}. `) };
	}
	if (step.rejection && (state.completed.has(step.id) || missingNeeds(step, state, steps).length > 0)) {
		return { ok: false, reason: withNext(steps, state, `${step.rejection}`) };
	}
	if (state.completed.has(step.id)) {
		return { ok: false, reason: withNext(steps, state, `${step.id} is already done and is not redone. `) };
	}
	// `steps` is what lets a prerequisite that does not exist in this lane count as satisfied; without it
	// the starter lane refused `create-campaign` for a `bind-source` that only the PDF lane has, while the
	// same gate's own "next step" line said to call `create-campaign` — a deadlock at the way in (#32).
	const missing = missingNeeds(step, state, steps);
	if (missing.length > 0) {
		const declared = needsOf(step, state.sourceKind).join(", ");
		return {
			ok: false,
			reason: withNext(
				steps,
				state,
				`${step.id} cannot be done yet: the table gives it the prerequisites ${declared}, of which ${missing.join(", ")} are not done. `,
			),
		};
	}
	if (!applies(step, state.sourceKind)) {
		const only = (step.appliesTo ?? []).join(", ");
		const kind = state.sourceKind ?? "not decided yet";
		return { ok: false, reason: withNext(steps, state, `${step.id} only exists when the source is ${only}; this time the source is ${kind}. `) };
	}
	return { ok: true, step };
}
