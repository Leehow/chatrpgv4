/** Exact base-10 cash arithmetic at the JSON-number boundary. */
import {PythonFloat, pythonFloatRepr} from '../json.js';

import {normalize,power,addCash,compareCash,cashText,type Decimal} from '../../shared/cash-decimal.js';
export {addCash,compareCash,multiplyCash,cashText,type Decimal} from '../../shared/cash-decimal.js';
export type CashValue = number | bigint | PythonFloat;

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
