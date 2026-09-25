/** TRNS-01: جمع نصوص الدليل القابلة للترجمة وتطبيق الترجمة كطبقة تراكب — نقي بلا I/O.
 *  الاستبعادات القانونية (الوثيقة §٢): value (سرًّا كان أم لا)، الصور، المراسي، href (روابط runs). */
import type { GuideDto } from '@dalili/shared'

export interface TranslateItem { id: string; text: string }

export function collectTranslationItems(guide: GuideDto): TranslateItem[] {
  const items: TranslateItem[] = []
  const push = (id: string, text?: string) => {
    const s = (text ?? '').trim()
    if (s) items.push({ id, text: s })
  }
  push('title', guide.title)
  push('description', guide.description)
  for (const st of guide.steps) {
    const p = `steps/${st.id}`
    push(`${p}/title`, st.title)
    push(`${p}/note`, st.note)
    push(`${p}/alt`, st.alt)
    push(`${p}/targetText`, st.target?.text)
    push(`${p}/targetLabel`, st.target?.label)
    push(`${p}/pageTitle`, st.pageTitle)
    st.rich?.forEach((para, pi) =>
      para.runs.forEach((run, ri) => {
        if (run.href) return
        push(`${p}/rich/${pi}/${ri}`, run.text)
      }),
    )
  }
  return items
}

export function applyTranslation(
  guide: GuideDto,
  providerName: string,
  out: Array<{ id: string; text: string }>,
): GuideDto {
  const items: Record<string, string> = {}
  for (const { id, text } of out) {
    const t = text.trim()
    if (t) items[id] = t
  }
  const en = {
    title: items['title'] ?? guide.title,
    description: items['description'] ?? guide.description,
    items,
    meta: { provider: providerName, createdAt: new Date().toISOString(), sourceUpdatedAt: guide.updatedAt },
  }
  return { ...guide, translations: { ...(guide.translations ?? {}), en } }
}
