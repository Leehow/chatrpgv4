// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, Project } from '@pipi/host-api'
import { App } from './App'
import { createMockHost } from './mock-host'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

/** Empty backend whose addProject can be held pending by the test. */
function emptyProjectHost(overrides: Partial<PipiHostAPI> = {}) {
  let durable: Project[] = []
  let releaseAdd: (() => void) | null = null
  const addProject = vi.fn((path: string) => new Promise<Project>(resolve => {
    releaseAdd = () => {
      const project: Project = { id: path.split('/').pop() ?? path, name: path.split('/').pop() ?? path, path }
      durable = [...durable, project]
      resolve(project)
    }
  }))
  const host: PipiHostAPI = {
    ...createMockHost(),
    listProjects: vi.fn(async () => durable.map(project => ({ ...project }))),
    getProjectPaths: vi.fn(async () => durable.map(project => project.path)),
    listSessions: vi.fn(async () => []),
    listSessionPage: vi.fn(async () => ({ sessions: [], nextCursor: undefined, hasMore: false })),
    getSession: vi.fn(async () => { throw new Error('no such session') }),
    preloadSession: vi.fn(async () => ({ history: [], agents: [], agentLogs: [] })),
    pickProjectDirectory: vi.fn(async () => '/Users/demo/paper'),
    addProject,
    newSession: vi.fn(async (projectId: string) => {
      if (projectId.startsWith('pending-project:')) throw new Error(`unknown project ${projectId}`)
      return { id: 'paper-session', projectId, name: 'paper 会话', updatedAt: Date.now() }
    }),
    ...overrides
  }
  return { host, releaseAdd: () => releaseAdd?.() }
}

describe('new session during optimistic project add', () => {
  it('waits for the pending registration instead of failing with unknown project', async () => {
    const { host, releaseAdd } = emptyProjectHost()
    render(<App host={host} />)
    const guide = () => within(screen.getByTestId('empty-setup'))
    // Guide reaches the project step once models have loaded.
    await screen.findByTestId('empty-setup')
    await guide().findByRole('button', { name: '添加项目' })
    fireEvent.click(guide().getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(host.addProject).toHaveBeenCalledWith('/Users/demo/paper'))
    // addProject is still in flight; the optimistic pending row already makes
    // 新建会话 the primary action. Clicking it used to send the pending id.
    fireEvent.click(await guide().findByRole('button', { name: '新建会话' }))
    await waitFor(() => expect(screen.queryByText(/创建会话失败/)).toBeNull())
    releaseAdd()
    await waitFor(() => expect(host.newSession).toHaveBeenCalledWith('paper'))
    for (const call of (host.newSession as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(call[0])).not.toMatch(/^pending-project:/)
    }
    expect(screen.queryByText(/unknown project/)).toBeNull()
  })
})
