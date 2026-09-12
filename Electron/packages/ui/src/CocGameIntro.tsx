/**
 * The game intro card pinned above the transcript: what this game is, how a campaign
 * begins, and how to play, in the session's own play language.
 *
 * Every word comes from the `intro` surface of the `ui` block the host attaches to the
 * timeline answer (contract §23, 2026-09-09) -- the one authored set is
 * `content/ui/en/intro.json`, and every other tag arrives through the projection lane's
 * cache. A missing key draws the key itself, so a gap is something a player can name,
 * never a word from a language they did not choose. No words at all (no answer yet, or a
 * build without the surface) draws nothing, not a skeleton in a language nobody picked.
 *
 * The card re-reads with the timeline: when a background projection lands, the pack emits
 * `timeline-changed` (pipicoc/timeline.ts), the app refetches `timeline.graph`, and the
 * new `ui.words.intro` turns the card to the session's language in place.
 */
import {useState} from 'react'
import './coc-game-intro.css'

type Props = {words: Record<string, string> | undefined}

/** One global key: the guide is the product's, not one campaign's. */
const STORAGE_KEY = 'pipicoc.game-intro.collapsed'

/** A caption from the `intro` surface, or the key itself so a gap can be reported. */
function word(words: Record<string, string>, key: string): string {
  const found = words[key]
  return typeof found === 'string' ? found : key
}

function readCollapsed(): boolean {
  try {return localStorage.getItem(STORAGE_KEY) === '1'}
  catch {return false}
}

export function CocGameIntro({words}: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  if (!words) return null
  const toggle = () => setCollapsed(current => {
    const next = !current
    try {localStorage.setItem(STORAGE_KEY, next ? '1' : '0')} catch { /* storage is a nicety */ }
    return next
  })
  return <aside className={`coc-game-intro${collapsed ? ' collapsed' : ''}`} data-testid="coc-game-intro">
    <header className="coc-game-intro-header">
      <div className="coc-game-intro-heading">
        <span className="coc-game-intro-eyebrow">{word(words, 'eyebrow')}</span>
        <h2 className="coc-game-intro-title">{word(words, 'title')}</h2>
      </div>
      <button type="button" className="coc-game-intro-toggle" aria-expanded={!collapsed} onClick={toggle}>
        {word(words, collapsed ? 'show' : 'hide')}
      </button>
    </header>
    {!collapsed && <div className="coc-game-intro-body">
      <p className="coc-game-intro-lede">{word(words, 'lede')}</p>
      <div className="coc-game-intro-sections">
        <section>
          <h3>{word(words, 'whatTitle')}</h3>
          <p>{word(words, 'whatBody')}</p>
        </section>
        <section>
          <h3>{word(words, 'createTitle')}</h3>
          <p>{word(words, 'createBody')}</p>
        </section>
        <section>
          <h3>{word(words, 'playTitle')}</h3>
          <p>{word(words, 'playBody')}</p>
        </section>
      </div>
    </div>}
  </aside>
}
