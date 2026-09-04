import { describe, expect, it } from 'vitest'
import { mergeSteps, replaceStepUrls } from '../src/steps-ops'
import type { Step } from '../src/guide'

/** EDT-06: دمج خطوتين متجاورتين — عنوان الأول وملاحظتاهما متسلسلتان وصورة الأول،
 * وEDT-07: استبدال الروابط بمطابقة مضيف/مسار محلّلة لا استبدال نصي أعمى */

function step(id: string, over: Partial<Step> = {}): Step {
  return {
    id,
    kind: 'click',
    title: `خطوة ${id}`,
    target: {},
    sensitive: false,
    url: 'https://erp.example.com/a',
    pageTitle: 'أ',
    ts: 1,
    ...over,
  }
}

describe('mergeSteps — دمج الخطوات (EDT-06)', () => {
  const steps = [
    step('a', { title: 'الأولى', note: 'ملاحظة أولى', url: 'https://x1.example.com/p', pageTitle: 'ص1' }),
    step('b', { title: 'الثانية', note: 'ملاحظة ثانية' }),
    step('c', { title: 'الثالثة' }),
  ]

  it('يدمج الأولى والتالية في خطوة واحدة: معرف الأول وعنوانه وصورته تبقى', () => {
    const shot = { fileId: 'f1', blurRects: [] }
    const withShots = [
      { ...steps[0]!, screenshot: shot },
      steps[1]!,
      steps[2]!,
    ]
    const out = mergeSteps(withShots, 'a')
    expect(out).toHaveLength(2)
    expect(out[0]!.id).toBe('a')
    expect(out[0]!.title).toBe('الأولى')
    expect(out[0]!.screenshot).toEqual(shot) // صورة الأولى تبقى
    expect(out[1]!.id).toBe('c')
  })

  it('ملاحظتا الخطوتين تتسلسلان بسطر فاصل، وصوت الثانية يُتبنى إن كانت الأولى بلا صوت', () => {
    const withVoice = [
      steps[0]!,
      { ...steps[1]!, voice: { fileId: 'v2', durationMs: 3_000 } },
      steps[2]!,
    ]
    const out = mergeSteps(withVoice, 'a')
    expect(out[0]!.note).toBe('ملاحظة أولى\nملاحظة ثانية')
    expect(out[0]!.voice).toEqual({ fileId: 'v2', durationMs: 3_000 })
  })

  it('غير المتجاورين يُرفض برسالة عربية ولا يغيّر شيئًا', () => {
    // آخر خطوة لا تالية لها — الرفض صادق
    expect(() => mergeSteps(steps, 'c')).toThrow(/متجاورتين/)
    // معرف غائب — رفض أيضًا
    expect(() => mergeSteps(steps, 'zz')).toThrow()
    // والدمج الصحيح لم يُمسّ الأصل
    expect(steps).toHaveLength(3)
  })
})

describe('replaceStepUrls — استبدال الروابط (EDT-07)', () => {
  const steps = [
    step('a', { url: 'https://erp.old.com/invoices/list' }),
    step('b', { url: 'https://erp.old.com/invoices/22/edit' }),
    step('c', { url: 'https://other.com/invoices' }),
  ]

  it('يستبدل مضيف ومسار الفئة في الخطوات المطابقة ويحصي العدد', () => {
    const r = replaceStepUrls(steps, 'https://erp.old.com/invoices', 'https://erp.new.com/fawatir')
    expect(r.changed).toBe(2)
    expect(r.steps[0]!.url).toBe('https://erp.new.com/fawatir/list')
    expect(r.steps[1]!.url).toBe('https://erp.new.com/fawatir/22/edit')
    expect(r.steps[2]!.url).toBe('https://other.com/invoices') // لا مسّ لغير المطابق
  })

  it('مضيف مشابه ليس مطابقًا (erp-old.com لا تطابق erp.old.com)', () => {
    const tricky = [step('a', { url: 'https://erp-old.com/invoices' }), ...steps]
    const r = replaceStepUrls(tricky, 'https://erp.old.com/invoices', 'https://erp.new.com/fawatir')
    // الاثنتان على erp.old.com تطابقتا؛ والمشابهة حرفيًا erp-old.com لم تُمسّ
    expect(r.changed).toBe(2)
    expect(r.steps[0]!.url).toBe('https://erp-old.com/invoices')
  })

  it('لا تطابق = صفر بصدق والمصفوفة تبقى بمحتواها', () => {
    const r = replaceStepUrls(steps, 'https://nope.com/x', 'https://new.com/y')
    expect(r.changed).toBe(0)
    expect(r.steps.map((s) => s.url)).toEqual(steps.map((s) => s.url))
  })
})
