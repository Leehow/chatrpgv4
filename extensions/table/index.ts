/**
 * 桌况显示。内核扩展开桌成功后在总线上发 `coc:table-open`，这里报一行桌况；
 * 每次 `resolve` 回来发 `coc:resolve`，带会话（战斗、追逐、理智发作）时把
 * 会话摘要挂在状态行上，会话没了就摘掉；每回合的胶囊从 `coc:capsule` 过来，
 * 把 Director 的建议节拍挂上另一行（契约 §13.9：只显示，不解释也不据此动手）。
 * 规则一概不在这里解释。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** 契约 §11.5 的会话摘要；字段缺了就不显示那一段。 */
interface SessionSummary {
	kind?: string;
	round?: number;
	status?: string;
	ended?: boolean;
	turn_of?: string;
	active_actor?: string;
	pending_defense?: { for?: string; defender?: string; options?: string[] } | null;
}

interface ResolveEvent {
	result?: { session?: SessionSummary | null };
}

/** 契约 §13.1 的 `director` 节；这里只取要显示的两个字段，打分与依据不上状态行。 */
interface DirectorSection {
	beat?: string;
	override?: string;
}

interface CapsuleEvent {
	capsule?: { director?: DirectorSection | null } | null;
}

interface TableOpenEvent {
	campaign?: string;
	open?: {
		campaign?: { title?: string };
		turn?: { number?: number; state?: string };
		investigators?: Array<{ name?: string; hp?: number; san?: number }>;
		scene?: { name?: string; display_name?: string };
	};
}

function describe(payload: TableOpenEvent): string {
	const open = payload.open ?? {};
	const title = open.campaign?.title ?? payload.campaign ?? "无名战役";
	const scene = open.scene?.display_name ?? open.scene?.name ?? "未知场景";
	const who = (open.investigators ?? [])
		.map((inv) => `${inv.name ?? "无名调查员"}　HP ${inv.hp ?? "?"}／SAN ${inv.san ?? "?"}`)
		.join("｜");
	const turn = open.turn?.number ?? 0;
	return `《${title}》　第 ${turn} 回合　${scene}${who ? `\n${who}` : ""}`;
}

/** 会话种类与防御方式都是契约里的闭合枚举，认不出的原样显示。 */
const SESSION_KINDS: Record<string, string> = {
	combat: "战斗",
	chase: "追逐",
	sanity: "理智发作",
	sanity_bout: "理智发作",
};
const DEFENSES: Record<string, string> = { dodge: "闪避", fight_back: "反击" };

/** 一行会话摘要；没有会话或会话已结束时回 undefined，调用方据此摘掉状态行。 */
function sessionLine(session: SessionSummary | null | undefined): string | undefined {
	if (!session?.kind) return undefined;
	if (session.ended === true || session.status === "ended") return undefined;
	const parts = [SESSION_KINDS[session.kind] ?? session.kind];
	if (typeof session.round === "number") parts.push(`第 ${session.round} 轮`);
	const whose = session.turn_of ?? session.active_actor;
	if (whose) parts.push(`轮到 ${whose}`);
	const defense = session.pending_defense;
	if (defense) {
		const who = defense.for === "player" ? "玩家" : (defense.defender ?? "NPC");
		const options = (defense.options ?? []).map((option) => DEFENSES[option] ?? option).join("／");
		parts.push(`待防御：${who}${options ? `（${options}）` : ""}`);
	}
	return parts.join("　");
}

/**
 * 一行 Director 建议；没有 `director` 节（切片 0–2 的内核）时回 undefined，调用方据此摘掉。
 * 节拍名与硬规则名都是契约里的闭合枚举，原样显示：状态行是给人看的溯源，
 * 不是给守秘人看的指令，翻译一层只会跟胶囊里的字对不上。
 */
function directorLine(director: DirectorSection | null | undefined): string | undefined {
	const beat = typeof director?.beat === "string" ? director.beat.trim() : "";
	if (!beat) return undefined;
	const override = typeof director?.override === "string" ? director.override.trim() : "";
	return override ? `节拍 ${beat}　硬规则 ${override}` : `节拍 ${beat}`;
}

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let payload: TableOpenEvent | undefined;
	let announced = false;
	let session: string | undefined;
	let director: string | undefined;

	function announce(): void {
		if (announced || !payload || !ctx) return;
		announced = true;
		const text = describe(payload);
		if (ctx.hasUI) {
			ctx.ui.notify(text, "info");
			return;
		}
		pi.appendEntry("coc-welcome", { campaign: payload.campaign, text });
	}

	function paintSession(): void {
		if (!ctx?.hasUI) return;
		ctx.ui.setStatus("coc-session", session);
	}

	function paintDirector(): void {
		if (!ctx?.hasUI) return;
		ctx.ui.setStatus("coc-director", director);
	}

	// 总线事件可能早于本扩展的 session_start（内核扩展先加载），两种顺序都要接住。
	pi.events.on("coc:table-open", (data) => {
		payload = (data ?? {}) as TableOpenEvent;
		announce();
	});

	// 胶囊由内核扩展在 `before_agent_start` 交付，同一份原样发上总线（契约 §13.9）。
	pi.events.on("coc:capsule", (data) => {
		const next = directorLine(((data ?? {}) as CapsuleEvent).capsule?.director);
		if (next === director) return;
		director = next;
		paintDirector();
	});

	pi.events.on("coc:resolve", (data) => {
		const next = sessionLine(((data ?? {}) as ResolveEvent).result?.session);
		if (next === session) return;
		session = next;
		paintSession();
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		announce();
	});

	pi.on("session_shutdown", async () => {
		if (session !== undefined) {
			session = undefined;
			paintSession();
		}
		if (director !== undefined) {
			director = undefined;
			paintDirector();
		}
		ctx = undefined;
		payload = undefined;
		announced = false;
	});
}
