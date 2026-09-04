import { describe, expect, it } from 'vitest'
import { assembleGuide } from '@dalili/core'
import { zAnnotation, zGuide, zRegister, zStep } from '../src/contract'

/** اتساق عابر للحزم: ما يجمّعه core يجب أن يقبله عقد API */
describe('عقد zod يقبل ناتج assembleGuide', () => {
  it('دليل كامل بصور وفجوات يمر', () => {
    const guide = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://x', pageTitle: 'الرئيسة', ts: 1 },
      { kind: 'click', target: { text: 'حفظ' }, url: 'https://x', pageTitle: 'الرئيسة', ts: 2, screenshot: { fileId: 'f1', blurRects: [{ x: 1, y: 2, w: 3, h: 4 }] } },
      { kind: 'click', target: {}, url: 'https://x', pageTitle: 'الرئيسة', ts: 3, screenshot: { missing: true, reason: 'فشل الالتقاط' } },
    ])
    const parsed = zGuide.safeParse(guide)
    expect(parsed.success).toBe(true)
  })

  it('تسجيل يرفض كلمة مرور قصيرة وبريدًا فاسدًا', () => {
    expect(zRegister.safeParse({ email: 'a@b.co', password: '1234567' }).success).toBe(false)
    expect(zRegister.safeParse({ email: 'ليس-بريد', password: '12345678' }).success).toBe(false)
    expect(zRegister.safeParse({ email: 'a@b.co', password: '12345678' }).success).toBe(true)
  })
})

describe('BLK-01: حقل block الاختياري', () => {
  const base = { id: 's1', kind: 'navigate', title: 'ت', target: {}, sensitive: false, url: '', pageTitle: '', ts: 1 }
  it('يقبل block من المجموعة', () => {
    expect(zStep.safeParse({ ...base, block: 'tip' }).success).toBe(true)
  })
  it('يرفض block خارج المجموعة', () => {
    expect(zStep.safeParse({ ...base, block: 'gif' }).success).toBe(false)
  })
  it('الخطوة القديمة (بلا block) تبقى صالحة', () => {
    expect(zStep.safeParse(base).success).toBe(true)
  })
})

describe('EDT-05 إكمال: تعليقا النص والرسم الحر', () => {
  const base = { id: 'a1', color: '#2b2a26' }
  it('يقبل type=text بنص وtype=draw بمسار نقطتين فأكثر', () => {
    expect(zAnnotation.safeParse({ ...base, type: 'text', text: 'انقر هنا أولًا', rect: { x: 1, y: 2, w: 3, h: 3 } }).success).toBe(true)
    expect(zAnnotation.safeParse({ ...base, type: 'draw', path: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 5, y: 6 }] }).success).toBe(true)
  })
  it('يرفض text بلا نص وdraw بمسار ناقص', () => {
    expect(zAnnotation.safeParse({ ...base, type: 'text' }).success).toBe(false)
    expect(zAnnotation.safeParse({ ...base, type: 'text', text: '' }).success).toBe(false)
    expect(zAnnotation.safeParse({ ...base, type: 'text', text: 'x'.repeat(81) }).success).toBe(false)
    expect(zAnnotation.safeParse({ ...base, type: 'draw' }).success).toBe(false)
    expect(zAnnotation.safeParse({ ...base, type: 'draw', path: [{ x: 1, y: 1 }] }).success).toBe(false)
  })
  it('الأشكال القديمة تبقى صالحة كما هي', () => {
    expect(zAnnotation.safeParse({ ...base, type: 'rect', rect: { x: 1, y: 2, w: 3, h: 4 } }).success).toBe(true)
  })
})

describe('VOX-09: حقل step.voice الاختياري (ميك الخطوة)', () => {
  const base = { id: 's1', kind: 'navigate', title: 'ت', target: {}, sensitive: false, url: '', pageTitle: '', ts: 1 }
  it('الخطوة القديمة (بلا voice) تبقى صالحة — جمعي بلا ترحيل', () => {
    expect(zStep.safeParse(base).success).toBe(true)
  })
  it('يقبل تعليقًا صوتيًا كاملًا ومعلقًا (pending بلا ملف بعد)', () => {
    expect(zStep.safeParse({ ...base, voice: { fileId: 'f1', durationMs: 12_000 } }).success).toBe(true)
    expect(zStep.safeParse({ ...base, voice: { fileId: 'f1', fileUrl: '/files/f1', durationMs: 12_000 } }).success).toBe(true)
    expect(zStep.safeParse({ ...base, voice: { durationMs: 5000, pending: true } }).success).toBe(true)
  })
  it('يرفض مدة صفر وسالفة وفوق السقف 60 ثانية', () => {
    expect(zStep.safeParse({ ...base, voice: { fileId: 'f1', durationMs: 0 } }).success).toBe(false)
    expect(zStep.safeParse({ ...base, voice: { fileId: 'f1', durationMs: -3 } }).success).toBe(false)
    expect(zStep.safeParse({ ...base, voice: { fileId: 'f1', durationMs: 60_001 } }).success).toBe(false)
  })
})
