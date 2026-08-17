import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Brain, Crosshair, Dices, HeartPulse, KeyRound, Loader2, Pencil, Shield, Square, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { ModelMenu } from "./ModelMenu";
import { ThinkingMenu } from "./ThinkingMenu";
import { toolToStatus, trailToCurrentStatus } from "../toolStatus";
import type { ChatMessage, KeeperContentBlock, ModelsResponse, PendingChoice, PlayerIntent, RollDisplay, ToolStep } from "../types";

/** One-click default game offered on the waiting screen: preset starter +
 *  KP-guided investigator creation, straight into play. */
export interface QuickStartAction {
  /** Player-facing one-liner of what will be created (scenario · source). */
  hint: string;
  run: () => void;
}

interface Props {
  messages: ChatMessage[];
  toolSteps: ToolStep[];
  /** Live keeper-side thinking text (observer feed; may spoil module material). */
  kpThinking?: string;
  /** Live cumulative token usage for the running turn. */
  liveUsage?: { input: number | null; output: number | null } | null;
  busy: boolean;
  connected: boolean;
  /** Last bridge/session error; surfaced prominently when disconnected. */
  error?: string | null;
  pendingChoice?: PendingChoice | null;
  /** Player-facing current location / scene label from canonical state. */
  sceneLabel?: string | null;
  /** Shown mid-screen while waiting (not connected); null hides the button. */
  quickStart?: QuickStartAction | null;
  /** Investigator-less table: empty copy is character-setup, not first action. */
  setupPending?: boolean;
  /** Model readiness once the provider list has loaded (null = loading);
   * false swaps the quick-start button for a configure-models guide. */
  modelsReady?: boolean | null;
  /** Opens the in-app 编辑模型 overlay. */
  onConfigureModels?: () => void;
  onSend: (text: string, playerIntent?: PlayerIntent) => void;
  /** Abort the in-flight turn stream (the turn still settles server-side). */
  onStop: () => void;
  /** Composer toolbar pickers (live in App so the topbar and composer agree). */
  models: ModelsResponse | null;
  provider: string;
  model: string;
  hiddenProviders?: string[];
  thinking: string;
  thinkingLevels?: string[];
  onModelChange: (provider: string, model: string) => void;
  onThinkingChange: (level: string) => void;
}

/** Type out `text` character-by-character; restarts when `text` changes. */
function TypewriterLine({
  text,
  cps = 22,
  className,
}: {
  text: string;
  /** Characters per second. */
  cps?: number;
  className?: string;
}) {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setShown("");
    setDone(false);
    if (!text) return;
    let i = 0;
    const intervalMs = Math.max(16, Math.round(1000 / cps));
    const id = window.setInterval(() => {
      i += 1;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
        setDone(true);
      }
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [text, cps]);

  return (
    <span className={className}>
      {shown}
      {!done && <span className="cursor-blink text-primary">▍</span>}
    </span>
  );
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} 毫秒`;
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const s = totalSec >= 10 ? totalSec.toFixed(1) : totalSec.toFixed(2);
    return `${s.replace(/\.?0+$/, "")} 秒`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.round(totalSec - minutes * 60);
  return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`;
}

function formatTokens(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Live keeper-turn progress: ONE slim line — current step count, elapsed
 *  wall clock, written chars. The bubble's typewriter above carries what the
 *  keeper is doing right now; per-step feeds only produced 0s noise. */
function LiveProgress({
  steps,
  startedAt,
  text,
  usage,
}: {
  steps: ToolStep[];
  startedAt: number | null;
  text: string;
  usage?: { input: number | null; output: number | null } | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-1.5 pl-1 text-[11px] text-muted-foreground">
      <Loader2 className="size-3 animate-spin text-primary" />
      {steps.length > 0 && <span>第 {steps.length} 步</span>}
      {steps.length > 0 && startedAt != null && <span>·</span>}
      {startedAt != null && <span>已等待 {formatDuration(now - startedAt)}</span>}
      {text.length > 0 && (
        <>
          <span>·</span>
          <span>已写 {text.length} 字</span>
        </>
      )}
      {(usage?.input != null || usage?.output != null) && (
        <>
          <span>·</span>
          <span title="本回合守秘人模型的累计 token（输入 ↑ / 输出 ↓）">
            {usage?.input != null && `↑${formatTokens(usage.input)}`}
            {usage?.input != null && usage?.output != null && " "}
            {usage?.output != null && `↓${formatTokens(usage.output)}`}
          </span>
        </>
      )}
    </div>
  );
}

/** Keeper-side thinking feed: live-typed observer notes. This is NOT table
 *  narration — it can discuss hidden module material, so it stays visually
 *  separate with an explicit spoiler label. */
function ThinkingFeed({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <details
      open
      className="group rounded-2xl border border-dashed border-border bg-secondary/40 px-4 py-2.5"
    >
      <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground select-none">
        守秘人侧记（幕后思考，含剧透）
        <span className="ml-2 font-normal text-muted-foreground/60 group-open:hidden">
          · 点击展开
        </span>
      </summary>
      <div
        ref={ref}
        className="mt-2 max-h-44 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground"
      >
        {text}
        <span className="cursor-blink text-primary">▍</span>
      </div>
    </details>
  );
}

function MessageMeta({ msg }: { msg: ChatMessage }) {
  // While streaming, elapsed/chars live in the activity card below.
  if (msg.kind === "keeper" && msg.streaming) return null;
  const at = msg.at ?? msg.startedAt;
  const durationMs = msg.durationMs;
  if (at == null && durationMs == null) return null;
  return (
    <div
      className="flex items-center gap-1.5 text-[10px] tracking-[0.08em] text-muted-foreground/55"
      title={
        msg.kind === "keeper"
          ? "完成时刻 · 从你发送输入到本回合全部内容出完的总墙钟时间"
          : "你发送这条输入的时刻"
      }
    >
      {at != null && <span>{formatClock(at)}</span>}
      {durationMs != null && msg.kind === "keeper" && (
        <>
          {at != null && <span>·</span>}
          <span>回合用时 {formatDuration(durationMs)}</span>
        </>
      )}
      {msg.kind === "keeper" && msg.text.length > 0 && (
        <>
          {(at != null || durationMs != null) && <span>·</span>}
          <span>{msg.text.length} 字</span>
        </>
      )}
      {msg.kind === "keeper" && msg.usage && (msg.usage.input != null || msg.usage.output != null) && (
        <>
          <span>·</span>
          <span title="本回合守秘人模型的 token 用量（输入 ↑ / 输出 ↓）">
            {msg.usage.input != null && `↑${formatTokens(msg.usage.input)}`}
            {msg.usage.input != null && msg.usage.output != null && " "}
            {msg.usage.output != null && `↓${formatTokens(msg.usage.output)}`}
          </span>
        </>
      )}
    </div>
  );
}

interface RowProps {
  msg: ChatMessage;
  /** Only ever true for the last keeper message. */
  showStatus: boolean;
  statusLine: string;
}

const OUTCOME_LABELS: Record<string, string> = {
  critical: "大成功",
  critical_success: "大成功",
  extreme: "极难成功",
  extreme_success: "极难成功",
  hard: "困难成功",
  hard_success: "困难成功",
  regular: "成功",
  regular_success: "成功",
  success: "成功",
  failure: "失败",
  fumble: "大失败",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  regular: "普通",
  hard: "困难",
  extreme: "极难",
  critical: "大成功",
  opposed: "对抗",
  combined: "联合",
  sanity: "理智",
  damage: "伤害",
  reward: "奖励",
};

/** Settlement outcomes that arrive as machine enums on public roll records
 *  (backend damage/healing/SAN-reward settlements, combat hit results).
 *  Mapped at the display layer so receipts never leak raw enums; unknown
 *  values fall back to the original string. */
const SETTLEMENT_OUTCOME_LABELS: Record<string, string> = {
  damage_applied: "已结算",
  healing_applied: "恢复生命",
  reward_applied: "获得奖励",
  sanity_reward: "理智恢复",
  applied: "已生效",
  hit: "命中",
  hit_after_cover: "命中",
  miss: "落空",
};

/** Receipt titles for settlement rolls whose raw `skill` field is a backend
 *  code ("HP Damage") rather than a localized display name. */
const SETTLEMENT_TITLES: Record<string, string> = {
  damage_applied: "伤害结算",
  healing_applied: "治疗结算",
  sanity_reward: "理智恢复",
};

/** Display labels for raw roll subjects: characteristic codes and the known
 *  machine skill strings on settlement rolls. Unknown values render as-is. */
const ROLL_SUBJECT_LABELS: Record<string, string> = {
  STR: "力量",
  CON: "体质",
  SIZ: "体型",
  DEX: "敏捷",
  APP: "外貌",
  INT: "智力",
  POW: "意志",
  EDU: "教育",
  LUCK: "幸运",
  "HP Damage": "伤害",
  "HP Healing": "治疗",
  "SAN Reward": "理智",
};

const DEFENSE_LABELS: Record<string, string> = {
  dodge: "闪避",
  fight_back: "反击",
  dive_for_cover: "寻找掩护",
  maneuver: "战技反制",
  none: "无防御",
};

function combatDefenseIntent(
  choice: PendingChoice,
  action: string,
): PlayerIntent | undefined {
  if (choice.kind !== "combat_defense") return undefined;
  return {
    primary_intent: "combat",
    secondary_intents: [],
    target_entities: choice.attack_id ? [choice.attack_id] : [],
    risk_posture: "neutral",
    explicit_roll_request: false,
    player_hypothesis: null,
    action_atoms: [{
      kind: "combat_defense",
      action,
      ...(choice.choice_id ? { choice_id: choice.choice_id } : {}),
      ...(choice.command_id ? { command_id: choice.command_id } : {}),
      ...(choice.attack_id ? { attack_id: choice.attack_id } : {}),
      ...(choice.revision != null ? { revision: choice.revision } : {}),
    }],
    npc_interactions: [],
  };
}

function CombatDefenseChoices({
  choice,
  onChoose,
}: {
  choice: PendingChoice;
  onChoose: (action: string) => void;
}) {
  const context = choice.combat_context;
  if (!context) return null;

  const optionDetail = (action: string) => {
    if (action === "dodge") {
      return {
        Icon: Shield,
        posture: "稳妥",
        skill: `闪避 ${context.dodge_skill}`,
        tie: "同级成功时你胜出",
        effect: "避开这次伤害，但不会对敌人造成反击伤害。",
        tone: "safe",
      };
    }
    if (action === "fight_back") {
      return {
        Icon: Swords,
        posture: "冒险",
        skill: `格斗 ${context.fighting_skill}`,
        tie: "同级成功时攻击者胜出",
        effect: `胜出可立即反击，伤害 ${context.counter_damage}。`,
        tone: "risk",
      };
    }
    if (action === "dive_for_cover") {
      return {
        Icon: Crosshair,
        posture: "枪火应对",
        skill: `闪避 ${context.dodge_skill}`,
        tie: "这是寻找掩护检定，不与枪手直接对抗",
        effect: "成功后迫使攻击者带 1 枚惩罚骰重投；你将放弃下一次攻击。",
        tone: "safe",
      };
    }
    return {
      Icon: AlertTriangle,
      posture: "放弃防御",
      skill: "不进行防御检定",
      tie: "攻击成功即命中",
      effect: "只有在你明确选择承受这一击时使用。",
      tone: "risk",
    };
  };

  const incomingModifiers = [
    context.incoming_bonus_dice > 0
      ? `攻击者奖励骰 ${context.incoming_bonus_dice}`
      : null,
    context.incoming_penalty_dice > 0
      ? `攻击者惩罚骰 ${context.incoming_penalty_dice}`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="overflow-hidden rounded-2xl border border-primary/35 bg-card shadow-sm" aria-label="选择战斗防御">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/80 bg-primary/[0.035] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Shield className="size-4 text-primary" />
            敌人的攻击已经逼近
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {context.attack_kind === "firearm"
              ? "枪械攻击不能闪避或反击，只能寻找掩护。"
              : "选择更稳妥的闪避，或承担风险进行反击。"}
          </p>
        </div>
        {incomingModifiers && (
          <div className="rounded-full border border-warning/40 bg-warning-soft px-3 py-1 text-[11px] font-medium text-warning">
            当前来袭 · {incomingModifiers}
          </div>
        )}
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {(choice.options ?? []).map((opt) => {
          const detail = optionDetail(opt.action);
          const Icon = detail.Icon;
          const risky = detail.tone === "risk";
          return (
            <button
              key={opt.action}
              type="button"
              className={cn(
                "group flex min-h-36 flex-col rounded-xl border p-4 text-left transition-all",
                "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                risky
                  ? "border-destructive/40 bg-destructive-soft/60 hover:border-destructive/70"
                  : "border-info/40 bg-info-soft/60 hover:border-info/70",
              )}
              onClick={() => onChoose(opt.action)}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className={cn(
                    "grid size-8 place-items-center rounded-full border bg-background",
                    risky ? "border-destructive/30 text-destructive" : "border-info/30 text-info",
                  )}>
                    <Icon className="size-4" />
                  </span>
                  {DEFENSE_LABELS[opt.action] || opt.label || opt.action}
                </span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide",
                  risky ? "bg-destructive-soft text-destructive" : "bg-info-soft text-info",
                )}>
                  {detail.posture}
                </span>
              </div>
              <div className="mt-3 text-lg font-semibold text-foreground">{detail.skill}</div>
              <div className="mt-1 text-xs font-medium text-foreground/80">{detail.tie}</div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail.effect}</p>
            </button>
          );
        })}
      </div>
      <div className="border-t border-border/70 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {context.already_defended_this_round
          ? "围攻压力：你本轮已经防御过，当前攻击者因此获得 1 枚奖励骰。"
          : "完成这次应对后，本轮再有其他敌人攻击你时，攻击者将获得 1 枚奖励骰。"}
      </div>
    </section>
  );
}

const COMBAT_ROLE_LABELS: Record<string, string> = {
  attack: "攻击",
  defense: "防御",
  attack_reroll: "掩护重投",
  damage: "伤害",
};

const MODIFIER_LABELS: Record<string, string> = {
  point_blank: "近距离",
  cover: "目标有掩体",
  outnumbered_penalty: "以多打少",
  aimed: "瞄准",
  multi_shot: "连射",
  load_and_fire: "装填后射击",
  vs_prone_melee: "对倒地目标近战",
  vs_prone_ranged: "对倒地目标远程",
};

function rollTitle(roll: RollDisplay): string {
  if (roll.combat_role === "damage" || roll.damage_source === "fight_back") {
    return roll.damage_source === "fight_back" ? "反击伤害" : "伤害结算";
  }
  const settlementTitle = roll.outcome ? SETTLEMENT_TITLES[roll.outcome] : undefined;
  if (settlementTitle) return settlementTitle;
  if (roll.kind === "san_loss") return "理智损失";
  if (roll.kind === "dice_expression") return "结果骰";
  const rawSubject = roll.display_skill || roll.characteristic || roll.skill || "检定";
  const label = ROLL_SUBJECT_LABELS[rawSubject] || rawSubject;
  const checkLabel = label.endsWith("检定") ? label : `${label}检定`;
  if (roll.kind === "npc_first_impression") {
    return `初印象检定${roll.npc_display_name ? ` · ${roll.npc_display_name}` : ""}`;
  }
  return `${checkLabel}${roll.npc_display_name ? ` · ${roll.npc_display_name}` : ""}`;
}

function RollRoleIcon({ roll }: { roll: RollDisplay }) {
  if (roll.combat_role === "attack") return <Swords className="size-4" />;
  if (roll.combat_role === "attack_reroll") return <Crosshair className="size-4" />;
  if (roll.combat_role === "defense") return <Shield className="size-4" />;
  if (roll.combat_role === "damage" || roll.kind === "san_loss") return <HeartPulse className="size-4" />;
  return <Dices className="size-4" />;
}

function DiceReceipt({ text, roll, compact = false }: {
  text: string;
  roll?: RollDisplay | null;
  compact?: boolean;
}) {

  if (!roll) {
    return (
      <div className="dice-receipt" aria-label={text}>
        <div className="dice-receipt-icon"><Dices className="size-5" /></div>
        <div className="min-w-0 text-sm leading-relaxed text-foreground">{text}</div>
      </div>
    );
  }
  const target = roll.effective_target ?? roll.required_target ?? roll.target ?? roll.base_target;
  const hasOutcome = target != null || roll.passed != null || roll.success != null || Boolean(roll.outcome);
  const passed = rollPassed(roll);
  const outcome = hasOutcome ? rollOutcomeLabel(roll) : null;
  /** Settlement results (伤害生效 …) are neutral facts, not check levels —
   *  they render without the success/failure tint. */
  const isSettlement = !roll.achieved_level
    && Boolean(roll.outcome && roll.outcome in SETTLEMENT_OUTCOME_LABELS);
  const title = rollTitle(roll);
  const die = roll.damage_expression || roll.die || roll.die_expression || roll.expression || (target != null ? "1D100" : "骰点");
  const difficulty = DIFFICULTY_LABELS[roll.difficulty || roll.required_level || ""];
  const governingLabel = roll.governing_attribute === "app"
    ? "外貌"
    : roll.governing_attribute === "credit_rating"
      ? "信用评级"
      : roll.governing_attribute;
  const firstImpressionParams = roll.kind === "npc_first_impression"
    ? [
        roll.app != null ? `外貌 ${roll.app}` : null,
        roll.credit_rating != null ? `信用评级 ${roll.credit_rating}` : null,
        governingLabel && roll.governing_value != null
          ? `采用${governingLabel} ${roll.governing_value}`
          : null,
      ].filter(Boolean).join(" · ")
    : "";
  const combatBonus = typeof roll.attack_modifiers?.bonus === "number" ? roll.attack_modifiers.bonus : 0;
  const combatPenalty = typeof roll.attack_modifiers?.penalty === "number" ? roll.attack_modifiers.penalty : 0;
  const showAttackModifiers = !roll.combat_role || roll.combat_role === "attack" || roll.combat_role === "attack_reroll";
  const modifierParams = showAttackModifiers ? [
      (roll.bonus || combatBonus) ? `奖励骰 ${roll.bonus || combatBonus}` : null,
      (roll.penalty || combatPenalty) ? `惩罚骰 ${roll.penalty || combatPenalty}` : null,
    ].filter(Boolean).join(" · ") : "";
  const combatModifiers = showAttackModifiers ? Object.entries(roll.attack_modifiers || {})
    .filter(([key, value]) => Boolean(value) && key in MODIFIER_LABELS)
    .map(([key]) => MODIFIER_LABELS[key]) : [];
  const combatRole = roll.combat_role ? COMBAT_ROLE_LABELS[roll.combat_role] : null;
  const defense = roll.defense_kind ? DEFENSE_LABELS[roll.defense_kind] || roll.defense_kind : null;
  const sanParams = roll.san_before != null && roll.san_after != null
    ? `理智 ${roll.san_before} → ${roll.san_after}${roll.san_delta != null ? `（${roll.san_delta}）` : ""}`
    : "";
  const damageParams = roll.raw_damage != null
    ? [
        `原始伤害 ${roll.raw_damage}`,
        roll.armor_absorbed ? `护甲吸收 ${roll.armor_absorbed}` : null,
        roll.hp_before != null && roll.hp_after != null ? `生命 ${roll.hp_before} → ${roll.hp_after}` : null,
      ].filter(Boolean).join(" · ")
    : "";
  return (
    <div
      className={cn("dice-receipt", compact && "is-compact")}
      aria-label={text}
      data-result={hasOutcome ? (passed ? "success" : "failure") : "amount"}
    >
      <div className="dice-receipt-icon"><RollRoleIcon roll={roll} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
              <span>{title}</span>
              {combatRole && <span className="dice-role-chip">{combatRole}</span>}
              {defense && roll.combat_role !== "damage" && <span className="dice-role-chip is-defense">{defense}</span>}
            </div>
            <div className="text-[11px] tracking-wide text-muted-foreground">
              {die}{difficulty ? ` · ${difficulty}难度` : ""}{roll.pushed ? " · 推骰" : ""}
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold text-foreground">{roll.roll}</span>
            {target != null && <span className="text-sm text-muted-foreground">/ {target}</span>}
            {outcome && (
              <span
                className={cn(
                  "dice-outcome",
                  isSettlement ? "text-muted-foreground" : passed ? "is-success" : "is-failure",
                )}
              >
                {outcome}
              </span>
            )}
          </div>
        </div>
        {(firstImpressionParams || modifierParams || sanParams || damageParams || combatModifiers.length > 0) && (
          <div className="dice-parameters">
            {[firstImpressionParams, modifierParams, sanParams, damageParams, combatModifiers.join(" · ")]
              .filter(Boolean).join(" · ")}
          </div>
        )}
        {roll.die_rolls && roll.die_rolls.length > 1 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            骰面 {roll.die_rolls.join(" + ")}
          </div>
        )}
        <PercentileModifierBreakdown roll={roll} />
      </div>
    </div>
  );
}

function rollOutcomeLabel(roll: RollDisplay): string {
  const passed = rollPassed(roll);
  const key = roll.achieved_level || roll.outcome || (passed ? "success" : "failure");
  return OUTCOME_LABELS[key] || SETTLEMENT_OUTCOME_LABELS[key] || key;
}

function rollPassed(roll: RollDisplay): boolean {
  if (roll.passed != null) return roll.passed;
  if (roll.success != null) return roll.success;
  return !["failure", "fumble"].includes(roll.achieved_level || roll.outcome || "failure");
}

function SanityCheckReceipt({ check, loss }: { check: RollDisplay; loss?: RollDisplay }) {
  const passed = rollPassed(check);
  const target = check.target ?? check.effective_target ?? check.base_target;
  const before = check.san_before ?? loss?.san_before;
  const after = check.san_after ?? loss?.san_after;
  const amount = check.san_loss ?? (before != null && after != null ? before - after : loss?.roll);
  const lossExpression = check.san_loss_expression || loss?.die_expression || loss?.die || "—";
  return (
    <section className="san-receipt" aria-label="理智检定" data-result={passed ? "success" : "failure"}>
      <header className="san-header">
        <span><Brain className="size-4" /> 理智检定</span>
        <b>{passed ? "意志守住了裂隙" : "理智受到冲击"}</b>
      </header>
      <div className="san-body">
        <div className="san-check-result">
          <span className="san-die"><small>1D100</small><b>{check.roll}</b></span>
          <span className="san-target"><small>当前 SAN</small><b>{target ?? before ?? "—"}</b></span>
          <span className={cn("san-outcome", passed ? "is-success" : "is-failure")}>
            {rollOutcomeLabel(check)}
          </span>
        </div>
        <div className="san-loss-panel">
          <span><small>损失规则</small><b>{lossExpression}</b></span>
          <span><small>本次损失</small><b>{amount != null ? `−${amount}` : "—"}</b></span>
          <span className="san-meter"><small>理智变化</small><b>{before ?? "—"} <i>→</i> {after ?? "—"}</b></span>
        </div>
      </div>
      {check.source && <p className="san-source">触发：{check.source}</p>}
    </section>
  );
}

function percentileValue(tens: number, units: number): number {
  const value = (tens < 10 ? tens * 10 : tens) + units;
  return value === 0 ? 100 : value;
}

function PercentileModifierBreakdown({ roll }: { roll: RollDisplay }) {
  if (!roll.tens_values || roll.tens_values.length < 2 || roll.units == null) return null;
  const bonus = roll.bonus ?? 0;
  const penalty = roll.penalty ?? 0;
  const candidates = roll.tens_values.map((tens) => percentileValue(tens, roll.units!));
  const modifierLabel = bonus > 0 ? `奖励骰 ×${bonus}` : penalty > 0 ? `惩罚骰 ×${penalty}` : "额外十位骰";
  const ruleLabel = bonus > 0 ? "取较低结果" : penalty > 0 ? "取较高结果" : "按规则采用结果";

  return (
    <div className="percentile-breakdown" aria-label={`${modifierLabel}，${ruleLabel}`}>
      <div className="percentile-breakdown-head">
        <span className={cn("modifier-chip", penalty > 0 && "is-penalty")}>{modifierLabel}</span>
        <span>{ruleLabel}</span>
      </div>
      <div className="percentile-dice-row">
        {roll.tens_values.map((tens, index) => (
          <span className="percentile-die" key={`${tens}:${index}`}>
            <small>十位骰{index + 1}</small>
            <strong>{String(tens < 10 ? tens * 10 : tens).padStart(2, "0")}</strong>
          </span>
        ))}
        <span className="percentile-die is-units">
          <small>个位骰</small>
          <strong>{roll.units}</strong>
        </span>
      </div>
      <div className="percentile-candidates">
        {candidates.map((candidate, index) => (
          <span className={cn("percentile-candidate", candidate === roll.roll && "is-selected")} key={`${candidate}:${index}`}>
            {candidate}{candidate === roll.roll && <b>采用</b>}
          </span>
        ))}
      </div>
    </div>
  );
}

function CombatRollSide({ roll, side }: { roll: RollDisplay; side: "attack" | "defense" }) {
  const target = roll.effective_target ?? roll.required_target ?? roll.target ?? roll.base_target;
  const passed = roll.passed ?? roll.success ?? false;
  const rawSkill = roll.display_skill || roll.characteristic || roll.skill;
  const skill = (rawSkill && (ROLL_SUBJECT_LABELS[rawSkill] || rawSkill))
    || (side === "attack" ? "攻击检定" : "防御检定");
  const defense = side === "defense" && roll.defense_kind
    ? DEFENSE_LABELS[roll.defense_kind] || roll.defense_kind
    : null;
  return (
    <article className={cn("opposed-side", side === "attack" ? "is-attack" : "is-defense")}>
      <div className="opposed-side-head">
        <span className="opposed-side-role">
          {side === "attack" ? <Swords className="size-4" /> : <Shield className="size-4" />}
          {side === "attack" ? "攻击方" : "防守方"}
        </span>
        {defense && <span className="dice-role-chip is-defense">{defense}</span>}
      </div>
      <div className="opposed-skill">{skill}</div>
      <div className="opposed-result">
        <span className="font-display">{roll.roll}</span>
        {target != null && <small>/ {target}</small>}
      </div>
      <div className={cn("opposed-level", passed ? "is-success" : "is-failure")}>
        {rollOutcomeLabel(roll)}
      </div>
      <PercentileModifierBreakdown roll={roll} />
    </article>
  );
}

function opposedWinner(outcome?: string | null): "attack" | "defense" | "none" {
  if (["attacker_higher", "tie_attacker_wins", "attacker_wins"].includes(outcome || "")) return "attack";
  if (["defender_higher", "tie_defender_wins", "defender_wins"].includes(outcome || "")) return "defense";
  return "none";
}

function opposedVerdict(attack: RollDisplay, defense: RollDisplay): string {
  const outcome = attack.opposed_outcome || defense.opposed_outcome;
  const attackLevel = rollOutcomeLabel(attack);
  const defenseLevel = rollOutcomeLabel(defense);
  if (outcome === "tie_defender_wins") {
    return `双方同为${attackLevel}；闪避同级时防守方胜出，因此攻击落空。`;
  }
  if (outcome === "tie_attacker_wins") {
    return `双方同为${attackLevel}；反击同级时攻击方胜出，因此攻击命中。`;
  }
  if (outcome === "attacker_higher" || outcome === "attacker_wins") {
    return `攻击方${attackLevel}高于防守方${defenseLevel}，因此攻击方胜出。`;
  }
  if (outcome === "defender_higher" || outcome === "defender_wins") {
    const effect = attack.defense_kind === "fight_back" ? "并可造成反击伤害" : "因此避开攻击";
    return `防守方${defenseLevel}高于攻击方${attackLevel}，${effect}。`;
  }
  if (outcome === "both_fail") return "双方检定均失败，攻击没有命中。";
  return `攻击方${attackLevel}；防守方${defenseLevel}。`;
}

function CombatOpposedReceipt({ attack, defense }: { attack: RollDisplay; defense: RollDisplay }) {
  const defenseKind = attack.defense_kind || defense.defense_kind || "dodge";
  const winner = opposedWinner(attack.opposed_outcome || defense.opposed_outcome);
  const title = `近战对抗 · ${DEFENSE_LABELS[defenseKind] || defenseKind}`;
  const resultLabel = winner === "attack" ? "攻击方胜出" : winner === "defense" ? "防守方胜出" : "攻击落空";
  return (
    <section className="combat-opposed" aria-label={title} data-winner={winner}>
      <header className="combat-opposed-header">
        <span><Swords className="size-4" /> {title}</span>
        <b>{resultLabel}</b>
      </header>
      <div className="combat-opposed-body">
        <CombatRollSide roll={attack} side="attack" />
        <div className="opposed-vs" aria-hidden="true">VS</div>
        <CombatRollSide roll={defense} side="defense" />
      </div>
      <div className="combat-verdict">
        <span>判定</span>
        <p>{opposedVerdict(attack, defense)}</p>
      </div>
    </section>
  );
}

function DiceReceiptGroup({ text, rolls }: { text: string; rolls: RollDisplay[] }) {
  if (!rolls.length) return <DiceReceipt text={text} />;
  const sanity = rolls.find((roll) => roll.kind === "sanity_check");
  if (sanity) {
    const sanLoss = rolls.find((roll) => roll.kind === "san_loss");
    const remaining = rolls.filter((roll) => roll !== sanity && roll !== sanLoss);
    return (
      <div className="san-resolution-stack">
        <SanityCheckReceipt check={sanity} loss={sanLoss} />
        {remaining.length > 0 && <DiceReceiptGroup text={text} rolls={remaining} />}
      </div>
    );
  }
  const attack = rolls.find((roll) => roll.combat_role === "attack");
  const defense = rolls.find((roll) => roll.combat_role === "defense");
  const isMeleeOpposed = Boolean(
    attack && defense && (attack.defense_kind || defense.defense_kind) !== "dive_for_cover",
  );
  if (attack && defense && isMeleeOpposed) {
    const remaining = rolls.filter((roll) => roll !== attack && roll !== defense);
    return (
      <div className="combat-resolution-stack">
        <CombatOpposedReceipt attack={attack} defense={defense} />
        {remaining.map((roll, index) => (
          <DiceReceipt key={roll.roll_id || index} text={text} roll={roll} compact />
        ))}
      </div>
    );
  }
  return (
    <section className="dice-receipt-group" aria-label="公开结算">
      <header className="dice-group-header">
        <span><Dices className="size-4" /> 公开结算</span>
        <span>{rolls.length} 项</span>
      </header>
      <div className="dice-group-rows">
        {rolls.map((roll, index) => (
          <DiceReceipt key={roll.roll_id || index} text={text} roll={roll} compact />
        ))}
      </div>
    </section>
  );
}

function rollsFromBlock(block: KeeperContentBlock): RollDisplay[] {
  if (block.type === "roll_group") return block.rolls;
  if (block.type === "roll" && block.roll) return [block.roll];
  return [];
}

/** Combat attack and response are often separated by one causal prose beat in
 * the authoritative finalization. Pair them at the response position so each
 * public roll stays visible exactly once while the opposed result reads as one
 * settlement. */
function KeeperContentBlocks({ blocks }: { blocks: KeeperContentBlock[] }) {
  const attackByDefenseIndex = new Map<number, RollDisplay>();
  const pairedAttackIds = new Set<string>();
  const availableAttacks: RollDisplay[] = [];

  blocks.forEach((block, index) => {
    const rolls = rollsFromBlock(block);
    for (const roll of rolls) {
      if (roll.combat_role === "attack") availableAttacks.push(roll);
    }
    const defense = rolls.find((roll) => roll.combat_role === "defense");
    if (!defense) return;
    if (rolls.some((roll) => roll.combat_role === "attack")) return;
    const attack = [...availableAttacks].reverse().find((candidate) => {
      if (pairedAttackIds.has(candidate.roll_id)) return false;
      const defenseKind = candidate.defense_kind || defense.defense_kind;
      return defenseKind !== "dive_for_cover" && Boolean(candidate.opposed_outcome || defense.opposed_outcome);
    });
    if (attack) {
      attackByDefenseIndex.set(index, attack);
      pairedAttackIds.add(attack.roll_id);
    }
  });

  return blocks.map((block, index) => {
    const rolls = rollsFromBlock(block);
    const externalAttack = attackByDefenseIndex.get(index);
    if (externalAttack) {
      const defense = rolls.find((roll) => roll.combat_role === "defense")!;
      const remaining = rolls.filter((roll) => roll !== defense);
      return (
        <div className="combat-resolution-stack" key={`combat-pair:${externalAttack.roll_id}:${defense.roll_id}`}>
          <CombatOpposedReceipt attack={externalAttack} defense={defense} />
          {remaining.map((roll, rollIndex) => (
            <DiceReceipt key={roll.roll_id || rollIndex} text={block.text} roll={roll} compact />
          ))}
        </div>
      );
    }

    if (pairedAttackIds.size && rolls.some((roll) => pairedAttackIds.has(roll.roll_id))) {
      const remaining = rolls.filter((roll) => !pairedAttackIds.has(roll.roll_id));
      if (!remaining.length) return null;
      return <DiceReceiptGroup key={`remaining:${index}`} text={block.text} rolls={remaining} />;
    }

    if (block.type === "roll_group") {
      return <DiceReceiptGroup key={`roll-group:${block.source_ids.join(":")}:${index}`} text={block.text} rolls={block.rolls} />;
    }
    if (block.type === "roll") {
      return <DiceReceipt key={`roll:${block.source_ids.join(":")}:${index}`} text={block.text} roll={block.roll} />;
    }
    return <Markdown key={`prose:${index}`} text={block.text} />;
  });
}

/** One message row. Memoized: past rows keep stable object identity and get
 *  constant status props, so only the actively-mutating last row re-renders
 *  during a stream. */
const MessageRow = memo(function MessageRow({
  msg,
  showStatus,
  statusLine,
}: RowProps) {
  if (msg.kind === "player") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="max-w-[75%] rounded-xl border border-border bg-player-note px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground shadow-[0_1px_2px_rgb(var(--paper-ink)/0.06),0_6px_16px_rgb(var(--paper-ink)/0.04)]">
          {msg.text}
        </div>
        <MessageMeta msg={msg} />
      </div>
    );
  }
  if (msg.kind === "note") {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div
          className={cn(
            "max-w-[85%] rounded-full border px-4 py-1.5 text-center text-xs",
            msg.tone === "error"
              ? "border-destructive/40 bg-destructive-soft text-destructive"
              : "border-border bg-secondary text-muted-foreground",
          )}
        >
          {msg.text}
        </div>
        <MessageMeta msg={msg} />
      </div>
    );
  }
  return (
    <div className="min-w-0 max-w-none flex-1">
      {msg.interimText && (
        <details className="mb-1.5">
          <summary className="cursor-pointer text-[11px] text-muted-foreground/70 select-none">
            回合过程
          </summary>
          <div className="mt-1 text-xs leading-5 whitespace-pre-wrap text-muted-foreground/80">
            {msg.interimText}
          </div>
        </details>
      )}
      <div className="keeper-message text-[15px] leading-7 text-foreground">
          {msg.text ? (
            msg.streaming ? (
              /* Streaming: render plain text + cursor; Markdown mounts only
                 once the turn settles (no per-token markdown re-parse). */
              <span className="whitespace-pre-wrap">
                {msg.text}
                <span className="cursor-blink text-primary">▍</span>
              </span>
            ) : msg.contentBlocks?.length ? (
              <div className="flex flex-col gap-4">
                <KeeperContentBlocks blocks={msg.contentBlocks} />
              </div>
            ) : (
              <Markdown text={msg.text} />
            )
          ) : (
            <TypewriterLine
              text={showStatus ? statusLine : "守秘人正在主持这场遭遇…"}
              className="text-muted-foreground"
              cps={20}
            />
          )}
      </div>
      <div className="mt-1.5">
        <MessageMeta msg={msg} />
      </div>
    </div>
  );
});

export function Chat({
  messages,
  toolSteps,
  kpThinking = "",
  liveUsage = null,
  busy,
  connected,
  error,
  pendingChoice,
  sceneLabel,
  quickStart = null,
  setupPending = false,
  modelsReady = null,
  onConfigureModels,
  onSend,
  onStop,
  models,
  provider,
  model,
  hiddenProviders,
  thinking,
  thinkingLevels,
  onModelChange,
  onThinkingChange,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Auto-scroll only while the reader is near the bottom. */
  const nearBottomRef = useRef(true);
  /** Drives the 「回到底部」 jump button; mirrors nearBottomRef as state. */
  const [atBottom, setAtBottom] = useState(true);
  const toolTrail = useMemo(() => toolSteps.map((s) => s.label), [toolSteps]);
  const statusLine = trailToCurrentStatus(toolTrail);
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    nearBottomRef.current = near;
    setAtBottom(near);
  };
  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nearBottomRef.current) return;
    const lastMsg = messages[messages.length - 1];
    const streaming =
      busy || (lastMsg?.kind === "keeper" && lastMsg.streaming === true);
    // Instant while streaming (smooth fights the token drip); smooth otherwise.
    el.scrollTo({ top: el.scrollHeight, behavior: streaming ? "auto" : "smooth" });
  }, [messages, toolTrail, statusLine, busy]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || !connected) return;
    setDraft("");
    nearBottomRef.current = true;
    onSend(text);
  };

  const choices = pendingChoice?.options ?? [];

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto"
        >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-10">
          {connected && sceneLabel && (
            <div className="scene-heading text-center">
              <h1 className="font-display text-3xl font-semibold tracking-wide text-foreground">
                {sceneLabel}
              </h1>
              <div className="scene-rule" aria-hidden="true">
                <KeyRound className="size-3.5 text-brass" />
              </div>
            </div>
          )}
          {!connected && (
            <div className="flex flex-col items-center gap-3 px-4 pt-20 text-center">
              {error ? (
                <>
                  <h1 className="font-display text-2xl font-semibold text-foreground">
                    无法进入该战役
                  </h1>
                  <div className="max-w-xl whitespace-pre-wrap break-words rounded-xl border border-destructive/40 bg-destructive-soft px-4 py-3 text-left text-sm text-destructive">
                    {error}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    请换一场战役，或从左侧「＋ 新战役」重新开局。
                  </p>
                </>
              ) : (
                <>
                  <span className="keeper-empty-mark" aria-hidden="true" />
                  <h1 className="font-display text-3xl font-semibold text-foreground">
                    守秘人正在候场
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    从左侧选择一场战役，或创建新战役开始游戏。
                  </p>
                  {modelsReady === false ? (
                    <div className="mt-5 flex max-w-md flex-col items-center gap-2 rounded-2xl border border-warning/40 bg-warning-soft px-6 py-4 text-center">
                      <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                        <AlertTriangle className="size-4 shrink-0" />
                        尚未配置 AI 模型
                      </div>
                      <p className="text-xs leading-relaxed text-warning">
                        需要先配置一个模型提供方（API Key
                        或订阅账户登录），守秘人才能主持游戏。
                      </p>
                      {onConfigureModels ? (
                        <Button
                          size="sm"
                          className="mt-1"
                          onClick={onConfigureModels}
                        >
                          打开设置 · 加入模型
                        </Button>
                      ) : (
                        <p className="text-xs leading-relaxed text-warning/80">
                          请先点顶栏铅笔图标，登录或填入模型提供方。
                        </p>
                      )}
                    </div>
                  ) : (
                    quickStart && (
                      <button
                        type="button"
                        onClick={quickStart.run}
                        disabled={busy}
                        className={cn(
                          "group mt-5 flex flex-col items-center gap-1.5 rounded-2xl border border-primary/40 bg-primary/5 px-8 py-4 text-center",
                          "transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md",
                          "disabled:pointer-events-none disabled:opacity-60",
                        )}
                      >
                        <span className="flex items-center gap-2 text-base font-semibold text-foreground">
                          {busy ? (
                            <Loader2 className="size-4 animate-spin text-primary" />
                          ) : (
                            <Dices className="size-4 text-primary transition-transform group-hover:rotate-12" />
                          )}
                          {busy ? "开局中…" : "开一局游戏"}
                        </span>
                        <span className="max-w-md text-xs leading-relaxed text-muted-foreground">
                          {quickStart.hint}
                        </span>
                      </button>
                    )
                  )}
                  <p className="text-xs text-muted-foreground/70">
                    这是 pi-coc 的桌面。KP 与 TUI 是同一个宿主。
                  </p>
                </>
              )}
            </div>
          )}
          {connected && messages.length === 0 && !busy && (
            <div className="flex flex-col items-center gap-2 px-4 pt-20 text-center">
              {setupPending ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    守秘人正在打开建卡引导。
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    开局后由 KP 按 coc-character 逐步创建调查员，无需先填表。
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    这场战役还没有公开的对话记录。
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    在下方输入你的第一个行动，例如「我走向那栋房子，打量周围」。
                  </p>
                </>
              )}
            </div>
          )}

          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1;
            const showStatus = Boolean(
              isLast && msg.kind === "keeper" && msg.streaming && !msg.text,
            );
            // Stable composite key: kind + timing fields + position tiebreaker
            // (messages only ever append, so position is stable per message).
            const key = `${msg.kind}:${msg.at ?? "x"}:${msg.startedAt ?? "x"}:${i}`;
            return (
              <MessageRow
                key={key}
                msg={msg}
                showStatus={showStatus}
                /* Constant props for settled rows — only the live row may
                   carry churning status values. */
                statusLine={showStatus ? statusLine : ""}
              />
            );
          })}

          {connected && busy && (() => {
            const last = messages[messages.length - 1];
            if (!last || last.kind !== "keeper" || !last.streaming) return null;
            return (
              <LiveProgress
                steps={toolSteps}
                startedAt={last.startedAt ?? null}
                text={last.text}
                usage={liveUsage}
              />
            );
          })()}

          {connected && busy && kpThinking.length > 0 && (
            <ThinkingFeed text={kpThinking} />
          )}

          {connected && !busy && choices.length > 0 && (
            pendingChoice?.kind === "combat_defense" && pendingChoice.combat_context ? (
              <CombatDefenseChoices
                choice={pendingChoice}
                onChoose={(action) => onSend(
                  DEFENSE_LABELS[action] || action,
                  combatDefenseIntent(pendingChoice, action),
                )}
              />
            ) : (
              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
                {pendingChoice?.prompt && (
                  <div className="text-xs font-medium text-muted-foreground">
                    {pendingChoice.prompt}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {choices.map((opt, i) => (
                    <Button
                      key={i}
                      size="sm"
                      variant="outline"
                      className="h-auto rounded-full whitespace-normal py-1.5 text-xs"
                      onClick={() => onSend(opt.label || opt.action)}
                    >
                      {opt.label || opt.action}
                    </Button>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
        </div>
        {!atBottom && (
          <button
            type="button"
            className="jump-bottom"
            onClick={jumpToBottom}
            aria-label="回到底部"
          >
            <ArrowDown className="size-3.5" /> 回到底部
          </button>
        )}
      </div>

      <div className="border-t border-border bg-background/88 backdrop-blur">
        <div className="mx-auto w-full max-w-4xl px-4 py-3 md:px-10">
          <div className="rounded-2xl border border-border/90 bg-card shadow-[0_2px_10px_rgb(var(--paper-ink)/0.05),0_12px_32px_rgb(var(--paper-ink)/0.04)] transition-[border-color,box-shadow] focus-within:border-primary/45 focus-within:shadow-[0_2px_10px_rgb(var(--paper-ink)/0.06),0_0_0_3px_color-mix(in_oklab,var(--primary)_12%,transparent)]">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                !connected
                  ? "先选择一场战役"
                  : setupPending
                    ? "回答守秘人的建卡问题…"
                    : "描述你的行动…"
              }
              disabled={!connected || busy}
              rows={2}
              className="min-h-12 resize-none rounded-none border-0 bg-transparent px-3.5 pt-3 pb-1 shadow-none transition-colors focus-visible:ring-0"
            />
            <div className="flex items-center gap-1 px-2 pt-1 pb-2">
              <ModelMenu
                variant="composer"
                models={models}
                provider={provider}
                model={model}
                disabled={busy}
                hidden={hiddenProviders}
                onChange={onModelChange}
              />
              {onConfigureModels && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={onConfigureModels}
                  title="编辑模型"
                >
                  <Pencil className="size-3.5" />
                </Button>
              )}
              <ThinkingMenu
                variant="composer"
                thinking={thinking}
                levels={thinkingLevels}
                disabled={busy}
                onChange={onThinkingChange}
              />
              <span className="ml-1 hidden text-[10px] tracking-wide text-muted-foreground/70 select-none md:inline">
                Enter 发送 · Shift+Enter 换行
              </span>
              {busy ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-8 shrink-0 rounded-full border border-border/80 text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive-soft hover:text-destructive"
                  onClick={onStop}
                  disabled={!connected}
                  title="停止本回合"
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="ml-auto size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:border disabled:border-border/70 disabled:bg-secondary disabled:text-muted-foreground disabled:shadow-none"
                  onClick={submit}
                  disabled={!connected || !draft.trim()}
                  title="发送（Enter）"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
