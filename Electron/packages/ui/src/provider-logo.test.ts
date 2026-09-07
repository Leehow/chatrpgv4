import { describe, expect, it } from 'vitest'
import { isKnownBrand, providerBrand, providerLogoInfo } from './provider-logo'

describe('provider logos', () => {
  it('maps a pi-native provider onto its official brand mark instead of a letter glyph', () => {
    expect(providerBrand('xai', 'grok-4')).toBe('xai')
    expect(isKnownBrand('xai')).toBe(true)
    const info = providerLogoInfo('xai')
    expect(info.paths?.length).toBeGreaterThan(0)
    expect(info.glyph).toBeUndefined()
  })

  it('falls back to a neutral glyph for unknown providers', () => {
    expect(providerBrand('acme')).toBe('unknown')
    expect(isKnownBrand('unknown')).toBe(false)
    expect(providerLogoInfo('acme').glyph).toBe('✦')
  })
})
