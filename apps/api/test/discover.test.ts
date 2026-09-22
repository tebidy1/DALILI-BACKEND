import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

const now = () => new Date().toISOString()

function stepWithUrl(url: string) {
  return {
    id: crypto.randomUUID(),
    kind: 'click' as const,
    title: 'خطوة',
    target: { role: 'button' },
    sensitive: false,
    url,
    pageTitle: 'صفحة',
    ts: Date.now(),
  }
}

function guideWithUrl(title: string, url: string) {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1 as const,
    title,
    locale: 'ar' as const,
    dir: 'rtl' as const,
    createdAt: now(),
    updatedAt: now(),
    steps: [stepWithUrl(url)],
  }
}

async function create(app: import('fastify').FastifyInstance, cookie: string, guide: { id: string }) {
  const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide } })
  expect(res.statusCode, `create failed: ${res.body}`).toBe(200)
  return res.json().id as string // المعرّف الذي يولّده الخادم لا معرّف العميل
}

/** يمنح دليلًا مشاهدات عبر مشاركة حية — لاختبار الترتيب بالأكثر مشاهدة */
async function addViews(app: import('fastify').FastifyInstance, cookie: string, gid: string, n: number) {
  const share = await app.inject({ method: 'POST', url: `/api/guides/${gid}/share`, headers: { cookie } })
  const token = share.json().token as string
  for (let i = 0; i < n; i++) await app.inject({ method: 'POST', url: `/api/share/${token}/view` })
}

interface DiscBody {
  count: number
  onScreen: Array<{ id: string; title: string; updatedAt: string; views: number }>
  onSite: Array<{ id: string; title: string; updatedAt: string; views: number }>
}

/** SRCH-04 تطوّر: اكتشاف الشاشات الفرعية — مجموعتان (الشاشة/الموقع) والأكثر مشاهدة أولًا */
describe('GET /api/discover?site=&screen=', () => {
  it('بلا رموز شاشة: كل أدلة الموقع في onSite، والأحدث أولًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc1-${Date.now()}@a.co`)
    await create(app, cookie, guideWithUrl('دليل الفواتير القديم', 'https://erp.example.com/invoices'))
    await new Promise((r) => setTimeout(r, 10))
    await create(app, cookie, guideWithUrl('دليل الاعتماد الأحدث', 'https://erp.example.com/approvals'))
    await create(app, cookie, guideWithUrl('دليل موقع آخر', 'https://other.example.net/home'))

    const res = await app.inject({ method: 'GET', url: '/api/discover?site=erp.example.com', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as DiscBody
    expect(body.count).toBe(2)
    expect(body.onScreen).toHaveLength(0)
    expect(body.onSite.map((g) => g.title)).toEqual(['دليل الاعتماد الأحدث', 'دليل الفواتير القديم'])
  })

  it('رموز الشاشة تفصل «هذه الشاشة» عن بقية الموقع', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc-sep-${Date.now()}@a.co`)
    await create(app, cookie, guideWithUrl('دليل المبيعات', 'https://erp.example.com/sales'))
    await create(app, cookie, guideWithUrl('دليل المخزون', 'https://erp.example.com/inventory'))

    const res = await app.inject({
      method: 'GET',
      url: '/api/discover?site=erp.example.com&screen=' + encodeURIComponent('sales'),
      headers: { cookie },
    })
    const body = res.json() as DiscBody
    expect(body.onScreen.map((g) => g.title)).toEqual(['دليل المبيعات'])
    expect(body.onSite.map((g) => g.title)).toEqual(['دليل المخزون'])
  })

  it('هوية شاشة أودو في الـhash تُفهرس وتُطابَق (المقتل المصلَح)', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc-odoo-${Date.now()}@a.co`)
    await create(app, cookie, guideWithUrl('دليل أمر البيع', 'https://odoo.corp.sa/web#action=311&model=sale.order&id=42'))
    await create(app, cookie, guideWithUrl('لوحة القيادة', 'https://odoo.corp.sa/dashboard'))

    const res = await app.inject({
      method: 'GET',
      url: '/api/discover?site=odoo.corp.sa&screen=' + encodeURIComponent('web model sale order'),
      headers: { cookie },
    })
    const body = res.json() as DiscBody
    expect(body.onScreen.map((g) => g.title)).toEqual(['دليل أمر البيع'])
    expect(body.onSite.map((g) => g.title)).toEqual(['لوحة القيادة'])
  })

  it('داخل مجموعة الشاشة: الأكثر مشاهدة أولًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc-views-${Date.now()}@a.co`)
    const low = await create(app, cookie, guideWithUrl('تقرير قليل المشاهدة', 'https://erp.example.com/reports'))
    const high = await create(app, cookie, guideWithUrl('تقرير كثير المشاهدة', 'https://erp.example.com/reports'))
    await addViews(app, cookie, high, 5)
    await addViews(app, cookie, low, 1)

    const res = await app.inject({
      method: 'GET',
      url: '/api/discover?site=erp.example.com&screen=' + encodeURIComponent('reports'),
      headers: { cookie },
    })
    const body = res.json() as DiscBody
    expect(body.onScreen.map((g) => g.id)).toEqual([high, low])
    expect(body.onScreen[0]!.views).toBe(5)
  })

  it('أدلة مستخدم آخر لا تُحتسب — العزل بين الحسابات', async () => {
    const { app } = await buildTestApp()
    const { cookie: mine } = await registerUser(app, `disc2-${Date.now()}@a.co`)
    const { cookie: other } = await registerUser(app, `disc2b-${Date.now()}@a.co`)
    await create(app, other, guideWithUrl('دليل الجار', 'https://erp.example.com/x'))
    const res = await app.inject({ method: 'GET', url: '/api/discover?site=erp.example.com', headers: { cookie: mine } })
    const body = res.json() as DiscBody
    expect(body.count).toBe(0)
    expect(body.onScreen).toHaveLength(0)
    expect(body.onSite).toHaveLength(0)
  })

  it('نطاق ناقص → 400 برسالة عربية', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc4-${Date.now()}@a.co`)
    const res = await app.inject({ method: 'GET', url: '/api/discover?site=ab', headers: { cookie } })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { errorAr: string }).errorAr).toContain('نطاق')
  })

  it('بلا جلسة → 401', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/discover?site=erp.example.com' })
    expect(res.statusCode).toBe(401)
  })

  it('سقف خمسة لكل مجموعة مهما كبر العدد الكلي', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc5-${Date.now()}@a.co`)
    for (let i = 0; i < 7; i++) {
      await create(app, cookie, guideWithUrl(`دليل رقم ${i}`, 'https://erp.example.com/p'))
      await new Promise((r) => setTimeout(r, 10))
    }
    const res = await app.inject({
      method: 'GET',
      url: '/api/discover?site=erp.example.com&screen=' + encodeURIComponent('p'),
      headers: { cookie },
    })
    const body = res.json() as DiscBody
    expect(body.count).toBe(7)
    expect(body.onScreen.length).toBeLessThanOrEqual(5)
  })
})
