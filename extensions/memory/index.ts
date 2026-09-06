/**
 * 记忆抽取车道（契约 §12.3、§12.8）。
 *
 * 内核扩展 narrate 提交成功后在总线上发 `coc:turn-committed`，这里接住它：
 * `memory.job` 取闭合任务包 → 零工具子会话抽候选断言 → `memory.submit` 落盘。
 * 失败一次重试，再失败 `memory.fail`，任务进 backlog 等显式重派。
 *
 * 三条边界照契约写死：抽取永不阻塞 narrate（车道整个在交付之后，且不 await）；
 * 同一时刻只跑一个任务，后来的排队；进程退出时没跑完的不拖住关机，
 * 留给下次 `memory.job` 的缺省派发。候选不自动晋升——这里只提交候选。
 *
 * 补抽（契约 §12.8 的 #20）：上一次会话留下的坑就是靠那条「缺省派发」补的。
 * `session_start` 桥就位后，用不带 `turn` 的 `memory.job` 一个一个地要，
 * 至多 `PI_COC_MEMORY_BACKFILL`（缺省 5）个，内核回 `job_id: null` 就收手。
 * 补抽让位给桌子：回合开着的时候不起新任务，刚提交的回合永远排在它前面。
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cocMode } from "../lanes/host.ts";
import { resolveLaneModel, runLane } from "../lanes/subsession.ts";

/** 候选断言的闭合字段与闭合枚举（契约 §12.3）。多余的字段一律不往内核送。 */
const CANDIDATE_KINDS: ReadonlySet<string> = new Set([
	"world_event",
	"knowledge",
	"belief",
	"relationship",
	"player_assertion",
	"player_preference",
	"keeper_correction",
]);
const PRIVACY: ReadonlySet<string> = new Set(["player_safe", "keeper_only"]);
const STATES: ReadonlySet<string> = new Set(["accurate", "uncertain", "distorted"]);

const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_MAX_STATEMENT_CHARS = 400;
/** 每次会话至多补抽几个回合（#20）；`PI_COC_MEMORY_BACKFILL=0` 把整条补抽关掉。 */
const DEFAULT_BACKFILL_JOBS = 5;

/** 预算在 `session_start` 读，不在模块顶层读：测试台一个进程里加载多次。 */
function backfillBudget(): number {
	const raw = process.env.PI_COC_MEMORY_BACKFILL?.trim();
	if (!raw) return DEFAULT_BACKFILL_JOBS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BACKFILL_JOBS;
}

interface Candidate {
	kind: string;
	subject: string;
	statement: string;
	knowers?: string[];
	entities?: string[];
	privacy?: string;
	state?: string;
	confidence?: number;
}

/** `memory.job` 的任务包；只读它列出的字段，别的一概不进提示。 */
interface JobPacket {
	job_id?: string | null;
	turn?: number;
	commit?: string;
	scene?: { name?: string; display_name?: string };
	present?: unknown[];
	investigators?: Array<{ id?: string; name?: string }>;
	player_text?: string;
	keeper_text?: string;
	committed_facts?: unknown[];
	known_entities?: Array<{ name?: string; kind?: string }>;
	prior?: Array<Record<string, unknown>>;
	budget?: { max_candidates?: number; max_statement_chars?: number };
	instruction?: string;
}

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * 一个抽取任务。给了 `turn` 就是刚提交的那一回合；不给是缺省派发（补抽），
 * 由内核自己挑还没完成任务、也不在 backlog 里的回合（契约 §12.3）。
 */
interface Job {
	campaign: string;
	turn?: number;
	backfill?: boolean;
}

function names(rows: unknown): string {
	if (!Array.isArray(rows) || rows.length === 0) return "（无）";
	return rows
		.map((row) => {
			if (typeof row === "string") return row;
			const record = (row ?? {}) as Record<string, unknown>;
			const name = record.name ?? record.id;
			return typeof name === "string" ? name : JSON.stringify(row);
		})
		.join("、");
}

function lines(rows: unknown): string {
	if (!Array.isArray(rows) || rows.length === 0) return "（无）";
	return rows.map((row) => `- ${typeof row === "string" ? row : JSON.stringify(row)}`).join("\n");
}

function systemPrompt(packet: JobPacket): string {
	const maxCandidates = packet.budget?.max_candidates ?? DEFAULT_MAX_CANDIDATES;
	const maxChars = packet.budget?.max_statement_chars ?? DEFAULT_MAX_STATEMENT_CHARS;
	return [
		// 指令是内核用 play_language 写死的那一段（契约 §12.3），车道原样转交，不改写、不加戏。
		packet.instruction ?? "只写这一回合新出现的事实、知晓、信念、关系、玩家断言；不写数值与骰面。",
		"",
		"只回一个 JSON 对象，不要代码块、不要解释：",
		'{"candidates":[{"kind":"...","subject":"...","knowers":["..."],"statement":"...","entities":["..."],"privacy":"player_safe","state":"accurate","confidence":0.8}]}',
		"字段规矩：",
		"- kind 只能取：world_event、knowledge、belief、relationship、player_assertion、player_preference、keeper_correction。",
		"- privacy 只能取 player_safe 或 keeper_only；state 只能取 accurate、uncertain、distorted；confidence 是 0 到 1 的小数。",
		"- subject、knowers、entities 里的名字只能来自下面的「可用名字」，或保留主语 world、party、keeper、player。",
		"- world_event 的 subject 必须是 world；relationship 的 entities 恰好一个。",
		`- statement 1 到 ${maxChars} 字，一句话说清一件事。`,
		"- 除上面列出的字段外不要写任何别的键，尤其不要写回合号、提交号、收据 id、条目 id。",
		`- 最多 ${maxCandidates} 条；已经在「既有候选」里的不要重复；没有新东西就回 {"candidates":[]}。`,
	].join("\n");
}

function userInput(packet: JobPacket): string {
	return [
		`【地点】${packet.scene?.display_name ?? packet.scene?.name ?? "（未知）"}`,
		`【在场】${names(packet.present)}`,
		`【调查员】${names(packet.investigators)}`,
		`【可用名字】${names(packet.known_entities)}`,
		"",
		"【玩家这一回合说的】",
		packet.player_text?.trim() || "（无）",
		"",
		"【守秘人这一回合交付的正文】",
		packet.keeper_text?.trim() || "（无）",
		"",
		"【已提交事实】",
		lines(packet.committed_facts),
		"",
		"【既有候选：不要复述】",
		lines(packet.prior),
	].join("\n");
}

/** 形状校验：闭合字段与闭合枚举，认不出的整条丢掉。内容对不对由内核校验（名字、歧义）。 */
function shapeCandidates(parsed: unknown, packet: JobPacket): Candidate[] | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const raw = Array.isArray(parsed) ? parsed : (parsed as { candidates?: unknown }).candidates;
	if (!Array.isArray(raw)) return undefined;
	const limit = packet.budget?.max_candidates ?? DEFAULT_MAX_CANDIDATES;
	const candidates: Candidate[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as Record<string, unknown>;
		if (typeof row.kind !== "string" || !CANDIDATE_KINDS.has(row.kind)) continue;
		if (typeof row.subject !== "string" || row.subject.trim().length === 0) continue;
		if (typeof row.statement !== "string" || row.statement.trim().length === 0) continue;
		const knowers = Array.isArray(row.knowers) ? row.knowers.filter((n): n is string => typeof n === "string") : undefined;
		const entities = Array.isArray(row.entities) ? row.entities.filter((n): n is string => typeof n === "string") : undefined;
		candidates.push({
			kind: row.kind,
			subject: row.subject.trim(),
			statement: row.statement.trim(),
			...(knowers?.length ? { knowers } : {}),
			...(entities?.length ? { entities } : {}),
			...(typeof row.privacy === "string" && PRIVACY.has(row.privacy) ? { privacy: row.privacy } : {}),
			...(typeof row.state === "string" && STATES.has(row.state) ? { state: row.state } : {}),
			...(typeof row.confidence === "number" && row.confidence >= 0 && row.confidence <= 1
				? { confidence: row.confidence }
				: {}),
		});
		if (candidates.length >= limit) break;
	}
	return candidates;
}

/** 内核错误信封的 code 用鸭子类型读：跨扩展 instanceof 靠不住（两份模块实例）。 */
function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export default function (pi: ExtensionAPI) {
	// 建卡进程没有回合，也就没有可抽的记忆：什么都不注册、不订阅（契约 §14.4）。
	if (cocMode() === "setup") return;

	let ctx: ExtensionContext | undefined;
	let bridge: { campaign: string; call: KernelCall } | undefined;
	let lanes = new AbortController();
	let stopped = false;
	let running = false;
	/** 刚提交的回合，先来先抽；补抽永远排在这条队列后面（#20）。 */
	const queue: Job[] = [];
	/** 本次会话还能补抽几个；内核回 `job_id: null` 时 `backfillDone` 收手。 */
	let backfillLeft = 0;
	let backfillDone = false;
	/** agent 跑着就是回合开着：补抽这时候不起新任务，免得跟交付抢。 */
	let agentRunning = false;

	// ---- 遥测 -------------------------------------------------------------

	async function record(campaign: string, row: Record<string, unknown>): Promise<void> {
		const line = { lane: "memory", ...row };
		let cwd: string | undefined;
		try {
			pi.appendEntry("coc-telemetry", line);
			// 会话 dispose 之后 ctx 的 getter 会抛（见 docs/pi-host-contract.md 第 5 节），
			// 车道的续行可能正落在那之后：读一下就当没有工作区，别把异常抛出车道。
			cwd = ctx?.cwd;
		} catch {
			/* 遥测不该弄坏一条车道 */
		}
		if (!cwd) return;
		const path = join(cwd, ".coc", "campaigns", campaign, "telemetry.jsonl");
		try {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
		} catch {
			/* 同上 */
		}
	}

	// ---- 一次抽取 ---------------------------------------------------------

	/** 一次尝试：子会话抽候选 → `memory.submit`。返回失败原因用的是 `memory.fail` 的闭合枚举。 */
	async function attempt(
		packet: JobPacket,
		jobId: string,
		campaign: string,
		call: KernelCall,
	): Promise<{ ok: true; candidates: number; model: string } | { ok: false; reason: string; detail: string }> {
		const lane = await runLane<Candidate[]>({
			ctx: ctx as ExtensionContext,
			envName: "PI_COC_MEMORY_MODEL",
			systemPrompt: systemPrompt(packet),
			input: userInput(packet),
			signal: lanes.signal,
			shape: (parsed) => shapeCandidates(parsed, packet),
		});
		if (!lane.ok) {
			return { ok: false, reason: lane.reason === "model_unavailable" ? "lane_error" : "model_error", detail: lane.detail };
		}
		try {
			await call("memory.submit", { campaign, job_id: jobId, candidates: lane.value });
			return { ok: true, candidates: lane.value.length, model: lane.model };
		} catch (error) {
			const code = errorCode(error);
			return {
				ok: false,
				reason: code === "invalid_params" ? "invalid" : "lane_error",
				detail: `${code ?? "internal"}: ${errorText(error)}`,
			};
		}
	}

	async function runJob(job: Job): Promise<void> {
		const began = Date.now();
		// 补抽的每一行遥测都带 `backfill: true`（契约 §12.8）：桌上的抽取与补漏分得开。
		const note = (row: Record<string, unknown>) =>
			record(job.campaign, { ...(job.backfill ? { backfill: true } : {}), ...row });
		const current = bridge;
		if (!current || !ctx) {
			await note({ turn: job.turn, ok: false, reason: "lane_error", detail: "内核桥不在，车道跑不了" });
			return;
		}
		// 模型先解析：解析不出来就别把任务从内核那儿取走，免得它白白进 backlog。
		const model = resolveLaneModel(ctx, "PI_COC_MEMORY_MODEL");
		if (!model.ok) {
			await note({ turn: job.turn, ok: false, reason: "model_unavailable", detail: model.detail });
			return;
		}

		let packet: JobPacket;
		try {
			// 缺省派发不给 `turn`：内核自己挑还没抽过、也不在 backlog 里的回合（契约 §12.3）。
			packet = ((await current.call("memory.job", {
				campaign: job.campaign,
				...(typeof job.turn === "number" ? { turn: job.turn } : {}),
			})) ?? {}) as JobPacket;
		} catch (error) {
			await note({
				turn: job.turn,
				ok: false,
				ms: Date.now() - began,
				reason: "lane_error",
				detail: `memory.job ${errorCode(error) ?? "internal"}: ${errorText(error)}`,
			});
			return;
		}
		const jobId = typeof packet.job_id === "string" ? packet.job_id : undefined;
		if (!jobId) {
			if (job.backfill) {
				// 缺省派发回了空：没有坑可补了，这次会话不再要（#20）。
				// 这是补抽的正常收尾，不落遥测——每次开桌记一行「没事可做」只是噪音。
				backfillDone = true;
				return;
			}
			// 这一回合没有要抽的（已经抽过，或在 backlog 里等显式重派）。
			await note({ turn: job.turn, ok: true, ms: Date.now() - began, skipped: "no_job" });
			return;
		}

		let last: { ok: false; reason: string; detail: string } | undefined;
		for (let tries = 0; tries < 2 && !stopped; tries += 1) {
			const outcome = await attempt(packet, jobId, job.campaign, current.call);
			if (outcome.ok) {
				await note({
					turn: packet.turn ?? job.turn,
					job_id: jobId,
					ok: true,
					ms: Date.now() - began,
					model: outcome.model,
					candidates: outcome.candidates,
					...(tries > 0 ? { retried: true } : {}),
				});
				return;
			}
			last = outcome;
		}
		if (stopped) return;
		const failure = last ?? { reason: "lane_error", detail: "车道没有跑起来" };
		try {
			await current.call("memory.fail", {
				campaign: job.campaign,
				job_id: jobId,
				reason: failure.reason,
				detail: failure.detail,
			});
		} catch (error) {
			await note({
				turn: packet.turn ?? job.turn,
				job_id: jobId,
				ok: false,
				reason: "lane_error",
				detail: `memory.fail 也没落下：${errorText(error)}`,
			});
			return;
		}
		await note({
			turn: packet.turn ?? job.turn,
			job_id: jobId,
			ok: false,
			ms: Date.now() - began,
			model: `${model.model.provider}/${model.model.id}`,
			reason: failure.reason,
			detail: failure.detail.slice(0, 200),
			failed: true,
		});
	}

	/**
	 * 下一个要跑的任务。刚提交的回合永远先走：补抽只在队列空了、
	 * 回合没开着、预算还有、内核还没说「没坑可补」的时候才起（#20）。
	 */
	function nextJob(): Job | undefined {
		const queued = queue.shift();
		if (queued) return queued;
		if (stopped || backfillDone || agentRunning || backfillLeft <= 0) return undefined;
		const current = bridge;
		if (!current || !ctx) return undefined;
		backfillLeft -= 1;
		return { campaign: current.campaign, backfill: true };
	}

	/** 同一时刻只跑一个任务；后来的排队，不重叠。 */
	async function pump(): Promise<void> {
		if (running) return;
		running = true;
		try {
			while (!stopped) {
				const job = nextJob();
				if (!job) break;
				try {
					await runJob(job);
				} catch (error) {
					// 车道再怎么坏也只是一条车道：不让它变成没人接的拒绝，
					// 也不让它挡住队列里后面那个任务。
					await record(job.campaign, {
						turn: job.turn,
						ok: false,
						reason: "lane_error",
						detail: errorText(error),
					});
				}
			}
		} finally {
			running = false;
		}
	}

	// ---- 总线 -------------------------------------------------------------

	// 内核扩展先加载，但 session_start 里才发桥；两种顺序都要接住。
	pi.events.on("coc:kernel-bridge", (data) => {
		const payload = (data ?? {}) as { campaign?: string; call?: KernelCall };
		bridge = typeof payload.call === "function" && payload.campaign
			? { campaign: payload.campaign, call: payload.call }
			: undefined;
		// 桥比本扩展的 session_start 晚到时补抽也得起得来；早到的那种由
		// session_start 自己踢（这时 ctx 还没有，泵会空转一圈就退出）。
		if (bridge && ctx && !stopped) void pump().catch(() => undefined);
	});

	pi.events.on("coc:turn-committed", (data) => {
		const payload = (data ?? {}) as { campaign?: string; turn?: number };
		if (stopped || !payload.campaign || typeof payload.turn !== "number") return;
		queue.push({ campaign: payload.campaign, turn: payload.turn });
		void pump().catch(() => undefined);
	});

	// 回合开着的时候不补抽（#20）：agent 跑起来就是玩家那一回合在走，
	// 交付、催收、恢复轮都算。`agent_settled` 是「这一轮真的走完了」，
	// 它在 finally 里发，所以不会漏。
	pi.on("agent_start", async () => {
		agentRunning = true;
	});

	pi.on("agent_settled", async () => {
		agentRunning = false;
		if (!stopped) void pump().catch(() => undefined);
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		stopped = false;
		agentRunning = false;
		lanes = new AbortController();
		queue.length = 0;
		// 补抽的预算按会话算（契约 §12.8 的 #20）：桥这时候已经由内核扩展发过了
		// （扩展的 session_start 按加载顺序串行跑，kernel 在最前）。
		backfillLeft = backfillBudget();
		backfillDone = backfillLeft <= 0;
		if (!backfillDone) void pump().catch(() => undefined);
	});

	pi.on("session_shutdown", async () => {
		// 关机不等车道：排着的丢掉，在飞的掐断，没抽完的下次 `memory.job` 缺省派发会再取。
		stopped = true;
		queue.length = 0;
		backfillLeft = 0;
		backfillDone = true;
		lanes.abort();
		bridge = undefined;
		ctx = undefined;
	});
}
