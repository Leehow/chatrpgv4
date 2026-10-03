import { useEffect, useMemo, useState } from 'react'

type Progress = { visible: number; done: boolean }
const playback = new WeakMap<object, Map<string, Progress>>()
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Live identity belongs to the message, so virtualization keeps progress without retaining old sessions.
 *
 * `growing` (contract §171.2): the text is a delivery still arriving. Playback that caught up with it resumes when
 * more arrives, instead of showing the new part all at once; a finished delivery stays complete, as before.
 */
export function useNarrationTypewriter(identity: object | undefined, full: string, channel = 'prose', growing = false) {
  const ends = useMemo(() => Array.from(segmenter.segment(full), part => part.index + part.segment.length), [full])
  const [motionReduced, setMotionReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const initial = () => ({ identity, channel, ...((identity ? playback.get(identity)?.get(channel) : undefined) ?? { visible: 0, done: false }) })
  const [progress, setProgress] = useState(initial)
  if (progress.identity !== identity || progress.channel !== channel) setProgress(initial())
  else if (growing && progress.done && progress.visible < ends.length) setProgress({ ...progress, done: false })

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!media) return
    const changed = () => setMotionReduced(media.matches)
    changed()
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])

  useEffect(() => {
    if (!identity || progress.done) return
    const save = (next: Progress) => {
      let channels = playback.get(identity)
      if (!channels) playback.set(identity, channels = new Map())
      channels.set(channel, next)
      return { identity, channel, ...next }
    }
    if (motionReduced || progress.visible >= ends.length) {
      setProgress(save({ visible: ends.length, done: true }))
      return
    }
    // Fixed increments avoid a burst after background throttling; a patch only changes the pending target.
    const timer = window.setInterval(() => setProgress(current => {
      if (current.done) return current
      const visible = Math.min(current.visible + 2, ends.length)
      if (visible >= ends.length) window.clearInterval(timer)
      return save({ visible, done: visible >= ends.length })
    }), 40)
    return () => window.clearInterval(timer)
  }, [identity, channel, ends.length, motionReduced, progress.done])

  const active = Boolean(identity && !motionReduced && !progress.done && progress.visible < ends.length)
  const visible = active ? progress.visible : ends.length
  return { active, visible, text: active ? full.slice(0, visible ? ends[visible - 1] : 0) : full }
}
