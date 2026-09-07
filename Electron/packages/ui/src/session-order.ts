import type { SidebarSessionPreferences } from '@pipi/host-api'

/** Sidebar session-order schema version shared by the shell and the mock host. */
export const SESSION_ORDER_VERSION = 3 as unknown as NonNullable<SidebarSessionPreferences['sessionOrderVersion']>
