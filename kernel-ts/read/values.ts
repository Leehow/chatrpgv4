/** Python-compatible value operations shared by the immutable read projections. */
import { PythonFloat, canonicalJson, compareUnicode, isJsonObject, orderedObject, parsePythonJson, pythonJsonDumps, pythonObjectEntries, type JsonObject, type JsonValue, type ReadonlyJson } from "../json.js";
import { pythonStringRepr } from "../errors.js";
export type Row = Record<string, any>;
export const row = (value: any): Row => isJsonObject(value) ? value : {};
export const array = (value: any): any[] => Array.isArray(value) ? value : [];
export const entries = (value: any): Array<[
    string,
    any
]> => pythonObjectEntries(row(value));
export const values = (value: any): any[] => entries(value).map(([, item]) => item);
export const number = (value: any, fallback = 0): number => value == null ? fallback : Number(value);
export const integer = (value: any): boolean => typeof value === "bigint" || typeof value === "number" && Number.isInteger(value);
export const numeric = (value: any): boolean => integer(value) || value instanceof PythonFloat;
export function truth(value: any): boolean {
    if (value == null || value === false || value === "")
        return false;
    if (numeric(value))
        return Number(value) !== 0;
    if (Array.isArray(value))
        return value.length > 0;
    if (isJsonObject(value))
        return Object.keys(value).length > 0;
    return true;
}
export function string(value: any): string {
    if (value == null)
        return "None";
    if (value === true)
        return "True";
    if (value === false)
        return "False";
    if (typeof value === "string")
        return value;
    if (numeric(value))
        return value instanceof PythonFloat ? pythonJsonDumps(value) : String(value);
    return repr(value);
}
export function repr(value: any): string {
    if (typeof value === "string")
        return pythonStringRepr(value);
    if (Array.isArray(value))
        return `[${value.map(repr).join(", ")}]`;
    if (isJsonObject(value))
        return `{${entries(value).map(([k, v]) => `${pythonStringRepr(k)}: ${repr(v)}`).join(", ")}}`;
    return string(value);
}
/**
 * A structural copy with exactly the shape a `pythonJsonDumps` → `parsePythonJson` round trip
 * produced (contract §131): key order as `objectKeys` reads it, an integer-valued number stays a
 * number, any other number becomes a `PythonFloat` (as the serializer would have written it),
 * bigint and `PythonFloat` pass through (both immutable), and the copy is unfrozen however the
 * input was. The round trip was 11% of a workspace read; nothing needed the bytes, only the copy.
 */
export function clone<T>(value: T): T {
    return copy(value as ReadonlyJson) as T;
}
function copy(value: ReadonlyJson): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint" || value instanceof PythonFloat)
        return value;
    if (typeof value === "number") {
        if (Object.is(value, -0) || !Number.isInteger(value)) return new PythonFloat(value);
        if (!Number.isSafeInteger(value)) throw new TypeError("unsafe integer number: use bigint for Python int or PythonFloat for Python float");
        return value;
    }
    if (Array.isArray(value)) return value.map(copy);
    if (!isJsonObject(value)) throw new TypeError("unsupported JSON value");
    return orderedObject(pythonObjectEntries(value as JsonObject).map(([key, child]) => [key, copy(child)] as const));
}
export const equal = (a: any, b: any): boolean => {
    if ((numeric(a) || typeof a === "boolean") && (numeric(b) || typeof b === "boolean")) {
        if (typeof a === "bigint" && typeof b !== "bigint")
            return Number.isInteger(Number(b)) && BigInt(Number(b)) === a;
        if (typeof b === "bigint" && typeof a !== "bigint")
            return Number.isInteger(Number(a)) && BigInt(Number(a)) === b;
        return typeof a === "bigint" && typeof b === "bigint" ? a === b : Number(a) === Number(b);
    }
    if (Array.isArray(a) || Array.isArray(b))
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]));
    if (isJsonObject(a) || isJsonObject(b))
        return isJsonObject(a) && isJsonObject(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
    return (a ?? null) === (b ?? null);
};
export const chars = (value: string, limit: number): string => Array.from(value).slice(0, limit).join("");
export const length = (value: string): number => Array.from(value).length;
export const words = (value: any): string => string(value).trim().split(/\s+/u).filter(Boolean).join(" ");
export const sorted = (values: Iterable<string>): string[] => [...values].sort(compareUnicode);
export const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];
/**
 * A mark Unicode composes onto its base letter is an accent and folds away (a-acute to a, n-tilde
 * to n); a mark the standard never composes (a Devanagari vowel sign, a Thai tone mark) is part of
 * the word and stays. Node ids are ASCII kebab by the shape gate while names keep the book's
 * spelling, so without this a name differing from its own handle only by an accent never matched.
 */
const foldComposed = (text: string): string => /^[\x00-\x7f]*$/.test(text) ? text : Array.from(text).map(char => {
    const parts = char.normalize("NFKD");
    return parts !== char && /^\P{M}\p{M}+$/u.test(parts) ? Array.from(parts)[0] : char;
}).join("");
/** Name comparison: NFKC, composed accents folded, lower-cased, separators collapsed (contract section 2). */
export const normalize = (value: any): string => foldComposed(string(value).normalize("NFKC")).toLowerCase().replace(/[\s_\-]+/gu, " ").trim();
/** Every script's letters, combining marks and digits survive (NFKC, lower-cased); anything else separates. Machine names go through asciiSlug instead. */
export const normalizeText = (value: any): string => string(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
export const kebab = (value: any): string => normalizeText(value).split(/\s+/u).filter(Boolean).join("-");
export const stripPrefix = (value: string, kind: string): string => value.startsWith(kind + "-") ? value.slice(kind.length + 1) : value;
export const pick = (value: Row, keys: string[]): Row => Object.fromEntries(keys.filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
export const float = (value: number): PythonFloat => new PythonFloat(value);
export function round(value: number, digits: number): number {
    if (!Number.isFinite(value) || value === 0)
        return value;
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, Math.abs(value));
    const bits = view.getBigUint64(0),
        exponent = Number((bits >> 52n) & 2047n),
        fraction = bits & ((1n << 52n) - 1n);
    let numerator = exponent ? (1n << 52n) + fraction : fraction,
        denominator = 1n;
    const shift = (exponent || 1) - 1023 - 52;
    if (shift >= 0)
        numerator <<= BigInt(shift);
    else
        denominator <<= BigInt(-shift);
    if (digits >= 0)
        numerator *= 10n ** BigInt(digits);
    else
        denominator *= 10n ** BigInt(-digits);
    let quotient = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder * 2n > denominator || remainder * 2n === denominator && quotient % 2n === 1n)
        quotient++;
    return Math.sign(value) * Number(quotient) / 10 ** digits;
}
/** Matching blocks and tie order follow difflib.SequenceMatcher for name suggestions. */
export function similarity(left: string, right: string): number {
    const a = Array.from(left),
        b = Array.from(right);
    if (!a.length && !b.length)
        return 1;
    const positions = new Map<string, number[]>();
    b.forEach((value, index) => positions.set(value, [...(positions.get(value) ?? []), index]));
    if (b.length >= 200)
        for (const [value, indexes] of positions)
            if (indexes.length > Math.floor(b.length / 100) + 1)
                positions.delete(value);
    const stack = [[0, a.length, 0, b.length]];
    let total = 0;
    while (stack.length) {
        const [alo, ahi, blo, bhi] = stack.pop()!;
        let ai = alo,
            bi = blo,
            size = 0,
            previous = new Map<number, number>();
        for (let i = alo; i < ahi; i++) {
            const current = new Map<number, number>();
            for (const j of positions.get(a[i]) ?? []) {
                if (j < blo || j >= bhi)
                    continue;
                const count = (previous.get(j - 1) ?? 0) + 1;
                current.set(j, count);
                if (count > size) {
                    ai = i - count + 1;
                    bi = j - count + 1;
                    size = count;
                }
            }
            previous = current;
        }
        while (ai > alo && bi > blo && a[ai - 1] === b[bi - 1]) {
            ai--;
            bi--;
            size++;
        }
        while (ai + size < ahi && bi + size < bhi && a[ai + size] === b[bi + size])
            size++;
        if (!size)
            continue;
        total += size;
        if (alo < ai && blo < bi)
            stack.push([alo, ai, blo, bi]);
        if (ai + size < ahi && bi + size < bhi)
            stack.push([ai + size, ahi, bi + size, bhi]);
    }
    return 2 * total / (a.length + b.length);
}
