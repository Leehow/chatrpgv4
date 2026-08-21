import type { ModelsResponse } from "./types";

export type PortraitImageSelection = {
  provider: string;
  model: string;
};

export function isOfficialXaiKeeper(provider: string | null | undefined): boolean {
  return String(provider || "").trim().toLowerCase() === "xai";
}

export function portraitImageCandidates(
  models: ModelsResponse | null,
  hiddenProviders: string[],
  selected: { provider: string; model: string },
) {
  const hidden = new Set(hiddenProviders);
  const out: { provider: string; model: string; label: string; group: string; retained: boolean }[] = [];
  for (const [provider, cfg] of Object.entries(models?.providers || {})) {
    if (hidden.has(provider)) continue;
    for (const entry of cfg.models || []) {
      out.push({
        provider,
        model: entry.id,
        label: entry.label || entry.id,
        group: cfg.label || provider,
        retained: false,
      });
    }
  }
  const retained =
    Boolean(selected.provider && selected.model) &&
    !out.some((row) => row.provider === selected.provider && row.model === selected.model);
  if (retained) {
    const cfg = models?.providers[selected.provider];
    const entry = cfg?.models.find((m) => m.id === selected.model);
    out.push({
      provider: selected.provider,
      model: selected.model,
      label: entry?.label || selected.model,
      group: cfg?.label || selected.provider,
      retained: true,
    });
  }
  return out;
}
