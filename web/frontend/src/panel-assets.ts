import type { PanelView } from "./panel-cash";

export type SheetAssets = {
  amount?: number | string | null;
  currency?: string;
  display?: string;
  source?: string;
  living_standard?: string;
  spending_level?: string;
  current?: boolean;
  baseline?: boolean;
  labels?: {
    assets?: string;
    cash?: string;
    living_standard?: string;
    spending_level?: string;
    empty_ledger?: string;
    no_record?: string;
    no_reason?: string;
    pair_sep?: string;
  };
};

/** Current Assets belong on the character sheet with cash, and on items. */
export function showsAssetsSection(
  view: PanelView,
  setupPending?: boolean,
): boolean {
  if (setupPending) return false;
  return view === "all" || view === "character" || view === "items";
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
  if (assets.current) return display;
  if (display && source) return `${display} · ${source}`;
  return display;
}
