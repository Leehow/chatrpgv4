const normalize = ({ coefficient, exponent }) => {
  if (coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    exponent++;
  }
  return { coefficient, exponent };
};
const power = (exponent) => 10n ** BigInt(exponent);
function decimalSpelling(text) {
  if (typeof text !== "string" || text.length > 100) return undefined;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || Math.abs(Number(match[4] || 0)) > 400) return undefined;
  return normalize({coefficient: BigInt(`${match[1]}${match[2]}${match[3] || ""}`), exponent: Number(match[4] || 0) - (match[3]?.length || 0)});
}
function addCash(left, right) {
  const exponent = Math.min(left.exponent, right.exponent);
  return normalize({
    coefficient: left.coefficient * power(left.exponent - exponent) + right.coefficient * power(right.exponent - exponent),
    exponent
  });
}
function multiplyCash(left, right) {
  return normalize({ coefficient: left.coefficient * right.coefficient, exponent: left.exponent + right.exponent });
}
function compareCash(left, right) {
  const exponent = Math.min(left.exponent, right.exponent);
  const a = left.coefficient * power(left.exponent - exponent);
  const b = right.coefficient * power(right.exponent - exponent);
  return a < b ? -1 : a > b ? 1 : 0;
}
function cashText(value) {
  const sign = value.coefficient < 0n ? "-" : "", digits = (value.coefficient < 0n ? -value.coefficient : value.coefficient).toString();
  if (value.exponent >= 0) return `${sign}${digits}${"0".repeat(value.exponent)}`;
  const point = digits.length + value.exponent;
  return point > 0 ? `${sign}${digits.slice(0, point)}.${digits.slice(point)}` : `${sign}0.${"0".repeat(-point)}${digits}`;
}
export {
  addCash,
  cashText,
  compareCash,
  decimalSpelling,
  multiplyCash,
  normalize,
  power
};
