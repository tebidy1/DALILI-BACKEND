import { describe, expect, it } from 'vitest'
import { stepNumbers } from '../src/guide'

describe('stepNumbers — ترقيم يُصفّي الكتل', () => {
  it('الخطوات (بلا block) تُرقَّم متتاليًا والكتل تُعطى null', () => {
    const steps = [
      {}, // خطوة 1
      { block: 'tip' as const }, // كتلة
      {}, // خطوة 2
      { block: 'header' as const },
      {}, // خطوة 3
    ]
    expect(stepNumbers(steps)).toEqual([1, null, 2, null, 3])
  })

  it('دليل بلا كتل يُرقَّم كالفهرس+1', () => {
    expect(stepNumbers([{}, {}, {}])).toEqual([1, 2, 3])
  })

  // BKL-01: الترقيم يُصفّي بوجود block لا بتعداد قيمه — فكتل الكرّاسة الجديدة
  // تخرج من الترقيم مجانًا. هذا الاختبار هو حارس تلك الخاصية.
  it('كتل الكرّاسة الجديدة كلها بلا رقم، والخطوات وحدها تتسلسل', () => {
    const steps = [
      { block: 'header' as const },
      {}, // خطوة 1
      { block: 'text' as const },
      { block: 'embed' as const },
      { block: 'divider' as const },
      { block: 'link' as const },
      { block: 'image' as const },
      {}, // خطوة 2
    ]
    expect(stepNumbers(steps)).toEqual([null, 1, null, null, null, null, null, 2])
  })
})
