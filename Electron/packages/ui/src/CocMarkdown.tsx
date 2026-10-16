import React, { memo, useMemo, useRef, type ReactNode } from 'react'
import { Streamdown, defaultRehypePlugins, parseMarkdownIntoBlocks, type Components, type StreamdownProps } from 'streamdown'
import { code } from '@streamdown/code'

export type ProseSpeaker = { who: string; title?: string; ink?: string }
export type CocProseRun = { text?: string; speaker?: ProseSpeaker; node?: ReactNode }
type Range = { start: number; end: number; speaker: ProseSpeaker }
type AstNode = {
  type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: AstNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}
const controls = { table: { copy: false, download: false, fullscreen: false }, code: { copy: true, download: false }, mermaid: false }
const plugins = { code }
const noNodes: ReactNode[] = []
const oneBlock = (source: string) => [source]

/** Decorations are added after sanitization, from host-owned ranges and receipt nodes only. */
function decorate({ ranges, prefix, source }: { ranges: Range[]; prefix: string; source: string }) {
  return (tree: AstNode) => {
    const visit = (parent: AstNode) => {
      if (!parent.children) return
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text' || !node.value) { visit(node); return [node] }
        const value = node.value
        // HAST inserts separator whitespace without a source position; it is not speech.
        const start = node.position?.start.offset
        if (start === undefined) return [node]
        const raw = source.slice(start, node.position?.end.offset ?? start + value.length)
        // Source positions include Markdown escapes and entities; rendered text does not.
        const textIndex = (offset: number) => Math.min(value.length, raw.slice(0, Math.max(0, offset))
          .replace(/\\([!-/:-@[-`{-~])/g, '$1')
          .replace(/&(?:#\d+|#[xX][\da-fA-F]+|[A-Za-z][\dA-Za-z]*);/g, entity => {
            const decoder = document.createElement('textarea')
            // This input is a single entity token, never model HTML or a tag.
            decoder.innerHTML = entity
            return decoder.value
          }).length)
        const localRanges = ranges.filter(range => range.end > start && range.start < start + raw.length)
          .map(range => ({ ...range, start: textIndex(range.start - start), end: textIndex(range.end - start) }))
        const cuts = new Set([0, value.length])
        for (const range of localRanges) {
          cuts.add(range.start)
          cuts.add(range.end)
        }
        const slots: { start: number; end: number; index: number }[] = []
        const marker = new RegExp(`${prefix}(\\d+)zZ`, 'g')
        for (const match of value.matchAll(marker)) {
          const at = match.index!
          slots.push({ start: at, end: at + match[0].length, index: Number(match[1]) })
          cuts.add(at); cuts.add(at + match[0].length)
        }
        const boundaries = [...cuts].sort((a, b) => a - b)
        return boundaries.slice(0, -1).flatMap((at, index): AstNode[] => {
          const end = boundaries[index + 1]
          const slot = slots.find(item => at >= item.start && at < item.end)
          if (slot) return at === slot.start ? [{ type: 'element', tagName: 'span', properties: { 'data-coc-receipt': slot.index }, children: [] }] : []
          const text: AstNode = { type: 'text', value: value.slice(at, end) }
          const speaker = localRanges.find(range => range.start <= at && range.end > at)?.speaker
          return speaker ? [{ type: 'element', tagName: 'span', properties: {
            className: ['coc-say'], 'data-who': speaker.who, title: speaker.title,
            style: speaker.ink ? `--coc-say-ink:${speaker.ink}` : undefined,
          }, children: [text] }] : [text]
        })
      })
    }
    visit(tree)
  }
}

const MarkdownBlock = memo(function MarkdownBlock({ source, decorations, prefix, nodes, streaming }: {
  source: string; decorations: string; prefix: string; nodes: ReactNode[]; streaming: boolean
}) {
  // Streamdown caches processors by plugin/options; annotation data must be in the options,
  // not captured in a same-source closure that would reuse a previous delivery's processor.
  const rehypePlugins = useMemo<NonNullable<StreamdownProps['rehypePlugins']>>(() => [
    ...Object.values(defaultRehypePlugins), [decorate, { ranges: JSON.parse(decorations), prefix, source }],
  ], [decorations, prefix, source])
  const components = useMemo<Components>(() => ({
    // A receipt can interrupt a sentence; a flow container avoids nesting its card div inside p.
    p: ({ children }) => <div className="coc-mech-para">{children}</div>,
    span: ({ node, children, ...props }) => {
      const receipt = node?.properties?.['data-coc-receipt']
      return receipt === undefined ? <span {...props}>{children}</span> : <>{nodes[Number(receipt)]}</>
    },
  }), [nodes])
  return <Streamdown mode={streaming ? 'streaming' : 'static'} isAnimating={streaming}
    parseMarkdownIntoBlocksFn={oneBlock} rehypePlugins={rehypePlugins} components={components}
    plugins={streaming ? undefined : plugins} controls={controls} shikiTheme={['github-light', 'github-dark']}>
    {source}
  </Streamdown>
})

export function CocMarkdown({ runs, streaming = false }: { runs: CocProseRun[]; streaming?: boolean }) {
  const parsed = useRef({ previous: '', sealed: [] as { source: string; start: number }[], tailStart: 0 })
  const compiled = useMemo(() => {
    let source = ''
    let prefix = 'zZcocReceipt'
    const text = runs.map(run => run.text ?? '').join('')
    while (text.includes(prefix)) prefix += 'X'
    const ranges: Range[] = [], nodes: ReactNode[] = []
    for (const run of runs) {
      if (run.node !== undefined) { source += `${prefix}${nodes.length}zZ`; nodes.push(run.node) }
      if (run.text) {
        const start = source.length
        source += run.text
        if (run.speaker) ranges.push({ start, end: source.length, speaker: run.speaker })
      }
    }
    return { source, ranges, prefix, nodes: nodes.length ? nodes : noNodes }
  }, [runs])
  let blocks: { source: string; start: number }[]
  if (streaming) {
    if (!compiled.source.startsWith(parsed.current.previous)) parsed.current = { previous: '', sealed: [], tailStart: 0 }
    const state = parsed.current
    let cursor = state.tailStart
    // Only the open tail is parsed again. Keep the last nonempty block open: a list or
    // code fence may continue after a blank line. Completion reparses the entire delivery.
    const tail = parseMarkdownIntoBlocks(compiled.source.slice(cursor)).filter(source => source.trim()).map(source => {
      const start = Math.max(cursor, compiled.source.indexOf(source, cursor))
      cursor = start + source.length
      return { source, start }
    })
    state.sealed.push(...tail.slice(0, -1))
    if (tail.length) state.tailStart = tail.at(-1)!.start
    state.previous = compiled.source
    blocks = [...state.sealed, ...tail.slice(-1)]
  } else {
    parsed.current = { previous: '', sealed: [], tailStart: 0 }
    blocks = compiled.source.trim() ? [{ source: compiled.source, start: 0 }] : []
  }
  return <div className="markdown coc-markdown">{blocks.map(({ source, start }, index) => {
    const end = start + source.length
    const ranges = compiled.ranges.filter(range => range.end > start && range.start < end)
      .map(range => ({ ...range, start: Math.max(0, range.start - start), end: Math.min(source.length, range.end - start) }))
    return <MarkdownBlock key={index} source={source} decorations={JSON.stringify(ranges)} prefix={compiled.prefix}
      nodes={compiled.nodes} streaming={streaming} />
  })}</div>
}

export const renderCocProse = (runs: CocProseRun[], streaming: boolean) => <CocMarkdown runs={runs} streaming={streaming} />
