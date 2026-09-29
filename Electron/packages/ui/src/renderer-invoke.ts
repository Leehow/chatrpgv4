import type { PipiHostAPI } from '@pipi/host-api'
import type { RendererInvoke } from './ui-registries'

/**
 * Contract §155.8: the host call a pack's transcript renderer makes as the extension that
 * registered it (today the delivery card's handout translate control), bound to the session the
 * transcript shows. The controlled loader supplies the extension id; nothing here names one.
 *
 * An `ok` answer resolves to its `data`. A refusal rejects with an Error whose `code` is the
 * refusal's code, so the card can caption it from the `errors` surface in the player's language
 * instead of printing the host's English sentence, which stays on `message` for the log.
 *
 * No host channel, or no session, is no call at all: the renderer then draws no control.
 */
export function rendererInvoke(host: PipiHostAPI, sessionId: string | undefined): RendererInvoke | undefined {
  if (!host.invokeExtension || !sessionId) return undefined
  return async (extensionId, method, params) => {
    const answer = await host.invokeExtension!(extensionId, method, params, { sessionId })
    if (answer.ok) return answer.data
    throw Object.assign(new Error(answer.error?.message || `${method} failed`), { code: answer.error?.code || 'unknown' })
  }
}
