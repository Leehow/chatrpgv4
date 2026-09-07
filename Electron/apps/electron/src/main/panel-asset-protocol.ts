/**
 * `pipiui-asset://<extension-id>/<project-id>/<project-relative path>` — the byte channel
 * for panels.
 *
 * A panel had exactly one file channel, `app.data.read`: utf8, 512 KiB, and it skips to the
 * first newline when it truncates. That is a log-tail reader for JSONL shards, and an image
 * pushed through it as base64 is both mangled and needlessly capped. This serves the same
 * declared files as bytes instead, so a panel can write `<img src=...>` and let the
 * renderer stream it.
 *
 * It adds a transport, never a permission: every request goes through the same two gates as
 * the text channel — the extension must be installed for the project, and the path must sit
 * under one of its declared `app.data.read` roots.
 *
 * The extension id is the URL host, so each extension gets its own origin and one panel's
 * assets are not same-origin with another's. Extension ids are `[a-z][a-z0-9-]*`; a
 * non-special scheme's host is not case-folded by the URL parser, so a mis-cased host is
 * rejected outright rather than quietly resolving to a different extension.
 *
 * The project id rides in the first path segment because the gate needs it: the same
 * extension is installed per project, and `resolveExtensionDataAccess` refuses a read with
 * no project rather than guessing one. Leaving it out is not "the current project" — it is
 * a 404.
 */

/** Mirrors EXTENSION_ID_RE in pi-backend; kept local so the protocol has no import cycle. */
const EXTENSION_ID_RE = /^[a-z][a-z0-9-]*$/

export type PanelAssetRequest = { extensionId: string; projectId: string; path: string }

/**
 * Parse a request URL. Returns undefined for anything malformed — the handler answers 400
 * rather than guessing, because a guess here is a path traversal waiting to happen.
 */
export function parsePanelAssetUrl(rawUrl: string): PanelAssetRequest | undefined {
  // Check the raw string, not the parsed pathname: the URL parser resolves `..` (and its
  // percent-encoded spellings) away, so `.../../../etc/passwd` arrives as `/etc/passwd`
  // and a check on the parsed path would never fire. Normalization means such a request
  // cannot escape the URL root, and confinedDataPath would reject it downstream anyway —
  // but a declared path never legitimately contains `..`, so refuse it outright and keep
  // the attempt away from the loader.
  if (/(^|[/\\])\.\.([/\\]|$)/.test(rawUrl) || /%2e%2e/i.test(rawUrl)) return undefined
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }
  const extensionId = url.hostname
  if (!EXTENSION_ID_RE.test(extensionId)) return undefined
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return undefined
  }
  path = path.replace(/^\/+/, '')
  // A NUL survives the parser as `%00` and only becomes a terminator after decoding, so it
  // is checked here rather than on the raw string.
  if (!path || path.includes('\0')) return undefined
  const slash = path.indexOf('/')
  if (slash <= 0) return undefined
  const projectId = path.slice(0, slash)
  const rest = path.slice(slash + 1)
  if (!projectId || !rest || projectId.includes('\0')) return undefined
  return { extensionId, projectId, path: rest }
}

export type PanelAssetReader = (
  extensionId: string,
  projectId: string,
  path: string,
) => Promise<{ bytes: Uint8Array; mime: string; size: number }>

/**
 * Build the `protocol.handle` callback. `read` is injected so the handler is testable
 * without Electron and without a real project on disk.
 */
export function createPanelAssetHandler(read: PanelAssetReader) {
  return async (request: { url: string }): Promise<Response> => {
    const parsed = parsePanelAssetUrl(request.url)
    if (!parsed) return new Response('bad asset url', { status: 400, headers: { 'content-type': 'text/plain' } })
    let asset: { bytes: Uint8Array; mime: string; size: number }
    try {
      asset = await read(parsed.extensionId, parsed.projectId, parsed.path)
    } catch {
      // One status for "not declared", "not installed" and "missing": a panel probing for
      // which of the three it hit learns about files it was never allowed to see.
      return new Response('asset unavailable', { status: 404, headers: { 'content-type': 'text/plain' } })
    }
    return new Response(asset.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': asset.mime,
        'content-length': String(asset.size),
        // The type comes from the extension's own suffix table, so sniffing could only
        // ever disagree with it — and a sniffed text/html here would be a same-origin
        // document inside the app.
        'x-content-type-options': 'nosniff',
        // Panel data changes underneath the same path (the newest frame keeps its name),
        // so a cached response would show a stale one.
        'cache-control': 'no-store',
      },
    })
  }
}
