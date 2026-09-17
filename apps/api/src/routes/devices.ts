import { randomInt } from 'node:crypto'
import { and, eq, lt, ne } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { zDeviceApprove, zDeviceStart, zDeviceToken } from '@dalili/shared'
import { deviceCodes, deviceTokens, users } from '../db/schema'
import { DEVICE_TOKEN_PREFIX, hashToken, type Auth } from '../auth/session'
import type { Db } from '../db/client'

export const DEVICE_CODE_TTL_S = 600
export const DEVICE_POLL_INTERVAL_S = 3
export const DEVICE_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000
/** RFC 8628 §6.1: حروف ساكنة بلا التباس — لا أحرف علّة (فلا كلمات) ولا O/0 ولا I/1 */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
const CODE_GONE_AR = 'الرمز غير صحيح أو انتهت مهلته — ابدأ الربط من التطبيق مجددًا'

export function newUserCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

/** يقبل ما يكتبه الإنسان: أحرف صغيرة ومسافات وبلا شرطة */
export function normalizeUserCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z]/g, '')
  if (s.length !== 8 || [...s].some((c) => !USER_CODE_ALPHABET.includes(c))) return null
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

const isExpired = (iso: string) => new Date(iso).getTime() < Date.now()

/**
 * DTOP-03: اقتران تطبيق الديسكتوب (نمط RFC 8628 device authorization grant).
 * التطبيق يطلب رمزًا ويستطلع؛ المستخدم يوافق من متصفّحه بجلسة كوكي؛ الرمز يُسلَّم مرّة واحدة.
 * قيد موثَّق: من يخدع مستخدمًا ليوافق على رمز ليس له يحصل على رمز جهاز — الحماية عرض اسم
 * الجهاز والرمز قبل القرار + مهلة ١٠ دقائق + قائمة الأجهزة مع الإبطال الفوري.
 */
export function registerDeviceRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  function purgeExpiredCodes() {
    db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, new Date().toISOString())).run()
  }

  function pendingByUserCode(code: string | null) {
    if (!code) return undefined
    const row = db.select().from(deviceCodes).where(eq(deviceCodes.userCode, code)).get()
    return row && row.status === 'pending' && !isExpired(row.expiresAt) ? row : undefined
  }

  app.post('/api/device/start', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = zDeviceStart.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ errorAr: 'اسم الجهاز مطلوب (حتى 60 حرفًا)' })
    purgeExpiredCodes()
    const deviceCode = nanoid(40)
    let userCode = newUserCode()
    for (let i = 0; i < 5 && db.select({ c: deviceCodes.userCode }).from(deviceCodes).where(eq(deviceCodes.userCode, userCode)).get(); i++) {
      userCode = newUserCode()
    }
    const now = Date.now()
    db.insert(deviceCodes)
      .values({
        deviceCodeHash: hashToken(deviceCode),
        userCode,
        deviceName: parsed.data.deviceName,
        status: 'pending',
        userId: null,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + DEVICE_CODE_TTL_S * 1000).toISOString(),
      })
      .run()
    return { deviceCode, userCode, expiresIn: DEVICE_CODE_TTL_S, interval: DEVICE_POLL_INTERVAL_S }
  })

  app.post('/api/device/token', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = zDeviceToken.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request', errorAr: 'رمز الجهاز مفقود' })
    const hash = hashToken(parsed.data.deviceCode)
    const row = db.select().from(deviceCodes).where(eq(deviceCodes.deviceCodeHash, hash)).get()
    const expired = { error: 'expired_token', errorAr: 'انتهت مهلة الربط — ابدأ من جديد' }
    if (!row || isExpired(row.expiresAt)) {
      if (row) db.delete(deviceCodes).where(eq(deviceCodes.deviceCodeHash, hash)).run()
      return reply.code(410).send(expired)
    }
    if (row.status === 'pending') {
      return reply.code(428).send({ error: 'authorization_pending', errorAr: 'بانتظار موافقتك من المتصفّح' })
    }
    // مرّة واحدة: الموافقة والرفض كلاهما يستهلكان الرمز. الحذف المشروط هو القفل —
    // استطلاعان متزامنان لا يخرجان برمزَي جهاز: من لم يحذف الصفّ فعلًا يأخذ 410
    const consumed = db
      .delete(deviceCodes)
      .where(and(eq(deviceCodes.deviceCodeHash, hash), ne(deviceCodes.status, 'pending')))
      .run()
    if (consumed.changes !== 1) return reply.code(410).send(expired)
    if (row.status !== 'approved' || !row.userId) {
      return reply.code(403).send({ error: 'access_denied', errorAr: 'رُفض ربط الجهاز' })
    }
    const user = db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, row.userId)).get()
    if (!user) return reply.code(410).send(expired)
    const token = DEVICE_TOKEN_PREFIX + nanoid(40)
    const deviceId = nanoid(12)
    const now = Date.now()
    db.insert(deviceTokens)
      .values({
        id: deviceId,
        userId: user.id,
        tokenHash: hashToken(token),
        deviceName: row.deviceName,
        createdAt: new Date(now).toISOString(),
        lastUsedAt: null,
        expiresAt: new Date(now + DEVICE_TOKEN_TTL_MS).toISOString(),
      })
      .run()
    return { token, deviceId, user }
  })

  // تخمين الرموز: ٢٠⁸ ≈ ٢٥٫٦ مليار × مهلة ١٠ دقائق × ٢٠ محاولة/د لكل جلسة — غير عمليّ
  app.get(
    '/api/device/pending',
    { preHandler: auth.requireCookieAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const row = pendingByUserCode(normalizeUserCode(String((req.query as { code?: string }).code ?? '')))
      if (!row) return reply.code(404).send({ errorAr: CODE_GONE_AR })
      return { userCode: row.userCode, deviceName: row.deviceName, createdAt: row.createdAt }
    },
  )

  app.post(
    '/api/device/approve',
    { preHandler: auth.requireCookieAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = auth.readUser(req)!
      const parsed = zDeviceApprove.safeParse(req.body)
      const code = parsed.success ? normalizeUserCode(parsed.data.userCode) : null
      if (!parsed.success || !code) return reply.code(400).send({ errorAr: 'رمز الربط بصيغة غير صالحة' })
      const row = pendingByUserCode(code)
      if (!row) return reply.code(404).send({ errorAr: CODE_GONE_AR })
      // مشروط بـpending: قرار واحد فقط — لا يقلب موافقٌ ثانٍ رفضًا ولا يعيد ربطه بحسابه
      const decided = db
        .update(deviceCodes)
        .set({ status: parsed.data.approve ? 'approved' : 'denied', userId: user.id })
        .where(and(eq(deviceCodes.userCode, code), eq(deviceCodes.status, 'pending')))
        .run()
      if (decided.changes !== 1) return reply.code(404).send({ errorAr: CODE_GONE_AR })
      return { ok: true }
    },
  )

  app.get('/api/devices', { preHandler: auth.requireCookieAuth }, async (req) => {
    const user = auth.readUser(req)!
    return db
      .select({ id: deviceTokens.id, deviceName: deviceTokens.deviceName, createdAt: deviceTokens.createdAt, lastUsedAt: deviceTokens.lastUsedAt })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, user.id))
      .all()
  })

  app.delete('/api/devices/:id', { preHandler: auth.requireCookieAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const res = db.delete(deviceTokens).where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, user.id))).run()
    if (res.changes === 0) return reply.code(404).send({ errorAr: 'الجهاز غير موجود' })
    return reply.code(204).send()
  })
}
