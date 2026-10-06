/**
 * The handle lane (contract §185.5; owner ruling 2026-10-06 on docs/specs/name-free-handles.md).
 *
 * A name-free campaign shows every node of a reader-built book by a handle the book's words do not make: a short English
 * phrase that says what the thing is (`bar-owner-pencil-mustache`). `handles.job` lists the nodes the book's `handles.json`
 * neither names nor gave up, with their kind, name and summary, every cast form no handle may carry and the handles already
 * taken; a zero-tool subsession on the fast model writes one handle per node; `handles.submit` checks each on its own and
 * keeps the accepted ones. The kernel folds them into the campaign at its next safe moment (§185.6), so this lane decides what
 * the Keeper is first shown for every node a reading lands.
 *
 * The model never sees a node id. Ids are minted from the book's words (`npc-old-mae`), so each node goes to the model under
 * an opaque key (`n1`) that only says which node an answer is for, and the lane maps the answer back to the id.
 *
 * When it runs (§185.11 NFH-03): once when the session and the bridge are both up, in setup and at a table; after every
 * committed turn; when a reading publishes (`coc:source-published`, which catches nodes landed between turns); and when setup
 * creates the campaign (`coc:session-bound`). Before `campaign.create`, or before setup writes a campaign's first world, the
 * campaign form has nothing to answer, and a book a publication named is asked in the library form (`{module}`) instead, so
 * `campaign.create`'s fold can already take its handles. A big book comes in parts, a few jobs per trigger, one after another:
 * jobs hold no lease, so two at once would offer the same nodes.
 *
 * One retry per node the kernel refused for its handle, or the model left unanswered: alone, with the refusal in the kernel's
 * own words. Refused again, unanswered again, or the model failing or late on that retry, and the node is written as
 * `given_up`, so no job offers it again and the fold gives it `<kind>-<n>`. A round whose first ask fails as a whole gives up
 * nothing: those nodes were never answered, and the next trigger asks again.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runLane } from "../lanes/subsession.ts";
import { createLaneQueue, type KernelCall, type LaneJob } from "../lanes/queue.ts";
import { createLaneTelemetry } from "../lanes/telemetry.ts";

const MODEL_ENV = "PI_COC_HANDLES_MODEL";
/** Jobs per trigger: a book larger than one job (`HANDLES_PER_JOB` nodes) is named in parts, the rest by the next trigger. */
const ROUNDS = 4;
/** Retries in flight at once, each its own completion; bounded so one bad round cannot fan out across the provider. */
const RETRY_CONCURRENCY = 3;
/** Past these a completion is late: a whole job's answer, and one node's retry. */
const JOB_TIMEOUT_MS = 120_000;
const RETRY_TIMEOUT_MS = 60_000;
/**
 * The kernel's errors that mean the campaign form has nothing to answer yet: setup before `campaign.create`, or a campaign
 * whose first world is not written (contract §1's closed codes, not a judgment).
 */
const NOT_YET: ReadonlySet<string> = new Set(["campaign_not_found", "campaign_not_ready"]);
/**
 * Refusals about the node rather than the handle (§185.5's closed set): another writer named it first, or it is no node of
 * the served graph. No new handle changes either, so neither is retried nor given up. Every other reason is retried.
 */
const NOT_RETRIED: ReadonlySet<string> = new Set(["unknown_entity", "settled"]);

interface PacketNode { id?: unknown; kind?: unknown; name?: unknown; summary?: unknown }
/** The job packet from `handles.job`; only these fields are read, and nothing else reaches the prompt. */
export interface HandlePacket {
	job_id?: string | null;
	waiting?: string;
	nodes?: PacketNode[];
	avoid?: string[];
	taken?: string[];
	instruction?: string;
}
/** A node as the lane holds it: the model is shown its key, never its id. */
export interface KeyedNode { key: string; id: string; kind: string; name: string; summary: string }
export interface HandleAnswer { key: string; handle: string }
interface Refused { id?: unknown; handle?: unknown; reason?: unknown; message?: unknown }
interface Submitted { written?: Array<{ id?: unknown; handle?: unknown; given_up?: unknown }>; refused?: Refused[] }
type Target = { campaign: string } | { module: string };
type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);
const errorCode = (error: unknown): string | undefined => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
};
const errorReason = (error: unknown): string | undefined => {
	const reason = (error as { details?: { reason?: unknown } } | null)?.details?.reason;
	return typeof reason === "string" ? reason : undefined;
};

/** The packet's nodes in its order, each under the key the model sees: `n1`, `n2`, ... */
export function keyNodes(packet: HandlePacket): KeyedNode[] {
	return (packet.nodes ?? []).filter((node) => typeof node?.id === "string" && node.id !== "")
		.map((node, index) => ({ key: `n${index + 1}`, id: node.id as string, kind: text(node.kind), name: text(node.name), summary: text(node.summary) }));
}

export function handleSystemPrompt(packet: HandlePacket): string {
	return [
		// The kernel's instruction is passed on verbatim, rewriting nothing.
		packet.instruction ?? "Give each node below a handle: a short lowercase English phrase that says what the thing is, never any part of anyone's name.",
		"Let each node's kind decide what its handle says: a person by their role or how they look, a place by what it is, a clue by what it shows, anything else by what it is.",
		"",
		"Answer with one JSON object only, no code fence and no explanation:",
		'{"handles":[{"key":"<the node\'s key, copied exactly>","handle":"..."}]}',
		"Field rules:",
		"- key is one of the keys listed under Nodes, copied exactly; it only says which node the handle is for. One handle per node, every node listed.",
		"- handle is lowercase ASCII kebab-case: letters and digits, words joined by single hyphens, starting with a letter.",
		"- no handle listed under Taken, and no two nodes with the same handle.",
	].join("\n");
}

/** What the model reads: the nodes by key, kind, name and summary; the forms to avoid; the handles taken; on a retry, why. */
export function handleUserInput(nodes: readonly KeyedNode[], packet: HandlePacket, taken: readonly string[], again?: string): string {
	const rows = nodes.map((node) => ({ key: node.key, kind: node.kind, name: node.name, ...(node.summary ? { summary: node.summary } : {}) }));
	return [
		"[Nodes]",
		JSON.stringify(rows),
		"[Avoid: every form of every name in the book's cast, with its pieces; no handle may carry any of them]",
		JSON.stringify(packet.avoid ?? []),
		"[Taken: handles already in use, give none of them]",
		JSON.stringify(taken),
		// The second ask is told why the first could not be used, in the kernel's own words where the kernel refused it.
		...(again ? ["", "[Asked again: your previous answer for this node could not be used; give it a new handle]", again] : []),
	].join("\n");
}

/**
 * `{handles: [{key, handle}]}`: a row whose key is one asked and not seen before, with a non-empty handle, is taken; any other
 * row is no answer for its node. Undefined when nothing usable came back. The handle's own shape is the kernel's check, so its
 * refusal can travel to the retry verbatim.
 */
export function shapeHandles(parsed: unknown, keys: ReadonlySet<string>): HandleAnswer[] | undefined {
	const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { handles?: unknown }).handles : undefined;
	if (!Array.isArray(raw)) return undefined;
	const seen = new Set<string>(), out: HandleAnswer[] = [];
	for (const value of raw) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const { key, handle } = value as { key?: unknown; handle?: unknown };
		if (typeof key !== "string" || !keys.has(key) || seen.has(key) || typeof handle !== "string" || !handle.trim()) continue;
		seen.add(key);
		out.push({ key, handle: handle.trim() });
	}
	return out.length ? out : undefined;
}

const refusalLine = (node: KeyedNode, row: Refused): string =>
	`- ${node.key}: ${JSON.stringify(typeof row.handle === "string" ? row.handle : null)} refused (${text(row.reason)}): ${text(row.message)}`;
const unansweredLine = (node: KeyedNode): string => `- ${node.key}: your answer gave this node no handle`;

/** `work` over `items`, at most `limit` at once, in order of start. */
async function eachBounded<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => { while (next < items.length) await work(items[next++]!); };
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

type FormOutcome = "not_yet" | "done" | "authored" | "more" | "failed";

export default function (pi: ExtensionAPI) {
	const telemetry = createLaneTelemetry(pi, { lane: "handles", modelEnv: MODEL_ENV, cwd: () => scheduler.ctx?.cwd });
	/** Books a reading published for this table while its campaign could not answer for them yet (§185.5's library form). */
	const books = new Set<string>();
	/** Books the library form refused as authored (a starter, or one no reading lane publishes): not asked again. */
	const authored = new Set<string>();
	// Registered before the queue's own listener on the same event, so the job that event wakes already sees the book.
	pi.events.on("coc:source-published", (data) => {
		const row = (data ?? {}) as { campaign?: unknown; module_id?: unknown };
		const bound = scheduler.bridge?.campaign;
		if (typeof row.module_id !== "string" || !row.module_id || authored.has(row.module_id)) return;
		if (typeof row.campaign === "string" && row.campaign && row.campaign !== bound) return;
		books.add(row.module_id);
	});
	pi.on("session_start", async () => {
		books.clear();
		authored.clear();
	});

	const scheduler = createLaneQueue(pi, {
		initialJob: true,
		// A reading landed (the campaign's own, or a library publication it reads before its fork, §22.6), and setup created the
		// campaign the bridge names: either may bring nodes with no handle before the next committed turn.
		wakeOn: ["coc:source-published", "coc:session-bound"],
		runJob,
		onError: (job, error) => telemetry.record(job.campaign, { ...(typeof job.turn === "number" ? { turn: job.turn } : {}), ok: false, reason: "lane_error", detail: errorText(error) }),
	});

	async function runJob(job: LaneJob): Promise<void> {
		const current = scheduler.bridge;
		if (!current || !scheduler.ctx) return;
		const turn: Row = typeof job.turn === "number" ? { turn: job.turn } : {};
		if (await runForm({ campaign: job.campaign }, job.campaign, turn, current.call) !== "not_yet") {
			// The campaign answers for its own book from now on.
			books.clear();
			return;
		}
		for (const module of [...books]) {
			if (scheduler.stopped) return;
			const outcome = await runForm({ module }, job.campaign, turn, current.call);
			if (outcome === "authored") authored.add(module);
			if (outcome === "done" || outcome === "authored") books.delete(module);
		}
	}

	/** Up to ROUNDS jobs of one form, one after another. Rows go to the bound campaign's telemetry, the library form's too. */
	async function runForm(target: Target, campaign: string, turn: Row, call: KernelCall): Promise<FormOutcome> {
		const form: Row = "module" in target ? { form: "library", module: target.module } : { form: "campaign" };
		const note = (row: Row) => telemetry.record(campaign, { ...turn, ...form, ...row });
		for (let round = 0; round < ROUNDS; round += 1) {
			if (scheduler.stopped) return "more";
			let packet: HandlePacket;
			try {
				packet = ((await call("handles.job", target)) ?? {}) as HandlePacket;
			} catch (error) {
				const code = errorCode(error);
				if ("campaign" in target && code && NOT_YET.has(code)) return "not_yet";
				if ("module" in target && code === "invalid_params" && errorReason(error) === "authored") return "authored";
				await note({ ok: false, reason: "lane_error", detail: `handles.job ${code ?? "internal"}: ${errorText(error)}` });
				return "failed";
			}
			// Every node named or given up, a legacy campaign, or no graph yet: the ordinary ending, written as no row.
			const nodes = keyNodes(packet);
			if (typeof packet.job_id !== "string" || !nodes.length) return "done";
			const outcome = await runRound(packet, nodes, target, call, note);
			if (outcome !== "progress") return outcome === "failed" ? "failed" : "more";
		}
		return "more";
	}

	/** One job: the whole batch asked once, each node that could not be used asked once more alone, then one telemetry row. */
	async function runRound(packet: HandlePacket, nodes: KeyedNode[], target: Target, call: KernelCall, note: (row: Row) => Promise<void>): Promise<"progress" | "stalled" | "failed"> {
		const began = Date.now(), jobId = packet.job_id, signal = scheduler.signal;
		const ask = (asked: readonly KeyedNode[], taken: readonly string[], again: string | undefined, timeoutMs: number) => runLane<HandleAnswer[]>({
			ctx: scheduler.ctx as ExtensionContext,
			envName: MODEL_ENV,
			lane: "handles",
			record: (row) => note({ job_id: jobId, ...row }),
			systemPrompt: handleSystemPrompt(packet),
			input: handleUserInput(asked, packet, taken, again),
			signal,
			timeoutMs,
			shape: (parsed) => shapeHandles(parsed, new Set(asked.map((node) => node.key))),
		});
		const submit = async (params: Row): Promise<Submitted> => ((await call("handles.submit", { ...target, ...params })) ?? {}) as Submitted;
		const refused: Record<string, number> = {};
		const tally = (rows: Refused[]) => { for (const row of rows) { const reason = text(row.reason) || "unknown"; refused[reason] = (refused[reason] ?? 0) + 1; } };
		const failed = async (reason: string, detail: string, model?: string) => {
			await note({ job_id: jobId, ok: false, ms: Date.now() - began, ...(model ? { model } : {}), asked: nodes.length, written: 0, refused: {}, given_up: 0,
				reason, detail: detail.slice(0, 200) });
			return "failed" as const;
		};

		const first = await ask(nodes, packet.taken ?? [], undefined, JOB_TIMEOUT_MS);
		// The whole ask failed: no model, a provider error, late, or nothing usable. Nothing is given up; the next trigger asks
		// again. A session that closed under it is no failure of the lane and writes no row.
		if (!first.ok) return signal.aborted ? "failed" : failed(first.reason, first.detail, first.model);
		const byKey = new Map(nodes.map((node) => [node.key, node]));
		let answer: Submitted;
		try {
			answer = await submit({ entries: first.value.map((row) => ({ id: byKey.get(row.key)!.id, handle: row.handle })) });
		} catch (error) {
			return failed("lane_error", `handles.submit ${errorCode(error) ?? "internal"}: ${errorText(error)}`, first.model);
		}
		const accepted = list(answer.written).map((row) => text(row.handle)).filter(Boolean), refusals = list(answer.refused);
		tally(refusals);
		let written = accepted.length;
		// Handles this round wrote are taken too: a retry is told about them as about the book's earlier ones.
		const taken = [...(packet.taken ?? []), ...accepted];
		const answered = new Set(first.value.map((row) => row.key)), refusalOf = new Map(refusals.map((row) => [text(row.id), row]));
		const again: Array<{ node: KeyedNode; why: string }> = [];
		let unanswered = 0;
		for (const node of nodes) {
			if (!answered.has(node.key)) {
				unanswered += 1;
				again.push({ node, why: unansweredLine(node) });
				continue;
			}
			const refusal = refusalOf.get(node.id);
			if (refusal && !NOT_RETRIED.has(text(refusal.reason))) again.push({ node, why: refusalLine(node, refusal) });
		}

		// One retry per node, alone. Refused again for its handle, unanswered, or the model failing or late: given up. A closed
		// session, a model that cannot be resolved at all, or a kernel failure is nothing the node did: it is asked again later.
		const gaveUp: string[] = [];
		let retried = 0;
		await eachBounded(again, RETRY_CONCURRENCY, async ({ node, why }) => {
			if (signal.aborted) return;
			retried += 1;
			const second = await ask([node], taken, why, RETRY_TIMEOUT_MS);
			if (signal.aborted) return;
			if (!second.ok) {
				if (second.reason !== "model_unavailable") gaveUp.push(node.id);
				return;
			}
			const handle = second.value[0]!.handle;
			let result: Submitted;
			try { result = await submit({ entries: [{ id: node.id, handle }] }); }
			catch { return; }
			const rows = list(result.refused);
			tally(rows);
			if (list(result.written).length) {
				written += 1;
				taken.push(handle);
				return;
			}
			if (rows.some((row) => !NOT_RETRIED.has(text(row.reason)))) gaveUp.push(node.id);
		});
		let givenUp = 0, detail: string | undefined;
		if (gaveUp.length && !signal.aborted) {
			try {
				givenUp = list((await submit({ given_up: gaveUp })).written).filter((row) => row.given_up === true).length;
			} catch (error) {
				detail = `handles.submit given_up ${errorCode(error) ?? "internal"}: ${errorText(error)}`;
			}
		}
		await note({ job_id: jobId, ok: true, ms: Date.now() - began, model: first.model, asked: nodes.length, written, refused, given_up: givenUp,
			...(unanswered ? { unanswered } : {}), ...(retried ? { retried } : {}), ...(detail ? { detail } : {}) });
		// A round that settled nothing would only be offered the same nodes again.
		return written + givenUp + (refused.settled ?? 0) > 0 ? "progress" : "stalled";
	}
}
