export const EXTENSION_ID = 'minimax-enhanced';
export const PROVIDERS = Object.freeze(['minimax-cn', 'minimax']);
export const IMAGE_MODELS = Object.freeze(['image-01', 'image-01-live']);
export const VIDEO_MODELS = Object.freeze(['MiniMax-H3', 'MiniMax-H3-Max']);
export const ORIGINS = Object.freeze(['https://api.minimax.cn', 'https://api.minimaxi.com', 'https://api.minimax.io']);
export function enabledInHost(env = process.env) {
  return env.PIPIUI_SPAWN_CONTRACT === undefined && env.PIPIUI_HOST_PROTOCOL === undefined
    || env.PIPIUI_MOUNTED_EXTENSIONS?.split(',').map(id => id.trim()).includes(EXTENSION_ID) === true;
}
export function isMiniMax(model) {
  return PROVIDERS.includes(model?.provider) && model.api === 'anthropic-messages';
}
/** Reuse official account endpoints without forwarding keys to a guessed media URL. */
export function mediaOrigin(baseUrl, provider = 'minimax-cn') {
  const url = new URL(baseUrl ?? (provider === 'minimax' ? 'https://api.minimax.io' : 'https://api.minimax.cn'));
  if (!PROVIDERS.includes(provider) || !ORIGINS.includes(url.origin) || url.username || url.password
    || url.search || url.hash || !['/', '/v1', '/v1/', '/anthropic', '/anthropic/', '/anthropic/v1', '/anthropic/v1/'].includes(url.pathname)) {
    throw Error('MiniMax media requires a verified official HTTPS API endpoint');
  }
  return url.origin;
}
