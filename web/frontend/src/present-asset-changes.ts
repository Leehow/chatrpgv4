import type { CashChangeDisplay, ItemChangeDisplay, KeeperContentBlock } from "./types";

export function cashWhenLabel(change: CashChangeDisplay): string {
  const playerTime = change.player_time;
  if (typeof playerTime === "string" && playerTime.trim()) return playerTime.trim();
  if (playerTime && typeof playerTime === "object") {
    const label = (playerTime.display_label || playerTime.display || "").trim();
    if (label) return label;
  }
  const display = change.game_time?.display;
  return typeof display === "string" ? display.trim() : "";
}

export function cashTitle(change: CashChangeDisplay): string {
  const gain = change.direction === "gain";
  return gain ? `获得 ${change.amount} ${change.currency}` : `支出 ${change.amount} ${change.currency}`;
}

export function itemTone(action: string): "gain" | "spend" | "use" {
  if (action === "acquired" || action === "grant") return "gain";
  if (action === "lost" || action === "remove") return "spend";
  return "use";
}

export function itemActionLabel(action: string): string {
  if (action === "acquired" || action === "grant") return "获得";
  if (action === "lost" || action === "remove") return "失去";
  if (action === "consumed") return "用尽";
  return "使用";
}

export function itemTitle(change: ItemChangeDisplay): string {
  const verb = itemActionLabel(change.action);
  const qty = change.quantity ?? change.delta;
  return qty != null && qty !== "" ? `${verb}「${change.label}」×${qty}` : `${verb}「${change.label}」`;
}

export function itemWeaponLine(change: ItemChangeDisplay): string {
  const weapon = change.weapon;
  if (!weapon) return "";
  const parts = [weapon.damage, weapon.skill, weapon.range != null && weapon.range !== "" ? `射程 ${weapon.range}` : "", weapon.ammo != null && weapon.ammo !== "" ? `弹药 ${weapon.ammo}` : ""]
    .map((part) => (typeof part === "string" || typeof part === "number" ? String(part).trim() : ""))
    .filter(Boolean);
  return parts.join(" · ");
}

export function currencyBalances(changes: CashChangeDisplay[]): { currency: string; after: string }[] {
  const last = new Map<string, string>();
  for (const change of changes) {
    if (change.after == null || change.after === "") continue;
    last.set(change.currency, String(change.after));
  }
  return [...last.entries()].map(([currency, after]) => ({ currency, after }));
}

export function presentAssetChanges(block: Extract<KeeperContentBlock, { type: "asset_changes" }>): {
  cashTitles: string[];
  itemTitles: string[];
  itemWeaponLines: string[];
  count: number;
} {
  const cash = block.cash_changes || [];
  const items = block.item_changes || [];
  return {
    cashTitles: cash.map(cashTitle),
    itemTitles: items.map(itemTitle),
    itemWeaponLines: items.map(itemWeaponLine).filter(Boolean),
    count: cash.length + items.length,
  };
}
