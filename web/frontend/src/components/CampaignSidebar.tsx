import { useMemo } from "react";
import { ChevronRight, Plus, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { BootstrapResult } from "../types";

interface Props {
  bootstrap: BootstrapResult | null;
  activeCampaign: string | null;
  busy: boolean;
  onOpen: (campaignId: string) => void;
  onNew: () => void;
}

/**
 * Campaign list sidebar (shared by the fixed md+ column and the mobile Sheet).
 * Only compatible campaigns are rendered; legacy saves are intentionally
 * invisible — the runtime does not migrate them.
 */
export function CampaignSidebar({
  bootstrap,
  activeCampaign,
  busy,
  onOpen,
  onNew,
}: Props) {
  const campaigns = useMemo(
    () =>
      (bootstrap?.campaigns ?? []).filter((c) => c.compatible !== false),
    [bootstrap],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="font-display text-lg font-semibold tracking-wide text-foreground">
          战役卷宗
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 rounded-full"
          onClick={onNew}
          disabled={busy}
          title="从剧本或 PDF 源包开局"
        >
          <Plus className="size-3.5" />
          新战役
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {!bootstrap && (
          <div className="space-y-2 px-2 pt-1">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        )}

        {bootstrap &&
          campaigns.map((c) => {
            const active = c.campaign_id === activeCampaign;
            return (
              <button
                key={c.campaign_id}
                type="button"
                onClick={() => onOpen(c.campaign_id)}
                disabled={busy}
                className={cn(
                  "group w-full rounded-xl border bg-card p-3.5 text-left transition-all",
                  "hover:-translate-y-px hover:border-primary/40 hover:shadow-sm",
                  active
                    ? "border-primary/60 ring-2 ring-primary/20 shadow-sm"
                    : "border-border",
                  busy && "opacity-60",
                )}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block truncate text-sm font-semibold",
                        active ? "text-primary" : "text-foreground",
                      )}
                    >
                      {c.title || c.campaign_id}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {c.active_scenario_id ?? "—"}
                      {c.status ? ` · ${c.status}` : ""}
                    </span>
                  </span>
                  <ChevronRight
                    className={cn(
                      "mt-1 size-4 shrink-0 transition-colors",
                      active
                        ? "text-primary"
                        : "text-muted-foreground/40 group-hover:text-primary/70",
                    )}
                  />
                </span>
              </button>
            );
          })}

        {bootstrap && campaigns.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 pt-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-secondary">
              <ScrollText className="size-6 text-muted-foreground" />
            </span>
            <p className="text-sm font-medium text-foreground">
              还没有可用的战役
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              创建一场新战役开始游戏。旧版存档不在此列出，请重新开局。
            </p>
            <Button size="sm" onClick={onNew} disabled={busy} className="mt-1">
              <Plus className="size-3.5" />
              新战役
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
