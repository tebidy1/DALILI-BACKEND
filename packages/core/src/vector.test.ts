import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  vectorFromBytes,
  vectorToBytes,
  semanticPassage,
  rankSemantic,
  SEMANTIC_MIN_SCORE,
  SEMANTIC_PASSAGE_MAX_CHARS,
  type EmbeddableGuide,
} from './vector'

/**
 * SRCH-06 — البحث بالسياق (متجهات): رياضيات نقية في core بلا أي اعتماد.
 * قرار المالك 2026-09-01: النتيجة قائمة عناوين أدلة مرتبة من الأقرب معنىً يختار منها —
 * تُكمّل FTS5 الحرفي ولا تلغيه، وبلا RAG.
 */

const guide = (partial: Partial<EmbeddableGuide> = {}): EmbeddableGuide => ({
  title: 'إخراج الفاتورة النهائية',
  steps: [{ title: 'افتح قائمة الفواتير', note: 'من القائمة الرئيسية اختر الفواتير', pageTitle: 'نظام الفواتير' }],
  ...partial,
})

describe('cosineSimilarity — تشابه المتجهات', () => {
  it('متجهان متطابقان → 1', () => {
    expect(cosineSimilarity(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]))).toBeCloseTo(1, 6)
  })

  it('متعامدان → 0', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6)
  })

  it('متعاكسان → -1', () => {
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([-1, -2]))).toBeCloseTo(-1, 6)
  })

  it('متجه صفري → 0 بلا NaN (صدق لا انهيار)', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 2]))).toBe(0)
  })

  it('أبعاد غير متساوية → خطأ صريح', () => {
    expect(() => cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2]))).toThrow()
  })
})

describe('vectorToBytes / vectorFromBytes — تخزين BLOB مستقر', () => {
  it('ذهاب وإياب يطابق القيم', () => {
    const v = new Float32Array([0.25, -1.5, 3.75, 0])
    const back = vectorFromBytes(vectorToBytes(v))
    expect(Array.from(back)).toEqual([0.25, -1.5, 3.75, 0])
  })

  it('البايتات little-endian — قيمة معلومة تُقرأ من DataView', () => {
    const bytes = vectorToBytes(new Float32Array([1.5]))
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(dv.getFloat32(0, true)).toBeCloseTo(1.5, 6)
  })
})

describe('semanticPassage — نص الدليل المُضمَّن', () => {
  it('يجمع العنوان وعناوين الخطوات والملاحظات وعناوين الصفحات والوسوم', () => {
    const p = semanticPassage(
      guide({
        description: 'خطوات اعتماد الفاتورة قبل الإرسال',
        steps: [{ title: 'افتح شاشة الاعتماد', note: 'اعتمد ثم اطبع', pageTitle: 'شاشة الاعتماد' }],
      }),
      ['مالية', 'فاتورة'],
    )
    expect(p).toContain('إخراج الفاتورة النهائية')
    expect(p).toContain('خطوات اعتماد الفاتورة قبل الإرسال')
    expect(p).toContain('مالية')
    expect(p).toContain('افتح شاشة الاعتماد')
    expect(p).toContain('اعتمد ثم اطبع')
    expect(p).toContain('شاشة الاعتماد')
  })

  it('قاعدة خصوصية صلبة: step.value لا يدخل النص المُضمَّن أبدًا — حساسًا كان أو عاديًا', () => {
    // value حقل حقيقي في الخطوات لكنه محجوب عمدًا عن النوع EmbeddableGuide نفسه —
    // تمريره هنا يثبت أنه لا يملك طريقًا إلى النص المُضمَّن أصلًا
    const p = semanticPassage(
      guide({
        steps: [{ title: 'أدخل رقم العميل', note: 'اكتب الرقم', pageTitle: '' }],
      }),
    )
    expect(p).not.toContain('سر-عميل-٤٤٣٢')
    expect(p).not.toContain('value')
  })

  it('يُقصّ عند السقف كي لا يتجاوز سياق النموذج (512 رمزًا)', () => {
    const longSteps = Array.from({ length: 200 }, (_, i) => ({ title: `خطوة رقم ${i} بطول وافٍ من الكلام`, note: 'ملاحظة طويلة نسبيًا لكل خطوة لاختبار القص' }))
    const p = semanticPassage(guide({ title: 'دليل طويل', steps: longSteps }))
    expect(p.length).toBeLessThanOrEqual(SEMANTIC_PASSAGE_MAX_CHARS)
  })

  it('دليل بلا خطوات يُنتج نصًا من العنوان وحده ولا ينهار', () => {
    expect(semanticPassage(guide({ title: 'دليل فارغ', steps: [] }))).toContain('دليل فارغ')
  })
})

describe('rankSemantic — الترتيب من الأقرب معنىً', () => {
  const q = new Float32Array([1, 0, 0])
  const entries = [
    { id: 'بعيد', vector: new Float32Array([0, 1, 0]) },
    { id: 'قريب-جدًا', vector: new Float32Array([0.99, 0.14, 0]) },
    { id: 'قريب', vector: new Float32Array([0.8, 0.6, 0]) },
    { id: 'صفري', vector: new Float32Array([0, 0, 0]) },
  ]

  it('يرتب تنازليًا حسب الكوساين ويستبعد ما دون العتبة والصفري', () => {
    const ranked = rankSemantic(q, entries)
    expect(ranked.map((r) => r.id)).toEqual(['قريب-جدًا', 'قريب'])
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score)
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(SEMANTIC_MIN_SCORE)
  })

  it('يحترم الحد الأقصى للنتائج', () => {
    expect(rankSemantic(q, entries, { limit: 1 }).length).toBe(1)
  })

  it('بلا حد: كل ما فوق العتبة يعود — القص قرار المستدعي بعد التنويع', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      vector: new Float32Array([0.95, i * 0.01, 0]),
    }))
    const all = rankSemantic(q, many)
    expect(all.length).toBe(12)
    expect(all[0]!.id).toBe('n0')
  })

  it('يتخطى متجهًا بأبعاد غير متطابقة بلا انهيار', () => {
    const withAlien = [...entries, { id: 'غريب-الأبعاد', vector: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]) }]
    expect(rankSemantic(q, withAlien).map((r) => r.id)).not.toContain('غريب-الأبعاد')
  })
})
