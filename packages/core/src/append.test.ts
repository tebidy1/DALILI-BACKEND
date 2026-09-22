import { describe, expect, it } from 'vitest'
import { assembleGuide, type RawStep } from './assemble'
import { canAppendSteps, GUIDE_MAX_STEPS } from './guide'
import { guideToHtml } from './share'

/** CAP-17: سقف الدليل 1000 خطوة — الجلسة 200 والدليل الكامل 1000 */
describe('canAppendSteps', () => {
  it('يسمح بالإضافة ما دام المجموع ضمن السقف', () => {
    expect(canAppendSteps(3, 5)).toEqual({ ok: true })
    expect(canAppendSteps(995, 5)).toEqual({ ok: true })
  })

  it('يرفض الإضافة التي تتجاوز 1000 خطوة برسالة عربية', () => {
    const r = canAppendSteps(998, 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('1000')
  })

  it('السقف 1000 (تكافؤ تانجو) والصفر الوارد مقبول', () => {
    expect(GUIDE_MAX_STEPS).toBe(1000)
    expect(canAppendSteps(1000, 1).ok).toBe(false)
    expect(canAppendSteps(10, 0).ok).toBe(true)
  })
})

/** EDT-13: النص البديل يعبر التجميع كاملًا */
describe('assembleGuide alt', () => {
  it('يحفظ alt من الخطوة الخام إلى الخطوة المجمَّعة', () => {
    const raw: RawStep[] = [
      {
        kind: 'click',
        target: { text: 'الدفع' },
        url: 'https://x.test/checkout',
        pageTitle: 'الدفع',
        ts: 1,
        alt: 'زر إتمام الدفع في أعلى الصفحة',
      },
    ]
    const g = assembleGuide(raw)
    expect(g.steps[0]!.alt).toBe('زر إتمام الدفع في أعلى الصفحة')
  })
})

/** EDT-13: التصدير الغني يستخدم alt للصورة إن وُجد */
describe('guideToHtml alt', () => {
  const base = {
    id: 'g1',
    schemaVersion: 1 as const,
    title: 'دليل',
    locale: 'ar' as const,
    dir: 'rtl' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  it('img alt تساوي النص البديل عند وجوده', () => {
    const html = guideToHtml(
      {
        ...base,
        steps: [
          {
            id: 's1',
            kind: 'click',
            title: 'خطوة',
            target: {},
            sensitive: false,
            url: 'https://x.test',
            pageTitle: 'ص',
            ts: 1,
            alt: 'لقطة شاشة لنموذج الطلب',
            screenshot: { fileId: 'f1', blurRects: [] },
          },
        ],
      },
      (fid) => `http://x/${fid}`,
    )
    expect(html).toContain('alt="لقطة شاشة لنموذج الطلب"')
  })

  it('بدون نص بديل يبقى عنوان الخطوة هو alt', () => {
    const html = guideToHtml(
      {
        ...base,
        steps: [
          {
            id: 's1',
            kind: 'click',
            title: 'اضغط التالي',
            target: {},
            sensitive: false,
            url: 'https://x.test',
            pageTitle: 'ص',
            ts: 1,
            screenshot: { fileId: 'f1', blurRects: [] },
          },
        ],
      },
      (fid) => `http://x/${fid}`,
    )
    expect(html).toContain('alt="اضغط التالي"')
  })
})
