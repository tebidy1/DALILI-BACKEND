import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser, randomTestPassword } from './helpers'

const now = () => new Date().toISOString()

function makeStep(partial: {
  title: string
  note?: string
  pageTitle?: string
  url?: string
  value?: string
}) {
  return {
    id: crypto.randomUUID(),
    kind: 'click' as const,
    title: partial.title,
    note: partial.note,
    target: { role: 'button' },
    value: partial.value,
    sensitive: false,
    url: partial.url ?? 'https://erp.example.com/invoices',
    pageTitle: partial.pageTitle ?? 'نظام الفواتير',
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
  expect(res.statusCode, `create guide failed: ${res.body}`).toBe(200)
  return res.json() as { id: string }
}

async function search(app: import('fastify').FastifyInstance, cookie: string, q: string) {
  const res = await app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}`, headers: { cookie } })
  return res
}

describe('البحث الخادمي FTS5 (SRCH-00/01) — الاختبارات الإلزامية ب1..ب14', () => {
  it('ب1: «الفاتوره» تطابق «الفاتورة» — التاء المربوطة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b1-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('دورة الفاتورة الضريبية', [makeStep({ title: 'افتح قائمة الفواتير' })]))
    const res = await search(app, cookie, 'الفاتوره')
    expect(res.statusCode).toBe(200)
    expect(res.json().hits.length).toBeGreaterThan(0)
  })

  it('ب2: «مُوَظَّف» تطابق «موظف» — التشكيل', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b2-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('إضافة موظف جديد', [makeStep({ title: 'افتح ملف الموظفين' })]))
    const res = await search(app, cookie, 'مُوَظَّف')
    expect(res.json().hits.length).toBeGreaterThan(0)
  })

  it('ب3: «إعتماد» تطابق «اعتماد» — صور الهمزة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b3-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('اعتماد أمر الشراء', [makeStep({ title: 'اضغط زر الاعتماد النهائي' })]))
    const res = await search(app, cookie, 'إعتماد')
    expect(res.json().hits.length).toBeGreaterThan(0)
  })

  it('ب4: «الفاتورة» تطابق «فاتورة» والعكس — التجريد الخفيف بالاتجاهين', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b4-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('دورة فاتورة المبيعات', [makeStep({ title: 'راجع بيانات فاتورة العميل' })]))
    expect((await search(app, cookie, 'الفاتورة')).json().hits.length).toBeGreaterThan(0)
    expect((await search(app, cookie, 'فاتورة')).json().hits.length).toBeGreaterThan(0)
  })

  it('ب5: «١٢٣» تطابق «123» — الأرقام الشرقية', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b5-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('أمر شراء 123', [makeStep({ title: 'أدخل الرقم 123 في الحقل' })]))
    const res = await search(app, cookie, '١٢٣')
    expect(res.json().hits.length).toBeGreaterThan(0)
  })

  it('ب6: «فات» تطابق «فاتورة» — مطابقة البادئة أثناء الكتابة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b6-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('إصدار فاتورة ضريبية', [makeStep({ title: 'افتح الفاتورة الأخيرة' })]))
    const res = await search(app, cookie, 'فات')
    expect(res.json().hits.length).toBeGreaterThan(0)
  })

  it('ب7: محارف صيغة FTS5 لا تكسر الاستعلام — لا 500 إطلاقًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b7-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('دليل عادي', [makeStep({ title: 'خطوة عادية' })]))
    for (const q of ['"', 'OR', 'NEAR(', '*', '"فاتورة"', '^x', 'a -b', 'C++']) {
      const res = await search(app, cookie, q)
      expect(res.statusCode, `كسر الاستعلام: ${q}`).toBeLessThan(500)
      expect(res.statusCode).toBeLessThanOrEqual(400)
    }
  })

  it('ب9: عزل المستأجرين — لا يرى مستخدم نتائج غيره إطلاقًا', async () => {
    const { app } = await buildTestApp()
    const a = await registerUser(app, `b9a-${Date.now()}@a.co`)
    const b = await registerUser(app, `b9b-${Date.now()}@a.co`)
    await createGuide(app, a.cookie, makeGuide('مطالبة هنجرستيشن السرية', [makeStep({ title: 'قيمة المطالبة 999' })]))
    const res = await search(app, b.cookie, 'مطالبة')
    expect(res.json().hits.length).toBe(0)
    expect((await search(app, a.cookie, 'مطالبة')).json().hits.length).toBeGreaterThan(0)
  })

  it('ب10: الدليل المحذوف يختفي من البحث فورًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b10-${Date.now()}@a.co`)
    const { id } = await createGuide(app, cookie, makeGuide('دليل المؤردات المؤقت', [makeStep({ title: 'خطوة المؤرد' })]))
    expect((await search(app, cookie, 'المؤردات')).json().hits.length).toBeGreaterThan(0)
    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${id}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)
    expect((await search(app, cookie, 'المؤردات')).json().hits.length).toBe(0)
  })

  it('ب11: تحرير عنوان خطوة يظهر أثره في البحث فورًا — نفس المعاملة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b11-${Date.now()}@a.co`)
    const guide = makeGuide('دليل الرواتب', [makeStep({ title: 'افتح شاشة الموظفين' })])
    const { id } = await createGuide(app, cookie, guide)
    expect((await search(app, cookie, 'الدمغة')).json().hits.length).toBe(0)
    guide.steps[0]!.title = 'سجّل الدمغة على الراتب'
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${id}`,
      headers: { cookie },
      payload: { guide },
    })
    expect(patch.statusCode).toBe(200)
    expect((await search(app, cookie, 'الدمغة')).json().hits.length).toBeGreaterThan(0)
  })

  it('ب12: قيم الحقول لا تُفهرس أبدًا — اختبار أمني', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b12-${Date.now()}@a.co`)
    await createGuide(
      app,
      cookie,
      makeGuide('دليل إدخال البيانات', [makeStep({ title: 'اكتب بيانات العميل', value: 'سر-القيمة-778899' })]),
    )
    // البحث عن قيمة الحقل لا يجد شيئًا — لم تُفهرس
    expect((await search(app, cookie, '778899')).json().hits.length).toBe(0)
    // ولا تظهر في أي مقتطف نتيجة عن كلمة أخرى
    const res = await search(app, cookie, 'العميل')
    for (const h of res.json().hits as { snippet: string }[]) {
      expect(h.snippet).not.toContain('778899')
    }
  })

  it('ب13: نص إنجليزي داخل دليل عربي يُطابَق — ثنائية اللغة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b13-${Date.now()}@a.co`)
    await createGuide(
      app,
      cookie,
      makeGuide('تهيئة SAP للفروع', [makeStep({ title: 'افتح transaction SM30 للتهيئة', note: 'تتطلب صلاحية admin' })]),
    )
    expect((await search(app, cookie, 'SM30')).json().hits.length).toBeGreaterThan(0)
    expect((await search(app, cookie, 'admin')).json().hits.length).toBeGreaterThan(0)
  })

  it('ب14: استعلام فارغ → 400 برسالة عربية', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `b14-${Date.now()}@a.co`, randomTestPassword())
    const res = await search(app, cookie, '')
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toBeTruthy()
  })

  it('التجميع: دليل واحد لا يستأثر النتائج — أعلى 3 لكل دليل', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `grp-${Date.now()}@a.co`)
    const steps = Array.from({ length: 8 }, (_, i) => makeStep({ title: `خطوة الجرد رقم ${i + 1} للمخزون` }))
    await createGuide(app, cookie, makeGuide('دليل الجرد الشامل', steps))
    const res = await search(app, cookie, 'الجرد')
    const hits = res.json().hits as { guideId: string }[]
    expect(hits.length).toBeLessThanOrEqual(3)
  })

  it('اقتراح: مسار أخف بلا تظليل وحد أصغر', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `sug-${Date.now()}@a.co`)
    await createGuide(app, cookie, makeGuide('دليل المطالبات', [makeStep({ title: 'افتح شاشة المطالبة' })]))
    const res = await app.inject({
      method: 'GET',
      url: `/api/search/suggest?q=${encodeURIComponent('مطال')}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.hits.length).toBeGreaterThan(0)
    expect(body.hits[0].snippet).not.toContain('<mark>')
  })
})
