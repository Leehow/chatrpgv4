/** Pure shared values and exact-reference contracts; no model SDK, provider, or tool schema. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Audience = 'keeper' | 'player' | 'system';
export interface ScopeBinding {
  owner: string;
  campaign?: string;
  worldline?: string;
  loop?: number;
  audience: Audience;
}

/** Host-only coordinates. A model selects an issued alias, never these fields. */
export interface SourceRef {
  version: 1;
  scope: ScopeBinding;
  resource: string;
  revision: string;
  sourceType: 'turn' | 'native_text' | 'graph' | 'record' | 'draft';
  selector: { kind: 'utf16'; start: number; end: number } | { kind: 'field'; path: string[] };
}
export class ContractError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'ContractError'; this.code = code; }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype)
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}
