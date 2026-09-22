/** نموذج الدليل المشترك بين الامتداد والويب والخادم — TS نقي بلا DOM أو chrome.* */
import type { AudioPause } from './audio'
import type { AnchorChain } from './anchor'
import type { TargetMark } from './target'
import type { RichText } from './rich-text'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** نقطة بإحداثيات الصورة الطبيعية (بكسل) — لطرفي السهم */
export interface Point {
  x: number
  y: number
}

/**
 * ANNO-01: أنواع الشرح على اللقطة (المرحلة ٢) + EDT-05 إكمال (2026-09-04):
 *  - rect/ellipse/oval: إطار حول منطقة (oval بيضاوي متموّج كأنه مرسوم باليد)
 *  - arrow/curved-arrow: سهم من نقطة لأخرى (المنحني يقوس المسار)
 *  - number: شارة رقم على الصورة تُظهر ترتيب النقر
 *  - text: نص مكتوب على اللقطة (حقل text، موضع rect مركزيًا)
 *  - draw: رسم حر بقلم الحبر (مسار نقاط path)
 */
export type AnnotationType = 'rect' | 'ellipse' | 'oval' | 'arrow' | 'curved-arrow' | 'number' | 'text' | 'draw'

/**
 * تعليق مرسوم على اللقطة بإحداثيات الصورة الطبيعية — يبقى دقيقًا مهما تغيّر مقاس العرض.
 * الأشكال المؤطَّرة تحمل rect، والأسهم تحمل from/to، والرقم يحمل rect (مركزه) وn.
 */
export interface Annotation {
  id: string
  type: AnnotationType
  /** لون خطّي (hex) — الافتراضي أسود الجرافيت */
  color: string
  rect?: Rect
  from?: Point
  to?: Point
  n?: number
  /** EDT-05: نص التعليق المكتوب (type=text) — سقف 80 حرفًا */
  text?: string
  /** EDT-05: مسار الرسم الحر (type=draw) — نقاط بإحداثيات الصورة الطبيعية */
  path?: Point[]
}

export type StepKind = 'click' | 'input' | 'select' | 'toggle' | 'navigate' | 'keypress'

export interface StepTarget {
  /** نص العنصر المنقور (زر/رابط) */
  text?: string
  /** role أو وصف نوع العنصر */
  role?: string
  /** أفضل تسمية حقل (label مرتبط أو aria-label أو placeholder) */
  label?: string
  /** AUTO-01: بطاقة تعريف العنصر — يلتقطها الامتداد وقت التسجيل ويحلّها «دربني» في الصفحة الهدف.
   *  اختيارارية جمعيًا: الأدلة القديمة بلا مرساة تبقى صالحة للتسجيل والعرض. */
  anchor?: AnchorChain
}

export interface ScreenshotMeta {
  fileId: string
  fileUrl?: string
  /** PERF-02: معرّف المصغّرة إن وُلّدت عند الرفع */
  thumbFileId?: string
  /** مستطيلات طمس بإحداثيات الصورة الأصلية (بكسل طبيعي) */
  blurRects: Rect[]
  crop?: Rect
  /** طُمست مناطق حساسة تلقائيًا وقت الالتقاط */
  autoBlurred?: boolean
  /** ANNO-01: شروحات مرسومة فوق اللقطة (أشكال/أسهم/أرقام) — اختيارية جمعيًا، الأدلة القديمة بلا شرح صالحة */
  annotations?: Annotation[]
  /**
   * ANNO-02: إطار تعليم الزر المقصود كبيانات — غيابه يعني لقطة قديمة إطارها مخبوز
   * في البكسل (لا يُرسم فوقها إطار ثانٍ). اختياري جمعيًا.
   */
  mark?: TargetMark
}

export interface MissingScreenshot {
  missing: true
  reason?: string
}

/**
 * BLK-01 + BKL-01: نوع الكتلة غير الملتقطة — غيابه في الخطوة = خطوة عادية (ملتقطة أو يدوية).
 * الثلاثة الأولى للأدلة والكرّاسات معًا، والخمسة بعدها كتل كرّاسة.
 */
export type BlockKind = 'tip' | 'alert' | 'header' | 'text' | 'embed' | 'divider' | 'link' | 'image' | 'video'

/**
 * BKL-01: مرجع حيّ لدليل مضمّن — نخزّن المعرّف فقط فيتبع التضمينُ تحديثاتِ الدليل
 * (النسخة المجمّدة تتقادم صامتة وتخالف قانون الصدق §5.4).
 * expanded=false بطاقة مطوية (الافتراضي عند الإدراج)، true يفرد خطواته داخل الكرّاسة.
 */
export interface GuideEmbed {
  guideId: string
  expanded: boolean
}

/** VOX-09 «ميك الخطوة»: تعليق صوتي مدموج مع الخطوة — سقف 60ث، وpending حتى يكتمل رفعه وتفريغه */
export interface StepVoice {
  fileId?: string
  fileUrl?: string
  durationMs: number
  pending?: boolean
}

/** DTOP-01: مصدر التقاط الخطوة — اتحاد تمييزي مطابق لـStepSourceDto في shared حرفيًّا
 *  (النواة لا تستورد shared؛ الاتساق يُحرس بخبر expectTypeOf في shared/test) */
export type StepSource =
  | { kind: 'web'; url: string; pageTitle: string }
  | {
      kind: 'desktop'
      processName: string
      windowTitle: string
      appId: string
      uiaFramework?: string
      ieMode?: boolean
      url?: string
    }
  | { kind: 'camera'; deviceModel?: string }

export interface Step {
  id: string
  kind: StepKind
  title: string
  note?: string
  /** EDT-13: نص بديل يصف اللقطة لقارئات الشاشة — وصولية لا تجميل */
  alt?: string
  target: StepTarget
  value?: string
  sensitive: boolean
  /** ‏DTOP-01: ثنائية v1 للويب — اختيارية منذ مصادر الديسكتوب/الكاميرا؛ استخدم source أولًا */
  url?: string
  pageTitle?: string
  /** DTOP-01: مصدر الخطوة الصريح — الأدلة القديمة بلا source تُفسَّر ويبًا من الرابطين */
  source?: StepSource
  ts: number
  screenshot?: ScreenshotMeta | MissingScreenshot
  /** BLK-01: نوع كتلة النداء/الهيدر — اختياري جمعيًا؛ غيابه خطوة عادية تُرقَّم */
  block?: BlockKind
  /** BKL-01: محتوى كتلة النص المنسّق (block='text') — اختياري جمعيًا */
  rich?: RichText
  /** BKL-01: الدليل المضمّن (block='embed') — اختياري جمعيًا */
  embed?: GuideEmbed
  /** VOX-09: تعليق صوتي للخطوة — اختياري جمعيًا (الأدلة القديمة بلا تعليق صالحة) */
  voice?: StepVoice
}

/** VOX-01..03: صوت الدليل — ملف webm واحد ومدته ولحظة بدء تسجيله بالساعة المطلقة */
export interface AudioMeta {
  fileId: string
  fileUrl?: string
  /** مدة الصوت بالمللي ثانية بعد خصم فترات الإيقاف (webm المسجَّل بلا ترويسة مدة) */
  durationMs: number
  /** t0: قراءة Date.now() لحظة بدء التسجيل — زمن تشغيل أي خطوة = step.ts − startedAt */
  startedAt: number
  /** فترات الإيقاف المؤقت [من، إلى] بالساعة المطلقة — زمن المحتوى يقفز فوقها */
  pauses?: AudioPause[]
}

export interface Guide {
  id: string
  /** DTOP-01: القراءة تقبل ١ و٢، والكتابة ٢ دائمًا (assembleGuide + بوّابة الخادم) */
  schemaVersion: 1 | 2
  /** BKL-01: نوع المستند — غيابه يعني دليلًا. الأدلة القائمة كلها تعبر بلا ترحيل محتوى. */
  kind?: 'guide' | 'booklet'
  title: string
  description?: string
  locale: 'ar'
  dir: 'rtl'
  createdAt: string
  updatedAt: string
  steps: Step[]
  /** VOX: اختياري جمعي — الأدلة القديمة بلا صوت تبقى صالحة (بلا ترقيم schemaVersion) */
  audio?: AudioMeta
}

export function isMissingScreenshot(s: Step['screenshot'] | undefined): s is MissingScreenshot {
  return !!s && (s as MissingScreenshot).missing === true
}

/** BLK-01: رقم العرض لكل عنصر — الخطوات (بلا block) تتسلسل، والكتل null */
export function stepNumbers(steps: Pick<Step, 'block'>[]): (number | null)[] {
  let n = 0
  return steps.map((s) => (s.block ? null : ++n))
}

/** CAP-17: سقف الدليل الكامل بعد الإضافة — الجلسة الواحدة 200، والدليل يجمع حتى هذا الحد (تكافؤ تانجو) */
export const GUIDE_MAX_STEPS = 1000

/** هل يجوز إضافة هذا العدد من الخطوات لدليل بهذا الحجم؟ قرار نقي بلا I/O */
export function canAppendSteps(existing: number, incoming: number): { ok: true } | { ok: false; reason: string } {
  if (existing + incoming <= GUIDE_MAX_STEPS) return { ok: true }
  return { ok: false, reason: `الدليل بلغ حد ${GUIDE_MAX_STEPS} خطوة — لا يمكن إضافة المزيد` }
}

/** DTOP-01: عنوان «المكان» للخطوة أيًّا كان مصدرها — نافذة التطبيق للديسكتوب وعنوان الصفحة للويب */
export function placeTitleOf(s: { pageTitle?: string; source?: StepSource }): string | undefined {
  if (s.source?.kind === 'desktop') return s.source.windowTitle
  if (s.source?.kind === 'web') return s.source.pageTitle
  if (s.source?.kind === 'camera') return undefined
  return s.pageTitle
}

export function deriveGuideTitle(steps: Array<Pick<Step, 'kind'> & { pageTitle?: string; source?: StepSource }>): string {
  const firstNav = steps.find((s) => s.kind === 'navigate')
  const place = (firstNav && placeTitleOf(firstNav)) ?? (steps[0] && placeTitleOf(steps[0]))
  const clean = place?.replace(/\s+/g, ' ').trim()
  return clean ? `دليل: ${clean.slice(0, 80)}` : 'دليل بلا عنوان'
}
