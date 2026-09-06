/**
 * 开桌欢迎。内核扩展开桌成功后在总线上发 `coc:table-open`，这里报一行桌况。
 * 切片 0 只有欢迎，没有 HUD。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let payload: TableOpenEvent | undefined;
	let announced = false;

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

	// 总线事件可能早于本扩展的 session_start（内核扩展先加载），两种顺序都要接住。
	pi.events.on("coc:table-open", (data) => {
		payload = (data ?? {}) as TableOpenEvent;
		announce();
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		announce();
	});

	pi.on("session_shutdown", async () => {
		ctx = undefined;
		payload = undefined;
		announced = false;
	});
}
