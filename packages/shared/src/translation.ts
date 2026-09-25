/** TRNS-01: قراءة طبقة ترجمة الدليل — نقية، يستهلكها المحرر والعارض وقارئ الإضافة.
 *  السقوط لكل حقل: ما لم يُترجَم يرتد للنص العربي الأصلي (قانون الوثيقة §٣). */
import type { GuideDto, LocaleDto } from './contract'

export type StepTextField = 'title' | 'note' | 'alt' | 'targetText' | 'targetLabel' | 'pageTitle'

export interface TranslationOverlay {
  guideTitle: string
  description?: string
  /** خطوة/حقل ⇒ النص الإنجليزي أو الارتداد للعربية */
  stepText(stepId: string, field: StepTextField, fallback: string): string
  richRun(stepId: string, paraIdx: number, runIdx: number, fallback: string): string
}

export function translationOverlay(guide: GuideDto, locale: LocaleDto): TranslationOverlay | null {
  if (locale !== 'en') return null
  const tx = guide.translations?.en
  if (!tx) return null
  const at = (path: string): string | undefined => {
    const v = tx.items[path]
    return typeof v === 'string' && v.trim() ? v : undefined
  }
  return {
    guideTitle: at('title') ?? guide.title,
    description: at('description') ?? guide.description,
    stepText: (stepId, field, fallback) => at(`steps/${stepId}/${field}`) ?? fallback,
    richRun: (stepId, pi, ri, fallback) => at(`steps/${stepId}/rich/${pi}/${ri}`) ?? fallback,
  }
}

/** القدم: عُدِّل الأصل بعد لحظة توليد الترجمة؟ (ختمان من خادمنا بصيغة ISO واحدة) */
export function translationStale(guide: GuideDto): boolean {
  const tx = guide.translations?.en
  if (!tx) return false
  return guide.updatedAt > tx.meta.createdAt
}
