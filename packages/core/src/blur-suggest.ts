import type { Rect, Step } from './guide'
import { normalizeUrlHost } from './host-url'

/**
 * EDT-12: الطمس الذكي الدفعي — بعد طمس مستطيل على لقطة، تُقترح الخطوات التي
 * يقع المستطيل النسبي في موضعها نفسه **وعلى مضيف الرابط ذاته**. الصدق قبل
 * الذكاء: ما لا يتطابق الموضع ضمن الهامش لا يُقترح إطلاقًا.
 *
 * المستطيل هنا **نسبي** (كسور من 0 إلى 1 من مقاس اللقطة) فيُعاد مقياسه
 * تلقائيًا لأي لقطة هدف مهما اختلف مقاسها — إعادة المقياس بالتعريف.
 */

/** مستطيل نسبي: كسور من أبعاد اللقطة (0..1) */
export type RelativeRect = Rect

/** نقطة مركز مستطيل */
function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** مضيف رابط خطوة بأحرف صغيرة دون www — أو فراغ لرابط تالف/غائب */
function urlHost(raw: string | undefined): string {
  return normalizeUrlHost(raw)
}

/**
 * يقترح لكل خطوة غير المصدر، ذات مضيف الرابط نفسه، المستطيل النسبي المكافئ
 * حين يقع مركزها المرشَّح ضمن tol من مركز مستطيل المصدر (بالمحورين معًا).
 * مراكز المرشحين (مركز مستطيل الهدف/الطمس القائم نسبةً إلى لقطة كل خطوة —
 * يعرفها المحرر من مقاس اللقطة) تُمرَّر من المستدعي كي تبقى النواة نقية بلا مقاسات.
 * النتيجة بترتيب الخطوات، والمصدر نفسه يُتخطى دائمًا.
 */
export function suggestSimilarBlur(
  steps: Step[],
  sourceIndex: number,
  rect: RelativeRect,
  candidateCenters: Record<number, { x: number; y: number }>,
  tol = 0.12,
): Array<{ index: number; rect: RelativeRect }> {
  const source = steps[sourceIndex]
  if (!source) return []
  const sourceHost = urlHost(source.url)
  if (!sourceHost) return []
  const sc = center(rect)
  const out: Array<{ index: number; rect: RelativeRect }> = []
  steps.forEach((s, i) => {
    if (i === sourceIndex) return
    if (urlHost(s.url) !== sourceHost) return
    const cc = candidateCenters[i]
    if (!cc) return
    if (Math.abs(cc.x - sc.x) <= tol && Math.abs(cc.y - sc.y) <= tol) {
      out.push({ index: i, rect })
    }
  })
  return out
}

/** يضرب المستطيل النسبي في أبعاد اللقطة الهدف فيعطي مستطيلًا مطلقًا بالبكسل */
export function scaleRelativeRect(rel: RelativeRect, size: { w: number; h: number }): Rect {
  return {
    x: Math.round(rel.x * size.w),
    y: Math.round(rel.y * size.h),
    w: Math.round(rel.w * size.w),
    h: Math.round(rel.h * size.h),
  }
}
