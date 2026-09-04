import { z } from 'zod'

/** عقد واجهة API — مصدر الحقيقة الوحيد بين الخادم والامتداد والويب */

export const zRect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
export const zPoint = z.object({ x: z.number(), y: z.number() })

/** ANNO-01: شرح مرسوم على اللقطة — لون + إطار أو طرفا سهم بالإحداثيات الطبيعية.
 * ‏EDT-05 إكمال (2026-09-04): type=text يحمل text إلزاميًا، وtype=draw يحمل path بنقطتين فأكثر */
export const zAnnotation = z
  .object({
    id: z.string().min(1),
    type: z.enum(['rect', 'ellipse', 'oval', 'arrow', 'curved-arrow', 'number', 'text', 'draw']),
    color: z.string().min(1).max(32),
    rect: zRect.optional(),
    from: zPoint.optional(),
    to: zPoint.optional(),
    n: z.number().int().optional(),
    text: z.string().min(1).max(80, 'النص المكتوب 80 حرفًا كحد أقصى').optional(),
    path: z.array(zPoint).max(2_000).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.type === 'text' && !a.text) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'تعليق النص يحتاج نصًا' })
    }
    if (a.type === 'draw' && (!a.path || a.path.length < 2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'الرسم الحر يحتاج مسارًا بنقطتين فأكثر' })
    }
  })

/** ANNO-02: إطار تعليم الهدف — لونه محصور في لوحة الحبر الخماسية (مطابقة INK_COLORS في core) */
export const zTargetMark = z.object({
  rect: zRect,
  color: z.enum(['#ea580c', '#e11d48', '#2563eb', '#16a34a', '#2b2a26']),
  /** طلب المالك 2026-09-04: شكل الإطار — غيابه مستطيل (مطابقة MARK_SHAPES في core).
   *  إضافة اختيارية جمعيًا: الأدلة المنشورة قبل اليوم تعبر العقد كما هي وschemaVersion يبقى ١. */
  shape: z.enum(['rect', 'ellipse']).optional(),
})

export const zScreenshot = z.union([
  z.object({
    fileId: z.string().min(1),
    fileUrl: z.string().optional(),
    /** PERF-02: معرّف المصغّرة (320px ≤30KB) للقوائم — الأصل يبقى للعارض */
    thumbFileId: z.string().optional(),
    blurRects: z.array(zRect).default([]),
    crop: zRect.optional(),
    autoBlurred: z.boolean().optional(),
    /** ANNO-01: شروحات مرسومة — اختيارية جمعيًا (الأدلة القديمة بلا شرح صالحة) */
    annotations: z.array(zAnnotation).max(50).optional(),
    /** ANNO-02: غيابه = لقطة قديمة إطارها مخبوز في البكسل */
    mark: zTargetMark.optional(),
  }),
  z.object({ missing: z.literal(true), reason: z.string().optional() }),
])

export const zStepKind = z.enum(['click', 'input', 'select', 'toggle', 'navigate', 'keypress'])

/** VOX-09: تعليق صوتي لخطوة بعينها — سقف 60 ثانية صادق (سقف التسجيل نفسه) */
export const zStepVoice = z.object({
  fileId: z.string().min(1).optional(),
  fileUrl: z.string().optional(),
  durationMs: z.number().int().min(1).max(60_000),
  pending: z.boolean().optional(),
})

/** AUTO-01: مرشحو مرساة العنصر بترتيب الأولوية — أول فريد يفوز عند الحل في «دربني» */
export const zAnchorCandidate = z.discriminatedUnion('k', [
  z.object({ k: z.literal('id'), v: z.string().min(1).max(200) }),
  z.object({ k: z.literal('testid'), v: z.string().min(1).max(200) }),
  z.object({ k: z.literal('aria'), v: z.string().min(1).max(200) }),
  z.object({ k: z.literal('name'), v: z.string().min(1).max(200) }),
  z.object({ k: z.literal('text'), v: z.string().min(1).max(80) }),
  z.object({ k: z.literal('path'), v: z.string().min(1).max(600) }),
])

export const zStep = z.object({
  id: z.string(),
  kind: zStepKind,
  title: z.string(),
  note: z.string().optional(),
  /** EDT-13: نص بديل للقطة — وصولية */
  alt: z.string().max(300, 'النص البديل 300 حرفًا كحد أقصى').optional(),
  target: z.object({
    text: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
    /** AUTO-01: بطاقة تعريف العنصر — اختيارية جمعيًا (الأدلة القديمة بلا مرساة صالحة) */
    anchor: z.array(zAnchorCandidate).max(6).optional(),
  }),
  value: z.string().optional(),
  sensitive: z.boolean(),
  url: z.string(),
  pageTitle: z.string(),
  ts: z.number(),
  screenshot: zScreenshot.optional(),
  /** BLK-01: نوع كتلة النداء/الهيدر — اختياري جمعي (الأدلة القديمة صالحة) */
  block: z.enum(['tip', 'alert', 'header']).optional(),
  /** VOX-09 «ميك الخطوة»: تعليق صوتي مدموج مع الخطوة — اختياري جمعي (الأدلة القديمة صالحة).
   * ‏pending = الصوت محفوظ محليًا ولم يُرفع/يُفرَّغ بعد (فشل الخدمة لا يفقد الصوت أبدًا) */
  voice: zStepVoice.optional(),
})

export type StepVoiceDto = z.infer<typeof zStepVoice>

/** VOX-01..03: صوت الدليل — webm واحد ومدته ولحظة بدء تسجيله (تجميعي: الأدلة القديمة بلا صوت صالحة) */
export const zAudioMeta = z.object({
  fileId: z.string().min(1),
  fileUrl: z.string().optional(),
  durationMs: z.number().int().min(0),
  startedAt: z.number(),
  /** فترات الإيقاف المؤقت [من، إلى] بالساعة المطلقة — زمن المحتوى يقفز فوقها */
  pauses: z.array(z.tuple([z.number(), z.number()])).optional(),
})

export const zGuide = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  title: z.string(),
  description: z.string().max(2000, 'الوصف لا يتجاوز 2000 حرف').optional(),
  locale: z.literal('ar'),
  dir: z.literal('rtl'),
  createdAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(zStep),
  audio: zAudioMeta.optional(),
})

export type GuideDto = z.infer<typeof zGuide>
export type StepDto = z.infer<typeof zStep>
export type ScreenshotDto = z.infer<typeof zScreenshot>
export type AnnotationDto = z.infer<typeof zAnnotation>
export type TargetMarkDto = z.infer<typeof zTargetMark>
export type AudioMetaDto = z.infer<typeof zAudioMeta>
export type AnchorCandidateDto = z.infer<typeof zAnchorCandidate>

export const zRegister = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  password: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل'),
})
export const zLogin = zRegister

export const zCreateGuide = z.object({ guide: zGuide })

/** CAP-17: إضافة خطوات لدليل قائم — insertAt موضع الإدراج (النهاية افتراضيًا) */
export const zAppendSteps = z.object({
  steps: z.array(zStep).min(1, 'خطوة واحدة على الأقل للإضافة'),
  insertAt: z.number().int().min(0).optional(),
})

export interface MeDto {
  id: string
  email: string
}

export interface GuideSummaryDto {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  stepCount: number
  shared: boolean
  shareUrl?: string
  /** PERF-02: معرّف مصغّرة أول لقطة — القوائم تعرضها لا الأصل؛ PNG بلا مصغّة */
  thumbFileId?: string
  /** LIB-02..03: بيانات تنظيم المكتبة */
  starred: boolean
  folderId: string | null
  tags: string[]
  /** LIB-06: موجود فقط في عرض السلة */
  deletedAt?: string
  /** GM-05: تعليقات الخطوات — الكلي لشارة المكتبة، والمفتوحة تنبّه صاحب الدليل للرد */
  commentCount: number
  openCommentCount: number
  /** WS-02: الرؤية — خاص افتراضيًا و«workspace» بعد نشر صريح يراه أعضاء المساحة */
  visibility: 'private' | 'workspace'
  /** WS-05: موقع الدليل المشتق (مضيف أول خطوة، صغير بلا www) — فارغ إن لا رابط */
  site: string
  /** WS-04: هل علّمه العضو الحالي بوكمارك (لكل عضو بمعزل عن غيره) */
  bookmarked: boolean
  /** المرحلة ب (الهوم): هل هذا الدليل من إنشاء العضو الحالي — تقيد الواجهة بصدق (لا أزرار تحرير لغيره) */
  mine: boolean
  /** نمط سكرايب: عدد مشاهدات رابط المشاركة (٠ لغير المشترك) — عمود «مشاهدات» بالجدول */
  views: number
  /** نمط سكرايب: بريد المنشئ — يُعرض باسم مشتق على البطاقات («قبل ٣ أيام · أحمد») */
  ownerEmail: string
}

export interface ShareInfoDto {
  token: string
  shareUrl: string
  /** VIEW-06: عدّاد مشاهدات مجمّع — يظهر لصاحب الدليل فقط */
  views: number
}

export interface GuideDetailsDto {
  guide: GuideDto
  share: ShareInfoDto | null
  /** LIB-03: بيانات التنظيم للمحرر — الوسوم تُعرض وتُحرَّر من هناك */
  meta?: { starred: boolean; folderId: string | null; tags: string[] }
}

export interface PublicGuideDto {
  guide: GuideDto
  sharedAt: string
}

/** VOX-05: تفريغ الصوت إلى نص — اقتراح نصّي لكل خطوة لها كلام في مقطعها */
export interface TranscribeSuggestionDto {
  stepId: string
  text: string
}

export interface TranscribeResultDto {
  suggestions: TranscribeSuggestionDto[]
  provider: string
  /** وضع التطبيق (قرار المالك 2026-08-30 — تفريغ تلقائي): عدد الملاحظات التي مُلئت فعلًا */
  applied?: number
}

/** VOX-09: نتيجة تفريغ تعليقات الخطوات (ميك الخطوة) — كل خطوة بحالتها بصدق */
export interface TranscribeStepsResultDto {
  results: Array<{ stepId: string; ok: boolean; errorAr?: string }>
}

/** جسم طلب التفريغ — apply=true يملأ ملاحظات الخطوات الفارغة مباشرة (الوضع التلقائي بعد النشر) */
export const zTranscribeRequest = z.object({
  apply: z.boolean().optional().default(false),
})
export type TranscribeRequestDto = z.infer<typeof zTranscribeRequest>

// ——— تنظيم المكتبة (LIB-01..04/06) ———

export const zListGuidesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  sort: z.enum(['updated', 'created', 'title']).default('updated'),
  order: z.enum(['asc', 'desc']).default('desc'),
  folder: z.string().min(1).max(64).optional(),
  starred: z.coerce.boolean().optional(),
  trash: z.coerce.boolean().optional(),
  tag: z.string().min(1).max(30).optional(),
  /** WS-04: المحفوظات (بوكمارك العضو) — منفصلة عن نجمة المنشئ */
  saved: z.coerce.boolean().optional(),
  /** WS-05: ترشيح بموقع الدليل المشتق (مضيف أول خطوة، صغير بلا www) */
  site: z.string().min(1).max(100).optional(),
  /** المرحلة ب (الهوم): ترشيح الحالة — خاص أو منشور للمساحة */
  visibility: z.enum(['private', 'workspace']).optional(),
  /** المرحلة ب (الهوم): ترشيح المنشئ — أنا أو الزملاء */
  creator: z.enum(['me', 'others']).optional(),
  /** المرحلة ب (الهوم): نافذة زمنية على آخر تحديث — الخادم يحسب الحد */
  when: z.enum(['today', 'week', 'month']).optional(),
})

export type ListGuidesQuery = z.infer<typeof zListGuidesQuery>

export type ListGuidesDto = {
  items: GuideSummaryDto[]
  total: number
  page: number
  limit: number
}

/** المرحلة ب (الهوم): نداء واحد يغذي الشريط الجانبي وشريط الإحصاءات وفلتر الموقع */
export interface LibrarySiteCountDto {
  site: string
  count: number
}

export interface LibraryOverviewDto {
  workspaceName: string
  myRole: 'admin' | 'creator' | 'viewer'
  myEmail: string
  counts: {
    /** كل ما يمكن للعضو رؤيته (مَلكي + منشور المساحة) خارج السلة */
    all: number
    mine: number
    published: number
    saved: number
  }
  sites: LibrarySiteCountDto[]
}

/** المرحلة ج (أنشئ بواسطي + التقارير): التقرير المجمّع لأدلة العضو الحيّة — أصفار صادقة ولا شيء غيره */
export interface MineReportDto {
  /** عدد أدلتي خارج السلة */
  total: number
  /** المنشور منها للمساحة صراحةً */
  published: number
  /** إجمالي مشاهدات روابط المشاركة الحية (VIEW-06) */
  views: number
  /** تعليقات أصلية غير محلولة تنتظر ردًا (GM-05) */
  openComments: number
}

export interface FolderDto {
  id: string
  name: string
  count: number
  createdAt: string
}

export const zFolderName = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'اسم المجلد مطلوب')
    .max(60, 'اسم المجلد 60 حرفًا كحد أقصى'),
})

/** تحديث بيانات التنظيم فقط — لا يمس محتوى الدليل (LIB-02/03) */
export const zGuideMeta = z.object({
  folderId: z.string().min(1).max(64).nullable().optional(),
  starred: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10, 'عشرة وسوم كحد أقصى').optional(),
  /** WS-02: النشر للمساحة صريح — «خاص» افتراضيًا بقرار المالك 2026-09-03 */
  visibility: z.enum(['private', 'workspace']).optional(),
})

// ——— تعليقات الخطوات (GM-05) ———

/** تعليق واحد كما يرده الخادم — الضيف بلا هوية والمالك بعلامة صاحب الدليل */
export const zStepComment = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  /** null = تعليق أصلي يفتح خيطًا؛ غيره رد على ذلك الأصل (عمق واحد) */
  parentId: z.string().nullable(),
  author: z.string().max(40),
  isOwner: z.boolean(),
  body: z.string().min(1).max(2000),
  /** وسم الخيط كمحلول — على التعليق الأصلي فقط، يخفيه من عدّاد المفتوحة */
  resolved: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type StepCommentDto = z.infer<typeof zStepComment>

/** إنشاء تعليق: الضيف عبر رابط المشاركة والمالك من المحرر — نفس العقد */
export const zCreateComment = z.object({
  stepId: z.string().min(1),
  body: z.string().trim().min(1, 'التعليق فارغ').max(2000, 'التعليق 2000 حرفًا كحد أقصى'),
  author: z.string().trim().max(40, 'الاسم 40 حرفًا كحد أقصى').optional(),
  parentId: z.string().min(1).optional(),
})
export type CreateCommentDto = z.infer<typeof zCreateComment>

/** تحديث مالك فقط: تعديل النص أو وسم الخيط محلولًا — واحد منهما على الأقل */
export const zUpdateComment = z
  .object({
    body: z.string().trim().min(1, 'التعليق فارغ').max(2000, 'التعليق 2000 حرفًا كحد أقصى').optional(),
    resolved: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.resolved !== undefined, { message: 'لا تغيير مطلوب' })
export type UpdateCommentDto = z.infer<typeof zUpdateComment>

export interface CommentsResponseDto {
  comments: StepCommentDto[]
}

export interface CommentResponseDto {
  comment: StepCommentDto
}

// ——— البحث (SRCH-00..03) ———

export const zSearchQuery = z.object({
  q: z.string().min(1, 'اكتب كلمة واحدة على الأقل للبحث'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  shared: z.coerce.boolean().optional(),
  /** SRCH-02: مرشح المجلد */
  folder: z.string().min(1).max(64).optional(),
  /** SRCH-02: حصر النتائج على نطاق روابطه (مثل erp.example.com) */
  site: z.string().min(1).max(200).optional(),
})

export const zSuggestQuery = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(10).default(8),
})

// ——— الاكتشاف حسب الصفحة (SRCH-04) ———

/** شارة الامتداد: عدد أدلة المالك على نطاق التبويب النشط */
export const zDiscoverQuery = z.object({
  site: z.string().min(3, 'نطاق غير صالح').max(200),
})

export type DiscoverGuideDto = {
  id: string
  title: string
  updatedAt: string
}

export type DiscoverResponseDto = {
  count: number
  guides: DiscoverGuideDto[]
}

export type SearchHitDto = {
  guideId: string
  guideTitle: string
  stepId: string | null
  stepNo: number | null
  field: 'guide_title' | 'step_title' | 'note' | 'page_title' | 'url' | 'tag' | 'transcript'
  snippet: string
  updatedAt: string
  score: number
  /** SRCH-01: مصغّرة الدليل — النتيجة تعرض صورة لا عنوانًا فقط */
  thumbFileId?: string
}

export type SearchResponseDto = {
  hits: SearchHitDto[]
  total: number
  tookMs: number
  query: { raw: string; normalized: string }
  /** SRCH-06: نتائج دلالية على مستوى الدليل — عناوين مرتبة من الأقرب معنىً يختار منها.
   * غيابها مع semanticReason يعني تعذّر البحث الدلالي هذه المرة (نموذج يُحمّل أولًا…) */
  semantic?: SemanticHitDto[]
  /** SRCH-06: سبب عربي صادق عند تعذّر الطبقة الدلالية — لا صمت على الميزة الغائبة */
  semanticReason?: string
}

/** نتيجة دلالية واحدة: دليل كامل لا خطوة — قرار المالك «يختار من قائمة عناوين» */
export type SemanticHitDto = {
  guideId: string
  guideTitle: string
  /** تشابه كوساين 0..1 — للترتيب والعرض الخام، لا يحل محل ترتيب الخادم */
  score: number
  updatedAt: string
  thumbFileId?: string
}

// ——— إدارة الفريق (Team Management) ———

/** أدوار المساحة (WS-03): مدير يدير كل شيء · منشئ يُنشئ وينشر · مشاهد يقرأ ويعلّق ويتدرب.
 * ‏member دور قديم (قبل 0008) يُقبل بالعقد ويُطَّع creator عند الكتابة */
export const zWorkspaceRole = z.enum(['admin', 'creator', 'viewer', 'member'])
export type WorkspaceRole = z.infer<typeof zWorkspaceRole>

export const zMember = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  role: z.string().min(1),
  department: z.string(),
  joinedAt: z.string().optional(),
  /** المرحلة د: عضو بكلمة مرور معلّقة (صفوف القِدَم) — لم يقبل دعوته بعد */
  pending: z.boolean().optional(),
  /** عدد أدلته الحيّة في المساحة — يظهر في تأكيد الإزالة قبل نقل ملكيتها للمدير */
  guideCount: z.number().optional(),
  /** فريقه (ترحيل 0010) — اختياري رغم أنه عمليًّا فريق واحد لكل عضو */
  teamId: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
})
export type MemberDto = z.infer<typeof zMember>

/** المرحلة د (WS-08): فريق المساحة — «القسم» الحر رُقّي إلى كيان (ترحيل 0010) */
export const zTeam = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  memberCount: z.number(),
})
export type TeamDto = z.infer<typeof zTeam>

export const zInviteMemberReq = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  role: zWorkspaceRole.default('member'),
  department: z.string().default(''),
})
export type InviteMemberReq = z.infer<typeof zInviteMemberReq>

export const zUpdateMemberReq = z.object({
  role: zWorkspaceRole.optional(),
  department: z.string().optional(),
  /** المرحلة د: تجميع العضو في فريق المساحة (null = بلا فريق) */
  teamId: z.string().nullable().optional(),
})
export type UpdateMemberReq = z.infer<typeof zUpdateMemberReq>

// ——— دعوات المساحة (WS-01) — رابط يُنسخ ويُرسل واتساب، بلا SMTP ———

/** إنشاء دعوة: الدعوة للغير الموجود حسابه فعليًا (الموجود يُضاف مباشرة من POST /api/team) */
export const zInviteCreateReq = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  role: z.enum(['admin', 'creator', 'viewer']),
})
export type InviteCreateReq = z.infer<typeof zInviteCreateReq>

/** دعوة كما يراها المدير بعد إنشائها — الرابط يُرسل كما هو */
export interface InviteDto {
  id: string
  email: string
  role: 'admin' | 'creator' | 'viewer'
  token: string
  inviteUrl: string
  createdAt: string
  acceptedAt?: string
}

/** ما يراه المدعوّ علنًا قبل القبول (بلا جلسة) */
export interface InviteInfoDto {
  email: string
  role: 'admin' | 'creator' | 'viewer'
  workspaceName: string
  accepted: boolean
  expired: boolean
}

/** القبول: المدعوّ يضع كلمة مرور فيستكمل حسابه المعلق ويدخل بجلسة */
export const zAcceptInviteReq = z.object({
  password: z.string().min(8, 'كلمة المرور 8 أحرف على الأقل'),
})
export type AcceptInviteReq = z.infer<typeof zAcceptInviteReq>

