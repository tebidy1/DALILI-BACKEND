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
})
