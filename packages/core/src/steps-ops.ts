import type { Step } from './guide'
import { parseLooseUrl } from './host-url'

/**
 * EDT-06 الدمج + EDT-07 استبدال الروابط — عمليات خطوات نقية بلا اعتمادات.
 * الدمج: خطوتان متجاورتان تصيران خطوة واحدة (عنوان الأول وصورته، والملاحظتان
 * متسلسلتان بسطر). الاستبدال: تحليل روابط حقيقي بمطابقة مضيف/مسار — لا نصيّ أعمى.
 */

/** خطأ عملية خطوات — رسالته عربية تُعرض للمستخدم كما هي */
class StepsOpError extends Error {}

/**
 * يدمج الخطوة ذات المعرف المحدد مع تاليتها المباشرة في خطوة واحدة:
 * معرف الأول وعنوانه ولقطته ووقته تبقى، والملاحظتان تتسلسلان بسطر،
 * وصوت الثانية يُتبنى إن كانت الأولى بلا تعليق. غير المتجاورين يُرفض.
 */
export function mergeSteps(steps: Step[], firstId: string): Step[] {
  const i = steps.findIndex((s) => s.id === firstId)
  if (i < 0 || i + 1 >= steps.length) {
    throw new StepsOpError('اختر خطتين متجاورتين للدمج')
  }
  const first = steps[i]!
  const second = steps[i + 1]!
  const notes = [first.note?.trim(), second.note?.trim()].filter((n) => n)
  const merged: Step = {
    ...first,
    note: notes.length > 0 ? notes.join('\n') : undefined,
    voice: first.voice ?? second.voice,
  }
  return [...steps.slice(0, i), merged, ...steps.slice(i + 2)]
}

interface ParsedUrlish {
  host: string
  path: string
}

/** تحليل رابط أو مضيف مجرد — يقبل «erp.x.com» و«https://erp.x.com/p» معًا */
function parseUrlish(raw: string): ParsedUrlish | null {
  return parseLooseUrl(raw, { trimTrailingSlash: true })
}

/**
 * يستبدل بادئة رابط (مضيف + مسار) بأخرى في كل خطوة تطابقها تحليلًا لا نصًّا:
 * المضيف يجب أن يساوي تمامًا (erp-old.com لا تطابق erp.old.com) والمسار بادئة
 * للمسار القديم، والبقية من مسار الخطوة تُلحق بالرابط الجديد مع الحفاظ على الاستعلام.
 */
export function replaceStepUrls(
  steps: Step[],
  from: string,
  to: string,
): { steps: Step[]; changed: number } {
  const fromParsed = parseUrlish(from)
  const toParsed = parseUrlish(to)
  if (!fromParsed || !toParsed || !toParsed.host) return { steps, changed: 0 }
  let changed = 0
  const out = steps.map((s) => {
    const parsed = parseLooseUrl(s.url ?? '')
    if (!parsed) return s
    const pathMatch = parsed.path.startsWith(fromParsed.path)
    if (parsed.host !== fromParsed.host || !pathMatch) return s
    const rest = fromParsed.path === '' ? parsed.path : parsed.path.slice(fromParsed.path.length)
    const next = `${parsed.protocol}//${toParsed.host}${toParsed.path}${rest}${parsed.search}`
    changed++
    return { ...s, url: next }
  })
  return { steps: out, changed }
}
