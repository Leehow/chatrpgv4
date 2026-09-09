/**
 * The `ui: {tag, words}` block a host attaches to every COC answer a renderer draws from
 * (contract §23, 2026-09-09), built here from the surface files this build actually ships.
 *
 * The words are imported, not transcribed. A test that spelled its own captions would pass while
 * `content/ui/<tag>/<surface>.json` said something else, and the renderers are exactly the place
 * where that divergence is invisible: they read a key and print whatever comes back. Reading the
 * shipped files means renaming a key or editing a caption has to travel to the test.
 *
 * `runtime/ui-words.ts` is the host's loader and reads these same files from disk; it cannot run in
 * jsdom, so this assembles the same shape from static imports the way `coc-panel.test.tsx` imports
 * `weapons.json`.
 */
import enChoices from '../../../../../content/ui/en/choices.json'
import enErrors from '../../../../../content/ui/en/errors.json'
import enMechanics from '../../../../../content/ui/en/mechanics.json'
import enMods from '../../../../../content/ui/en/mods.json'
import enOnboarding from '../../../../../content/ui/en/onboarding.json'
import enPaper from '../../../../../content/ui/en/paper.json'
import enPreparation from '../../../../../content/ui/en/preparation.json'
import enSheet from '../../../../../content/ui/en/sheet.json'
import enTranscript from '../../../../../content/ui/en/transcript.json'
import zhChoices from '../../../../../content/ui/zh-Hans/choices.json'
import zhErrors from '../../../../../content/ui/zh-Hans/errors.json'
import zhMechanics from '../../../../../content/ui/zh-Hans/mechanics.json'
import zhMods from '../../../../../content/ui/zh-Hans/mods.json'
import zhOnboarding from '../../../../../content/ui/zh-Hans/onboarding.json'
import zhPaper from '../../../../../content/ui/zh-Hans/paper.json'
import zhPreparation from '../../../../../content/ui/zh-Hans/preparation.json'
import zhSheet from '../../../../../content/ui/zh-Hans/sheet.json'
import zhTranscript from '../../../../../content/ui/zh-Hans/transcript.json'

export type Surfaces = Record<string, Record<string, string>>
export type Ui = { tag: string; words: Surfaces }

const SHIPPED: Record<string, Surfaces> = {
  en: {choices: enChoices, errors: enErrors, mechanics: enMechanics, mods: enMods, onboarding: enOnboarding,
    paper: enPaper, preparation: enPreparation, sheet: enSheet, transcript: enTranscript},
  'zh-Hans': {choices: zhChoices, errors: zhErrors, mechanics: zhMechanics, mods: zhMods, onboarding: zhOnboarding,
    paper: zhPaper, preparation: zhPreparation, sheet: zhSheet, transcript: zhTranscript},
}

/**
 * One language's `ui` block, optionally with a surface's key overridden or removed.
 *
 * `over` is how a test says "this key is missing" (pass `undefined`) without editing shipped data:
 * the renderers owe a visible identifier there, not another language's word.
 */
export function ui(tag = 'zh-Hans', over: Record<string, Record<string, string | undefined>> = {}): Ui {
  const base = SHIPPED[tag] ?? SHIPPED.en
  const words: Surfaces = {}
  for (const [surface, table] of Object.entries(base)) words[surface] = {...table}
  for (const [surface, patch] of Object.entries(over)) {
    words[surface] = {...(words[surface] ?? {})}
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete words[surface][key]
      else words[surface][key] = value
    }
  }
  return {tag, words}
}

/** A single shipped caption, so a test can name what it expects without transcribing it. */
export function say(tag: string, surface: string, key: string): string {
  const word = (SHIPPED[tag] ?? SHIPPED.en)[surface]?.[key]
  if (typeof word !== 'string') throw new Error(`content/ui/${tag}/${surface}.json has no ${key}`)
  return word
}
