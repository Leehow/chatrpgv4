import { useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { BootstrapResult, PdfUploadResult } from "../types";

/** Sentinel for「新建调查员」— main panel will guide creation after 开局. */
export const NEW_INVESTIGATOR = "__new__";

export type CreateStarterArgs = {
  mode: "starter";
  scenarioId: string;
  pregenId: string;
  title: string;
};

export type CreatePdfArgs = {
  mode: "pdf";
  sourceBundlePath: string;
  /** Existing investigator id, or `NEW_INVESTIGATOR` to create in main UI. */
  investigatorId: string;
  title: string;
};

export type CreateLibraryArgs = {
  mode: "library";
  moduleId: string;
  investigatorId: string;
  title: string;
};

interface Props {
  bootstrap: BootstrapResult | null;
  activeCampaign: string | null;
  busy: boolean;
  onOpen: (campaignId: string) => void;
  onCreate: (args: CreateStarterArgs | CreatePdfArgs | CreateLibraryArgs) => void;
  onBootstrapRefresh?: () => Promise<void>;
}

type SourceMode = "starter" | "pdf" | "library";

export function Sidebar({
  bootstrap,
  activeCampaign,
  busy,
  onOpen,
  onCreate,
  onBootstrapRefresh,
}: Props) {
  const [filter, setFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [mode, setMode] = useState<SourceMode>("starter");
  const [scenarioId, setScenarioId] = useState("");
  const [pregenId, setPregenId] = useState("");
  const [bundlePath, setBundlePath] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [investigatorId, setInvestigatorId] = useState(NEW_INVESTIGATOR);
  const [title, setTitle] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<PdfUploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const campaigns = useMemo(() => {
    const list = bootstrap?.campaigns ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((c) =>
      [c.campaign_id, c.title ?? "", c.active_scenario_id ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [bootstrap, filter]);

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
      ? Boolean(scenarioId && pregenId)
      : mode === "library"
        ? Boolean(moduleId)
        : Boolean(bundlePath && !uploadBusy);

  const invReady =
    mode === "starter" ? true : Boolean(investigatorId); /* includes __new__ */

  const canStart = sourceReady && invReady && !busy && !uploadBusy;

  const handlePdfFile = async (file: File | null) => {
    if (!file) return;
    setUploadBusy(true);
    setUploadMsg(null);
    setUploadInfo(null);
    try {
      const resp = await api.uploadPdf(file);
      setUploadInfo(resp.result);
      setUploadMsg(resp.result.message ?? "上传完成");
      if (resp.result.matched_bundle?.path) {
        setBundlePath(resp.result.matched_bundle.path);
        if (!title) {
          setTitle(
            resp.result.matched_bundle.title ||
              resp.result.matched_bundle.bundle_id,
          );
        }
      }
      if (onBootstrapRefresh) await onBootstrapRefresh();
    } catch (e) {
      setUploadMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadBusy(false);
    }
  };

  const handleStart = () => {
    setStartMsg(null);
    if (mode === "starter") {
      if (!canStart) return;
      onCreate({
        mode: "starter",
        scenarioId,
        pregenId,
        title: title.trim(),
      });
      setShowNew(false);
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
    } else {
      onCreate({
        mode: "pdf",
        sourceBundlePath: bundlePath,
        investigatorId,
        title: title.trim(),
      });
    }
    setShowNew(false);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <h2>战役</h2>
        <button
          className="btn btn--ghost"
          onClick={() => setShowNew((v) => !v)}
          disabled={busy}
          title="从剧本或 PDF 源包开局"
        >
          {showNew ? "收起" : "＋ 新战役"}
        </button>
      </div>

      {showNew && (
        <div className="new-campaign">
          <div className="new-campaign__modes new-campaign__modes--3">
            {(
              [
                ["starter", "预置剧本"],
                ["library", "已解析剧本"],
                ["pdf", "PDF 源包"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={
                  "btn btn--ghost new-campaign__mode" +
                  (mode === id ? " new-campaign__mode--active" : "")
                }
                onClick={() => {
                  setMode(id);
                  setStartMsg(null);
                  if (id !== "starter" && !investigatorId) {
                    setInvestigatorId(NEW_INVESTIGATOR);
                  }
                }}
                disabled={busy}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "starter" ? (
            <>
              <select
                value={scenarioId}
                onChange={(e) => {
                  setScenarioId(e.target.value);
                  setPregenId("");
                }}
              >
                <option value="">选择剧本…</option>
                {starters.map((s) => (
                  <option key={s.scenario_id} value={s.scenario_id}>
                    {s.title}（{s.era ?? "?"}）
                  </option>
                ))}
              </select>
              <select
                value={pregenId}
                onChange={(e) => setPregenId(e.target.value)}
                disabled={!starter}
              >
                <option value="">选择预生成调查员…</option>
                {(starter?.pregens ?? []).map((p) => (
                  <option key={p.pregen_id} value={p.pregen_id}>
                    {p.name ?? p.pregen_id}
                    {p.occupation ? ` · ${p.occupation}` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              {mode === "library" ? (
                <>
                  <p className="new-campaign__hint">
                    从已编译库安装到新战役（跨战役复用，不重解析 PDF）。
                  </p>
                  <select
                    value={moduleId}
                    onChange={(e) => {
                      setModuleId(e.target.value);
                      const m = libraryModules.find(
                        (x) => x.canonical_module_id === e.target.value,
                      );
                      if (m && !title) setTitle(m.title || m.canonical_module_id);
                    }}
                  >
                    <option value="">选择已解析剧本…</option>
                    {libraryModules.map((m) => (
                      <option
                        key={m.canonical_module_id}
                        value={m.canonical_module_id}
                      >
                        {m.title || m.canonical_module_id}
                        {m.chapter ? ` · ${m.chapter}` : ""}
                      </option>
                    ))}
                  </select>
                  {selectedModule && (
                    <p className="new-campaign__hint">
                      <code>
                        {selectedModule.location_hint ||
                          `.coc/module-library/${selectedModule.canonical_module_id}/`}
                      </code>
                    </p>
                  )}
                  {!libraryModules.length && (
                    <p className="new-campaign__hint new-campaign__hint--warn">
                      剧本库为空。编译完成的模组会出现在
                      <code> .coc/module-library/ </code>。
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="new-campaign__hint">
                    源包：
                    <code>.coc/source-bundles/&lt;id&gt;/</code>
                  </p>
                  <div
                    className={
                      "pdf-drop" +
                      (dragOver ? " pdf-drop--active" : "") +
                      (uploadBusy ? " pdf-drop--busy" : "")
                    }
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
                      accept="application/pdf,.pdf"
                      hidden
                      onChange={(e) => {
                        void handlePdfFile(e.target.files?.[0] ?? null);
                        e.target.value = "";
                      }}
                    />
                    <div className="pdf-drop__title">
                      {uploadBusy ? "上传中…" : "拖拽 PDF 到此处，或点击选择"}
                    </div>
                    <div className="pdf-drop__sub">
                      自动哈希；若已有相同源包则直接选用
                    </div>
                  </div>
                  {uploadMsg && (
                    <p
                      className={
                        "new-campaign__hint" +
                        (uploadInfo?.status === "matched_bundle"
                          ? " new-campaign__hint--ok"
                          : " new-campaign__hint--warn")
                      }
                    >
                      {uploadMsg}
                    </p>
                  )}
                  <select
                    value={bundlePath}
                    onChange={(e) => {
                      setBundlePath(e.target.value);
                      const b = bundles.find((x) => x.path === e.target.value);
                      if (b && !title) setTitle(b.title || b.bundle_id);
                    }}
                  >
                    <option value="">选择已有 PDF 源包…</option>
                    {bundles.map((b) => (
                      <option key={b.bundle_id} value={b.path}>
                        {b.title || b.bundle_id}
                        {typeof b.page_count === "number"
                          ? ` · ${b.page_count} 页`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {selectedBundle && (
                    <p className="new-campaign__hint">
                      <code>
                        {selectedBundle.location_hint || selectedBundle.path}
                      </code>
                    </p>
                  )}
                </>
              )}

              <select
                value={investigatorId}
                onChange={(e) => {
                  setInvestigatorId(e.target.value);
                  setStartMsg(null);
                }}
              >
                <option value={NEW_INVESTIGATOR}>＋ 新建调查员…</option>
                {investigators.map((inv) => (
                  <option key={inv.investigator_id} value={inv.investigator_id}>
                    {inv.name ?? inv.investigator_id}
                    {inv.occupation ? ` · ${inv.occupation}` : ""}
                    {inv.era ? ` · ${inv.era}` : ""}
                  </option>
                ))}
              </select>
              {investigatorId === NEW_INVESTIGATOR && (
                <p className="new-campaign__hint">
                  选「新建」后点开局：中间主界面由 KP 按
                  <code> coc-character </code>
                  skill 引导建卡（与 CLI 相同），无需在侧栏填表。
                </p>
              )}
            </>
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="战役标题（可选）"
          />
          {startMsg && (
            <p className="new-campaign__hint new-campaign__hint--warn">
              {startMsg}
            </p>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canStart}
            onClick={handleStart}
          >
            {busy ? "开局中…" : "开局"}
          </button>
        </div>
      )}

      <input
        className="sidebar__filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="筛选战役…"
      />

      <div className="sidebar__list">
        {campaigns.map((c) => {
          const incompatible = c.compatible === false;
          return (
            <button
              key={c.campaign_id}
              className={
                "campaign" +
                (c.campaign_id === activeCampaign ? " campaign--active" : "") +
                (incompatible ? " campaign--disabled" : "")
              }
              onClick={() => !incompatible && onOpen(c.campaign_id)}
              disabled={busy || incompatible}
              title={
                incompatible
                  ? `旧版存档（schema v${c.schema_version ?? "?"}），当前运行时不做迁移，无法加入`
                  : undefined
              }
            >
              <span className="campaign__title">
                {c.title || c.campaign_id}
                {incompatible && (
                  <span className="campaign__badge">旧版存档</span>
                )}
              </span>
              <span className="campaign__meta">
                {c.active_scenario_id ?? "—"}
                {c.status ? ` · ${c.status}` : ""}
              </span>
            </button>
          );
        })}
        {!campaigns.length && (
          <p className="sidebar__empty">
            {bootstrap ? "没有匹配的战役" : "载入中…"}
          </p>
        )}
      </div>
    </aside>
  );
}
