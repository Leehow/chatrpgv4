import { describe, expect, it } from 'vitest'
import { isSessionSource, sessionSourceLabel } from './session-source'

describe('session source helpers', () => {
  it('labels the Pi source and falls back to it for unknown values', () => {
    expect(sessionSourceLabel('pi')).toBe('Pi')
    expect(sessionSourceLabel(undefined)).toBe('Pi')
    expect(sessionSourceLabel('unknown')).toBe('Pi')
    expect(isSessionSource('pi')).toBe(true)
    expect(isSessionSource('external')).toBe(false)
  })
})
