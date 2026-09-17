/**
 * موضع إطار الهدف الأحمر فوق لقطة المعاينة — النواة تعيد **أرقامًا نسبية (٠–١٠٠)**
 * لا سلاسل CSS؛ تنسيق `%` شأن العرض ويبقى للعميل (اللوحة الجانبية اليوم، وعارض
 * الديسكتوب لاحقًا) (طلب المالك 2026-09-01: «يفترض أن يظهر الحقل المحدَّد بالأحمر
 * عند الالتقاط»).
 *
 * `mark` بإحداثيات بكسل الصورة الطبيعية (نفس فضاء اللقطة المخزَّنة، لأن الخلفية
 * تخزّنه بعد `scaleRect(rect, dpr)`). حين تُعرض اللقطة بعرض ١٠٠٪ وارتفاع تلقائي
 * (بلا قصّ)، تصير الحاوية النسبية مطابقةً تمامًا لصندوق الصورة المعروض، فتُحوَّل
 * البكسلات إلى نِسَب تنطبق على العنصر بدقّة بلا قياس وقت التشغيل.
 */
import type { MarkColor, TargetMark } from './target'

export interface MarkRect {
  x: number
  y: number
  w: number
  h: number
}

/** إطار الهدف بنسب مئويّة رقميّة (٠–١٠٠) من أبعاد الإطار المعروض */
export interface MarkRectPct {
  left: number
  top: number
  width: number
  height: number
}

/** نِسَب الإطار من مستطيل الهدف وأبعاد الصورة الطبيعية — نقية وقابلة للاختبار */
export function markBoxRect(mark: MarkRect, naturalW: number, naturalH: number): MarkRectPct | null {
  if (naturalW <= 0 || naturalH <= 0) return null
  if (mark.w <= 0 || mark.h <= 0) return null
  const pct = (v: number, whole: number) => (v / whole) * 100
  return {
    left: pct(mark.x, naturalW),
    top: pct(mark.y, naturalH),
    width: pct(mark.w, naturalW),
    height: pct(mark.h, naturalH),
  }
}

/** حلقة نقطة الضغط الفارغة (قرار المالك ٣و — خيار أ): مركزُ العلامة نقطةُ
 *  الضغط الحقيقيّة لا مستطيلُ العنصر الذي يخطئه UIA أحيانًا. مربّعٌ بضلع
 *  ٢×نصف القطر و`shape:'ellipse'` — والعارض يرسم الإطار حدًّا لا ملءً
 *  (drawMark: stroke فقط) فيصير حلقةً دائرية بلا تغيير مخطّطٍ ولا عارض.
 *  الإحداثيّات بكسل الصورة الطبيعيّة (اطرح أصل الشاشة قبل النداء كما في
 *  imageRectOf). المربّع جزئيُّ الخروج صالح (يُقصّ بصريًّا)؛ خارج الصورة
 *  كليًّا أو مُدخَل منحلّ ⇐ بلا علامة بصدق. */
export function pointMark(
  cx: number,
  cy: number,
  radiusPx: number,
  imgW: number,
  imgH: number,
  color: MarkColor,
): TargetMark | undefined {
  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(radiusPx) ||
    radiusPx <= 0 ||
    imgW <= 0 ||
    imgH <= 0
  ) {
    return undefined
  }
  const rect = { x: cx - radiusPx, y: cy - radiusPx, w: radiusPx * 2, h: radiusPx * 2 }
  if (rect.x >= imgW || rect.y >= imgH || rect.x + rect.w <= 0 || rect.y + rect.h <= 0) {
    return undefined
  }
  if (markBoxRect(rect, imgW, imgH) === null) return undefined
  return { rect, color, shape: 'ellipse' }
}
