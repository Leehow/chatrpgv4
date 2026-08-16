import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OAuthLogin, { type OAuthProvider } from "./OAuthLogin";

type PresetModel = { id: string; name?: string; input?: string[] };
type Preset = {
  id: string;
  label: string;
  api: string;
  baseUrl: string;
  models: PresetModel[];
  note: string;
};
type ProviderInfo = {
  id: string;
  name: string;
  baseUrl: string;
  hasAuth: boolean;
  models: { id: string; name: string }[];
};
type CustomProvider = { id: string; label: string; baseUrl: string; note?: string };
type State = {
  unavailable?: boolean;
  mode: "onboard" | "settings";
  agentDir: string;
  providers: ProviderInfo[];
  configured: boolean;
  presets: Preset[];
  oauthProviders?: OAuthProvider[];
  capabilities: { pdf: boolean; ocr: { enabled: boolean; reason: string } };
  logsDir: string;
  hiddenProviderIds?: string[];
  customProviders?: CustomProvider[];
};

declare global {
  interface Window {
    cocWizard: {
      getState: () => Promise<State>;
      saveProvider: (payload: unknown) => Promise<{ ok: boolean; errors?: string[] }>;
      fetchModels: (payload: { baseUrl: string; apiKey: string }) => Promise<
        { ok: true; models: string[] } | { ok: false; error: string }
      >;
      finishOnboarding: () => Promise<{ ok: boolean }>;
      saveProviderList: (payload: {
        hidden: string[];
        custom: CustomProvider[];
      }) => Promise<{ ok: boolean; errors?: string[] }>;
      openItem: (target: string) => Promise<{ ok: boolean }>;
      openUrl: (url: string) => Promise<{ ok: boolean }>;
      loginProvider: (providerId: string, method: string) => Promise<unknown>;
      respondPrompt: (promptId: number, value: string, cancel?: boolean) => () => void;
      cancelLogin: () => Promise<{ ok: boolean }>;
      onAuthEvent: (cb: (payload: unknown) => void) => () => void;
      onAuthPrompt: (cb: (payload: unknown) => void) => () => void;
      onAuthPromptDismissed: (cb: (payload: unknown) => void) => () => void;
    };
  }
}

const IS_SHEET_MODE = new URLSearchParams(window.location.search).get("mode") === "sheet";
// Top-bar pencil button opens settings with the 编辑模型 editor pre-opened.
const OPEN_EDITOR_ON_LOAD = new URLSearchParams(window.location.search).get("edit") === "1";
const IS_MAC = /Mac/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent);
const SHEET_CLASS = IS_SHEET_MODE
  ? "sheet is-sheet"
  : IS_MAC
    ? "sheet is-mac"
    : "sheet";

type RemoteModels =
  | { phase: "idle" | "loading" }
  | { phase: "done"; ids: string[]; sig: string }
  | { phase: "error"; message: string; sig: string };

function ProviderForm({
  preset,
  onSaved,
  onCancel,
}: {
  preset: Preset;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(preset.id);
  const [label, setLabel] = useState(preset.id ? preset.label : "");
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [selected, setSelected] = useState<string[]>(
    preset.models.map((m) => m.id).filter(Boolean),
  );
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [manualId, setManualId] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [remote, setRemote] = useState<RemoteModels>({ phase: "idle" });
  const fetchedSig = useRef("");

  const custom = !preset.id;

  // Auto-load the model list once Base URL + API Key look complete: debounce
  // while typing, and drop stale results tied to an older (baseUrl, key)
  // pair so the picker never offers models from a different credential.
  const trimmedBase = baseUrl.trim();
  const trimmedKey = apiKey.trim();
  const canFetch = /^https?:\/\//.test(trimmedBase) && trimmedKey.length > 0;
  const fetchSig = `${trimmedBase}\n${trimmedKey}`;

  const loadModels = useCallback(
    async (sig: string) => {
      fetchedSig.current = sig;
      setRemote({ phase: "loading" });
      const result = await window.cocWizard.fetchModels({
        baseUrl: trimmedBase,
        apiKey: trimmedKey,
      });
      if (fetchedSig.current !== sig) return;
      if (result.ok) {
        // The live catalog wins: selections that the endpoint no longer
        // offers (e.g. a stale preset default) drop out automatically.
        setSelected((prev) => prev.filter((x) => result.models.includes(x)));
        setRemote({ phase: "done", ids: result.models, sig });
      } else {
        setRemote({ phase: "error", message: result.error, sig });
      }
    },
    [trimmedBase, trimmedKey],
  );

  useEffect(() => {
    if (!canFetch || fetchSig === fetchedSig.current) return;
    const timer = setTimeout(() => void loadModels(fetchSig), 700);
    return () => clearTimeout(timer);
  }, [canFetch, fetchSig, loadModels]);

  const fetchedIds = remote.phase === "done" && remote.sig === fetchSig ? remote.ids : null;
  const fetchError = remote.phase === "error" && remote.sig === fetchSig ? remote.message : null;
  const fetchDone = fetchedIds !== null;
  const fetchFailed = fetchError !== null;
  const presetIds = preset.models.map((m) => m.id).filter(Boolean);
  // With a live list, show exactly what the endpoint offers; the preset list
  // is only the offline starting point before (or instead of) a fetch.
  const listIds = [...new Set([...(fetchedIds ?? presetIds), ...extraIds])];

  const toggleModel = (modelId: string) => {
    setSelected((prev) =>
      prev.includes(modelId) ? prev.filter((x) => x !== modelId) : [...prev, modelId],
    );
  };

  const addManual = () => {
    const mid = manualId.trim();
    if (!mid) return;
    setExtraIds((prev) => (prev.includes(mid) ? prev : [...prev, mid]));
    setSelected((prev) => (prev.includes(mid) ? prev : [...prev, mid]));
    setManualId("");
  };

  const save = useCallback(async () => {
    setSaving(true);
    setErrors([]);
    const models = selected.map((mid) => preset.models.find((m) => m.id === mid) || { id: mid });
    const result = await window.cocWizard.saveProvider({
      id,
      label: label || id,
      api: preset.api,
      baseUrl,
      apiKey,
      models,
    });
    setSaving(false);
    if (result.ok) {
      setApiKey("");
      onSaved();
    } else {
      setErrors(result.errors || ["保存失败"]);
    }
  }, [id, label, baseUrl, apiKey, selected, preset, onSaved]);

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {custom && (
        <label>
          提供方 ID（小写字母 / 数字 / 连字符）
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="my-provider" required />
        </label>
      )}
      {custom && (
        <label>
          显示名称
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="我的模型服务" />
        </label>
      )}
      <label>
        Base URL
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" required />
      </label>
      <label>
        API Key（明文保存在本机 {""}
        <code>auth.json</code>，权限 0600）
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          required
          autoComplete="off"
        />
      </label>
      <div className="model-picker">
        <div className="model-picker-head">
          <span>
            {fetchDone
              ? `从服务获取到 ${fetchedIds?.length} 个模型，点击选择`
              : presetIds.length
                ? "模型（预置清单，输入 API Key 后自动获取在线目录）"
                : "模型（输入 Base URL 与 API Key 后自动获取在线目录）"}
          </span>
          {(fetchDone || fetchFailed) && (
            <button type="button" className="link" onClick={() => void loadModels(fetchSig)}>
              重新获取
            </button>
          )}
        </div>
        {remote.phase === "loading" && <p className="hint">正在获取模型列表…</p>}
        {fetchFailed && <p className="hint">{fetchError}；可重试，或手动添加模型 ID。</p>}
        {listIds.length > 0 ? (
          <ul className="model-list">
            {listIds.map((modelId) => {
              const on = selected.includes(modelId);
              return (
                <li key={modelId}>
                  <button
                    type="button"
                    className={`model-option${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleModel(modelId)}
                  >
                    {modelId}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          remote.phase !== "loading" && <p className="hint">暂无模型。</p>
        )}
        {(fetchFailed || custom) && (
          <div className="manual-add">
            <input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
              placeholder="手动添加模型 ID"
            />
            <button type="button" className="ghost" onClick={addManual}>
              添加
            </button>
          </div>
        )}
      </div>
      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="submit" disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          返回
        </button>
      </div>
    </form>
  );
}

/** 编辑模型 modal: curate the two settings lists — check/uncheck which
 * provider cards appear, add/remove custom OpenAI-compatible providers, and
 * show which entries already carry credentials. Every change applies
 * immediately (saved + pushed to the main window on the spot); Esc/backdrop
 * merely closes, so nothing can be silently lost. */
function ProviderListEditor({
  oauthProviders,
  presets,
  custom,
  installed,
  hiddenIds,
  authById,
  onClose,
  onChanged,
}: {
  oauthProviders: OAuthProvider[];
  presets: Preset[];
  custom: CustomProvider[];
  installed: ProviderInfo[];
  hiddenIds: string[];
  authById: Map<string, boolean>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [hidden, setHidden] = useState(() => new Set(hiddenIds));
  const [customList, setCustomList] = useState<CustomProvider[]>(custom);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const builtinIds = new Set([
    ...oauthProviders.map((p) => p.id),
    ...presets.map((p) => p.id).filter(Boolean),
  ]);
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  const apply = useCallback(
    async (nextHidden: Set<string>, nextCustom: CustomProvider[]) => {
      setApplying(true);
      const result = await window.cocWizard.saveProviderList({
        hidden: [...nextHidden],
        custom: nextCustom,
      });
      setApplying(false);
      if (result.ok) onChanged();
      else setErrors(result.errors || ["保存失败"]);
    },
    [onChanged],
  );

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    void apply(next, customList);
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
    void apply(hidden, next);
  };

  const removeCustom = (id: string) => {
    const next = customList.filter((c) => c.id !== id);
    setCustomList(next);
    void apply(hidden, next);
  };

  const row = (
    entry: {
      id: string;
      label: string;
      note: string;
      kind: "oauth" | "api_key" | "custom" | "installed";
    },
    canDelete: boolean,
  ) => {
    const shown = !hidden.has(entry.id);
    const authed = authById.get(entry.id) === true;
    return (
      <li key={`${entry.kind}-${entry.id}`} className={`provider-row${shown ? "" : " off"}`}>
        <label className="provider-check">
          <input type="checkbox" checked={shown} onChange={() => toggle(entry.id)} />
          <span>{entry.label}</span>
        </label>
        <span className="provider-note" title={entry.note}>
          {entry.note}
        </span>
        <span className={`pill ${authed ? "ok" : "warn"}`}>{authed ? "已配置" : "未配置"}</span>
        {canDelete ? (
          <button type="button" className="ghost danger" onClick={() => removeCustom(entry.id)}>
            删除
          </button>
        ) : (
          <span className="pill">
            {entry.kind === "oauth" ? "订阅登录" : entry.kind === "installed" ? "已安装" : "API Key"}
          </span>
        )}
      </li>
    );
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="编辑模型">
        <h2>编辑模型</h2>
        <p className="hint">
          勾选的提供方显示在下方两个列表与顶栏模型菜单中，更改即时生效；「已配置」表示本机已有可用凭据。
        </p>
        <ul className="provider-rows">
          {oauthProviders.map((p) =>
            row({ id: p.id, label: p.label, note: p.note, kind: "oauth" }, false),
          )}
          {presets
            .filter((p) => p.id)
            .map((p) => row({ id: p.id, label: p.label, note: p.note, kind: "api_key" }, false))}
          {customList.map((c) =>
            row(
              { id: c.id, label: c.label, note: c.note || c.baseUrl, kind: "custom" },
              true,
            ),
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
        <div className="custom-add">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="新提供方名称（如 SiliconFlow）"
          />
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
          <button type="button" className="ghost" onClick={addCustom}>
            添加
          </button>
        </div>
        {errors.length > 0 && (
          <ul className="errors">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            完成
          </button>
          {applying && <span className="flash">保存中…</span>}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [oauth, setOauth] = useState<OAuthProvider | null>(null);
  const [editing, setEditing] = useState(OPEN_EDITOR_ON_LOAD);

  const refresh = useCallback(async () => {
    const next = await window.cocWizard.getState();
    setState(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hiddenSet = useMemo(() => new Set(state?.hiddenProviderIds || []), [state]);

  const authById = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of state?.providers || []) map.set(p.id, p.hasAuth);
    return map;
  }, [state]);

  // Editor rows for providers already installed into models.json (e.g. the
  // user's relays) that are neither catalog entries nor editor-added customs.
  const installedProviders = useMemo(() => {
    const catalog = new Set<string>([
      ...(state?.oauthProviders || []).map((p) => p.id),
      ...(state?.presets || []).map((p) => p.id).filter(Boolean),
      ...(state?.customProviders || []).map((c) => c.id),
    ]);
    return (state?.providers || []).filter((p) => !catalog.has(p.id));
  }, [state]);

  const currentProvider = useMemo(
    () => state?.providers.find((p) => p.hasAuth) || state?.providers[0] || null,
    [state],
  );

  // The settings API Key list merges catalog presets (minus the id="" custom
  // pseudo-preset, superseded by the 编辑模型 modal) with user-added cards.
  const apiKeyPresets = useMemo<Preset[]>(() => {
    const builtin = (state?.presets || []).filter((p) => p.id);
    const custom = (state?.customProviders || []).map<Preset>((c) => ({
      id: c.id,
      label: c.label,
      api: "openai-completions",
      baseUrl: c.baseUrl,
      models: [],
      note: c.note || "自定义提供方；点击填写 API Key 与模型。",
    }));
    return [...builtin, ...custom];
  }, [state]);

  if (!state) {
    return (
      <div className={SHEET_CLASS}>
        <header className="sheet-header">
          <h1>配置</h1>
          <p className="lede">正在读取本机设置…</p>
        </header>
        <div className="sheet-body">
          <p className="loading">读取配置中…</p>
        </div>
      </div>
    );
  }
  if (state.unavailable) {
    return (
      <div className={SHEET_CLASS}>
        <header className="sheet-header">
          <h1>配置</h1>
          <p className="lede">应用尚未完成启动。</p>
        </header>
        <div className="sheet-body">
          <p className="loading">应用尚未完成启动，请稍候…</p>
        </div>
      </div>
    );
  }

  const onboard = state.mode === "onboard";
  const oauthProviders = state.oauthProviders || [];

  if (oauth) {
    return (
      <div className={SHEET_CLASS}>
        <header className="sheet-header">
          <h1>{oauth.label}</h1>
          <p className="lede">{oauth.note}</p>
        </header>
        <div className="sheet-body">
          <OAuthLogin
            provider={oauth}
            auth={window.cocWizard as never}
            onCancel={() => setOauth(null)}
            onDone={() => {
              setOauth(null);
              if (onboard) {
                // First-run: a working provider completes onboarding; close so
                // the shell continues startup into the main window.
                void window.cocWizard.finishOnboarding().then(() => window.close());
              } else {
                void refresh();
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (preset) {
    return (
      <div className={SHEET_CLASS}>
        <header className="sheet-header">
          <h1>{preset.label}</h1>
          <p className="lede">{preset.note}</p>
        </header>
        <div className="sheet-body">
          <ProviderForm
            preset={preset}
            onCancel={() => setPreset(null)}
            onSaved={() => {
              setPreset(null);
              if (onboard) {
                // First-run: saving completes onboarding; close so the shell
                // continues startup into the main window.
                void window.cocWizard.finishOnboarding().then(() => window.close());
              } else {
                void refresh();
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (onboard) {
    return (
      <div className={SHEET_CLASS}>
        <header className="sheet-header">
          <h1>欢迎使用 COC Keeper</h1>
          <p className="lede">
            开始之前需要一个守秘人（KP）模型。用订阅账户登录，或选择提供方填入 API Key。凭据只保存在本机（
            {state.agentDir}）。
          </p>
        </header>
        <div className="sheet-body">
          {state.configured && (
            <div className="notice">
              检测到已有可用配置（{state.providers.map((p) => p.name).join("、")}）。
              <button
                className="ghost"
                onClick={() => void window.cocWizard.finishOnboarding().then(() => window.close())}
              >
                直接开始
              </button>
            </div>
          )}
          {oauthProviders.length > 0 && (
            <div className="stack">
              <h3>订阅账户登录</h3>
              <div className="card-stack">
                {oauthProviders.map((p) => (
                  <button key={p.id} className="preset" onClick={() => setOauth(p)}>
                    <strong>{p.label}</strong>
                    <span>{p.note}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="stack">
            <h3>API Key</h3>
            <div className="card-stack">
              {state.presets.map((p) => (
                <button key={p.label} className="preset" onClick={() => setPreset(p)}>
                  <strong>{p.label}</strong>
                  <span>{p.note}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="actions">
            <button
              className="ghost"
              onClick={() => void window.cocWizard.finishOnboarding().then(() => window.close())}
            >
              稍后配置（界面将没有可选模型）
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={SHEET_CLASS}>
      <header className="sheet-header">
        <h1>设置</h1>
        <p className="lede">模型与登录。凭据只保存在本机。</p>
      </header>
      <div className="sheet-body">
        <section>
          <div className="section-head">
            <h2>模型提供方</h2>
            <button
              type="button"
              className="icon-btn"
              title="编辑模型"
              aria-label="编辑模型"
              onClick={() => setEditing(true)}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M11.3 1.7a1.1 1.1 0 0 1 1.6 0l1.4 1.4a1.1 1.1 0 0 1 0 1.6l-8.2 8.2-3.8 0.8 0.8-3.8 8.2-8.2z" />
              </svg>
              编辑模型
            </button>
          </div>
          {currentProvider ? (
            <div className="status-card">
              <div className="status-card-top">
                <strong>{currentProvider.name}</strong>
                <span className={currentProvider.hasAuth ? "pill ok" : "pill warn"}>
                  {currentProvider.hasAuth ? "已配置" : "缺密钥"}
                </span>
              </div>
              {currentProvider.models.length > 0 && (
                <div className="chips">
                  {currentProvider.models.map((model) => (
                    <span className="chip" key={model.id}>
                      {model.id}
                    </span>
                  ))}
                </div>
              )}
              <p className="hint">完整列表在主界面顶栏切换。</p>
            </div>
          ) : (
            <p className="hint">尚未配置任何模型提供方。</p>
          )}
          {oauthProviders.filter((p) => !hiddenSet.has(p.id)).length > 0 && (
            <div className="stack">
              <h3>订阅账户登录</h3>
              <div className="card-stack">
                {oauthProviders
                  .filter((p) => !hiddenSet.has(p.id))
                  .map((p) => (
                    <button key={p.id} className="preset" onClick={() => setOauth(p)}>
                      <strong>{p.label}</strong>
                      <span>{p.note}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div className="stack">
            <h3>API Key</h3>
            <div className="card-stack">
              {apiKeyPresets
                .filter((p) => !hiddenSet.has(p.id))
                .map((p) => (
                  <button key={p.id} className="preset" onClick={() => setPreset(p)}>
                    <strong>{p.label}</strong>
                    <span>{p.note}</span>
                  </button>
                ))}
              {apiKeyPresets.every((p) => hiddenSet.has(p.id)) && (
                <p className="hint">没有显示中的条目，点右上「编辑模型」调整。</p>
              )}
            </div>
          </div>
        </section>

        <section>
          <h2>能力状态</h2>
          <ul className="caps">
            <li className="cap-row">
              <span className={`dot ${state.capabilities.pdf ? "ok" : "warn"}`} aria-hidden="true" />
              <span className="cap-copy">PDF 文本层解析（内置）</span>
            </li>
            <li className="cap-row">
              <span className={`dot ${state.capabilities.ocr.enabled ? "ok" : "off"}`} aria-hidden="true" />
              <span className="cap-copy">
                渐进式 OCR（外部技能）
                <span className="muted">{state.capabilities.ocr.reason}</span>
              </span>
            </li>
          </ul>
          <p className="hint">
            开场文本与必要的 PDF 视觉回退都自动跟随主界面右上角当前模型。
          </p>
          <p className="hint">
            运行日志：
            <button className="link" onClick={() => void window.cocWizard.openItem(state.logsDir)}>
              打开日志目录
            </button>
          </p>
        </section>
      </div>
      {editing && (
        <ProviderListEditor
          oauthProviders={oauthProviders}
          presets={state.presets}
          custom={state.customProviders || []}
          installed={installedProviders}
          hiddenIds={state.hiddenProviderIds || []}
          authById={authById}
          onClose={() => setEditing(false)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
