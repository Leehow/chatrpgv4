import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  FileText,
  Library,
  Loader2,
  Package,
  ScrollText,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { BootstrapResult, PdfUploadResult, SourceBundle } from "../types";
import { deleteSourceBundle } from "../api";
import {
  uploadAndIngestPdfFile,
  uploadAndIngestPdfFromPath,
} from "../lib/pdfUpload";

/** Sentinel for「新建调查员」— main panel will guide creation after 开局. */
export const NEW_INVESTIGATOR = "__new__";

export type CreateStarterArgs = {
  mode: "starter";
  scenarioId: string;
  /** Pregen id, or null to start investigator-less (guided coc-character creation in play). */
  pregenId: string | null;
  title: string;
};

export type CreatePdfArgs = {
  mode: "pdf";
  sourceBundlePath: string;
  /** Existing investigator id, or `NEW_INVESTIGATOR` to create in main UI. */
  investigatorId: string;
  title: string;
  /** Player-declared era, e.g. "1890s" / "1920s" / "modern". */
  era: string;
};

export type CreateLibraryArgs = {
  mode: "library";
  moduleId: string;
  investigatorId: string;
  title: string;
};

export type CreateArgs = CreateStarterArgs | CreatePdfArgs | CreateLibraryArgs;

interface Props {
  bootstrap: BootstrapResult | null;
  busy: boolean;
  onCreate: (args: CreateArgs) => void;
  onBack: () => void;
  onBootstrapRefresh?: () => Promise<void>;
  /** Skip the mode-select step (first-run guide hands off pre-chosen). */
  initialMode?: SourceMode;
  /** Desktop「导入 PDF 模组…」handoff: a local path from the native shell,
   * registered through the same chain as the browser drop-zone. */
  initialPdfPath?: string | null;
  /** Browser waiting-screen drop / file pick: same upload+ingest chain. */
  initialPdfFile?: File | null;
}

type SourceMode = "starter" | "pdf" | "library";

const MODE_CARDS: Array<{
  id: SourceMode;
  label: string;
  desc: string;
  Icon: typeof ScrollText;
}> = [
  {
    id: "starter",
    label: "预置剧本",
    desc: "自带预生成调查员，开箱即玩",
    Icon: ScrollText,
  },
  {
    id: "library",
    label: "已解析剧本",
    desc: "从剧本库安装，跨战役复用",
    Icon: Library,
  },
  {
    id: "pdf",
    label: "PDF 源包",
    desc: "上传 PDF，哈希登记后开局",
    Icon: Package,
  },
];

/** Common CoC eras the player can declare at PDF 开局. */
/** Sentinel: omit era from campaign.create so the opening-source review
 * establishes it from the module's own facts (avoids declared-vs-source
 * era conflicts, e.g. campaign 163241). Radix Select rejects "", hence a
 * named sentinel. */
const ERA_FOLLOW_SOURCE = "__follow_source__";
const ERA_OPTIONS: Array<{ value: string; label: string }> = [
  { value: ERA_FOLLOW_SOURCE, label: "跟随模组源事实（推荐）" },
  { value: "1890s", label: "1890年代" },
  { value: "1920s", label: "1920年代（经典）" },
  { value: "modern", label: "当代" },
];

/** Guided new-campaign flow shown in the main area (replaces the old in-sidebar wizard). */
export function NewCampaignFlow({
  bootstrap,
  busy,
  onCreate,
  onBack,
  onBootstrapRefresh,
  initialMode,
  initialPdfPath,
  initialPdfFile,
}: Props) {
  const [mode, setMode] = useState<SourceMode | null>(initialMode ?? null);
  const [scenarioId, setScenarioId] = useState("");
  const [pregenId, setPregenId] = useState("");
  const [charSource, setCharSource] = useState<"pregen" | "new">("pregen");
  const [bundlePath, setBundlePath] = useState("");
  const [era, setEra] = useState(ERA_FOLLOW_SOURCE);
  const [moduleId, setModuleId] = useState("");
  const [investigatorId, setInvestigatorId] = useState(NEW_INVESTIGATOR);
  const [title, setTitle] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStartedAt, setUploadStartedAt] = useState(0);
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<PdfUploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const [bundleClearMsg, setBundleClearMsg] = useState<string | null>(null);
  const [bundleClearBusy, setBundleClearBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Parse can legitimately take minutes on a big module; a visible elapsed
  // timer keeps the wait honest instead of looking frozen.
  useEffect(() => {
    if (!uploadBusy) return;
    const startedAt = uploadStartedAt || Date.now();
    if (!uploadStartedAt) setUploadStartedAt(startedAt);
    const timer = setInterval(() => {
      setUploadElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [uploadBusy, uploadStartedAt]);

  const starters = bootstrap?.starters ?? [];
  const starter = starters.find((s) => s.scenario_id === scenarioId) ?? null;
  const bundles = bootstrap?.source_bundles ?? [];
  const libraryModules = bootstrap?.library_modules ?? [];
  const investigators = bootstrap?.investigators ?? [];
  const selectedBundle = bundles.find((b) => b.path === bundlePath) ?? null;
  const selectedModule =
    libraryModules.find((m) => m.canonical_module_id === moduleId) ?? null;

  const sourceReady =
    mode === "starter"
      ? Boolean(scenarioId) && (charSource === "new" || Boolean(pregenId))
      : mode === "library"
        ? Boolean(moduleId)
        : Boolean(bundlePath && !uploadBusy);

  const invReady =
    mode === "starter" ? true : Boolean(investigatorId); /* includes __new__ */

  const canStart = Boolean(mode) && sourceReady && invReady && !busy && !uploadBusy;

  const beginUpload = () => {
    setUploadBusy(true);
    setUploadStartedAt(Date.now());
    setUploadElapsed(0);
    setUploadMsg(null);
    setUploadInfo(null);
  };

  const applyIngest = async (
    run: () => Promise<{
      info: PdfUploadResult;
      message: string;
      bundlePath: string | null;
      titleHint: string | null;
    }>,
  ) => {
    beginUpload();
    try {
      const applied = await run();
      setUploadInfo(applied.info);
      setUploadMsg(applied.message);
      if (applied.bundlePath) setBundlePath(applied.bundlePath);
      if (applied.titleHint && !title) setTitle(applied.titleHint);
      if (onBootstrapRefresh) await onBootstrapRefresh();
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadBusy(false);
    }
  };

  // Desktop path / waiting-screen File handoff: same helper as the drop zone.
  const initialPdfHandled = useRef<string | null>(null);
  useEffect(() => {
    const key = initialPdfFile
      ? `file:${initialPdfFile.name}:${initialPdfFile.size}:${initialPdfFile.lastModified}`
      : initialPdfPath
        ? `path:${initialPdfPath}`
        : null;
    if (!key) return;
    if (mode !== "pdf") {
      setMode("pdf");
      return;
    }
    if (initialPdfHandled.current === key) return;
    initialPdfHandled.current = key;
    if (initialPdfFile) {
      void applyIngest(() =>
        uploadAndIngestPdfFile(initialPdfFile, setUploadMsg),
      );
      return;
    }
    if (initialPdfPath) {
      void applyIngest(() =>
        uploadAndIngestPdfFromPath(initialPdfPath, setUploadMsg),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initialPdfPath, initialPdfFile]);

  const handleClearSourceBundle = async (bundle: SourceBundle) => {
    if (bundleClearBusy) return;
    setBundleClearMsg(null);
    setBundleClearBusy(bundle.bundle_id);
    try {
      await deleteSourceBundle(bundle.bundle_id);
      if (bundlePath === bundle.path) {
        setBundlePath("");
      }
      if (onBootstrapRefresh) await onBootstrapRefresh();
    } catch (e) {
      setBundleClearMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBundleClearBusy(null);
    }
  };

  const handlePdfFile = async (file: File | null) => {
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setUploadMsg("请选择 PDF 文件。");
      return;
    }
    await applyIngest(() => uploadAndIngestPdfFile(file, setUploadMsg));
  };

  const handleStart = () => {
    setStartMsg(null);
    if (mode === "starter") {
      if (!canStart) return;
      onCreate({
        mode: "starter",
        scenarioId,
        pregenId: charSource === "new" ? null : pregenId,
        title: title.trim(),
      });
      return;
    }
    if (!sourceReady) {
      setStartMsg(
        mode === "library" ? "请先选择已解析剧本。" : "请先选择或匹配 PDF 源包。",
      );
      return;
    }
    if (!investigatorId) {
      setStartMsg("请选择调查员，或选第一项「新建调查员」。");
      return;
    }
    if (mode === "library") {
      onCreate({
        mode: "library",
        moduleId,
        investigatorId,
        title: title.trim(),
      });
    } else if (mode === "pdf") {
      onCreate({
        mode: "pdf",
        sourceBundlePath: bundlePath,
        investigatorId,
        title: title.trim(),
        era: era === ERA_FOLLOW_SOURCE ? "" : era,
      });
    }
  };

  /* ── Step 1 · 三选一 ─────────────────────────────── */
  if (!mode) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <button
            type="button"
            onClick={onBack}
            className="mb-8 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            返回战役
          </button>
          <p className="text-xs font-medium tracking-[0.25em] text-primary uppercase">
            New Campaign
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold text-foreground">
            开一场新的遭遇
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            选择剧本来源，Keeper 将为你铺开故事。
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {MODE_CARDS.map(({ id, label, desc, Icon }) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(id);
                  setStartMsg(null);
                  if (id !== "starter" && !investigatorId) {
                    setInvestigatorId(NEW_INVESTIGATOR);
                  }
                }}
                className={cn(
                  "group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 text-left",
                  "transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
                )}
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    {label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Step 2 · 模式配置 ───────────────────────────── */
  const modeLabel =
    mode === "starter" ? "预置剧本" : mode === "library" ? "已解析剧本" : "PDF 源包";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <button
          type="button"
          onClick={() => {
            setMode(null);
            setStartMsg(null);
          }}
          className="mb-8 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          重新选择来源
        </button>
        <p className="text-xs font-medium tracking-[0.25em] text-primary uppercase">
          {modeLabel}
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold text-foreground">
          配置这场遭遇
        </h1>

        <div className="mt-8 space-y-5">
          {mode === "starter" && (
            <>
              <Field label="剧本">
                <Select
                  value={scenarioId || undefined}
                  onValueChange={(v) => {
                    setScenarioId(v);
                    setPregenId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择剧本…" />
                  </SelectTrigger>
                  <SelectContent>
                    {starters.map((s) => (
                      <SelectItem key={s.scenario_id} value={s.scenario_id}>
                        {s.title}（{s.era ?? "?"}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {starter?.one_liner && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {starter.one_liner}
                  </p>
                )}
              </Field>
              <Field label="调查员来源">
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setCharSource("pregen")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      charSource === "pregen"
                        ? "border-primary/60 bg-primary/5"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <span className="block text-sm font-medium text-foreground">
                      预设角色卡
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      使用剧本自带调查员，立即开始
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCharSource("new")}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-colors",
                      charSource === "new"
                        ? "border-primary/60 bg-primary/5"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <span className="block text-sm font-medium text-foreground">
                      自己创建
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      开局后由 KP 引导逐步建卡
                    </span>
                  </button>
                </div>
              </Field>
              {charSource === "pregen" ? (
                <Field label="预设角色卡">
                  <Select
                    value={pregenId || undefined}
                    onValueChange={setPregenId}
                    disabled={!starter}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择预生成调查员…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(starter?.pregens ?? []).map((p) => (
                        <SelectItem key={p.pregen_id} value={p.pregen_id}>
                          {p.name ?? p.pregen_id}
                          {p.occupation ? ` · ${p.occupation}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <p className="rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  开局后主界面由 KP 按
                  <code className="mx-1">coc-character</code>
                  skill 引导建卡（与 CLI 相同）：选择属性生成方式、职业、技能与背景，无需预先填表。
                </p>
              )}
            </>
          )}

          {mode === "library" && (
            <>
              <p className="text-xs text-muted-foreground">
                从已编译库安装到新战役（跨战役复用，不重解析 PDF）。
              </p>
              <Field label="已解析剧本">
                {libraryModules.length ? (
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-2">
                    {libraryModules.map((m) => {
                      const selected = m.canonical_module_id === moduleId;
                      return (
                        <button
                          key={m.canonical_module_id}
                          type="button"
                          onClick={() => {
                            setModuleId(m.canonical_module_id);
                            if (!title) {
                              setTitle(m.title || m.canonical_module_id);
                            }
                          }}
                          className={cn(
                            "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                            selected
                              ? "border-primary/60 bg-primary/5"
                              : "border-transparent hover:bg-secondary",
                          )}
                        >
                          <span
                            className={cn(
                              "block text-sm font-medium",
                              selected ? "text-primary" : "text-foreground",
                            )}
                          >
                            {m.title || m.canonical_module_id}
                            {m.chapter ? ` · ${m.chapter}` : ""}
                          </span>
                          {selected && (
                            <span className="mt-0.5 block break-all text-[11px] text-muted-foreground">
                              <code>
                                {m.location_hint ||
                                  `.coc/module-library/${m.canonical_module_id}/`}
                              </code>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
                    剧本库为空。编译完成的模组会出现在
                    <code className="mx-1">.coc/module-library/</code>。
                  </p>
                )}
              </Field>
            </>
          )}

          {mode === "pdf" && (
            <>
              <p className="text-xs text-muted-foreground">
                源包：<code>.coc/source-bundles/&lt;id&gt;/</code>（仅做 SHA-256
                登记，不重复解析）
              </p>
              <div
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40",
                  uploadBusy && "pointer-events-none opacity-70",
                )}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void handlePdfFile(e.dataTransfer.files?.[0] ?? null);
                }}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    fileRef.current?.click();
                  }
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  onChange={(e) => {
                    void handlePdfFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                {uploadBusy ? (
                  <Loader2 className="size-8 animate-spin text-primary" />
                ) : uploadInfo ? (
                  <FileText className="size-8 text-primary" />
                ) : (
                  <UploadCloud className="size-8 text-muted-foreground" />
                )}
                <div className="text-sm font-medium text-foreground">
                  {uploadBusy
                    ? `解析中… 已用 ${uploadElapsed}s（大模组可能需要几分钟）`
                    : uploadInfo
                      ? uploadInfo.filename
                      : "拖拽 PDF 到此处，或点击选择"}
                </div>
                <div className="text-xs text-muted-foreground">
                  自动哈希；若已有相同源包则直接选用
                </div>
              </div>
              {uploadMsg && (
                <p
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    uploadInfo?.status === "matched_bundle"
                      ? "border-success/40 bg-success-soft text-success"
                      : uploadInfo
                        ? "border-warning/40 bg-warning-soft text-warning"
                        : "border-destructive/40 bg-destructive-soft text-destructive",
                  )}
                >
                  {uploadMsg}
                </p>
              )}
              <div className="block">
                <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted-foreground">
                  PDF 源包
                </span>
                <SourceBundlePicker
                  bundles={bundles}
                  value={bundlePath}
                  disabled={uploadBusy || Boolean(bundleClearBusy)}
                  clearingId={bundleClearBusy}
                  onSelect={(next) => {
                    setBundlePath(next);
                    const b = bundles.find((x) => x.path === next);
                    if (b && !title) setTitle(b.title || b.bundle_id);
                  }}
                  onClear={(b) => {
                    void handleClearSourceBundle(b);
                  }}
                />
                {bundleClearMsg && (
                  <p className="mt-1.5 rounded-lg border border-destructive/40 bg-destructive-soft px-3 py-2 text-xs text-destructive">
                    {bundleClearMsg}
                  </p>
                )}
                {selectedBundle && (
                  <p className="mt-1.5 break-all text-xs text-muted-foreground">
                    <code>{selectedBundle.location_hint || selectedBundle.path}</code>
                  </p>
                )}
              </div>
              <Field label="故事年代">
                <Select value={era} onValueChange={setEra}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择故事年代…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ERA_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  推荐「跟随模组源事实」：不预先声明年代，开局评审从模组原文建立，避免与源事实冲突。
                </p>
              </Field>
            </>
          )}

          {mode !== "starter" && (
            <Field label="调查员">
              <Select
                value={investigatorId || NEW_INVESTIGATOR}
                onValueChange={(v) => {
                  setInvestigatorId(v);
                  setStartMsg(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择调查员…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_INVESTIGATOR}>
                    ＋ 新建调查员…
                  </SelectItem>
                  {investigators.map((inv) => (
                    <SelectItem key={inv.investigator_id} value={inv.investigator_id}>
                      {inv.name ?? inv.investigator_id}
                      {inv.occupation ? ` · ${inv.occupation}` : ""}
                      {inv.era ? ` · ${inv.era}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {investigatorId === NEW_INVESTIGATOR && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  选「新建」后点开局：主界面由 KP 按
                  <code className="mx-1">coc-character</code>
                  skill 引导建卡（与 CLI 相同），无需在此填表。
                </p>
              )}
            </Field>
          )}

          <Field label="战役标题（可选）">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="战役标题（可选）"
            />
          </Field>

          {startMsg && (
            <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
              {startMsg}
            </p>
          )}

          <Separator />

          <div className="flex items-center justify-end gap-3 pb-4">
            <Button variant="ghost" onClick={onBack} disabled={busy}>
              取消
            </Button>
            <Button disabled={!canStart} onClick={handleStart} className="min-w-28">
              {busy || uploadBusy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  开局中…
                </>
              ) : (
                "开局"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function bundleOptionLabel(b: SourceBundle) {
  const title = b.title || b.bundle_id;
  return typeof b.page_count === "number" ? `${title} · ${b.page_count} 页` : title;
}

function SourceBundlePicker({
  bundles,
  value,
  disabled,
  clearingId,
  onSelect,
  onClear,
}: {
  bundles: SourceBundle[];
  value: string;
  disabled?: boolean;
  clearingId: string | null;
  onSelect: (path: string) => void;
  onClear: (bundle: SourceBundle) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = bundles.find((b) => b.path === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          !selected && "text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">
          {selected ? bundleOptionLabel(selected) : "选择已有 PDF 源包…"}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className="flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onSelect("");
              setOpen(false);
            }}
          >
            （不选择）
          </button>
          {bundles.map((b) => (
            <div
              key={b.bundle_id}
              className="flex w-full items-center gap-1 rounded-sm hover:bg-accent hover:text-accent-foreground"
            >
              <button
                type="button"
                role="option"
                aria-selected={value === b.path}
                className="min-w-0 flex-1 cursor-default truncate px-2 py-1.5 text-left text-sm outline-hidden"
                onClick={() => {
                  onSelect(b.path);
                  setOpen(false);
                }}
              >
                {bundleOptionLabel(b)}
              </button>
              <button
                type="button"
                title="清除此解析结果"
                aria-label="清除此解析结果"
                disabled={disabled || clearingId === b.bundle_id}
                className="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClear(b);
                }}
              >
                {clearingId === b.bundle_id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
