import { describe, expect, it } from 'vitest'
import { scaleRelativeRect, suggestSimilarBlur } from '../src/blur-suggest'
import type { Step } from '../src/guide'

/** EDT-12: الطمس الذكي الدفعي — بعد طمس مستطيل تُقترح الخطوات ذات الموقع النسبي
 * نفسه على مضيف الرابط ذاته. المستطيل نسبّي (0..1) فيُعاد مقياسه تلقائيًا لأي لقطة. */

function step(id: string, url: string): Step {
  return {
    id,
    kind: 'click',
    title: id,
    target: {},
    sensitive: false,
    url,
    pageTitle: 'ص',
    ts: 1,
  }
}

const REL = { x: 0.5, y: 0.4, w: 0.2, h: 0.1 }

describe('suggestSimilarBlur — الاقتراح بالموقع النسبي (EDT-12)', () => {
  const steps = [
    step('a', 'https://erp.example.com/one'),
    step('b', 'https://erp.example.com/two'),
    step('c', 'https://other.org/x'),
    step('d', 'https://erp.example.com/three'),
  ]

  it('نفس المضيف يقترح ومضيف مختلف لا، والذات تُتخطى بالترتيب نفسه', () => {
    // مركز REL = (0.6, 0.45)؛ المرشح 1 عليه تمامًا، و2 مضيفه مختلف، و3 بعيد
    const centers = { 1: { x: 0.6, y: 0.45 }, 2: { x: 0.6, y: 0.45 }, 3: { x: 0.9, y: 0.9 } }
    const out = suggestSimilarBlur(steps, 0, REL, centers)
    expect(out.map((s) => s.index)).toEqual([1])
    expect(out[0]!.rect).toEqual(REL)
  })

  it('الهامش الحدّي: مركز ضمن tol يُقبل وخارجه يُرفض', () => {
    const steps2 = [
      step('a', 'https://erp.example.com/one'),
      step('b', 'https://erp.example.com/two'),
      step('c', 'https://erp.example.com/three'),
    ]
    // مركز المرشح على الحدّ بالضبط (0.6+0.12) — يُقبل (≤)، وما بعده يُرفض
    const centers = { 1: { x: 0.72, y: 0.45 }, 2: { x: 0.73, y: 0.45 } }
    expect(suggestSimilarBlur(steps2, 0, REL, centers).map((s) => s.index)).toEqual([1])
    // بلا مرشحين مطابقين — لا اقتراح إطلاقًا
    expect(suggestSimilarBlur(steps2, 0, REL, {})).toEqual([])
  })

  it('خطوة بلا رابط لا تُقترح أصلًا', () => {
    const mixed = [step('a', 'https://erp.example.com/one'), { ...step('b', ''), pageTitle: 'ب' }]
    expect(suggestSimilarBlur(mixed, 0, REL, { 1: { x: 0.5, y: 0.4 } })).toEqual([])
  })
})

describe('scaleRelativeRect — إعادة المقياس لحجم اللقطة الهدف', () => {
  it('يضرب النسب في أبعاد اللقطة الهدف', () => {
    expect(scaleRelativeRect(REL, { w: 2000, h: 1000 })).toEqual({ x: 1000, y: 400, w: 400, h: 100 })
  })
})
