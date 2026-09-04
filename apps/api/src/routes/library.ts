import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Auth } from '../auth/session'
import { guides, workspaces } from '../db/schema'
import { memberRole } from '../ws/roles'
import type { Db } from '../db/client'

/**
 * المرحلة ب (الهوم): نظرة المكتبة — نداء واحد يغذي الشريط الجانبي وشريط الإحصاءات
 * وفلتر الموقع. عداداتها على **نفس نطاق قائمة الأدلة** (مَلكي + منشور المساحة،
 * خارج السلة) — لا رقم في الواجهة لا يصححه الخادم بنفس المنطق.
 */
export function registerLibraryRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  app.get('/api/library/overview', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const ws = auth.ensurePersonalWorkspace(user.id, user.email)
    const scope = or(eq(guides.userId, user.id), and(eq(guides.workspaceId, ws.id), eq(guides.visibility, 'workspace')))
    const alive = and(scope, sql`${guides.deletedAt} IS NULL`) as SQL

    const count = (extra?: SQL) =>
      Number(db.select({ c: sql<number>`count(*)` }).from(guides).where(extra ? and(alive, extra) : alive).get()?.c ?? 0)

    const all = count()
    const mine = count(eq(guides.userId, user.id))
    const published = count(and(eq(guides.workspaceId, ws.id), eq(guides.visibility, 'workspace')))
    const saved = count(sql`EXISTS(SELECT 1 FROM bookmarks b WHERE b.guide_id = ${guides.id} AND b.user_id = ${user.id})`)

    // أعلى ٨ مواقع بخيارات الفلتر — ترتيب ثابت (عدد تنازلي ثم الاسم) وإلا رقاقات ترتجف
    const sites = db
      .select({ site: guides.site, count: sql<number>`count(*)` })
      .from(guides)
      .where(and(alive, sql`${guides.site} <> ''`))
      .groupBy(guides.site)
      .orderBy(desc(sql`count(*)`), asc(guides.site))
      .limit(8)
      .all()

    const wsRow = db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ws.id)).get()
    // بعد ensurePersonalWorkspace العضوية واجبة — والاحتياط «منشئ» لأنه أقل منحًا من مدير
    const role = memberRole(db, ws.id, user.id) ?? 'creator'

    return {
      workspaceName: wsRow?.name ?? '',
      myRole: role,
      myEmail: user.email,
      counts: { all, mine, published, saved },
      sites: sites.map((s) => ({ site: s.site, count: Number(s.count) })),
    }
  })
}
