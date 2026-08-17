import { useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Crosshair,
  HeartPulse,
  ListOrdered,
  Shield,
  Swords,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { CombatInitiative, GameState } from "../types";

/** localStorage key for the dismissed "战斗结束" card: `${campaignId}:${combatId}`.
 *  combat.json persists after conclusion, so the client owns retiring the card;
 *  a fresh encounter restarts with a new combat_id and shows again. */
const LS_DISMISSED = "coc.combat.dismissed";

const INITIATIVE_STATUS_LABELS: Record<string, string> = {
  pending: "待行动",
  acted: "已行动",
  skipped: "已跳过",
  excluded_at_round_start: "无法行动",
};

/** Engine outcome enum (coc_combat.VALID_OUTCOMES) → player-facing label. */
const OUTCOME_LABELS: Record<string, string> = {
  investigators_win: "调查员胜利",
  monsters_win: "调查员败北",
  fled: "撤离战斗",
  stalemate: "僵持结束",
};

interface Props {
  combat: CombatInitiative;
  state: GameState | null;
  investigatorId: string | null;
  campaignId: string | null;
}

/** Player's own in-combat vitals, reused from the already-projected sheet:
 *  HP from live actor resources, dodge/weapons from the display character. */
function SelfVitals({ state, investigatorId }: { state: GameState | null; investigatorId: string | null }) {
  const actor =
    state?.actors?.find((a) => a.id === investigatorId) ?? state?.actors?.[0] ?? null;
  const sheet = state?.character ?? null;
  const hp = typeof actor?.resources?.hp === "number" ? actor.resources.hp : null;
  const hpMaxRaw = sheet?.derived?.HP;
  const hpMax = typeof hpMaxRaw === "number" ? hpMaxRaw : null;
  const dodge = sheet?.skills?.find((s) => s.key.toLowerCase() === "dodge");
  const weapons = sheet?.weapons ?? [];
  if (hp === null && !dodge && weapons.length === 0) return null;
  const hpPct = hp !== null && hpMax && hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : null;
  return (
    <div className="combat-self">
      {hp !== null && (
        <div className="combat-self-hp">
          <span className="combat-self-label">
            <HeartPulse className="size-3" /> HP
          </span>
          <span className="combat-self-hpbar" role="img" aria-label={`生命值 ${hp}${hpMax ? ` / ${hpMax}` : ""}`}>
            <span className="bg-hp" style={{ width: `${hpPct ?? 100}%` }} />
          </span>
          <b>{hp}{hpMax ? <small>/{hpMax}</small> : null}</b>
        </div>
      )}
      {dodge && (
        <span className="combat-self-stat">
          <Shield className="size-3" /> 闪避 <b>{dodge.value}</b>
        </span>
      )}
      {weapons.length > 0 && (
        <div className="combat-self-weapons">
          {weapons.map((w, i) => (
            <span className="combat-self-weapon" key={`${w.label ?? "weapon"}-${i}`} title={[w.skill_label, w.damage ? `伤害 ${w.damage}` : null].filter(Boolean).join(" · ")}>
              <Swords className="size-3" /> {w.label ?? "武器"}
              {w.damage ? <small>{w.damage}</small> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function InitiativeRows({ combat }: { combat: CombatInitiative }) {
  return (
    <div className="initiative-track">
      {combat.rows.map((row, index) => (
        <article
          className={cn(
            "initiative-row",
            row.current && "is-current",
            row.status === "acted" && "is-acted",
            row.status === "excluded_at_round_start" && "is-excluded",
          )}
          key={row.actor_id || index}
        >
          <span className="initiative-rank">{String(index + 1).padStart(2, "0")}</span>
          <span className="initiative-actor">
            <b>{row.display_name}</b>
            <small>{row.side === "investigator" ? "调查员" : "对手"}</small>
          </span>
          <span className="initiative-score">
            <small>{row.ready_firearm ? "行动值" : "DEX"}</small>
            <b>{row.initiative_value ?? "—"}</b>
          </span>
          {row.ready_firearm && <span className="initiative-firearm"><Crosshair className="size-3" /> 备妥枪械</span>}
          <span className="initiative-status">
            {row.current && <Activity className="size-3.5" />}
            {row.current ? "当前行动" : INITIATIVE_STATUS_LABELS[row.status] || row.status}
          </span>
        </article>
      ))}
    </div>
  );
}

/** Floating combat-round widget: initiative order + the player's own vitals.
 *  Desktop renders as a collapsible floating card; narrow screens get a
 *  collapsed edge tab that opens a right-side Sheet. Visibility follows the
 *  engine-owned session status: shown while active, and once concluded it
 *  stays as a dismissible outcome card (dismissal keyed by combat_id). */
export function CombatOverlay({ combat, state, investigatorId, campaignId }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const dismissKey = `${campaignId ?? ""}:${combat.combat_id ?? ""}`;
  const [dismissedKey, setDismissedKey] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_DISMISSED);
    } catch {
      return null;
    }
  });
  const concluded = combat.status === "concluded";
  if (concluded && dismissKey === dismissedKey) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(LS_DISMISSED, dismissKey);
    } catch {
      /* storage unavailable — session state still hides the card */
    }
    setDismissedKey(dismissKey);
  };
  const outcomeLabel = concluded
    ? OUTCOME_LABELS[combat.outcome ?? ""] ?? "战斗结束"
    : null;

  const header = (
    <header className="initiative-header">
      <div>
        <span className="initiative-kicker">
          <ListOrdered className="size-4" /> 战斗行动顺序
        </span>
        <h2>
          第 {combat.round} 轮
          <span className={cn("combat-phase", concluded && "is-concluded")}>
            {concluded ? `已脱战 · ${outcomeLabel}` : "战斗中"}
          </span>
        </h2>
      </div>
      <div className="flex items-center gap-1">
        <span className="initiative-rule">按 DEX 排序</span>
        {concluded ? (
          <button
            type="button"
            className="combat-icon-btn"
            onClick={dismiss}
            title="关闭战斗面板"
            aria-label="关闭战斗面板"
          >
            <X className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            className="combat-icon-btn combat-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "展开战斗面板" : "收起战斗面板"}
            aria-label={collapsed ? "展开战斗面板" : "收起战斗面板"}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        )}
      </div>
    </header>
  );

  return (
    <>
      {/* ≥ sm：桌面浮窗（xl 起左移避开常驻角色面板列） */}
      <section
        className={cn("combat-overlay initiative-board hidden sm:block", collapsed && "is-collapsed")}
        aria-label={`战斗行动顺序，第 ${combat.round} 轮`}
      >
        {header}
        {!collapsed && (
          <>
            <InitiativeRows combat={combat} />
            <SelfVitals state={state} investigatorId={investigatorId} />
            <p className="initiative-note">CoC 7版不另投先攻骰；行动顺序按 DEX 计算。</p>
          </>
        )}
      </section>

      {/* < sm：右侧边缘折叠 tab，点开右侧栏 */}
      <button
        type="button"
        className="combat-edge-tab"
        onClick={() => setSheetOpen(true)}
        aria-label={`打开战斗面板，第 ${combat.round} 轮`}
      >
        <Swords className="size-4" />
        <span>第 {combat.round} 轮</span>
      </button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-80 overflow-y-auto px-3 py-4 sm:hidden">
          <SheetTitle className="sr-only">战斗行动顺序</SheetTitle>
          <section className="initiative-board" aria-label={`战斗行动顺序，第 ${combat.round} 轮`}>
            {header}
            <InitiativeRows combat={combat} />
            <SelfVitals state={state} investigatorId={investigatorId} />
            <p className="initiative-note">CoC 7版不另投先攻骰；行动顺序按 DEX 计算。</p>
          </section>
        </SheetContent>
      </Sheet>
    </>
  );
}
