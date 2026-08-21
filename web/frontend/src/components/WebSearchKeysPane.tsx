import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "../api";
import type { WebSearchKeyProvider, WebSearchKeysView } from "../api";

const HINT_TEXT =
  "填写服务 API Key 后优先使用该搜索源；已填写密钥的服务会排到搜索路由前面。可配置 Exa、Tavily、Perplexity。已保存的密钥不会回显，只显示是否已配置。";

function emptyView(): WebSearchKeysView {
  return {
    keys: {},
    providers: [
      { id: "exa", name: "Exa", keyField: "exaApiKey" },
      { id: "tavily", name: "Tavily", keyField: "tavilyApiKey" },
      { id: "perplexity", name: "Perplexity", keyField: "perplexityApiKey" },
      { id: "openai", name: "OpenAI", keyField: "openaiApiKey" },
      { id: "searxng", name: "SearXNG", keyField: "searxngApiKey" },
    ],
  };
}

export function WebSearchKeysPane() {
  const [view, setView] = useState<WebSearchKeysView>(emptyView);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState("exa");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providers = view.providers.length ? view.providers : emptyView().providers;
  const selected: WebSearchKeyProvider = providers.find((p) => p.id === selectedId) || providers[0];
  const field = selected.keyField;

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await api.fetchWebSearchKeys();
      setView(next);
      setDrafts({});
      setError(null);
      if (!next.providers.some((p) => p.id === selectedId) && next.providers[0]) {
        setSelectedId(next.providers[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const hasKey = (keyField: string) => view.keys[keyField] === true;
  const showDraft = (keyField: string) => Object.prototype.hasOwnProperty.call(drafts, keyField);
  const draftValue = (keyField: string) => (showDraft(keyField) ? drafts[keyField] : "");

  const hasChanges = useMemo(() => {
    return providers.some((p) => {
      if (!Object.prototype.hasOwnProperty.call(drafts, p.keyField)) return false;
      const d = drafts[p.keyField];
      if (d) return true;
      return hasKey(p.keyField);
    });
  }, [drafts, providers, view.keys]);

  const saveAll = async () => {
    const keys: Record<string, string> = {};
    for (const p of providers) {
      if (Object.prototype.hasOwnProperty.call(drafts, p.keyField)) {
        keys[p.keyField] = drafts[p.keyField].trim();
      }
    }
    if (!Object.keys(keys).length) return;
    setSaving(true);
    try {
      const next = await api.saveWebSearchKeys(keys);
      setView(next);
      setDrafts({});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid="web-search-keys-pane">
      <div>
        <p className="text-sm font-medium">Web 搜索</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{HINT_TEXT}</p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground" data-testid="web-search-keys-loading">
          正在读取配置…
        </p>
      ) : (
        <>
          {error ? (
            <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning" role="alert">
              {error}
            </p>
          ) : null}
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <span>搜索源</span>
            <select
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground"
              aria-label="搜索源"
              data-testid="web-search-key-select"
              value={selected.id}
              disabled={saving}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground" data-testid={`web-search-key-row-${selected.id}`}>
            <span>{selected.name} API Key</span>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="h-9"
                aria-label={`${selected.name} API Key`}
                data-testid={`web-search-key-input-${selected.id}`}
                placeholder={hasKey(field) && !showDraft(field) ? "已配置（输入新密钥以替换）" : `输入 ${selected.name} API Key`}
                value={draftValue(field)}
                disabled={saving}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [field]: event.target.value }))}
              />
              <span
                className="shrink-0 text-xs text-muted-foreground"
                data-testid={`web-search-key-status-${selected.id}`}
              >
                {showDraft(field) ? "未保存" : hasKey(field) ? "已配置" : "未配置"}
              </span>
            </div>
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={saving || !hasChanges} data-testid="web-search-keys-save" onClick={() => void saveAll()}>
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving || !hasChanges}
              data-testid="web-search-keys-reset"
              onClick={() => {
                setDrafts({});
                setError(null);
              }}
            >
              还原
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
