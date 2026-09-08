import { describe, it, expect } from 'vitest'
import { LIGHT, DARK, BRAND, BRAND_DARK, tokensCss } from '../src/theme'

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

  // مزامنة الثيم (2026-09-06): مجموعة «الهوية الجديدة» بجانب الجرافيت — الاختيار يمرر tokensCss
  describe('BRAND — هوية حبر ليلي', () => {
    it('الألوان المعتمدة من docs/brand-identity.md بالحرف', () => {
      expect(BRAND.brand).toBe('#16324F')
      expect(BRAND.ground).toBe('#F7F4EE')
      expect(BRAND.ink).toBe('#1C2B33')
      expect(BRAND.muted).toBe('#5A6B75')
      expect(BRAND.line).toBe('#E3DDD2')
      expect(BRAND_DARK.ground).toBe('#0F1E2E')
    })

    it('تباين النص محفوظ: الأبيض على brand ≥ 12:1 وmuted على ground ≥ 4.5:1', () => {
      const lum = (hex: string) => {
        const n = parseInt(hex.slice(1), 16)
        const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
      }
      const ratio = (a: string, b: string) => {
        const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
        return (l1! + 0.05) / (l2! + 0.05)
      }
      expect(ratio('#FFFFFF', BRAND.brand)).toBeGreaterThanOrEqual(12)
      expect(ratio(BRAND.ink, BRAND.ground)).toBeGreaterThanOrEqual(10)
      expect(ratio(BRAND.muted, BRAND.ground)).toBeGreaterThanOrEqual(4.5)
    })

    it('tokensCss بالاختيار brand يبث ألوان الهوية وداركها — والافتراضي جرافيت كما كان', () => {
      const brandCss = tokensCss(':root', 'brand')
      expect(brandCss).toContain('--dl-brand:#16324F')
      expect(brandCss).toContain(`--dl-ground:${BRAND_DARK.ground}`)
      expect(brandCss).toContain('@media (prefers-color-scheme: dark)')
      // الافتراضي بلا اختيار = الجرافيت القديم — سلوك قديم لم يتغير
      expect(tokensCss(':root')).toContain('--dl-brand:#2B2A26')
      expect(tokensCss(':root', 'classic')).toBe(tokensCss(':root'))
    })
  })
})
