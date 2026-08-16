import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Pencil,
  Plus,
  ScrollText,
  Trash as TrashIcon,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { BootstrapResult, CampaignSummary, TrashEntry } from "../types";

interface Props {
  bootstrap: BootstrapResult | null;
  activeCampaign: string | null;
  busy: boolean;
  onOpen: (campaignId: string) => void;
  onNew: () => void;
  /** Returns true when the rename landed (sidebar exits edit mode). */
  onRename: (campaignId: string, title: string) => Promise<boolean>;
  /** Returns true when the campaign moved into the trash. */
  onTrash: (campaignId: string) => Promise<boolean>;
  onListTrash: () => Promise<TrashEntry[]>;
  /** Returns true when the campaign came back from the trash. */
  onRestore: (trashKey: string) => Promise<boolean>;
}

/** Player-facing countdown until the automatic purge ("N 小时后自动清除"). */
function purgeCountdown(purgeAt?: string | null): string {
  const ms = purgeAt ? Date.parse(purgeAt) - Date.now() : Number.NaN;
  if (!Number.isFinite(ms)) return "24 小时内自动清除";
  if (ms <= 0) return "即将自动清除";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟后自动清除`;
  return `${Math.ceil(minutes / 60)} 小时后自动清除`;
}

type CardMode = { id: string; kind: "rename" | "delete" };

function CampaignCard({
  campaign,
  active,
  busy,
  mode,
  draftTitle,
  setDraftTitle,
  onStartRename,
  onStartDelete,
  onCancelMode,
  onCommitRename,
  onCommitDelete,
  onOpen,
}: {
  campaign: CampaignSummary;
  active: boolean;
  busy: boolean;
  mode: CardMode | null;
  draftTitle: string;
  setDraftTitle: (value: string) => void;
  onStartRename: () => void;
  onStartDelete: () => void;
  onCancelMode: () => void;
  onCommitRename: () => void;
  onCommitDelete: () => void;
  onOpen: () => void;
}) {
  const title = campaign.title || campaign.campaign_id;
  const subtitle = `${campaign.active_scenario_id ?? "—"}${
    campaign.status ? ` · ${campaign.status}` : ""
  }`;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card/55 p-3.5 transition-colors",
        !mode && "hover:border-primary/35 hover:bg-card",
        active && !mode &&
          "border-primary/35 bg-card shadow-xs before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-l-lg before:bg-primary",
        !active && !mode && "border-border",
        busy && "opacity-60",
      )}
    >
      {mode?.kind === "rename" ? (
        <div className="flex flex-col gap-2">
          <Input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- inline edit must grab focus to be usable
            autoFocus
            value={draftTitle}
            maxLength={120}
            placeholder="战役名称"
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelMode();
            }}
            className="h-8 px-2 text-sm"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              onClick={onCancelMode}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              size="xs"
              onClick={onCommitRename}
              disabled={busy || !draftTitle.trim()}
            >
              保存
            </Button>
          </div>
        </div>
      ) : mode?.kind === "delete" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            将「{title}」移入回收站？24 小时后自动清除，期间可恢复。
          </p>
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              onClick={onCancelMode}
              disabled={busy}
            >
              取消
            </Button>
            <Button size="xs" variant="destructive" onClick={onCommitDelete} disabled={busy}>
              删除
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Whole-card click target; sibling action bar sits above it. */}
          <button
            type="button"
            aria-label={`打开战役 ${title}`}
            className="absolute inset-0"
            onClick={onOpen}
            disabled={busy}
          />
          <div className="pointer-events-none relative flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">
                {title}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            </span>
            <span className="pointer-events-auto flex shrink-0 items-center gap-0.5 pt-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground/60 hover:text-foreground"
                onClick={onStartRename}
                disabled={busy}
                title="重命名"
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground/60 hover:text-destructive"
                onClick={onStartDelete}
                disabled={busy}
                title="删除（移入回收站）"
              >
                <Trash2 className="size-3.5" />
              </Button>
              <ChevronRight
                className={cn(
                  "mt-1 size-4 shrink-0 transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground/40 group-hover:text-primary/70",
                )}
              />
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function TrashSection({
  busy,
  tick,
  onListTrash,
  onRestore,
}: {
  busy: boolean;
  /** Bumped by the parent after every successful trash/restore. */
  tick: number;
  onListTrash: () => Promise<TrashEntry[]>;
  onRestore: (trashKey: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    try {
      setEntries(await onListTrash());
    } catch {
      setError("回收站读取失败，请稍后重试。");
    }
  };

  useEffect(() => {
    if (open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on open and after every external change
  }, [open, tick]);

  return (
    <div className="shrink-0 border-t border-border px-2.5 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-1.5">
          <TrashIcon className="size-3.5" />
          回收站
          {entries?.length ? `（${entries.length}）` : ""}
        </span>
        <ChevronRight
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {error && <p className="px-1.5 py-1 text-xs text-destructive">{error}</p>}
          {entries === null && !error && (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">读取中…</p>
          )}
          {entries !== null && entries.length === 0 && (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              回收站是空的。
            </p>
          )}
          {entries?.map((entry) => (
            <div
              key={entry.trash_key}
              className="rounded-md border border-border/70 bg-card/40 px-2 py-1.5"
            >
              <p className="truncate text-xs font-medium text-foreground">
                {entry.title || entry.campaign_id}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-[10px] text-muted-foreground">
                  {purgeCountdown(entry.purge_at)}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await onRestore(entry.trash_key);
                    if (ok) void reload();
                  }}
                >
                  <Undo2 className="size-3" />
                  恢复
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Campaign list sidebar (shared by the fixed md+ column and the mobile Sheet).
 * Only compatible campaigns are rendered; legacy saves are intentionally
 * invisible — the runtime does not migrate them. Delete moves a campaign
 * into the workspace trash (24h retention, restorable from 回收站).
 */
export function CampaignSidebar({
  bootstrap,
  activeCampaign,
  busy,
  onOpen,
  onNew,
  onRename,
  onTrash,
  onListTrash,
  onRestore,
}: Props) {
  const campaigns = useMemo(
    () =>
      (bootstrap?.campaigns ?? []).filter((c) => c.compatible !== false),
    [bootstrap],
  );
  const [mode, setMode] = useState<CardMode | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [trashTick, setTrashTick] = useState(0);

  const startRename = (campaign: CampaignSummary) => {
    setMode({ id: campaign.campaign_id, kind: "rename" });
    setDraftTitle(campaign.title || campaign.campaign_id);
  };

  const commitRename = async (campaign: CampaignSummary) => {
    const title = draftTitle.trim();
    if (!title || title === (campaign.title || campaign.campaign_id)) {
      setMode(null);
      return;
    }
    const ok = await onRename(campaign.campaign_id, title);
    if (ok) setMode(null);
  };

  const commitDelete = async (campaign: CampaignSummary) => {
    const ok = await onTrash(campaign.campaign_id);
    if (ok) {
      setMode(null);
      setTrashTick((value) => value + 1);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h2 className="font-display text-lg font-semibold tracking-wide text-foreground">
          战役卷宗
        </h2>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1 rounded-lg border-border/80 bg-transparent px-2.5 shadow-none"
          onClick={onNew}
          disabled={busy}
          title="从剧本或 PDF 源包开局"
        >
          <Plus className="size-3.5" />
          新战役
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-4">
        {!bootstrap && (
          <div className="space-y-2 px-2 pt-1">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        )}

        {bootstrap &&
          campaigns.map((c) => (
            <CampaignCard
              key={c.campaign_id}
              campaign={c}
              active={c.campaign_id === activeCampaign}
              busy={busy}
              mode={mode?.id === c.campaign_id ? mode : null}
              draftTitle={draftTitle}
              setDraftTitle={setDraftTitle}
              onStartRename={() => startRename(c)}
              onStartDelete={() => setMode({ id: c.campaign_id, kind: "delete" })}
              onCancelMode={() => setMode(null)}
              onCommitRename={() => void commitRename(c)}
              onCommitDelete={() => void commitDelete(c)}
              onOpen={() => onOpen(c.campaign_id)}
            />
          ))}

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

      <TrashSection
        busy={busy}
        tick={trashTick}
        onListTrash={onListTrash}
        onRestore={onRestore}
      />
    </div>
  );
}
