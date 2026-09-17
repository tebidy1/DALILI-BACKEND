/**
 * إطار التكبير التكيّفي للعنصر المحدَّد فوق لقطة المعاينة في اللوحة الجانبية
 * (طلب المالك 2026-09-11: «لقطة النافذة تُعرض مضغوطة جدًا داخل البطاقة — كبّر
 * العنصر ٢٠٠–٣٠٠٪ ووسّطه ليؤكّد الملتقِط أنه العنصر الصحيح»).
 *
 * الطبقة تُرسم بالصورة معروضةً بعرض ١٠٠٪ من النافذة (بكسل طبيعي → بكسل طبقة بعامل
 * موحّد)، ثم نُطبّق `translate(scale)` من هذه الدالّة النقية فتُكبَّر ويُوسَّط مركز
 * العنصر في النافذة. الإطار الأحمر يعيش في نفس الطبقة فيبقى منطبقًا بعد التكبير.
 *
 * القياس (viewW/viewH) يخصّ نافذة العرض ويُقاس وقت التشغيل في المكوّن؛ الهندسة هنا
 * نقية وقابلة للاختبار مثل mark-box.
 */

export interface ZoomRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ZoomFrame {
  /** معامل التكبير المُقيَّد */
  scale: number
  /** إزاحة أفقية بالبكسل (transform: translateX) */
  translateX: number
  /** إزاحة رأسية بالبكسل (transform: translateY) */
  translateY: number
}

/** حدّ التكبير الأدنى (٢٠٠٪) والأقصى (٤٠٠٪) — المالك أراد ٢٠٠–٣٠٠٪ فأبقينا سقفًا يسع الصغير */
export const ZOOM_MIN = 2
export const ZOOM_MAX = 4
/** نسبة ملء العنصر من البُعد الأضيق للنافذة قبل التقييد — يترك سياقًا مريحًا حوله */
const TARGET_FILL = 0.55

/** PNL-01: حدود التكبير قابلة للضبط — الالتقاط يؤكّد العنصر (قريب)، والقارئ يقارن الصفحة (سياق أوسع) */
export interface ZoomLimits {
  min: number
  max: number
  fill: number
}

export const CAPTURE_ZOOM: ZoomLimits = { min: ZOOM_MIN, max: ZOOM_MAX, fill: TARGET_FILL }

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * يحسب تكبيرًا تكيّفيًا يملأ العنصر ~٥٥٪ من النافذة (مُقيَّد ٢×–٤×) ويوسّط مركزه،
 * ثم يقصّ الإزاحة كي تظلّ الطبقة مغطّيةً للنافذة بلا حواف فارغة (يُوسَّط رأسيًا إن
 * عجز الارتفاع عن التغطية). يرجع null لمدخلات غير صالحة فيتراجع المكوّن للقطة الكاملة.
 */
export function zoomFrame(
  mark: ZoomRect,
  natW: number,
  natH: number,
  viewW: number,
  viewH: number,
  limits: ZoomLimits = CAPTURE_ZOOM,
): ZoomFrame | null {
  if (natW <= 0 || natH <= 0 || viewW <= 0 || viewH <= 0) return null
  if (mark.w <= 0 || mark.h <= 0) return null

  const s = viewW / natW // بكسل طبيعي → بكسل طبقة (الصورة بعرض ١٠٠٪)
  const layerH = natH * s // ارتفاع الطبقة المعروضة
  const mw = mark.w * s
  const mh = mark.h * s
  const cx = (mark.x + mark.w / 2) * s // مركز العنصر في الطبقة
  const cy = (mark.y + mark.h / 2) * s

  const fit = Math.min((limits.fill * viewW) / mw, (limits.fill * viewH) / mh)
  const scale = clamp(fit, limits.min, limits.max)

  // توسيط مركز العنصر في مركز النافذة
  let translateX = viewW / 2 - scale * cx
  let translateY = viewH / 2 - scale * cy

  // قصّ الإزاحة: لا تظهر حواف فارغة ما دامت الطبقة تغطّي النافذة، وإلا وسّط
  const coverW = scale * viewW
  const coverH = scale * layerH
  translateX = coverW >= viewW ? clamp(translateX, viewW - coverW, 0) : (viewW - coverW) / 2
  translateY = coverH >= viewH ? clamp(translateY, viewH - coverH, 0) : (viewH - coverH) / 2

  return { scale, translateX, translateY }
}
