import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * خصوصيّة ٢ب: قدرة الوصول إلى ملفّ = توقيع HMAC أصدره الخادم لمن يحقّ له.
 * عديم الحالة فيعمل مع الكوكي والـBearer والملفّ الملصوق خارج التطبيق.
 * الانتهاء مقرَّب لحدّ اليوم فيبقى الرابط ثابتًا ويعمل كاش المتصفّح.
 */
export const ORIGINAL_TTL_S = 7 * 24 * 3600
export const SHARE_TTL_S = 24 * 3600
const DAY_S = 24 * 3600

export type FileCapResult = { ok: true; share?: string } | { ok: false }

export function makeFileSigner(secret: string, now: () => number = () => Date.now()) {
  // مفتاح مشتقّ — تسريب توقيع ملفّ لا يقترب من سرّ الكوكي
  const key = createHmac('sha256', secret).update('dalili-files-v1').digest()
  const mac = (id: string, e: number, s: string) =>
    createHmac('sha256', key).update(`${id}\n${e}\n${s}`).digest('base64url').slice(0, 32)
  const expiry = (ttl: number) => Math.ceil(now() / 1000 / DAY_S) * DAY_S + ttl

  function original(id: string): string {
    const e = expiry(ORIGINAL_TTL_S)
    return `/files/${id}?e=${e}&c=${mac(id, e, '')}`
  }

  function shared(id: string, token: string): string {
    const e = expiry(SHARE_TTL_S)
    return `/files/${id}?e=${e}&s=${encodeURIComponent(token)}&c=${mac(id, e, token)}`
  }

  function verify(id: string, q: { e?: string; s?: string; c?: string }): FileCapResult {
    if (!q.e || !q.c || !/^\d{1,12}$/.test(q.e)) return { ok: false }
    const e = Number(q.e)
    if (e * 1000 < now()) return { ok: false }
    const expected = Buffer.from(mac(id, e, q.s ?? ''))
    const got = Buffer.from(q.c)
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false }
    return q.s ? { ok: true, share: q.s } : { ok: true }
  }

  return { original, shared, verify }
}

export type FileSigner = ReturnType<typeof makeFileSigner>
