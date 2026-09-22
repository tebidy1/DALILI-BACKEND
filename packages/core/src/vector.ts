/** SRCH-06 — رياضيات البحث بالسياق: نقية بلا أي اعتماد (قانون النواة النقية).
 * قرار المالك 2026-09-01: قاعدة متجهات مع ترتيب — النتيجة قائمة عناوين الأدلة
 * الأقرب معنًا يختار منها المستخدم؛ تُكمّل FTS5 الحرفي ولا تلغيه، وبلا RAG.
 */

/** سقف محارف نص التضمين — سياق النموذج 512 رمزًا، وما بعده يُقتَط لصالح الزمن والاتساق */
export const SEMANTIC_PASSAGE_MAX_CHARS = 1200

/** أرضية القبول الدلالي: نموذج e5 المتعدد اللغات يرفع أرضية التشابه المطلق،
 * فالعتبة الأدنى تُبقي القائمة حيّة — الترتيب هو الفاصل الحقيقي لا العتبة */
export const SEMANTIC_MIN_SCORE = 0.75

/** تشابه كوساين بين متجهين — صفر عند أي متجه صفري (لا NaN يفسد الترتيب) */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new RangeError(`أبعاد المتجهات مختلفة: ${a.length} مقابل ${b.length}`)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/** المتجه بايتات little-endian لتخزينه BLOB في SQLite */
export function vectorToBytes(v: Float32Array): Uint8Array {
  const bytes = new Uint8Array(v.length * 4)
  const dv = new DataView(bytes.buffer)
  for (let i = 0; i < v.length; i++) dv.setFloat32(i * 4, v[i]!, true)
  return bytes
}

/** قراءة المتجه من بايتاته — عكس vectorToBytes حرفيًا */
export function vectorFromBytes(bytes: Uint8Array): Float32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const v = new Float32Array(bytes.byteLength / 4)
  for (let i = 0; i < v.length; i++) v[i] = dv.getFloat32(i * 4, true)
  return v
}

/** أدنى دليل قابل للتضمين — حقول النص المعنى فقط، بلا أي قيمة إدخال */
export interface EmbeddableGuide {
  title: string
  description?: string
  steps: { title?: string; note?: string; pageTitle?: string }[]
}

/**
 * نص الدليل المُضمَّن (passage): العنوان ثم الوصف ثم عناوين الخطوات وملاحظاتها
 * وسياق صفحاتها. قاعدة خصوصية صلبة مطابقة لفهرس FTS5: step.value لا يدخل أبدًا —
 * حقول الإدخال تحوي بيانات عملاء وأرقامًا خاصة.
 */
export function semanticPassage(guide: EmbeddableGuide, tags: string[] = []): string {
  const parts: string[] = [guide.title]
  if (guide.description?.trim()) parts.push(guide.description.trim())
  for (const tag of tags) if (tag.trim()) parts.push(tag.trim())
  for (const s of guide.steps) {
    if (s.title?.trim()) parts.push(s.title.trim())
    if (s.note?.trim()) parts.push(s.note.trim())
    if (s.pageTitle?.trim()) parts.push(s.pageTitle.trim())
  }
  return parts.join(' ').slice(0, SEMANTIC_PASSAGE_MAX_CHARS)
}

export interface SemanticEntry {
  id: string
  vector: Float32Array
}

export interface RankedSemantic {
  id: string
  score: number
}

/**
 * ترتيب المتجهات من الأقرب للاستعلام: تنازليًا بالكوساين، ما دون العتبة يُستبعد.
 * limit غيابه = الكل فوق العتبة — القص قرار المستدعي (يُطبَّق بعد تنويع العناوين لا قبلها).
 * متجه بأبعاد شاذة (نموذج قديم؟) يُتخطى بلا انهيار.
 */
export function rankSemantic(
  query: Float32Array,
  entries: SemanticEntry[],
  opts: { limit?: number; minScore?: number } = {},
): RankedSemantic[] {
  const limit = opts.limit ?? Number.POSITIVE_INFINITY
  const minScore = opts.minScore ?? SEMANTIC_MIN_SCORE
  const ranked: RankedSemantic[] = []
  for (const e of entries) {
    if (e.vector.length !== query.length) continue
    const score = cosineSimilarity(query, e.vector)
    if (score < minScore) continue
    ranked.push({ id: e.id, score })
  }
  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, limit)
}
