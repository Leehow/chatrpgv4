// @vitest-environment jsdom
/**
 * A controlled settings entry may name its own nav entry (contract §37.10.1).
 *
 * A manifest title is one fixed string, so the COC Keeper's fast-model section could only be named in
 * the settings nav by a word written into the manifest and the host's hint table by hand -- a per-
 * language table by another name (§23). The entry now answers `sectionCaptions(api)` from the same
 * words as its body; a missing or failing answer keeps the manifest's title.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI } from '@pipi/host-api'
import { loadControlledContributions } from './controlled-component-loader'
import { disposeUiContributions, listSettingsSections } from './ui-registries'

const EXT = 'captions-ext'
const section = () => createElement('div', null, 'section')

async function importFixture(specifier: string): Promise<unknown> {
  const file = specifier.slice(specifier.lastIndexOf('/') + 1)
  if (file === 'named.js') return {
    createComponent: () => section,
    sectionCaptions: async (api: { invoke: (method: string, params: unknown) => Promise<{ data?: { label?: string } }> }) => {
      const answer = await api.invoke('ui-words', {})
      return { label: answer?.data?.label, hint: 'Every lane that has to be quick', description: 'One quick model' }
    },
  }
  if (file === 'failing.js') return { createComponent: () => section, sectionCaptions: async () => { throw new Error('no words') } }
  if (file === 'silent.js') return { createComponent: () => section }
  throw new Error(`unknown fixture ${specifier}`)
}

afterEach(() => disposeUiContributions(EXT))

describe('settings sections that name themselves', () => {
  it('uses the entry\'s own label, hint and header line, and keeps the manifest\'s title otherwise', async () => {
    const host = {
      invokeExtension: vi.fn(async () => ({ ok: true, data: { label: 'Fast model' } })),
      getExtensionSettings: vi.fn(async () => ({})),
    } as unknown as PipiHostAPI
    await loadControlledContributions({
      id: EXT,
      directory: '/tmp/captions-ext',
      capabilities: ['invoke.agent'],
      ui: { settingsSections: [
        { id: 'named', title: 'Manifest title', description: 'Manifest line', entry: 'named.js' },
        { id: 'failing', title: 'Kept title', description: 'Kept line', entry: 'failing.js' },
        { id: 'silent', title: 'Plain title', entry: 'silent.js' },
      ] },
    }, host, importFixture)
    const row = (id: string) => {
      const found = listSettingsSections().find(entry => entry.id === id)!
      return [found.label, found.title, found.description, found.hint]
    }
    expect(row('named')).toEqual(['Fast model', 'Fast model', 'One quick model', 'Every lane that has to be quick'])
    expect(host.invokeExtension).toHaveBeenCalledWith(EXT, 'ui-words', {})
    expect(row('failing')).toEqual(['Kept title', 'Kept title', 'Kept line', undefined])
    expect(row('silent')).toEqual(['Plain title', 'Plain title', '', undefined])
  })
})
