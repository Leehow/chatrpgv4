import { useMemo, useState } from "react";
import { ChevronLeft, Dices, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GameState } from "../types";

// Immersive step-by-step character creator (chatrpg-style): one decision per
// screen, everything delegable to the KP, and a deterministic structured
// submission at the end — so the keeper executes (dice, budgets, create,
// link, opening) instead of interrogating the player through a wall of
// questions. The free-form chat path stays available as an escape hatch.

const ATTRS = [
  { key: "STR", label: "力量" },
  { key: "CON", label: "体质" },
  { key: "SIZ", label: "体型" },
  { key: "DEX", label: "敏捷" },
  { key: "APP", label: "外貌" },
  { key: "INT", label: "智力" },
  { key: "POW", label: "意志" },
  { key: "EDU", label: "教育" },
] as const;

type AttrKey = (typeof ATTRS)[number]["key"];

const METHODS = [
  {
    id: "rolled_in_order",
    label: "按序掷骰",
    desc: "KP 当众掷出八项属性，快，听天由命",
    requiresRolls: true,
  },
  {
    id: "rolled_pool_assignment",
    label: "掷骰后分配",
    desc: "KP 掷出八枚数值，你来排兵布阵",
    requiresRolls: true,
  },
  {
    id: "point_buy_460",
    label: "点数购买",
    desc: "460 点自由分配（15–90，每 5 点一档）",
    requiresRolls: false,
  },
  {
    id: "quick_fire_array",
    label: "快速阵列",
    desc: "预设 80/70/60/60/50/50/50/40 八值，你来分配",
    requiresRolls: false,
  },
] as const;

const QUICK_FIRE_VALUES = [80, 70, 60, 60, 50, 50, 50, 40];
const POINT_BUY_BUDGET = 460;

const QUICK_FIRE_PRESETS: Array<{ label: string; assign: Record<AttrKey, number> }> = [
  {
    label: "调查型（意志/智力优先）",
    assign: { POW: 80, INT: 70, EDU: 60, DEX: 60, CON: 60, APP: 50, STR: 50, SIZ: 40 },
  },
  {
    label: "行动型（力量/敏捷优先）",
    assign: { STR: 80, DEX: 70, CON: 60, SIZ: 60, POW: 50, APP: 50, INT: 50, EDU: 40 },
  },
  {
    label: "社交型（外貌/教育优先）",
    assign: { APP: 80, EDU: 70, POW: 60, INT: 60, DEX: 50, CON: 50, STR: 50, SIZ: 40 },
  },
];

const OCCUPATION_CHIPS = [
  "记者",
  "私家侦探",
  "医生",
  "学者",
  "教授",
  "律师",
  "艺术家",
  "警察",
  "图书管理员",
];

const SKILL_CHIPS = [
  "侦查",
  "图书馆使用",
  "聆听",
  "心理学",
  "说服",
  "急救",
  "闪避",
  "射击",
  "潜行",
  "汽车驾驶",
];

const BACKSTORY_CHIPS = [
  "信念：",
  "重要之人：",
  "意义之地：",
  "特质：",
  "伤口：",
  "恐惧：",
];

interface Props {
  campaignTitle: string;
  era: string;
  state: GameState | null;
  busy: boolean;
  /** Structured submission: the keeper only executes from here. */
  onFinish: (structuredText: string) => void;
  /** Fall back to the free-form KP-guided chat flow. */
  onFreeChat: () => void;
  onClose: () => void;
}

export function CharCreatorWizard({
  campaignTitle,
  era,
  state,
  busy,
  onFinish,
  onFreeChat,
  onClose,
}: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [occupation, setOccupation] = useState("");
  const [method, setMethod] = useState<string | null>(null);
  const [quickFire, setQuickFire] = useState<Partial<Record<AttrKey, number>>>({});
  const [pointBuy, setPointBuy] = useState<Record<AttrKey, number>>(
    () => ({ STR: 60, CON: 60, SIZ: 60, DEX: 60, APP: 60, INT: 60, POW: 50, EDU: 50 }) as Record<AttrKey, number>,
  );
  const [skills, setSkills] = useState<string[]>([]);
  const [skillsExtra, setSkillsExtra] = useState("");
  const [backstory, setBackstory] = useState("");

  const pointSpent = useMemo(
    () => ATTRS.reduce((sum, a) => sum + (pointBuy[a.key] ?? 0), 0),
    [pointBuy],
  );
  const pointRemaining = POINT_BUY_BUDGET - pointSpent;
  const quickFireComplete =
    ATTRS.every((a) => typeof quickFire[a.key] === "number") &&
    Object.values(quickFire).filter((v) => typeof v === "number").length === 8;
  const knownINT =
    method === "quick_fire_array"
      ? quickFire.INT
      : method === "point_buy_460"
        ? pointBuy.INT
        : undefined;

  const sceneLabel = state?.active_scene_label || "";
  const timeLabel = state?.time?.display || "";

  const methodNeedsConfig =
    method === "quick_fire_array" ? !quickFireComplete : method === "point_buy_460" ? pointRemaining !== 0 : false;

  const totalSteps = 5; // 0 prologue · 1 concept · 2 method · 3 skills · 4 backstory+preview

  const buildSubmission = () => {
    const lines: string[] = ["【建卡构想提交】"];
    const identity: string[] = [];
    if (name.trim()) identity.push(`姓名：${name.trim()}`);
    if (age.trim()) identity.push(`年龄：${age.trim()}`);
    if (occupation.trim()) identity.push(`职业：${occupation.trim()}`);
    lines.push(
      identity.length
        ? identity.join("；") + "。"
        : "姓名、年龄与职业请按我的概念自行拟定。",
    );
    const chosen = METHODS.find((m) => m.id === method);
    if (chosen) {
      let line = `属性生成方式：${chosen.id}（${chosen.label}）`;
      if (method === "quick_fire_array" && quickFireComplete) {
        line +=
          "，分配：" + ATTRS.map((a) => `${a.key}${quickFire[a.key]}`).join(" ");
      } else if (method === "point_buy_460" && pointRemaining === 0) {
        line +=
          "，分配：" + ATTRS.map((a) => `${a.key}${pointBuy[a.key]}`).join(" ");
      } else {
        line += "（数值按该方式规则由你当众产生）";
      }
      lines.push(line + "。");
    } else {
      lines.push("属性生成方式由你推荐并说明。");
    }
    const wanted = [...skills, ...skillsExtra.split(/[，,、\s]+/).filter(Boolean)];
    const budgetHint =
      typeof knownINT === "number"
        ? `个人兴趣点预算 = INT ${knownINT}×2 = ${knownINT * 2}`
        : "个人兴趣点预算 = INT×2（按你的掷骰/分配结果计算）";
    lines.push(
      wanted.length
        ? `技能倾向：${wanted.join("、")}（${budgetHint}；职业点按职业公式；请按倾向代为分配，起始上限 75）。`
        : `技能分配由你按职业与调查方向决定（${budgetHint}）。`,
    );
    lines.push(
      backstory.trim()
        ? `背景要点：${backstory.trim()}`
        : "背景（信念、重要之人、意义之地、特质、伤口、恐惧）请按概念自行补全。",
    );
    lines.push(
      "请按规则集 skill「coc-character」执行：幸运掷 3D6；创建正式调查员并 campaign.link_investigator 挂到本战役（替换建卡草稿壳）；随后直接开始开场剧情。全程使用简体中文。",
    );
    return lines.join("\n");
  };

  const toggle = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((s) => s !== item) : [...list, item]);
  };

  const canNext =
    step === 2 ? Boolean(method) && !methodNeedsConfig : true;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            上一步
          </button>
        )}
        <p className="text-xs font-medium tracking-[0.25em] text-primary uppercase">
          Character Creation · {Math.min(step + 1, totalSteps)}/{totalSteps}
        </p>

        {/* 0 · 序章 */}
        {step === 0 && (
          <>
            <h1 className="font-display mt-2 text-3xl font-semibold text-foreground">
              塑造你的调查员
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              《{campaignTitle || "未名战役"}》
              {era ? ` · ${era}` : ""}
              {sceneLabel ? ` · ${sceneLabel}` : ""}
              {timeLabel ? ` · ${timeLabel}` : ""}。
              接下来几步，一步步回答即可——每一项都可以留空交给守秘人（KP）拿主意。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => setStep(1)}>
                <Sparkles className="size-4" />
                开始塑造
              </Button>
              <Button size="lg" variant="ghost" onClick={onFreeChat} disabled={busy}>
                <Dices className="size-4" />
                让 KP 聊着引导我
              </Button>
              <Button size="lg" variant="ghost" onClick={onClose} disabled={busy}>
                先看看战役
              </Button>
            </div>
          </>
        )}

        {/* 1 · 概念 */}
        {step === 1 && (
          <>
            <h1 className="font-display mt-2 text-2xl font-semibold text-foreground">
              这是谁？
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              姓名与职业可以先起个头，也可以完全交给 KP。
            </p>
            <div className="mt-6 space-y-4">
              <Field label="姓名">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：顾远（可留空）"
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </Field>
              <Field label="年龄">
                <input
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  placeholder="如：32（可留空）"
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </Field>
              <Field label="职业">
                <input
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  placeholder="如：记者（可留空）"
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {OCCUPATION_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setOccupation(chip)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        occupation === chip
                          ? "border-primary/60 bg-primary/5 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40",
                      )}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <StepActions onNext={() => setStep(2)} nextDisabled={!canNext} />
          </>
        )}

        {/* 2 · 属性方式 + 分配 */}
        {step === 2 && (
          <>
            <h1 className="font-display mt-2 text-2xl font-semibold text-foreground">
              属性怎么来？
            </h1>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setMethod(m.id);
                    if (m.id === "quick_fire_array") setQuickFire({});
                  }}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left transition-colors",
                    method === m.id
                      ? "border-primary/60 bg-primary/5"
                      : "border-border bg-card hover:border-primary/40",
                  )}
                >
                  <span className="block text-sm font-medium text-foreground">{m.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {m.desc}
                  </span>
                </button>
              ))}
            </div>

            {method === "quick_fire_array" && (
              <QuickFireAssign
                values={quickFire}
                onChange={setQuickFire}
                onComplete={quickFireComplete}
              />
            )}
            {method === "point_buy_460" && (
              <PointBuyAssign
                values={pointBuy}
                onChange={setPointBuy}
                remaining={pointRemaining}
              />
            )}
            {method && methodNeedsConfig && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {method === "quick_fire_array"
                  ? "把八个数值分配完才能继续。"
                  : `还剩 ${pointRemaining} 点要分配完。`}
              </p>
            )}
            <StepActions onNext={() => setStep(3)} nextDisabled={!canNext} />
          </>
        )}

        {/* 3 · 技能倾向 */}
        {step === 3 && (
          <>
            <h1 className="font-display mt-2 text-2xl font-semibold text-foreground">
              擅长什么？
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              点几个方向即可，具体数值由 KP 按预算（职业点 + 个人兴趣点
              {typeof knownINT === "number" ? `＝INT ${knownINT}×2＝${knownINT * 2}` : "（INT×2）"}
              ）代为分配。
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {SKILL_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => toggle(skills, setSkills, chip)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
                    skills.includes(chip)
                      ? "border-primary/60 bg-primary/5 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>
            <Field label="还想补什么（可选，顿号分隔）">
              <input
                value={skillsExtra}
                onChange={(e) => setSkillsExtra(e.target.value)}
                placeholder="如：神秘学、锁匠"
                className="mt-3 flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </Field>
            <StepActions onNext={() => setStep(4)} nextDisabled={!canNext} />
          </>
        )}

        {/* 4 · 背景 + 预览 */}
        {step === 4 && (
          <>
            <h1 className="font-display mt-2 text-2xl font-semibold text-foreground">
              过去的故事，然后出发
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              背景可写一两句，也可完全交给 KP 按概念补全。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {BACKSTORY_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setBackstory((b) => (b ? b + "\n" : "") + chip)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40"
                >
                  {chip}
                </button>
              ))}
            </div>
            <textarea
              value={backstory}
              onChange={(e) => setBackstory(e.target.value)}
              rows={3}
              placeholder="（可留空）"
              className="mt-3 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />

            <div className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm">
              <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                构想预览
              </div>
              <ul className="mt-2 space-y-1 text-sm text-foreground">
                <li>身份：{name.trim() || "（KP 拟定）"}{occupation.trim() ? ` · ${occupation.trim()}` : ""}{age.trim() ? ` · ${age.trim()} 岁` : ""}</li>
                <li>
                  属性：
                  {method === "quick_fire_array" && quickFireComplete
                    ? ATTRS.map((a) => `${a.label}${quickFire[a.key]}`).join("／")
                    : method === "point_buy_460" && pointRemaining === 0
                      ? ATTRS.map((a) => `${a.label}${pointBuy[a.key]}`).join("／")
                      : METHODS.find((m) => m.id === method)?.label || "（KP 推荐）"}
                </li>
                <li>技能倾向：{[...skills, ...skillsExtra.split(/[，,、\s]+/).filter(Boolean)].join("、") || "（KP 决定）"}</li>
                <li>背景：{backstory.trim() ? "已写要点" : "（KP 补全）"}</li>
                <li>幸运：创建时由 KP 掷 3D6</li>
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 pb-6">
              <Button
                size="lg"
                disabled={busy}
                onClick={() => onFinish(buildSubmission())}
                className="min-w-40"
              >
                交给守秘人开跑
              </Button>
              <Button size="lg" variant="ghost" onClick={onFreeChat} disabled={busy}>
                改为聊天引导
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepActions({ onNext, nextDisabled }: { onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="mt-8 flex items-center justify-end gap-3">
      <Button onClick={onNext} disabled={nextDisabled} className="min-w-28">
        下一步
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Quick Fire: tap an attribute, then tap a value chip. */
function QuickFireAssign({
  values,
  onChange,
  onComplete,
}: {
  values: Partial<Record<AttrKey, number>>;
  onChange: (v: Partial<Record<AttrKey, number>>) => void;
  onComplete: boolean;
}) {
  const [selected, setSelected] = useState<AttrKey | null>(null);
  const used = useMemo(() => {
    const counts = new Map<number, number>();
    for (const v of Object.values(values)) {
      if (typeof v === "number") counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return counts;
  }, [values]);
  const remaining = (v: number) => QUICK_FIRE_VALUES.filter((x) => x === v).length - (used.get(v) ?? 0);

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          分配数值（点属性，再点数值）
        </span>
        <div className="flex flex-wrap gap-2">
          {QUICK_FIRE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange({ ...preset.assign })}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {ATTRS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => setSelected(a.key)}
            className={cn(
              "flex flex-col items-center rounded-lg border px-2 py-2 transition-colors",
              selected === a.key
                ? "border-primary ring-[3px] ring-ring/30"
                : "border-border bg-secondary/60 hover:border-primary/40",
            )}
          >
            <span className="text-[11px] text-muted-foreground">{a.label}</span>
            <span className="text-sm font-semibold tabular-nums">
              {values[a.key] ?? "—"}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[...new Set(QUICK_FIRE_VALUES)].map((v) => (
          <button
            key={v}
            type="button"
            disabled={remaining(v) <= 0 || !selected}
            onClick={() => {
              if (!selected) return;
              onChange({ ...values, [selected]: v });
              setSelected(null);
            }}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-semibold tabular-nums transition-colors",
              remaining(v) <= 0
                ? "border-border bg-secondary text-muted-foreground/40 line-through"
                : "border-primary/40 bg-card text-foreground hover:border-primary",
              !selected && remaining(v) > 0 && "opacity-60",
            )}
          >
            {v}
            {QUICK_FIRE_VALUES.filter((x) => x === v).length > 1 && ` ×${remaining(v)}`}
          </button>
        ))}
      </div>
      {onComplete && (
        <p className="mt-3 text-xs text-emerald-700">分配完成。</p>
      )}
    </div>
  );
}

/** Point buy: ±5 steppers with a live remaining budget. */
function PointBuyAssign({
  values,
  onChange,
  remaining,
}: {
  values: Record<AttrKey, number>;
  onChange: (v: Record<AttrKey, number>) => void;
  remaining: number;
}) {
  const bump = (key: AttrKey, delta: number) => {
    const next = Math.max(15, Math.min(90, (values[key] ?? 50) + delta));
    onChange({ ...values, [key]: next });
  };
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          点数分配
        </span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            remaining === 0 ? "text-emerald-700" : "text-amber-700",
          )}
        >
          剩余 {remaining} / {POINT_BUY_BUDGET}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {ATTRS.map((a) => (
          <div key={a.key} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{a.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${((values[a.key] ?? 0) / 90) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">
              {values[a.key]}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => bump(a.key, -5)}>
                −
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={remaining <= 0 && values[a.key] >= 90}
                onClick={() => bump(a.key, 5)}
              >
                +
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
