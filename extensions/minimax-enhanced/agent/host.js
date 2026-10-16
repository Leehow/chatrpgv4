import { enabledInHost, IMAGE_MODELS, PROVIDERS, mediaOrigin } from './config.js';
import { minimaxImageAdapter, createVideo, queryVideo } from './media.js';

/** Registry credentials stay local to this library; callers receive media or task metadata. */
export async function resolveMiniMaxTarget(ctx, provider, options = {}) {
  if (!enabledInHost(options.env)) throw Error('MiniMax Enhanced is disabled or unmounted');
  provider ??= PROVIDERS.includes(ctx.model?.provider) ? ctx.model.provider : 'minimax-cn';
  if (!PROVIDERS.includes(provider)) throw Error('Select minimax-cn or minimax explicitly');
  const registry = ctx.modelRegistry;
  const entry = registry.getAll?.().find(model => model.provider === provider);
  const baseUrl = mediaOrigin(entry?.baseUrl, provider);
  const apiKey = await registry.getApiKeyForProvider(provider);
  if (!apiKey) throw Error(`No credential is configured for ${provider}; use Pi's existing account settings`);
  return { provider, baseUrl, apiKey };
}

export function createMiniMaxHostLibrary(ctx, options = {}) {
  const credentials = provider => resolveMiniMaxTarget(ctx, provider, options);
  return {
    async status() {
      const accounts = [];
      for (const provider of PROVIDERS) {
        let configured = false;
        try { configured = Boolean((await credentials(provider)).apiKey); } catch { /* Status never exposes credentials or internal errors. */ }
        accounts.push({provider, configured});
      }
      return {enabled: enabledInHost(options.env), accounts, imageModels: [...IMAGE_MODELS],
        videoModels: ['MiniMax-H3','MiniMax-H3-Max']};
    },
    async generateImage(req) {
      const creds = await credentials(req.provider);
      const result = await minimaxImageAdapter({kind:'gen',model:req.model ?? 'image-01',prompt:req.prompt,aspectRatio:req.aspectRatio,images:[]}, creds, options);
      return {...result, backend:'minimax', provider:creds.provider};
    },
    async editImage(req) {
      const creds = await credentials(req.provider);
      const result = await minimaxImageAdapter({kind:'edit',model:req.model ?? 'image-01',prompt:req.prompt,aspectRatio:req.aspectRatio,images:req.images}, creds, options);
      return {...result, backend:'minimax', provider:creds.provider};
    },
    async createVideo(req) {
      const creds = await credentials(req.provider);
      return {...await createVideo(req, creds, options), provider:creds.provider};
    },
    async queryVideo(req) {
      const creds = await credentials(req.provider);
      return {...await queryVideo(req.task_id, creds, options), provider:creds.provider};
    },
  };
}
