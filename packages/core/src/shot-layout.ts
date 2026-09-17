/**
 * PNL-01: هندسة عرض لقطة مقصوصة بأرقام نسبية (٠–١٠٠) بلا قياس — الطبقة تأخذ
 * aspect-ratio بأبعاد الإطار، فتصح نِسَب الصورة وصناديق الإطار/الطمس
 * (markBoxRect) مباشرةً. تنسيق `%` شأن العميل. تحذير RTL: left/top فيزيائيان
 * عمدًا (الطبقة نفسها تُحوَّل بـtransform من 0 0).
 *
 * القِيَم رقميّة والصندوق يُحسب عبر markBoxRect حصرًا — معادلة النسبة واحدة في
 * المكان الواحد: الصورة الكاملة صندوقٌ افتراضيّ موضوع عند (-cropX, -cropY) داخل الإطار.
 */
import { markBoxRect, type MarkRect } from './mark-box'

export function toLocal(r: MarkRect, crop?: MarkRect): MarkRect {
  return crop ? { x: r.x - crop.x, y: r.y - crop.y, w: r.w, h: r.h } : r
}

export interface ShotLayout {
  /** بُعدا الإطار المعروض بالبكسل الطبيعي (القصّ أو الصورة كاملة) */
  frameW: number
  frameH: number
  img: { widthPct: number; leftPct: number; topPct: number }
}

export function shotLayout(natW: number, natH: number, crop?: MarkRect): ShotLayout | null {
  if (natW <= 0 || natH <= 0) return null
  const c = crop && crop.w > 0 && crop.h > 0 ? crop : { x: 0, y: 0, w: natW, h: natH }
  const box = markBoxRect({ x: -c.x, y: -c.y, w: natW, h: natH }, c.w, c.h)
  if (!box) return null
  // ‎-0 يطبع «-0%» لا «0%» — نطبّع الصفر كي تبقى المقارنات والأنماط نظيفة
  const norm = (v: number) => (Object.is(v, -0) ? 0 : v)
  return { frameW: c.w, frameH: c.h, img: { widthPct: norm(box.width), leftPct: norm(box.left), topPct: norm(box.top) } }
}
