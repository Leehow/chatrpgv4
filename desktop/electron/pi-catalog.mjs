import { resolvePayloadModule } from "./payload-module.mjs";

const {
  extraApiKeyProviders,
  extraOauthProviders,
  isEditorRowShown,
  keeperNodeModules,
  listPiCatalogProviders,
  loginProviderMeta,
  morePiProviders,
  serializePiProvider,
} = await import(resolvePayloadModule("web/server-node/pi-catalog.mjs"));

export {
  extraApiKeyProviders,
  extraOauthProviders,
  isEditorRowShown,
  keeperNodeModules,
  listPiCatalogProviders,
  loginProviderMeta,
  morePiProviders,
  serializePiProvider,
};
