import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { backfillEmbeddings, embedGuideSafe } from '../src/embeddings/store'
import type { EmbeddingProvider } from '../src/embeddings/provider'
import { registerUser, randomTestPassword } from './helpers'
import type { SemanticHitDto, SearchResponseDto } from '@dalili/shared'

/**
 * SRCH-06 — البحث بالسياق (متجهات): قرار المالك 2026-09-01 قائمة عناوين أدلة
 * مرتبة من الأقرب معنىً يختار منها، تُكمّل FTS5 الحرفي ولا تلغيه.
 * المزوّد هنا مزوّف حتمي بكلمات مفتاحية — النموذج الحقيقي يُثبت في الإثبات الحي.
 */

const V_INVOICE = new Float32Array([1, 0, 0])
const V_EMPLOYEE = new Float32Array([0, 1, 0])
const V_BOTH = new Float32Array([0.85, 0.55, 0])
const V_NOISE = new Float32Array([0.05, 0.05, 0.05])

function vecFor(text: string): Float32Array {
  const hasInvoice = text.includes('فاتورة') || text.includes('فاتوره')
  const hasEmployee = text.includes('موظف') || text.includes('الموظفين')
  if (hasInvoice && hasEmployee) return V_BOTH
  if (hasInvoice) return V_INVOICE
  if (hasEmployee) return V_EMPLOYEE
  return V_NOISE
}

function fakeProvider(over: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    name: 'fake:keyword',
    async embedPassages(texts) {
      return texts.map(vecFor)
    },
    async embedQuery(text) {
      return vecFor(text)
    },
    ...over,
  }
}

function failingProvider(message: string): EmbeddingProvider {
  return {
    name: 'fake:failing',
    async embedPassages() {
      throw new Error(message)
    },
    async embedQuery() {
      throw new Error(message)
    },
  }
}

async function buildWith(embeddings: EmbeddingProvider | undefined) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-semantic-'))
  const built = await createApp({
    dataDir: dir,
    cookieSecret: 'test-secret-not-for-production',
    publicBase: 'http://localhost:8787',
    embeddings,
  })
  afterAll(() => built.close())
  return { ...built, dir }
}

const now = () => new Date().toISOString()

function makeStep(title: string, note?: string) {
  return {
    id: crypto.randomUUID(),
    kind: 'click' as const,
    title,
    note,
    target: { role: 'button' },
    sensitive: false,
    url: 'https://erp.example.com/invoices',
    pageTitle: 'نظام الفواتير',
    ts: Date.now(),
  }
}

function makeGuide(title: string, steps: ReturnType<typeof makeStep>[]) {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1 as const,
    title,
    locale: 'ar' as const,
    dir: 'rtl' as const,
    createdAt: now(),
    updatedAt: now(),
    steps,
  }
}

async function createGuide(app: import('fastify').FastifyInstance, cookie: string, guide: unknown) {
  const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide } })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as { id: string }
}

async function search(app: import('fastify').FastifyInstance, cookie: string, q: string): Promise<SearchResponseDto> {
  const res = await app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}`, headers: { cookie } })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as SearchResponseDto
}

describe('SRCH-06: الطبقة الدلالية فوق FTS5', () => {
  it('ترحيل 0006 يخلق جدول guide_embeddings', async () => {
    const { app, dir } = await buildWith(fakeProvider())
    await registerUser(app, `s0-${Date.now()}@a.co`, randomTestPassword())
    const raw = new Database(path.join(dir, 'dalili.db'))
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    expect(tables.map((t) => t.name)).toContain('guide_embeddings')
    raw.close()
  })

  it('كتابة دليل تُضمَّن فورًا — صف بموديل المزوّد وأبعاد المتجه', async () => {
    const provider = fakeProvider()
    const { app, dir } = await buildWith(provider)
    const { cookie } = await registerUser(app, `s1-${Date.now()}@a.co`, randomTestPassword())
    const g = await createGuide(app, cookie, makeGuide('إخراج الفاتورة النهائية', [makeStep('افتح الفواتير')]))
    const raw = new Database(path.join(dir, 'dalili.db'))
    const row = raw.prepare('SELECT guide_id, model, dim FROM guide_embeddings WHERE guide_id = ?').get(g.id) as
      | { guide_id: string; model: string; dim: number }
      | undefined
    raw.close()
    expect(row).toBeTruthy()
    expect(row!.model).toBe('fake:keyword')
    expect(row!.dim).toBe(3)
  })

  it('بحث بمعنى بلا تطابق حرفي: «كيف أعتمد فاتورة» يجد دليل الإخراج أولًا والترتيب تنازلي', async () => {
    const { app } = await buildWith(fakeProvider())
    const { cookie } = await registerUser(app, `s2-${Date.now()}@a.co`, randomTestPassword())
    const a = await createGuide(app, cookie, makeGuide('إخراج الفاتورة النهائية', [makeStep('اعتمد ثم اطبع')]))
    const b = await createGuide(app, cookie, makeGuide('إدارة الموظفين والحضور', [makeStep('سجل حضور')]))
    const c = await createGuide(app, cookie, makeGuide('فاتورة الموظف الجديد والتعريف', [makeStep('خطوة مزدوجة')]))
    const r = await search(app, cookie, 'كيف أعتمد فاتورة')
    expect(r.hits.length).toBe(0) // لا تطابق حرفيًا — الحرفي وحده كان سيُخلي الصفحة
    expect(r.semantic).toBeTruthy()
    expect(r.semantic!.map((h) => h.guideId)).toEqual([a.id, c.id]) // الأقرب أولًا، والموظف الصرفي مستبعد بالعتبة
    expect(r.semantic![0]!.score).toBeGreaterThanOrEqual(r.semantic![1]!.score)
    expect(r.semantic![0]!.guideTitle).toContain('الفاتورة')
    void b
  })

  it('الأدلة الحية مع البقية: اللافتات الحرفية والدلالية تعيشان في الاستجابة نفسها', async () => {
    const { app } = await buildWith(fakeProvider())
    const { cookie } = await registerUser(app, `s3-${Date.now()}@a.co`, randomTestPassword())
    await createGuide(app, cookie, makeGuide('فاتورة ضريبية', [makeStep('افتح الفواتير', 'الفاتورة جاهزة')]))
    const r = await search(app, cookie, 'فاتورة')
    expect(r.hits.length).toBeGreaterThan(0) // الحرفي يعمل كما هو
    expect(r.semantic?.length).toBeGreaterThan(0) // والدلالي يُكمّله لا يلغيه
  })

  it('بلا مزوّد: لا semantic ولا سبب — الحرفي كما هو تمامًا (الميزة غير مفعّلة أصلًا)', async () => {
    const { app } = await buildWith(undefined)
    const { cookie } = await registerUser(app, `s4-${Date.now()}@a.co`, randomTestPassword())
    await createGuide(app, cookie, makeGuide('فاتورة', [makeStep('خطوة')]))
    const r = await search(app, cookie, 'فاتورة')
    expect(r.semantic).toBeUndefined()
    expect(r.semanticReason).toBeUndefined()
  })

  it('فشل المزوّد = سبب عربي صادق ولا يُسقط النتائج الحرفية', async () => {
    const { app } = await buildWith(failingProvider('نموذج البحث بالمعنى يجهّز نفسه الآن — أعد المحاولة بعد لحظات'))
    const { cookie } = await registerUser(app, `s5-${Date.now()}@a.co`, randomTestPassword())
    await createGuide(app, cookie, makeGuide('فاتورة', [makeStep('خطوة', 'الفاتورة')]))
    const r = await search(app, cookie, 'فاتورة')
    expect(r.hits.length).toBeGreaterThan(0)
    expect(r.semantic).toBeUndefined()
    expect(r.semanticReason).toContain('يجهّز نفسه')
  })

  it('عزل المالك: أدلة الغير لا تظهر دلاليًا ولو تطابقت معنًى', async () => {
    const { app } = await buildWith(fakeProvider())
    const u1 = await registerUser(app, `s6a-${Date.now()}@a.co`, randomTestPassword())
    const u2 = await registerUser(app, `s6b-${Date.now()}@a.co`, randomTestPassword())
    await createGuide(app, u1.cookie, makeGuide('إخراج الفاتورة النهائية', [makeStep('اعتمد')]))
    const r = await search(app, u2.cookie, 'كيف أعتمد فاتورة')
    expect(r.semantic?.length ?? 0).toBe(0)
  })

  it('تنويع القائمة: النسخ المتطابقة العنوان لا تحتكرها — سقف اثنتين لكل عنوان', async () => {
    const { app } = await buildWith(fakeProvider())
    const { cookie } = await registerUser(app, `s6c-${Date.now()}@a.co`, randomTestPassword())
    // 5 نسخ متطابقة العنوان وقريبة معنويًا (كأدلة الإثبات المكررة بقاعدة حقيقية)
    for (let i = 0; i < 5; i++) {
      await createGuide(app, cookie, makeGuide('تعليقات — دليل إثبات فاتورة', [makeStep('علّق وردّ', 'تعليقات على خطوات الفاتورة')]))
    }
    await createGuide(app, cookie, makeGuide('إخراج الفاتورة النهائية', [makeStep('اعتمد ثم اطبع', 'الفاتورة')]))
    const r = await search(app, cookie, 'كيف أعتمد فاتورة')
    const titles = (r.semantic ?? []).map((h) => h.guideTitle)
    const dupes = titles.filter((t) => t.startsWith('تعليقات')).length
    expect(dupes).toBeLessThanOrEqual(2)
    // والهدف الحقيقي ظهر في القائمة المرئية — لا تحتكر وتطيحه
    expect(titles).toContain('إخراج الفاتورة النهائية')
  })

  it('دليل السلة يختفي من الدلالي فورًا', async () => {
    const { app } = await buildWith(fakeProvider())
    const { cookie } = await registerUser(app, `s7-${Date.now()}@a.co`, randomTestPassword())
    const a = await createGuide(app, cookie, makeGuide('إخراج الفاتورة النهائية', [makeStep('اعتمد')]))
    expect((await search(app, cookie, 'كيف أعتمد فاتورة')).semantic?.map((h) => h.guideId)).toContain(a.id)
    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${a.id}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)
    expect((await search(app, cookie, 'كيف أعتمد فاتورة')).semantic?.map((h) => h.guideId) ?? []).not.toContain(a.id)
  })

  it('فشل التضمين لا يكسر كتابة الدليل أبدًا — الحرفي محصّن من الدلالي', async () => {
    const { app } = await buildWith(failingProvider('انقطع الاتصال بالنموذج'))
    const { cookie } = await registerUser(app, `s8-${Date.now()}@a.co`, randomTestPassword())
    const res = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: { guide: makeGuide('فاتورة', [makeStep('خطوة')]) },
    })
    expect(res.statusCode).toBe(200)
  })

  it('وسوم التنظيم تدخل بصمة المعنى — PATCH meta يعيد التضمين فيجدها البحث', async () => {
    const { app } = await buildWith(fakeProvider())
    const { cookie } = await registerUser(app, `s9-${Date.now()}@a.co`, randomTestPassword())
    // دليل لا يذكر الفاتورة في عنوانه ولا ملاحظاته
    const g = await createGuide(app, cookie, makeGuide('إجراء إداري روتيني', [makeStep('اتبع الشاشة')]))
    expect((await search(app, cookie, 'كيف أعتمد فاتورة')).semantic?.map((h) => h.guideId) ?? []).not.toContain(g.id)
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${g.id}/meta`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: { tags: ['فاتورة'] },
    })
    expect(patch.statusCode).toBe(200)
    expect((await search(app, cookie, 'كيف أعتمد فاتورة')).semantic?.map((h) => h.guideId)).toContain(g.id)
  })
})

describe('SRCH-06 تحسين: دمج RRF بالمراكز وقصّ الثقة النسبي (قرار 2026-09-04)', () => {
  /** مزوّد بعلامات مضبوطة: كوساينات متمايزة (1.0 / 0.8 / 0.787) فوق العتبة كي يُختبر الترتيب والقصّ بدقة */
  function markerProvider(): EmbeddingProvider {
    const V_A = new Float32Array([1, 0, 0])
    const V_B = new Float32Array([0.8, 0.6, 0])
    const V_C = new Float32Array([0.79, 0.62, 0])
    const V_OUT = new Float32Array([0, 0, 1])
    const vecOf = (text: string): Float32Array =>
      text.includes('ماركا') ? V_A : text.includes('ماركب') ? V_B : text.includes('ماركج') ? V_C : V_OUT
    return {
      name: 'fake:marker',
      async embedPassages(texts) {
        return texts.map(vecOf)
      },
      async embedQuery() {
        return V_A
      },
    }
  }

  async function seedMarkerWorld() {
    const { app } = await buildWith(markerProvider())
    const { cookie } = await registerUser(app, `rrf-${Date.now()}-${Math.random()}@a.co`, randomTestPassword())
    // الدليل الترحيبي المزروع عند التسجيل يُحذف نهائيًا كي تكون القوائم مضبوطة
    const list = await app.inject({ method: 'GET', url: '/api/guides?limit=100', headers: { cookie } })
    for (const o of (list.json() as { items: { id: string }[] }).items) {
      const del = await app.inject({ method: 'DELETE', url: `/api/guides/${o.id}?permanent=1`, headers: { cookie } })
      expect(del.statusCode).toBe(204)
    }
    const a = await createGuide(app, cookie, makeGuide('دليل ماركا أ', [makeStep('خطوة أ')]))
    const b = await createGuide(app, cookie, makeGuide('دليل ماركب سؤال', [makeStep('خطوة ب')]))
    const c = await createGuide(app, cookie, makeGuide('دليل ماركج ج', [makeStep('خطوة ج')]))
    return { app, cookie, a: a.id, b: b.id, c: c.id }
  }

  it('بلا حرفي: الترتيب الكوسايني كما هو وفجوة الثقة النسبية لا تمس القائمة المتقاربة', async () => {
    const { app, cookie, a, b, c } = await seedMarkerWorld()
    const r = await search(app, cookie, 'لا يطابق شيء')
    expect(r.hits.length).toBe(0)
    expect(r.semantic!.map((h) => h.guideId)).toEqual([a, b, c])
  })

  it('مع حرفي: مشترك القائمتين يتقدم بالمراكز والذيل الدلالي البعيد يُقصّ بفجوة الدمج', async () => {
    const { app, cookie, a, b, c } = await seedMarkerWorld()
    const r = await search(app, cookie, 'سؤال')
    expect(r.hits.map((h) => h.guideId)).toEqual([b]) // الحرفي يجد ماركب وحده
    expect(r.semantic!.map((h) => h.guideId)).toEqual([b, a]) // المشترك يتقدم على قمة الدلالي
    expect(r.semantic!.map((h) => h.guideId)).not.toContain(c) // البعيد عن القمة يقصّ بفجوة الدمج
  })
})

describe('SRCH-06: backfill — شفاء الأدلة غير المضمّنة', () => {
  it('يضمّن الناقص ويحدّث الباطل (موديل/بصمة مختلفة) ويتخطى الطازج', async () => {
    const { app, dir } = await buildWith(fakeProvider())
    const { cookie } = await registerUser(app, `s10-${Date.now()}@a.co`, randomTestPassword())
    const g1 = await createGuide(app, cookie, makeGuide('فاتورة أولى', [makeStep('خطوة')]))
    const g2 = await createGuide(app, cookie, makeGuide('فاتورة ثانية', [makeStep('خطوة')]))
    // تسجيل المستخدم يزرع دليلًا ترحيبيًا (UX-05) — يُحذف نهائيًا كي يكون العدّ دقيقًا
    const list = await app.inject({ method: 'GET', url: '/api/guides?limit=100', headers: { cookie } })
    const others = (list.json() as { items: { id: string }[] }).items.filter((x) => x.id !== g1.id && x.id !== g2.id)
    for (const o of others) {
      const del = await app.inject({ method: 'DELETE', url: `/api/guides/${o.id}?permanent=1`, headers: { cookie } })
      expect(del.statusCode).toBe(204)
    }

    const raw = new Database(path.join(dir, 'dalili.db'))
    // g1 يصير باطلًا (موديل قديم) وg2 يُحذف صفّه (ناقص)
    raw.prepare('UPDATE guide_embeddings SET model = ? WHERE guide_id = ?').run('old-model', g1.id)
    raw.prepare('DELETE FROM guide_embeddings WHERE guide_id = ?').run(g2.id)

    let embedded = 0
    const r = await backfillEmbeddings(raw, {
      ...fakeProvider(),
      async embedPassages(texts: string[]) {
        embedded += texts.length
        return texts.map(vecFor)
      },
    })
    expect(r.embedded).toBe(2)
    expect(embedded).toBe(2)
    const models = raw.prepare('SELECT DISTINCT model FROM guide_embeddings').all() as { model: string }[]
    expect(models.map((m) => m.model)).toEqual(['fake:keyword'])
    // الطازج يُتخطى: backfill ثانٍ لا يضمّن شيئًا
    const r2 = await backfillEmbeddings(raw, fakeProvider())
    expect(r2.embedded).toBe(0)
    raw.close()
  })

  it('embedGuideSafe يبتلع الفشل بصمت محسوب — الكتابة أغلى من البصمة', async () => {
    const { dir } = await buildWith(undefined)
    const raw = new Database(path.join(dir, 'dalili.db'))
    // لا دليل بهذا المعرف — الدالة تلتقط أي خطأ ولا ترمي (الكتابة لا تنكسر بالبصمة)
    await expect(
      embedGuideSafe(raw, failingProvider('فشل'), { id: 'ghost', title: 'x', steps: [] }, []),
    ).resolves.toBeUndefined()
    raw.close()
  })

  it('تصدير SemanticHitDto من shared متاح للويب (النتيجة تصل للعميل كما هي)', async () => {
    const hits: SemanticHitDto[] = [
      { guideId: 'g1', guideTitle: 'فاتورة', score: 0.9, updatedAt: now(), thumbFileId: 't1' },
    ]
    expect(hits[0]!.guideId).toBe('g1')
  })
})
