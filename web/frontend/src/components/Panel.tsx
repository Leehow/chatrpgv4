import { useState } from "react";
import { Backpack, Clock3, Fingerprint, Landmark, Search, Swords, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Actor, GameState } from "../types";
import { safeDisplayText } from "../safe-display";
import {
  cashLedgerRows,
  cashWhenLabel,
  hasCashBalances,
  showsCashSection,
  type CashDisplay,
  type PanelView,
} from "../panel-cash";
import {
  assetsHeadline,
  hasSheetAssets,
  showsAssetsSection,
  type SheetAssets,
} from "../panel-assets";

interface Props {
  state: GameState | null;
  investigatorId: string | null;
  /** Character creation still pending: the sheet is the placeholder draft
   *  shell, so its numbers must not masquerade as a real investigator. */
  setupPending?: boolean;
  /** Consume one charge of a consumable (state.item_use via the bridge). */
  onUseItem?: (itemId: string) => void | Promise<void>;
}

/** Static Tailwind classes per resource — never build class names dynamically
 *  (purge safety). */
const RESOURCE_META: { key: string; label: string; barCls: string; textCls: string; derived: string }[] = [
  { key: "hp", label: "HP 生命", barCls: "bg-hp", textCls: "text-hp", derived: "HP" },
  { key: "san", label: "SAN 理智", barCls: "bg-san", textCls: "text-san", derived: "SAN" },
  { key: "mp", label: "MP 魔法", barCls: "bg-mp", textCls: "text-mp", derived: "MP" },
  { key: "luck", label: "幸运", barCls: "bg-luck", textCls: "text-luck", derived: "Luck" },
];

/** Tension level → static badge classes (unknown levels fall back to muted). */
const TENSION_CLS: Record<string, string> = {
  calm: "border-success/40 bg-success-soft text-success",
  low: "border-success/40 bg-success-soft text-success",
  uneasy: "border-warning/40 bg-warning-soft text-warning",
  medium: "border-warning/40 bg-warning-soft text-warning",
  rising: "border-caution/40 bg-caution-soft text-caution",
  high: "border-destructive/40 bg-destructive-soft text-destructive",
  peak: "border-destructive/60 bg-destructive-soft text-destructive",
};
const TENSION_FALLBACK = "border-border bg-secondary text-muted-foreground";

/** Condition enum → zh-Hans label + severity badge classes. Known values come
 *  from the plugin runtime (coc_combat VALID_CONDITIONS plus sanity
 *  `phobia:<name>` / `mania:<name>` tags); unknown strings fall back to the
 *  raw enum in muted styling so new conditions never render blank. */
const CONDITION_META: Record<string, { label: string; cls: string }> = {
  dead: { label: "死亡", cls: "border-destructive/40 bg-destructive-soft text-destructive" },
  dying: { label: "濒死", cls: "border-destructive/40 bg-destructive-soft text-destructive" },
  major_wound: { label: "重伤", cls: "border-destructive/40 bg-destructive-soft text-destructive" },
  unconscious: { label: "昏迷", cls: "border-caution/40 bg-caution-soft text-caution" },
  grappled: { label: "被擒", cls: "border-caution/40 bg-caution-soft text-caution" },
  outnumbered: { label: "寡不敌众", cls: "border-caution/40 bg-caution-soft text-caution" },
  prone: { label: "倒地", cls: "border-warning/40 bg-warning-soft text-warning" },
  surprised: { label: "措手不及", cls: "border-warning/40 bg-warning-soft text-warning" },
  fled: { label: "撤离", cls: "border-warning/40 bg-warning-soft text-warning" },
  stabilized: { label: "伤势稳定", cls: "border-border bg-secondary text-muted-foreground" },
};
const CONDITION_WARNING_CLS = "border-warning/40 bg-warning-soft text-warning";
const CONDITION_FALLBACK_CLS = "border-border bg-secondary text-muted-foreground";

function conditionMeta(raw: string): { label: string; cls: string } {
  if (raw.startsWith("phobia:")) {
    return { label: `恐惧症·${raw.slice("phobia:".length)}`, cls: CONDITION_WARNING_CLS };
  }
  if (raw.startsWith("mania:")) {
    return { label: `狂躁症·${raw.slice("mania:".length)}`, cls: CONDITION_WARNING_CLS };
  }
  return CONDITION_META[raw] ?? { label: raw, cls: CONDITION_FALLBACK_CLS };
}

function resourceBar(actor: Actor | null, key: string, max: number | null) {
  const live = actor?.resources?.[key];
  const current = typeof live === "number" ? live : max;
  if (typeof current !== "number") return null;
  const cap = typeof max === "number" && max > 0 ? max : current;
  const pct = cap > 0 ? Math.max(0, Math.min(100, (current / cap) * 100)) : 0;
  return { current, cap, pct };
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {icon}
      {text}
      <span aria-hidden className="ml-1 h-px flex-1 bg-border/70" />
    </h3>
  );
}

function AssetsSection({ assets }: { assets: SheetAssets }) {
  return (
    <section className="panel-section">
      <SectionTitle icon={<Landmark className="size-3.5" />} text="资产" />
      <div className="mt-2 font-display text-xl leading-none font-semibold tabular-nums text-foreground">
        {assetsHeadline(assets)}
      </div>
      {assets.currency ? (
        <div className="mt-1 text-xs text-muted-foreground">{assets.currency}</div>
      ) : null}
      {(assets.living_standard || assets.spending_level) && (
        <div className="mt-2 space-y-0.5 text-sm text-foreground/90">
          {assets.living_standard ? <div>生活水平：{assets.living_standard}</div> : null}
          {assets.spending_level ? <div>消费水平：{assets.spending_level}</div> : null}
        </div>
      )}
    </section>
  );
}

function CashSection({ cash }: { cash: CashDisplay | null }) {
  const ledger = cashLedgerRows(cash);
  return (
    <section className="panel-section">
      <SectionTitle icon={<Wallet className="size-3.5" />} text="现金" />
      {hasCashBalances(cash) ? (
        <>
          <div className="mt-2 space-y-1">
            {Object.entries(cash!.balances!).map(([code, wallet]) => (
              <div key={code} className="flex items-baseline gap-2">
                <span className="font-display text-xl leading-none font-semibold tabular-nums text-foreground">
                  {wallet.amount}
                </span>
                <span className="text-xs text-muted-foreground">
                  {code}{wallet.unit ? ` · ${wallet.unit}` : ""}
                </span>
              </div>
            ))}
          </div>
          {ledger.length ? (
            <ul className="mt-2.5 space-y-1.5">
              {ledger
                .slice()
                .reverse()
                .map((row, i) => {
                  const sign = row.op === "grant" ? "+" : "−";
                  const why = row.localized_reason?.trim() || "未提供说明";
                  const when = cashWhenLabel(row);
                  return (
                    <li
                      key={row.decision_id || `cash-row-${i}`}
                      className="flex items-start justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="tabular-nums text-foreground/90">
                          {sign}
                          {row.amount}
                          {row.currency ? ` ${row.currency}` : ""}
                        </span>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {why}
                        </div>
                        {when ? (
                          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
                            {when}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p className="mt-2.5 text-xs text-muted-foreground">暂无流水。</p>
          )}
        </>
      ) : (
        <p className="mt-2.5 text-xs text-muted-foreground">尚无现金记录。</p>
      )}
    </section>
  );
}


/** Shared panel content — reused by the xl fixed column and the narrow-screen Sheet. */
export function PanelContent({
  state,
  investigatorId,
  setupPending,
  onUseItem,
  view = "all",
}: Props & { view?: PanelView }) {
  const [usingItemId, setUsingItemId] = useState<string | null>(null);
  if (!state) {
    return (
      <p className="px-2 py-8 text-center text-xs leading-relaxed text-muted-foreground">
        进入战役后，这里显示角色、物品与时间。
      </p>
    );
  }
  const actor =
    state.actors?.find((a) => a.id === investigatorId) ?? state.actors?.[0] ?? null;
  const sheet = state.character ?? null;
  const derived = sheet?.derived ?? {};
  const derivedNum = (k: string): number | null => {
    const v = derived[k] ?? (k === "Luck" ? derived.LUCK : undefined);
    return typeof v === "number" ? v : null;
  };
  const chars = sheet?.characteristics ?? [];
  const backstory = sheet?.backstory ?? [];
  const luckCap = derivedNum("Luck") ?? (typeof sheet?.luck === "number" ? sheet.luck : null);
  const skills = [...(sheet?.skills ?? [])].sort(
    (a, b) => Number(b.value) - Number(a.value),
  );
  const weapons = sheet?.weapons ?? [];
  const equipment = sheet?.equipment ?? [];
  // Live campaign-merged gear (weapons render in their own section above).
  const inventoryItems =
    sheet?.inventory_items?.filter((item) => item.kind !== "weapon") ?? null;
  const cash = sheet?.cash ?? null;
  const assets = sheet?.assets ?? null;
  const handleUseItem = async (itemId: string) => {
    if (!onUseItem || usingItemId) return;
    setUsingItemId(itemId);
    try {
      await onUseItem(itemId);
    } finally {
      setUsingItemId(null);
    }
  };
  const time = state.time ?? null;
  const discoveredClues =
    state.discovered_clues ??
    (state.discovered_clue_ids ?? []).map((id) => ({
      clue_id: id,
      summary: id,
    }));

  return (
    <div className="flex flex-col gap-3">
      {/* 时间 */}
      {(view === "all" || view === "time") && <section className="panel-section">
        <SectionTitle icon={<Clock3 className="size-3.5" />} text="时间" />
        <div className="font-display mt-2 text-xl leading-snug font-semibold text-foreground">
          {time?.display ?? "—"}
        </div>
        {time?.display_sub ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {time.display_sub}
          </div>
        ) : null}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {time?.location_id && (
            <Badge variant="secondary" className="rounded-full font-normal">
              地点 {time.location_id}
            </Badge>
          )}
          <Badge variant="secondary" className="rounded-full font-normal">
            第 {state.turn_number ?? 0} 回合
          </Badge>
          {state.active_scene_label && (
            <Badge variant="secondary" className="rounded-full font-normal">
              场景 {state.active_scene_label}
            </Badge>
          )}
          {state.tension_level && (
            <Badge
              variant="outline"
              className={cn(
                "rounded-full font-normal",
                TENSION_CLS[state.tension_level] ?? TENSION_FALLBACK,
              )}
            >
              张力 {state.tension_label || state.tension_level}
            </Badge>
          )}
        </div>
      </section>}

      {/* 调查员 */}
      {(view === "all" || view === "character") && (
        <Card className="gap-3 py-4">
          <CardHeader className="gap-2 px-4">
            <SectionTitle icon={<Fingerprint className="size-3.5" />} text="调查员" />
            {!setupPending && (
              <>
                <CardTitle className="font-display text-lg leading-snug">
                  {sheet?.name ?? actor?.id ?? "—"}
                </CardTitle>
                {(sheet?.occupation || sheet?.era || typeof sheet?.age === "number") && (
                  <CardDescription className="flex flex-wrap gap-1.5">
                    {sheet?.occupation && (
                      <Badge variant="secondary" className="rounded-full font-normal">
                        {typeof sheet.occupation === "string" ? sheet.occupation : safeDisplayText(sheet.occupation)}
                      </Badge>
                    )}
                    {sheet?.era && (
                      <Badge variant="secondary" className="rounded-full font-normal">
                        {sheet.era}
                      </Badge>
                    )}
                    {typeof sheet?.age === "number" && (
                      <Badge variant="secondary" className="rounded-full font-normal">
                        {sheet.age} 岁
                      </Badge>
                    )}
                  </CardDescription>
                )}
              </>
            )}
          </CardHeader>
          <CardContent className="px-4">
            {setupPending ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                调查员创建中：KP 正在按
                <code className="mx-1">coc-character</code>
                引导你完成概念、属性与职业。确认建卡后，这里显示正式角色卡。
              </p>
            ) : (
              <>
                <div className="space-y-3">
                  {RESOURCE_META.map((meta) => {
                    const cap = meta.key === "luck" ? luckCap : derivedNum(meta.derived);
                    const bar = resourceBar(actor, meta.key, cap);
                    if (!bar) return null;
                    return (
                      <div key={meta.key} className="flex items-center gap-3">
                        <span className="w-14 shrink-0 text-xs text-muted-foreground">
                          {meta.label}
                        </span>
                        <Progress
                          value={bar.pct}
                          className="h-1.5 flex-1"
                          indicatorClassName={cn(
                            meta.barCls,
                            "transition-[width] duration-300 ease-out",
                          )}
                        />
                        <span className={cn("min-w-16 shrink-0 text-right tabular-nums", meta.textCls)}>
                          <span className="font-display text-base leading-none font-semibold">
                            {bar.current}
                          </span>
                          {bar.cap ? (
                            <span className="text-[11px] text-muted-foreground">/{bar.cap}</span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {actor && actor.conditions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {actor.conditions.map((c) => {
                      const meta = conditionMeta(c);
                      return (
                        <Badge
                          key={c}
                          variant="outline"
                          title={c}
                          className={cn("rounded-full font-normal", meta.cls)}
                        >
                          {meta.label}
                        </Badge>
                      );
                    })}
                  </div>
                )}

                {chars.length > 0 && (
                  <div className="mt-4 grid grid-cols-4 gap-1.5">
                    {chars.map((c) => (
                      <div
                        key={c.key}
                        title={c.key}
                        className="flex flex-col items-center gap-1 rounded-lg border border-border/40 bg-secondary/70 px-1 py-2"
                      >
                        <span className="text-[10px] tracking-wide text-muted-foreground">{c.label}</span>
                        <span className="font-display text-lg leading-none font-semibold tabular-nums">{c.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {backstory.length > 0 && (
                  <div className="mt-4 space-y-2.5">
                    <div className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                      背景
                    </div>
                    {backstory.map((block) => (
                      <div key={block.field || block.label} className="text-sm leading-relaxed">
                        <div className="text-[11px] text-muted-foreground">
                          {block.label}
                        </div>
                        <ul className="mt-0.5 space-y-0.5 text-foreground/90">
                          {block.items.map((item, index) => (
                            <li key={`${block.field || block.label}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 现金 — 角色 tab 与物品 tab 共用同一 CashSection；物品 tab 中置于装备列表之前 */}
      {showsCashSection(view, setupPending) && <CashSection cash={cash} />}
      {showsAssetsSection(view, setupPending) && hasSheetAssets(assets) && (
        <AssetsSection assets={assets!} />
      )}

      {/* 技能 */}
      {(view === "all" || view === "character") && !setupPending && skills.length > 0 && (
        <section className="panel-section">
          <SectionTitle icon={<Fingerprint className="size-3.5" />} text="技能" />
          <div className="mt-2.5 space-y-1.5">
            {skills.map((s) => (
              <div
                key={s.key}
                title={s.key}
                className="flex items-baseline gap-2 text-sm leading-6"
              >
                <span className="truncate text-foreground/90">{s.label}</span>
                <span aria-hidden className="mx-1 flex-1 border-b border-dotted border-border" />
                <span className="shrink-0 font-display text-[15px] font-semibold text-primary tabular-nums">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 武器 */}
      {(view === "all" || view === "items") && !setupPending && weapons.length > 0 && (
        <section className="panel-section">
          <SectionTitle icon={<Swords className="size-3.5" />} text="武器" />
          <div className="mt-2.5 space-y-1.5">
            {weapons.map((w, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/40 bg-secondary/70 px-2.5 py-1.5"
              >
                <div className="text-sm font-medium text-foreground">{w.label ?? "武器"}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {w.damage ?? ""}
                  {w.skill_label ? ` · ${w.skill_label}` : ""}
                  {w.range !== undefined && w.range !== null && w.range !== "" ? ` · 射程 ${w.range}` : ""}
                  {w.ammo !== undefined && w.ammo !== null ? ` · 弹药 ${w.ammo}` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 物品 */}
      {(view === "all" || view === "items") && !setupPending && (
      <section className="panel-section">
        <SectionTitle icon={<Backpack className="size-3.5" />} text="物品" />
        {inventoryItems ? (
          inventoryItems.length ? (
            <ul className="mt-2.5 space-y-1.5">
              {inventoryItems.map((item) => (
                <li key={item.item_id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="text-foreground/90">{item.label}</span>
                    {typeof item.quantity === "number" && item.quantity > 1 && (
                      <Badge variant="secondary" className="ml-1.5 rounded-full font-normal">
                        ×{item.quantity}
                      </Badge>
                    )}
                    {item.consumable && (
                      <Badge variant="outline" className="ml-1.5 rounded-full font-normal text-[10px] text-muted-foreground">
                        消耗品
                      </Badge>
                    )}
                    {item.note && (
                      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {item.note}
                      </div>
                    )}
                  </div>
                  {item.consumable && onUseItem && (
                    <button
                      type="button"
                      disabled={usingItemId !== null}
                      onClick={() => void handleUseItem(item.item_id)}
                      className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      {usingItemId === item.item_id ? "使用中…" : "使用"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2.5 text-xs text-muted-foreground">身无长物。</p>
          )
        ) : equipment.length ? (
          <ul className="mt-2.5 list-disc space-y-1 pl-4 text-sm text-foreground/90 marker:text-primary/50">
            {equipment.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2.5 text-xs text-muted-foreground">身无长物。</p>
        )}
      </section>
      )}

      {/* 线索 */}
      {(view === "all" || view === "items") && <section className="panel-section">
        <SectionTitle icon={<Search className="size-3.5" />} text="线索" />
        {discoveredClues.length ? (
          <>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              已发现 {discoveredClues.length} 条
            </div>
            <ul className="mt-2 space-y-1.5">
              {discoveredClues.map((clue) => (
                <li
                  key={clue.clue_id}
                  title={clue.clue_id}
                  className="rounded-lg border border-border/40 bg-secondary/70 px-2.5 py-1.5 text-xs leading-relaxed text-foreground/90"
                >
                  {clue.summary}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2.5 text-xs text-muted-foreground">尚未发现线索。</p>
        )}
      </section>}
    </div>
  );
}

/** Panel as the fixed xl third column. */
export function Panel({ state, investigatorId, setupPending, onUseItem }: Props) {
  const [view, setView] = useState<Exclude<PanelView, "all">>("character");
  const tabs: { value: Exclude<PanelView, "all">; label: string }[] = [
    { value: "character", label: "角色" },
    { value: "items", label: "物品" },
    { value: "time", label: "时间" },
  ];
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="grid grid-cols-3 rounded-full bg-secondary/70 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setView(tab.value)}
              className={cn(
                "rounded-full px-2 py-1.5 text-sm transition-[color,background-color,box-shadow]",
                view === tab.value
                  ? "bg-card font-semibold text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <PanelContent
          state={state}
          investigatorId={investigatorId}
          setupPending={setupPending}
          onUseItem={onUseItem}
          view={view}
        />
      </div>
    </aside>
  );
}
