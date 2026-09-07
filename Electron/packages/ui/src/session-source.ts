/** Sidebar session origin. The kernel only owns Pi sessions; a vendor-session
 *  extension would contribute its own source marks through the UI registries. */
export type SessionSource = 'pi'

export const SESSION_SOURCE_LABELS: Record<SessionSource, string> = {
  pi: 'Pi',
}

export function isSessionSource(value: unknown): value is SessionSource {
  return typeof value === 'string' && value in SESSION_SOURCE_LABELS
}

export function sessionSourceLabel(source: string | undefined): string {
  return isSessionSource(source) ? SESSION_SOURCE_LABELS[source] : SESSION_SOURCE_LABELS.pi
}
