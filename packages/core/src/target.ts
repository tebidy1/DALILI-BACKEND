/**
 * ANNO-02: تعليم هدف الخطوة كبيانات لا كبكسل مخبوز.
 * كان الامتداد يحرق الإطار داخل JPEG (lib/mark.ts) فيستحيل تحريكه أو تلوينه؛
 * هنا يصير مستطيلًا ولونًا يُحفظان مع اللقطة ويرسمهما العارض حيًّا.
 * نقي: بلا DOM وبلا chrome.* — يستعمله الامتداد والويب معًا.
 */
import type { Rect } from './guide'

/**
 * لوحة الحبر الموحّدة (قرار المالك: «وحّدها على ٥ كلها») — تخدم إطار الهدف
 * وشروحات الرسم معًا فلا لوحتان متباينتان في شاشة واحدة.
 * الأول برتقالي دليلي: نفس اللون الذي كان الامتداد يحرقه في كل لقطة، فيبقى
 * الإطار الحيّ متّصلًا بصريًا بما يراه المستخدم في أدلته القديمة.
 */
export const INK_COLORS = ['#ea580c', '#e11d48', '#2563eb', '#16a34a', '#2b2a26'] as const

export type MarkColor = (typeof INK_COLORS)[number]

export const DEFAULT_MARK_COLOR: MarkColor = INK_COLORS[0]

export function isMarkColor(v: string): v is MarkColor {
  return (INK_COLORS as readonly string[]).includes(v)
}

/**
 * شكل إطار الهدف (طلب المالك 2026-09-04: «قابل لتغيير الشكل إلى دائرة أو بيضاوي»).
 * شكلان لا ثالث: البيضاوي يتبع أبعاد الإطار نفسه فيصير **دائرة** حين تتساوى —
 * فلا حالة ثالثة تُخزَّن ولا زر زائد. الغياب في البيانات = مستطيل، فكل لقطة
 * التُقطت قبل اليوم تُرسم كما كانت بلا ترحيل ولا رفع لنسخة العقد.
 */
export const MARK_SHAPES = ['rect', 'ellipse'] as const

export type MarkShape = (typeof MARK_SHAPES)[number]

export const DEFAULT_MARK_SHAPE: MarkShape = MARK_SHAPES[0]

export function isMarkShape(v: string): v is MarkShape {
  return (MARK_SHAPES as readonly string[]).includes(v)
}

/** إطار الهدف: مستطيله بإحداثيات الصورة الطبيعية ولونه من لوحة الحبر */
export interface TargetMark {
  rect: Rect
  color: MarkColor
  /** غيابه = مستطيل — مصدر الحقيقة الوحيد لقراءته هو `markShapeOf` */
  shape?: MarkShape
}

/** شكل إطارٍ ما بقراءة واحدة تحسم الغياب — لا `?? 'rect'` متناثرة في الواجهة */
export function markShapeOf(mark: Partial<TargetMark> | undefined): MarkShape {
  return mark?.shape ?? DEFAULT_MARK_SHAPE
}

/**
 * يضع مركز مستطيل الهدف عند (cx, cy) محافظًا على أبعاده، ويحصره داخل الصورة
 * فلا يخرج منها مهما اقترب المستخدم من الحافة. مستطيل أوسع من الصورة يُثبَّت عند الأصل.
 */
export function centerMarkAt(rect: Rect, cx: number, cy: number, imgW: number, imgH: number): Rect {
  const maxX = Math.max(0, imgW - rect.w)
  const maxY = Math.max(0, imgH - rect.h)
  return {
    x: Math.round(Math.min(maxX, Math.max(0, cx - rect.w / 2))),
    y: Math.round(Math.min(maxY, Math.max(0, cy - rect.h / 2))),
    w: rect.w,
    h: rect.h,
  }
}
