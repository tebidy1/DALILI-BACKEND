import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { files } from '../db/schema'
import type { Auth } from '../auth/session'
import { makeJpegThumb } from '../lib/thumb'
import type { Db } from '../db/client'
import type { FileSigner } from '../lib/file-cap'
import type { Idempotency } from '../lib/idempotency'
import { activeShare } from './guides-shared'

/** معرفات الملفات كلها nanoid — أي شيء خارج هذا النمط يُرفض قبل لمس القرص */
const FILE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/** فحص البصمة السحرية — لا نثق بنوع الملف المُعلن */
export type AssetMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'audio/webm'

/** VOX: الصور حتى 5MB والصوت المسجَّل حتى 25MB (سقف دليل كامل) */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export function sniffAsset(buf: Buffer): AssetMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (
    buf.length >= 4 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return 'image/png'
  // PERF-03: WebP مقبول كصورة (بديل أخف من JPEG عند الرفع اليدوي) — بلا مصغّرة:
  // لا فاكّ WebP نقية بلا اعتماد أصلي، والصدق خير من تزييف
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  // VOX-01: حاوية EBML (webm) — بصمة مقاطع MediaRecorder
  if (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  )
    return 'audio/webm'
  return null
}

export function registerUploadRoutes(
  app: FastifyInstance,
  db: Db,
  auth: Auth,
  filesDir: string,
  signer: FileSigner,
  /** DTOP-02: الرفع المعاد بالمفتاح نفسه يعيد الملف نفسه */
  idempotency: Idempotency,
) {
  app.post(
    '/api/uploads',
    { preHandler: auth.requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const user = auth.readUser(req)!
    const file = await req.file()
    if (!file) {
      return reply.code(400).send({ errorAr: 'أرسل صورة واحدة في حقل file (form-data)' })
    }
    const buf = await file.toBuffer()
    const mime = sniffAsset(buf)
    if (!mime) {
      return reply.code(400).send({ errorAr: 'الملف ليس صورة JPEG أو PNG أو WebP أو صوت WebM صالحًا' })
    }
    // VOX: حدود صادقة مختلفة لكل نوع — الصورة 5MB والصوت المسجَّل 25MB
    if (mime.startsWith('image/') && buf.length > MAX_IMAGE_BYTES) {
      return reply.code(413).send({ errorAr: 'حجم الصورة يتجاوز 5 ميغابايت' })
    }
    if (mime === 'audio/webm' && buf.length > MAX_AUDIO_BYTES) {
      return reply.code(413).send({ errorAr: 'حجم الصوت يتجاوز 25 ميغابايت — منهِ التسجيل المقبل أقصر' })
    }
    // DTOP-02: الحجز بعد فحص الجسم وقبل أيّ كتابة — لا await بين الحجز وتثبيت الردّ.
    // الإعادة تعيد الملف نفسه، والروابط تُوقَّع من جديد لا تُعاد منتهية من الذاكرة
    const idem = idempotency.begin(req, user.id, 'uploads')
    if (idem.kind === 'rejected') return reply.code(idem.status).send({ errorAr: idem.errorAr })
    if (idem.kind === 'replay') {
      const prev = idem.body as { fileId: string; thumbFileId?: string }
      return {
        fileId: prev.fileId,
        thumbFileId: prev.thumbFileId,
        fileUrl: signer.original(prev.fileId),
        ...(prev.thumbFileId ? { thumbUrl: signer.original(prev.thumbFileId) } : {}),
      }
    }
    const id = nanoid(21)
    let thumbFileId: string | undefined
    try {
      fs.writeFileSync(path.join(filesDir, id), buf)
      db.insert(files)
        .values({ id, userId: user.id, mime, bytes: buf.length, createdAt: new Date().toISOString() })
        .run()
      // PERF-02: مصغّرة ≤30KB بعرض 320 تولد عند الرفع — لقاطات الامتداد JPEG دومًا؛
      // PNG (أيقونات وأشباهها) بلا مصغّرة، والقوائم تسقط للأصل بلا كذب
      if (mime === 'image/jpeg') {
        const thumb = makeJpegThumb(buf)
        if (thumb) {
          thumbFileId = nanoid(21)
          fs.writeFileSync(path.join(filesDir, thumbFileId), thumb)
          db.insert(files)
            .values({
              id: thumbFileId,
              userId: user.id,
              mime: 'image/jpeg',
              bytes: thumb.length,
              createdAt: new Date().toISOString(),
            })
            .run()
        }
      }
    } catch (err) {
      if (idem.kind === 'fresh') idempotency.release(user.id, idem.key)
      throw err
    }
    if (idem.kind === 'fresh') idempotency.remember(user.id, idem.key, 'uploads', 200, { fileId: id, thumbFileId })
    // خصوصيّة ٢ب: الرافع يأخذ روابط موقَّعة فورًا — المعاينة قبل الحفظ لا تركّب رابطًا من معرّف
    return {
      fileId: id,
      thumbFileId,
      fileUrl: signer.original(id),
      ...(thumbFileId ? { thumbUrl: signer.original(thumbFileId) } : {}),
    }
    },
  )

  app.get('/files/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!FILE_ID_RE.test(id)) {
      return reply.code(404).send({ errorAr: 'الملف غير موجود' })
    }
    // خصوصيّة ٢ب: لا بايت بلا قدرة أصدرها الخادم — والرفض 404 لا يفشي الوجود
    const cap = signer.verify(id, req.query as { e?: string; s?: string; c?: string })
    if (!cap.ok) {
      return reply.code(404).send({ errorAr: 'الملف غير موجود' })
    }
    // نطاق المشاركة يُفحص حيًّا: السحب أو السلة يقطعان الصورة في اللحظة نفسها
    if (cap.share && !activeShare(db, cap.share)) {
      return reply.code(404).send({ errorAr: 'الملف غير موجود' })
    }
    const row = db.select().from(files).where(eq(files.id, id)).get()
    const safeName = path.basename(id)
    const p = path.join(filesDir, safeName)
    if (
      !row ||
      !p.startsWith(filesDir + path.sep) ||
      !fs.existsSync(p)
    ) {
      return reply.code(404).send({ errorAr: 'الملف غير موجود' })
    }
    // خاصّ دائمًا: لا كاش مشترك يحفظ أصلًا — والمشاركة ساعة فقط كي يسري السحب على المتصفّح أيضًا
    reply.header('cache-control', cap.share ? 'private, max-age=3600' : 'private, max-age=86400')
    // VOX-03: عنصر الصوت في العارض يطلب نطاقات للتمرير — نطاق واحد صالح → 206
    const size = fs.statSync(p).size
    reply.header('accept-ranges', 'bytes')
    const range = req.headers.range
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (m && (m[1] !== '' || m[2] !== '')) {
        let start = m[1] !== '' ? Number(m[1]) : 0
        let end = m[2] !== '' ? Number(m[2]) : size - 1
        if (m[1] === '') {
          // bytes=-N: آخر N بايت
          start = Math.max(0, size - Number(m[2]))
          end = size - 1
        }
        if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start < size) {
          end = Math.min(end, size - 1)
          reply.code(206)
          reply.header('content-range', `bytes ${start}-${end}/${size}`)
          reply.header('content-length', String(end - start + 1))
          return reply.type(row.mime).send(fs.createReadStream(p, { start, end }))
        }
      }
      // نطاق غير قابل للتحقيق → الملف كاملًا 200 — لا 416 ولا انهيار
    }
    return reply.type(row.mime).send(fs.createReadStream(p))
  })
}
