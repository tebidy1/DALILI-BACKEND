import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import { guides } from '../db/schema'
import type { Auth } from '../auth/session'
import { zTranscribeRequest, type GuideDto } from '@dalili/shared'
import { indexGuide } from '../search/index'
import { mergeVoiceTranscript, segmentTranscript, stepAudioMs } from '@dalili/core'
import { embedGuideSafe } from '../embeddings/store'
import type { EmbeddingProvider } from '../embeddings/provider'
import { parseTags } from './guides-shared'
import { parseStoredGuide } from '../lib/guide-v2'
import type { SttProvider } from '../stt/provider'
import type { Db } from '../db/client'

/** SEC: معرّف الملف كما يصدره الخادم (nanoid) — الصيغة الصارمة تُرفض قبل لمس القرص،
 *  فلا يمرّر مُدخل JSON مسارًا إلى قراءة الملفات مهما ضُبطت الحواجز بعدها */
const SERVER_FILE_ID = /^[A-Za-z0-9_-]{8,64}$/

/**
 * VOX-04/05: تفريغ صوت الدليل لكل خطوة — بلا apply يعيد **مقترحات** (زر المحرر)،
 * ومع apply=true (الوضع التلقائي بعد النشر — قرار المالك 2026-08-30) يملأ ملاحظات
 * الخطوات **الفارغة فقط** ويحفظ الدليل وفهرسه في نفس المعاملة، فالكلام قابل للبحث فورًا.
 * اللغة: كشف تلقائي دائمًا — فرض ar هلوس على غير العربي (قرار مقيس 2026-08-30).
 * الأخطاء صادقة عربيًا: لا صوت (400) · لا مفتاح (503) · فشل المزوّد (502).
 */
export function registerTranscribeRoute(
  app: FastifyInstance,
  db: Db,
  auth: Auth,
  sqlite: Database.Database,
  filesDir: string,
  stt: SttProvider | undefined,
  embeddings: EmbeddingProvider | undefined,
  helpers: { ownedGuideOr404: (userId: string, id: string) => (typeof guides.$inferSelect) | null },
) {
  app.post('/api/guides/:id/transcribe', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const parsed = zTranscribeRequest.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: `طلب تفريغ غير صالح: ${parsed.error.issues[0]?.message ?? ''}` })
    }
    const row = helpers.ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    const guide = parseStoredGuide(row.data)
    if (!guide.audio) {
      return reply.code(400).send({ errorAr: 'لا صوت في هذا الدليل — لا شيء لتفريغه' })
    }
    if (!stt) {
      return reply.code(503).send({ errorAr: 'خدمة التفريغ غير مضبوطة — أضِف GROQ_API_KEY في إعداد الخادم' })
    }
    if (!SERVER_FILE_ID.test(guide.audio.fileId)) {
      return reply.code(400).send({ errorAr: 'معرّف الصوت غير صالح' })
    }
    const audioPath = path.join(filesDir, path.basename(guide.audio.fileId))
    if (!audioPath.startsWith(filesDir + path.sep) || !fs.existsSync(audioPath)) {
      return reply.code(400).send({ errorAr: 'ملف الصوت غير موجود على الخادم' })
    }
    let segments
    try {
      const bytes = new Uint8Array(fs.readFileSync(audioPath))
      segments = await stt.transcribe(bytes, { mimeType: 'audio/webm' })
    } catch (err) {
      req.log.error(err)
      return reply.code(502).send({ errorAr: 'تعذّر التفريغ من مزوّد الصوت — أعد المحاولة لاحقًا' })
    }
    const { startedAt, durationMs, pauses } = guide.audio
    const stepTimes = guide.steps.map((s) => stepAudioMs(startedAt, s.ts, durationMs, pauses ?? []))
    const perStep = segmentTranscript(stepTimes, segments)
    const suggestions = guide.steps
      .map((s, i) => ({ stepId: s.id, text: perStep[i] ?? '' }))
      .filter((x) => x.text.length > 0)
    if (!parsed.data.apply) {
      return { suggestions, provider: stt.name }
    }
    // الوضع التطبيقي: الفارغ فقط يُملأ — ما كتبه المالك بيده مقدَّس لا يُداس
    let applied = 0
    guide.steps.forEach((s, i) => {
      const text = perStep[i] ?? ''
      if (text && !s.note) {
        s.note = text
        applied++
      }
    })
    if (applied > 0) {
      const now = new Date().toISOString()
      guide.updatedAt = now
      const tags = parseTags(row.tags)
      sqlite.transaction(() => {
        db.update(guides).set({ data: JSON.stringify(guide), updatedAt: now }).where(eq(guides.id, id)).run()
        indexGuide(sqlite, guide, tags)
      })()
      await embedGuideSafe(sqlite, embeddings, guide, tags)
    }
    return { suggestions, provider: stt.name, applied }
  })

  /**
   * VOX-09 «ميك الخطوة»: تفريغ تعليقات الخطوات — لكل خطوة voice بملف مرفوع:
   * ملفها يُفرَّغ وحده ويُدمج بملاحظتها (فارغة→ملء، مكتوبة→إلحاق بسطر — لا استبدال
   * أبدًا)، والحفظ والفهرس في نفس المعاملة (قانون SRCH-05). voice.pending=false
   * تعلّم المعالجة كي لا يُكرّر الإلحاق، والنتائج لكل خطوة بصدق.
   */
  app.post('/api/guides/:id/transcribe-steps', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    const row = helpers.ownedGuideOr404(user.id, id)
    if (!row) {
      return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    }
    if (!stt) {
      return reply.code(503).send({ errorAr: 'خدمة التفريغ غير مضبوطة — أضِف GROQ_API_KEY في إعداد الخادم' })
    }
    const guide = parseStoredGuide(row.data)
    if (!guide.steps.some((s) => s.voice)) return { results: [] }
    const results: Array<{ stepId: string; ok: boolean; errorAr?: string }> = []
    let processed = 0
    for (const step of guide.steps) {
      const voice = step.voice
      if (!voice) continue
      // التعليق بلا ملف = رفعه فشل — لا يُفقد الصوت ولا يُفرَّغ (شارة معلقة بالمحرر)
      if (!voice.fileId) {
        results.push({ stepId: step.id, ok: false, errorAr: 'لا يوجد ملف صوتي مرفوع لهذا التعليق — أعد رفعه' })
        continue
      }
      // معالج سابقًا (pending=false) — تجاوز صامت كي لا يُكرّر الإلحاق
      if (voice.pending === false) {
        results.push({ stepId: step.id, ok: true })
        continue
      }
      if (!SERVER_FILE_ID.test(voice.fileId)) {
        results.push({ stepId: step.id, ok: false, errorAr: 'معرّف التعليق الصوتي غير صالح' })
        continue
      }
      const audioPath = path.join(filesDir, path.basename(voice.fileId))
      if (!audioPath.startsWith(filesDir + path.sep) || !fs.existsSync(audioPath)) {
        results.push({ stepId: step.id, ok: false, errorAr: 'ملف التعليق الصوتي غير موجود على الخادم' })
        continue
      }
      let segments
      try {
        const bytes = new Uint8Array(fs.readFileSync(audioPath))
        segments = await stt.transcribe(bytes, { mimeType: 'audio/webm' })
      } catch (err) {
        req.log.error(err)
        return reply.code(502).send({ errorAr: 'تعذّر التفريغ من مزوّد الصوت — أعد المحاولة لاحقًا' })
      }
      const text = segments.map((s) => s.text.trim()).filter(Boolean).join(' ')
      step.note = mergeVoiceTranscript(step.note, text)
      voice.pending = false // علامة المعالجة — التفريغ التالي يتجاوز هذه الخطوة
      processed++
      results.push({ stepId: step.id, ok: true })
    }
    if (processed > 0) {
      const now = new Date().toISOString()
      guide.updatedAt = now
      const tags = parseTags(row.tags)
      sqlite.transaction(() => {
        db.update(guides).set({ data: JSON.stringify(guide), updatedAt: now }).where(eq(guides.id, id)).run()
        indexGuide(sqlite, guide, tags)
      })()
      await embedGuideSafe(sqlite, embeddings, guide, tags)
    }
    return { results }
  })
}
