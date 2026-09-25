import { describe, expect, it } from 'vitest'
import type { GuideDto } from '@dalili/shared'
import { applyTranslation, collectTranslationItems } from './payload'

const guide = {
  id: 'g1', schemaVersion: 2, title: 'افتح البرنامج', description: 'للمبتدئين',
  locale: 'ar', dir: 'rtl', createdAt: 'c', updatedAt: 'u',
  steps: [
    { id: 's1', kind: 'click', title: 'انقر حفظ', note: 'أعلى اليمين', alt: 'لقطة الحفظ',
      target: { text: 'حفظ', label: 'زر' }, value: 'p@ssw0rd', sensitive: true,
      url: 'https://x.sa', pageTitle: 'الصفحة', ts: 0,
      rich: [{ para: 'p', runs: [{ text: 'عادي' }, { text: 'الإعدادات', b: true }, { text: 'راجع', href: 'https://y.sa' }] }] },
    { id: 's2', kind: 'click', title: '', note: '  ', target: {}, sensitive: false, ts: 1 },
  ],
} as unknown as GuideDto

describe('collectTranslationItems', () => {
  it('يجمع النصوص بمسارات مستقرة ويستبعد القيم والأسرار وروابط runs', () => {
    const items = collectTranslationItems(guide)
    const ids = items.map((i) => i.id)
    expect(ids).toContain('title')
    expect(ids).toContain('description')
    expect(ids).toContain('steps/s1/title')
    expect(ids).toContain('steps/s1/note')
    expect(ids).toContain('steps/s1/alt')
    expect(ids).toContain('steps/s1/targetText')
    expect(ids).toContain('steps/s1/targetLabel')
    expect(ids).toContain('steps/s1/pageTitle')
    expect(ids).toContain('steps/s1/rich/0/0')
    expect(ids).toContain('steps/s1/rich/0/1')
    // القيم المدخلة والأسرار لا تُرسَل أبدًا — وروابط runs تبقى كما هي
    expect(JSON.stringify(items)).not.toContain('p@ssw0rd')
    expect(ids).not.toContain('steps/s1/rich/0/2')
    // الفارغ والفراغ الأبيض لا يُجمعان
    expect(ids).not.toContain('steps/s2/title')
    expect(ids).not.toContain('steps/s2/note')
  })
})

describe('applyTranslation', () => {
  it('يبني الطبقة ولا يلمس الأصل ولا updatedAt ولا مُدخله', () => {
    const before = structuredClone(guide)
    const out = applyTranslation(guide, 'groq:test', [
      { id: 'title', text: 'Open the app' },
      { id: 'steps/s1/title', text: 'Click Save' },
    ])
    expect(out.translations!.en!.title).toBe('Open the app')
    expect(out.translations!.en!.items['steps/s1/title']).toBe('Click Save')
    expect(out.translations!.en!.meta.provider).toBe('groq:test')
    expect(out.translations!.en!.meta.sourceUpdatedAt).toBe('u')
    expect(out.updatedAt).toBe('u')
    expect(out.title).toBe('افتح البرنامج')
    expect(guide).toEqual(before)
  })

  it('عنوان غائب في الرد يرتد للأصل، والفراغ يُسقط', () => {
    const out = applyTranslation(guide, 'groq:test', [{ id: 'title', text: '   ' }])
    expect(out.translations!.en!.title).toBe('افتح البرنامج')
    expect(Object.keys(out.translations!.en!.items)).toHaveLength(0)
  })

  it('ترجمة ثانية تحل محل الأولى بلا بقايا', () => {
    applyTranslation(guide, 'groq:test', [{ id: 'title', text: 'Old' }])
    const second = applyTranslation(guide, 'groq:test', [{ id: 'steps/s1/title', text: 'Click Save' }])
    expect(second.translations!.en!.items).not.toHaveProperty('title')
    expect(second.translations!.en!.title).toBe('افتح البرنامج')
  })
})
