/** Shared-disk model prefs win over per-origin localStorage. */
export function hydrateModelSelection(input: {
  remoteProvider?: string | null;
  remoteModel?: string | null;
  remoteThinking?: string | null;
  localProvider?: string | null;
  localModel?: string | null;
  localThinking?: string | null;
}): {
  provider: string;
  model: string;
  thinking: string;
  shouldUpload: boolean;
} {
  const remoteProvider = String(input.remoteProvider || "").trim();
  const remoteModel = String(input.remoteModel || "").trim();
  const remoteThinking = String(input.remoteThinking || "").trim();
  const localProvider = String(input.localProvider || "").trim();
  const localModel = String(input.localModel || "").trim();
  const localThinking = String(input.localThinking || "").trim();
  const remoteHasModel = Boolean(remoteProvider && remoteModel);
  return {
    provider: remoteHasModel ? remoteProvider : localProvider,
    model: remoteHasModel ? remoteModel : localModel,
    thinking: remoteThinking || localThinking,
    shouldUpload: !remoteHasModel && Boolean(localProvider && localModel),
  };
}

export function shouldPersistModelPrefs(input: {
  prefsReady: boolean;
  prefsWritable: boolean;
  provider: string;
  model: string;
}): boolean {
  return Boolean(
    input.prefsReady && input.prefsWritable && input.provider && input.model,
  );
}
