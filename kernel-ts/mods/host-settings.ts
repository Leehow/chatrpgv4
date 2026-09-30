/** Contract 124.12: packages name registered slots, never arbitrary host credentials. */
export const HISTORY_CAPABILITY = 'context.historical-reference.v1';
export const HOST_SETTINGS = Object.freeze({exa_api_key: {
  key: 'ext.coc-keeper.exaApiKey', format: 'secret', caption: 'exaKey',
}});
export function validHostSettings(value: unknown): value is Array<keyof typeof HOST_SETTINGS> {
  return Array.isArray(value) && new Set(value).size === value.length
    && value.every(slot => typeof slot === 'string' && Object.hasOwn(HOST_SETTINGS, slot));
}
export function hostSettingsView(value: unknown) {
  return validHostSettings(value) ? value.map(slot => ({slot, ...HOST_SETTINGS[slot]})) : [];
}
