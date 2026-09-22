import { describe, it, expect } from 'vitest'
import { zoomFrame, ZOOM_MIN, ZOOM_MAX, CAPTURE_ZOOM } from './zoom-frame'

describe('zoomFrame — تكبير تكيّفي يوسّط العنصر المحدَّد داخل نافذة البطاقة', () => {
  it('عنصر صغير في وسط اللقطة يبلغ سقف التكبير ويُوسَّط مركزه في النافذة', () => {
    // صورة ١٠٠٠×٥٠٠، نافذة ٤٠٠×٣٠٠، عنصر صغير مركزه وسط الصورة
    const f = zoomFrame({ x: 490, y: 245, w: 20, h: 10 }, 1000, 500, 400, 300)!
    expect(f.scale).toBe(ZOOM_MAX) // العنصر الصغير يُكبَّر حتى السقف
    // مركز العنصر (بالطبقة: 200,100) يقع بعد التحويل في مركز النافذة (200,150)
    expect(f.scale * 200 + f.translateX).toBeCloseTo(200) // viewW/2
    expect(f.scale * 100 + f.translateY).toBeCloseTo(150) // viewH/2
    expect(f.translateX).toBeCloseTo(-600)
    expect(f.translateY).toBeCloseTo(-250)
  })

  it('عنصر كبير عند ركن اللقطة: تكبير دون السقف وقصّ الإزاحة يمنع الحواف الفارغة', () => {
    // عنصر كبير عند الركن الأعلى-الأيسر — التوسيط سيكشف فراغًا، فتُقصّ الإزاحة للصفر
    const f = zoomFrame({ x: 0, y: 0, w: 200, h: 100 }, 1000, 500, 400, 300)!
    expect(f.scale).toBeGreaterThanOrEqual(ZOOM_MIN)
    expect(f.scale).toBeLessThan(ZOOM_MAX)
    expect(f.scale).toBeCloseTo(2.75)
    expect(f.translateX).toBe(0) // الحافة اليسرى مثبّتة — لا فراغ
    expect(f.translateY).toBe(0) // الحافة العليا مثبّتة — لا فراغ
  })

  it('عنصر كبير لا يُكبَّر تحت الحدّ الأدنى', () => {
    // عنصر يملأ نصف الصورة — يظل عند ٢٠٠٪ لا أقل
    const f = zoomFrame({ x: 250, y: 125, w: 500, h: 250 }, 1000, 500, 400, 300)!
    expect(f.scale).toBe(ZOOM_MIN)
  })

  it('لقطة عريضة قصيرة: الارتفاع لا يغطّي النافذة فيُوسَّط رأسيًا بلا فراغ منحاز', () => {
    // صورة ٢٠٠٠×٢٠٠ في نافذة طويلة ٤٠٠×٤٠٠ — الطبقة أقصر من النافذة حتى بعد التكبير
    const f = zoomFrame({ x: 950, y: 90, w: 100, h: 20 }, 2000, 200, 400, 400)!
    expect(f.scale).toBe(ZOOM_MAX)
    // layerH = 400*200/2000 = 40 ؛ coverH = 4*40 = 160 < 400 → توسيط: (400-160)/2 = 120
    expect(f.translateY).toBeCloseTo(120)
  })

  it('مدخلات غير صالحة (صورة/نافذة صفرية أو مستطيل صفري) لا تُنتج إطارًا', () => {
    expect(zoomFrame({ x: 10, y: 10, w: 10, h: 10 }, 0, 500, 400, 300)).toBeNull()
    expect(zoomFrame({ x: 10, y: 10, w: 10, h: 10 }, 1000, 500, 0, 300)).toBeNull()
    expect(zoomFrame({ x: 10, y: 10, w: 0, h: 10 }, 1000, 500, 400, 300)).toBeNull()
  })
})

describe('zoomFrame — حدود مخصّصة (PNL-01)', () => {
  it('الافتراضي هو حدود الالتقاط حرفيًا', () => {
    const mark = { x: 480, y: 280, w: 40, h: 40 }
    expect(zoomFrame(mark, 1000, 600, 300, 225)).toEqual(zoomFrame(mark, 1000, 600, 300, 225, CAPTURE_ZOOM))
  })
  it('يحترم سقفًا أدنى — عنصر صغير جدًا لا يتجاوز max القارئ', () => {
    const f = zoomFrame({ x: 495, y: 295, w: 10, h: 10 }, 1000, 600, 300, 187.5, { min: 1.5, max: 2.5, fill: 0.4 })
    expect(f?.scale).toBe(2.5)
  })
  it('يحترم الحد الأدنى — عنصر ضخم لا ينزل تحت min القارئ', () => {
    const f = zoomFrame({ x: 0, y: 0, w: 1000, h: 600 }, 1000, 600, 300, 187.5, { min: 1.5, max: 2.5, fill: 0.4 })
    expect(f?.scale).toBe(1.5)
  })
})
