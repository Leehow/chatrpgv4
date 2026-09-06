/**
 * The `/coc` command surface (contract §19.1).
 *
 * One command with a handful of sub-commands, and one law over all of them: **the output is for
 * the person at the table, never for the Keeper.** Everything goes through `ctx.ui`, nothing is
 * appended to the session, nothing is sent as a message. Pi dispatches an extension command
 * before it ever builds a prompt (`AgentSession.prompt` returns as soon as the handler ran), so a
 * `/coc` neither spends a turn, nor touches the kernel's turn state machine, nor shows up as
 * player input. The only kernel calls made here are reads (`table.status`, `table.capsule`,
 * `module.status`).
 *
 * Outside an interactive terminal (`ctx.mode !== "tui"`: RPC and print) the command answers one
 * line and does nothing else. The real-table driver does not use it.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { modelLabel, resolveLaneModel } from "../lanes/subsession.ts";

/** Pi's closed thinking ladder (`ThinkingLevel` in @earendil-works/pi-agent-core). */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** How many models `/coc model` lists before it stops and tells the reader to name one. */
const MODEL_LIST_CAP = 30;
/** How many lane telemetry rows `/coc lanes` shows (contract §19.1). */
const LANE_ROWS = 10;
/**
 * The two model lanes of contract §12.3 and §12.5, and the only ones this view is about. The
 * telemetry file also carries `handout`, `director`, `fold` and `command` rows; they are this
 * repository's own bookkeeping, not a lane that can fail silently behind a model.
 */
const MODEL_LANES: ReadonlySet<string> = new Set(["verifier", "memory"]);
/** How many trailing telemetry lines are parsed to find those rows. */
const TELEMETRY_TAIL = 400;

export const NON_INTERACTIVE_LINE = "/coc is interactive only: run it in the terminal UI, not in RPC or print mode.";

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rec(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arr(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** What the command surface needs from the extension around it. Every getter may answer nothing. */
export interface CommandDeps {
	/** The campaign id of the open table, or undefined before `coc:table-open`. */
	campaign(): string | undefined;
	/** The `table.open` result, as it came over the bus. */
	open(): Record<string, unknown> | undefined;
	/** This turn's capsule, as it came over the bus, verbatim. */
	capsule(): Record<string, unknown> | undefined;
	/** The kernel RPC closure from `coc:kernel-bridge`, or undefined once the kernel is closed. */
	call(): ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined;
	/** One telemetry row; the caller decides where it lands. */
	record(row: Record<string, unknown>): void;
	/** Trailing lines of the campaign's telemetry file, oldest first. */
	telemetryTail(limit: number): Record<string, unknown>[];
	/** Evidence paths for `/coc evidence`. */
	paths(): { label: string; path: string }[];
}

// ---- The status panel ------------------------------------------------------

/**
 * The panel of contract §19.1, assembled from what the table already has: the `table.open`
 * payload, this turn's capsule and one `table.status` read. Nothing is interpreted; names and
 * closed enums from the kernel are shown verbatim.
 */
export function panelLines(input: {
	campaign?: string;
	open?: Record<string, unknown>;
	capsule?: Record<string, unknown>;
	status?: Record<string, unknown>;
	module?: Record<string, unknown>;
	model?: string;
	thinking?: string;
}): string[] {
	const lines: string[] = [];
	const open = rec(input.open);
	const campaign = rec(open.campaign);
	const capsule = rec(input.capsule);
	const status = rec(input.status);

	const title = str(campaign.title);
	lines.push(`table   ${input.campaign ?? "(no campaign)"}${title ? `  ${title}` : ""}`);

	const turn = num(status.turn) ?? num(rec(capsule.turn).number) ?? num(rec(open.turn).number);
	const state = str(status.state) ?? str(rec(capsule.turn).state) ?? str(rec(open.turn).state);
	const where = rec(capsule.where);
	const scene = str(where.display_name) ?? str(where.scene) ?? str(rec(open.scene).display_name) ?? str(rec(open.scene).name);
	lines.push(`turn    ${turn ?? "?"} (${state ?? "?"})   scene ${scene ?? "?"}`);

	const clock = rec(where.clock);
	const elapsed = str(clock.elapsed);
	const minutes = num(clock.minutes);
	if (elapsed || minutes !== undefined) {
		lines.push(`clock   ${elapsed ?? `${minutes} min`}${elapsed && minutes !== undefined ? `  (${minutes} min)` : ""}${str(clock.day_part) ? `  ${str(clock.day_part)}` : ""}`);
	}

	// The party: the capsule's own investigator block is the live one; `table.open`'s roster is the fallback.
	const fromCapsule = rec(rec(capsule.known).investigator);
	const roster = str(fromCapsule.name) ? [fromCapsule] : arr(open.investigators).map(rec);
	for (const who of roster) {
		const name = str(who.name);
		if (!name) continue;
		const parts = [`HP ${num(who.hp) ?? "?"}`, `SAN ${num(who.san) ?? "?"}`, `MP ${num(who.mp) ?? "?"}`];
		if (num(who.luck) !== undefined) parts.push(`LUCK ${num(who.luck)}`);
		lines.push(`party   ${name}  ${parts.join("  ")}`);
	}

	const session = rec(where.session);
	const sessionKind = str(session.kind);
	lines.push(
		`session ${sessionKind ? `${sessionKind}${num(session.round) !== undefined ? ` round ${num(session.round)}` : ""}` : "none"}`,
	);

	const director = rec(capsule.director);
	const beat = str(director.beat);
	if (beat) {
		const reason = str(director.reason);
		const override = str(director.override);
		lines.push(`beat    ${beat}${override ? `  override ${override}` : ""}${reason ? `  ${reason}` : ""}`);
	}

	const pending = rec(status.pending_choice ?? rec(capsule.turn).pending_choice);
	const pendingName = str(pending.name) ?? str(pending.prompt);
	lines.push(
		`pending ${pendingName ?? "none"}   receipts this turn ${arr(status.receipts).length}   obligations ${arr(capsule.obligations).length}`,
	);

	const module = rec(input.module);
	const moduleId = str(module.module_id) ?? str(campaign.module_id);
	if (moduleId) {
		const sections = arr(module.sections).map(rec);
		const accepted = sections.filter((row) => str(row.status) === "accepted").length;
		const readiness = module.opening_ready === true ? "opening ready" : module.opening_ready === false ? "opening not ready" : "readiness unknown";
		lines.push(
			`module  ${moduleId}  ${str(module.status) ?? "?"}  ${readiness}${sections.length > 0 ? `  sections ${accepted}/${sections.length} accepted` : ""}`,
		);
	}

	lines.push(`model   ${input.model ?? "(none)"}   thinking ${input.thinking ?? "(unknown)"}`);
	return lines;
}

// ---- Sub-commands ----------------------------------------------------------

function currentModelLabel(ctx: ExtensionCommandContext): string | undefined {
	const model = ctx.model;
	return model ? modelLabel(model) : undefined;
}

async function readOrUndefined(
	call: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined,
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
	if (!call) return undefined;
	try {
		return rec(await call(method, params));
	} catch {
		// A read that fails leaves its row out of the panel; the panel must not become an error page.
		return undefined;
	}
}

async function statusPanel(ctx: ExtensionCommandContext, deps: CommandDeps): Promise<string> {
	const campaign = deps.campaign();
	const call = deps.call();
	const status = campaign ? await readOrUndefined(call, "table.status", { campaign }) : undefined;
	const capsule = deps.capsule();
	const moduleId = str(rec(rec(deps.open()).campaign).module_id);
	const module = moduleId ? await readOrUndefined(call, "module.status", { module_id: moduleId, ...(campaign ? { campaign } : {}) }) : undefined;
	const lines = panelLines({
		...(campaign ? { campaign } : {}),
		...(deps.open() ? { open: deps.open() } : {}),
		...(capsule ? { capsule } : {}),
		...(status ? { status } : {}),
		...(module ? { module } : {}),
		...(currentModelLabel(ctx) ? { model: currentModelLabel(ctx) } : {}),
		...(ctx.thinkingLevel ? { thinking: ctx.thinkingLevel } : {}),
	});
	return lines.join("\n");
}

export function modelListLines(available: { provider: string; id: string }[], current: string | undefined): string[] {
	const labels = available.map((model) => modelLabel(model));
	const shown = labels.slice(0, MODEL_LIST_CAP);
	const lines = [`model   ${current ?? "(none)"}`];
	for (const label of shown) lines.push(`  ${label === current ? "*" : " "} ${label}`);
	if (labels.length > shown.length) lines.push(`  ... ${labels.length - shown.length} more; name one as /coc model provider/model`);
	if (labels.length === 0) lines.push("  (the model registry is empty)");
	return lines;
}

async function switchModel(pi: ExtensionAPI, ctx: ExtensionCommandContext, deps: CommandDeps, argument: string): Promise<string> {
	const current = currentModelLabel(ctx);
	if (!argument) {
		const available = ctx.modelRegistry.getAvailable();
		const catalogue = available.length > 0 ? available : ctx.modelRegistry.getAll();
		return modelListLines(catalogue, current).join("\n");
	}
	// `provider/model`: split on the first slash only, a model id may carry slashes itself.
	const slash = argument.indexOf("/");
	if (slash <= 0 || slash >= argument.length - 1) {
		return `"${argument}" is not provider/model. Run /coc model with no argument to see the candidates.`;
	}
	const provider = argument.slice(0, slash);
	const id = argument.slice(slash + 1);
	const model = ctx.modelRegistry.find(provider, id);
	if (!model) {
		deps.record({ lane: "command", command: "model", ok: false, reason: "not_in_registry", requested: argument });
		return `${argument} is not in the model registry. Run /coc model with no argument to see the candidates.`;
	}
	const ok = await pi.setModel(model);
	// Read the table's model back rather than assume the switch stuck.
	const now = currentModelLabel(ctx);
	deps.record({ lane: "command", command: "model", ok, from: current ?? null, requested: modelLabel(model), to: now ?? null });
	if (!ok) return `${argument} has no configured authentication, so the table's model is still ${now ?? "(none)"}.`;
	return `model   ${current ?? "(none)"} -> ${now ?? modelLabel(model)}\nA switch mid-turn takes effect on the next model call; this turn is not rolled back.`;
}

function switchThinking(pi: ExtensionAPI, ctx: ExtensionCommandContext, deps: CommandDeps, argument: string): string {
	const current = ctx.thinkingLevel ?? pi.getThinkingLevel();
	if (!argument) return `thinking ${current ?? "(unknown)"}\n  levels: ${THINKING_LEVELS.join(", ")}`;
	const level = argument.toLowerCase();
	if (!THINKING_LEVELS.includes(level as ThinkingLevel)) {
		return `"${argument}" is not a thinking level. Levels: ${THINKING_LEVELS.join(", ")}.`;
	}
	pi.setThinkingLevel(level as ThinkingLevel);
	// Pi clamps the level to what the model can actually do, so the answer is read back rather than assumed.
	const now = pi.getThinkingLevel();
	deps.record({ lane: "command", command: "thinking", ok: true, from: current ?? null, requested: level, to: now });
	const clamped = now !== level ? `  (${level} is clamped to what this model supports)` : "";
	return `thinking ${current ?? "(unknown)"} -> ${now}${clamped}\nA switch mid-turn takes effect on the next model call; this turn is not rolled back.`;
}

/** One telemetry row of a lane, as one line. Only the columns the lanes actually write are read. */
export function laneRowLine(row: Record<string, unknown>): string {
	const lane = str(row.lane) ?? "?";
	const turn = num(row.turn);
	const ok = row.ok === true ? "ok " : "FAIL";
	const ms = num(row.ms);
	const tail = [
		str(row.reason) ? `reason ${str(row.reason)}` : undefined,
		num(row.findings) !== undefined ? `findings ${num(row.findings)}` : undefined,
		num(row.candidates) !== undefined ? `candidates ${num(row.candidates)}` : undefined,
		row.backfill === true ? "backfill" : undefined,
		str(row.model),
	]
		.filter(Boolean)
		.join("  ");
	return `  ${ok}  ${lane.padEnd(9)} t${turn ?? "?"}${ms !== undefined ? `  ${ms}ms` : ""}${tail ? `  ${tail}` : ""}`;
}

export function laneLines(input: { verifier: string; memory: string; rows: Record<string, unknown>[] }): string[] {
	const lines = [`lanes   verifier ${input.verifier}   memory ${input.memory}`];
	if (input.rows.length === 0) {
		lines.push("  (no lane telemetry yet)");
		return lines;
	}
	for (const row of input.rows) lines.push(laneRowLine(row));
	return lines;
}

function laneModel(ctx: ExtensionCommandContext, envName: string): string {
	const resolved = resolveLaneModel(ctx, envName);
	return resolved.ok ? modelLabel(resolved.model) : `unavailable (${resolved.detail})`;
}

function lanesView(ctx: ExtensionCommandContext, deps: CommandDeps): string {
	const rows = deps
		.telemetryTail(TELEMETRY_TAIL)
		.filter((row) => typeof row.lane === "string" && MODEL_LANES.has(row.lane))
		.slice(-LANE_ROWS);
	return laneLines({
		verifier: laneModel(ctx, "PI_COC_VERIFIER_MODEL"),
		memory: laneModel(ctx, "PI_COC_MEMORY_MODEL"),
		rows,
	}).join("\n");
}

function evidenceView(deps: CommandDeps): string {
	const rows = deps.paths();
	if (rows.length === 0) return "evidence  (no table is open, so there is no campaign directory yet)";
	const width = Math.max(...rows.map((row) => row.label.length));
	return ["evidence", ...rows.map((row) => `  ${row.label.padEnd(width)}  ${row.path}`)].join("\n");
}

// ---- Registration ----------------------------------------------------------

export const COC_COMMAND = "coc";

export function registerCocCommand(pi: ExtensionAPI, deps: CommandDeps): void {
	pi.registerCommand(COC_COMMAND, {
		description: "COC table: status, model, thinking, lanes, evidence",
		handler: async (args, ctx) => {
			// RPC and print modes get one line and nothing else (contract §19.1).
			if (ctx.mode !== "tui") {
				ctx.ui.notify(NON_INTERACTIVE_LINE, "warning");
				return;
			}
			const trimmed = args.trim();
			const space = trimmed.indexOf(" ");
			const sub = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
			const argument = (space === -1 ? "" : trimmed.slice(space + 1)).trim();
			try {
				switch (sub) {
					case "":
						ctx.ui.notify(await statusPanel(ctx, deps), "info");
						return;
					case "model":
						ctx.ui.notify(await switchModel(pi, ctx, deps, argument), "info");
						return;
					case "thinking":
						ctx.ui.notify(switchThinking(pi, ctx, deps, argument), "info");
						return;
					case "lanes":
						ctx.ui.notify(lanesView(ctx, deps), "info");
						return;
					case "evidence":
						ctx.ui.notify(evidenceView(deps), "info");
						return;
					default:
						ctx.ui.notify(
							`"${sub}" is not a /coc sub-command. Use /coc, /coc model [provider/model], /coc thinking <level>, /coc lanes, /coc evidence.`,
							"warning",
						);
						return;
				}
			} catch (error) {
				// A command is a read-out: whatever breaks in it must reach the person, not the turn.
				ctx.ui.notify(`/coc ${sub} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
