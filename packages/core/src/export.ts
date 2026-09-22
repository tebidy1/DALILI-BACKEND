import { isMissingScreenshot, stepNumbers, type Guide, type Step } from './guide'

/** EDT-05: نصوص الشروحات المكتوبة على لقطة الخطوة — هي وحدها ما ينطق بالتصدير */
function stepTexts(s: Step): string[] {
  const shot = s.screenshot
  if (!shot || isMissingScreenshot(shot)) return []
  return (shot.annotations ?? [])
    .filter((a) => a.type === 'text' && a.text)
    .map((a) => a.text as string)
}

/** تصدير Markdown — الصور بروابط مطلقة إن توفرت دالة الروابط */
export function toMarkdown(guide: Guide, urlFor?: (step: Step) => string): string {
  const lines: string[] = [`# ${guide.title}`, '']
  if (guide.description) {
    lines.push(guide.description, '')
  }
  const nums = stepNumbers(guide.steps)
  guide.steps.forEach((s, i) => {
    // BLK-01: الكتل غير الملتقطة تُرسم بلا رقم خطوة
    if (s.block === 'header') {
      lines.push(`## ${s.title}`, '')
      return
    }
    if (s.block === 'tip' || s.block === 'alert') {
      lines.push(`> **${s.title}:** ${s.note ?? ''}`.trimEnd(), '')
      return
    }
    lines.push(`## خطوة ${nums[i]}: ${s.title}`, '')
    if (s.note) lines.push(s.note, '')
    const url = urlFor?.(s)
    if (s.screenshot && !isMissingScreenshot(s.screenshot) && url) {
      lines.push(`![${s.title}](${url})`, '')
    }
    // EDT-05: النص المكتوب على اللقطة يرافق الصورة في التصدير
    for (const t of stepTexts(s)) lines.push(`> مكتوب على الصورة: ${t}`, '')
    if (isMissingScreenshot(s.screenshot)) {
      lines.push(`> ${missingReasonOf(s)}`, '')
    }
    // الخطوة اليدوية بلا url → لا سطر مصدر كاذب
    if (s.url) lines.push(`الصفحة: ${s.pageTitle} — ${s.url}`, '')
  })
  return lines.join('\n')
}

/** سبب غياب اللقطة في التصدير — سببها المُدخل إن وُجد وإلا النص الافتراضي */
function missingReasonOf(step: Step): string {
  return isMissingScreenshot(step.screenshot)
    ? step.screenshot.reason ?? 'لا توجد لقطة لهذه الخطوة'
    : 'لا توجد لقطة لهذه الخطوة'
}
