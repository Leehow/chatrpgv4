import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import * as api from "../api";
import type { ModelEditorState } from "../api";
import { ProviderLoginPanel } from "./ProviderLoginPanel";
import {
  duplicatedFeaturedIds,
  isFeaturedRowShown,
  menuHiddenProviderIds,
  toggleFeaturedRow,
} from "../lib/provider-visibility";

function catalogRowShown(
  id: string,
  hidden: Set<string>,
  extra: Set<string>,
  installed: Set<string>,
) {
  if (hidden.has(id)) return false;
  return extra.has(id) || installed.has(id);
}

const FEATURED_OAUTH: ModelEditorState["oauthProviders"] = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    note: "Claude Pro/Max 订阅账户，浏览器授权登录；也可用 API Key。",
    methods: ["oauth", "api_key"],
  },
  {
    id: "openai-codex",
    label: "OpenAI ChatGPT",
    note: "ChatGPT Plus/Pro 订阅账户，浏览器或设备码登录。",
    methods: ["oauth"],
  },
  {
    id: "xai",
    label: "xAI Grok",
    note: "SuperGrok / X Premium 订阅设备码登录；也可用 API Key。",
    methods: ["oauth", "api_key"],
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    note: "GitHub Copilot 订阅账户，设备码登录。",
    methods: ["oauth"],
  },
];

const FEATURED_PRESETS: ModelEditorState["presets"] = [
  { id: "deepseek", label: "DeepSeek", note: "需要 DeepSeek API Key（platform.deepseek.com）。", baseUrl: "https://api.deepseek.com" },
  { id: "xai", label: "xAI Grok", note: "需要 xAI API Key（console.x.ai）。", baseUrl: "https://api.x.ai/v1" },
  { id: "zhipu", label: "智谱 GLM", note: "需要智谱 API Key（bigmodel.cn）。", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
];

async function fallbackFromModels(): Promise<ModelEditorState> {
  const models = await api.fetchModels();
  const providers = Object.entries(models.providers || {}).map(([id, cfg]) => ({
    id,
    name: cfg.label || id,
    baseUrl: "",
    hasAuth: Boolean(cfg.hasAuth),
    models: (cfg.models || []).map((m) => ({ id: m.id, name: m.label || m.id })),
  }));
  return {
    oauthProviders: FEATURED_OAUTH,
    presets: FEATURED_PRESETS,
    catalogProviders: [],
    providers,
    hiddenProviderIds: [],
    extraProviderIds: [],
    customProviders: [],
    writable: false,
  };
}

function normalizeEditorState(raw: ModelEditorState): ModelEditorState {
  return {
    oauthProviders: raw.oauthProviders || [],
    presets: (raw.presets || []).filter((p) => p.id),
    catalogProviders: raw.catalogProviders || [],
    providers: raw.providers || [],
    hiddenProviderIds: raw.hiddenProviderIds || [],
    extraProviderIds: raw.extraProviderIds || [],
    customProviders: raw.customProviders || [],
    writable: raw.writable !== false,
  };
}

async function loadEditorState(): Promise<ModelEditorState> {
  const desktop = (
    window as {
      cocDesktop?: {
        getWizardState?: () => Promise<ModelEditorState & { unavailable?: boolean }>;
      };
    }
  ).cocDesktop;
  if (desktop?.getWizardState) {
    try {
      const state = await desktop.getWizardState();
      if (state && !state.unavailable) return normalizeEditorState({ ...state, writable: true });
    } catch {
      /* fall through to HTTP */
    }
  }
  try {
    return normalizeEditorState(await api.fetchModelEditor());
  } catch {
    return fallbackFromModels();
  }
}

async function saveEditorList(payload: {
  hidden: string[];
  custom: { id: string; label: string; baseUrl: string; note?: string }[];
  extra: string[];
}): Promise<{ ok: boolean; errors?: string[] }> {
  const desktop = (
    window as {
      cocDesktop?: {
        saveProviderList?: (payload: {
          hidden: string[];
          custom: { id: string; label: string; baseUrl: string; note?: string }[];
          extra: string[];
        }) => Promise<{ ok: boolean; errors?: string[] }>;
      };
    }
  ).cocDesktop;
  if (desktop?.saveProviderList) {
    try {
      return await desktop.saveProviderList(payload);
    } catch {
      /* fall through to HTTP */
    }
  }
  return api.saveModelEditor(payload);
}

export function EditModelsDialog({
  open,
  onClose,
  onChanged,
  embedded = false,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: (hidden: string[]) => void;
  embedded?: boolean;
}) {
  const [state, setState] = useState<ModelEditorState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [showMore, setShowMore] = useState(false);
  const [customList, setCustomList] = useState<ModelEditorState["customProviders"]>([]);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [keyRow, setKeyRow] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [keyModel, setKeyModel] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [loginTarget, setLoginTarget] = useState<{ id: string; label: string; note: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const next = await loadEditorState();
      setState(next);
      setHidden(new Set(next.hiddenProviderIds));
      setExtra(new Set(next.extraProviderIds));
      setCustomList(next.customProviders);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setState(null);
    setLoadError(null);
    setShowMore(false);
    setLabel("");
    setBaseUrl("");
    setErrors([]);
    setKeyRow(null);
    setKeyValue("");
    setKeyModel("");
    setLoginTarget(null);
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (loginTarget) return;
      if (keyRow) {
        setKeyRow(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, loginTarget, keyRow]);

  const featuredIds = useMemo(
    () =>
      new Set([
        ...(state?.oauthProviders || []).map((p) => p.id),
        ...(state?.presets || []).map((p) => p.id).filter(Boolean),
      ]),
    [state],
  );
  const duplicated = useMemo(
    () =>
      duplicatedFeaturedIds(
        (state?.oauthProviders || []).map((p) => p.id),
        (state?.presets || []).map((p) => p.id).filter(Boolean),
      ),
    [state],
  );
  const builtinIds = useMemo(
    () => new Set([...featuredIds, ...(state?.catalogProviders || []).map((p) => p.id)]),
    [featuredIds, state],
  );
  const installedIds = useMemo(
    () => new Set((state?.providers || []).map((p) => p.id)),
    [state],
  );
  const installed = useMemo(() => {
    const known = new Set([
      ...builtinIds,
      ...(state?.customProviders || []).map((c) => c.id),
    ]);
    return (state?.providers || []).filter((p) => !known.has(p.id));
  }, [builtinIds, state]);
  const authById = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of state?.providers || []) map.set(p.id, p.hasAuth);
    return map;
  }, [state]);

  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  const apply = useCallback(
    async (nextHidden: Set<string>, nextCustom: ModelEditorState["customProviders"], nextExtra: Set<string>) => {
      setApplying(true);
      const result = await saveEditorList({
        hidden: [...nextHidden],
        custom: nextCustom,
        extra: [...nextExtra],
      });
      setApplying(false);
      if (result.ok) onChanged(menuHiddenProviderIds([...nextHidden], duplicated));
      else setErrors(result.errors || ["保存失败"]);
    },
    [duplicated, onChanged],
  );

  const toggle = (id: string, kind?: string) => {
    let next: Set<string>;
    if (kind === "oauth" || kind === "api_key") {
      next = toggleFeaturedRow(kind, id, hidden, duplicated);
    } else {
      next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    setHidden(next);
    void apply(next, customList, extra);
  };

  const toggleCatalog = (id: string) => {
    const nextHidden = new Set(hidden);
    const nextExtra = new Set(extra);
    if (catalogRowShown(id, nextHidden, nextExtra, installedIds)) {
      nextExtra.delete(id);
      nextHidden.add(id);
    } else {
      nextHidden.delete(id);
      nextExtra.add(id);
    }
    setHidden(nextHidden);
    setExtra(nextExtra);
    void apply(nextHidden, customList, nextExtra);
  };

  const addCustom = () => {
    setErrors([]);
    const name = label.trim();
    const url = baseUrl.trim().replace(/\/+$/, "");
    const id = slug(name);
    if (!name) {
      setErrors(["请填写提供方名称"]);
      return;
    }
    if (!id) {
      setErrors(["名称需包含拉丁字母或数字（用于生成提供方 ID）"]);
      return;
    }
    if (!/^https?:\/\//.test(url)) {
      setErrors(["Base URL 必须以 http(s):// 开头"]);
      return;
    }
    if (builtinIds.has(id) || customList.some((c) => c.id === id)) {
      setErrors([`提供方 ID「${id}」已存在，请换个名称`]);
      return;
    }
    const next = [...customList, { id, label: name, baseUrl: url }];
    setCustomList(next);
    setLabel("");
    setBaseUrl("");
    void apply(hidden, next, extra);
  };

  const removeCustom = (id: string) => {
    const next = customList.filter((c) => c.id !== id);
    setCustomList(next);
    void apply(hidden, next, extra);
  };

  const presetById = useMemo(() => {
    const map = new Map((state?.presets || []).map((p) => [p.id, p]));
    return map;
  }, [state]);

  const saveKey = async (entry: { id: string; label: string; kind: string; note: string }) => {
    setKeySaving(true);
    setErrors([]);
    const preset = presetById.get(entry.id);
    const custom = customList.find((c) => c.id === entry.id);
    const catalog = (state?.catalogProviders || []).find((p) => p.id === entry.id);
    const payload = {
      id: entry.id,
      apiKey: keyValue,
      label: entry.label,
      baseUrl: preset?.baseUrl || custom?.baseUrl || catalog?.baseUrl,
      models: preset?.models || (keyModel.trim() ? [{ id: keyModel.trim() }] : undefined),
    };
    let result: { ok: boolean; errors?: string[] };
    try {
      result = await api.saveModelEditorProvider(payload);
    } catch {
      const desktop = (
        window as { cocDesktop?: { saveProvider?: (p: typeof payload) => Promise<{ ok: boolean; errors?: string[] }> } }
      ).cocDesktop;
      result = desktop?.saveProvider
        ? await desktop.saveProvider(payload)
        : { ok: false, errors: ["无法保存 API Key"] };
    }
    setKeySaving(false);
    if (result.ok) {
      setKeyRow(null);
      setKeyValue("");
      setKeyModel("");
      await refresh();
      onChanged(menuHiddenProviderIds([...hidden], duplicated));
    } else {
      setErrors(result.errors || ["保存失败"]);
    }
  };

  if (!open) return null;

  const row = (
    entry: {
      id: string;
      label: string;
      note: string;
      kind: "oauth" | "api_key" | "custom" | "installed" | "ambient";
      fromCatalog?: boolean;
    },
    canDelete: boolean,
    onToggle?: (id: string) => void,
  ) => {
    const shown = entry.fromCatalog
      ? catalogRowShown(entry.id, hidden, extra, installedIds)
      : entry.kind === "oauth" || entry.kind === "api_key"
        ? isFeaturedRowShown(entry.kind, entry.id, hidden, duplicated)
        : !hidden.has(entry.id);
    const authed = authById.get(entry.id) === true;
    const rowKey = `${entry.kind}-${entry.id}`;
    const canAuth = entry.kind === "oauth" || entry.kind === "api_key" || entry.kind === "custom";
    const kindLabel =
      entry.kind === "oauth"
        ? "订阅登录"
        : entry.kind === "installed"
          ? "已安装"
          : entry.kind === "ambient"
            ? "环境凭据"
            : "API Key";
    return (
      <li
        key={rowKey}
        className={cn(
          "flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-sm",
          shown ? "border-border bg-card" : "border-border/60 bg-muted/40 opacity-70",
        )}
      >
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <input
              type="checkbox"
              checked={shown}
              onChange={() => (onToggle ? onToggle(entry.id) : toggle(entry.id, entry.kind))}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="font-medium leading-snug">{entry.label}</span>
          </label>
          {canAuth ? (
            <Button
              type="button"
              size="xs"
              variant={authed ? "outline" : "secondary"}
              className={cn(!authed && "border-warning/40 bg-warning-soft text-warning hover:bg-warning-soft")}
              onClick={() => {
                if (entry.kind === "oauth") {
                  setLoginTarget({ id: entry.id, label: entry.label, note: entry.note });
                  return;
                }
                setKeyRow((current) => (current === rowKey ? null : rowKey));
                setKeyValue("");
                setKeyModel("");
              }}
            >
              {authed ? "已配置" : "未配置"}
            </Button>
          ) : (
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                authed ? "bg-primary/10 text-primary" : "bg-warning-soft text-warning",
              )}
            >
              {authed ? "已配置" : "未配置"}
            </span>
          )}
        </div>
        <div className="flex items-start justify-between gap-2 pl-6">
          <span className="text-[11px] leading-snug text-muted-foreground">{entry.note}</span>
          {canDelete ? (
            <Button type="button" variant="ghost" size="xs" className="shrink-0 text-destructive" onClick={() => removeCustom(entry.id)}>
              删除
            </Button>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {kindLabel}
            </span>
          )}
        </div>
        {keyRow === rowKey && (
          <div className="flex flex-col gap-2 pl-6">
            <Input
              type="password"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder="粘贴 API Key"
              autoFocus
              autoComplete="off"
            />
            {(entry.kind === "custom" || !presetById.get(entry.id)?.models?.length) && (
              <Input
                value={keyModel}
                onChange={(e) => setKeyModel(e.target.value)}
                placeholder="模型 ID（留空自动获取）"
              />
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setKeyRow(null)}>
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={keySaving || !keyValue.trim()}
                onClick={() => void saveKey(entry)}
              >
                {keySaving ? "保存中…" : "保存 Key"}
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  };

  const panel = (
      <div
        role={embedded ? undefined : "dialog"}
        aria-modal={embedded ? undefined : "true"}
        aria-label={embedded ? undefined : "编辑模型"}
        className={cn(
          "flex w-full flex-col gap-3",
          embedded ? "" : "max-h-[min(36rem,100%)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-xl",
        )}
      >
        {embedded ? null : (
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">编辑模型</h2>
          <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onClose} title="关闭">
            <X className="size-4" />
          </Button>
        </div>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          勾选的提供方显示在模型菜单中。点「未配置」：订阅会打开登录，API Key 会展开输入框。
        </p>
        {!state && !loadError && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在读取提供方列表…
          </div>
        )}
        {loadError && (
          <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning">
            {loadError}
          </p>
        )}
        {state && (
          <>
            <ul className="flex flex-col gap-1.5">
              {state.oauthProviders.map((p) =>
                row({ id: p.id, label: p.label, note: p.note, kind: "oauth" }, false),
              )}
              {state.presets.map((p) =>
                row({ id: p.id, label: p.label, note: p.note, kind: "api_key" }, false),
              )}
              {customList.map((c) =>
                row({ id: c.id, label: c.label, note: c.note || c.baseUrl, kind: "custom" }, true),
              )}
              {installed.map((p) =>
                row(
                  {
                    id: p.id,
                    label: p.name || p.id,
                    note: p.baseUrl || (p.models.length ? `${p.models.length} 个模型` : "已安装提供方"),
                    kind: "installed",
                  },
                  false,
                ),
              )}
            </ul>
            {state.catalogProviders.length > 0 && (
              <Button type="button" variant="ghost" className="w-full" onClick={() => setShowMore((v) => !v)}>
                {showMore ? "收起" : `更多 · ${state.catalogProviders.length}`}
              </Button>
            )}
            {showMore && (
              <>
                <p className="text-xs text-muted-foreground">
                  勾选后出现在模型菜单；登录仍走 Pi 的 ModelRuntime。
                </p>
                <ul className="flex flex-col gap-1.5">
                  {state.catalogProviders.map((p) =>
                    row(
                      {
                        id: p.id,
                        label: p.label,
                        note: p.note,
                        fromCatalog: true,
                        kind: p.methods.includes("oauth")
                          ? "oauth"
                          : p.methods.includes("api_key")
                            ? "api_key"
                            : "ambient",
                      },
                      false,
                      toggleCatalog,
                    ),
                  )}
                </ul>
              </>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="新提供方名称（如 SiliconFlow）"
              />
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <Button type="button" variant="outline" onClick={addCustom}>
                添加
              </Button>
            </div>
            {errors.length > 0 && (
              <ul className="text-xs text-destructive">
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
            {!state.writable && (
              <p className="text-xs text-muted-foreground">
                {state.catalogProviders.length === 0
                  ? "完整目录需要退出并重新打开应用；现在只显示精选列表。"
                  : "当前环境不能保存显示列表（需要桌面应用的本机设置）。"}
              </p>
            )}
          </>
        )}
        <div className="flex items-center justify-end gap-2">
          {applying && <span className="text-xs text-muted-foreground">保存中…</span>}
          <Button type="button" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
  );

  const login = loginTarget ? (
        <ProviderLoginPanel
          provider={loginTarget}
          method="oauth"
          onDone={() => {
            setLoginTarget(null);
            void refresh().then(() => onChanged(menuHiddenProviderIds([...hidden], duplicated)));
          }}
          onCancel={() => setLoginTarget(null)}
        />
  ) : null;

  if (embedded) {
    return (
      <>
        {panel}
        {login}
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {panel}
      {login}
    </div>
  );
}
