/**
 * SRCH-06 / قرار ت5: مزوّد التضمين خلف هذا العقد الواحد — محلي اليوم
 * (multilingual-e5-small بلا مفتاح وبلا خروج بيانات)، وسحابي أو محلي آخر
 * للمؤسسة لاحقًا بلا تغيير كود المستدعي.
 */
export interface EmbeddingProvider {
  readonly name: string
  /** تضمين نصوص الأدلة (passages) — بادئة النموذج مسؤولية المزوّد */
  embedPassages(texts: string[]): Promise<Float32Array[]>
  /** تضمين استعلام البحث الواحد — بادئة الاستعلام مسؤولية المزوّد */
  embedQuery(text: string): Promise<Float32Array>
}
