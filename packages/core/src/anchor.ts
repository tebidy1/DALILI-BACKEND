/** بطاقات تعريف الأزرار (AUTO-01) — سلسلة مرشّحين لكل عنصر تُلتقط وقت التسجيل،
 *  ويحلّها وضع التدريب «دربني» في الصفحة الهدف: أول مرشح فريد يفوز.
 *  نقي تمامًا: وصف العنصر DTO يبنيه سكربت المحتوى، والحل يجري فوق واجهة DOM محقونة. */

export type AnchorCandidate =
  | { k: 'id'; v: string }
  | { k: 'testid'; v: string }
  | { k: 'aria'; v: string }
  | { k: 'name'; v: string }
  | { k: 'text'; v: string }
  | { k: 'path'; v: string }

export type AnchorChain = AnchorCandidate[]

/** وصف العنصر كما يستخرجه سكربت المحتوى — بلا أي DOM هنا */
export interface AnchorElInfo {
  tag: string
  id?: string
  /** data-testid */
  testid?: string
  ariaLabel?: string
  /** سمة name للحقول */
  name?: string
  /** نص العنصر المرئي */
  text?: string
  /** مسار nth-of-type كامل من أقرب سلف — يبنيه سكربت المحتوى (الملاذ الأخير) */
  path?: string
}

/** أقصى طول لنص المرساة — أزرار بأوصاف أطول تُطابَق بقصّها بالطريقة نفسها وقت الحل */
const TEXT_CAP = 80

/**
 * معرّفات يولّدها إطار العمل تلقائيًا وتتغيّر بين كل تحميلٍ وآخر — سمّها «متطايرة».
 * علة حقيقية (بلاغ المالك): React `useId` (مثل `_r_6_`، `_r_u0_`) وBase UI
 * (`base-ui-_r_pu_`) كانت تُلتقط كأقوى مرساة (id) وتُحقن في المسار، فعلى صفحة التدريب
 * الطازجة إمّا لا تطابق شيئًا أو — الأسوأ — يُسنِد الإطار المعرّف نفسه لعنصرٍ **آخر**
 * في الموضع نفسه من الشجرة فتطابق «فريدًا» خطأً → تُحاط دائرة الزر الخطأ. الحل:
 * نعامل هذه المعرّفات كأن العنصر بلا id، فتسقط المرساة لإشارات مستقرّة (نص/aria/مسار بنيوي).
 */
const EPHEMERAL_ID_PATTERNS: RegExp[] = [
  /_r_[a-z0-9]+_/i, // React useId مُعقَّم (يشمل المسبوق: base-ui-_r_pu_)
  /:r[a-z0-9]+:/i, // React useId الخام «:r0:» (تضمّنه Radix/Headless أيضًا)
  /^radix-/i, // Radix UI
  /^headlessui-/i, // Headless UI
  /^react-aria-?\d/i, // React Aria
  /^mui-\d/i, // MUI
  /^downshift-\d/i, // Downshift
]

/** هل المعرّف متولَّد متطايرًا (لا يُوثَّق به عبر الجلسات)؟ — نقي، يُستخدم التقاطًا وحلًّا */
export function isEphemeralId(id: string | undefined | null): boolean {
  const v = id?.trim() ?? ''
  if (!v) return false
  return EPHEMERAL_ID_PATTERNS.some((re) => re.test(v))
}

/** هل يحوي المسار مقطع معرّفٍ متطاير (`[id="_r_.._"]`)؟ — لا يُوثَّق به وقت الحل */
function pathHasEphemeralId(path: string): boolean {
  return EPHEMERAL_ID_PATTERNS.some((re) => re.test(path))
}

/** تطبيع النص المرساة — الدالة ذاتها وقت الالتقاط ووقت الحل فلا انزياح بينهما */
export function anchorNormText(s: string): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > TEXT_CAP ? clean.slice(0, TEXT_CAP - 1) + '…' : clean
}

/** بناء سلسلة المرشحين بترتيب الأولوية الملزم: id → testid → aria → name → نص → مسار */
export function buildAnchorChain(info: AnchorElInfo): AnchorChain {
  const chain: AnchorChain = []
  const push = (k: AnchorCandidate['k'], raw: string | undefined, minLen = 1) => {
    const v = raw?.trim() ?? ''
    if (v.length >= minLen) chain.push({ k, v } as AnchorCandidate)
  }
  // المعرّف المتطاير يُسقَط كأن العنصر بلا id — فتبقى المرساة مستقرّة (testid/aria/نص/مسار)
  push('id', isEphemeralId(info.id) ? undefined : info.id)
  push('testid', info.testid)
  push('aria', info.ariaLabel)
  push('name', info.name)
  const text = anchorNormText(info.text ?? '')
  if (text.length >= 2) chain.push({ k: 'text', v: text })
  push('path', info.path)
  return chain
}

/** تهريب قيمة داخل محدّد سمة — علامة الاقتباس والشرطة الخلفية فقط */
function escAttr(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** المحدّد الخام لمرشح (مرشح النص يُعالَج بالترشيح لا بالمحدِّد — انظر TEXT_ANCHOR_SEL) */
export function anchorToSelector(c: AnchorCandidate): string {
  switch (c.k) {
    case 'id':
      return `[id="${escAttr(c.v)}"]`
    case 'testid':
      return `[data-testid="${escAttr(c.v)}"]`
    case 'aria':
      return `[aria-label="${escAttr(c.v)}"]`
    case 'name':
      return `[name="${escAttr(c.v)}"]`
    case 'path':
      return c.v
    case 'text':
      return TEXT_ANCHOR_SEL
  }
}

/**
 * عناصر تُطابَق بنصها — نص المرساة معنى للأزرار والروابط لا لأي فقرة في الصفحة.
 * علة «الخطوة الأخيرة لا تُظهر عنصرًا» (بلاغ المالك): القائمة كانت تُغفل أدوارًا
 * تفاعلية شائعة في القوائم الحديثة — أبرزها `menuitemradio` (اختيار النموذج مثلًا) —
 * فيسقط المرساة النصية الوحيدة المستقرّة لعنصرٍ معرّفه متطاير، فلا يُحل أبدًا. القائمة
 * الآن موحّدة مع أدوار pick.ts التفاعلية التي يُعرّفها نصها المرئي.
 */
export const TEXT_ANCHOR_SEL = [
  'a',
  'button',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="treeitem"]',
  'input[type="submit"]',
  'input[type="button"]',
].join(',')

/** واجهة الحل — DOM محقون فتبقى النواة نقية وقابلة للفحص */
export interface AnchorDom<E> {
  queryAll(sel: string): E[]
  textOf(el: E): string
}

export interface AnchorHit<E> {
  el: E
  /** فهرس المرشح الفائز — للتشخيص: أي بطاقة من السلسلة نجحت */
  via: number
}

/** حلّ المرساة: أول مرشح فريد يفوز؛ الملتبس يُتجاوز؛ لا فريد = لا حل (صدق لا تخمين) */
export function resolveAnchor<E>(chain: AnchorChain, dom: AnchorDom<E>): AnchorHit<E> | null {
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i]
    if (!c) continue
    // حماية الأدلة القديمة: مرشّح مبنيّ على معرّفٍ متطاير قد يطابق عنصرًا خاطئًا «فريدًا» — نتجاوزه
    if (c.k === 'id' && isEphemeralId(c.v)) continue
    if (c.k === 'path' && pathHasEphemeralId(c.v)) continue
    if (c.k === 'text') {
      const matches = dom
        .queryAll(TEXT_ANCHOR_SEL)
        .filter((el) => anchorNormText(dom.textOf(el)) === anchorNormText(c.v))
      if (matches.length === 1 && matches[0] !== undefined) return { el: matches[0], via: i }
      continue
    }
    const matches = dom.queryAll(anchorToSelector(c))
    if (matches.length === 1 && matches[0] !== undefined) return { el: matches[0], via: i }
  }
  return null
}
