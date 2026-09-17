import { describe, it, expect } from 'vitest'
import { markBoxRect } from './mark-box'

describe('markBoxRect — موضع إطار الهدف بأرقام نسبية (٠–١٠٠) لا سلاسل CSS', () => {
  it('يحوّل بكسل الصورة إلى أرقام نسبية تنطبق على العنصر المعروض بعرض ١٠٠٪', () => {
    const r = markBoxRect({ x: 200, y: 150, w: 100, h: 50 }, 1000, 500)
    expect(r).toEqual({ left: 20, top: 30, width: 10, height: 10 })
  })

  it('هدف عند الأصل بحجم كامل الصورة يعطي إطارًا يملأ اللقطة', () => {
    const r = markBoxRect({ x: 0, y: 0, w: 800, h: 600 }, 800, 600)
    expect(r).toEqual({ left: 0, top: 0, width: 100, height: 100 })
  })

  it('أبعاد طبيعية غير صالحة أو مستطيل صفري لا تُنتج إطارًا (لا قسمة على صفر)', () => {
    expect(markBoxRect({ x: 10, y: 10, w: 10, h: 10 }, 0, 500)).toBeNull()
    expect(markBoxRect({ x: 10, y: 10, w: 10, h: 10 }, 1000, 0)).toBeNull()
    expect(markBoxRect({ x: 10, y: 10, w: 0, h: 10 }, 1000, 500)).toBeNull()
    expect(markBoxRect({ x: 10, y: 10, w: 10, h: 0 }, 1000, 500)).toBeNull()
  })
})
