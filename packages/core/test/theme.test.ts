import { describe, it, expect } from 'vitest'
import { LIGHT, DARK, tokensCss } from '../src/theme'

describe('theme tokens', () => {
  it('نظام لونين: العناصر التفاعلية جرافيت واحد بلا لون علامة', () => {
    // brand/accent/finish كلها نفس الجرافيت (لا أخضر ولا برتقالي) — لونان فقط
    expect(LIGHT.brand).toBe('#2B2A26')
    expect(LIGHT.brand).toBe(LIGHT.ink)
    expect(LIGHT.accent).toBe(LIGHT.ink)
    expect(LIGHT.finish).toBe(LIGHT.ink)
    expect(DARK.brand).toBe(DARK.ink)
  })

  it('dark theme keeps a distinct ground and ink', () => {
    expect(DARK.ground).not.toBe(LIGHT.ground)
    expect(DARK.ink).not.toBe(LIGHT.ink)
  })

  it('tokensCss defines --dl- variables on the selector and a dark override', () => {
    const css = tokensCss(':host')
    expect(css).toContain(':host{')
    expect(css).toContain('--dl-brand:#2B2A26')
    expect(css).toContain('--dl-accent:#2B2A26')
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain(`--dl-ground:${DARK.ground}`)
  })
})
