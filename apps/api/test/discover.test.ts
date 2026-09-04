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

async function create(app: import('fastify').FastifyInstance, cookie: string, guide: unknown) {
  const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide } })
  expect(res.statusCode, `create failed: ${res.body}`).toBe(200)
}

/** SRCH-04: الاكتشاف حسب الصفحة — شارة الامتداد بعدد أدلة المالك على نطاق التبويب النشط */
describe('GET /api/discover?site=', () => {
  it('يعُدّ أدلة المالك التي روابط خطواتها من النطاق ويعيد أحدثها أولًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc1-${Date.now()}@a.co`)
    await create(app, cookie, guideWithUrl('دليل الفواتير القديم', 'https://erp.example.com/invoices'))
    await new Promise((r) => setTimeout(r, 10))
    await create(app, cookie, guideWithUrl('دليل الاعتماد الأحدث', 'https://erp.example.com/approvals'))
    await create(app, cookie, guideWithUrl('دليل موقع آخر', 'https://other.example.net/home'))

    const res = await app.inject({ method: 'GET', url: '/api/discover?site=erp.example.com', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { count: number; guides: Array<{ id: string; title: string; updatedAt: string }> }
    expect(body.count).toBe(2)
    expect(body.guides).toHaveLength(2)
    expect(body.guides[0]!.title).toBe('دليل الاعتماد الأحدث')
    expect(body.guides[1]!.title).toBe('دليل الفواتير القديم')
  })

  it('أدلة مستخدم آخر لا تُحتسب — العزل بين الحسابات', async () => {
    const { app } = await buildTestApp()
    const { cookie: mine } = await registerUser(app, `disc2-${Date.now()}@a.co`)
    const { cookie: other } = await registerUser(app, `disc2b-${Date.now()}@a.co`)
    await create(app, other, guideWithUrl('دليل الجار', 'https://erp.example.com/x'))
    const res = await app.inject({ method: 'GET', url: '/api/discover?site=erp.example.com', headers: { cookie: mine } })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(0)
    expect(res.json().guides).toHaveLength(0)
  })

  it('لا أدلة على النطاق → صفر وقائمة فارغة (شارة تختفي عند العميل)', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc3-${Date.now()}@a.co`)
    const res = await app.inject({ method: 'GET', url: '/api/discover?site=unknown.example.org', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(0)
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

  it('سقف خمسة أدلة في القائمة مهما كبر العدد الكلي', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `disc5-${Date.now()}@a.co`)
    for (let i = 0; i < 7; i++) {
      await create(app, cookie, guideWithUrl(`دليل رقم ${i}`, 'https://erp.example.com/p'))
      await new Promise((r) => setTimeout(r, 10))
    }
    const res = await app.inject({ method: 'GET', url: '/api/discover?site=erp.example.com', headers: { cookie } })
    const body = res.json() as { count: number; guides: unknown[] }
    expect(body.count).toBe(7)
    expect(body.guides.length).toBeLessThanOrEqual(5)
  })
})
