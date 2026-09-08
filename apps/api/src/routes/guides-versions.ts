import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { zGuide } from '@dalili/shared'
import type { Auth } from '../auth/session'
import type { Db } from '../db/client'
import { guideVersions } from '../db/schema'

/**
 * VER-01: سجل إصدارات الدليل — POST يلتقط لقطة عند «تم» بإسقاط تكرار متجاور،
 * GET قائمة ميتاداتا (بلا JSON)، GET نسخة كاملة للعرض.
 *
 * الأمن: المالك وحده على النقاط الثلاث. الغرباء `404` صادق لا `403`
 * (لا يفشي وجود الدليل). دليل في السلة (deletedAt) لا يقبل لقطات جديدة
 * لأن المحرر لا يُفتح عليه أصلًا؛ لكن قائمته وقراءة إصداراته تبقى للمالك.
 */
export function registerVersionsRoutes(
  app: FastifyInstance,
  db: Db,
  sqlite: Database.Database,
  auth: Auth,
  helpers: {
    ownedGuideOr404: (
      userId: string,
      id: string,
    ) => { data: string; title: string; stepCount: number; deletedAt: string | null } | null
  },
) {
  app.post('/api/guides/:id/versions', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = helpers.ownedGuideOr404(user.id, id)
    if (!row || row.deletedAt) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    // إسقاط التكرار المتجاور: آخر لقطة تطابق الحالة الحالية = لا لقطة (204)
    const last = db
      .select({ data: guideVersions.data, title: guideVersions.title })
      .from(guideVersions)
      .where(eq(guideVersions.guideId, id))
      .orderBy(desc(guideVersions.createdAt))
      .limit(1)
      .get()
    if (last && last.data === row.data && last.title === row.title) {
      reply.header('X-Version-Deduped', 'true')
      return reply.code(204).send()
    }
    const vid = nanoid(12)
    const now = new Date().toISOString()
    db.insert(guideVersions)
      .values({
        id: vid,
        guideId: id,
        authorId: user.id,
        title: row.title,
        data: row.data,
        stepCount: row.stepCount,
        createdAt: now,
      })
      .run()
    return reply.code(201).send({
      id: vid,
      createdAt: now,
      authorId: user.id,
      stepCount: row.stepCount,
      title: row.title,
    })
  })

  app.get('/api/guides/:id/versions', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    if (!helpers.ownedGuideOr404(user.id, id)) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const rows = db
      .select({
        id: guideVersions.id,
        createdAt: guideVersions.createdAt,
        authorId: guideVersions.authorId,
        stepCount: guideVersions.stepCount,
        title: guideVersions.title,
      })
      .from(guideVersions)
      .where(eq(guideVersions.guideId, id))
      .orderBy(desc(guideVersions.createdAt))
      .all()
    return { items: rows }
  })

  app.get('/api/guides/:id/versions/:vid', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id, vid } = req.params as { id: string; vid: string }
    if (!helpers.ownedGuideOr404(user.id, id)) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const row = db
      .select()
      .from(guideVersions)
      .where(and(eq(guideVersions.guideId, id), eq(guideVersions.id, vid)))
      .get()
    if (!row) {
      return reply.code(404).send({ errorAr: 'الإصدار غير موجود' })
    }
    const parsed = zGuide.safeParse(JSON.parse(row.data))
    if (!parsed.success) {
      return reply.code(500).send({ errorAr: 'نسخة تالفة في السجل' })
    }
    reply.header('Cache-Control', 'private, max-age=0, must-revalidate')
    // ملاحظة عن sqlite/nanoid: لم نحتج المعامل sqlite في هذه النقطة — تُمرَّر
    // للاتساق مع بقية registerXxxRoutes مستقبلًا (transactional bulk-delete مثلاً)
    void sqlite
    return {
      id: row.id,
      guideId: row.guideId,
      createdAt: row.createdAt,
      authorId: row.authorId,
      guide: parsed.data,
    }
  })
}
