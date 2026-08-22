import { BookOpen, FileText, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HandoutCard } from "../types";

/** 原文卡类型元数据：中文标签 + 图标（Tailwind 类名固定，不做动态拼接）。 */
export const HANDOUT_KIND_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; badgeCls: string }
> = {
  document: {
    label: "文献",
    icon: FileText,
    badgeCls: "border-info/40 bg-info-soft text-info",
  },
  read_aloud: {
    label: "朗读",
    icon: BookOpen,
    badgeCls: "border-warning/40 bg-warning-soft text-warning",
  },
  map: {
    label: "地图",
    icon: MapIcon,
    badgeCls: "border-success/40 bg-success-soft text-success",
  },
};

export function handoutKindMeta(kind: string | undefined) {
  return HANDOUT_KIND_META[String(kind ?? "")] ?? HANDOUT_KIND_META.document;
}

/** 类型徽章：资料页签列表与叙述流卡片共用。 */
export function HandoutKindBadge({ kind, className }: { kind: string | undefined; className?: string }) {
  const meta = handoutKindMeta(kind);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        meta.badgeCls,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * 原文信息卡视图：纸张质感、标题、原文全文（逐字）、来源页码。
 * 卡内文字是模组原文的逐字投影，永不改写或总结。
 */
export function HandoutCardView({ card }: { card: HandoutCard }) {
  const body = (card.text ?? "").trim() || (card.summary ?? "").trim();
  const pages = (card.source_pages ?? []).filter(Boolean);
  return (
    <section
      className="handout-card w-full rounded-xl p-4 sm:p-5"
      aria-label={`原文卡：${card.title}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <HandoutKindBadge kind={card.kind} />
        <h4 className="font-display min-w-0 flex-1 text-base leading-snug font-semibold text-foreground sm:text-lg">
          {card.title}
        </h4>
      </header>
      {card.image_url ? (
        <figure className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-secondary/50">
          <img
            src={card.image_url}
            alt={card.title}
            loading="lazy"
            className="block max-h-[26rem] w-full object-contain"
          />
        </figure>
      ) : null}
      {body ? (
        <div className="handout-body font-display mt-3 text-[15px] leading-7 whitespace-pre-wrap text-foreground/95">
          {body}
        </div>
      ) : null}
      {pages.length ? (
        <footer className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-dashed border-border/80 pt-2 text-[11px] tracking-wide text-muted-foreground">
          <span>来源页</span>
          {pages.map((page) => (
            <span
              key={page}
              className="rounded border border-border/60 bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
            >
              {page}
            </span>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
