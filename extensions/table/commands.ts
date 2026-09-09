/**
 * The `/coc` command surface (contract §19.1).
 *
 * One command with a handful of sub-commands, and one law over all of them: **the output is for
 * the person at the table, never for the Keeper.** Everything goes through `ctx.ui`, nothing is
 * appended to the session, nothing is sent as a message. Pi dispatches an extension command
 * before it ever builds a prompt (`AgentSession.prompt` returns as soon as the handler ran), so a
 * `/coc` neither spends a turn, nor touches the kernel's turn state machine, nor shows up as
 * player input. The only kernel calls made here are reads (`table.status`, `table.capsule`,
 * `module.list`, `module.status`, `investigator.list`) plus one write (`investigator.save`).
 *
 * `/coc module` (contract §20.3) is the same kind of thing: the store and what can be played right
 * now are two reads, `use` prints commands, and `parse` writes no logic of its own — it puts one
 * request on `coc:module-ingest`, exactly the request a front end's file picker sends (contract
 * §20.4), and reports the job's progress back through the same interface.
 *
 * `/coc investigator` (contract §21.5) is the manual half of the investigator library: with no
 * argument it lists the library (`investigator.list`), and `save` stores the current table's card
 * into it by hand (`investigator.save`) -- the insurance beside the automatic per-turn write-back
 * (contract §21.4), which needs no command at all because it is not optional.
 *
 * Outside an interactive terminal (`ctx.mode !== "tui"`: RPC and print) the command answers one
 * line and does nothing else. The real-table driver does not use it.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { modelLabel, resolveLaneModel } from "../lanes/subsession.ts";
import type { ExtensionWords } from "../ui/words.ts";

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
	/** One line to the person at the table, from outside a command handler (the ingest job's progress). No-op without an interface. */
	notify(message: string, type?: "info" | "warning" | "error"): void;
	/** The workspace root (`PI_COC_HOME`, contract §20.7), for the paths the module view prints. */
	home(): string | undefined;
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
	/**
	 * The campaign's own captions for the lines this file sends unprompted (contract §23). The
	 * `/coc` read-outs themselves stay English: they are a developer console, printed on request,
	 * and their rows are kernel field names. Only the ingest job's progress arrives unasked, while
	 * the player is looking at the table, so only that is drawn in the campaign's language.
	 */
	words(): Promise<ExtensionWords>;
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
	// `at` is when it is in the fiction and only exists for a module that declared when its story
	// opens; `elapsed` is how long this campaign has been played. Both, when there are both.
	const at = str(clock.at);
	if (elapsed || minutes !== undefined) {
		lines.push(`clock   ${at ? `${at.replace("T", " ")}   ` : ""}${elapsed ?? `${minutes} min`}${elapsed && minutes !== undefined ? `  (${minutes} min)` : ""}${str(clock.day_part) ? `  ${str(clock.day_part)}` : ""}`);
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

	// Contract §15.7: which worldline the table is on, and which circuit of the loop.
	const worldlines = rec(capsule.worldlines);
	const line = str(worldlines.line);
	if (line) {
		const kind = str(worldlines.kind);
		const loop = num(worldlines.loop);
		const anchor = rec(worldlines.anchor);
		const at = str(anchor.scene);
		const others = arr(worldlines.lines).length;
		lines.push(
			`line    ${line}${kind ? ` (${kind})` : ""}${loop ? `  loop ${loop}` : ""}` +
				`${at ? `  anchor ${at}` : ""}${others > 1 ? `  of ${others} lines` : ""}` +
				`${worldlines.loop_available === true ? "  rewindable here" : ""}`,
		);
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

// ---- The module store (contract §20.3) -------------------------------------

/**
 * `<pdf path> [--id x] [--title t] [--language <BCP 47>]`, tokenised the way a shell would: quotes hold
 * a path with spaces together, everything that is not a flag is a positional. Nothing here reads the
 * words themselves — this is punctuation, not meaning.
 */
export function parseArguments(input: string): { positional: string[]; flags: Record<string, string> } {
	const tokens: string[] = [];
	let current = "";
	let quote: string | undefined;
	let quoted = false;
	for (const character of input) {
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			quoted = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (current || quoted) tokens.push(current);
			current = "";
			quoted = false;
			continue;
		}
		current += character;
	}
	if (current || quoted) tokens.push(current);

	const positional: string[] = [];
	const flags: Record<string, string> = {};
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const equals = token.indexOf("=");
		if (equals > 2) {
			flags[token.slice(2, equals)] = token.slice(equals + 1);
			continue;
		}
		const next = tokens[index + 1];
		if (next !== undefined && !next.startsWith("--")) {
			flags[token.slice(2)] = next;
			index += 1;
		} else {
			flags[token.slice(2)] = "";
		}
	}
	return { positional, flags };
}

/** One row of the store, as `module.list` plus one `module.status` read give it. */
export interface ModuleRow {
	module_id: string;
	title?: string;
	source?: string;
	status?: string;
	page_count?: number;
	sections_accepted?: number;
	sections_total?: number;
	opening_ready?: boolean;
}

/**
 * Can this book be played right now (the ticket's third acceptance point)? Installed and with its
 * opening material in the graph — the two conditions `campaign.create` and `table.open` are about
 * (contract §14.3). Anything else says which of the two is missing rather than just "no".
 */
export function playableNow(row: ModuleRow): { ok: boolean; why: string } {
	if (row.status !== "installed") return { ok: false, why: `not yet (${row.status ?? "unknown"})` };
	if (row.opening_ready === false) return { ok: false, why: "not yet (opening material missing)" };
	return { ok: true, why: "playable now" };
}

export function moduleListLines(rows: ModuleRow[], storeDir: string | undefined): string[] {
	const lines = [`modules ${storeDir ?? "(no workspace)"}`];
	if (rows.length === 0) {
		lines.push("  (the store is empty; /coc module parse <pdf> reads a book in)");
		return lines;
	}
	const idWidth = Math.max(...rows.map((row) => row.module_id.length));
	const titleWidth = Math.min(32, Math.max(...rows.map((row) => (row.title ?? "").length)));
	for (const row of rows) {
		const sections =
			row.sections_total === undefined || row.sections_total === 0
				? "sections -"
				: `sections ${row.sections_accepted ?? 0}/${row.sections_total}`;
		const pages = row.page_count === undefined ? "pages -" : `pages ${row.page_count}`;
		const opening = row.opening_ready === true ? "opening ready" : row.opening_ready === false ? "opening not ready" : "opening ?";
		lines.push(
			`  ${row.module_id.padEnd(idWidth)}  ${(row.title ?? "").padEnd(titleWidth)}  ${(row.source ?? "?").padEnd(7)}  ${(row.status ?? "?").padEnd(10)}  ${pages.padEnd(10)}  ${sections.padEnd(14)}  ${opening.padEnd(17)}  ${playableNow(row).why}`,
		);
	}
	lines.push("  /coc module use <id> prints how to play one; /coc module parse <pdf> reads a new book in.");
	return lines;
}

/**
 * Contract §20.3: there is no "load". A play session binds one campaign at `session_start`, so this
 * never switches books; it prints the two commands that start a table on this one.
 */
export function moduleUseLines(row: ModuleRow | undefined, id: string, campaign: string | undefined): string[] {
	if (!row) return [`use     ${id} is not in the store. Run /coc module to see what is.`];
	const playable = playableNow(row);
	const lines = [`use     ${row.module_id}${row.title ? `  ${row.title}` : ""}  ${playable.why}`];
	lines.push(
		`  A running session cannot switch campaigns: this one is bound to ${campaign ?? "its campaign"} until you quit.`,
	);
	if (!playable.ok) {
		lines.push(`  This book is not ready to play yet, so there is nothing to open a table on.`);
		return lines;
	}
	lines.push("  Playing this book means starting a campaign on it. In another terminal:");
	lines.push(`    bin/pi-coc setup            then choose the module ${row.module_id} as the source`);
	lines.push("    bin/pi-coc --campaign <the campaign id setup prints>");
	return lines;
}

/** One progress line for the person watching an ingest (contract §20.2's `-progress` payload). */
export function ingestProgressLine(row: Record<string, unknown>, words: ExtensionWords): string {
	const stage = str(row.stage) ?? words.word("parse_stage_unknown");
	const page = num(row.page);
	const of = num(row.of);
	const where = of === undefined ? "" : page === undefined ? words.line("parse_pages_total", { of }) : words.line("parse_page", { page, of });
	return [words.line("parse_stage", { stage }), where, str(row.detail) ?? ""].filter(Boolean).join("  ");
}

/** The one line the person gets when a job ends, either way. */
export function ingestDoneLine(row: Record<string, unknown>, words: ExtensionWords): string {
	const id = str(row.module_id) ?? words.word("parse_stage_unknown");
	const pages = num(row.page_count);
	return [
		words.line("parse_done", { module: id }),
		pages !== undefined ? words.line("parse_pages", { pages }) : "",
		words.word(row.opening_ready === true ? "parse_opening_ready" : "parse_opening_not_ready"),
	]
		.filter(Boolean)
		.join("  ");
}

export function ingestFailedLine(row: Record<string, unknown>, words: ExtensionWords): string {
	return [words.line("parse_failed", { reason: str(row.reason) ?? words.word("parse_reason_unknown") }), str(row.detail) ?? ""]
		.filter(Boolean)
		.join("  ");
}

async function moduleRows(deps: CommandDeps): Promise<ModuleRow[]> {
	const call = deps.call();
	const listed = await readOrUndefined(call, "module.list", {});
	const rows: ModuleRow[] = [];
	for (const entry of arr(listed?.modules).map(rec)) {
		const id = str(entry.module_id) ?? str(entry.id);
		if (!id) continue;
		const status = await readOrUndefined(call, "module.status", { module_id: id });
		// `module.status` answers `sections` as a list in one kernel and as `{total, rows}` in another; both are read.
		const sections = status ? status.sections : undefined;
		const sectionRows = Array.isArray(sections) ? sections.map(rec) : arr(rec(sections).rows).map(rec);
		const total = Array.isArray(sections) ? sectionRows.length : (num(rec(sections).total) ?? sectionRows.length);
		rows.push({
			module_id: id,
			...(str(entry.title) ?? str(status?.title) ? { title: (str(entry.title) ?? str(status?.title)) as string } : {}),
			...(str(entry.source) ?? str(status?.source) ? { source: (str(entry.source) ?? str(status?.source)) as string } : {}),
			...(str(status?.status) ?? str(entry.status) ? { status: (str(status?.status) ?? str(entry.status)) as string } : {}),
			...(num(status?.page_count) !== undefined ? { page_count: num(status?.page_count) as number } : {}),
			sections_accepted: sectionRows.filter((row) => str(row.status) === "accepted").length,
			sections_total: total,
			...(typeof status?.opening_ready === "boolean" ? { opening_ready: status.opening_ready } : {}),
		});
	}
	return rows;
}

const MODULE_USAGE = [
	"module  /coc module                       what is in the store, and what can be played right now",
	"        /coc module parse <pdf> [--id <module_id>] [--title <t>] [--language <BCP 47>]",
	"        /coc module use <id>              how to start a table on that book",
].join("\n");

/**
 * `/coc module parse`: it only puts the request on the bus (contract §20.4 — the front end's file
 * picker sends the same one), and the progress lines that follow come from the job's own channel.
 *
 * The language is asked for rather than guessed: which language a book is written in is an open
 * semantic question, and this repository answers those with a person or a model, never with a table.
 */
async function moduleParse(pi: ExtensionAPI, ctx: ExtensionCommandContext, deps: CommandDeps, argument: string): Promise<string> {
	const { positional, flags } = parseArguments(argument);
	const pdf = positional[0];
	if (!pdf) return `module  give me a PDF to read.\n${MODULE_USAGE}`;
	const language = (flags.language ?? flags.lang ?? "").trim();
	const request = {
		pdf,
		...(flags.id?.trim() ? { module_id: flags.id.trim() } : {}),
		...(flags.title?.trim() ? { title: flags.title.trim() } : {}),
		...(language ? { language } : {}),
	};
	deps.record({ lane: "command", command: "module parse", ok: true, pdf, language, ...(request.module_id ? { module_id: request.module_id } : {}) });
	pi.events.emit("coc:module-ingest", request);
	return [
		`parse   ${pdf}`,
		language ? `  language ${language}` : "  The reader will identify the book's language from its pages.",
		"  The original pages are read to prepare the opening; further details are read when needed.",
		"  Progress appears here; the table is not interrupted.",
	].join("\n");
}

async function moduleView(pi: ExtensionAPI, ctx: ExtensionCommandContext, deps: CommandDeps, argument: string): Promise<string> {
	const space = argument.indexOf(" ");
	const verb = (space === -1 ? argument : argument.slice(0, space)).toLowerCase();
	const rest = (space === -1 ? "" : argument.slice(space + 1)).trim();
	if (verb === "parse") return await moduleParse(pi, ctx, deps, rest);
	if (verb === "use") {
		const id = parseArguments(rest).positional[0];
		if (!id) return `module  which book? /coc module use <id>\n${MODULE_USAGE}`;
		const rows = await moduleRows(deps);
		return moduleUseLines(
			rows.find((row) => row.module_id === id),
			id,
			deps.campaign(),
		).join("\n");
	}
	if (verb !== "") return `module  "${verb}" is not a /coc module sub-command.\n${MODULE_USAGE}`;
	// An empty store and a closed kernel look the same from here; say which it is.
	if (!deps.call()) return "modules  the kernel is not open, so the store cannot be read.";
	const home = deps.home();
	return moduleListLines(await moduleRows(deps), home ? `${home}/.coc/modules` : undefined).join("\n");
}

function evidenceView(deps: CommandDeps): string {
	const rows = deps.paths();
	if (rows.length === 0) return "evidence  (no table is open, so there is no campaign directory yet)";
	const width = Math.max(...rows.map((row) => row.label.length));
	return ["evidence", ...rows.map((row) => `  ${row.label.padEnd(width)}  ${row.path}`)].join("\n");
}

// ---- The investigator library (contract §21.5) -----------------------------

/** One row of the library, exactly `investigator.list`'s summary shape (contract §21.2). */
export interface InvestigatorRow {
	library_id: string;
	name?: string;
	occupation?: string;
	era?: string;
	current_hp?: number;
	current_san?: number;
	last_campaign?: string;
	last_turn?: number;
	updated_at?: string;
}

/** Newest first, exactly as `investigator.list` already sorts it -- nothing here re-sorts. */
export function investigatorListLines(rows: InvestigatorRow[]): string[] {
	const lines = ["investigators"];
	if (rows.length === 0) {
		lines.push("  (the library is empty; /coc investigator save stores the current table's card)");
		return lines;
	}
	const idWidth = Math.max(...rows.map((row) => row.library_id.length));
	const nameWidth = Math.min(24, Math.max(...rows.map((row) => (row.name ?? "").length)));
	const occWidth = Math.min(20, Math.max(...rows.map((row) => (row.occupation ?? "").length)));
	for (const row of rows) {
		const hpSan = `HP ${row.current_hp ?? "?"} SAN ${row.current_san ?? "?"}`;
		const last = row.last_campaign ? `${row.last_campaign} t${row.last_turn ?? "?"}` : "never played";
		lines.push(
			`  ${row.library_id.padEnd(idWidth)}  ${(row.name ?? "?").padEnd(nameWidth)}  ${(row.occupation ?? "?").padEnd(occWidth)}  ${(row.era ?? "?").padEnd(8)}  ${hpSan.padEnd(16)}  ${last}`,
		);
	}
	lines.push("  /coc investigator save stores the current table's card into the library by hand.");
	return lines;
}

async function investigatorRows(deps: CommandDeps): Promise<InvestigatorRow[]> {
	const listed = await readOrUndefined(deps.call(), "investigator.list", {});
	return arr(listed?.investigators)
		.map(rec)
		.map((row) => ({
			library_id: str(row.library_id) ?? "?",
			...(str(row.name) ? { name: str(row.name) as string } : {}),
			...(str(row.occupation) ? { occupation: str(row.occupation) as string } : {}),
			...(str(row.era) ? { era: str(row.era) as string } : {}),
			...(num(row.current_hp) !== undefined ? { current_hp: num(row.current_hp) as number } : {}),
			...(num(row.current_san) !== undefined ? { current_san: num(row.current_san) as number } : {}),
			...(str(row.last_campaign) ? { last_campaign: str(row.last_campaign) as string } : {}),
			...(num(row.last_turn) !== undefined ? { last_turn: num(row.last_turn) as number } : {}),
			...(str(row.updated_at) ? { updated_at: str(row.updated_at) as string } : {}),
		}));
}

/**
 * `/coc investigator save [name]`: the insurance beside the automatic per-turn write-back
 * (contract §21.4) -- that one is not optional and needs no command; this is for saving before
 * the first commit, or right after a change the player wants in the library immediately.
 */
async function investigatorSave(deps: CommandDeps, who: string): Promise<string> {
	const campaign = deps.campaign();
	if (!campaign) return "investigator  no table is open, so there is no campaign to save from.";
	const call = deps.call();
	if (!call) return "investigator  the kernel is not open, so nothing can be saved.";
	const result = rec(await call("investigator.save", { campaign, ...(who ? { investigator: who } : {}) }));
	const libraryId = str(result.library_id) ?? "?";
	const created = result.created === true;
	deps.record({ lane: "command", command: "investigator save", ok: true, library_id: libraryId, created });
	return `investigator  saved ${str(result.name) ?? str(result.investigator) ?? "the card"} to the library as ${libraryId}${created ? "  (new row)" : "  (updated)"}.`;
}

const INVESTIGATOR_USAGE = [
	"investigator  /coc investigator        the library: name, occupation, era, HP/SAN, last campaign and turn, newest first",
	"              /coc investigator save   save the current table's investigator into the library by hand",
].join("\n");

async function investigatorView(deps: CommandDeps, argument: string): Promise<string> {
	const space = argument.indexOf(" ");
	const verb = (space === -1 ? argument : argument.slice(0, space)).toLowerCase();
	const rest = (space === -1 ? "" : argument.slice(space + 1)).trim();
	if (verb === "save") return await investigatorSave(deps, rest);
	if (verb !== "") return `investigator  "${verb}" is not a /coc investigator sub-command.\n${INVESTIGATOR_USAGE}`;
	if (!deps.call()) return "investigators  the kernel is not open, so the library cannot be read.";
	return investigatorListLines(await investigatorRows(deps)).join("\n");
}

// ---- Registration ----------------------------------------------------------

export const COC_COMMAND = "coc";

export function registerCocCommand(pi: ExtensionAPI, deps: CommandDeps): void {
	// The ingest job (contract §20.2) reports on the bus, whoever started it. Its progress belongs to
	// the person watching, so it goes through `ctx.ui` like every other line here and never into the
	// Keeper's context. Only stage changes and every tenth page are shown: a 41-page book must not
	// scroll the table away.
	let lastStage: string | undefined;
	/** One unprompted line, in the campaign's own words; a content root that cannot be read drops the line rather than throwing into the bus. */
	function report(draw: (words: ExtensionWords) => string, type: "info" | "error"): void {
		void deps
			.words()
			.then((words) => deps.notify(draw(words), type))
			.catch(() => {
				/* one progress line is not worth an exception */
			});
	}
	pi.events.on("coc:module-ingest", () => {
		lastStage = undefined;
	});
	pi.events.on("coc:module-ingest-progress", (data) => {
		const row = rec(data);
		const stage = str(row.stage);
		const page = num(row.page);
		const of = num(row.of);
		const worthShowing = stage !== lastStage || (page !== undefined && of !== undefined && of > 0 && (page % 10 === 0 || page === of));
		lastStage = stage;
		if (worthShowing) report((words) => ingestProgressLine(row, words), "info");
	});
	pi.events.on("coc:module-ingest-done", (data) => report((words) => ingestDoneLine(rec(data), words), "info"));
	pi.events.on("coc:module-ingest-failed", (data) => report((words) => ingestFailedLine(rec(data), words), "error"));

	pi.registerCommand(COC_COMMAND, {
		description: "COC table: status, model, thinking, lanes, evidence, module, investigator",
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
					case "module":
						ctx.ui.notify(await moduleView(pi, ctx, deps, argument), "info");
						return;
					case "investigator":
						ctx.ui.notify(await investigatorView(deps, argument), "info");
						return;
					default:
						ctx.ui.notify(
							`"${sub}" is not a /coc sub-command. Use /coc, /coc model [provider/model], /coc thinking <level>, /coc lanes, /coc evidence, /coc module, /coc investigator.`,
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
