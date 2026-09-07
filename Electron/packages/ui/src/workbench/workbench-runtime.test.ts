import { describe, expect, it } from 'vitest'

import { createProductWorkbenchRuntime } from './workbench-runtime'

describe('Product Workbench runtime seam', () => {
  it('keeps one rendered App runtime independent of another', () => {
    const untouched = createProductWorkbenchRuntime()
    const switched = createProductWorkbenchRuntime()

    switched.activateProductPack(
      { id: 'demo-workbench', layout: { primarySidebar: 'demo.sessions', activity: ['demo.sessions'] } },
      ['demo-workbench', 'git-capability'],
    )

    // Every runtime starts on the base shell and stays there until told otherwise.
    expect(untouched.store.snapshot()).toEqual({ packId: 'base', containers: [], views: [], layout: { activity: [] } })
    expect(untouched.activeProductExtensionsSnapshot()).toEqual([])
    expect(switched.store.snapshot()).toMatchObject({ packId: 'demo-workbench' })
    expect(switched.activeProductExtensionsSnapshot()).toEqual(['demo-workbench', 'git-capability'])
  })

  it('projects exactly the enabled extension set, pack membership included', () => {
    const runtime = createProductWorkbenchRuntime()
    runtime.activateBaseWorkbench(['skill-loader-extension', 'git-capability', 'agent-orchestration'])

    expect(runtime.store.snapshot().packId).toBe('base')
    expect(runtime.activeProductExtensionsSnapshot()).toEqual([
      'agent-orchestration',
      'git-capability',
      'skill-loader-extension',
    ])
  })
})
