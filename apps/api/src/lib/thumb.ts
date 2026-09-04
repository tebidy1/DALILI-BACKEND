import jpeg from 'jpeg-js'

/**
 * PERF-02: مصغّرة JPEG خالصة JS (jpeg-js — بلا native) بعرض 320 وحجم ≤30KB.
 * تُولَّد عند الرفع؛ القوائم تعرض المصغّرة والعارض يبقى على الأصل.
 * ترجع null إذا تعذّر الضغط ضمن السقف — لا مصغّرة كاذبة.
 */

export const THUMB_WIDTH = 320
export const THUMB_MAX_BYTES = 30 * 1024

/** تحجين بأسلوب أخذ العينة الصندوقية (box sampling) — متوسط نافذة المصدر لكل بكسل هدف */
function resize(src: Uint8Array, sw: number, sh: number, tw: number, th: number): Buffer {
  const out = Buffer.alloc(tw * th * 4)
  const xRatio = sw / tw
  const yRatio = sh / th
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(ty * yRatio)
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * yRatio))
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * xRatio)
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * xRatio))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1 && y < sh; y++) {
        for (let x = x0; x < x1 && x < sw; x++) {
          const i = (y * sw + x) * 4
          r += src[i]!
          g += src[i + 1]!
          b += src[i + 2]!
          n++
        }
      }
      const o = (ty * tw + tx) * 4
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
      out[o + 3] = 255
    }
  }
  return out
}

export function makeJpegThumb(
  jpegBuf: Buffer,
  targetWidth = THUMB_WIDTH,
  maxBytes = THUMB_MAX_BYTES,
): Buffer | null {
  let img
  try {
    img = jpeg.decode(jpegBuf, { maxMemoryUsageInMB: 1024 })
  } catch {
    return null
  }
  if (img.width <= 0 || img.height <= 0) return null
  const tw = Math.min(targetWidth, img.width)
  const th = Math.max(1, Math.round((img.height * tw) / img.width))
  const resized = resize(img.data, img.width, img.height, tw, th)
  // هبوط بالجودة حتى دخول السقف — جودة أقل من 35 على لقطة واجهة تعني تفاهة، لا نقبلها
  for (const q of [72, 55, 42, 35]) {
    const enc = jpeg.encode({ data: resized, width: tw, height: th }, q)
    if (enc.data.length <= maxBytes) return Buffer.from(enc.data)
  }
  return null
}
