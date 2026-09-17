import { createContext, useContext, type ReactNode } from 'react'
import type { Session } from '@pipi/host-api'

/**
 * §NN. Whether the assistant in this transcript holds information its viewer is not entitled to.
 *
 * The base shell is a console: the viewer runs the assistant, so the assistant's working is the
 * viewer's, and the transcript opens its reasoning body by itself so tokens are seen arriving
 * rather than waited out. PipiCOC breaks that assumption. Its assistant is the Keeper, and one of
 * the product's invariants is that the module's truth is read-only and secret by default — the
 * viewer is a player being played to, not the operator. There the run is still shown in full
 * (contract §22, 2026-09-15: nothing about the process display may be suppressed), but the
 * reasoning body waits to be asked for, because a body that opens itself puts the Keeper's
 * private working in front of the player ahead of the narration it was still writing.
 *
 * This is a property of the transcript, not a filter over what reasoning says: no text is read,
 * classified or withheld, and one click still opens the same card it always did.
 */
const AssistantSecretsContext = createContext(false)

export function AssistantKeepsSecrets({ value, children }: { value: boolean; children: ReactNode }) {
  return <AssistantSecretsContext.Provider value={value}>{children}</AssistantSecretsContext.Provider>
}

export function useAssistantKeepsSecrets(): boolean {
  return useContext(AssistantSecretsContext)
}

/**
 * Two independent reads answer it, and either one is enough.
 *
 * `productId` comes from one `host.getProduct()` at mount (§84). That read is known to drop —
 * when it does, the whole shell falls back to the base product with nothing on screen to say so,
 * and a gate that hung on it alone would silently hand the player the Keeper's reasoning again.
 * The session carries the Pi child's own product profile, so a session bound to `coc-keeper`
 * answers the same question from a different source. A transcript with no answer at all is a
 * console, which is what the base product is.
 */
export function assistantKeepsSecretsFor(productId: string | undefined, session: Session | undefined): boolean {
  return productId === 'pipicoc' || session?.productProfile?.id === 'coc-keeper'
}
