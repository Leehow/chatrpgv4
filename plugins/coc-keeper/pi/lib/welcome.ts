/**
 * pi-coc table welcome header + usage guide (player/host facing zh-Hans).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { McpJsonlClient } from "./runtime.ts";

export const WELCOME_CUSTOM_TYPE = "coc-pi-welcome";
export const TABLE_OPEN_CUSTOM_TYPE = "coc-pi-table-open";

export type WelcomeReason = "startup" | "reload" | "new" | "resume" | "fork" | string;

export function fullWelcomeGuide(): string {
  return [
    "欢迎使用 COC Keeper 桌面（pi-coc）",
    "",
    "进入本桌面即已进入 COC 模式，无需再说「激活 COC」。",
    "这不是写代码的 pi；内置 read/bash/edit/write 已关闭。",
    "",
    "常用：",
    "· 直接开玩：继续已有战役，或选内置 starter / 自建调查员",
    "· 工具链：coc_capabilities → coc_discover → coc_invoke",
    "· /hud bind <campaign_id> 绑定桌面状态条；/hud 刷新",
    "· /skill:coc-main 查看主技能；/welcome 重看本指南",
    "· 改仓库代码请另开 pi；本会话默认续接 session-id coc-keeper",
    "· 开新桌面：pi-coc --new",
  ].join("\n");
}

export function resumeWelcomeGuide(): string {
  return [
    "已续接 COC 桌面（模式已激活，session-id: coc-keeper）。",
    "直接对 KP 说话继续即可；/hud 看状态，/welcome 看完整指南，pi-coc --new 开新桌面。",
  ].join("\n");
}

export function welcomeBodyForReason(reason: WelcomeReason): string {
  if (reason === "resume") return resumeWelcomeGuide();
  return fullWelcomeGuide();
}

export function tableOpenInstruction(): string {
  return [
    "pi-coc table open: COC mode is already active on this dedicated desktop.",
    "Do not ask the player to activate COC.",
    "Follow coc-main now: call setup.inspect (and session.resume if a campaign is already in play),",
    "greet in zh-Hans, and offer continue / built-in starter quick_start / create investigator.",
    "Begin the onboarding or continuation immediately.",
  ].join(" ");
}

export function cocHeaderLines(theme: Theme): string[] {
  const title = theme.fg("accent", theme.bold(" COC Keeper · pi-coc "));
  const hints = theme.fg(
    "muted",
    " 已激活 · /welcome · /hud · /skill:coc-main · 续接 coc-keeper · --new 新桌面 ",
  );
  return ["", title, hints, ""];
}

export function warmMarkerPath(agentDir: string): string {
  return join(agentDir, "warmed.json");
}

export async function writeWarmMarker(agentDir: string, extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const payload = {
    warmed_at: new Date().toISOString(),
    host: "pi-coc",
    ...extra,
  };
  await writeFile(warmMarkerPath(agentDir), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** True when the session has no prior user/assistant turns (fresh desktop). */
export function sessionLooksFresh(ctx: Pick<ExtensionContext, "sessionManager">): boolean {
  const entries = ctx.sessionManager.getEntries() as Array<Record<string, unknown>>;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as Record<string, unknown> | undefined;
    const role = message?.role;
    if (role === "user" || role === "assistant") return false;
  }
  return true;
}

export function shouldAutoOpenTable(reason: WelcomeReason, fresh: boolean): boolean {
  if (!fresh) return false;
  return reason === "startup" || reason === "new" || reason === "reload";
}

export function registerCocWelcome(
  pi: ExtensionAPI,
  getClient: (ctx: ExtensionContext) => McpJsonlClient,
  agentDir: string,
): void {
  const showWelcome = (reason: WelcomeReason) => {
    pi.sendMessage(
      {
        customType: WELCOME_CUSTOM_TYPE,
        content: welcomeBodyForReason(reason),
        display: true,
        details: { reason, host: "pi-coc", mode: "active" },
      },
      { triggerTurn: false },
    );
  };

  const openTable = () => {
    pi.sendMessage(
      {
        customType: TABLE_OPEN_CUSTOM_TYPE,
        content: tableOpenInstruction(),
        display: false,
        details: { host: "pi-coc", mode: "active", auto_open: true },
      },
      { triggerTurn: true },
    );
  };

  pi.registerCommand("welcome", {
    description: "显示 COC 桌面欢迎与使用指南",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) ctx.ui.notify("已显示欢迎指南", "info");
      showWelcome("startup");
    },
  });

  pi.on("session_start", async (event, ctx) => {
    const reason = (event as { reason?: string }).reason ?? "startup";
    const fresh = sessionLooksFresh(ctx);
    if (ctx.hasUI && ctx.mode === "tui") {
      ctx.ui.setHeader((_tui, theme) => ({
        render(_width: number) {
          return cocHeaderLines(theme);
        },
        invalidate() {},
      }));
    }
    if (ctx.hasUI) showWelcome(reason);

    try {
      await getClient(ctx).callTool("coc_capabilities", {}, undefined);
      await writeWarmMarker(agentDir, { session_reason: reason, fresh });
      if (ctx.hasUI) ctx.ui.setStatus("coc-warm", "COC 已激活 · MCP 已预热");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) ctx.ui.notify(`COC MCP 预热未完成：${message}`, "warning");
    }

    // Fresh dedicated desktop: open the table without waiting for「激活 COC」.
    // Only in interactive TUI mode — headless/RPC has no player present, and
    // auto-open's triggerTurn:true would launch a full KP opening turn that
    // blocks the RPC prompt channel for minutes ("already processing").
    if (ctx.mode === "tui" && shouldAutoOpenTable(reason, fresh)) {
      openTable();
    }
  });
}
