import { describe, it, expect } from 'vitest'
import { markBoxRect, pointMark } from './mark-box'

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

describe('pointMark — حلقة نقطة الضغط الفارغة (قرار المالك ٣و: دائرة مركزها الضغط)', () => {
  it('مركز سليم ⇒ مربّع متساوي الضلعين (ضلع ٢×نصف القطر) حول النقطة بشكل ellipse', () => {
    expect(pointMark(500, 300, 24, 1920, 1080, '#ea580c')).toEqual({
      rect: { x: 476, y: 276, w: 48, h: 48 },
      color: '#ea580c',
      shape: 'ellipse',
    })
  })

  it('نقطة قرب الحافّة (المربّع جزئيّ الخروج) ⇒ علامة صالحة لا مرفوضة — تُقصّ بصريًّا', () => {
    expect(pointMark(10, 10, 24, 1920, 1080, '#ea580c')?.rect).toEqual({
      x: -14,
      y: -14,
      w: 48,
      h: 48,
    })
  })

  it('خارج الصورة كليًّا ⇒ بلا علامة (نقرة شاشةٍ أخرى لا يعلّمها إطارُ الشاشة الملتقطة)', () => {
    expect(pointMark(5000, 300, 24, 1920, 1080, '#ea580c')).toBeUndefined()
    expect(pointMark(-100, -100, 24, 1920, 1080, '#ea580c')).toBeUndefined()
  })

  it('نصف قطر صفر أو سالب أو إحداثيّات غير منتهية ⇒ بلا علامة', () => {
    expect(pointMark(500, 300, 0, 1920, 1080, '#ea580c')).toBeUndefined()
    expect(pointMark(500, 300, -4, 1920, 1080, '#ea580c')).toBeUndefined()
    expect(pointMark(Number.NaN, 300, 24, 1920, 1080, '#ea580c')).toBeUndefined()
    expect(pointMark(500, Number.NaN, 24, 1920, 1080, '#ea580c')).toBeUndefined()
  })
})
