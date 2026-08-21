import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "../api";
import type { OcrTokenView } from "../api";

const HINT_TEXT =
  "百度飞桨 OCR Token 写入本机 secrets.env（COC_KEEPER_ENV_FILE，默认 ~/.config/coc-keeper/secrets.env 的 BAIDUOCR_TOKEN）。已保存的密钥不会回显，只显示是否已配置。";

export function OcrSecretsPane() {
  const [view, setView] = useState<OcrTokenView>({ configured: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showDraft = draft !== null;
  const draftValue = showDraft ? draft : "";
  const hasDraft = showDraft;
  const canSave = Boolean(draftValue.trim());
  const canClear = view.configured || Boolean(draftValue);
  const canRestore = hasDraft;

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await api.fetchOcrToken();
      setView(next);
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const persist = async (token: string) => {
    setSaving(true);
    try {
      const next = await api.saveOcrToken(token);
      setView(next);
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = showDraft ? "未保存" : view.configured ? "已配置" : "未配置";

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4" data-testid="ocr-secrets-pane">
      <div>
        <p className="text-sm font-medium">百度飞桨 OCR</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{HINT_TEXT}</p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground" data-testid="ocr-token-loading">
          正在读取配置…
        </p>
      ) : (
        <>
          {error ? (
            <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning" role="alert">
              {error}
            </p>
          ) : null}
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground" data-testid="ocr-token-row">
            <span>OCR Token</span>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="h-9"
                aria-label="百度飞桨 OCR Token"
                data-testid="ocr-token-input"
                placeholder={view.configured && !showDraft ? "已配置（输入新密钥以替换）" : "输入 BAIDUOCR_TOKEN"}
                value={draftValue}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
              />
              <span className="shrink-0 text-xs text-muted-foreground" data-testid="ocr-token-status">
                {statusLabel}
              </span>
            </div>
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || !canSave}
              data-testid="ocr-token-save"
              onClick={() => void persist(draftValue.trim())}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving || !canClear}
              data-testid="ocr-token-clear"
              onClick={() => void persist("")}
            >
              清除
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving || !canRestore}
              data-testid="ocr-token-reset"
              onClick={() => {
                setDraft(null);
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
