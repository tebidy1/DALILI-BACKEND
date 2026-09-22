/**
 * BKL-01: النص المنسّق كتمثيل مُهيكل لا HTML — نقي بلا DOM.
 *
 * لماذا مُهيكل لا HTML: الكرّاسة تُشارَك برابط عام يفتحه ضيف بلا حساب. تخزين HTML
 * يعني خطر XSS دائمًا يعتمد على تنظيف هشّ عند كل مسار عرض (عارض · تصدير · نسخ
 * غني · طباعة). التمثيل {para, runs[]} نصٌّ خالص بعلامات، يستحيل أن يحمل سكربتًا
 * بطبيعته، والتحويل لـHTML دالة واحدة مسؤولة عن التهريب وفحص الروابط.
 */

import { escapeHtml as esc } from './escape'

export interface TextRun {
  text: string
  /** عريض */
  b?: boolean
  /** مائل */
  i?: boolean
  /** رابط — يُقصر على http/https عند التحويل */
  href?: string
}

export type ParaKind = 'p' | 'h2' | 'h3' | 'ul' | 'ol'

export interface RichPara {
  para: ParaKind
  runs: TextRun[]
}

export type RichText = RichPara[]

/**
 * الرابط الآمن وحده يمرّ — http/https فقط. أي شيء آخر (javascript:, data:, vbscript:)
 * يسقط ويبقى النص ظاهرًا بلا رابط: الصدق خير من رابط صامت خطر.
 */
function safeHref(href: string | undefined): string | null {
  if (!href) return null
  try {
    const u = new URL(href)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** النص الخام للفهرسة والبحث والمقتطفات — بلا أي علامات */
export function richToPlain(rich: RichText): string {
  return rich
    .map((p) => p.runs.map((r) => r.text).join(' ').trim())
    .filter((s) => s.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** HTML آمن بالبناء: كل نص مهرَّب وكل رابط مفحوص — لا مسار يمرّر HTML من المستخدم */
export function richToHtml(rich: RichText): string {
  return rich
    .map((p) => {
      const runs = p.runs.map((r) => {
        let out = esc(r.text)
        if (r.b) out = `<b>${out}</b>`
        if (r.i) out = `<i>${out}</i>`
        const href = safeHref(r.href)
        if (href) out = `<a href="${esc(href)}" rel="noopener noreferrer nofollow" target="_blank">${out}</a>`
        return out
      })
      if (p.para === 'ul' || p.para === 'ol') {
        return `<${p.para}>${runs.map((r) => `<li>${r}</li>`).join('')}</${p.para}>`
      }
      const tag = p.para === 'h2' ? 'h2' : p.para === 'h3' ? 'h3' : 'p'
      return `<${tag}>${runs.join('')}</${tag}>`
    })
    .join('')
}
