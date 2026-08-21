import { cn } from "@/lib/utils";
import type { ModelsResponse } from "../types";
import { WebSearchKeysPane } from "./WebSearchKeysPane";

export type VisionSelection = {
  enabled: boolean;
  provider: string;
  model: string;
};

function visionRef(provider: string, model: string) {
  if (!provider || !model) return "";
  return `${provider}/${model}`;
}

function parseVisionRef(ref: string) {
  const i = ref.indexOf("/");
  if (i <= 0) return { provider: "", model: "" };
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

export function visionCandidates(
  models: ModelsResponse | null,
  hiddenProviders: string[],
  selected: { provider: string; model: string },
) {
  const hidden = new Set(hiddenProviders);
  const out: { provider: string; model: string; label: string; group: string }[] = [];
  for (const [provider, cfg] of Object.entries(models?.providers || {})) {
    if (hidden.has(provider)) continue;
    for (const entry of cfg.models || []) {
      if (!entry.image) continue;
      out.push({
        provider,
        model: entry.id,
        label: entry.label || entry.id,
        group: cfg.label || provider,
      });
    }
  }
  if (
    selected.provider &&
    selected.model &&
    !out.some((row) => row.provider === selected.provider && row.model === selected.model)
  ) {
    const cfg = models?.providers[selected.provider];
    const entry = cfg?.models.find((m) => m.id === selected.model);
    out.push({
      provider: selected.provider,
      model: selected.model,
      label: entry?.label || selected.model,
      group: cfg?.label || selected.provider,
    });
  }
  return out;
}

export function SettingsGeneralPane({
  models,
  hiddenProviders,
  vision,
  onVisionChange,
}: {
  models: ModelsResponse | null;
  hiddenProviders: string[];
  vision: VisionSelection;
  onVisionChange: (next: VisionSelection) => void;
}) {
  const candidates = visionCandidates(models, hiddenProviders, {
    provider: vision.provider,
    model: vision.model,
  });
  const groups = new Map<string, typeof candidates>();
  for (const row of candidates) {
    const list = groups.get(row.group) || [];
    list.push(row);
    groups.set(row.group, list);
  }
  const value = visionRef(vision.provider, vision.model);

  return (
    <div className="flex flex-col gap-4" data-testid="settings-general">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">识图模型</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            主线模型不支持图片时，用指定识图模型识别图片。仅列出已勾选且支持图片的模型。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={vision.enabled}
          aria-label="启用识图模型"
          data-testid="vision-enabled-switch"
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            vision.enabled ? "bg-primary" : "bg-muted",
          )}
          onClick={() => {
            if (vision.enabled) {
              onVisionChange({ enabled: false, provider: "", model: "" });
              return;
            }
            onVisionChange({
              enabled: true,
              provider: vision.provider,
              model: vision.model,
            });
          }}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 size-5 rounded-full bg-card shadow transition-transform",
              vision.enabled ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <span>识图模型</span>
        <select
          className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="识图模型"
          data-testid="vision-model-select"
          value={value}
          disabled={!vision.enabled}
          onChange={(event) => {
            const next = parseVisionRef(event.target.value);
            onVisionChange({ enabled: true, ...next });
          }}
        >
          <option value="">未选择识图模型</option>
          {[...groups.entries()].map(([group, rows]) => (
            <optgroup key={group} label={group}>
              {rows.map((row) => (
                <option key={visionRef(row.provider, row.model)} value={visionRef(row.provider, row.model)}>
                  {row.label}（{visionRef(row.provider, row.model)}）
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <WebSearchKeysPane />
    </div>
  );
}
