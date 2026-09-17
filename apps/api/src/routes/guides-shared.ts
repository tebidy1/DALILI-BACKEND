import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import type { GuideDto, GuideSummaryDto, ListGuidesDto, ListGuidesQuery } from '@dalili/shared'
import type { Auth } from '../auth/session'
import { assignments, guides, shares, users } from '../db/schema'
import { assignmentTargetsMe, memberRole, memberTeamId } from '../ws/roles'
import { normalizeFa } from '@dalili/core'
import type { Db } from '../db/client'
import type { FileSigner } from '../lib/file-cap'

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

/** تطبيع الوسم — نفس المعاملة وقت الكتابة والبحث وإلا ضاع الوسم بالتاء المربوطة */
export function normalizeTag(tag: string): string {
  return normalizeFa(tag).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** يقرأ الدليل إن كان مملوكًا للمستخدم فعلًا — 404 للغير (عزل لا يكشف الوجود) */
export function ownedGuideRow(db: Db, userId: string, id: string) {
  return db.select().from(guides).where(and(eq(guides.id, id), eq(guides.userId, userId))).get() ?? null
}

/** رابط مشاركة فعّال → صفّا المشاركة والدليل معًا، أو لا شيء (مسحوب/سلة/مفقود) */
export function activeShare(db: Db, token: string) {
  const share = db.select().from(shares).where(eq(shares.token, token)).get()
  if (!share || share.revokedAt) return null
  const guide = db.select().from(guides).where(eq(guides.id, share.guideId)).get()
  // دليل في السلة لا يُقدَّم للعالم حتى لو نجا صف مشاركته (LIB-06)
  if (!guide || guide.deletedAt) return null
  return { share, guide }
}

/** الرد المقبول من حراسة الدور — شكل Fastify reply دون استيراد كامل */
export type ReplyLike = { code: (n: number) => { send: (b: unknown) => unknown } }

/** WS-03: حراسة الكتابة — المشاهد يقرأ ويعلّق ويتدرب، لا يُنشئ ولا يحرّر (الاسم يحدد الرسالة) */
export function notViewerBlock(db: Db, wsId: string, userId: string, nounAr: string, reply: ReplyLike) {
  if (memberRole(db, wsId, userId) === 'viewer') {
    return reply.code(403).send({ errorAr: `حسابك مشاهد في هذه المساحة — لا يملك إنشاء ${nounAr} أو تحريرها` })
  }
  return null
}

/**
 * دوال الأدلة المشتركة بين مسارات الأدلة ونظرة المكتبة — مصدر واحد للنطاق المساحي
 * والملخص وأعمدة القائمة، فلا تفرّق قائمة عن عدّاد (ب7: مصدر واحد للحقيقة).
 */
export function makeGuideHelpers(db: Db, auth: Auth, publicBase: string, signer: FileSigner) {
  /** يقرأ الدليل إن كان مملوكًا للمستخدم فعلًا — 404 للغير (عزل لا يكشف الوجود) */
  function ownedGuideOr404(userId: string, id: string) {
    return ownedGuideRow(db, userId, id)
  }

  /** WS: مساحة المستخدم الحالية — الشخصية إن لم ينضم لغيرها */
  function myWsId(userId: string, email: string): string {
    return auth.ensurePersonalWorkspace(userId, email).id
  }

  /**
   * WS-02: ما يمكن للعضو رؤيته — ملكه ولو خاصًا، أو منشور مساحته صراحةً.
   * 404 للباقي بصدق (لا تسريب وجود أدلة مساحات أخرى).
   */
  /** ASG: هل يملك هذا العضو إسنادًا حيًّا يمنحه قراءة هذا الدليل؟ (أنا/فريقي/مساحتي) */
  function assignmentGrantsRead(userId: string, wsId: string, guideId: string): boolean {
    const myTeam = memberTeamId(db, wsId, userId) ?? '__none__'
    const hit = db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.workspaceId, wsId),
          eq(assignments.guideId, guideId),
          assignmentTargetsMe(userId, myTeam, wsId),
        ),
      )
      .get()
    return !!hit
  }

  function visibleGuideOr404(userId: string, email: string, id: string) {
    const row = db.select().from(guides).where(eq(guides.id, id)).get() ?? null
    if (!row) return null
    if (row.userId === userId) return row
    const wsId = myWsId(userId, email)
    if (row.workspaceId === wsId && row.visibility === 'workspace') return row
    // ASG: القراءة تتبع الإسناد الممنوح صراحةً — لا تصير الأدلة عامة ولا تدخل قائمة أو بحثًا
    if (row.workspaceId === wsId && assignmentGrantsRead(userId, wsId, id)) return row
    return null
  }

  /** WS-03: حراسة الكتابة — المشاهد يقرأ ويعلّق ويتدرب، لا يُنشئ ولا يحرّر */
  function requireNotViewer(userId: string, email: string, reply: ReplyLike) {
    return notViewerBlock(db, myWsId(userId, email), userId, 'الأدلة', reply)
  }

  function shareInfoFor(guideId: string): { token: string; shareUrl: string; views: number } | null {
    const row = db.select().from(shares).where(eq(shares.guideId, guideId)).get()
    if (!row || row.revokedAt) return null
    return { token: row.token, shareUrl: `${publicBase}/s/${row.token}`, views: row.views }
  }

  /** صف قائمة → ملخص كامل (LIB-01..03 + WS-02/04/05 + مرحلة ب) */
  function summaryOf(r: {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    stepCount: number
    thumbFileId: string | null
    starred: number
    folderId: string | null
    tags: string
    deletedAt: string | null
    shareToken: string | null
    shareRevoked: string | null
    /** GM-05: استعلامات فرعية مجمّعة — لا تفكيك JSON ولا استعلام لكل صف */
    commentCount: number | string | null
    openCommentCount: number | string | null
    openIssueCount: number | string | null
    /** WS-02: الرؤية */
    visibility: string
    /** WS-05: الموقع المشتق */
    site: string
    /** BKL-01: نوع المستند من العمود المشتق — لا فكّ JSON (قانون PERF-05) */
    kind: string
    /** WS-04: بوكمارك المشاهد الحالي */
    bookmarked: number | string | null
    /** المرحلة ب: ملكية العضو الحالي */
    mine: number | string | null
    /** نمط سكرايب: مشاهدات المشاركة وبريد المنشئ */
    views: number | string | null
    ownerEmail: string | null
  }): GuideSummaryDto {
    const shared = !!r.shareToken && !r.shareRevoked && !r.deletedAt
    return {
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      stepCount: r.stepCount,
      kind: r.kind === 'booklet' ? 'booklet' : 'guide',
      thumbFileId: r.thumbFileId ?? undefined,
      // خصوصيّة ٢ب: المصغّرة برابطها الموقَّع — القائمة لا تركّب رابطًا من المعرّف
      ...(r.thumbFileId ? { thumbUrl: signer.original(r.thumbFileId) } : {}),
      starred: !!r.starred,
      folderId: r.folderId,
      tags: parseTags(r.tags),
      deletedAt: r.deletedAt ?? undefined,
      shared,
      shareUrl: shared && r.shareToken ? `${publicBase}/s/${r.shareToken}` : undefined,
      commentCount: Number(r.commentCount ?? 0),
      openCommentCount: Number(r.openCommentCount ?? 0),
      openIssueCount: Number(r.openIssueCount ?? 0),
      visibility: r.visibility === 'workspace' ? 'workspace' : 'private',
      site: r.site,
      bookmarked: Number(r.bookmarked ?? 0) > 0,
      mine: Number(r.mine ?? 0) > 0,
      views: Number(r.views ?? 0),
      ownerEmail: r.ownerEmail ?? '',
    }
  }

  /** أعمدة القائمة — تعتمد على هوية المشاهد لعمودي البوكمارك والملكية (WS-04 + مرحلة ب) */
  const listCols = (viewerId: string) => ({
    id: guides.id,
    title: guides.title,
    createdAt: guides.createdAt,
    updatedAt: guides.updatedAt,
    stepCount: guides.stepCount,
    thumbFileId: guides.thumbFileId,
    starred: guides.starred,
    folderId: guides.folderId,
    tags: guides.tags,
    deletedAt: guides.deletedAt,
    shareToken: shares.token,
    shareRevoked: shares.revokedAt,
    // GM-05: عدّادات التعليقات لشارة المكتبة — الكلي، والأصلية المفتوحة، والمشكلات المفتوحة وحدها
    commentCount: sql<number>`(SELECT count(*) FROM step_comments sc WHERE sc.guide_id = ${guides.id})`,
    openCommentCount: sql<number>`(SELECT count(*) FROM step_comments sc WHERE sc.guide_id = ${guides.id} AND sc.parent_id IS NULL AND sc.resolved = 0)`,
    openIssueCount: sql<number>`(SELECT count(*) FROM step_comments sc WHERE sc.guide_id = ${guides.id} AND sc.parent_id IS NULL AND sc.resolved = 0 AND sc.kind = 'issue')`,
    // WS-02/04/05
    visibility: guides.visibility,
    site: guides.site,
    kind: guides.kind,
    bookmarked: sql<number>`(SELECT count(*) FROM bookmarks b WHERE b.guide_id = ${guides.id} AND b.user_id = ${viewerId})`,
    // المرحلة ب: هل الدليل من إنشاء هذا العضو — تقيد الواجهة بصدق
    mine: sql<number>`(CASE WHEN ${guides.userId} = ${viewerId} THEN 1 ELSE 0 END)`,
    // نمط سكرايب: عمودا «مشاهدات» و«الكاتب» — views من المشاركة وownerEmail بضم جدول المستخدمين
    views: sql<number>`coalesce(${shares.views}, 0)`,
    ownerEmail: users.email,
  })

  /** قائمة الأدلة المساحية بكامل فلاترها (LIB + WS + مرحلة ب) — يستعملها مسار GET /api/guides */
  function runList(user: { id: string; email: string }, q: ListGuidesQuery): ListGuidesDto {
    const { page, limit, sort, order, folder, starred, trash, tag, saved, site, visibility, creator, when } = q
    const wsId = myWsId(user.id, user.email)

    // WS-02: النطاق = مَلكي ولو خاصًا + منشور مساحتي. السلة استثناء: مَلكي وحده.
    const scope = trash
      ? eq(guides.userId, user.id)
      : or(eq(guides.userId, user.id), and(eq(guides.workspaceId, wsId), eq(guides.visibility, 'workspace')))

    // شروط المرشّح كلها بعمود مفهرس/نصي — لا JSON.parse أبدًا (PERF-05)
    const conds = [scope]
    conds.push(trash ? sql`${guides.deletedAt} IS NOT NULL` : sql`${guides.deletedAt} IS NULL`)
    if (folder) conds.push(eq(guides.folderId, folder))
    if (starred) conds.push(eq(guides.starred, 1))
    // الوسوم مخزّنة مطبَّعة (نفس تطبيع الكتابة) — المرشّح يُطبَّع قبل المطابقة وإلا ضاع الوسم بالتاء المربوطة
    if (tag) {
      conds.push(like(guides.tags, `%"${normalizeTag(tag)}"%`))
    }
    // WS-04: المحفوظات — بوكمارك هذا العضو وحده
    if (saved) conds.push(sql`EXISTS(SELECT 1 FROM bookmarks b WHERE b.guide_id = ${guides.id} AND b.user_id = ${user.id})`)
    // WS-05: ترشيح بالموقع المشتق — تطبيع المدخل بنفس قاعدة الاشتقاق
    if (site) {
      const normSite = site.trim().toLowerCase().replace(/^www\./, '')
      conds.push(eq(guides.site, normSite))
    }
    // المرحلة ب (الهوم): الحالة والمنشئ والنافذة الزمنية — على النطاق المساحي نفسه
    if (visibility) conds.push(eq(guides.visibility, visibility))
    if (creator === 'me') conds.push(eq(guides.userId, user.id))
    if (creator === 'others') conds.push(sql`${guides.userId} <> ${user.id}`)
    if (when) {
      const days = when === 'today' ? 1 : when === 'week' ? 7 : 30
      conds.push(sql`${guides.updatedAt} >= ${new Date(Date.now() - days * 86_400_000).toISOString()}`)
    }
    const where = and(...conds)

    const col = sort === 'title' ? guides.title : sort === 'created' ? guides.createdAt : guides.updatedAt
    const dir = order === 'asc' ? asc : desc

    const rows = db
      .select(listCols(user.id))
      .from(guides)
      .leftJoin(shares, eq(shares.guideId, guides.id))
      .leftJoin(users, eq(users.id, guides.userId))
      .where(where)
      .orderBy(dir(col))
      .limit(limit)
      .offset((page - 1) * limit)
      .all()
    const total = Number(
      db.select({ c: sql<number>`count(*)` }).from(guides).leftJoin(shares, eq(shares.guideId, guides.id)).where(where)
        .get()?.c ?? 0,
    )
    return { items: rows.map((r) => summaryOf(r)), total, page, limit }
  }

  /** إعادة قراءة صف قائمة واحدة بعد الكتابة — الملخص الصادق نفسه في كل مسارات التحديث */
  function summaryById(viewerId: string, id: string): GuideSummaryDto {
    const fresh = db
      .select(listCols(viewerId))
      .from(guides)
      .leftJoin(shares, eq(shares.guideId, guides.id))
      .leftJoin(users, eq(users.id, guides.userId))
      .where(eq(guides.id, id))
      .get()
    return summaryOf(fresh!)
  }

  return { ownedGuideOr404, myWsId, visibleGuideOr404, assignmentGrantsRead, requireNotViewer, shareInfoFor, summaryOf, summaryById, listCols, runList }
}

export type GuideHelpers = ReturnType<typeof makeGuideHelpers>
