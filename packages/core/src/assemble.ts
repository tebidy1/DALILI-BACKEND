import { deriveGuideTitle, type Guide, type Step, type StepKind, type StepTarget, type ScreenshotMeta, type MissingScreenshot, type StepVoice } from './guide'
import { stepTitle } from './titles'

function cryptoId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** خطوة خام كما يلتقطه الامتداد قبل التجميع */
export interface RawStep {
  kind: StepKind
  target?: StepTarget
  value?: string
  sensitive?: boolean
  url: string
  pageTitle: string
  ts: number
  note?: string
  /** EDT-13: نص بديل للقطة يمر كما هو إلى الدليل */
  alt?: string
  screenshot?: ScreenshotMeta | MissingScreenshot
  /** VOX-09: تعليق صوتي للخطوة — يمر كما هو إلى الدليل */
  voice?: StepVoice
}

/** تجميع الخطوات الخام في دليل كامل: معرفات، عناوين عربية، عنوان الدليل */
export function assembleGuide(raw: RawStep[], now = Date.now()): Guide {
  const steps: Step[] = raw.map((r) => ({
    id: cryptoId(),
    kind: r.kind,
    title: stepTitle({ kind: r.kind, target: r.target ?? {}, value: r.value, sensitive: r.sensitive ?? false, pageTitle: r.pageTitle }),
    note: r.note,
    alt: r.alt,
    target: r.target ?? {},
    value: r.sensitive ? undefined : r.value,
    sensitive: r.sensitive ?? false,
    url: r.url,
    pageTitle: r.pageTitle,
    ts: r.ts,
    screenshot: r.screenshot,
    voice: r.voice,
  }))
  const nowIso = new Date(now).toISOString()
  return {
    id: cryptoId(),
    schemaVersion: 1,
    title: deriveGuideTitle(steps),
    locale: 'ar',
    dir: 'rtl',
    createdAt: nowIso,
    updatedAt: nowIso,
    steps,
  }
}
