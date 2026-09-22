/** تهريب HTML الموحّد داخليًّا — يستورده التصدير والمشاركة والنص المنسّق، ولا يُصدَّر من فهرس الحزمة */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
