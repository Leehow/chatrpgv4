/**
 * The delivery card's trailing mechanics rows start in shut folds, one per kind of row (the owner at
 * the live table, 2026-09-22). A test about what those rows say reads them the way the player does:
 * it opens every fold by its own toggle first. Found by structure, never by caption: a fold's toggle
 * is a button that controls another element and is not yet expanded. What the folds themselves do is
 * pinned in `coc-mechanics-fold.test.tsx` and `tests/extension/mechanics-fold.test.mjs`, not here.
 */
import React from 'react'

export function OpenedSlip({children}: {children: React.ReactNode}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLButtonElement>('button[aria-controls][aria-expanded="false"]').forEach(toggle => toggle.click())
  }, [])
  return <div ref={ref}>{children}</div>
}
