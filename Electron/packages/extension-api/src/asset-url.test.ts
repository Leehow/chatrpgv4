import { describe, expect, it } from 'vitest'
import { createExtensionHostAPI } from './index.js'

const host = {
  listExtensionData: async () => [],
  readExtensionData: async () => ({ content: '', bytes: 0, truncated: false }),
}

const apiFor = (id: string) =>
  createExtensionHostAPI({ extensionId: id, capabilities: ['data.read'], projectId: 'proj-1', host: host as never })
// 显式传 undefined 会触发默认参数，所以「没有 projectId」要单独构造，不能靠给 apiFor 传 undefined。
const apiWithProject = (projectId?: string) =>
  createExtensionHostAPI({ extensionId: 'demo', capabilities: ['data.read'], projectId, host: host as never })

describe('data.assetUrl', () => {
  it('addresses the caller extension, never one the panel names', () => {
    expect(apiFor('hydra-params').data?.assetUrl('telemetry/data/f.png')).toBe(
      'pipiui-asset://hydra-params/proj-1/telemetry/data/f.png',
    )
  })

  it('percent-encodes each segment but keeps the separators', () => {
    expect(apiFor('demo').data?.assetUrl('a b/c#d.png')).toBe('pipiui-asset://demo/proj-1/a%20b/c%23d.png')
  })

  it('normalises a leading slash and backslashes', () => {
    expect(apiFor('demo').data?.assetUrl('/a/b.png')).toBe('pipiui-asset://demo/proj-1/a/b.png')
    expect(apiFor('demo').data?.assetUrl('a\\b.png')).toBe('pipiui-asset://demo/proj-1/a/b.png')
  })

  it('returns undefined rather than a url the protocol will reject', () => {
    expect(apiFor('demo').data?.assetUrl('')).toBeUndefined()
    expect(apiFor('demo').data?.assetUrl('   ')).toBeUndefined()
    expect(apiFor('demo').data?.assetUrl('a/../b.png')).toBeUndefined()
    expect(apiFor('demo').data?.assetUrl('../b.png')).toBeUndefined()
  })

  it('keeps a filename that merely contains dots', () => {
    expect(apiFor('demo').data?.assetUrl('a..b.png')).toBe('pipiui-asset://demo/proj-1/a..b.png')
  })

  it('returns undefined without a project id, since the gate would refuse the read', () => {
    expect(apiWithProject().data?.assetUrl('a.png')).toBeUndefined()
    expect(apiWithProject('   ').data?.assetUrl('a.png')).toBeUndefined()
  })

  it('percent-encodes the project id too', () => {
    expect(apiWithProject('a b/c').data?.assetUrl('x.png')).toBe('pipiui-asset://demo/a%20b%2Fc/x.png')
  })

  it('is absent without the data.read capability', () => {
    expect(createExtensionHostAPI({ extensionId: 'demo', capabilities: [], host: host as never }).data).toBeUndefined()
  })
})
