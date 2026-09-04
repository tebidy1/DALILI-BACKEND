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
      lines.push(`> ${s.screenshot.reason ?? 'لا توجد لقطة لهذه الخطوة'}`, '')
    }
    // الخطوة اليدوية بلا url → لا سطر مصدر كاذب
    if (s.url) lines.push(`الصفحة: ${s.pageTitle} — ${s.url}`, '')
  })
  return lines.join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** مستند HTML قابل للطباعة/PDF — RTL كامل */
export function toPrintableHtml(guide: Guide, urlFor?: (step: Step) => string): string {
  const nums = stepNumbers(guide.steps)
  const steps = guide.steps
    .map((s, i) => {
      // BLK-01: كتل النداء/الهيدر — بلا رقم ولا لقطة
      if (s.block === 'header') return `<h2 class="section">${escapeHtml(s.title)}</h2>`
      if (s.block === 'tip' || s.block === 'alert')
        return `<aside class="callout ${s.block}"><b>${escapeHtml(s.title)}</b>${
          s.note ? ` — ${escapeHtml(s.note)}` : ''
        }</aside>`
      const url = urlFor?.(s)
      const img =
        s.screenshot && !isMissingScreenshot(s.screenshot) && url
          ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(s.title)}">`
          : `<p class="missing">${escapeHtml(isMissingScreenshot(s.screenshot) ? s.screenshot.reason ?? 'لا توجد لقطة لهذه الخطوة' : 'لا توجد لقطة لهذه الخطوة')}</p>`
      // EDT-05: النص المكتوب على اللقطة يُصدَّر مهربًا (لا حقن HTML)
      const texts = stepTexts(s)
        .map((t) => `<span class="onshot">مكتوب على الصورة: ${escapeHtml(t)}</span>`)
        .join('')
      return `<section class="step"><h2>خطوة ${nums[i]}: ${escapeHtml(s.title)}</h2>${
        s.note ? `<p class="note">${escapeHtml(s.note)}</p>` : ''
      }${img}${texts}${s.url ? `<p class="page">${escapeHtml(s.pageTitle)}</p>` : ''}</section>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(guide.title)}</title>
<style>
  body { font-family: 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif; margin: 24px auto; max-width: 760px; color: #1f2937; line-height: 1.7; }
  h1 { font-size: 1.6rem; }
  .step { border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 16px; page-break-inside: avoid; }
  .step h2 { font-size: 1.1rem; margin: 0 0 8px; }
  img { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; }
  .missing { color: #9ca3af; font-style: italic; }
  .page { color: #6b7280; font-size: 0.85rem; }
  .note { background: #f6f5f1; border-radius: 8px; padding: 8px 12px; }
  .callout { border-radius: 8px; padding: 8px 12px; margin: 12px 0; }
  .callout.tip { background: #e0f2fe; border: 1px solid #7dd3fc; }
  .callout.alert { background: #ffedd5; border: 1px solid #fdba74; }
  .section { border: 0; margin-top: 24px; }
</style>
</head>
<body>
<h1>${escapeHtml(guide.title)}</h1>
${guide.description ? `<p class="desc">${escapeHtml(guide.description)}</p>` : ''}
${steps}
</body>
</html>`
}
