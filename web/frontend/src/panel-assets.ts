import type { PanelView } from "./panel-cash";

export type SheetAssets = {
  amount?: number | string | null;
  currency?: string;
  display?: string;
  source?: string;
  living_standard?: string;
  spending_level?: string;
};

export function showsAssetsSection(
  view: PanelView,
  setupPending?: boolean,
): boolean {
  if (setupPending) return false;
  return view === "all" || view === "items";
}

export function hasSheetAssets(
  assets: SheetAssets | null | undefined,
): boolean {
  const display = assets?.display?.trim();
  return Boolean(display);
}

export function assetsHeadline(assets: SheetAssets): string {
  const display = (assets.display || "").trim();
  const source = (assets.source || "").trim();
  if (display && source) return `${display} · ${source}`;
  return display;
}
