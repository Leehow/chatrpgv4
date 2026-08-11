/**
 * pi-coc table welcome header + usage guide (player/host facing zh-Hans).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { McpJsonlClient } from "./runtime.ts";

export const WELCOME_CUSTOM_TYPE = "coc-pi-welcome";
export const TABLE_OPEN_CUSTOM_TYPE = "coc-pi-table-open";
export const STARTUP_RESUME_CUSTOM_TYPE = "coc-startup-resume-required";
export const LOADING_CUSTOM_TYPE = "coc-pi-loading";

export type WelcomeReason = "startup" | "reload" | "new" | "resume" | "fork" | string;

/**
 * Startup waiting prompt shown immediately at session_start, before the MCP
 * warm-up and the KP's auto-open turn complete. The player always gets a
 * visible "loading/waiting" signal instead of a silent gap.
 */
export function startupLoadingMessage(
  startupCampaignId: string | null,
): string {
  if (startupCampaignId !== null && startupCampaignId.trim() !== "") {
    return `正在恢复战役 ${startupCampaignId.trim()}……请稍候。`;
  }
  return "正在加载 COC Keeper……请稍候。";
}

export function fullWelcomeGuide(): string {
  return [
    "欢迎使用 COC Keeper 桌面（pi-coc）· COC 模式已激活。",
    "",
    "· 新开局：直接说想玩的剧本，或选内置 starter（无需 PDF）",
    "· 继续之前的战役：我会先列出已有战役（id + 标题）供你选择，不会让你报 ID",
    "· /hud 看状态 · /welcome 重看本指南 · pi-coc --new 开新桌面",
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

export function startupResumeInstruction(
  campaignId: string,
  workspaceRoot: string,
): string {
  return [
    "pi-coc existing campaign continuation is already selected.",
    "Before any menu, setup.inspect, coc_discover, OCR, source takeover, or other campaign call,",
    "invoke exactly this normal registered tool call so its result enters the KP context:",
    JSON.stringify({
      tool: "coc_invoke",
      arguments: {
        operation: "session.resume",
        root: workspaceRoot,
        campaign: campaignId,
        arguments: {},
      },
    }),
    "Do not describe this instruction or emit a tool-free menu first.",
  ].join(" ");
}

export function tableOpenInstruction(
  startupCampaignId?: string | null,
  workspaceRoot?: string,
): string {
  if (startupCampaignId && workspaceRoot) {
    return [
      "pi-coc table open: COC mode is already active on this dedicated desktop.",
      "Do not ask the player to activate COC.",
      startupResumeInstruction(startupCampaignId, workspaceRoot),
    ].join(" ");
  }
  return [
    "pi-coc table open: COC mode is already active on this dedicated desktop.",
    "Do not ask the player to activate COC.",
    "Follow coc-main now: call setup.inspect and read its result.campaigns",
    "(campaign_id + title) so you can list existing campaigns; never guess or",
    "invent a campaign_id, and never call session.resume until the player",
    "picked a listed campaign or stated an exact id.",
    "Do NOT call coc_discover to explore the tool surface: the gateway tools",
    "(coc_capabilities / coc_discover / coc_invoke) are already known; call",
    "setup.inspect exactly once, present its result, then wait for the player.",
    "greet in zh-Hans, and offer continue (from the listed campaigns) /",
    "built-in starter quick_start / create investigator.",
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
): (
  event: unknown,
  ctx: ExtensionContext,
  startupCampaignId: string | null,
) => Promise<void> {
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

  const openTable = (
    startupCampaignId: string | null,
    workspaceRoot: string,
  ) => {
    pi.sendMessage(
      {
        customType: TABLE_OPEN_CUSTOM_TYPE,
        content: tableOpenInstruction(startupCampaignId, workspaceRoot),
        display: false,
        details: {
          host: "pi-coc",
          mode: "active",
          auto_open: true,
          ...(startupCampaignId === null
            ? {}
            : {
                startup_campaign_id: startupCampaignId,
                first_campaign_operation: "session.resume",
              }),
        },
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

  return async (event, ctx, startupCampaignId) => {
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
    if (ctx.hasUI) {
      // Startup waiting prompt first: the player sees it while the MCP
      // warm-up and any auto-open KP turn are still running.
      const loading = startupLoadingMessage(startupCampaignId);
      ctx.ui.setStatus("coc-loading", loading);
      pi.sendMessage(
        {
          customType: LOADING_CUSTOM_TYPE,
          content: loading,
          display: true,
          details: {
            reason,
            host: "pi-coc",
            mode: "active",
            startup_campaign_id: startupCampaignId,
          },
        },
        { triggerTurn: false },
      );
      showWelcome(reason);
    }

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
      openTable(startupCampaignId, ctx.cwd);
    } else if (startupCampaignId !== null) {
      pi.sendMessage(
        {
          customType: STARTUP_RESUME_CUSTOM_TYPE,
          content: startupResumeInstruction(startupCampaignId, ctx.cwd),
          display: false,
          details: {
            schema_version: 1,
            campaign_id: startupCampaignId,
            first_campaign_operation: "session.resume",
          },
        },
        { triggerTurn: false },
      );
    }
  };
}
