import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { invites, users, workspaceMembers, workspaces } from '../db/schema'
import type { Auth } from '../auth/session'
import { zAcceptInviteReq, zInviteCreateReq } from '@dalili/shared'
import { bodyOr400 } from '../lib/body-or-400'
import { hashPassword } from '../auth/password'
import { memberRole, normalizeRole } from '../ws/roles'
import type { Db } from '../db/client'

/** عمر الدعوة قبل انتهاء صلاحيتها — 30 يومًا ثم يطلب المدير رابطًا جديدًا */
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * WS-01: دعوات المساحة — المدير يولّد رابطًا يُنسخ ويُرسل واتساب (بلا SMTP)،
 * والمدعوّ يفتحه ويضع كلمة مرور فيستكمل حسابه المعلق ويدخل بجلسة صالحة.
 * يغلق ثغرة الدعوة القديمة التي كانت تنشئ مستخدمًا بـpasswordHash='pending' لا يدخل أبدًا.
 */
export function registerInviteRoutes(app: FastifyInstance, db: Db, auth: Auth, publicBase: string) {
  function workspaceOf(userId: string, email: string) {
    return auth.ensurePersonalWorkspace(userId, email)
  }

  app.post('/api/team/invites', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const ws = workspaceOf(user.id, user.email)
    if (memberRole(db, ws.id, user.id) !== 'admin') {
      return reply.code(403).send({ errorAr: 'غير مصرح لك بدعوة أعضاء — هذا حق مدير المساحة' })
    }
    const data = bodyOr400(zInviteCreateReq, req.body, reply, 'بيانات دعوة غير صالحة')
    if (data === undefined) return data
    const email = data.email.trim().toLowerCase()
    const existing = db.select().from(users).where(eq(users.email, email)).get()
    // ذو الحساب الفعلي يُضاف مباشرة من POST /api/team — الدعوة للغير الموجود فقط
    if (existing && existing.passwordHash !== 'pending') {
      return reply.code(409).send({
        errorAr: 'هذا البريد لديه حساب بالفعل — أضفه مباشرة من شاشة الفريق دون دعوة',
      })
    }
    const id = nanoid(12)
    const token = nanoid(16)
    const now = new Date().toISOString()
    db.insert(invites)
      .values({ id, workspaceId: ws.id, email, role: data.role, token, createdAt: now, acceptedAt: null })
      .run()
    return {
      id,
      email,
      role: data.role,
      token,
      inviteUrl: `${publicBase}/invite/${token}`,
      createdAt: now,
    }
  })

  /** علنًا بلا جلسة — المدعوّ يعرف أين يُضاف قبل أن يضع كلمة مروره */
  app.get('/api/invites/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const row = db.select().from(invites).where(eq(invites.token, token)).get()
    if (!row) {
      return reply.code(404).send({ errorAr: 'رابط الدعوة غير موجود — اطلب رابطًا جديدًا من مديرك' })
    }
    const ws = db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).get()
    return {
      email: row.email,
      role: normalizeRole(row.role),
      workspaceName: ws?.name ?? 'مساحة العمل',
      accepted: row.acceptedAt !== null,
      expired: row.acceptedAt === null && Date.now() - Date.parse(row.createdAt) > INVITE_TTL_MS,
    }
  })

  /** علنًا بلا جلسة — كلمة المرور تستكمل الحساب المعلق وتمنح جلسة فورية */
  app.post(
    '/api/invites/:token/accept',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const { token } = req.params as { token: string }
    const data = bodyOr400(zAcceptInviteReq, req.body, reply, 'بيانات غير صالحة')
    if (data === undefined) return data
    const row = db.select().from(invites).where(eq(invites.token, token)).get()
    if (!row) {
      return reply.code(404).send({ errorAr: 'رابط الدعوة غير موجود — اطلب رابطًا جديدًا من مديرك' })
    }
    if (row.acceptedAt) {
      return reply.code(410).send({ errorAr: 'هذه الدعوة استُخدمت سابقًا — سجّل دخولك أو اطلب رابطًا جديدًا' })
    }
    if (Date.now() - Date.parse(row.createdAt) > INVITE_TTL_MS) {
      return reply.code(400).send({ errorAr: 'انتهت صلاحية الدعوة — اطلب رابطًا جديدًا من مديرك' })
    }
    const email = row.email
    let user = db.select().from(users).where(eq(users.email, email)).get()
    if (user && user.passwordHash !== 'pending') {
      return reply.code(409).send({
        errorAr: 'هذا البريد لديه حساب بالفعل — سجّل دخولك واطلب من مديرك إضافتك مباشرة',
      })
    }
    if (!user) {
      const id = nanoid(12)
      db.insert(users)
        .values({ id, email, passwordHash: hashPassword(data.password), createdAt: new Date().toISOString() })
        .run()
      user = db.select().from(users).where(eq(users.id, id)).get()
    } else {
      // حساب معلّق من دعوة قديمة — يستكمل كلمة المرور أخيرًا
      db.update(users).set({ passwordHash: hashPassword(data.password) }).where(eq(users.id, user.id)).run()
    }
    const already = db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, row.workspaceId), eq(workspaceMembers.userId, user!.id)))
      .get()
    if (!already) {
      db.insert(workspaceMembers)
        .values({ workspaceId: row.workspaceId, userId: user!.id, role: normalizeRole(row.role), department: '' })
        .run()
    }
    db.update(invites).set({ acceptedAt: new Date().toISOString() }).where(eq(invites.id, row.id)).run()
    auth.rotateSession(req, reply, user!.id)
    return { id: user!.id, email: user!.email }
    },
  )
}
