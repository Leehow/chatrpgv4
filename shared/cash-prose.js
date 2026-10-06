import { addCash, multiplyCash, cashText, decimalSpelling } from "./cash-decimal.js";
const PRICE = /\{\{price:([^{}\n]+?):(?:(\d+):)?(unit|quantity|amount|total)\}\}/g;
const named = (value) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
const decimal = (value) => {
  if (typeof value === "string") return decimalSpelling(value);
  const number = typeof value === "number" ? value : value && typeof value === "object" ? value.value : void 0;
  if (typeof number !== "number" || !Number.isFinite(number)) return;
  return decimalSpelling(String(number));
};
function priceRows(effects = [], quotes = []) {
  return [
    ...Array.isArray(effects) ? effects.filter((row) => row?.kind === "cash") : [],
    ...Array.isArray(quotes) ? quotes : []
  ].filter((row) => row && typeof row === "object");
}
function bill(row) {
  if (row.items === undefined) {
    const amount = decimal(row.purchase_amount);
    const delta = ["living","purchase"].includes(row.category) ? decimal(row.delta) : undefined;
    const total = amount || (delta && delta.coefficient < 0n ? {...delta,coefficient:-delta.coefficient} : undefined);
    return total && total.coefficient > 0n ? {lines:[],total} : undefined;
  }
  if (!Array.isArray(row.items) || !row.items.length || row.items.length > 24) return;
  let total = { coefficient: 0n, exponent: 0 };
  const lines = [];
  for (const line of row.items) {
    const unit = decimal(line?.unit_price), quantity = decimal(line?.quantity);
    if (!unit || !quantity || unit.coefficient < 0n || quantity.coefficient <= 0n) return;
    const amount = multiplyCash(unit, quantity);
    total = addCash(total, amount);
    lines.push({ unit, quantity, amount });
  }
  if (total.coefficient <= 0n) return;
  return { lines, total };
}
function bindPriceText(text, rows) {
  const bound = [], unresolved = [];
  const result = text.replace(PRICE, (token, name, index, field) => {
    const candidates = rows.filter((row) => [row.bill,row.quote].some(alias=>named(alias)===named(name)));
    const values = candidates.map(bill);
    const resolved = values.length === 1 ? values[0] : void 0;
    const at = index === void 0 ? 0 : Number(index) - 1;
    const line = resolved?.lines[at];
    const amount = resolved && field === "total" && index === void 0 ? resolved.total : resolved && (index !== void 0 || resolved.lines.length === 1) && line ? line[field] : void 0;
    if (!amount) {
      unresolved.push(token);
      return "\u2026";
    }
    const value = cashText(amount);
    bound.push({
      token,
      bill: name,
      field,
      ...index ? { line: Number(index) } : {},
      value,
      ...typeof candidates[0].id === "string" ? { receipt: candidates[0].id } : {}
    });
    return value;
  });
  return { text: result, bound, unresolved };
}
export {
  bindPriceText,
  priceRows
};
