import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { zCreateAssignment } from '@dalili/shared'
import { assignments, assignmentProgress, guides, teams, users, workspaceMembers } from '../db/schema'
import { memberRole } from '../ws/roles'
import type { Auth } from '../auth/session'
import type { Db } from '../db/client'

/**
 * ASG (الإسناد): المدير أو المنشئ يُسند دليلًا/كرّاسة لشخص أو فريق أو المساحة كلها.
 * متابعة بالأسماء بلا توقيع رسمي (قرار 2026-09-10). العضوية تُحلّ حيًّا فالموظف الجديد
 * يرث إسنادات «الجميع/فريقه»، والتقدّم كسول (صف عند أول فتح أو «تمّ»). القراءة تتبع
 * الإسناد الممنوح صراحةً — منطقها في guides-shared عبر visibleGuideOr404.
 */

/** يحلّ مستهدَفي هدفٍ إلى أعضاء حاليين (اسم + فريق) — العضوية لحظية لا مجمّدة */
function resolveTargetMembers(db: Db, wsId: string, kind: string, targetId: string) {
  const base = db
    .select({ userId: workspaceMembers.userId, email: users.email, teamName: teams.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .leftJoin(teams, eq(teams.id, workspaceMembers.teamId))
  if (kind === 'user') {
    return base.where(and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, targetId))).all()
  }
  if (kind === 'team') {
    return base.where(and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.teamId, targetId))).all()
  }
  return base.where(eq(workspaceMembers.workspaceId, wsId)).all() // workspace
}

export function registerAssignmentRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  const wsOf = (userId: string, email: string) => auth.ensurePersonalWorkspace(userId, email).id
  const myTeamId = (wsId: string, userId: string) =>
    db
      .select({ teamId: workspaceMembers.teamId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, userId)))
      .get()?.teamId ?? null

  app.post('/api/guides/:id/assign', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id: guideId } = req.params as { id: string }
    const wsId = wsOf(user.id, user.email)
    const role = memberRole(db, wsId, user.id)

    // المشاهد لا يُسنِد (E-ASG-02)
    if (role === 'viewer') {
      return reply.code(403).send({ errorAr: 'المشاهد لا يملك حق الإسناد' })
    }
    // الدليل: مدير المساحة لأي دليل بها، والمنشئ لدليله وحده
    const guide = db.select().from(guides).where(eq(guides.id, guideId)).get()
    const isAdmin = role === 'admin'
    if (!guide || guide.workspaceId !== wsId || (!isAdmin && guide.userId !== user.id)) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const parsed = zCreateAssignment.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: parsed.error.issues[0]?.message ?? 'اختر شخصًا أو فريقًا أو الشركة كلها' })
    }
    const now = new Date().toISOString()
    let created = 0
    for (const target of parsed.data.targets) {
      let targetId = target.id
      if (target.kind === 'workspace') {
        targetId = wsId // لا يُوثق بمعرّف العميل — دائمًا مساحة المُسنِد
      } else if (target.kind === 'team') {
        const team = db
          .select({ id: teams.id })
          .from(teams)
          .where(and(eq(teams.id, target.id), eq(teams.workspaceId, wsId)))
          .get()
        if (!team) return reply.code(404).send({ errorAr: 'تعذّر الإسناد — الهدف لم يعد موجودًا' })
      } else {
        const m = db
          .select({ u: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, target.id), eq(workspaceMembers.workspaceId, wsId)))
          .get()
        if (!m) return reply.code(404).send({ errorAr: 'تعذّر الإسناد — الهدف لم يعد موجودًا' })
      }
      db.insert(assignments)
        .values({
          id: nanoid(12),
          workspaceId: wsId,
          guideId,
          assignerId: user.id,
          targetKind: target.kind,
          targetId,
          note: parsed.data.note ?? '',
          createdAt: now,
        })
        .run()
      created++
    }
    return { created }
  })

  app.get('/api/assigned', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const wsId = wsOf(user.id, user.email)
    const myTeam = myTeamId(wsId, user.id) ?? '__none__'
    const targetMatch = sql`(
      (${assignments.targetKind} = 'user' AND ${assignments.targetId} = ${user.id})
      OR (${assignments.targetKind} = 'team' AND ${assignments.targetId} = ${myTeam})
      OR (${assignments.targetKind} = 'workspace' AND ${assignments.targetId} = ${wsId})
    )`
    const rows = db
      .select({
        assignmentId: assignments.id,
        guideId: guides.id,
        title: guides.title,
        kind: guides.kind,
        site: guides.site,
        stepCount: guides.stepCount,
        note: assignments.note,
        createdAt: assignments.createdAt,
        assignerEmail: users.email,
        openedAt: assignmentProgress.openedAt,
        doneAt: assignmentProgress.doneAt,
      })
      .from(assignments)
      .innerJoin(guides, eq(guides.id, assignments.guideId))
      .leftJoin(users, eq(users.id, assignments.assignerId))
      .leftJoin(
        assignmentProgress,
        and(eq(assignmentProgress.assignmentId, assignments.id), eq(assignmentProgress.userId, user.id)),
      )
      .where(and(eq(assignments.workspaceId, wsId), sql`${guides.deletedAt} IS NULL`, targetMatch))
      .orderBy(sql`${assignments.createdAt} DESC`)
      .all()

    return rows.map((r) => ({
      assignmentId: r.assignmentId,
      guideId: r.guideId,
      title: r.title,
      kind: r.kind === 'booklet' ? 'booklet' : 'guide',
      site: r.site,
      stepCount: r.stepCount,
      assignerEmail: r.assignerEmail ?? '',
      note: r.note,
      createdAt: r.createdAt,
      openedAt: r.openedAt ?? null,
      doneAt: r.doneAt ?? null,
    }))
  })

  app.post('/api/assignments/:id/progress', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id: assignmentId } = req.params as { id: string }
    const wsId = wsOf(user.id, user.email)
    const a = db
      .select()
      .from(assignments)
      .where(and(eq(assignments.id, assignmentId), eq(assignments.workspaceId, wsId)))
      .get()
    if (!a) return reply.code(404).send({ errorAr: 'تعذّر تحديث الحالة — الإسناد لم يعد قائمًا' })

    const myTeam = myTeamId(wsId, user.id) ?? '__none__'
    const targeted =
      (a.targetKind === 'user' && a.targetId === user.id) ||
      (a.targetKind === 'team' && a.targetId === myTeam) ||
      (a.targetKind === 'workspace' && a.targetId === wsId)
    if (!targeted) return reply.code(403).send({ errorAr: 'هذا الدليل لم يعد مُسنَدًا إليك' })

    const body = (req.body ?? {}) as { done?: boolean }
    const now = new Date().toISOString()
    const existing = db
      .select()
      .from(assignmentProgress)
      .where(and(eq(assignmentProgress.assignmentId, assignmentId), eq(assignmentProgress.userId, user.id)))
      .get()
    if (!existing) {
      db.insert(assignmentProgress)
        .values({ assignmentId, userId: user.id, openedAt: now, doneAt: body.done === true ? now : null })
        .run()
    } else {
      const doneAt = body.done === undefined ? existing.doneAt : body.done ? existing.doneAt ?? now : null
      db.update(assignmentProgress)
        .set({ openedAt: existing.openedAt ?? now, doneAt })
        .where(and(eq(assignmentProgress.assignmentId, assignmentId), eq(assignmentProgress.userId, user.id)))
        .run()
    }
    const fresh = db
      .select()
      .from(assignmentProgress)
      .where(and(eq(assignmentProgress.assignmentId, assignmentId), eq(assignmentProgress.userId, user.id)))
      .get()!
    return { openedAt: fresh.openedAt, doneAt: fresh.doneAt ?? null }
  })

  app.delete('/api/assignments/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const wsId = wsOf(user.id, user.email)
    const a = db
      .select()
      .from(assignments)
      .where(and(eq(assignments.id, id), eq(assignments.workspaceId, wsId)))
      .get()
    if (!a) return reply.code(404).send({ errorAr: 'الإسناد غير موجود' })
    if (a.assignerId !== user.id && memberRole(db, wsId, user.id) !== 'admin') {
      return reply.code(403).send({ errorAr: 'لا تملك سحب هذا الإسناد' })
    }
    db.delete(assignmentProgress).where(eq(assignmentProgress.assignmentId, id)).run()
    db.delete(assignments).where(eq(assignments.id, id)).run()
    return reply.code(204).send()
  })

  app.get('/api/guides/:id/assignments', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id: guideId } = req.params as { id: string }
    const wsId = wsOf(user.id, user.email)
    const guide = db.select().from(guides).where(eq(guides.id, guideId)).get()
    const isAdmin = memberRole(db, wsId, user.id) === 'admin'
    if (!guide || guide.workspaceId !== wsId || (!isAdmin && guide.userId !== user.id)) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const rows = db
      .select()
      .from(assignments)
      .where(and(eq(assignments.workspaceId, wsId), eq(assignments.guideId, guideId)))
      .all()

    type Rec = { userId: string; email: string; teamName: string | null; openedAt: string | null; doneAt: string | null }
    const byUser = new Map<string, Rec>()
    const maxDate = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b ?? null)
    for (const a of rows) {
      const members = resolveTargetMembers(db, wsId, a.targetKind, a.targetId)
      const progress = db.select().from(assignmentProgress).where(eq(assignmentProgress.assignmentId, a.id)).all()
      const pByUser = new Map(progress.map((p) => [p.userId, p]))
      for (const m of members) {
        const p = pByUser.get(m.userId)
        const prev = byUser.get(m.userId)
        byUser.set(m.userId, {
          userId: m.userId,
          email: m.email,
          teamName: m.teamName ?? null,
          openedAt: maxDate(prev?.openedAt ?? null, p?.openedAt ?? null),
          doneAt: maxDate(prev?.doneAt ?? null, p?.doneAt ?? null),
        })
      }
    }
    const recipients = [...byUser.values()]
    return {
      recipients,
      recipientCount: recipients.length,
      openedCount: recipients.filter((r) => r.openedAt !== null).length,
      doneCount: recipients.filter((r) => r.doneAt !== null).length,
    }
  })
}
