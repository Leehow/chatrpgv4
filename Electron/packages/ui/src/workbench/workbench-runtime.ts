import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { ProductPackLayout } from '@pipi/host-api'

import { listWorkbenchContainers, listWorkbenchViews } from './workbench-contributions'
import { createWorkbenchStore, type WorkbenchStore } from './workbench-store'

/** A project running no pack is not a product with an id; it is the base. */
export const BASE_PACK_ID = 'base'

/**
 * The shell a project gets before any pack: generic workspace/Conversation
 * navigation, owned by the kernel rather than by any extension.
 */
const BASE_LAYOUT: ProductPackLayout = Object.freeze({
  primarySidebar: 'pipi.sessions',
  center: 'pipi.conversation',
  activity: ['pipi.sessions'],
})

export type ProductWorkbenchRuntime = {
  readonly store: WorkbenchStore
  /** The no-pack shell. Also the first paint, before enablement is known. */
  activateBaseWorkbench(enabledExtensionIds?: readonly string[]): () => void
  /**
   * Apply one product pack's form: its `app.ui.layout` plus the extensions this
   * project actually has enabled. Both come from `listExtensions`; a pack is
   * simply the enabled extension that declares a layout.
   */
  activateProductPack(pack: { id: string; layout?: ProductPackLayout }, enabledExtensionIds: readonly string[]): () => void
  subscribeActiveProductExtensions(listener: () => void): () => void
  activeProductExtensionsSnapshot(): readonly string[]
}

/**
 * A single rendered PipiUI owns its own Workbench plan and active extensions.
 * Contributions are process-wide registrations, while this runtime is the
 * per-window projection that selects which of those contributions are visible.
 */
export function createProductWorkbenchRuntime(): ProductWorkbenchRuntime {
  const store = createWorkbenchStore()
  let activeExtensionIds: readonly string[] = Object.freeze([])
  let activeGeneration = 0
  const activeListeners = new Set<() => void>()

  const applyActiveExtensionIds = (ids: readonly string[]): (() => void) => {
    const generation = ++activeGeneration
    activeExtensionIds = Object.freeze([...new Set(ids)].sort())
    activeListeners.forEach(listener => listener())
    return () => {
      if (generation !== activeGeneration) return
      activeGeneration += 1
      activeExtensionIds = Object.freeze([])
      activeListeners.forEach(listener => listener())
    }
  }

  const activate = (
    packId: string,
    layout: ProductPackLayout,
    enabledExtensionIds: readonly string[],
  ): (() => void) => {
    const requested = new Set([
      layout.primarySidebar,
      layout.center,
      layout.auxiliarySidebar,
      ...(layout.activity ?? []),
    ].filter((id): id is string => Boolean(id)))
    const containers = listWorkbenchContainers()
      .filter(container => requested.has(container.id) ||
        (container.location === 'overlay' && enabledExtensionIds.includes(container.extensionId)))
      .map(({ extensionId: _extensionId, ...container }) => container)
    const known = new Set(containers.map(container => container.id))
    const views = listWorkbenchViews()
      .filter(view => known.has(view.container))
      .map(({ extensionId: _extensionId, render: _render, ...view }) => view)
    const disposeExtensions = applyActiveExtensionIds(enabledExtensionIds)
    const disposeWorkbench = store.apply({
      packId,
      containers,
      views,
      layout: {
        ...(layout.primarySidebar && known.has(layout.primarySidebar) ? { primarySidebar: layout.primarySidebar } : {}),
        ...(layout.center && known.has(layout.center) ? { center: layout.center } : {}),
        ...(layout.auxiliarySidebar && known.has(layout.auxiliarySidebar) ? { auxiliarySidebar: layout.auxiliarySidebar } : {}),
        activity: (layout.activity ?? []).filter(id => known.has(id)),
      },
    })
    return () => { disposeWorkbench(); disposeExtensions() }
  }

  const runtime: ProductWorkbenchRuntime = {
    store,
    activateBaseWorkbench: (enabledExtensionIds = []) => activate(BASE_PACK_ID, BASE_LAYOUT, enabledExtensionIds),
    activateProductPack: (pack, enabledExtensionIds) =>
      activate(pack.id, pack.layout ?? BASE_LAYOUT, enabledExtensionIds),
    subscribeActiveProductExtensions(listener) {
      activeListeners.add(listener)
      return () => activeListeners.delete(listener)
    },
    activeProductExtensionsSnapshot: () => activeExtensionIds,
  }

  // First paint is the base shell; the project's own form replaces it in one
  // emit as soon as `listExtensions` says which pack (if any) is enabled.
  runtime.activateBaseWorkbench()
  return runtime
}

const ProductWorkbenchRuntimeContext = createContext<ProductWorkbenchRuntime | null>(null)

export function ProductWorkbenchProvider({ runtime, children }: { runtime: ProductWorkbenchRuntime; children: ReactNode }) {
  return createElement(ProductWorkbenchRuntimeContext.Provider, { value: runtime }, children)
}

export function useProductWorkbenchRuntime(): ProductWorkbenchRuntime {
  const runtime = useOptionalProductWorkbenchRuntime()
  if (!runtime) throw new Error('ProductWorkbenchProvider is required')
  return runtime
}

export function useOptionalProductWorkbenchRuntime(): ProductWorkbenchRuntime | null {
  return useContext(ProductWorkbenchRuntimeContext)
}

export function useActiveProductExtensions(): readonly string[] {
  const runtime = useProductWorkbenchRuntime()
  return useSyncExternalStore(
    runtime.subscribeActiveProductExtensions,
    runtime.activeProductExtensionsSnapshot,
    runtime.activeProductExtensionsSnapshot,
  )
}

export function useProductExtensionEnabled(id: string): boolean {
  return useActiveProductExtensions().includes(id)
}

/** Active form id: the enabled pack's extension id, or `base`. */
export function useActiveProductPackId(): string {
  const runtime = useProductWorkbenchRuntime()
  return useSyncExternalStore(runtime.store.subscribe, runtime.store.snapshot, runtime.store.snapshot).packId
}

export function useActiveWorkbenchPlan() {
  const runtime = useProductWorkbenchRuntime()
  return useSyncExternalStore(runtime.store.subscribe, runtime.store.snapshot, runtime.store.snapshot)
}
