import { createHash } from "node:crypto";

/** JSON numbers need their Python type to retain identity-bearing digests. */
export class PythonFloat {
  readonly value: number;

  constructor(value: number) {
    if (typeof value !== "number") throw new TypeError("PythonFloat requires a number");
    this.value = value;
    Object.freeze(this);
  }

  valueOf(): number { return this.value; }

  toJSON(): never {
    throw new TypeError("PythonFloat requires pythonJsonDumps; JSON.stringify erases Python numeric identity");
  }
}

export type JsonValue = null | boolean | string | number | bigint | PythonFloat | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export type ReadonlyJson = null | boolean | string | number | bigint | PythonFloat |
  readonly ReadonlyJson[] | { readonly [key: string]: ReadonlyJson };

const insertionOrder = new WeakMap<object, string[]>();

export function isJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Compare Unicode code points, as Python does, instead of UTF-16 code units. */
export function compareUnicode(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!);
  const b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/** Preserve Python dict insertion order, including integer-looking string keys. */
export function orderedObject(entries: Iterable<readonly [string, JsonValue]>): JsonObject {
  const result: JsonObject = {};
  const order: string[] = [];
  for (const [key, value] of entries) {
    if (typeof key !== "string") throw new TypeError("JSON object keys must be strings");
    if (!Object.hasOwn(result, key)) order.push(key);
    Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
  }
  insertionOrder.set(result, order);
  return result;
}

function objectKeys(value: JsonObject): string[] {
  const keys = Object.keys(value);
  const prior = insertionOrder.get(value);
  if (!prior) return keys;
  const existing = new Set(keys);
  return [...prior.filter(key => existing.delete(key)), ...keys.filter(key => existing.has(key))];
}

function quoted(value: string): string {
  let result = '"';
  for (const character of value) {
    const point = character.codePointAt(0)!;
    switch (character) {
      case '"': result += '\\"'; break;
      case "\\": result += "\\\\"; break;
      case "\b": result += "\\b"; break;
      case "\f": result += "\\f"; break;
      case "\n": result += "\\n"; break;
      case "\r": result += "\\r"; break;
      case "\t": result += "\\t"; break;
      default: result += point < 32 ? `\\u${point.toString(16).padStart(4, "0")}` : character;
    }
  }
  return result + '"';
}

export function utf8Bytes(text: string): Buffer {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("UTF-8 cannot encode an unpaired surrogate");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("UTF-8 cannot encode an unpaired surrogate");
    }
  }
  return Buffer.from(text, "utf8");
}

function power10(exponent: number): bigint { return 10n ** BigInt(exponent); }

function fraction(value: number): [bigint, bigint] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = (exponent || 1) - 1023 - 52;
  return shift >= 0 ? [mantissa << BigInt(shift), 1n] : [mantissa, 1n << BigInt(-shift)];
}

/** Select the closest shortest round-trip decimal, breaking exact ties to even. */
function shortestDecimal(value: number): { digits: string; exponent: number } {
  const [numerator, denominator] = fraction(value);
  const comparePower = (exponent: number): number => {
    const a = exponent >= 0 ? numerator : numerator * power10(-exponent);
    const b = exponent >= 0 ? denominator * power10(exponent) : denominator;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  let exponent = Math.floor(Math.log10(value));
  while (comparePower(exponent) < 0) exponent--;
  while (comparePower(exponent + 1) >= 0) exponent++;
  for (let precision = 1; precision <= 17; precision++) {
    const scale = precision - 1 - exponent;
    const a = scale >= 0 ? numerator * power10(scale) : numerator;
    const b = scale >= 0 ? denominator : denominator * power10(-scale);
    const floor = a / b;
    let best: bigint | undefined;
    let distance: bigint | undefined;
    for (const candidate of [floor, floor + 1n]) {
      if (candidate <= 0n || Number(`${candidate}e${-scale}`) !== value) continue;
      const difference = candidate * b - a;
      const absolute = difference < 0n ? -difference : difference;
      if (distance === undefined || absolute < distance || (absolute === distance && candidate % 2n === 0n)) {
        best = candidate;
        distance = absolute;
      }
    }
    if (best !== undefined) {
      const text = best.toString();
      return { digits: text.replace(/0+$/, ""), exponent: text.length - 1 - scale };
    }
  }
  throw new Error("no round-trip decimal for an IEEE-754 value");
}

export function pythonFloatRepr(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  if (value === 0) return sign + "0.0";
  const { digits, exponent } = shortestDecimal(Math.abs(value));
  if (exponent < -4 || exponent >= 16) {
    const coefficient = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
    return `${sign}${coefficient}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  const point = exponent + 1;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

export interface JsonFormat { readonly sortKeys?: boolean; readonly compact?: boolean; readonly indent?: number }

export function pythonJsonDumps(value: ReadonlyJson, format: JsonFormat = {}): string {
  const seen = new Set<object>();
  const indent = format.indent;
  if (indent !== undefined && (!Number.isSafeInteger(indent) || indent < 0)) {
    throw new TypeError("indent must be a non-negative integer");
  }
  const colon = format.compact ? ":" : ": ";
  const separator = format.compact || indent !== undefined ? "," : ", ";
  const render = (item: ReadonlyJson, level: number): string => {
    if (item === null) return "null";
    if (typeof item === "string") return quoted(item);
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "bigint") return item.toString();
    if (item instanceof PythonFloat) return pythonFloatRepr(item.value);
    if (typeof item === "number") {
      if (Object.is(item, -0) || !Number.isInteger(item)) return pythonFloatRepr(item);
      if (!Number.isSafeInteger(item)) {
        throw new TypeError("unsafe integer number: use bigint for Python int or PythonFloat for Python float");
      }
      return String(item);
    }
    if (!Array.isArray(item) && !isJsonObject(item)) throw new TypeError("unsupported JSON value");
    if (seen.has(item)) throw new TypeError("Circular reference detected");
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError("JSON does not support symbol keys");
    seen.add(item);
    try {
      const array = Array.isArray(item);
      const keys = array ? [] : objectKeys(item as JsonObject);
      if (format.sortKeys) keys.sort(compareUnicode);
      const children = array
        ? Array.from(item, child => render(child, level + 1))
        : keys.map(key => quoted(key) + colon + render((item as JsonObject)[key], level + 1));
      const open = array ? "[" : "{";
      const close = array ? "]" : "}";
      if (!children.length) return open + close;
      if (indent === undefined) return open + children.join(separator) + close;
      const padding = " ".repeat(indent * (level + 1));
      return `${open}\n${padding}${children.join(separator + "\n" + padding)}\n${" ".repeat(indent * level)}${close}`;
    } finally {
      seen.delete(item);
    }
  };
  return render(value, 0);
}

export function canonicalJson(value: ReadonlyJson): string {
  return pythonJsonDumps(value, { sortKeys: true, compact: true });
}

export function storedJson(value: ReadonlyJson): string {
  return pythonJsonDumps(value, { indent: 2 }) + "\n";
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(utf8Bytes(text)).digest("hex");
}

export function jsonDigest(value: ReadonlyJson): string { return sha256Text(canonicalJson(value)); }

export class PythonJsonDecodeError extends SyntaxError {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "JSONDecodeError";
    this.position = position;
  }
}

/** Parse before JS can erase int/float identity, large integers or dict order. */
export function parsePythonJson(text: string): JsonValue {
  let position = 0;
  const fail = (message: string): never => { throw new PythonJsonDecodeError(message, position); };
  const whitespace = (): void => { while (/[\x20\t\r\n]/.test(text[position] ?? "")) position++; };
  const string = (): string => {
    const start = position++;
    while (position < text.length) {
      const character = text[position++];
      if (character === '"') return JSON.parse(text.slice(start, position));
      if (character.charCodeAt(0) < 32) fail("Invalid control character at");
      if (character === "\\") {
        const escaped = text[position++];
        if (escaped === undefined) fail("Unterminated string starting at");
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(position, position + 4))) fail("Invalid \\uXXXX escape");
          position += 4;
        } else if (!'"\\/bfnrt'.includes(escaped)) fail("Invalid \\escape");
      }
    }
    return fail("Unterminated string starting at");
  };
  const value = (): JsonValue => {
    whitespace();
    const character = text[position];
    if (character === '"') return string();
    if (character === "{") {
      position++;
      whitespace();
      const entries: [string, JsonValue][] = [];
      if (text[position] === "}") { position++; return orderedObject(entries); }
      while (true) {
        whitespace();
        if (text[position] !== '"') fail("Expecting property name enclosed in double quotes");
        const key = string();
        whitespace();
        if (text[position++] !== ":") fail("Expecting ':' delimiter");
        entries.push([key, value()]);
        whitespace();
        if (text[position] === "}") { position++; return orderedObject(entries); }
        if (text[position++] !== ",") fail("Expecting ',' delimiter");
        whitespace();
        if (text[position] === "}") fail("Illegal trailing comma before end of object");
      }
    }
    if (character === "[") {
      position++;
      whitespace();
      const result: JsonValue[] = [];
      if (text[position] === "]") { position++; return result; }
      while (true) {
        result.push(value());
        whitespace();
        if (text[position] === "]") { position++; return result; }
        if (text[position++] !== ",") fail("Expecting ',' delimiter");
        whitespace();
        if (text[position] === "]") fail("Illegal trailing comma before end of array");
      }
    }
    for (const [literal, result] of [["true", true], ["false", false], ["null", null],
      ["NaN", new PythonFloat(NaN)], ["Infinity", new PythonFloat(Infinity)],
      ["-Infinity", new PythonFloat(-Infinity)]] as const) {
      if (text.startsWith(literal, position)) { position += literal.length; return result; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(position));
    if (!number) return fail("Expecting value");
    position += number[0].length;
    if (/[.eE]/.test(number[0])) return new PythonFloat(Number(number[0]));
    const integer = BigInt(number[0]);
    return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(integer) : integer;
  };
  if (text.charCodeAt(0) === 0xfeff) fail("Unexpected UTF-8 BOM (decode using utf-8-sig)");
  const result = value();
  whitespace();
  if (position !== text.length) fail("Extra data");
  return result;
}

export function freezeJson(value: JsonValue): ReadonlyJson {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) value.forEach(freezeJson);
    else if (isJsonObject(value)) Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}
