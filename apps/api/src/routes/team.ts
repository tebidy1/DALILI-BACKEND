import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { guides, teams, users, workspaceMembers, workspaces } from '../db/schema'
import type { Auth } from '../auth/session'
import { zInviteMemberReq, zUpdateMemberReq } from '@dalili/shared'
import { bodyOr400 } from '../lib/body-or-400'
import { normalizeRole } from '../ws/roles'
import type { Db } from '../db/client'

/**
 * المرحلة د (الفرق — WS-08) فوق /api/team الموجود: القراءة لكل الأعضاء (الرخصة الإدارية
 * للمدير وحده)، وكل صف بحالة الدعوة (pending) وعدد أدلة صاحبه (guideCount) وفريقه
 * (ترحيل 0010 رقّى «القسم» الحر إلى كيان). **الإزالة تنقل ملكية أدلة المنقول كلها
 * للمدير** (وحتى السلة، والمجلدات تُفرَّغ لجذره) فلا يبقى دليل يتيم — ثغرة النسخة القديمة.
 * الإضافة المباشرة صارت صادقة: الحساب الفعلي وحده يُضاف هنا، ولمن لا حساب له رابط دعوة.
 */
export function registerTeamRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  // نفس عقد أشباهه الخمسة (wsOf/workspaceOf): البريد يُستعمل فقط عند أول إنشاء
  // للمساحة الشخصية — ولوغاريتم الدخول يضمن وجودها قبل أي مسار، فهو هنا احتياط
  function getWorkspace(userId: string, email: string) {
    return auth.ensurePersonalWorkspace(userId, email).id
  }

  function requireWorkspaceAdmin(userId: string, workspaceId: string) {
    const member = db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .get()
    return member?.role === 'admin'
  }

  /** بوابة الإدارة — 403 واحدة صادقة لكل مسارات الكتابة */
  function adminBlock(userId: string, workspaceId: string, reply: import('fastify').FastifyReply) {
    if (!requireWorkspaceAdmin(userId, workspaceId)) {
      return reply.code(403).send({ errorAr: 'غير مصرح لك بإدارة الفريق' })
    }
    return null
  }

  /** صف قائمة الفريق — استعلام واحد لكل الأعضاء بعدّاداتهم وفرقهم */
  function rosterOf(workspaceId: string) {
    return db
      .select({
        id: users.id,
        email: users.email,
        role: workspaceMembers.role,
        department: workspaceMembers.department,
        joinedAt: users.createdAt,
        pending: sql<number>`case when ${users.passwordHash} = 'pending' then 1 else 0 end`,
        guideCount: sql<number>`(SELECT count(*) FROM guides g WHERE g.user_id = ${workspaceMembers.userId} AND g.workspace_id = ${workspaceId} AND g.deleted_at IS NULL)`,
        teamId: workspaceMembers.teamId,
        teamName: teams.name,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(teams, eq(teams.id, workspaceMembers.teamId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .all()
      .map((r) => ({
        ...r,
        pending: Number(r.pending) > 0,
        guideCount: Number(r.guideCount ?? 0),
      }))
  }

  app.get('/api/team/teams', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const workspaceId = getWorkspace(user.id, user.email)
    return db
      .select({
        id: teams.id,
        name: teams.name,
        memberCount: sql<number>`(SELECT count(*) FROM workspace_members wm WHERE wm.team_id = ${teams.id})`,
      })
      .from(teams)
      .where(eq(teams.workspaceId, workspaceId))
      .all()
      .map((t) => ({ ...t, memberCount: Number(t.memberCount) }))
  })

  app.post('/api/team/teams', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const workspaceId = getWorkspace(user.id, user.email)
    const blocked = adminBlock(user.id, workspaceId, reply)
    if (blocked) return blocked
    const name = String((req.body as { name?: unknown } | null)?.name ?? '').trim()
    if (!name) return reply.code(400).send({ errorAr: 'اسم الفريق فارغ' })
    const dup = db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.workspaceId, workspaceId), eq(teams.name, name)))
      .get()
    if (dup) return reply.code(409).send({ errorAr: 'يوجد فريق بهذا الاسم بالفعل' })
    const id = nanoid(12)
    db.insert(teams).values({ id, workspaceId, name, createdAt: new Date().toISOString() }).run()
    return { id, name, memberCount: 0 }
  })

  app.patch('/api/team/teams/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const workspaceId = getWorkspace(user.id, user.email)
    const blocked = adminBlock(user.id, workspaceId, reply)
    if (blocked) return blocked
    const { id } = req.params as { id: string }
    const row = db.select().from(teams).where(and(eq(teams.id, id), eq(teams.workspaceId, workspaceId))).get()
    if (!row) return reply.code(404).send({ errorAr: 'الفريق غير موجود' })
    const name = String((req.body as { name?: unknown } | null)?.name ?? '').trim()
    if (!name) return reply.code(400).send({ errorAr: 'اسم الفريق فارغ' })
    db.update(teams).set({ name }).where(eq(teams.id, id)).run()
    return { id, name }
  })

  app.delete('/api/team/teams/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const workspaceId = getWorkspace(user.id, user.email)
    const blocked = adminBlock(user.id, workspaceId, reply)
    if (blocked) return blocked
    const { id } = req.params as { id: string }
    const row = db.select().from(teams).where(and(eq(teams.id, id), eq(teams.workspaceId, workspaceId))).get()
    if (!row) return reply.code(404).send({ errorAr: 'الفريق غير موجود' })
    // أعضاؤه يرجعون «بلا فريق» — لا عضو يتيم (يدويًّا فلا اعتماد على PRAGMA foreign_keys)
    db.update(workspaceMembers).set({ teamId: null }).where(eq(workspaceMembers.teamId, id)).run()
    db.delete(teams).where(eq(teams.id, id)).run()
    return reply.code(204).send()
  })

  app.get('/api/team', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const workspaceId = getWorkspace(user.id, user.email)
    // القراءة لكل الأعضاء — «من في المنظمة» معرفة مشتركة، والإدارة أزرار يخفيها الدور
    return rosterOf(workspaceId)
  })

  /**
   * إضافة مباشرة لحساب فعلي فقط (نظير 409 مسار الدعوات). البريد بلا حساب لا يُنشئ
   * له مستخدمًا معلّقًا لا يدخل أبدًا — ثغرة النسخة القديمة المغلقة: أرسل له رابط دعوة.
   */
  app.post('/api/team', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const workspaceId = getWorkspace(user.id, user.email)
    const blocked = adminBlock(user.id, workspaceId, reply)
    if (blocked) return blocked
    const data = bodyOr400(zInviteMemberReq, req.body, reply, 'بيانات غير صالحة')
    if (data === undefined) return data
    const email = data.email.trim().toLowerCase()
    const invitedUser = db.select().from(users).where(eq(users.email, email)).get()
    if (!invitedUser || invitedUser.passwordHash === 'pending') {
      return reply.code(409).send({
        errorAr: 'هذا البريد بلا حساب فعلي — أنشئ له دعوة برابط من «دعوة زميل» ليضع كلمة مروره',
      })
    }
    const existing = db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, invitedUser.id)))
      .get()
    if (existing) {
      return reply.code(400).send({ errorAr: 'هذا العضو موجود بالفعل في الفريق' })
    }
    db.insert(workspaceMembers)
      .values({
        workspaceId,
        userId: invitedUser.id,
        role: normalizeRole(data.role),
        department: data.department ?? '',
      })
      .run()
    return {
      id: invitedUser.id,
      email: invitedUser.email,
      role: normalizeRole(data.role),
      department: data.department ?? '',
      joinedAt: invitedUser.createdAt,
      pending: false,
      guideCount: 0,
      teamId: null,
      teamName: null,
    }
  })

  app.patch('/api/team/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id: targetUserId } = req.params as { id: string }
    const workspaceId = getWorkspace(user.id, user.email)

    const blocked = adminBlock(user.id, workspaceId, reply)
    if (blocked) return blocked

    const data = bodyOr400(zUpdateMemberReq, req.body, reply, 'بيانات غير صالحة')
    if (data === undefined) return data

    const targetMember = db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)))
      .get()
    if (!targetMember) return reply.code(404).send({ errorAr: 'العضو غير موجود' })

    const updateData: Partial<{ role: string; department: string; teamId: string | null }> = {}
    if (data.role !== undefined) updateData.role = normalizeRole(data.role)
    if (data.department !== undefined) updateData.department = data.department
    if (data.teamId !== undefined) {
      if (data.teamId === null) {
        updateData.teamId = null
      } else {
        // الفريق لا بد أن يكون من هذه المساحة — لا تجميع عبر المساحات
        const team = db
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.id, data.teamId), eq(teams.workspaceId, workspaceId)))
          .get()
        if (!team) return reply.code(404).send({ errorAr: 'الفريق غير موجود في هذه المساحة' })
        updateData.teamId = team.id
      }
    }

    if (Object.keys(updateData).length > 0) {
      db.update(workspaceMembers)
        .set(updateData)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)))
        .run()
    }

    return rosterOf(workspaceId).find((m) => m.id === targetUserId)!
  })

  /**
   * إزالة عضو مع **نقل ملكية أدلته كلها لمدير المساحة** (خاصة ومنشورة وحتى السلة،
   * ومجلداته تُفرَّغ لجذر المدير) — فلا يبقى دليل يتيم بعد رحيله. حسابه باقٍ يدخل
   * فيمساحته الشخصية الفارغة. ممنوع: إزالة النفس، أو مالك المساحة، أو بلا صفة مدير.
   */
  app.delete('/api/team/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id: targetUserId } = req.params as { id: string }
    const workspaceId = getWorkspace(user.id, user.email)

    const blocked = adminBlock(user.id, workspaceId, reply)
    if (blocked) return blocked

    if (user.id === targetUserId) {
      return reply.code(400).send({ errorAr: 'لا يمكنك إزالة نفسك من الفريق' })
    }

    const wsRow = db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
    if (wsRow?.ownerId === targetUserId) {
      return reply.code(400).send({ errorAr: 'مالك المساحة لا يُزال — نقل الملكية قرار مؤسسي آخر' })
    }

    const targetMember = db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)))
      .get()
    if (!targetMember) return reply.code(404).send({ errorAr: 'العضو غير موجود' })

    // نقل الملكية قبل إسقاط العضوية — أدلة المنقول تصير ملك المدير في جذر مكتبته
    db.update(guides)
      .set({ userId: user.id, folderId: null })
      .where(and(eq(guides.workspaceId, workspaceId), eq(guides.userId, targetUserId)))
      .run()
    db.delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)))
      .run()

    return reply.code(204).send()
  })
}
