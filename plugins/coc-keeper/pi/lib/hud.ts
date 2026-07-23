/**
 * Pi TUI game HUD: replace the coding-agent footer with player-safe table status.
 *
 * - Footer shows investigator / time-place / item+clue counts (not tokens/path/model)
 * - /hud sheet|time|inv|clues opens a keyboard detail panel
 * - Campaign auto-binds from coc_invoke campaign args
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { McpJsonlClient, JsonObject } from "./runtime.ts";
import {
  buildHudSnapshot,
  formatHudDetail,
  formatHudFooterLines,
  type HudSnapshot,
} from "./hud-model.ts";

const WIDGET_HINT = "coc-hud-hint";

function envelopeData(envelope: JsonObject): JsonObject {
  const data = envelope.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as JsonObject;
  return {};
}

function asDetails(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export class CocHudController {
  private campaignId: string | null = null;
  private enabled = true;
  private snapshot: HudSnapshot | null = null;
  private refreshing = false;
  private uiCtx: ExtensionContext | null = null;
  private clientFactory: ((ctx: ExtensionContext) => McpJsonlClient) | null = null;

  bindClient(factory: (ctx: ExtensionContext) => McpJsonlClient) {
    this.clientFactory = factory;
  }

  setUiContext(ctx: ExtensionContext | null) {
    this.uiCtx = ctx;
  }

  rememberCampaign(campaign: unknown) {
    if (typeof campaign === "string" && campaign.trim()) {
      this.campaignId = campaign.trim();
    }
  }

  currentCampaign(): string | null {
    return this.campaignId;
  }

  getSnapshot(): HudSnapshot | null {
    return this.snapshot;
  }

  async refresh(ctx?: ExtensionContext): Promise<void> {
    const ui = ctx ?? this.uiCtx;
    if (!ui?.hasUI || !this.enabled) return;
    if (!this.clientFactory) return;
    if (!this.campaignId) {
      this.snapshot = null;
      this.applyFooter(ui, null);
      return;
    }
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const client = this.clientFactory(ui);
      const campaign = this.campaignId;
      const sceneEnv = await client.callTool("coc_invoke", {
        operation: "scene.context",
        campaign,
        arguments: {},
      });
      const scene = envelopeData(sceneEnv);
      const party = Array.isArray(scene.party) ? scene.party : [];
      const investigator = typeof party[0] === "string" ? party[0] : null;
      let inventory: JsonObject | undefined;
      if (investigator) {
        try {
          const invEnv = await client.callTool("coc_invoke", {
            operation: "state.inventory_list",
            campaign,
            arguments: { investigator },
          });
          inventory = envelopeData(invEnv);
        } catch {
          inventory = undefined;
        }
      }
      // clues.query is often payload-projected on coding hosts; scene.context
      // already carries discovered_clues_public for the table HUD.
      this.snapshot = buildHudSnapshot({ campaignId: campaign, scene, inventory });
      this.applyFooter(ui, this.snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = buildHudSnapshot({
        campaignId: this.campaignId,
        error: message.slice(0, 120),
      });
      this.applyFooter(ui, this.snapshot);
    } finally {
      this.refreshing = false;
    }
  }

  private applyFooter(ctx: ExtensionContext, snapshot: HudSnapshot | null) {
    if (!ctx.hasUI) return;
    if (!this.enabled) {
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget(WIDGET_HINT, undefined);
      return;
    }
    const campaignId = this.campaignId;
    if (!campaignId) {
      ctx.ui.setFooter((_tui, theme) => ({
        invalidate() {},
        render(width: number) {
          return [truncateToWidth(theme.fg("muted", "COC · 未绑定战役 · /hud bind <campaign_id>"), width)];
        },
      }));
      return;
    }
    const snap = snapshot;
    ctx.ui.setFooter((_tui, theme) => ({
      invalidate() {},
      render(width: number) {
        if (!snap) {
          return [truncateToWidth(theme.fg("muted", `COC · ${campaignId} · 读取中…`), width)];
        }
        return formatHudFooterLines(snap, width).map((line) =>
          theme.fg("accent", truncateToWidth(line, width)),
        );
      },
    }));
  }

  setEnabled(ctx: ExtensionContext, enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget(WIDGET_HINT, undefined);
      return;
    }
    void this.refresh(ctx);
  }

  async showDetail(ctx: ExtensionContext, kind: "sheet" | "time" | "inv" | "clues") {
    if (!ctx.hasUI) return;
    if (!this.snapshot && this.campaignId) await this.refresh(ctx);
    const snap = this.snapshot;
    if (!snap) {
      ctx.ui.notify("HUD 尚无数据；先 /hud bind <campaign_id> 或发起 coc_invoke", "warning");
      return;
    }
    const title =
      kind === "sheet" ? "调查员" :
      kind === "time" ? "时间与地点" :
      kind === "inv" ? "物品" : "已发现线索";
    const body = formatHudDetail(kind, snap);
    await ctx.ui.custom<null>((_tui, theme, _kb, done) => {
      const lines = [
        theme.fg("accent", theme.bold(` ${title} `)),
        ...body.map((line) => theme.fg("text", line)),
        "",
        theme.fg("muted", "Esc 关闭"),
      ];
      return {
        invalidate() {},
        handleInput(data: string) {
          // Escape / ctrl+c
          if (data === "\x1b" || data === "\x03") done(null);
        },
        render(width: number) {
          return lines.map((line) => truncateToWidth(line, width));
        },
      };
    });
  }
}

export function registerCocHud(
  pi: ExtensionAPI,
  clientFactory: (ctx: ExtensionContext) => McpJsonlClient,
): CocHudController {
  const hud = new CocHudController();
  hud.bindClient(clientFactory);

  pi.registerCommand("hud", {
    description: "COC 桌面 HUD：bind/refresh/sheet/time/inv/clues/off/on",
    handler: async (args, ctx) => {
      hud.setUiContext(ctx);
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const cmd = (parts[0] || "refresh").toLowerCase();
      if (cmd === "off") {
        hud.setEnabled(ctx, false);
        ctx.ui.notify("已恢复 Pi 默认 footer（token/路径/模型）", "info");
        return;
      }
      if (cmd === "on") {
        hud.setEnabled(ctx, true);
        ctx.ui.notify("已切换为 COC 游戏 footer", "info");
        return;
      }
      if (cmd === "bind") {
        const id = parts[1];
        if (!id) {
          ctx.ui.notify("用法: /hud bind <campaign_id>", "warning");
          return;
        }
        hud.rememberCampaign(id);
        await hud.refresh(ctx);
        ctx.ui.notify(`HUD 绑定 ${id}`, "info");
        return;
      }
      if (cmd === "sheet" || cmd === "time" || cmd === "inv" || cmd === "clues") {
        await hud.showDetail(ctx, cmd);
        return;
      }
      // refresh (default)
      if (!hud.currentCampaign()) {
        ctx.ui.notify("尚未绑定战役。用法: /hud bind <campaign_id>", "warning");
        return;
      }
      await hud.refresh(ctx);
      ctx.ui.notify("HUD 已刷新", "info");
    },
  });

  pi.registerShortcut("ctrl+shift+h", {
    description: "COC HUD 详情菜单",
    handler: async (ctx) => {
      hud.setUiContext(ctx);
      if (!ctx.hasUI) return;
      const labels = [
        "sheet · 调查员参数",
        "time · 时间与地点",
        "inv · 物品",
        "clues · 已发现线索",
        "refresh · 刷新",
      ] as const;
      const choice = await ctx.ui.select("COC HUD", [...labels]);
      if (!choice) return;
      const kind = choice.split(" · ")[0];
      if (kind === "refresh") {
        await hud.refresh(ctx);
        return;
      }
      if (kind === "sheet" || kind === "time" || kind === "inv" || kind === "clues") {
        await hud.showDetail(ctx, kind);
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    hud.setUiContext(ctx);
    if (ctx.hasUI) {
      // Game session: take over footer immediately (no coding token strip).
      hud.setEnabled(ctx, true);
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    hud.setUiContext(ctx);
    if (!ctx.hasUI) return;
    // Auto-bind campaign from coc_invoke input when present.
    const toolName = event.toolName;
    const input = (event.input ?? {}) as JsonObject;
    if (toolName === "coc_invoke") {
      hud.rememberCampaign(input.campaign);
      const details = asDetails(event.details);
      const data = details ? asDetails(details.data) : null;
      const result = data ? asDetails(data.result) : null;
      hud.rememberCampaign(result?.campaign_id ?? data?.campaign_id);
      const op = typeof input.operation === "string" ? input.operation : "";
      if (
        op.startsWith("state.") ||
        op.startsWith("rules.") ||
        op === "scene.context" ||
        op.startsWith("setup.") ||
        op === "session.resume" ||
        op.startsWith("combat.")
      ) {
        // Fire-and-forget; do not block the tool_result middleware chain.
        void hud.refresh(ctx);
      }
    }
  });

  return hud;
}
