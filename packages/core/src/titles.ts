import { placeTitleOf, type StepKind, type StepSource, type StepTarget } from './guide'

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
  /** DTOP-01: مصدر الخطوة — الديسكتوب يعنون بالنافذة */
  source?: StepSource
}

/** حاويات UIA العامّة — لا اسمَ معنويًّا غالبًا (قرار المالك ٣و خيار أ) */
const GENERIC_CONTAINER_ROLES: ReadonlySet<string> = new Set(['Pane', 'Group', 'Window', 'Custom'])

/** عنصر نوعُه حاوية عامّة (أو غائب) واسمُه فارغٌ أو يساوي نوعَه ⇐ لا اسم
 *  حقيقيًّا يُعرَض — الذكاء UIA للاسم/المرساة يبقى كاملًا لغير ذلك */
export function isUnnamedContainer(role: string | undefined, name: string | undefined): boolean {
  const r = role?.trim()
  if (r !== undefined && r !== '' && !GENERIC_CONTAINER_ROLES.has(r)) return false
  const n = name?.trim()
  return !n || n === r
}

/** مولّد العناوين العربي القاعدي — حتمي، بلا شبكة، قابل للاختبار */
export function stepTitle(step: TitleInput): string {
  const rawText = cleanText(step.target.text, 60)
  const rawLabel = cleanText(step.target.label, 60)
  // خيار أ (٣و): الحاوية العامّة بلا اسم حقيقيّ ⇐ نصّ عامّ لا اسم كاذب
  const generic = isUnnamedContainer(step.target.role, rawText ?? rawLabel)
  const text = generic ? undefined : rawText
  const label = generic ? undefined : rawLabel
  switch (step.kind) {
    case 'click': {
      const t = text ?? label
      if (t) return `انقر على «${t}»`
      return generic ? 'انقر هنا' : 'انقر على العنصر'
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
      const p = cleanText(placeTitleOf(step), 60)
      if (step.source?.kind === 'desktop') return p ? `انتقل إلى نافذة «${p}»` : 'انتقل إلى نافذة أخرى'
      return p ? `انتقل إلى صفحة «${p}»` : 'انتقل إلى صفحة جديدة'
    }
    case 'keypress': {
      if (step.value === 'Enter') return 'اضغط Enter للتأكيد'
      const k = cleanText(step.value, 20)
      return k ? `اضغط «${k}»` : 'اضغط مفتاحًا'
    }
  }
}
