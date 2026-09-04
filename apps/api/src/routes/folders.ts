import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { folders, guides } from '../db/schema'
import type { Auth } from '../auth/session'
import { zFolderName } from '@dalili/shared'
import { notViewerBlock } from './guides-shared'
import type { Db } from '../db/client'

/**
 * LIB-02 بترقية المرحلة هـ: المجلدات **مساحية** — ما ينشئه عضو يراه الجميع ويديره
 * منشئو+ (التنظيم مشترك لا ملكية خاصة)، والمشاهد يقرأها للفلترة ولا يكتب. الحذف
 * يعيد الأدلة للجذر دائمًا. userId يبقى صانع المجلد للتاريخ، والنطاق workspace_id
 * (ترحيل 0011 لحق مجلدات ما قبل الترقية بمساحات صانعيها).
 */
export function registerFolderRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  function wsOf(userId: string, email: string) {
    return auth.ensurePersonalWorkspace(userId, email).id
  }

  /** WS-03: المشاهد يقرأ المجلدات (فلترة) ولا يُنشئها ولا يحرّرها */
  function requireNotViewer(userId: string, email: string, reply: Parameters<typeof notViewerBlock>[4]) {
    return notViewerBlock(db, wsOf(userId, email), userId, 'المجلدات', reply)
  }

  function folderInWsOr404(workspaceId: string, id: string) {
    return (
      db
        .select()
        .from(folders)
        .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)))
        .get() ?? null
    )
  }

  app.get('/api/folders', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const rows = db
      .select({
        id: folders.id,
        name: folders.name,
        createdAt: folders.createdAt,
        count: sql<number>`count(${guides.id})`,
      })
      .from(folders)
      .leftJoin(guides, and(eq(guides.folderId, folders.id), sql`${guides.deletedAt} IS NULL`))
      .where(eq(folders.workspaceId, wsOf(user.id, user.email)))
      .groupBy(folders.id)
      .all()
    return rows.map((r) => ({ ...r, count: Number(r.count) }))
  })

  app.post('/api/folders', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const blocked = requireNotViewer(user.id, user.email, reply)
    if (blocked) return blocked
    const parsed = zFolderName.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: parsed.error.issues[0]?.message ?? 'اسم غير صالح' })
    }
    const id = nanoid(12)
    const now = new Date().toISOString()
    db.insert(folders)
      .values({ id, userId: user.id, workspaceId: wsOf(user.id, user.email), name: parsed.data.name, createdAt: now })
      .run()
    return { id, name: parsed.data.name, count: 0, createdAt: now }
  })

  app.patch('/api/folders/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const workspaceId = wsOf(user.id, user.email)
    const blocked = requireNotViewer(user.id, user.email, reply)
    if (blocked) return blocked
    const { id } = req.params as { id: string }
    if (!folderInWsOr404(workspaceId, id)) {
      return reply.code(404).send({ errorAr: 'المجلد غير موجود' })
    }
    const parsed = zFolderName.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: parsed.error.issues[0]?.message ?? 'اسم غير صالح' })
    }
    db.update(folders).set({ name: parsed.data.name }).where(eq(folders.id, id)).run()
    const fresh = folderInWsOr404(workspaceId, id)!
    return { id: fresh.id, name: parsed.data.name, createdAt: fresh.createdAt }
  })

  app.delete('/api/folders/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const workspaceId = wsOf(user.id, user.email)
    const blocked = requireNotViewer(user.id, user.email, reply)
    if (blocked) return blocked
    const { id } = req.params as { id: string }
    if (!folderInWsOr404(workspaceId, id)) {
      return reply.code(404).send({ errorAr: 'المجلد غير موجود' })
    }
    // الأدلة داخل المجلد تعود للجذر — لا حذف متسلسل للأدلة أبدًا
    db.update(guides).set({ folderId: null }).where(eq(guides.folderId, id)).run()
    db.delete(folders).where(eq(folders.id, id)).run()
    return reply.code(204).send()
  })
}
