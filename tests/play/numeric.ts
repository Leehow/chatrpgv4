/** Native binary64 ties-to-even rounding, following kernel-ts/read/values.ts and the original controller numeric contract. */
export function round(value: number, digits = 0): number {
    const integral = arguments.length < 2;
    if (!Number.isFinite(value)) {
        if (integral) throw new RangeError("Cannot round a non-finite value to an integer");
        return value;
    }
    if (!Number.isInteger(digits)) throw new TypeError("Rounding digits must be an integer");
    if (value === 0) return integral ? 0 : value;
    if (digits > 323) return value;
    if (digits < -308) return integral ? 0 : Math.sign(value) * 0;
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
    // Convert the scaled integer in one decimal parse, avoiding intermediate overflow.
    const result = Math.sign(value) * Number(`${quotient}e${-digits}`);
    if (!Number.isFinite(result)) throw new RangeError("Rounded value is too large to represent");
    return integral && result === 0 ? 0 : result;
}

/** Fixed decimal display keeps the same even-tie rule, including signed zero. */
export function fixed(value:number,digits:number):string{const rounded=round(value,digits);return (Object.is(rounded,-0)?"-":"")+rounded.toFixed(digits);}
