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
