import { describe, expect, it } from 'vitest'
import { assembleGuide } from '@dalili/core'
import { buildTestApp, registerUser } from './helpers'

/** UX-05: أول تسجيل دخول يجد دليلًا ترحيبيًا يشرح المنتج بنفس المنتج */
describe('UX-05 الدليل الترحيبي', () => {
  it('التسجيل يخلق دليلًا ترحيبيًا واحدًا نصيًّا بلا لقطات ووسم ترحيب', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'welcome1@dalili.sa')

    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    const body = list.json() as { items: { id: string; title: string; stepCount: number; tags: string[] }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]!.title).toContain('مرحبًا')
    expect(body.items[0]!.stepCount).toBeGreaterThanOrEqual(5)
    expect(body.items[0]!.tags).toContain('ترحيب')

    const got = await app.inject({ method: 'GET', url: `/api/guides/${body.items[0]!.id}`, headers: { cookie } })
    const guide = (got.json().guide as { steps: { screenshot?: unknown; note?: string; title: string }[] })
    // دليل نصي تعليمي: لا لقطات مزيفة — الخطوة بلا صورة عمدًا
    for (const s of guide.steps) expect(s.screenshot).toBeUndefined()
    expect(guide.steps.every((s) => s.note && s.note.length > 10)).toBe(true)

    // الدليل الترحيبي قابل للحذف كأي دليل — ليس قفلًا
    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${body.items[0]!.id}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)
  })

  it('الدخول بحساب قائم لا يخلق دليلًا ترحيبيًا ثانيًا', async () => {
    const { app } = await buildTestApp()
    const { cookie, me, password } = await registerUser(app, 'welcome2@dalili.sa')
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: me.email, password } })
    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    const welcome = (list.json() as { items: { title: string }[] }).items.filter((i) => i.title.includes('مرحبًا'))
    expect(welcome).toHaveLength(1)
  })
})

/** SRCH-02: مرشحات المجلد والنطاق في البحث */
describe('SRCH-02 مرشحات البحث', () => {
  async function seed(app: import('fastify').FastifyInstance, cookie: string) {
    // دليلان بنفس الكلمة المفتاحية: أحدهما في مجلد ونطاق erp والآخر في الجذر ونطاق hr
    const folder = await app.inject({ method: 'POST', url: '/api/folders', headers: { cookie }, payload: { name: 'المالية' } })
    const folderId = (folder.json() as { id: string }).id

    const erp = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://erp.example.com/orders', pageTitle: 'الأوامر', ts: 1 },
      { kind: 'click', target: { text: 'تسوية المخزون' }, url: 'https://erp.example.com/orders', pageTitle: 'الأوامر', ts: 2 },
    ])
    erp.title = 'دليل تسوية المخزون في ERP'
    const erpCreated = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: erp } })
    await app.inject({ method: 'PATCH', url: `/api/guides/${(erpCreated.json() as { id: string }).id}/meta`, headers: { cookie }, payload: { folderId } })

    const hr = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://hr.example.com/leave', pageTitle: 'الإجازات', ts: 1 },
      { kind: 'click', target: { text: 'طلب تسوية المخزون' }, url: 'https://hr.example.com/leave', pageTitle: 'الإجازات', ts: 2 },
    ])
    hr.title = 'دليل تسوية المخزون في HR'
    const hrCreated = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: hr } })
    return { folderId, erpId: (erpCreated.json() as { id: string }).id, hrId: (hrCreated.json() as { id: string }).id }
  }

  it('مرشح المجلد يحصر النتائج على أدلته', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'filter1@dalili.sa')
    const { folderId, erpId } = await seed(app, cookie)
    // الدليل الترحيبي لا يحتوي كلمة البحث فلا يظهر بلا مرشح أيضًا
    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('تسوية المخزون')}&folder=${folderId}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    const ids = new Set((res.json() as { hits: { guideId: string }[] }).hits.map((h) => h.guideId))
    expect(ids.has(erpId)).toBe(true)
    expect(ids.size).toBe(1)
  })

  it('مرشح النطاق site: يحصر على أدلة روابطها من النطاق', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'filter2@dalili.sa')
    const { erpId } = await seed(app, cookie)
    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('تسوية المخزون')}&site=erp.example.com`,
      headers: { cookie },
    })
    const ids = new Set((res.json() as { hits: { guideId: string }[] }).hits.map((h) => h.guideId))
    expect(ids.size).toBe(1)
    expect(ids.has(erpId)).toBe(true)

    const none = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('تسوية المخزون')}&site=nothing.example.com`,
      headers: { cookie },
    })
    expect((none.json() as { hits: unknown[] }).hits).toHaveLength(0)
  })

  it('مجلد غير موجود: نتيجة فارغة صادقة لا خطأ', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'filter3@dalili.sa')
    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('تسوية')}&folder=nope`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { hits: unknown[] }).hits).toHaveLength(0)
  })
})
