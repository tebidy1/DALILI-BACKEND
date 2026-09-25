import { describe, expect, it } from 'vitest'
import type { GuideDto } from './contract'
import { translationOverlay, translationStale } from './translation'

const guide = {
  id: 'g1', schemaVersion: 2, title: 'دليل', locale: 'ar', dir: 'rtl',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-05T00:00:00Z',
  steps: [{ id: 's1', kind: 'click', title: 'افتح', note: 'من القائمة', target: {}, sensitive: false, ts: 0 }],
  translations: { en: {
    title: 'Guide',
    items: { title: 'Guide', 'steps/s1/title': 'Open', 'steps/s1/rich/0/1': 'Settings' },
    meta: { provider: 'groq:x', createdAt: '2026-01-03T00:00:00Z', sourceUpdatedAt: '2026-01-01T00:00:00Z' },
  } },
} as unknown as GuideDto

describe('translationOverlay', () => {
  it('null للعربية أو بلا ترجمة', () => {
    expect(translationOverlay(guide, 'ar')).toBeNull()
    const { translations, ...bare } = guide
    expect(translationOverlay(bare as GuideDto, 'en')).toBeNull()
  })

  it('الحقول المترجمة تُقرأ والغائب يرتد للعربية', () => {
    const ov = translationOverlay(guide, 'en')!
    expect(ov.guideTitle).toBe('Guide')
    expect(ov.description).toBeUndefined()
    expect(ov.stepText('s1', 'title', 'افتح')).toBe('Open')
    expect(ov.stepText('s1', 'note', 'من القائمة')).toBe('من القائمة')
    expect(ov.richRun('s1', 0, 1, 'الإعدادات')).toBe('Settings')
    expect(ov.richRun('s1', 0, 0, 'نص عربي')).toBe('نص عربي')
  })

  it('مسار فراغ نصيّ يُعدّ غائبًا فيرتد', () => {
    const txGuide = {
      ...guide,
      translations: { en: { ...guide.translations!.en, items: { title: '  ' } } },
    } as unknown as GuideDto
    const ov = translationOverlay(txGuide, 'en')!
    expect(ov.guideTitle).toBe('دليل')
  })
})

describe('translationStale', () => {
  it('updatedAt بعد التوليد ⇒ قديمة · قبله أو بلا ترجمة ⇒ لا', () => {
    expect(translationStale(guide)).toBe(true)
    expect(translationStale({ ...guide, updatedAt: '2026-01-02T00:00:00Z' } as GuideDto)).toBe(false)
    const { translations, ...bare } = guide
    expect(translationStale(bare as GuideDto)).toBe(false)
  })
})
