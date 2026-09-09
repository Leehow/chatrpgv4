/** The existing bounded SAN-loss grammar; parsing never consumes randomness. */
import { pythonTypeName } from '../errors.js';
import { isJsonObject, PythonFloat } from '../json.js';
import { number, repr, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';

const decimal = /^\p{Decimal_Number}$/u;
function asciiDigits(text: string): string {
    return Array.from(text, char => {
        if (!decimal.test(char)) return char;
        const code = char.codePointAt(0)!;
        let first = code;
        while (first > 0 && decimal.test(String.fromCodePoint(first - 1))) first--;
        return String((code - first) % 10);
    }).join('');
}
export function sanityInt(value: any): number {
    if (value == null) throw new TypeError("int() argument must be a string, a bytes-like object or a real number, not 'NoneType'");
    if (typeof value === 'string') {
        const text = asciiDigits(value.trim());
        if (!/^[+-]?\d+(?:_\d+)*$/.test(text)) valueError(`invalid literal for int() with base 10: ${repr(value)}`);
        return Math.trunc(Number(text.replaceAll('_', '')));
    }
    if (typeof value === 'object' && !(value instanceof PythonFloat))
        throw new TypeError(`int() argument must be a string, a bytes-like object or a real number, not '${isJsonObject(value) ? 'dict' : pythonTypeName(value)}'`);
    const result = number(value);
    if (Number.isNaN(result)) valueError('cannot convert float NaN to integer');
    if (!Number.isFinite(result)) { const error = new Error('cannot convert float infinity to integer'); error.name = 'OverflowError'; throw error; }
    return Math.trunc(result);
}
export function validateSanLossExpression(expression: any): Row {
    if (typeof expression !== 'string') valueError('SAN loss expression must be a string');
    const normalized = expression.trim();
    if (Array.from(normalized).length > 32) valueError('SAN loss expression is too long');
    if (/^\p{Decimal_Number}+$/u.test(normalized)) {
        const value = sanityInt(normalized);
        if (value <= 0) valueError('SAN loss constant must be positive');
        if (value > 100000) valueError('SAN loss constant exceeds the supported maximum');
        return { kind: 'constant', value };
    }
    const match = /^(\p{Decimal_Number}+)D(\p{Decimal_Number}+)(?:\+(\p{Decimal_Number}+))?$/iu.exec(normalized);
    if (!match) valueError('invalid SAN loss expression');
    const count = sanityInt(match[1]), sides = sanityInt(match[2]), modifier = sanityInt(match[3] || '0');
    if (count <= 0 || sides <= 0) valueError('SAN loss dice count and sides must be positive');
    if (count > 100) valueError('SAN loss dice count exceeds the supported maximum');
    if (sides > 1000) valueError('SAN loss die sides exceed the supported maximum');
    if (modifier > 100000) valueError('SAN loss modifier exceeds the supported maximum');
    if (count * sides + modifier > 100000) valueError('SAN loss maximum exceeds the supported total');
    return { kind: 'dice', count, sides, modifier };
}
export function parseSanLoss(text: any): [string, string] | null {
    if (typeof text !== 'string') return null;
    const match = /(\p{Decimal_Number}+(?:D\p{Decimal_Number}+(?:\+\p{Decimal_Number}+)?)?)\s*\/\s*(\p{Decimal_Number}+D\p{Decimal_Number}+(?:\+\p{Decimal_Number}+)?|\p{Decimal_Number}+)/iu.exec(text);
    return match ? [match[1].toUpperCase(), match[2].toUpperCase()] : null;
}
