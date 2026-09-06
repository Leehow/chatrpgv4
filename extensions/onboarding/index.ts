/**
 * The setup extension (contract §14.4). It registers a tool only in a `PI_COC_MODE=setup` process, and only one: `setup`.
 *
 * The seven-step table is in the kernel (`content/setup/steps.json`, fetched with `setup.steps`). This file does four things:
 * 1. The gate: a `step` not in the table, an unmet prerequisite, a repeat of a completed step — the
 *    refusal and the next step are both derived from the table (see `steps.ts`; ordering is written once in this package).
 * 2. Execution: an `op` step calls the kernel with the method and parameters the table names; a step
 *    with two calls (`module.bind` then `module.plan`) runs in the table's order, feeding the first result to the second.
 * 3. Three kinds of step that are not one kernel call: `ask` (choose the source — the starter list
 *    comes from `kernel.hello`'s content and `campaign.list`, or the player gives a bundle directory),
 *    `external` (when the bundle is not there yet, tell the player how the host's PDF skill produces it
 *    and look again on the next call), and `module.build` (the build loop lives in the module extension;
  *    this one emits a bus event and waits for `coc:module-opening-ready`).
 * 4. The ending: with no next step in the table, hand over the command that opens the table and let the process exit.
 *
 * The occupation is not judged here: the `setup.occupations` list goes into the tool result verbatim and
 * the model picks one id from the player's own sentence (contract §14.7). There is no keyword table on this side.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { cocMode } from "../lanes/host.ts";
import {
	allowedSteps,
	gate,
	type GateState,
	instructionFor,
	nextStep,
	axisProducts,
	declaredSources,
	normalizeSteps,
	type OpSpec,
	progressLine,
	sourceKinds,
	type Step,
} from "./steps.ts";

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** How long the build step waits for `opening_ready`; at the deadline it answers "still reading" and the player can call again to keep waiting. */
const BUILD_WAIT_MS = Number.parseInt(process.env.PI_COC_BUILD_WAIT_MS?.trim() ?? "", 10) || 30 * 60 * 1000;

/** The code of a kernel error envelope is read structurally: instanceof is unreliable across extensions (two module instances). */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** A lookup path such as `source.module_id`. */
function lookupPath(context: Record<string, unknown>, path: string): unknown {
	let cursor: unknown = context;
	for (const segment of path.split(".")) {
		if (!cursor || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

/**
 * Contract §5: `campaign` is required in the parameters of every `table.*` and `setup.*` call;
 * the `module.*` calls of §14.3 are addressed by module id (several campaigns share one module) and carry no campaign.
 * When the table does not name `campaign`, fill it in by this rule rather than guessing from the method name.
 */
function wantsCampaign(method: string): boolean {
	return method.startsWith("setup.") || method.startsWith("table.");
}

export default function (pi: ExtensionAPI) {
	// In the play process this extension registers nothing (contract §14.4).
	if (cocMode() !== "setup") return;

	let ctx: ExtensionContext | undefined;
	let bridge: { call: KernelCall; hello?: Record<string, unknown> } | undefined;
	let steps: Step[] | undefined;
	/** The `sources` the table declares; the source vocabulary comes from here, not from the steps (#32). */
	let tableSources: string[] = [];
	let stepsError: string | undefined;
	let loading: Promise<void> | undefined;
	const completed = new Set<string>();
	/** What completed steps left behind: campaign id, module id, source, investigator id, and so on; parameters are filled from here. */
	const context: Record<string, unknown> = {};
	/** The ops already run within one step (a list lookup like `setup.occupations` is not run twice). */
	const opCache = new Map<string, unknown>();
	let sourceKind: string | undefined;
	/** §21.5's second axis: which investigator lane this run took, set by the first step of one. */
	let investigatorSource: string | undefined;
	/** The last step is done: wait for this run to finish speaking, then exit the process. */
	let handoff: string | undefined;

	function state(): GateState {
		return {
			completed,
			...(sourceKind ? { sourceKind } : {}),
			...(investigatorSource ? { investigatorSource } : {}),
		};
	}

	function paint(): void {
		try {
			if (!ctx?.hasUI || !steps) return;
			ctx.ui.setStatus("coc-setup", progressLine(steps, state()));
		} catch {
			/* the status line must not break a step */
		}
	}

	// ---- The table --------------------------------------------------------

	/**
	 * The table comes from the kernel. When `setup.steps` carries `completed` or `state`, this is a setup
	 * being picked up where the last one left off (`bin/pi-coc setup --campaign <id>`).
	 */
	async function loadSteps(): Promise<void> {
		const current = bridge;
		if (!current) {
			stepsError = "The kernel bridge is not up yet, so the setup table cannot be fetched.";
			return;
		}
		try {
			const campaign = asString(context.campaign);
			const result = asRecord(await current.call("setup.steps", campaign ? { campaign } : {}));
			const rows = normalizeSteps(result);
			if (rows.length === 0) {
				stepsError = "The kernel answered with an empty setup table: there are no steps to walk.";
				return;
			}
			steps = rows;
			tableSources = declaredSources(result);
			stepsError = undefined;
			for (const done of Array.isArray(result.completed) ? result.completed : []) {
				const id = asString(done);
				if (!id) continue;
				completed.add(id);
				// A resumed setup that already took one investigator lane keeps that axis settled.
				const row = rows.find((step) => step.id === id);
				if (row?.investigatorSource && row.receipt && axisProducts(rows).has(row.receipt)) {
					investigatorSource ??= row.investigatorSource;
				}
			}
			const carried = asRecord(result.state);
			for (const [key, value] of Object.entries(carried)) {
				if (context[key] === undefined) context[key] = value;
			}
			const carriedSource = asRecord(carried.source);
			sourceKind = asString(carried.source_kind) ?? asString(carriedSource.kind) ?? sourceKind;
		} catch (error) {
			stepsError = `setup.steps did not come back: ${errorCode(error) ?? "internal"}: ${errorText(error)}`;
		}
	}

	async function ensureSteps(): Promise<void> {
		if (steps) return;
		loading ??= loadSteps().finally(() => {
			loading = undefined;
		});
		await loading;
	}

	// ---- Parameters -------------------------------------------------------

	/** The model may spread parameters at the top level or pack them into `params`; both are accepted. */
	function mergeArgs(raw: Record<string, unknown>): Record<string, unknown> {
		const { step: _step, params, ...rest } = raw;
		return { ...rest, ...asRecord(params) };
	}

	interface Filled {
		params: Record<string, unknown>;
		missing: string[];
	}

	/** A value comes, in order, from this call's parameters, the `from` path the table names, and the same-named value left by a completed step. */
	function fillParams(op: OpSpec, args: Record<string, unknown>, isFirst: boolean): Filled {
		const params: Record<string, unknown> = {};
		const missing: string[] = [];
		for (const spec of op.params) {
			const value =
				args[spec.name] ?? (spec.from ? lookupPath(context, spec.from) : undefined) ?? context[spec.name];
			if (value === undefined || value === null || value === "") {
				if (spec.required) missing.push(spec.name);
				continue;
			}
			params[spec.name] = value;
		}
		// When the table gives only one step-level parameter set, the later ops must at least get the identity key, or the kernel does not know which book is meant.
		if (!isFirst && op.params.length === 0) {
			const moduleId = asString(context.module_id);
			if (moduleId) params.module_id = moduleId;
		}
		const campaign = asString(context.campaign);
		if (campaign && wantsCampaign(op.method) && params.campaign === undefined) params.campaign = campaign;
		return { params, missing };
	}

	/** Scalars from a result go into the context; from objects only the identity keys the contract names are taken, so a whole graph never lands in a parameter slot. */
	function noteResult(result: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(result)) {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				context[key] = value;
			}
		}
		const campaign = asRecord(result.campaign);
		const campaignId = asString(result.campaign_id) ?? asString(campaign.id) ?? asString(result.campaign);
		if (campaignId) context.campaign = campaignId;
		const moduleId = asString(result.module_id) ?? asString(asRecord(result.module).id);
		if (moduleId) context.module_id = moduleId;
	}

	// ---- The three steps that are not one kernel call ---------------------

	/**
	 * What the player may choose from: the starters in `kernel.hello`'s content, the books already
	 * installed in the module store (§20.7's third source — parsed once, played any number of times),
	 * and the campaigns `campaign.list` already has.
	 */
	/** The kinds whose lane has a step the host must produce first: the bundle lanes. */
	function producedKinds(): Set<string> {
		return new Set(
			(steps ?? [])
				.filter((step) => step.kind === "external")
				.flatMap((step) => step.appliesTo ?? []),
		);
	}

	async function sourceCatalogue(): Promise<Record<string, unknown>> {
		const modules = asRecord(asRecord(bridge?.hello).content).modules;
		const starters = Array.isArray(modules) ? modules.filter((row) => typeof row === "string") : [];
		let campaigns: unknown[] = [];
		try {
			const listed = asRecord(await bridge?.call("campaign.list", {}));
			campaigns = Array.isArray(listed.campaigns) ? listed.campaigns : [];
		} catch {
			/* failing to list them must not block choosing a book */
		}
		let installed: string[] = [];
		try {
			const listed = asRecord(await bridge?.call("module.list", {}));
			const rows = Array.isArray(listed.modules) ? listed.modules : [];
			installed = rows
				.map((row) => {
					const record = asRecord(row);
					return record.status === "installed" ? asString(record.module_id) ?? asString(record.id) : undefined;
				})
				.filter((row): row is string => row !== undefined && !starters.includes(row));
		} catch {
			/* a store that cannot be listed still leaves the starters choosable */
		}
		return { starters, installed, campaigns, kinds: sourceKinds(steps ?? [], tableSources) };
	}

	/**
	 * Choosing the source (the table's `ask` step): the player either names a starter or gives a bundle directory.
	 * The vocabulary of source kinds comes from the table (`applies_to`); no second one is kept here.
	 */
	async function runAsk(step: Step, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		const catalogue = await sourceCatalogue();
		const kinds = catalogue.kinds as string[];
		const module = asString(args.module) ?? asString(args.module_id) ?? asString(args.starter);
		const bundle = asString(args.bundle) ?? asString(args.bundle_path);
		const starterNames = catalogue.starters as string[];
		const installedNames = catalogue.installed as string[];
		let kind = asString(args.kind) ?? asString(args.source_kind);
		if (!kind) {
			// Derive the kind from what the player actually named, never from the shape of the table
			// (#32: inferring "the kind with no external step" made a starter come back as `pdf` and
			// sent the player off to find a bundle he does not have). A book that has to be produced
			// first is the bundle lane; a name already in the content catalogue is a starter; a name
			// already installed in the store is that third source.
			if (bundle) kind = kinds.find((row) => producedKinds().has(row)) ?? kinds[0];
			else if (module && starterNames.includes(module)) kind = kinds.includes("starter") ? "starter" : kinds[0];
			else if (module && installedNames.includes(module)) kind = kinds.includes("module") ? "module" : kinds[0];
		}
		if (!kind) {
			return {
				ok: false,
				step: step.id,
				needs: ["kind"],
				hint: `Settle the source with the player first: an installed starter, or a bundle converted from a PDF. The table's source kinds are ${kinds.join(", ") || "starter, pdf"}.`,
				...catalogue,
			};
		}
		if (kinds.length > 0 && !kinds.includes(kind)) {
			return {
				ok: false,
				step: step.id,
				rejected: `The setup table's only source kinds are ${kinds.join(", ")}; there is no "${kind}".`,
				...catalogue,
			};
		}
		if (module) {
			const known = [...starterNames, ...installedNames];
			if (known.length > 0 && !known.includes(module)) {
				return {
					ok: false,
					step: step.id,
					rejected: `Neither the content catalogue nor the module store has a book called "${module}".`,
					candidates: known,
					...catalogue,
				};
			}
			return { ok: true, source: { kind, module_id: module }, ...catalogue };
		}
		if (bundle) return { ok: true, source: { kind, bundle }, ...catalogue };
		return {
			ok: false,
			step: step.id,
			needs: [module === undefined && bundle === undefined ? "module or bundle" : "module"],
			hint: "For a starter write module (the list is in starters); for a bundle write bundle (a directory path).",
			...catalogue,
		};
	}

	/** Whether the thing has arrived: a directory needs a `manifest.json` (the bundle shape, contract §14.2), any other path merely has to exist. */
	function ready(path: string): boolean {
		try {
			if (!existsSync(path)) return false;
			return statSync(path).isDirectory() ? existsSync(join(path, "manifest.json")) : true;
		} catch {
			return false;
		}
	}

	/**
	 * Wait for the host's skill to produce something (the table's `external` step). This repository does not
	 * parse PDFs (contract §14.2): the host's own PDF skill produces the bundle, and this only checks whether
	  * it is there, explaining how to produce it when it is not, and looking again next time.
	 */
	function runExternal(step: Step, args: Record<string, unknown>): Record<string, unknown> {
		const values: Record<string, string> = {};
		const missing: string[] = [];
		for (const spec of step.params) {
			const value = asString(args[spec.name]) ?? asString(spec.from ? lookupPath(context, spec.from) : undefined) ?? asString(context[spec.name]);
			if (!value) {
				if (spec.required) missing.push(spec.name);
				continue;
			}
			values[spec.name] = value;
		}
		if (missing.length > 0) {
			return { ok: false, step: step.id, needs: missing, hint: instructionFor(step) };
		}
		for (const [name, value] of Object.entries(values)) {
			// Only what looks like a path is checked as one: play_language and the like must not be stat'ed.
			const looksLikePath = value.includes("/") || existsSync(value);
			if (!looksLikePath) continue;
			if (ready(value)) continue;
			return {
				ok: false,
				step: step.id,
				waiting_on: name,
				path: value,
				hint:
					`${value} is not a bundle yet. Bundles are produced by the host's PDF skill; this repository does not parse PDFs (contract §14.2). ` +
					`Have the host read that PDF into <dir>/manifest.json (contract coc.pdf-bundle.v1) and <dir>/pages/NNNN.md, one Markdown file per page, ` +
					`then call this same step again once it is there.`,
			};
		}
		return { ok: true, ...values };
	}

	/**
	 * The build step: the loop lives in the module extension (contract §14.5; `module.build` is not a kernel method).
	 * This starts it and waits for `opening_ready`; at the deadline it answers "still reading" and the player can call again to keep waiting.
	 */
	async function runModuleBuild(params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const moduleId = asString(params.module_id) ?? asString(context.module_id);
		if (!moduleId) return { ok: false, needs: ["module_id"], hint: "Bind the bundle first, or the build does not know which book to read." };
		const campaign = asString(context.campaign);
		try {
			const status = asRecord(await bridge?.call("module.status", { module_id: moduleId }));
			if (status.opening_ready === true) return { ok: true, opening_ready: true, status };
		} catch {
			/* an unreadable status does not stop the build from starting */
		}

		// The bus's `on` returns an unsubscribe closure (Pi has no `off`): the three subscriptions and the timer are cleaned up together.
		return await new Promise<Record<string, unknown>>((resolve) => {
			const disposers: Array<() => void> = [];
			const done = (payload: Record<string, unknown>) => {
				clearTimeout(timer);
				for (const dispose of disposers.splice(0)) dispose();
				resolve(payload);
			};
			const timer = setTimeout(
				() =>
					done({
						ok: false,
						opening_ready: false,
						still_building: true,
						hint: "Still reading this book. Tell the player what is being waited on, and call this same step again in a while to keep waiting.",
					}),
				BUILD_WAIT_MS,
			);
			timer.unref?.();
			disposers.push(
				pi.events.on("coc:module-opening-ready", (data) => done({ ok: true, opening_ready: true, ...asRecord(data) })),
				pi.events.on("coc:module-build-failed", (data) =>
					done({ ok: false, opening_ready: false, failed: true, ...asRecord(data) }),
				),
				pi.events.on("coc:module-build-done", (data) => {
					// The whole book was read and it is still not ready: that is this book's problem, so report it rather than wait here.
					const payload = asRecord(data);
					if (asRecord(payload.report).opening_ready === true) return;
					done({ ok: false, opening_ready: false, ...payload });
				}),
			);
			pi.events.emit("coc:module-build", { module_id: moduleId, ...(campaign ? { campaign } : {}) });
		});
	}

	// ---- One step ---------------------------------------------------------

	/** Run this step's ops in table order; a missing parameter stops it there and hands the results so far to the model to fill in. */
	async function runOps(step: Step, args: Record<string, unknown>): Promise<Record<string, unknown>> {
		const current = bridge;
		if (!current) return { ok: false, step: step.id, rejected: "The kernel bridge is gone, so this step cannot run." };
		const results: Record<string, unknown> = {};
		for (const [index, op] of step.ops.entries()) {
			const cacheKey = `${step.id} ${op.method}`;
			if (opCache.has(cacheKey)) {
				results[op.method] = opCache.get(cacheKey);
				continue;
			}
			const filled = fillParams(op, args, index === 0);
			if (filled.missing.length > 0) {
				return {
					ok: false,
					step: step.id,
					blocked_on: op.method,
					needs: filled.missing,
					results,
					hint:
						`${op.method} is still missing ${filled.missing.join(", ")}. ` +
						`The results above hold what this step already looked up (the occupation list, for instance): pick from them, or ask the player.`,
				};
			}
			try {
				const result =
					op.method === "module.build"
						? await runModuleBuild(filled.params)
						: asRecord(await current.call(op.method, filled.params));
				if (result.ok === false) return { ...result, step: step.id, results };
				results[op.method] = result;
				opCache.set(cacheKey, result);
				noteResult(result);
			} catch (error) {
				return {
					ok: false,
					step: step.id,
					failed_on: op.method,
					code: errorCode(error) ?? "internal",
					message: errorText(error),
					results,
				};
			}
		}
		return { ok: true, ...results };
	}

	/** A step is done: book it, update the source, and see whether it was the last one. */
	function settle(step: Step, outcome: Record<string, unknown>): void {
		completed.add(step.id);
		opCache.clear();
		// Producing the investigator settles that axis: the other lane's steps leave the table and
		// `complete`'s prerequisite on them counts as satisfied (§21.5). Only production counts —
		// browsing an empty library must leave the door to building a card open (#32).
		if (step.investigatorSource && step.receipt && axisProducts(steps ?? []).has(step.receipt)) {
			investigatorSource ??= step.investigatorSource;
		}
		const source = asRecord(outcome.source);
		if (Object.keys(source).length > 0) {
			context.source = source;
			sourceKind = asString(source.kind) ?? sourceKind;
			if (asString(source.module_id)) context.module = asString(source.module_id);
			if (asString(source.module_id)) context.module_id = asString(source.module_id);
			if (asString(source.bundle)) context.bundle = asString(source.bundle);
		}
		for (const [key, value] of Object.entries(outcome)) {
			if (key === "ok" || key === "step") continue;
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				context[key] = value;
			} else {
				noteResult(asRecord(value));
			}
		}
		paint();
	}

	async function execute(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
		await ensureSteps();
		if (!steps) {
			return { ok: false, error: stepsError ?? "The setup table is not in hand yet." };
		}
		const id = asString(raw.step);
		if (!id) {
			const next = nextStep(steps, state());
			return {
				ok: false,
				error: "step is required: which step to do this time.",
				next: instructionFor(next),
				allowed: allowedSteps(steps, state()).map((row) => row.id),
			};
		}
		const verdict = gate(steps, state(), id);
		if (!verdict.ok) {
			return { ok: false, step: id, rejected: verdict.reason, allowed: allowedSteps(steps, state()).map((row) => row.id) };
		}
		const step = verdict.step;
		const args = mergeArgs(raw);
		const outcome =
			step.kind === "ask"
				? await runAsk(step, args)
				: step.kind === "external"
					? runExternal(step, args)
					: await runOps(step, args);

		if (outcome.ok !== true) {
			// A step that did not succeed is not booked: the same step can be tried again with the parameters the hint names.
			return { ...outcome, step: id, progress: progressLine(steps, state()) };
		}
		settle(step, outcome);
		const next = nextStep(steps, state());
		if (!next) finish();
		return {
			...outcome,
			step: id,
			completed: [...completed],
			progress: progressLine(steps, state()),
			next: instructionFor(next),
			...(handoff ? { handoff_command: handoff } : {}),
		};
	}

	/** No next step in the table: hand over the command that opens the table, and exit the process once this run has spoken (contract §14.4, step seven). */
	function finish(): void {
		const campaign = asString(context.campaign);
		handoff = campaign ? `bin/pi-coc --campaign ${campaign}` : "bin/pi-coc";
		const line = `Setup complete. Open the table with: ${handoff}`;
		try {
			pi.appendEntry("coc-setup-handoff", { campaign: campaign ?? null, command: handoff });
			if (ctx?.hasUI) ctx.ui.notify(line, "info");
		} catch {
			/* failing to print the handoff must not block the exit */
		}
	}

	// ---- The tool ---------------------------------------------------------

	pi.registerTool({
		name: "setup",
		label: "Setup",
		description:
			"The one action from nothing to an open table. `step` is which step to do this time, and the other parameters are what the previous result's next asked for " +
			"(they may also be packed into `params`). The step table, its order, its prerequisites and the parameters of each step are the kernel's call: " +
			"if you do not know what to write on the first call, give any step (start, say) and the result will tell you the table's first step. " +
			"Every return carries next (the next step and its parameters) and progress; a call that did not succeed carries rejected or needs, " +
			"so change what it says to change and do not resend unchanged.",
		promptSnippet: "The one setup tool: walk the kernel's seven-step table, one step at a time.",
		parameters: Type.Object(
			{
				step: Type.String({ description: "which step to do this time; step names come from the kernel's setup table, and the previous result's next holds it" }),
				params: Type.Optional(
					Type.Object({}, { additionalProperties: true, description: "the parameters this step wants; they may also be spread at the top level" }),
				),
			},
			{ additionalProperties: true },
		),
		executionMode: "sequential",
		execute: async (_toolCallId, params) => {
			const result = await execute(asRecord(params));
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});

	// ---- Lifecycle --------------------------------------------------------

	// The kernel extension emits the bridge in session_start; this subscribes at load time, so both load orders are caught.
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = asRecord(data) as { call?: KernelCall; hello?: Record<string, unknown>; campaign?: string };
		bridge = typeof payload.call === "function" ? { call: payload.call, ...(payload.hello ? { hello: asRecord(payload.hello) } : {}) } : undefined;
		if (payload.campaign && context.campaign === undefined) context.campaign = payload.campaign;
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		steps = undefined;
		completed.clear();
		opCache.clear();
		sourceKind = undefined;
		investigatorSource = undefined;
		handoff = undefined;
		const campaign = process.env.PI_COC_CAMPAIGN?.trim();
		if (campaign) context.campaign = campaign;
		// The setup process's tool surface is only this one (contract §14.4).
		pi.setActiveTools(["setup"]);
		// When the kernel extension loaded first the bridge is already here and the table is fetched now; when it comes later, the first tool call fetches it.
		if (bridge) await ensureSteps();
		paint();
		if (ctx.hasUI && steps) {
			ctx.ui.notify(`Setup: ${steps.length} steps in all. ${instructionFor(nextStep(steps, state()))}`, "info");
		}
	});

	// After the last step, wait for this run to say the handoff out loud before exiting (contract §14.4: the process exits and prints the command that opens the table).
	pi.on("agent_end", async () => {
		if (!handoff) return;
		const command = handoff;
		handoff = undefined;
		try {
			ctx?.shutdown();
			pi.appendEntry("coc-setup-exit", { command });
		} catch {
			/* failing to exit must not throw either: the command has already been printed */
		}
	});

	pi.on("session_shutdown", async () => {
		ctx = undefined;
		bridge = undefined;
	});
}
