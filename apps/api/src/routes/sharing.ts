import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { shares } from '../db/schema'
import type { Auth } from '../auth/session'
import type { GuideDto } from '@dalili/shared'
import { activeShare } from './guides-shared'
import type { Db } from '../db/client'

/**
 * المشاركة العامة وعَدّاد مشاهداتها — خارج مسارات الأدلة المحتوى (LIB/VIEW).
 * المشاركة للمالك وحده، والقراءة علنًا بلا جلسة، والسلة تحجب الرابط دائمًا.
 */
export function registerSharingRoutes(
  app: FastifyInstance,
  db: Db,
  auth: Auth,
  publicBase: string,
  helpers: { ownedGuideOr404: (userId: string, id: string) => unknown },
) {
  app.post('/api/guides/:id/share', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = helpers.ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    // إعادة المشاركة تولّد رابطًا جديدًا ويبطل القديم
    db.delete(shares).where(eq(shares.guideId, id)).run()
    const token = nanoid(12)
    db.insert(shares)
      .values({ guideId: id, token, createdAt: new Date().toISOString(), revokedAt: null })
      .run()
    return { token, shareUrl: `${publicBase}/s/${token}` }
  })

  app.delete('/api/guides/:id/share', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = helpers.ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    db.update(shares)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(shares.guideId, id))
      .run()
    return { ok: true }
  })

  /** VIEW-06: عدّاد مشاهدات مجمّع مجهول الهوية — رقم واحد يزيد، لا سجلات أفراد */
  app.post('/api/share/:token/view', async (req, reply) => {
    const { token } = req.params as { token: string }
    const hit = activeShare(db, token)
    if (!hit) {
      return reply.code(404).send({ errorAr: 'الرابط غير موجود أو تم سحبه' })
    }
    db.update(shares)
      .set({ views: hit.share.views + 1 })
      .where(eq(shares.guideId, hit.share.guideId))
      .run()
    return reply.code(204).send()
  })

  app.get('/api/share/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const hit = activeShare(db, token)
    if (!hit) {
      return reply.code(404).send({ errorAr: 'الرابط غير موجود أو تم سحبه' })
    }
    return { guide: JSON.parse(hit.guide.data) as GuideDto, sharedAt: hit.share.createdAt }
  })
}
