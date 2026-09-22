import { describe, expect, it } from 'vitest'
import {
  centerMarkAt,
  DEFAULT_MARK_COLOR,
  DEFAULT_MARK_SHAPE,
  INK_COLORS,
  MARK_SHAPES,
  markShapeOf,
} from './target'

describe('لوحة الحبر الموحّدة — خمسة ألوان للهدف والشرح معًا (قرار المالك)', () => {
  it('اللوحة خمسة ألوان بلا تكرار، والافتراضي منها', () => {
    expect(INK_COLORS).toHaveLength(5)
    expect(new Set(INK_COLORS).size).toBe(5)
    expect(INK_COLORS).toContain(DEFAULT_MARK_COLOR)
  })

  it('الافتراضي هو برتقالي دليلي — نفس ما خبزه الامتداد في كل لقطة قديمة', () => {
    expect(DEFAULT_MARK_COLOR).toBe('#ea580c')
  })
})

describe('centerMarkAt — تحريك الهدف بحصره داخل الصورة', () => {
  const rect = { x: 100, y: 100, w: 40, h: 20 }

  it('يضع مركز المستطيل عند النقطة المطلوبة ويحفظ أبعاده', () => {
    const r = centerMarkAt(rect, 300, 200, 1000, 800)
    expect(r).toEqual({ x: 280, y: 190, w: 40, h: 20 })
  })

  it('عند الحافة يُحصر داخل الصورة ولا يخرج منها إطلاقًا', () => {
    expect(centerMarkAt(rect, 0, 0, 1000, 800)).toEqual({ x: 0, y: 0, w: 40, h: 20 })
    expect(centerMarkAt(rect, 1000, 800, 1000, 800)).toEqual({ x: 960, y: 780, w: 40, h: 20 })
  })

  it('مستطيل أكبر من الصورة يُثبَّت عند الأصل بلا إحداثية سالبة', () => {
    const big = { x: 0, y: 0, w: 1200, h: 900 }
    expect(centerMarkAt(big, 500, 400, 1000, 800)).toEqual({ x: 0, y: 0, w: 1200, h: 900 })
  })

  it('يقرّب لأعداد صحيحة — لا كسور بكسل تتراكم مع كل سحبة', () => {
    const r = centerMarkAt(rect, 300.6, 200.4, 1000, 800)
    expect(Number.isInteger(r.x)).toBe(true)
    expect(Number.isInteger(r.y)).toBe(true)
  })
})

/**
 * طلب المالك 2026-09-04: إطار الهدف يقبل شكلين — مستطيل أو دائرة/بيضاوي.
 * البيضاوي يتبع أبعاد الإطار فيصير دائرة حين تتساوى، فلا حالة ثالثة تُخزَّن.
 * الغياب = مستطيل: كل الأدلة الملتقطة قبل اليوم تبقى كما رُسمت بلا ترحيل.
 */
describe('شكل إطار الهدف — مستطيل أو بيضاوي', () => {
  it('الأشكال شكلان اثنان لا ثالث لهما، والافتراضي مستطيل', () => {
    expect([...MARK_SHAPES]).toEqual(['rect', 'ellipse'])
    expect(DEFAULT_MARK_SHAPE).toBe('rect')
  })

  it('إطار بلا شكل = مستطيل (لقطات ما قبل اليوم تُرسم كما كانت تمامًا)', () => {
    expect(markShapeOf({ rect: { x: 0, y: 0, w: 10, h: 10 }, color: '#ea580c' })).toBe('rect')
    expect(markShapeOf(undefined)).toBe('rect')
  })

  it('الشكل المصرَّح به يُحترم كما هو', () => {
    expect(markShapeOf({ rect: { x: 0, y: 0, w: 10, h: 10 }, color: '#ea580c', shape: 'ellipse' })).toBe('ellipse')
  })
})
