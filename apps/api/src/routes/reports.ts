import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Auth } from '../auth/session'
import { guides } from '../db/schema'
import type { Db } from '../db/client'

/**
 * المرحلة ج (أنشئ بواسطي + التقارير): التقرير المجمّع لأدلة العضو — نداء واحد يغذي شريط
 * أعلى الشاشة. العدادات على **نطاق أدلتي الحيّة** (خارج السلة) بمنطق القائمة نفسه:
 * المنشور = نُشر للمساحة صراحةً · المشاهدات = روابط مشاركة حية فقط (VIEW-06 مجمّع مجهول)
 * · تنتظر ردًا = تعليقات أصلية غير محلولة دون الردود (GM-05).
 */
export function registerReportsRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  app.get('/api/reports/mine', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const aliveMine = and(eq(guides.userId, user.id), sql`${guides.deletedAt} IS NULL`) as SQL

    // استعلام مجمّع واحد — العدّادان الفرعيان لا يعتمدان على صفوف الاستعلام الخارجي
    const row = db
      .select({
        total: sql<number>`count(*)`,
        published: sql<number>`coalesce(sum(case when ${guides.visibility} = 'workspace' then 1 else 0 end), 0)`,
        views: sql<number>`coalesce((SELECT sum(s.views) FROM shares s JOIN guides g ON g.id = s.guide_id
                       WHERE g.user_id = ${user.id} AND g.deleted_at IS NULL AND s.revoked_at IS NULL), 0)`,
        openComments: sql<number>`coalesce((SELECT count(*) FROM step_comments sc JOIN guides g ON g.id = sc.guide_id
                              WHERE g.user_id = ${user.id} AND g.deleted_at IS NULL
                                AND sc.parent_id IS NULL AND sc.resolved = 0), 0)`,
        openIssues: sql<number>`coalesce((SELECT count(*) FROM step_comments sc JOIN guides g ON g.id = sc.guide_id
                              WHERE g.user_id = ${user.id} AND g.deleted_at IS NULL
                                AND sc.parent_id IS NULL AND sc.resolved = 0 AND sc.kind = 'issue'), 0)`,
      })
      .from(guides)
      .where(aliveMine)
      .get()

    return {
      total: Number(row?.total ?? 0),
      published: Number(row?.published ?? 0),
      views: Number(row?.views ?? 0),
      openComments: Number(row?.openComments ?? 0),
      openIssues: Number(row?.openIssues ?? 0),
    }
  })
}
