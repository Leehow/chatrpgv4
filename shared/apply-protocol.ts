/** Fixed event-only transaction defaults, never semantic action inference. */
export function normalizeApplyArguments(input:unknown):unknown {
 if(!input||typeof input!=='object'||Array.isArray(input))return input;
 const row=input as Record<string,unknown>;
 return !Object.hasOwn(row,'effects')&&row.event&&typeof row.event==='object'&&!Array.isArray(row.event)?{...row,effects:[]}:input;
}
