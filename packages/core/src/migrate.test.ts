import { describe, expect, it } from 'vitest'
import { migrateGuide } from './migrate'

/** DTOP-01: ترحيل كسول ١→٢ — يقبل v1 مسطّحًا أو v2 وينتج v2 دائمًا، idempotent، ويرفض الغريب الشكل */
describe('migrateGuide (١→٢)', () => {
  const v1Guide = {
    id: 'g1',
    schemaVersion: 1,
    title: 'دليل',
    locale: 'ar',
    dir: 'rtl',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    steps: [
      {
        id: 's1',
        kind: 'click',
        title: 'انقر',
        target: {},
        sensitive: false,
        url: 'https://erp.example/x',
        pageTitle: 'النظام',
        ts: 1,
      },
      { id: 's2', kind: 'navigate', title: 'بلا رابط', target: {}, sensitive: false, url: '', pageTitle: '', ts: 2 },
    ],
  }

  it('v1 مسطّح → v2: خطوة ذات رابط تأخذ source ويب، وبلا رابط تبقى بلا source', () => {
    const out = migrateGuide(structuredClone(v1Guide))!
    expect(out.schemaVersion).toBe(2)
    const s1 = (out.steps as Array<Record<string, unknown>>)[0]!
    const s2 = (out.steps as Array<Record<string, unknown>>)[1]!
    expect(s1.source).toEqual({ kind: 'web', url: 'https://erp.example/x', pageTitle: 'النظام' })
    expect(s2.source).toBeUndefined()
    // حقول v1 تبقى كما هي — القرّاء القدماء يرون الدليل نفسه
    expect(s1.url).toBe('https://erp.example/x')
  })

  it('idempotent: تطبيقها على ناتجها لا يغيّر شيئًا', () => {
    const once = migrateGuide(structuredClone(v1Guide))!
    const twice = migrateGuide(structuredClone(once))!
    expect(twice).toEqual(once)
  })

  it('v2 أصلاً تمرّ بلا مسّ — source الديسكتوب يبقى كما هو', () => {
    const v2 = {
      ...v1Guide,
      schemaVersion: 2,
      steps: [
        {
          id: 's1',
          kind: 'click',
          title: 'نقر إكسل',
          target: {},
          sensitive: false,
          ts: 1,
          source: { kind: 'desktop', processName: 'EXCEL.EXE', windowTitle: 'دفتر', appId: 'app:EXCEL.EXE' },
        },
      ],
    }
    const out = migrateGuide(structuredClone(v2))!
    expect(out).toEqual(v2)
  })

  it('يرفض الغريب الشكل: غير كائن أو بلا خطوات أو خطوات ليست مصفوفة', () => {
    expect(migrateGuide(null)).toBeNull()
    expect(migrateGuide('نص')).toBeNull()
    expect(migrateGuide(42)).toBeNull()
    expect(migrateGuide({ id: 'x' })).toBeNull()
    expect(migrateGuide({ ...v1Guide, steps: 'ليست مصفوفة' })).toBeNull()
  })
})
