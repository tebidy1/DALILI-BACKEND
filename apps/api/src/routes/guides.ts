import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { bookmarks, folders, guides, shares, stepComments } from '../db/schema'
import type { Auth } from '../auth/session'
import { zAppendSteps, zCreateGuide, zGuideMeta, zListGuidesQuery, type GuideDto } from '@dalili/shared'
import { deleteGuideIndex, indexGuide } from '../search/index'
import { canAppendSteps, embedIdsOf, primarySourceOf } from '@dalili/core'
import { memberRole } from '../ws/roles'
import { embedGuideSafe } from '../embeddings/store'
import type { EmbeddingProvider } from '../embeddings/provider'
import { makeGuideHelpers, normalizeTag, parseTags } from './guides-shared'
import { bodyOr400 } from '../lib/body-or-400'
import { registerTranscribeRoute } from './transcribe'
import { registerSharingRoutes } from './sharing'
import { registerVersionsRoutes } from './guides-versions'
import type { SttProvider } from '../stt/provider'
import type { Db } from '../db/client'
import type { FileSigner } from '../lib/file-cap'
import { publicGuide, signForMember, stripServerUrls, stripStepUrls } from '../lib/guide-files'
import { parseStoredGuide, toV2 } from '../lib/guide-v2'
import type { Idempotency } from '../lib/idempotency'
import type { Derivatives } from '../lib/derivatives'

/** أول لقطة في الدليل — مصغّرة القوائم (PERF-05/02): المصغّرة إن وجدت وإلا الأصل */
function thumbOf(guide: GuideDto): string | null {
  for (const s of guide.steps) {
    if (s.screenshot && 'fileId' in s.screenshot) return s.screenshot.thumbFileId ?? s.screenshot.fileId
  }
  return null
}

export function registerGuideRoutes(
  app: FastifyInstance,
  db: Db,
  auth: Auth,
  publicBase: string,
  sqlite: Database.Database,
  filesDir: string,
  /** خصوصيّة ٢ب: موقِّع روابط الملفّات — كل دليل يخرج بروابط موقَّعة */
  signer: FileSigner,
  /** خصوصيّة ٢ب: مشتقّات الضيف المحروقة — تُولَّد في خيط عامل */
  derivatives: Derivatives,
  /** DTOP-02: إنشاء الدليل المعاد بالمفتاح نفسه يعيد المعرّف نفسه */
  idempotency: Idempotency,
  stt?: SttProvider,
  /** SRCH-06: بعد كل كتابة تُحدَّث بصمة المعنى بأمان تام — فشلها لا يعني شيئًا للكتابة */
  embeddings?: EmbeddingProvider,
) {
  // الدوال المشتركة بمصدر واحد مع نظرة المكتبة — لا تفرّق قائمة عن عدّاد
  const { ownedGuideOr404, visibleGuideOr404, requireNotViewer, shareInfoFor, summaryById, runList } =
    makeGuideHelpers(db, auth, publicBase, signer)

  /** خصوصيّة ٢ب: تعديل دليل مُشارَك يسخّن مشتقّاته في الخلفية — الضيف التالي لا ينتظر الحرق */
  function warmShared(id: string, guide: GuideDto) {
    const live = shareInfoFor(id)
    if (live) void publicGuide(guide, live.token, signer, derivatives.ensure).catch(() => {})
  }

  app.post('/api/guides', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const blocked = requireNotViewer(user.id, user.email, reply)
    if (blocked) return blocked
    const parsed = zCreateGuide.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        errorAr: `دليل غير صالح: ${parsed.error.issues[0]?.path.join('.') ?? ''} — ${parsed.error.issues[0]?.message ?? ''}`,
      })
    }
    // خصوصيّة ٢ب: روابط الملفّات يملكها الخادم — لا يُخزَّن توقيع منتهٍ ولا API_BASE قديم
    // DTOP-01: الكتابة v2 دائمًا — امتداد قديم في البرّيّة يرسل v1 فيُرقّى هنا
    const incoming = toV2(stripServerUrls(parsed.data.guide as GuideDto))
    // DTOP-02: بعد فحص الدليل — دليل فاسد يُرفض دائمًا ولا يحجز مفتاحًا
    const idem = idempotency.begin(req, user.id, 'guides.create')
    if (idem.kind === 'rejected') return reply.code(idem.status).send({ errorAr: idem.errorAr })
    if (idem.kind === 'replay') return reply.code(idem.status).send(idem.body)
    const ws = auth.ensurePersonalWorkspace(user.id, user.email)
    const id = nanoid(12)
    const now = new Date().toISOString()
    const guide: GuideDto = { ...incoming, id, createdAt: now, updatedAt: now }
    // المعاملة الواحدة: البيانات + الأعمدة المشتقة + الفهرس — أو لا شيء (SRCH-00 §4.3)
    // WS-02: كل دليل يبدأ «خاصًا» — النشر للمساحة صريح من meta (قرار المالك 2026-09-03)
    const create = sqlite.transaction(() => {
      db.insert(guides)
        .values({
          id,
          workspaceId: ws.id,
          userId: user.id,
          title: guide.title,
          data: JSON.stringify(guide),
          stepCount: guide.steps.length,
          thumbFileId: thumbOf(guide),
          createdAt: now,
          updatedAt: now,
          site: primarySourceOf(guide.steps),
          // BKL-01: النوع عمودًا مشتقًا — غيابه من العقد يعني دليلًا
          kind: guide.kind ?? 'guide',
        })
        .run()
      indexGuide(sqlite, guide)
      // DTOP-02: الردّ يُثبَّت داخل معاملة الإنشاء — الدليل ومفتاحه معًا أو لا شيء
      if (idem.kind === 'fresh') idempotency.remember(user.id, idem.key, 'guides.create', 200, { id })
    })
    try {
      create()
    } catch (err) {
      if (idem.kind === 'fresh') idempotency.release(user.id, idem.key)
      throw err
    }
    await embedGuideSafe(sqlite, embeddings, guide)
    return { id }
  })

  app.get('/api/guides', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const parsed = zListGuidesQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: 'معاملات قائمة غير صالحة' })
    }
    // كل منطق الفلاتر والنطاق المساحي في المصنع المشترك — القائمة وoverview من مصدر واحد
    return runList(user, parsed.data)
  })

  app.get('/api/guides/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = visibleGuideOr404(user.id, user.email, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    // BKL-01: السلة حقيقة يقولها الخادم — بطاقة الدليل المضمّن لا تخمّنها من غياب صف
    const deletedAt = row.deletedAt ?? undefined
    const guide = parseStoredGuide(row.data)
    // إعدادات المشاركة والتنظيم للمالك وحده — الغير يرى المحتوى فقط
    // خصوصيّة ٢ب: من يرى الدليل يأخذ روابط موقَّعة لصوره — المعرّف وحده لا يفتح شيئًا
    if (row.userId !== user.id) {
      return { guide: signForMember(guide, signer), share: null, deletedAt }
    }
    const share = shareInfoFor(id)
    return {
      guide: signForMember(guide, signer),
      share,
      deletedAt,
      // LIB-03: المحرر يعرض الوسوم ويحررها — بيانات تنظيم بجانب المحتوى
      meta: { starred: !!row.starred, folderId: row.folderId, tags: parseTags(row.tags) },
      // قرار المالك 2026-09-10: بوابة النشر قبل رابط المشاركة
      visibility: row.visibility === 'workspace' ? 'workspace' : 'private',
    }
  })

  app.patch('/api/guides/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const blocked = requireNotViewer(user.id, user.email, reply)
    if (blocked) return blocked
    const { id } = req.params as { id: string }
    const row = ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const parsed = zCreateGuide.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: 'دليل غير صالح بعد التحرير' })
    }
    // BKL-01 (E-BKL-02): الواجهة ترشّح الكرّاسات من منتقي التضمين، لكن الواجهة ليست
    // حارسًا — كرّاسة داخل كرّاسة حالةٌ بلا معنى تُرفض هنا
    for (const embedId of embedIdsOf(parsed.data.guide.steps)) {
      const target = db.select({ kind: guides.kind }).from(guides).where(eq(guides.id, embedId)).get()
      if (target?.kind === 'booklet') {
        return reply.code(400).send({ errorAr: 'لا تُضمّ كرّاسة داخل كرّاسة' })
      }
    }
    const now = new Date().toISOString()
    const guide: GuideDto = { ...toV2(stripServerUrls(parsed.data.guide as GuideDto)), id, createdAt: row.createdAt, updatedAt: now }
    // الفهرسة في نفس معاملة التحرير — أثر التحرير يظهر في البحث فورًا (ب11)
    // الوسوم عمود تنظيمي خارج data — تحرير المحتوى لا يُسقطها من الفهرس
    const tags = parseTags(row.tags)
    sqlite.transaction(() => {
      db.update(guides)
        .set({
          title: guide.title,
          data: JSON.stringify(guide),
          stepCount: guide.steps.length,
          thumbFileId: thumbOf(guide),
          updatedAt: now,
          site: primarySourceOf(guide.steps),
        })
        .where(eq(guides.id, id))
        .run()
      indexGuide(sqlite, guide, tags)
    })()
    await embedGuideSafe(sqlite, embeddings, guide, tags)
    warmShared(id, guide)
    return { ok: true }
  })

  /** LIB-02/03 + WS-02: تحديث بيانات التنظيم (مجلد/نجمة/وسوم) والنشر للمساحة — لا يمس محتوى الدليل.
   * ‏visibility حق المالك أو مدير المساحة — بقية الأعضاء 404 (لا يكشف وجود الدليل) */
  app.patch('/api/guides/:id/meta', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = visibleGuideOr404(user.id, user.email, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const isOwner = row.userId === user.id
    const isAdmin = memberRole(db, row.workspaceId, user.id) === 'admin'
    const data = bodyOr400(zGuideMeta, req.body, reply, 'بيانات تنظيم غير صالحة')
    if (data === undefined) return data
    const { folderId, starred, tags, visibility } = data
    if (visibility !== undefined && !isOwner && !isAdmin) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    if (folderId) {
      const folder = db.select().from(folders).where(eq(folders.id, folderId)).get()
      if (!folder || folder.userId !== user.id) {
        return reply.code(400).send({ errorAr: 'المجلد غير موجود' })
      }
    }
    const set: Partial<typeof guides.$inferInsert> = {}
    // تطبيع الوسوم في مكان واحد قبل التخزين والفهرسة معًا — وإلا تفرّقا فلا تطابق (علة حية: الشرطة/التاء المربوطة)
    if (folderId !== undefined) set.folderId = folderId
    if (starred !== undefined) set.starred = starred ? 1 : 0
    if (visibility !== undefined) set.visibility = visibility
    let normTags: string[] | null = null
    if (tags !== undefined) {
      normTags = tags.map(normalizeTag)
      set.tags = JSON.stringify(normTags)
    }
    if (Object.keys(set).length > 0) set.updatedAt = new Date().toISOString()
    const newTags = normTags ?? parseTags(row.tags)
    sqlite.transaction(() => {
      if (Object.keys(set).length > 0) {
        db.update(guides).set(set).where(eq(guides.id, id)).run()
      }
      // الوسوم تدخل الفهرس وتخرج منه في نفس لحظة تغييرها — كأي نص (LIB-03)
      if (tags !== undefined) {
        indexGuide(sqlite, parseStoredGuide(row.data), newTags)
      }
    })()
    // SRCH-06: تغيّر الوسوم = تغيّرت بصمة المعنى — يُعاد التضمين خارج المعاملة
    if (tags !== undefined) {
      await embedGuideSafe(sqlite, embeddings, parseStoredGuide(row.data), newTags)
    }
    return summaryById(user.id, id)
  })

  /** LIB-04: نسخة «نسخة من …» تهبط في الجذر بلا مشاركة، بنفس الوسوم، وخاصة دائمًا */
  app.post('/api/guides/:id/duplicate', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const blocked = requireNotViewer(user.id, user.email, reply)
    if (blocked) return blocked
    const { id } = req.params as { id: string }
    const row = ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const original = parseStoredGuide(row.data)
    const newId = nanoid(12)
    const now = new Date().toISOString()
    const tags = parseTags(row.tags)
    const copy: GuideDto = { ...original, id: newId, title: `نسخة من ${row.title}`, createdAt: now, updatedAt: now }
    sqlite.transaction(() => {
      db.insert(guides)
        .values({
          id: newId,
          workspaceId: row.workspaceId,
          userId: user.id,
          title: copy.title,
          data: JSON.stringify(copy),
          stepCount: row.stepCount,
          thumbFileId: row.thumbFileId,
          createdAt: now,
          updatedAt: now,
          folderId: null,
          starred: 0,
          tags: row.tags,
          deletedAt: null,
          site: primarySourceOf(copy.steps),
          // BKL-01: نسخة الكرّاسة تبقى كرّاسة
          kind: row.kind,
        })
        .run()
      indexGuide(sqlite, copy, tags)
    })()
    await embedGuideSafe(sqlite, embeddings, copy, tags)
    return { id: newId }
  })

  /**
   * CAP-17: «أضف خطوات» — استئناف الالتقاط على دليل قائم بالإدراج في موضع محدد.
   * السقف الكامل 1000 خطوة (الجلسة الواحدة 200)، والسلة ترفض الإضافة،
   * والفهرس يُعاد في نفس المعاملة فتظهر الخطوات الجديدة في البحث فورًا.
   */
  app.post('/api/guides/:id/steps', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const blocked = requireNotViewer(user.id, user.email, reply)
    if (blocked) return blocked
    const { id } = req.params as { id: string }
    const row = ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const parsed = zAppendSteps.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: `خطوات غير صالحة: ${parsed.error.issues[0]?.message ?? ''}` })
    }
    if (row.deletedAt) {
      return reply.code(400).send({ errorAr: 'الدليل في السلة — استعده أولًا ثم أضف الخطوات' })
    }
    const { insertAt } = parsed.data
    const steps = stripStepUrls(parsed.data.steps)
    const cap = canAppendSteps(row.stepCount, steps.length)
    if (!cap.ok) {
      return reply.code(400).send({ errorAr: cap.reason })
    }
    const current = parseStoredGuide(row.data)
    const at = insertAt ?? current.steps.length
    if (at > current.steps.length) {
      return reply.code(400).send({ errorAr: 'موضع الإدراج خارج نطاق خطوات الدليل' })
    }
    const now = new Date().toISOString()
    // DTOP-01: الخطوات الملحقة من امتداد قديم بلا source تُرقّى مع الدليل
    const guide: GuideDto = toV2({
      ...current,
      steps: [...current.steps.slice(0, at), ...steps, ...current.steps.slice(at)],
      updatedAt: now,
    })
    const tags = parseTags(row.tags)
    sqlite.transaction(() => {
      db.update(guides)
        .set({
          data: JSON.stringify(guide),
          stepCount: guide.steps.length,
          thumbFileId: thumbOf(guide),
          updatedAt: now,
          site: primarySourceOf(guide.steps),
        })
        .where(eq(guides.id, id))
        .run()
      indexGuide(sqlite, guide, tags)
    })()
    await embedGuideSafe(sqlite, embeddings, guide, tags)
    warmShared(id, guide)
    return { id, stepCount: guide.steps.length }
  })

  // VOX-04/05: تفريغ الصوت — مساره المستقل (نفس السلوك حرفًا)
  registerTranscribeRoute(app, db, auth, sqlite, filesDir, stt, embeddings, { ownedGuideOr404 })

  /** LIB-06: الحذف ناعم — سلة 30 يومًا. الإخفاء يوقف المشاركة والفهرس فورًا (لا كذب في البحث) */
  app.delete('/api/guides/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const permanent = (req.query as Record<string, string>).permanent === '1'
    const row = ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    if (permanent || row.deletedAt) {
      // الدليل المحذوف دائمًا يختفي من الفهرس والمشاركات والتعليقات في اللحظة نفسها (ب10)
      sqlite.transaction(() => {
        db.delete(stepComments).where(eq(stepComments.guideId, id)).run()
        db.delete(shares).where(eq(shares.guideId, id)).run()
        db.delete(guides).where(eq(guides.id, id)).run()
        deleteGuideIndex(sqlite, id)
      })()
      return reply.code(204).send()
    }
    const now = new Date().toISOString()
    sqlite.transaction(() => {
      db.update(guides).set({ deletedAt: now }).where(eq(guides.id, id)).run()
      db.delete(shares).where(eq(shares.guideId, id)).run()
      deleteGuideIndex(sqlite, id)
    })()
    return reply.code(204).send()
  })

  /** LIB-06: استعادة من السلة — يعود للقائمة والفهرس والمجلد القديم كما كان */
  app.post('/api/guides/:id/restore', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = ownedGuideOr404(user.id, id)
    if (!row || !row.deletedAt) {
      return reply.code(404).send({ errorAr: 'لا يوجد دليل محذوف بهذا المعرّف' })
    }
    const guide = parseStoredGuide(row.data)
    sqlite.transaction(() => {
      db.update(guides).set({ deletedAt: null }).where(eq(guides.id, id)).run()
      indexGuide(sqlite, guide, parseTags(row.tags))
    })()
    await embedGuideSafe(sqlite, embeddings, guide, parseTags(row.tags))
    return summaryById(user.id, id)
  })

  /** WS-04: بوكمارك العضو — تبديل بمنع النقر المزدوج؛ لكل دليل يمكنه رؤيته */
  app.post('/api/guides/:id/bookmark', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = visibleGuideOr404(user.id, user.email, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const existing = db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.guideId, id), eq(bookmarks.userId, user.id)))
      .get()
    if (existing) {
      db.delete(bookmarks).where(and(eq(bookmarks.guideId, id), eq(bookmarks.userId, user.id))).run()
      return { bookmarked: false }
    }
    db.insert(bookmarks).values({ guideId: id, userId: user.id, createdAt: new Date().toISOString() }).run()
    return { bookmarked: true }
  })

  // المشاركة وعرضها العام — مسارها المستقل (نفس السلوك حرفًا)
  registerSharingRoutes(app, db, auth, publicBase, { ownedGuideOr404, signer, derivatives })

  // VER-01: سجل الإصدارات — POST يلتقط عند «تم» + GET قائمة + GET نسخة (المالك وحده)
  registerVersionsRoutes(app, db, sqlite, auth, { ownedGuideOr404, signer })
}
