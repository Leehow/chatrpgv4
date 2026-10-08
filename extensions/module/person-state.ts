/**
 * Contract §199.2 (docs/specs/graph-grounding.md GG-02): the person-state reading of a verify round.
 *
 * TR-F2 (Cold Harvest, read-30): the reader wrote Vasili's summary as "Galena's late husband" from a page
 * that says he was her husband and grieved after *her* death. The vision reviewer, the same model, supported it -- at the
 * record's root on the table, and again when the summary was its own pointer under the §199.2 instruction ("the summary
 * correctly calls him her late husband"). Asked narrowly and apart, the same model reads both right: the sentence alone says
 * Vasili is dead (3/3), the page alone says he is alive and Galena dead (3/3). So the judgment is split into two readings that
 * never see each other, and the host compares them:
 *
 * - a *statements* reader is shown only the person summaries of the candidate (no page) and says, per sentence, whom it calls
 *   dead or alive;
 * - a *pages* reader is shown only the native text of the pages those persons cite (no summary) and says, per person, whether
 *   the pages say they are alive, dead, or neither.
 *
 * A summary that calls someone dead whom its pages do not, or alive whom its pages call dead, gets an `unsupported` row with
 * impact `logic` (`reviewer: "person-state"`) in the round's review, so the publication gate refuses it and the targeted
 * repair is asked, with the two readings as the reason. Both readers are tool-carrying Pi children (read and write only; text
 * work, Agents.md), on the reviewer's own model. Only the living state is compared: it is a closed answer code can compare;
 * kin, rank and role stay with the vision reviewer's instruction. A reader that fails, times out or answers out of shape
 * leaves the round as the vision reviewer judged it, and the telemetry says so.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReaderOutcome, ReaderRequest } from "./reader.ts";
import { PERSON_KIND } from "../../kernel-ts/modules/review-verdicts.ts";

type Row = Record<string, any>;
/** The reviewer row's `reviewer`: the gate reads it as any vision row (§199.2). */
export const PERSON_STATE_REVIEWER = "person-state";
export const PERSON_STATE_FILE = "person-state.json";
const LIVING: ReadonlySet<string> = new Set(["alive", "dead"]);
const PAGE_LIVING: ReadonlySet<string> = new Set(["alive", "dead", "not_stated"]);
/** One reader's wall-clock allowance; past it the round keeps the vision verdicts. */
const READER_TIMEOUT_MS = 180_000;

const plain = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const pagesOf = (node: Row): number[] => [...new Set<number>((Array.isArray(node.source_refs) ? node.source_refs : [])
	.map((ref: Row) => ref?.page).filter((page: unknown): page is number => Number.isSafeInteger(page) && (page as number) > 0))].sort((a, b) => a - b);

/** A person's summary as the readers take it: its draft pointer, its node, the sentence and the pages the node cites. */
export interface PersonStatement { key: string; path: string; node: Row; about: string; text: string; pages: number[] }
export interface PersonEntry { key: string; id: string; name: string; aliases: string[] }

/** Every drafted person's summary (§199.2), with the pages its node cites. */
export function personStatements(draft: Row): Omit<PersonStatement, "key" | "about">[] {
	return (Array.isArray(draft?.nodes) ? draft.nodes : []).flatMap((node: Row, index: number) =>
		plain(node) && node.node_kind === PERSON_KIND && text(node.summary)
			? [{ path: `/nodes/${index}/summary`, node, text: text(node.summary), pages: pagesOf(node) }] : []);
}

/**
 * The people both readers are shown, keyed `p1`, `p2`, ...: the statements' subjects first, then every other person of the
 * candidate and of the published graph the task carries (`known_nodes`), each once by node id. The readers never see an id.
 */
export function personRoster(draft: Row, task: Row): PersonEntry[] {
	const nodes = [...(Array.isArray(draft?.nodes) ? draft.nodes : []), ...(Array.isArray(task?.known_nodes) ? task.known_nodes : [])]
		.filter((node: Row) => plain(node) && node.node_kind === PERSON_KIND && text(node.node_id) && text(node.name));
	const subjects = new Set(personStatements(draft).map(statement => statement.node.node_id));
	const ordered = [...nodes.filter(node => subjects.has(node.node_id)), ...nodes.filter(node => !subjects.has(node.node_id))];
	const seen = new Set<string>(), out: PersonEntry[] = [];
	for (const node of ordered) {
		if (seen.has(node.node_id)) continue;
		seen.add(node.node_id);
		out.push({ key: `p${out.length + 1}`, id: node.node_id, name: text(node.name),
			aliases: (Array.isArray(node.aliases) ? node.aliases : []).filter((alias: unknown) => typeof alias === "string" && alias.trim()) });
	}
	return out;
}

/** `{<statement key>: {<person key>: "dead" | "alive"}}` with every statement key and nothing else, or undefined. */
export function shapeStatementReadings(parsed: unknown, statements: readonly string[], people: readonly string[]): Record<string, Record<string, string>> | undefined {
	if (!plain(parsed) || Object.keys(parsed).some(key => !statements.includes(key)) || statements.some(key => !plain(parsed[key]))) return undefined;
	for (const key of statements)
		for (const [person, value] of Object.entries(parsed[key] as Row))
			if (!people.includes(person) || typeof value !== "string" || !LIVING.has(value)) return undefined;
	return parsed as Record<string, Record<string, string>>;
}
/** `{<person key>: "alive" | "dead" | "not_stated"}` with every person key and nothing else, or undefined. */
export function shapePageReadings(parsed: unknown, people: readonly string[]): Record<string, string> | undefined {
	if (!plain(parsed) || Object.keys(parsed).length !== people.length || people.some(key => typeof parsed[key] !== "string" || !PAGE_LIVING.has(parsed[key] as string)))
		return undefined;
	return parsed as Record<string, string>;
}

export interface PersonStateMismatch { path: string; person: string; said: string; pages: string }
/**
 * What the comparison refuses: a statement that calls a person dead whom its pages do not call dead, or alive whom its pages
 * call dead. A statement that says nothing of someone, or pages that say nothing of a living person, refuse nothing: an
 * omission is not a false statement, and "alive" is rarely printed.
 */
export function stateMismatches(statements: readonly PersonStatement[], said: Record<string, Record<string, string>>, pages: Record<string, string>): PersonStateMismatch[] {
	const out: PersonStateMismatch[] = [];
	for (const statement of statements)
		for (const [person, state] of Object.entries(said[statement.key] ?? {})) {
			const page = pages[person] ?? "not_stated";
			if ((state === "dead" && page !== "dead") || (state === "alive" && page === "dead"))
				out.push({ path: statement.path, person, said: state, pages: page });
		}
	return out;
}

/** The review rows for the mismatches, one per statement, the reason in the readings' own words. */
export function mismatchRows(mismatches: readonly PersonStateMismatch[], statements: readonly PersonStatement[], people: readonly PersonEntry[]): Row[] {
	const name = (key: string) => people.find(person => person.key === key)?.name ?? key;
	const rows: Row[] = [];
	for (const statement of statements) {
		const own = mismatches.filter(mismatch => mismatch.path === statement.path);
		if (!own.length) continue;
		const cited = statement.pages.map(page => `p${page}`).join(", ");
		const parts = own.map(mismatch => `the summary calls ${name(mismatch.person)} ${mismatch.said}, but the cited pages (${cited}) ${mismatch.pages === "not_stated"
			? `do not say ${name(mismatch.person)} is ${mismatch.said}` : `say ${name(mismatch.person)} is ${mismatch.pages}`}`);
		rows.push({ paths: [statement.path], verdict: "unsupported", impact: "logic", reviewer: PERSON_STATE_REVIEWER,
			source_refs: statement.pages.map(page => ({ page })),
			reason: `Person-state reading: ${parts.join("; ")}. Write the summary as the pages state it, attaching each modifier to the noun the page attaches it to, or leave the summary out.` });
	}
	return rows;
}

/** The bound document's native text of some pages (`extensions/module/source.ts` `sourceText`), as far as this check reads it. */
export interface PageTextBundle { snapshots: Array<{ page: number; text: string }> }
export interface PersonStateRequest {
	/** The attempt directory: each round's readers work under `person-state-<round>/`, and the evidence is written beside the review. */
	cwd: string;
	round: number;
	draft: Row;
	task: Row;
	contentRoot: string;
	model: { id: string; thinking?: string };
	signal: AbortSignal;
	sourceText(pages: number[]): Promise<PageTextBundle>;
	run(request: ReaderRequest): Promise<ReaderOutcome>;
	record(row: Row): void;
}

async function readerAnswer(request: PersonStateRequest, role: "statements" | "pages", input: Row): Promise<unknown> {
	const dir = join(request.cwd, `person-state-${request.round}`, role);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "input.json"), JSON.stringify(input, null, 1) + "\n");
	const outcome = await request.run({ cwd: dir, model: request.model.id, ...(request.model.thinking ? { thinking: request.model.thinking } : {}),
		systemPrompt: join(request.contentRoot, "setup", `person-state-${role}.md`), tools: "read,write", signal: request.signal,
		eventLog: join(dir, "events.jsonl"), timeoutMs: READER_TIMEOUT_MS,
		brief: "Read input.json in your working directory, write readings.json there exactly as your instructions say, and stop." });
	if (!outcome.ok) throw new Error(`${role} reader: ${String(outcome.error ?? outcome.stderr ?? "failed").slice(0, 200)}`);
	return JSON.parse(await readFile(join(dir, "readings.json"), "utf8"));
}

/**
 * The round's person-state rows (§199.2): empty when the candidate has no person summary, when no cited page has native text,
 * or when a reader fails (the vision verdicts then stand alone; the telemetry row says which).
 */
export async function personStateRows(request: PersonStateRequest): Promise<Row[]> {
	const began = Date.now();
	const note = (status: string, extra: Row = {}) => request.record({ lane: "reading", event: "person_state", round: request.round, status, ...extra, ms: Date.now() - began });
	const found = personStatements(request.draft);
	if (!found.length) return [];
	let texts: Map<number, string>;
	try {
		const bundle = await request.sourceText([...new Set(found.flatMap(statement => statement.pages))].sort((a, b) => a - b));
		texts = new Map(bundle.snapshots.filter(snapshot => text(snapshot.text)).map(snapshot => [snapshot.page, snapshot.text]));
	} catch (error) { note("native_text_unavailable", { detail: String(error).slice(0, 200) }); return []; }
	const people = personRoster(request.draft, request.task), keyOf = new Map(people.map(person => [person.id, person.key]));
	// A statement whose node cites a page with no native text is the vision reviewer's alone.
	const statements: PersonStatement[] = found.filter(statement => statement.pages.length && statement.pages.every(page => texts.has(page)))
		.map((statement, index) => ({ ...statement, key: `s${index + 1}`, about: keyOf.get(statement.node.node_id)! }));
	const unjudged = found.length - statements.length;
	if (!statements.length) { note("nothing_eligible", { statements: found.length, unjudged }); return []; }
	const shown = people.map(({ key, name, aliases }) => ({ key, name, ...(aliases.length ? { aliases } : {}) }));
	const pages = [...new Set(statements.flatMap(statement => statement.pages))].sort((a, b) => a - b);
	let said, read;
	try {
		[said, read] = await Promise.all([
			readerAnswer(request, "statements", { people: shown, statements: statements.map(statement => ({ key: statement.key, about: statement.about, text: statement.text })) }),
			readerAnswer(request, "pages", { people: shown, pages: pages.map(page => ({ page, text: texts.get(page) })) }),
		]);
	} catch (error) { note("reader_failed", { statements: statements.length, detail: String(error instanceof Error ? error.message : error).slice(0, 200) }); return []; }
	const statementKeys = statements.map(statement => statement.key), personKeys = people.map(person => person.key);
	const saidShaped = shapeStatementReadings(said, statementKeys, personKeys), readShaped = shapePageReadings(read, personKeys);
	if (!saidShaped || !readShaped) { note("out_of_shape", { statements: statements.length, statements_shape: !!saidShaped, pages_shape: !!readShaped }); return []; }
	const mismatches = stateMismatches(statements, saidShaped, readShaped), rows = mismatchRows(mismatches, statements, people);
	const evidence = { version: 1, round: request.round, pages,
		people: people.map(({ key, id, name }) => ({ key, id, name })),
		statements: statements.map(({ key, path, about, text: sentence, pages: cited }) => ({ key, path, about, text: sentence, pages: cited })),
		statement_readings: saidShaped, page_readings: readShaped, mismatches };
	const body = JSON.stringify(evidence) + "\n";
	await writeFile(join(request.cwd, PERSON_STATE_FILE), body);
	await mkdir(join(request.cwd, `verify-${request.round}`), { recursive: true });
	await writeFile(join(request.cwd, `verify-${request.round}`, PERSON_STATE_FILE), body);
	note("answered", { statements: statements.length, unjudged, people: people.length, refused: rows.length });
	return rows;
}
