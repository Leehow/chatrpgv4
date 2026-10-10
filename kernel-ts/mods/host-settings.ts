/** Retired secret slots are accepted as read-only package metadata, never exposed or used. */
export const HISTORY_CAPABILITY = 'context.historical-reference.v1';
export const HOST_SETTINGS = Object.freeze({});
export function validHostSettings(value: unknown): value is string[] {
  return Array.isArray(value) && new Set(value).size === value.length
    && value.every(slot => slot === 'exa_api_key');
}
export function hostSettingsView(_value: unknown): unknown[] {return [];}
