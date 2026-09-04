import type { StepKind, StepTarget } from './guide'

/** تنظيف نص مستمد من الصفحة: فراغات + قص */
export function cleanText(s: string | undefined, max = 80): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export function truncateValue(s: string, max = 40): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export interface TitleInput {
  kind: StepKind
  target: StepTarget
  value?: string
  sensitive: boolean
  pageTitle?: string
}

/** مولّد العناوين العربي القاعدي — حتمي، بلا شبكة، قابل للاختبار */
export function stepTitle(step: TitleInput): string {
  const text = cleanText(step.target.text, 60)
  const label = cleanText(step.target.label, 60)
  switch (step.kind) {
    case 'click': {
      const t = text ?? label
      return t ? `انقر على «${t}»` : 'انقر على العنصر'
    }
    case 'input': {
      if (step.sensitive) {
        return label ? `في حقل «${label}» أدخل قيمة سرية` : 'أدخل قيمة سرية'
      }
      const v = step.value ? truncateValue(step.value) : undefined
      if (label && v !== undefined) return `في حقل «${label}» أدخل «${v}»`
      if (label) return `في حقل «${label}» أدخل قيمة`
      if (v !== undefined) return `أدخل «${v}»`
      return 'أدخل قيمة في الحقل'
    }
    case 'select': {
      const v = cleanText(step.value, 60)
      if (label && v) return `اختر «${v}» من قائمة «${label}»`
      if (v) return `اختر «${v}»`
      return label ? `اختر قيمة من قائمة «${label}»` : 'اختر قيمة من القائمة'
    }
    case 'toggle': {
      const verb = step.value === 'off' ? 'أوقف' : 'فعّل'
      const t = label ?? text
      return t ? `${verb} «${t}»` : `${verb} الخيار`
    }
    case 'navigate': {
      const p = cleanText(step.pageTitle, 60)
      return p ? `انتقل إلى صفحة «${p}»` : 'انتقل إلى صفحة جديدة'
    }
    case 'keypress': {
      if (step.value === 'Enter') return 'اضغط Enter للتأكيد'
      const k = cleanText(step.value, 20)
      return k ? `اضغط «${k}»` : 'اضغط مفتاحًا'
    }
  }
}
