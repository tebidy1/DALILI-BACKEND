import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { users } from '../db/schema'
import { hashPassword, verifyPassword } from '../auth/password'
import { SESSION_COOKIE, type Auth } from '../auth/session'
import { zLocale, zLogin, zRegister, zTheme } from '@dalili/shared'
import { seedWelcomeGuide } from '../lib/welcome'
import type { Db } from '../db/client'

export function registerAuthRoutes(app: FastifyInstance, db: Db, auth: Auth, sqlite: Database.Database) {
  // SEC-01: المصادقة أشد بابًا — 5 محاولات في الدقيقة لكل مسار، ثم 429
  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const parsed = zRegister.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: `بيانات غير صالحة: ${parsed.error.issues[0]?.message ?? ''}` })
    }
    const { email, password } = parsed.data
    const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()
    if (existing) {
      return reply.code(409).send({ errorAr: 'هذا البريد مسجّل مسبقًا — جرّب تسجيل الدخول' })
    }
    const id = nanoid(12)
    db.insert(users)
      .values({ id, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() })
      .run()
    const ws = auth.ensurePersonalWorkspace(id, email)
    // UX-05: حساب جديد يبدأ بدليل يشرح المنتج بنفسه — بلا مكتبة فارغة صامتة
    seedWelcomeGuide(db, sqlite, { workspaceId: ws.id, userId: id, nowIso: new Date().toISOString() })
    auth.rotateSession(req, reply, id)
    return { id, email }
    },
  )

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const parsed = zLogin.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: 'بريد أو كلمة مرور بصيغة غير صالحة' })
    }
    const { email, password } = parsed.data
    const user = db.select().from(users).where(eq(users.email, email)).get()
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ errorAr: 'البريد أو كلمة المرور غير صحيحة' })
    }
    auth.rotateSession(req, reply, user.id)
    return { id: user.id, email: user.email }
    },
  )

  app.post('/api/auth/logout', async (req, reply) => {
    auth.destroySession(req)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', { preHandler: auth.requireAuth }, async (req) => {
    // DTOP-03: الشكل نفسه للكوكي ولرمز الجهاز — deviceId داخليّ لا يُعاد
    const user = auth.readUser(req)!
    return { id: user.id, email: user.email }
  })

  // مزامنة الثيم (2026-09-06): الاختيار لكل مستخدم — الموقع والامتداد يقرآنه من overview
  app.put('/api/me/theme', { preHandler: auth.requireAuth }, async (req, reply) => {
    const parsed = zTheme.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: `بيانات غير صالحة: ${parsed.error.issues[0]?.message ?? ''}` })
    }
    const user = auth.readUser(req)!
    db.update(users).set({ theme: parsed.data.theme }).where(eq(users.id, user.id)).run()
    return { myTheme: parsed.data.theme }
  })

  // مزامنة اللغة (I18N-01): مرآة /api/me/theme — واجهة كل مستخدم تتبع حسابه
  app.put('/api/me/locale', { preHandler: auth.requireAuth }, async (req, reply) => {
    const parsed = zLocale.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: `بيانات غير صالحة: ${parsed.error.issues[0]?.message ?? ''}` })
    }
    const user = auth.readUser(req)!
    db.update(users).set({ locale: parsed.data.locale }).where(eq(users.id, user.id)).run()
    return { myLocale: parsed.data.locale }
  })
}
