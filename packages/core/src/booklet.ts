/** BKL-01: قرارات الكرّاسة النقية — سقوف وفهرس ونص فهرسة. بلا DOM ولا I/O. */
import type { Step } from './guide'
import { richToPlain } from './rich-text'

/**
 * سقف صادق يمنع كرّاسة تقتل المتصفح — ٣٠٠ كتلة تكفي أضخم إجراء وتبقى قابلة للعرض،
 * و٣٠ دليلًا مضمّنًا سقف منفصل لأن كل تضمين استعلام دليل كامل عند القراءة العامة.
 */
export const BOOKLET_MAX_BLOCKS = 300
export const BOOKLET_MAX_EMBEDS = 30

export type LimitCheck = { ok: true } | { ok: false; reason: string }

export function canAddBlock(existing: number): LimitCheck {
  if (existing < BOOKLET_MAX_BLOCKS) return { ok: true }
  return { ok: false, reason: 'بلغت الكرّاسة حدّها: ٣٠٠ كتلة' }
}

export function canAddEmbed(existing: number): LimitCheck {
  if (existing < BOOKLET_MAX_EMBEDS) return { ok: true }
  return { ok: false, reason: 'بلغت الكرّاسة حدّها: ٣٠ دليلًا مضمّنًا' }
}

/** معرّفات الأدلة المضمّنة بترتيب ظهورها بلا تكرار — يغذّي جلب الخادم وقائمة الفحص */
export function embedIdsOf(steps: Pick<Step, 'block' | 'embed'>[]): string[] {
  const out: string[] = []
  for (const s of steps) {
    if (s.block !== 'embed') continue
    const id = s.embed?.guideId
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

export interface OutlineItem {
  id: string
  title: string
}

/** الفهرس الجانبي — كتل العنوان وحدها، والعنوان الفارغ يسقط بلا بند شبح */
export function bookletOutline(steps: Pick<Step, 'id' | 'block' | 'title'>[]): OutlineItem[] {
  return steps
    .filter((s) => s.block === 'header' && s.title.trim().length > 0)
    .map((s) => ({ id: s.id, title: s.title.trim() }))
}

/** النص القابل للفهرسة من كتل الكرّاسة — العناوين ونص الكتل المنسّقة */
export function bookletText(steps: Pick<Step, 'block' | 'title' | 'rich'>[]): string {
  const parts: string[] = []
  for (const s of steps) {
    if (s.title.trim()) parts.push(s.title.trim())
    if (s.rich?.length) {
      const t = richToPlain(s.rich)
      if (t) parts.push(t)
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
