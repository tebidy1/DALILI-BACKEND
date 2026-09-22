import { deriveGuideTitle, type Guide, type Step, type StepKind, type StepSource, type StepTarget, type ScreenshotMeta, type MissingScreenshot, type StepVoice } from './guide'
import { stepTitle } from './titles'

function cryptoId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** خطوة خام كما يلتقطها الامتداد أو تطبيق الديسكتوب قبل التجميع */
export interface RawStep {
  kind: StepKind
  target?: StepTarget
  value?: string
  sensitive?: boolean
  /** الويب (v1): رابط الصفحة وعنوانها — الديسكتوب لا يرسلهما */
  url?: string
  pageTitle?: string
  /** DTOP-01: مصدر صريح — الديسكتوب يرسله دائمًا، والويب يُشتقّ له من url */
  source?: StepSource
  ts: number
  note?: string
  /** EDT-13: نص بديل للقطة يمر كما هو إلى الدليل */
  alt?: string
  screenshot?: ScreenshotMeta | MissingScreenshot
  /** VOX-09: تعليق صوتي للخطوة — يمر كما هو إلى الدليل */
  voice?: StepVoice
}

/** DTOP-01: القاعدة نفسها في migrateGuide — رابط غير فارغ بلا مصدر ⇐ مصدر ويب */
function sourceOf(r: RawStep): StepSource | undefined {
  if (r.source) return r.source
  if (typeof r.url === 'string' && r.url.trim() !== '') return { kind: 'web', url: r.url, pageTitle: r.pageTitle ?? '' }
  return undefined
}

/** تجميع الخطوات الخام في دليل v2 كامل: معرفات، عناوين عربية، عنوان الدليل */
export function assembleGuide(raw: RawStep[], now = Date.now()): Guide {
  const steps: Step[] = raw.map((r) => {
    const source = sourceOf(r)
    return {
      id: cryptoId(),
      kind: r.kind,
      title: stepTitle({ kind: r.kind, target: r.target ?? {}, value: r.value, sensitive: r.sensitive ?? false, pageTitle: r.pageTitle, source }),
      note: r.note,
      alt: r.alt,
      target: r.target ?? {},
      value: r.sensitive ? undefined : r.value,
      sensitive: r.sensitive ?? false,
      url: r.url,
      pageTitle: r.pageTitle,
      ...(source ? { source } : {}),
      ts: r.ts,
      screenshot: r.screenshot,
      voice: r.voice,
    }
  })
  const nowIso = new Date(now).toISOString()
  return {
    id: cryptoId(),
    schemaVersion: 2,
    title: deriveGuideTitle(steps),
    locale: 'ar',
    dir: 'rtl',
    createdAt: nowIso,
    updatedAt: nowIso,
    steps,
  }
}
