export type PanelView = "all" | "character" | "items" | "time" | "materials";

export type CashWallet = {
  amount?: string;
  unit?: string;
};

export type CashLedgerRow = {
  op?: string;
  amount?: string;
  currency?: string;
  localized_reason?: string;
  decision_id?: string;
  player_time?: string | { display_label?: string | null; display?: string | null } | null;
  game_time?: { display?: string } | null;
};

export type CashDisplay = {
  balances?: Record<string, CashWallet> | null;
  ledger?: CashLedgerRow[] | null;
  labels?: {
    current_cash?: string;
    cash?: string;
    empty_ledger?: string;
    no_record?: string;
    no_reason?: string;
  };
};

/** Cash belongs on the character sheet and the items/equipment tab. */
export function showsCashSection(
  view: PanelView,
  setupPending?: boolean,
): boolean {
  if (setupPending) return false;
  return view === "all" || view === "character" || view === "items";
}

export function hasCashBalances(cash: CashDisplay | null | undefined): boolean {
  if (!cash?.balances) return false;
  return Object.keys(cash.balances).length > 0;
}

export function cashLedgerRows(cash: CashDisplay | null | undefined): CashLedgerRow[] {
  return Array.isArray(cash?.ledger) ? cash.ledger : [];
}

export function cashWhenLabel(row: CashLedgerRow): string {
  const playerTime = row.player_time;
  if (typeof playerTime === "string" && playerTime.trim()) return playerTime.trim();
  if (playerTime && typeof playerTime === "object") {
    const label = (playerTime.display_label || playerTime.display || "").trim();
    if (label) return label;
  }
  return (row.game_time?.display || "").trim();
}
