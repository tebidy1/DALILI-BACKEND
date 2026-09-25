import { eq } from 'drizzle-orm'
import type Database from 'better-sqlite3'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { guides } from '../db/schema'
import type { Auth } from '../auth/session'
import { zTranslateGuideRequest } from '@dalili/shared'
import { parseStoredGuide } from '../lib/guide-v2'
import { signForMember } from '../lib/guide-files'
import type { FileSigner } from '../lib/file-cap'
import type { Db } from '../db/client'
import type { TranslateProvider } from '../translate/provider'
import { applyTranslation, collectTranslationItems } from '../translate/payload'

/** TRNS-01: توليد/تجديد الترجمة الإنجليزية — ملكية حصرًا، الأصل لا يُمس،
 *  ولا updatedAt ولا فهرسة ولا نسخة إصدارات (مشتقّة لا محتوى — الوثيقة §٣/§٥).
 *  البنود المُرسلة للمزوّد من الحقول المعروفة حصرًا: القيم والأسرار والصور مستبعدة أصلاً.
 *  الرد يمر عبر signForMember كي تعود روابط الصور موقَّعة كمسار القراءة تمامًا (بلاغ حيّ 2026-09-25). */
export function registerTranslateRoute(
  app: FastifyInstance,
  db: Db,
  auth: Auth,
  sqlite: Database.Database,
  translate: TranslateProvider | undefined,
  signer: FileSigner,
  helpers: { ownedGuideOr404: (userId: string, id: string) => (typeof guides.$inferSelect) | null },
) {
  app.post('/api/guides/:id/translate', { preHandler: auth.requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = auth.readUser(req)!
    const { id } = req.params as { id: string }
    if (!zTranslateGuideRequest.safeParse(req.body ?? {}).success) {
      return reply.code(400).send({ errorAr: 'طلب ترجمة غير صالح' })
    }
    const row = helpers.ownedGuideOr404(user.id, id)
    if (!row) return reply.code(404).send({ errorAr: 'الدليل غير موجود' })
    if (!translate) {
      return reply.code(503).send({ errorAr: 'خدمة الترجمة غير مضبوطة — أضِف GROQ_API_KEY في إعداد الخادم' })
    }
    const guide = parseStoredGuide(row.data)
    const items = collectTranslationItems(guide)
    if (items.length === 0) {
      return reply.code(400).send({ errorAr: 'لا نص قابل للترجمة في هذا الدليل' })
    }
    try {
      const out = await translate.translate({ items, target: 'en' })
      const updated = applyTranslation(guide, translate.name, out)
      sqlite.transaction(() => {
        db.update(guides).set({ data: JSON.stringify(updated) }).where(eq(guides.id, id)).run()
      })()
      return { guide: signForMember(updated, signer) }
    } catch (err) {
      req.log.error(err)
      return reply.code(502).send({ errorAr: 'تعذّرت الترجمة من مزوّد الذكاء الصناعي — أعد المحاولة لاحقًا' })
    }
  })
}
