/**
 * بوابة VOX-04: نسبة أخطاء الكلمات (WER) بين نص مرجعي (ما قاله المالك)
 * وفرضية المزوّد (ما فُرّغ صوتيًا). نقية بلا اعتمادات — تُستخدم في سكربت
 * القياس على أدلة المالك الحقيقية. البوابة الملزمة: ≤0.20 على 10 أدلة.
 */

import { normalizeFa } from './search'

export interface WerDetail {
  sub: number
  del: number
  ins: number
  refWords: number
  /** (sub+del+ins)/refWords — 0 عند مرجع فارغ (لا شيء ليُخطأ فيه) */
  wer: number
}

/** تطبيع خاص بالتفريغ: تطبيع البحث + تجريد الترقيم — مزوّدو STT يضيفونها بلا انتظام.
 *  تجريد فئات الترقيم والرموز حصرًا (لا نفي الحروف): التشكيل فئة Mn والنفي يمزقه بمسافة */
function normalizeStt(s: string): string {
  return normalizeFa(s.replace(/[\p{P}\p{S}\p{C}]/gu, ' '))
    .split(' ')
    .filter(Boolean)
    .join(' ')
}

function words(s: string): string[] {
  const n = normalizeStt(s)
  return n ? n.split(' ') : []
}

/** مسافة ليفنشتاين على الكلمات مع تتبّع عمليات الإبدال/الحذف/الإضافة */
function align(ref: string[], hyp: string[]): WerDetail {
  const m = ref.length
  const n = hyp.length
  // صفّان فقط — المرجع الحي أدلةً قصيرة الكلام، والذاكرة تبقى O(n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  // ops[i][j] = أفضل عدد أخطاء حتى (i,j)؛ نعيد بناء العملية من صفَّي الأعداد
  const dist: number[][] = [Array.from({ length: n + 1 }, (_, j) => j)]
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = cur
    dist.push(cur)
  }
  // رجوع لأصل العمليات: من (m,n) إلى (0,0)
  let i = m
  let j = n
  let sub = 0
  let del = 0
  let ins = 0
  while (i > 0 || j > 0) {
    const cur = dist[i]![j]!
    if (i > 0 && j > 0 && cur === dist[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) sub++
      i--
      j--
    } else if (i > 0 && cur === dist[i - 1]![j]! + 1) {
      del++
      i--
    } else {
      ins++
      j--
    }
  }
  const total = sub + del + ins
  return { sub, del, ins, refWords: m, wer: m === 0 ? 0 : total / m }
}

export function werDetail(reference: string, hypothesis: string): WerDetail {
  return align(words(reference), words(hypothesis))
}

export function wer(reference: string, hypothesis: string): number {
  return werDetail(reference, hypothesis).wer
}
