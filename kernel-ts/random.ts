import { createHash, randomBytes } from "node:crypto";
import { utf8Bytes } from "./json.js";

export type PythonSeed = string | number | bigint;

function integer(value: number | bigint, name: string): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer number or bigint`);
  return BigInt(value);
}

function seedWords(seed?: PythonSeed): number[] {
  if (seed === undefined) {
    const bytes = randomBytes(624 * 4);
    return Array.from({ length: 624 }, (_, index) => bytes.readUInt32LE(index * 4));
  }
  let material: bigint;
  if (typeof seed === "string") {
    const bytes = utf8Bytes(seed);
    const digest = createHash("sha512").update(bytes).digest();
    material = BigInt("0x" + Buffer.concat([bytes, digest]).toString("hex"));
  } else {
    material = integer(seed, "seed");
    if (material < 0n) material = -material;
  }
  const words: number[] = [];
  do {
    words.push(Number(material & 0xffffffffn));
    material >>= 32n;
  } while (material);
  return words;
}

/** CPython's version-2 string/int seed expansion and MT19937 sampling. */
export class PythonRandom {
  #words = new Uint32Array(624);
  #index = 624;

  constructor(seed?: PythonSeed) { this.seed(seed); }

  seed(seed?: PythonSeed): void {
    const key = seedWords(seed);
    const state = this.#words;
    state[0] = 19650218;
    for (let index = 1; index < 624; index++) {
      state[index] = Math.imul(1812433253, state[index - 1] ^ (state[index - 1] >>> 30)) + index;
    }
    let index = 1;
    let keyIndex = 0;
    for (let count = Math.max(624, key.length); count > 0; count--) {
      state[index] = (state[index] ^ Math.imul(state[index - 1] ^ (state[index - 1] >>> 30), 1664525)) + key[keyIndex] + keyIndex;
      index++;
      keyIndex++;
      if (index >= 624) { state[0] = state[623]; index = 1; }
      if (keyIndex >= key.length) keyIndex = 0;
    }
    for (let count = 623; count > 0; count--) {
      state[index] = (state[index] ^ Math.imul(state[index - 1] ^ (state[index - 1] >>> 30), 1566083941)) - index;
      index++;
      if (index >= 624) { state[0] = state[623]; index = 1; }
    }
    state[0] = 0x80000000;
    this.#index = 624;
  }

  #word(): number {
    const state = this.#words;
    if (this.#index >= 624) {
      for (let index = 0; index < 624; index++) {
        const joined = (state[index] & 0x80000000) | (state[(index + 1) % 624] & 0x7fffffff);
        state[index] = state[(index + 397) % 624] ^ (joined >>> 1) ^ ((joined & 1) ? 0x9908b0df : 0);
      }
      this.#index = 0;
    }
    let word = state[this.#index++];
    word ^= word >>> 11;
    word ^= (word << 7) & 0x9d2c5680;
    word ^= (word << 15) & 0xefc60000;
    word ^= word >>> 18;
    return word >>> 0;
  }

  random(): number {
    return ((this.#word() >>> 5) * 67108864 + (this.#word() >>> 6)) / 9007199254740992;
  }

  /** Bigint is deliberate: Python getrandbits has no 53-bit precision limit. */
  getrandbits(bits: number): bigint {
    if (!Number.isSafeInteger(bits) || bits < 0 || bits > 0x7fffffff) {
      throw new RangeError("number of bits must be a non-negative 32-bit integer");
    }
    let result = 0n;
    for (let offset = 0; offset < bits; offset += 32) {
      const remaining = bits - offset;
      const word = remaining < 32 ? this.#word() >>> (32 - remaining) : this.#word();
      result |= BigInt(word) << BigInt(offset);
    }
    return result;
  }

  randbelow(limit: number): number;
  randbelow(limit: bigint): bigint;
  randbelow(limit: number | bigint): number | bigint {
    const n = integer(limit, "limit");
    if (n <= 0n) throw new RangeError("limit must be positive");
    const bits = n.toString(2).length;
    let result = this.getrandbits(bits);
    while (result >= n) result = this.getrandbits(bits);
    return typeof limit === "bigint" ? result : Number(result);
  }

  randrange(start: number, stop?: number, step?: number): number;
  randrange(start: bigint, stop?: bigint, step?: bigint): bigint;
  randrange(start: number | bigint, stop?: number | bigint, step?: number | bigint): number | bigint {
    let first = integer(start, "start");
    const increment = step === undefined ? 1n : integer(step, "step");
    if (stop === undefined && step !== undefined) throw new TypeError("Missing a non-None stop argument");
    const end = stop === undefined ? first : integer(stop, "stop");
    if (stop === undefined) first = 0n;
    if (increment === 0n) throw new RangeError("zero step for randrange()");
    const width = end - first;
    if ((increment > 0n && width <= 0n) || (increment < 0n && width >= 0n)) {
      throw new RangeError("empty range for randrange()");
    }
    const count = increment > 0n ? (width + increment - 1n) / increment : (width + increment + 1n) / increment;
    const result = first + increment * this.randbelow(count);
    if (typeof start === "bigint" || typeof stop === "bigint" || typeof step === "bigint") return result;
    if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("randrange result requires bigint arguments");
    }
    return Number(result);
  }

  randint(start: number, end: number): number;
  randint(start: bigint, end: bigint): bigint;
  randint(start: number | bigint, end: number | bigint): number | bigint {
    const first = integer(start, "start");
    const last = integer(end, "end");
    if (last < first) throw new RangeError("empty range for randint()");
    const result = first + this.randbelow(last - first + 1n);
    return typeof start === "bigint" || typeof end === "bigint" ? result : Number(result);
  }

  choice<T>(sequence: readonly T[]): T {
    if (!sequence.length) throw new RangeError("Cannot choose from an empty sequence");
    return sequence[this.randbelow(sequence.length)];
  }

  shuffle<T>(sequence: T[]): void {
    for (let index = sequence.length - 1; index > 0; index--) {
      const other = this.randbelow(index + 1);
      [sequence[index], sequence[other]] = [sequence[other], sequence[index]];
    }
  }
}
