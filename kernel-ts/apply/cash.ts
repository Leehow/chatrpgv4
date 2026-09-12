/** Exact base-10 cash arithmetic at the JSON-number boundary. */
import {PythonFloat, pythonFloatRepr} from '../json.js';

export interface Decimal { coefficient: bigint; exponent: number }
export type CashValue = number | bigint | PythonFloat;

const normalize = ({coefficient, exponent}: Decimal): Decimal => {
    if (coefficient === 0n) return {coefficient: 0n, exponent: 0};
    while (coefficient % 10n === 0n) { coefficient /= 10n; exponent++; }
    return {coefficient, exponent};
};
const power = (exponent: number): bigint => 10n ** BigInt(exponent);

/** The canonical JSON decimal spelling of an existing numeric value, or null when it is not finite numeric data. */
export function cashDecimal(value: unknown): Decimal | null {
    if (typeof value === 'bigint') return normalize({coefficient: value, exponent: 0});
    const numeric = value instanceof PythonFloat ? value.value : value;
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return null;
    const text = pythonFloatRepr(numeric), match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match) return null;
    const [, sign, whole, fraction = '', magnitude = '0'] = match;
    return normalize({coefficient: BigInt(`${sign}${whole}${fraction}`), exponent: Number(magnitude) - fraction.length});
}

export function addCash(left: Decimal, right: Decimal): Decimal {
    const exponent = Math.min(left.exponent, right.exponent);
    return normalize({
        coefficient: left.coefficient * power(left.exponent - exponent) + right.coefficient * power(right.exponent - exponent),
        exponent,
    });
}

export function cashText(value: Decimal): string {
    const sign = value.coefficient < 0n ? '-' : '', digits = (value.coefficient < 0n ? -value.coefficient : value.coefficient).toString();
    if (value.exponent >= 0) return `${sign}${digits}${'0'.repeat(value.exponent)}`;
    const point = digits.length + value.exponent;
    return point > 0 ? `${sign}${digits.slice(0, point)}.${digits.slice(point)}` : `${sign}0.${'0'.repeat(-point)}${digits}`;
}

/** Keep legacy whole number/bigint storage; fractional results must survive PythonFloat serialization byte-for-byte. */
export function cashStorage(value: Decimal): CashValue | null {
    if (value.exponent >= 0) {
        const whole = value.coefficient * power(value.exponent);
        return whole <= BigInt(Number.MAX_SAFE_INTEGER) && whole >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(whole) : whole;
    }
    const numeric = Number(cashText(value));
    if (!Number.isFinite(numeric)) return null;
    const roundTrip = cashDecimal(new PythonFloat(numeric));
    return roundTrip && roundTrip.coefficient === value.coefficient && roundTrip.exponent === value.exponent ? new PythonFloat(numeric) : null;
}
