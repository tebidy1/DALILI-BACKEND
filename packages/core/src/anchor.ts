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
  push('id', info.id)
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

/** عناصر تُطابَق بنصها — نص المرساة معنى للأزرار والروابط لا لأي فقرة في الصفحة */
export const TEXT_ANCHOR_SEL = [
  'a',
  'button',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
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
