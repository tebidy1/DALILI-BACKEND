/** تطبيع بحث عربي: تشكيل، همزات، ة/ه، ى/ي، الأرقام الشرقية، حالة اللاتيني */

const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g
const EASTERN_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export function normalizeFa(s: string): string {
  return s
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(EASTERN_DIGITS.indexOf(d)))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function stripPrefixOnce(token: string): string {
  // السوابق المركبة أولًا (وال/بال/كال/فال/لل) ثم المفردة (و/ب/ك/ل) ثم «ال».
  // «ف» المفردة مستثناة عمدًا: تجريدها يفكك «فاتورة/فريق/فهرس» — كلمات جذرية
  // تبدأ بف، بينما ف-السابقة الحقيقية نادرة ومغطاة بالمركبة «فال».
  const composites = ['وال', 'بال', 'كال', 'فال', 'لل']
  for (const p of composites) {
    if (token.startsWith(p) && token.length - p.length >= 3) return token.slice(p.length)
  }
  if (/^[وبكل]/.test(token) && token.length - 1 >= 4) return token.slice(1)
  if (token.startsWith('ال') && token.length - 2 >= 3) return token.slice(2)
  return token
}

/**
 * تجريد خفيف للسوابق العربية الملتصقة — رمزًا رمزًا، بتمرير متكرر
 * («وبالمطالبة» → «بالمطالبه» → «مطالبه»). يتوقف فورًا حين لا يعد ما يُجرَّد بشروطه.
 * لا تُجرَّد أي لاحقة إطلاقًا (ات/ون/ين/ها…): المطابقات الكاذبة أسوأ من عدم المطابقة.
 * يحافظ دائمًا على عدد الرموز (ثابتة سلامة التظليل).
 */
export function lightStem(token: string): string {
  let t = token
  for (;;) {
    const next = stripPrefixOnce(t)
    if (next === t) return t
    t = next
  }
}

/** تطبيع كامل للاستعلام والفهرسة: normalizeFa ثم تجريد السوابق لكل رمز */
export function normalizeForIndex(s: string): string {
  const n = normalizeFa(s)
  if (!n) return ''
  return n
    .split(' ')
    .map((tok) => lightStem(tok))
    .join(' ')
}

/**
 * مقتطف مظلَّل من النص الأصلي حول أول رمز مطابق.
 * المطابقة على الرموز المطبَّعة المجردة (normalizeForIndex) والعرض على النص الخام —
 * خريطة 1:1 مضمونة بثابتة عدد الرموز. الخروج HTML آمن: كل شيء مهروب إلا <mark>.
 */
export function highlightSnippet(
  rawText: string,
  query: string,
  maxTokens = 18,
): string {
  const esc = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const rawTokens = rawText.trim().split(/\s+/).filter(Boolean)
  const needles = new Set(
    normalizeForIndex(query)
      .split(' ')
      .filter(Boolean),
  )
  if (rawTokens.length === 0 || needles.size === 0) return esc(rawText)

  const normTokens = normalizeForIndex(rawText).split(' ')
  let firstHit = -1
  for (let i = 0; i < Math.min(rawTokens.length, normTokens.length); i++) {
    if (needles.has(normTokens[i]!)) {
      firstHit = i
      break
    }
  }
  const start = firstHit < 0 ? 0 : Math.max(0, firstHit - 4)
  const end = Math.min(rawTokens.length, start + maxTokens)
  const parts: string[] = []
  if (start > 0) parts.push('…')
  for (let i = start; i < end; i++) {
    const isHit = i < normTokens.length && needles.has(normTokens[i]!)
    parts.push(isHit ? `<mark>${esc(rawTokens[i]!)}</mark>` : esc(rawTokens[i]!))
  }
  if (end < rawTokens.length) parts.push('…')
  return parts.join(' ')
}
