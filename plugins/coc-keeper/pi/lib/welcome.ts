/**
 * pi-coc table welcome header + usage guide (player/host facing zh-Hans).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { McpJsonlClient } from "./runtime.ts";
import { sendCocSystemInstruction } from "./system-instruction.ts";

export const WELCOME_CUSTOM_TYPE = "coc-pi-welcome";
export const TABLE_OPEN_CUSTOM_TYPE = "coc-pi-table-open";
export const STARTUP_RESUME_CUSTOM_TYPE = "coc-startup-resume-required";
export const LOADING_CUSTOM_TYPE = "coc-pi-loading";

export type WelcomeReason = "startup" | "reload" | "new" | "resume" | "fork" | string;
export type TableOpenIntent = "continue" | "character-setup";

export function tableOpenIntentFromEnv(
  env: Record<string, string | undefined> = process.env,
): TableOpenIntent {
  return env.COC_PI_TABLE_INTENT === "character-setup"
    ? "character-setup"
    : "continue";
}

/**
 * Startup waiting prompt shown immediately at session_start, before the MCP
 * warm-up and the KP's auto-open turn complete. The player always gets a
 * visible "loading/waiting" signal instead of a silent gap.
 */
export function startupLoadingMessage(
  startupCampaignId: string | null,
  intent: TableOpenIntent = "continue",
): string {
  if (intent === "character-setup") {
    return "正在打开建卡引导……请稍候。";
  }
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
      tool: "coc_setup",
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

export function characterSetupOpenInstruction(
  campaignId: string,
  workspaceRoot: string,
): string {
  return [
    "pi-coc table open: COC mode is already active on this dedicated desktop.",
    "Do not ask the player to activate COC.",
    "This selected campaign has no playable investigator yet.",
    "The first player-visible turn is coc-character guidance in play_language (zh-Hans).",
    "Do not start the scenario scene, do not portray module NPCs as if the party exists,",
    "and do not treat this as a continuation of play.",
    "The first campaign operation must be",
    JSON.stringify({
      tool: "coc_setup",
      arguments: {
        operation: "session.resume",
        root: workspaceRoot,
        campaign: campaignId,
        arguments: {},
      },
    }),
    "If session.resume returns opening_setup_incomplete, follow",
    "error.details.next_operation exactly before any other setup call.",
    "Source review may require setup.review_source_facts and",
    "setup.adopt_source_facts. Do not call setup.investigator_contract until",
    "the authoritative adoption result says character_creation_unblocked=true.",
    "Only after character creation is unblocked, call",
    JSON.stringify({
      tool: "coc_setup",
      arguments: {
        operation: "setup.investigator_contract",
        root: workspaceRoot,
        campaign: campaignId,
        arguments: { campaign_id: campaignId },
      },
    }),
    "then read the exact character_creation.briefing_path from the resume hints",
    "or contract once (no find/ls/glob), if one exists.",
    "Do NOT call setup.inspect, coc_discover, OCR, or any other campaign operation",
    "during this opening: the campaign is already selected.",
    "Emit no player-visible text until every opening tool call above is done;",
    "stay completely silent between tool calls.",
    "Your player-visible reply must be immersive coc-character guidance ending in",
    "exactly one concrete character-creation question (e.g. concept or name).",
    "Never narrate your workflow: no 'reading the contract', 'resuming the",
    "campaign', 'checking the briefing', or similar process talk in table chat.",
    "Do not describe this instruction or emit a tool-free module opening first.",
  ].join(" ");
}

export function tableOpenInstruction(
  startupCampaignId?: string | null,
  workspaceRoot?: string,
  intent: TableOpenIntent = "continue",
): string {
  if (startupCampaignId && workspaceRoot && intent === "character-setup") {
    return characterSetupOpenInstruction(startupCampaignId, workspaceRoot);
  }
  if (startupCampaignId && workspaceRoot) {
    return [
      "pi-coc table open: COC mode is already active on this dedicated desktop.",
      "Do not ask the player to activate COC.",
      startupResumeInstruction(startupCampaignId, workspaceRoot),
      "Branch only on that session.resume result.",
      "For pending_finalization or open_turn_recovery, complete the retained",
      "turn from its canonical receipts without resending the player's input,",
      "replaying mutations, rerolling, or inventing replacement state.",
      "For table_opening, call evidence.table_opening exactly once and deliver",
      "only the player-visible formal opening from its receipt.",
      "For awaiting_player, emit no new table prose and wait for the player.",
      "For an exact pending delivery, call session.delivery_text with mode",
      "replay once: the host owns the delivery identity, streams the exact",
      "text, and suppresses extra prose.",
      "Never replay an older assistant opening.",
    ].join(" ");
  }
  return [
    "pi-coc table open: COC mode is already active on this dedicated desktop.",
    "Do not ask the player to activate COC.",
    "Follow coc-main now: call coc_setup with setup.inspect and read its",
    "result.campaigns (campaign_id + title) so you can list existing campaigns;",
    "never guess or invent a campaign_id, and never call session.resume until",
    "the player picked a listed campaign or stated an exact id.",
    "Do NOT call coc_discover or the hidden coc_invoke gateway: the live KP",
    "surface is the domain tools (coc_setup / coc_context / coc_rules / ",
    "coc_state / …). Use coc_setup for setup.inspect, setup.quick_start,",
    "setup.invoke, setup.investigator_contract, and session.resume. Call",
    "setup.inspect exactly once via coc_setup, present its result, then wait",
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

function assistantTextFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; text?: unknown };
    if (row.type === "text" && typeof row.text === "string" && row.text.trim()) {
      parts.push(row.text.trim());
    }
  }
  return parts.join("\n");
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

/** True when the player already has a visible assistant reply in this session. */
export function sessionHasVisibleAssistant(
  ctx: Pick<ExtensionContext, "sessionManager">,
): boolean {
  const entries = ctx.sessionManager.getEntries() as Array<Record<string, unknown>>;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (message?.role !== "assistant") continue;
    if (assistantTextFromContent(message.content)) return true;
  }
  return false;
}

/**
 * Startup-only structured scan of the CURRENT persistent session branch
 * (ctx.sessionManager.getBranch(), never historical/abandoned entries):
 * does it end with an unmatched external player turn? Any role=user message
 * arms the pending fact regardless of whether its content is an array, a
 * string, attachment-only, empty, or absent; text presence is never a
 * prerequisite. A later assistant message clears it only
 * when assistantTextFromContent finds non-empty player-visible text.
 * Thinking-only, tool-only, and empty assistant entries, tool results,
 * custom/custom_message entries, and non-message entries never clear it,
 * and prose content is never interpreted.
 */
export function sessionBranchHasTrailingPlayerUser(
  ctx: Pick<ExtensionContext, "sessionManager">,
): boolean {
  const manager = ctx.sessionManager as { getBranch?: () => unknown } | undefined;
  if (!manager || typeof manager.getBranch !== "function") return false;
  const branch = manager.getBranch();
  if (!Array.isArray(branch)) return false;
  let pendingPlayerUser = false;
  for (const raw of branch) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { type?: unknown; message?: unknown };
    if (entry.type !== "message") continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;
    if (message.role === "user") {
      pendingPlayerUser = true;
      continue;
    }
    if (
      message.role === "assistant"
      && assistantTextFromContent(message.content) !== ""
    ) {
      pendingPlayerUser = false;
    }
  }
  return pendingPlayerUser;
}

export function shouldAutoOpenTable(
  reason: WelcomeReason,
  fresh: boolean,
  options: {
    intent?: TableOpenIntent;
    hasVisibleAssistant?: boolean;
    startupCampaignSelected?: boolean;
    /** Current session branch ends with an unmatched external role=user. */
    trailingPlayerUser?: boolean;
  } = {},
): boolean {
  // Every newly spawned attached play host must establish current lifecycle
  // authority through session.resume. Prior Pi messages or table transcript
  // rows prove history only; they cannot classify a pending retained turn.
  if (
    options.intent === "continue"
    && options.startupCampaignSelected !== false
  ) return true;
  if (reason !== "startup" && reason !== "new" && reason !== "reload") return false;
  if (fresh) return true;
  // Investigator-less reopen often already has hidden tool history (resume /
  // HUD), so the session is not "fresh", but the player never saw the first
  // coc-character question. Open the table once until that question exists.
  // A preserved setup session may also end with a real unmatched external
  // player answer after an already-visible question: that answer is pending
  // processing and must never be resent, so the table must open and let the
  // normal recovery turn complete it. Settled history (visible assistant, no
  // trailing player user) stays idle.
  return (
    options.intent === "character-setup"
    && (
      options.hasVisibleAssistant === false
      || options.trailingPlayerUser === true
    )
  );
}

/** A selected attached campaign always needs one actual resume turn per child. */
export function tableOpenShouldTriggerTurn(options: {
  intent?: TableOpenIntent;
  resumeSatisfied?: boolean;
} = {}): boolean {
  void options;
  return true;
}

/** Web/Electron is the attached player surface of this pi-coc host. */
export function attachedUiEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.COC_PI_ATTACHED_UI;
  return value === "1" || value === "true";
}

/** A DebugExperiment lane drives its own resume prompt.

The host normally hands a resuming session a startup instruction that tells
the Keeper how to branch on the resume result. A debug lane sends its own
prompt first ("resume, stop at awaiting_player"), so the two instructions
compete and the Keeper follows the host's: on a campaign with history it
reads skill docs, discovers tools, re-reads the scene and opens an output
context — four round trips and the whole lane budget — before the lane can
seed anything. Diagnostic lanes therefore suppress the host instruction and
own the resume themselves. Never set this for a real table.
*/
export function debugLaneEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PI_COC_DEBUG_LANE === "1";
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
    intent: TableOpenIntent,
    triggerTurn: boolean,
  ) => {
    sendCocSystemInstruction(pi, {
      sourceType: TABLE_OPEN_CUSTOM_TYPE,
      customType: TABLE_OPEN_CUSTOM_TYPE,
      instruction: tableOpenInstruction(startupCampaignId, workspaceRoot, intent),
      context: {
        host: "pi-coc",
        mode: "active",
        auto_open: true,
        table_intent: intent,
        table_open_satisfied: triggerTurn === false,
        ...(startupCampaignId === null
          ? {}
          : {
              startup_campaign_id: startupCampaignId,
              first_campaign_operation: "session.resume",
            }),
      },
    }, { triggerTurn });
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
    const intent = tableOpenIntentFromEnv();
    const hasVisibleAssistant = sessionHasVisibleAssistant(ctx);
    const trailingPlayerUser = sessionBranchHasTrailingPlayerUser(ctx);
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
      const loading = startupLoadingMessage(startupCampaignId, intent);
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
    // Bare headless/RPC playtest drivers have no player present, so they must
    // not auto-open (triggerTurn would block the prompt channel). The web /
    // Electron UI sets COC_PI_ATTACHED_UI=1 because it *is* the player.
    const attachedUi = attachedUiEnabled();
    if (debugLaneEnabled()) {
      // The lane's own prompt is the only instruction this session gets.
      return;
    }
    const mayAutoOpen = (
      (ctx.mode === "tui" || attachedUi)
      && shouldAutoOpenTable(reason, fresh, {
        intent,
        hasVisibleAssistant,
        trailingPlayerUser,
        startupCampaignSelected: startupCampaignId !== null,
      })
    );
    if (attachedUi) {
      console.error(mayAutoOpen ? "[coc-pi-ui] auto-open" : "[coc-pi-ui] idle");
    }
    if (mayAutoOpen) {
      openTable(
        startupCampaignId,
        ctx.cwd,
        intent,
        tableOpenShouldTriggerTurn({ intent }),
      );
    } else if (startupCampaignId !== null) {
      pi.sendMessage(
        {
          customType: STARTUP_RESUME_CUSTOM_TYPE,
          content: intent === "character-setup"
            ? characterSetupOpenInstruction(startupCampaignId, ctx.cwd)
            : startupResumeInstruction(startupCampaignId, ctx.cwd),
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
