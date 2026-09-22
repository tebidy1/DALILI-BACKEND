import { createHash } from 'node:crypto'
import jpeg from 'jpeg-js'

/**
 * خصوصيّة ٢ب: الضيف يرى بكسلات محروقة لا بيانات طمس فوق الأصل.
 * العامل 12 مطابق pixelate في StepImage.tsx فيبدو المنشور كما رآه المحرِّر.
 * دوالّ نقيّة بلا قاعدة ولا قرص — تعمل داخل خيط العامل (burn-worker.ts).
 */
export const PIXEL_FACTOR = 12
const DERIVED_QUALITY = 85

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface BurnSpec {
  blurRects: Rect[]
  crop?: Rect
}

function clamp(r: Rect, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(width, Math.ceil(r.x + r.w))
  const y1 = Math.min(height, Math.ceil(r.y + r.h))
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

/** يطمس مستطيلًا داخل RGBA بالمكان — لون كل كتلة متوسط بكسلاتها */
export function pixelateRgba(data: Uint8Array, width: number, height: number, r: Rect): void {
  const c = clamp(r, width, height)
  if (!c) return
  const rw = c.x1 - c.x0
  const rh = c.y1 - c.y0
  const tw = Math.max(1, Math.round(rw / PIXEL_FACTOR))
  const th = Math.max(1, Math.round(rh / PIXEL_FACTOR))
  for (let by = 0; by < th; by++) {
    const sy0 = c.y0 + Math.floor((by * rh) / th)
    const sy1 = c.y0 + Math.floor(((by + 1) * rh) / th)
    for (let bx = 0; bx < tw; bx++) {
      const sx0 = c.x0 + Math.floor((bx * rw) / tw)
      const sx1 = c.x0 + Math.floor(((bx + 1) * rw) / tw)
      let rr = 0
      let gg = 0
      let bb = 0
      let n = 0
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * width + x) * 4
          rr += data[i]!
          gg += data[i + 1]!
          bb += data[i + 2]!
          n++
        }
      }
      if (n === 0) continue
      rr = Math.round(rr / n)
      gg = Math.round(gg / n)
      bb = Math.round(bb / n)
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * width + x) * 4
          data[i] = rr
          data[i + 1] = gg
          data[i + 2] = bb
        }
      }
    }
  }
}

/** يحرق الطمس ثم القصّ في JPEG جديد — bytes ليست JPEG صالحًا ← null (الفشل مغلق) */
export function burnJpeg(src: Buffer, spec: BurnSpec): Buffer | null {
  let img: { width: number; height: number; data: Uint8Array }
  try {
    img = jpeg.decode(src, { maxMemoryUsageInMB: 1024, useTArray: true })
  } catch {
    return null
  }
  if (img.width <= 0 || img.height <= 0) return null
  for (const r of spec.blurRects) pixelateRgba(img.data, img.width, img.height, r)
  let { data, width, height } = img
  const c = spec.crop ? clamp(spec.crop, width, height) : null
  if (c) {
    const cw = c.x1 - c.x0
    const ch = c.y1 - c.y0
    const out = new Uint8Array(cw * ch * 4)
    for (let y = 0; y < ch; y++) {
      const from = ((c.y0 + y) * width + c.x0) * 4
      out.set(data.subarray(from, from + cw * 4), y * cw * 4)
    }
    data = out
    width = cw
    height = ch
  }
  return Buffer.from(jpeg.encode({ data, width, height }, DERIVED_QUALITY).data)
}

/** معرّف حتميّ — نفس المصدر ونفس المواصفة = نفس الملفّ، فلا تكرار ولا جدول ذاكرة */
export function derivativeId(sourceId: string, spec: BurnSpec): string {
  return 'd' + createHash('sha256').update(`${sourceId}\n${JSON.stringify(spec)}`).digest('base64url').slice(0, 40)
}
