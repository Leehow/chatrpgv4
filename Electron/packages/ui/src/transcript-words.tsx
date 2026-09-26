import { createContext, useContext, type ReactNode } from 'react'

/**
 * The `transcript` surface's words (contract §23): the captions the transcript itself owes a table,
 * from the `ui` block the host attaches to the session's answers. Authored once in English under
 * `content/ui/en/transcript.json` and projected for every other play language by the presenter lane;
 * nothing here is written per language.
 *
 * A transcript with no words (a console, or a table whose answer has not arrived yet) is handed none.
 */
const TranscriptWordsContext = createContext<Record<string, string> | undefined>(undefined)

export function TranscriptWords({ words, children }: { words?: Record<string, string>; children: ReactNode }) {
  return <TranscriptWordsContext.Provider value={words}>{children}</TranscriptWordsContext.Provider>
}

export function useTranscriptWords(): Record<string, string> | undefined {
  return useContext(TranscriptWordsContext)
}

/**
 * One caption. Call it with the key written in place, never through a variable: the surface's keys
 * are found by a static scan (`tests/extension/ui-words-surfaces.test.mjs`).
 *
 * No words at all draws an ellipsis, a language nobody has chosen yet being worse than no words; words
 * that lack the key draw the key, which is a gap a player can report. Same rule as `presentationWord`.
 */
export function transcriptWord(words: Record<string, string> | undefined, key: string): string {
  if (!words) return '…'
  const word = words[key]
  return typeof word === 'string' && word ? word : key
}
