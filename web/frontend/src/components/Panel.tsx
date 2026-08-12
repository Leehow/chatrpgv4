import { Backpack, Clock3, Fingerprint, Search, Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Actor, GameState } from "../types";

interface Props {
  state: GameState | null;
  investigatorId: string | null;
}

/** Static Tailwind classes per resource — never build class names dynamically
 *  (purge safety). */
const RESOURCE_META: { key: string; label: string; barCls: string; textCls: string; derived: string }[] = [
  { key: "hp", label: "HP 生命", barCls: "bg-rose-600", textCls: "text-rose-700", derived: "HP" },
  { key: "san", label: "SAN 理智", barCls: "bg-indigo-500", textCls: "text-indigo-700", derived: "SAN" },
  { key: "mp", label: "MP 魔法", barCls: "bg-sky-500", textCls: "text-sky-700", derived: "MP" },
  { key: "luck", label: "幸运", barCls: "bg-amber-500", textCls: "text-amber-700", derived: "LUCK" },
];

/** Tension level → static badge classes (unknown levels fall back to muted). */
const TENSION_CLS: Record<string, string> = {
  calm: "border-emerald-200 bg-emerald-50 text-emerald-700",
  low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  uneasy: "border-amber-200 bg-amber-50 text-amber-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  rising: "border-orange-200 bg-orange-50 text-orange-700",
  high: "border-red-200 bg-red-50 text-red-700",
  peak: "border-red-300 bg-red-100 text-red-800",
};
const TENSION_FALLBACK = "border-border bg-secondary text-muted-foreground";

function resourceBar(actor: Actor | null, key: string, max: number | null) {
  const current = actor?.resources?.[key];
  if (typeof current !== "number") return null;
  const cap = typeof max === "number" && max > 0 ? max : current;
  const pct = Math.max(0, Math.min(100, (current / cap) * 100));
  return { current, cap, pct };
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {icon}
      {text}
    </h3>
  );
}

/** Shared panel content — reused by the xl fixed column and the narrow-screen Sheet. */
export function PanelContent({ state, investigatorId }: Props) {
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
    const v = derived[k];
    return typeof v === "number" ? v : null;
  };
  const chars = sheet?.characteristics ?? [];
  const skills = [...(sheet?.skills ?? [])].sort(
    (a, b) => Number(b.value) - Number(a.value),
  );
  const weapons = sheet?.weapons ?? [];
  const equipment = sheet?.equipment ?? [];
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
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
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
          {(state.active_scene_label || state.active_scene_id) && (
            <Badge variant="secondary" className="rounded-full font-normal">
              场景 {state.active_scene_label || state.active_scene_id}
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
      </section>

      {/* 调查员 */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <SectionTitle icon={<Fingerprint className="size-3.5" />} text="调查员" />
        <div className="font-display mt-2 text-lg font-semibold text-foreground">
          {sheet?.name ?? actor?.id ?? "—"}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {sheet?.occupation && (
            <Badge variant="secondary" className="rounded-full font-normal">
              {sheet.occupation}
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
        </div>

        <div className="mt-3.5 space-y-2.5">
          {RESOURCE_META.map((meta) => {
            const bar = resourceBar(actor, meta.key, derivedNum(meta.derived));
            if (!bar) return null;
            return (
              <div key={meta.key} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
                  {meta.label}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full rounded-full transition-all", meta.barCls)}
                    style={{ width: `${bar.pct}%` }}
                  />
                </div>
                <span className={cn("w-12 shrink-0 text-right text-[11px] tabular-nums", meta.textCls)}>
                  {bar.current}
                  {bar.cap ? `/${bar.cap}` : ""}
                </span>
              </div>
            );
          })}
        </div>

        {actor && actor.conditions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {actor.conditions.map((c) => (
              <Badge
                key={c}
                variant="outline"
                className="rounded-full border-orange-200 bg-orange-50 font-normal text-orange-700"
              >
                {c}
              </Badge>
            ))}
          </div>
        )}

        {chars.length > 0 && (
          <div className="mt-3.5 grid grid-cols-4 gap-1.5">
            {chars.map((c) => (
              <div
                key={c.key}
                title={c.key}
                className="flex flex-col items-center rounded-lg bg-secondary/70 px-1 py-1.5"
              >
                <span className="text-[10px] text-muted-foreground">{c.label}</span>
                <span className="text-sm font-semibold tabular-nums">{c.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 技能 */}
      {skills.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <SectionTitle icon={<Fingerprint className="size-3.5" />} text="技能" />
          <div className="mt-2.5 space-y-1">
            {skills.map((s) => (
              <div
                key={s.key}
                title={s.key}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="truncate text-foreground/90">{s.label}</span>
                <span className="shrink-0 text-xs font-semibold text-primary tabular-nums">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 武器 */}
      {weapons.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <SectionTitle icon={<Swords className="size-3.5" />} text="武器" />
          <div className="mt-2.5 space-y-2">
            {weapons.map((w, i) => (
              <div key={i} className="text-sm">
                <div className="font-medium text-foreground">{w.label ?? "武器"}</div>
                <div className="text-xs text-muted-foreground">
                  {w.damage ?? ""}
                  {w.skill_label ? ` · ${w.skill_label}` : ""}
                  {w.ammo !== undefined && w.ammo !== null ? ` · 弹药 ${w.ammo}` : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 物品 */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <SectionTitle icon={<Backpack className="size-3.5" />} text="物品" />
        {equipment.length ? (
          <ul className="mt-2.5 list-disc space-y-1 pl-4 text-sm text-foreground/90 marker:text-primary/50">
            {equipment.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2.5 text-xs text-muted-foreground">身无长物。</p>
        )}
      </section>

      {/* 线索 */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
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
                  className="rounded-lg bg-secondary/70 px-2.5 py-1.5 text-xs leading-relaxed text-foreground/90"
                >
                  {clue.summary}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2.5 text-xs text-muted-foreground">尚未发现线索。</p>
        )}
      </section>
    </div>
  );
}

/** Panel as the fixed xl third column. */
export function Panel({ state, investigatorId }: Props) {
  return (
    <aside className="h-full w-full overflow-y-auto px-3 py-4">
      <PanelContent state={state} investigatorId={investigatorId} />
    </aside>
  );
}
