import { describe, expect, it, vi } from 'vitest'
import { createPanelAssetHandler, parsePanelAssetUrl } from './panel-asset-protocol.js'

describe('parsePanelAssetUrl', () => {
  it('splits host into extension id and pathname into a project-relative path', () => {
    expect(parsePanelAssetUrl('pipiui-asset://hydra-params/proj-1/telemetry/data/frame.png')).toEqual({
      extensionId: 'hydra-params',
      projectId: 'proj-1',
      path: 'telemetry/data/frame.png',
    })
  })

  it('decodes percent-escapes so a space in a filename resolves', () => {
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1/a/b%20c.png')?.path).toBe('a/b c.png')
  })

  it('refuses traversal in the raw url, which the parser would otherwise normalise away', () => {
    // new URL() resolves these to /secret and /etc/passwd before any check on the parsed
    // path could see them, so the refusal has to look at the raw string.
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1/../secret')).toBeUndefined()
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1/a/%2e%2e/secret')).toBeUndefined()
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1/../../../etc/passwd')).toBeUndefined()
    // A filename that merely contains dots is not traversal.
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1/a..b.png')?.path).toBe('a..b.png')
  })

  it('refuses a NUL byte in the path', () => {
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1/a%00.png')).toBeUndefined()
  })

  it('refuses an extension id that is not a valid extension id', () => {
    // A non-special scheme's host keeps its case, so a mis-cased id is refused rather than
    // silently resolving to the lower-cased extension.
    expect(parsePanelAssetUrl('pipiui-asset://Not-An-Id/p1/x.png')).toBeUndefined()
    expect(parsePanelAssetUrl('pipiui-asset://9bad/p1/x.png')).toBeUndefined()
    expect(parsePanelAssetUrl('pipiui-asset:///p1/x.png')).toBeUndefined()
  })

  it('refuses an empty path', () => {
    expect(parsePanelAssetUrl('pipiui-asset://demo/')).toBeUndefined()
    expect(parsePanelAssetUrl('not a url')).toBeUndefined()
  })

  it('refuses a url with a project id but no file path', () => {
    // The gate needs a project; a url that is only a project would resolve to a directory.
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1')).toBeUndefined()
    expect(parsePanelAssetUrl('pipiui-asset://demo/p1/')).toBeUndefined()
  })
})

describe('createPanelAssetHandler', () => {
  const asset = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', size: 3 }

  it('serves the bytes with the declared type and refuses sniffing', async () => {
    const read = vi.fn().mockResolvedValue(asset)
    const res = await createPanelAssetHandler(read)({ url: 'pipiui-asset://hydra-params/proj-1/telemetry/data/f.png' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe('3')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    // Panel data changes under a stable path; a cached response would show a stale frame.
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(asset.bytes)
    // The project id must reach the gate: resolveExtensionDataAccess refuses a read
    // without one, so dropping it here is a guaranteed 404 in the real app.
    expect(read).toHaveBeenCalledWith('hydra-params', 'proj-1', 'telemetry/data/f.png')
  })

  it('answers 400 on a malformed url without calling the reader', async () => {
    const read = vi.fn()
    const res = await createPanelAssetHandler(read)({ url: 'pipiui-asset://demo/p1/../escape' })
    expect(res.status).toBe(400)
    expect(read).not.toHaveBeenCalled()
  })

  it('collapses every denial into one 404 so probing learns nothing', async () => {
    const notDeclared = createPanelAssetHandler(vi.fn().mockRejectedValue(new Error('no declared data path')))
    const missing = createPanelAssetHandler(vi.fn().mockRejectedValue(new Error('data path is unavailable')))
    const a = await notDeclared({ url: 'pipiui-asset://demo/p1/x.png' })
    const b = await missing({ url: 'pipiui-asset://demo/p1/x.png' })
    expect(a.status).toBe(404)
    expect(b.status).toBe(404)
    expect(await a.text()).toBe(await b.text())
  })
})
