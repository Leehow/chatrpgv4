/** Shell theme registry: core defaults plus runtime-merged extension theme
 *  contributions (`app.ui.themes`, see theme-contribution-loader.ts).
 *  Pure data + pure functions + a tiny subscription store — DOM/CSS injection
 *  lives in theme-css.ts, React hooks in useShellTheme.ts.
 *
 *  Storage semantics (unchanged): `localStorage[THEME_STORAGE_KEY]` holds either
 *  SYSTEM_THEME_VALUE ('system') or a theme id. Missing or invalid values mean
 *  'system' (= follow prefers-color-scheme, resolved to the core theme of that
 *  scheme). `<main data-theme>` only ever receives a resolved concrete id,
 *  never 'system'.
 *  When a selected contributed theme disappears (pack disabled/uninstalled),
 *  resolution falls back to the system scheme WITHOUT clearing the stored
 *  selection — re-enabling the pack restores the theme. */

export const THEME_TOKEN_KEYS = [
  '--bg', '--surface', '--surface-raised', '--surface-hover', '--surface-input',
  '--border', '--border-strong', '--text', '--text-strong', '--muted', '--subtle',
  '--selection', '--accent', '--accent-soft', '--danger', '--warning', '--success',
] as const
export type ThemeTokenKey = typeof THEME_TOKEN_KEYS[number]

export interface ThemeDefinition {
  id: string
  name: string
  description: string
  scheme: 'dark' | 'light'
  /** Complete token map; exactly THEME_TOKEN_KEYS, all string values. */
  tokens: Record<ThemeTokenKey, string>
}

export const THEME_STORAGE_KEY = 'pipiui.theme'
export const SYSTEM_THEME_VALUE = 'system'
export const DEFAULT_THEME_ID = 'clay-night'

/** Core defaults always available, extension or not. The PipiCOC palette is
 *  the product's only built-in pair: Terracotta (light) and Terracotta Night
 *  (dark); 'system' and the manual toggle resolve between these two. The
 *  `.pipiui-shell` baseline in app.css mirrors the night tokens as the no-JS
 *  safety net; theme-css.ts turns these into runtime-generated rules. */
export const CORE_THEMES: readonly ThemeDefinition[] = [
  {
    id: 'clay',
    name: 'Terracotta',
    description: 'Warm clay on unbleached paper: the daylight half of the PipiCOC palette, accented with the terracotta of its icon.',
    scheme: 'light',
    tokens: {
      '--bg': '#f2ebe4', '--surface': '#eae1d8', '--surface-raised': '#fbf7f3', '--surface-hover': '#e2d6ca',
      '--surface-input': '#fbf7f3', '--border': '#ddcfc2', '--border-strong': '#cbb9a8', '--text': '#221c19',
      '--text-strong': '#1b1614', '--muted': '#6b5f56', '--subtle': '#8a7d72', '--selection': '#ebd5c4',
      '--accent': '#a04b28', '--accent-soft': '#f3dfd1', '--danger': '#a03f46', '--warning': '#815b13', '--success': '#35704d',
    },
  },
  {
    id: 'clay-night',
    name: 'Terracotta Night',
    description: 'The same clay palette after dark: fired-earth browns under lamplight, for a table that runs late.',
    scheme: 'dark',
    tokens: {
      '--bg': '#1a1512', '--surface': '#221c18', '--surface-raised': '#29221d', '--surface-hover': '#322922',
      '--surface-input': '#2c2520', '--border': '#382f28', '--border-strong': '#45392f', '--text': '#e8dcd2',
      '--text-strong': '#f6ede5', '--muted': '#a99a8d', '--subtle': '#82766b', '--selection': '#4a3427',
      '--accent': '#d9764a', '--accent-soft': '#3e2a1e', '--danger': '#cd7676', '--warning': '#e0b168', '--success': '#7cbe95',
    },
  },
]

// --- contributed themes store (extension packs, fed by theme-contribution-loader) ---

let contributedThemes: readonly ThemeDefinition[] = []
// useSyncExternalStore 按 Object.is 比较快照：合并数组必须缓存，只在贡献集
// 实际变化时重建，否则每次返回新数组会造成无限重渲染。
let allThemesCache: readonly ThemeDefinition[] = CORE_THEMES
const listeners = new Set<() => void>()

function sameThemes(a: readonly ThemeDefinition[], b: readonly ThemeDefinition[]): boolean {
  // 全量比较（含 tokens/scheme/description）：扩展热重载改了配色也要生效。
  return a.length === b.length && a.every((theme, index) => JSON.stringify(theme) === JSON.stringify(b[index]))
}

/** Replace the contributed set (id-deduped, first wins). No-ops — and therefore
 *  notifies nobody — when the incoming list is identical to the current one. */
export function setContributedThemes(themes: readonly ThemeDefinition[]): void {
  const seen = new Set<string>()
  const deduped: ThemeDefinition[] = []
  for (const theme of themes) {
    if (seen.has(theme.id)) continue
    seen.add(theme.id)
    deduped.push(theme)
  }
  if (sameThemes(contributedThemes, deduped)) return
  contributedThemes = deduped
  allThemesCache = [...CORE_THEMES, ...deduped]
  for (const listener of listeners) listener()
}

export function subscribeThemes(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every theme the shell can apply: core defaults first, then contributed packs.
 *  Stable array identity between registry changes (useSyncExternalStore-safe). */
export function getAllThemes(): readonly ThemeDefinition[] {
  return allThemesCache
}

const THEME_ID_PATTERN = /^[a-z][a-z0-9-]*$/
// Core ids plus the retired 'dark'/'light' (kept reserved so no extension pack
// can capture legacy stored selections).
const RESERVED_IDS = new Set([...CORE_THEMES.map(theme => theme.id), 'dark', 'light', SYSTEM_THEME_VALUE])
/** Token values are joined into a generated <style> rule: reject anything that
 *  could break out of the declaration block or the style element. Colors,
 *  rgb()/hsl()/color-mix() and friends all pass this denylist. */
const TOKEN_VALUE_FORBIDDEN = /[;{}<>\\"']/;

/** Fail-closed validation of one manifest `app.ui.themes` entry. Returns null
 *  for anything malformed — the caller drops it with a warning; nothing here
 *  ever throws into the renderer. */
export function validateThemeContribution(raw: unknown): ThemeDefinition | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  const id = candidate.id
  if (typeof id !== 'string' || !THEME_ID_PATTERN.test(id) || RESERVED_IDS.has(id)) return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
  if (typeof candidate.description !== 'string' || !candidate.description.trim()) return null
  if (candidate.scheme !== 'dark' && candidate.scheme !== 'light') return null
  const tokens = candidate.tokens
  if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) return null
  const tokenRecord = tokens as Record<string, unknown>
  const keys = Object.keys(tokenRecord)
  if (keys.length !== THEME_TOKEN_KEYS.length) return null
  for (const key of THEME_TOKEN_KEYS) {
    if (typeof tokenRecord[key] !== 'string') return null
  }
  for (const key of keys) {
    const value = tokenRecord[key] as string
    if (value.length > 128 || TOKEN_VALUE_FORBIDDEN.test(value)) return null
  }
  return {
    id,
    name: candidate.name as string,
    description: candidate.description as string,
    scheme: candidate.scheme,
    tokens: tokenRecord as Record<ThemeTokenKey, string>,
  }
}

/** Type guard against a theme list (defaults to the live registry). */
export function isThemeId(value: unknown, available: readonly ThemeDefinition[] = getAllThemes()): value is string {
  return typeof value === 'string' && available.some(theme => theme.id === value)
}

/** First available theme id of a color scheme — what 'system' and the manual
 *  toggle resolve to. Falls back to the first available theme so the shell
 *  always has a concrete id even if a future registry lacks one scheme. */
export function resolveSchemeThemeId(
  scheme: 'dark' | 'light',
  available: readonly ThemeDefinition[] = getAllThemes(),
): string {
  return available.find(theme => theme.scheme === scheme)?.id ?? available[0]?.id ?? DEFAULT_THEME_ID
}

/** Resolve a stored selection ('system' | theme id | anything else) to the
 *  concrete theme id the shell should render. null, SYSTEM_THEME_VALUE, invalid
 *  values and — unlike a static list — ids whose pack is currently disabled all
 *  fall through to the theme of the live system scheme. The stored selection
 *  itself is never rewritten here, so a disabled pack's theme comes back on
 *  re-enable. */
export function resolveThemeSelection(
  selection: string | null,
  systemScheme: 'dark' | 'light',
  available: readonly ThemeDefinition[] = getAllThemes(),
): string {
  if (selection !== null && selection !== SYSTEM_THEME_VALUE && isThemeId(selection, available)) return selection
  return resolveSchemeThemeId(systemScheme, available)
}
