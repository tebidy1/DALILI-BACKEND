import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { guides, stepComments } from '../db/schema'
import type { Auth } from '../auth/session'
import { zCreateComment, zUpdateComment, type StepCommentDto } from '@dalili/shared'
import { bodyOr400 } from '../lib/body-or-400'
import { activeShare, ownedGuideRow } from './guides-shared'
import type { Db } from '../db/client'

/**
 * GM-05: تعليقات على الخطوة — الضيف يعلّق ويردّ عبر رابط المشاركة (بلا حساب،
 * الاسم اختياري)، والمالك يرى ويردّ ويعدّل ويسمّي محلولًا ويحذف من المحرر.
 * العزل كأدلة المشاركة نفسها: الرمز المسحوب والدليل المسلّة = 404 واحدة صادقة.
 */
export function registerCommentRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  function toDto(row: typeof stepComments.$inferSelect): StepCommentDto {
    return {
      id: row.id,
      stepId: row.stepId,
      kind: row.kind === 'issue' ? 'issue' : 'note',
      parentId: row.parentId,
      author: row.author,
      isOwner: !!row.isOwner,
      body: row.body,
      resolved: !!row.resolved,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  function commentsOf(guideId: string): StepCommentDto[] {
    return db
      .select()
      .from(stepComments)
      .where(eq(stepComments.guideId, guideId))
      .orderBy(stepComments.createdAt)
      .all()
      .map(toDto)
  }

  /** إدخال تعليق على مستوى الدليل بعد التحقق — مشترك بين مسار الضيف ومسار المالك */
  function insertComment(
    reply: import('fastify').FastifyReply,
    guideRow: typeof guides.$inferSelect,
    input: { kind: 'issue' | 'note'; body: string; author?: string; parentId?: string },
    isOwner: boolean,
  ) {
    if (input.parentId) {
      const parent = db
        .select()
        .from(stepComments)
        .where(and(eq(stepComments.id, input.parentId), eq(stepComments.guideId, guideRow.id)))
        .get()
      // عمق واحد: الأب يجب أن يكون تعليقًا أصليًا في هذا الدليل
      if (!parent || parent.parentId) {
        return reply.code(400).send({ errorAr: 'التعليق الأصلي غير موجود — رُبما حُذف، علّق كتعليق جديد' })
      }
    }
    const now = new Date().toISOString()
    const inserted = db
      .insert(stepComments)
      .values({
        id: nanoid(10),
        guideId: guideRow.id,
        stepId: '', // سنتينل «بلا خطوة» — التعليقات صارت على مستوى الدليل
        kind: input.kind,
        parentId: input.parentId ?? null,
        author: isOwner ? '' : (input.author ?? ''),
        isOwner: isOwner ? 1 : 0,
        body: input.body,
        resolved: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
    return { comment: toDto(inserted!) }
  }

  // ——— مسار الضيف: برابط المشاركة فقط، بلا حساب ———

  app.get('/api/share/:token/comments', async (req, reply) => {
    const { token } = req.params as { token: string }
    const hit = activeShare(db, token)
    if (!hit) return reply.code(404).send({ errorAr: 'الرابط غير موجود أو تم سحبه' })
    return { comments: commentsOf(hit.guide.id) }
  })

  app.post('/api/share/:token/comments', async (req, reply) => {
    const { token } = req.params as { token: string }
    const data = bodyOr400(zCreateComment, req.body, reply, 'تعليق غير صالح')
    if (data === undefined) return data
    const hit = activeShare(db, token)
    if (!hit) return reply.code(404).send({ errorAr: 'الرابط غير موجود أو تم سحبه' })
    return insertComment(reply, hit.guide, data, false)
  })

  // ——— مسار المالك: من المحرر حيث يردّ ويعدّل ويسمّي محلولًا ———

  app.get('/api/guides/:id/comments', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = ownedGuideRow(db, user.id, id)
    if (!row) return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    return { comments: commentsOf(id) }
  })

  app.post('/api/guides/:id/comments', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const data = bodyOr400(zCreateComment, req.body, reply, 'تعليق غير صالح')
    if (data === undefined) return data
    const row = ownedGuideRow(db, user.id, id)
    if (!row) return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    return insertComment(reply, row, data, true)
  })

  app.patch('/api/guides/:id/comments/:cid', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id, cid } = req.params as { id: string; cid: string }
    const data = bodyOr400(zUpdateComment, req.body, reply, 'تحديث غير صالح')
    if (data === undefined) return data
    const row = ownedGuideRow(db, user.id, id)
    if (!row) return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    const target = db
      .select()
      .from(stepComments)
      .where(and(eq(stepComments.id, cid), eq(stepComments.guideId, id)))
      .get()
    if (!target) return reply.code(404).send({ errorAr: 'التعليق غير موجود' })
    if (data.resolved !== undefined && target.parentId) {
      return reply.code(400).send({ errorAr: 'الوسم محلولًا للنقاش الأصلي لا للرد الواحد' })
    }
    const set: Partial<typeof stepComments.$inferInsert> = { updatedAt: new Date().toISOString() }
    if (data.body !== undefined) set.body = data.body
    if (data.resolved !== undefined) set.resolved = data.resolved ? 1 : 0
    const fresh = db.update(stepComments).set(set).where(eq(stepComments.id, cid)).returning().get()
    return { comment: toDto(fresh!) }
  })

  app.delete('/api/guides/:id/comments/:cid', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id, cid } = req.params as { id: string; cid: string }
    const row = ownedGuideRow(db, user.id, id)
    if (!row) return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    const target = db
      .select()
      .from(stepComments)
      .where(and(eq(stepComments.id, cid), eq(stepComments.guideId, id)))
      .get()
    if (!target) return reply.code(404).send({ errorAr: 'التعليق غير موجود' })
    // حذف الأصل يمحو خيطه كاملًا — الرد بلا أصل عرضه يتيم بلا معنى
    if (!target.parentId) {
      db.delete(stepComments).where(eq(stepComments.parentId, cid)).run()
    }
    db.delete(stepComments).where(eq(stepComments.id, cid)).run()
    return reply.code(204).send()
  })
}
