import { describe, expect, it } from 'vitest'
import { assembleGuide, type RawStep } from '@dalili/core'
import { buildTestApp, registerUser } from './helpers'

/** CAP-17: «أضف خطوات» — استئناف الالتقاط على دليل قائم بالإدراج في موضع محدد */

function makeGuide(n = 2): ReturnType<typeof assembleGuide> {
  const raw: RawStep[] = [
    { kind: 'navigate', target: {}, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 1 },
  ]
  for (let i = 0; i < n - 1; i++) {
    raw.push({
      kind: 'click',
      target: { text: `زر الفواتير ${i + 1}` },
      url: 'https://erp.example/invoices',
      pageTitle: 'الفواتير',
      ts: 2 + i,
    })
  }
  return assembleGuide(raw)
}

function extraSteps(titles: string[]) {
  const assembled = assembleGuide(
    titles.map((t, i) => ({ kind: 'click', target: { text: t }, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 100 + i })),
  )
  return assembled.steps.map((s) => JSON.parse(JSON.stringify(s)))
}

describe('CAP-17 إضافة خطوات لدليل قائم', () => {
  it('دورة كاملة: إضافة في النهاية → الترتيب والعدّاد والفهرس يتبعون', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'append1@dalili.sa')
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: makeGuide(2) } })
    const id = (created.json() as { id: string }).id

    const res = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/steps`,
      headers: { cookie },
      payload: { steps: extraSteps(['اعتماد المراجعة النهائية']) },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id, stepCount: 3 })

    const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
    const steps = (got.json().guide as { steps: { title: string }[] }).steps
    expect(steps).toHaveLength(3)
    expect(steps[2]!.title).toContain('اعتماد المراجعة النهائية')

    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    expect((list.json() as { items: { id: string; stepCount: number }[] }).items.find((s) => s.id === id)?.stepCount).toBe(3)

    // الفهرس يتبع الإضافة في نفس المعاملة — الخطوة الجديدة تظهر في البحث فورًا
    const search = await app.inject({ method: 'GET', url: '/api/search?q=' + encodeURIComponent('المراجعة النهائية'), headers: { cookie } })
    expect((search.json() as { hits: { guideId: string }[] }).hits.some((h) => h.guideId === id)).toBe(true)
  })

  it('الإدراج في موضع محدد: insertAt=1 يضع الجديدة ثانية', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'append2@dalili.sa')
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: makeGuide(3) } })
    const id = (created.json() as { id: string }).id

    const res = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/steps`,
      headers: { cookie },
      payload: { steps: extraSteps(['خطوة الوسط المدرجة']), insertAt: 1 },
    })
    expect(res.statusCode).toBe(200)
    const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
    const steps = (got.json().guide as { steps: { title: string }[] }).steps
    expect(steps[1]!.title).toContain('خطوة الوسط المدرجة')
    expect(steps).toHaveLength(4)
  })

  it('سقف الدليل 1000 خطوة — الرفض برسالة عربية صادقة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'append3@dalili.sa')
    const big = makeGuide(999)
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: big } })
    const id = (created.json() as { id: string }).id

    // 999 + 2 = 1001 يتجاوز السقف (999 + 1 = 1000 داخل الحد)
    const res = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/steps`,
      headers: { cookie },
      payload: { steps: extraSteps(['خطوة زائدة', 'خطوة زائدة ثانية']) },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { errorAr: string }).errorAr).toContain('1000')
  })

  it('insertAt خارج النطاق يُرفض، والمصفوفة الفارغة تُرفض', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'append4@dalili.sa')
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: makeGuide(2) } })
    const id = (created.json() as { id: string }).id

    const out = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/steps`,
      headers: { cookie },
      payload: { steps: extraSteps(['س']), insertAt: 5 },
    })
    expect(out.statusCode).toBe(400)

    const empty = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/steps`,
      headers: { cookie },
      payload: { steps: [] },
    })
    expect(empty.statusCode).toBe(400)
  })

  it('دليل في السلة لا يقبل إضافة — السلة حقيقة، ودليل غيرك 404', async () => {
    const { app } = await buildTestApp()
    const a = await registerUser(app, 'append5a@dalili.sa')
    const b = await registerUser(app, 'append5b@dalili.sa')
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie: a.cookie }, payload: { guide: makeGuide(2) } })
    const id = (created.json() as { id: string }).id

    const foreign = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/steps`,
      headers: { cookie: b.cookie },
      payload: { steps: extraSteps(['س']) },
    })
    expect(foreign.statusCode).toBe(404)

    await app.inject({ method: 'DELETE', url: `/api/guides/${id}`, headers: { cookie: a.cookie } })
    const trashed = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/steps`,
      headers: { cookie: a.cookie },
      payload: { steps: extraSteps(['س']) },
    })
    expect(trashed.statusCode).toBe(400)
    expect((trashed.json() as { errorAr: string }).errorAr).toContain('السلة')
  })
})
