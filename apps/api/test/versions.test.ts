import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

type App = import('fastify').FastifyInstance

const now = () => new Date().toISOString()

function guide(title: string) {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1 as const,
    title,
    locale: 'ar' as const,
    dir: 'rtl' as const,
    createdAt: now(),
    updatedAt: now(),
    steps: [],
  }
}

async function create(app: App, cookie: string, title: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: { cookie },
    payload: { guide: guide(title) },
  })
  expect(res.statusCode, res.body).toBe(200)
  return res.json().id as string
}

async function patchTitle(app: App, cookie: string, id: string, title: string) {
  const g = { ...guide(title), id }
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/guides/${id}`,
    headers: { cookie },
    payload: { guide: g },
  })
  expect(res.statusCode, res.body).toBe(200)
}

/** VER-01: إنشاء لقطة عند «تم» بإسقاط التكرار المتجاور */
describe('VER: إنشاء لقطة', () => {
  it('أول لقطة تعيد 201 بملخّص', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `v1-${Date.now()}@a.co`)
    const gid = await create(app, cookie, 'أول')
    const res = await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(body.title).toBe('أول')
    expect(body.stepCount).toBe(0)
    expect(body.authorId).toBeTruthy()
  })

  it('لقطة ثانية بلا تعديل تعيد 204 مع رأس الإسقاط', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `v2-${Date.now()}@a.co`)
    const gid = await create(app, cookie, 'ت')
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    const res = await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    expect(res.statusCode).toBe(204)
    expect(res.headers['x-version-deduped']).toBe('true')
  })

  it('لقطة بعد تعديل العنوان تعيد 201', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `v3-${Date.now()}@a.co`)
    const gid = await create(app, cookie, 'قبل')
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    await patchTitle(app, cookie, gid, 'بعد')
    const res = await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    expect(res.statusCode).toBe(201)
    expect(res.json().title).toBe('بعد')
  })
})

/** VER-01: قائمة السجل — الأحدث أولًا، بلا data */
describe('VER: قائمة السجل', () => {
  it('تعيد الأحدث أولًا بلا حقل data', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `v4-${Date.now()}@a.co`)
    const gid = await create(app, cookie, 'أ')
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    await patchTitle(app, cookie, gid, 'ب')
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    const res = await app.inject({ method: 'GET', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const items = res.json().items as Array<{ title: string; data?: unknown }>
    expect(items.length).toBe(2)
    expect(items[0]!.title).toBe('ب')
    expect(items[1]!.title).toBe('أ')
    expect(items[0]!.data).toBeUndefined()
  })
})

/** VER-01: جلب نسخة كاملة — إعادة استعمال شكل GuideDto */
describe('VER: جلب نسخة', () => {
  it('يعيد guide مطابقًا لبيانات وقت اللقطة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `v5-${Date.now()}@a.co`)
    const gid = await create(app, cookie, 'قديم')
    const c1 = await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie } })
    const vid = c1.json().id as string
    await patchTitle(app, cookie, gid, 'جديد')
    const res = await app.inject({ method: 'GET', url: `/api/guides/${gid}/versions/${vid}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const details = res.json()
    expect(details.guide.title).toBe('قديم')
    expect(details.guideId).toBe(gid)
  })

  it('vid مجهول (لدليل صحيح) يعيد 404', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `v6-${Date.now()}@a.co`)
    const gid = await create(app, cookie, 'x')
    const res = await app.inject({ method: 'GET', url: `/api/guides/${gid}/versions/nope1234567`, headers: { cookie } })
    expect(res.statusCode).toBe(404)
  })
})

/** VER-01: الأمن — 404 صادق للغرباء على الثلاث نقاط، لا 403 */
describe('VER: الأمن', () => {
  it('مستخدم آخر يستلم 404 من الثلاث نقاط', async () => {
    const { app } = await buildTestApp()
    const { cookie: c1 } = await registerUser(app, `owner-${Date.now()}@a.co`)
    const gid = await create(app, c1, 'خاص')
    const cr = await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie: c1 } })
    const vid = cr.json().id as string
    const { cookie: c2 } = await registerUser(app, `other-${Date.now()}@a.co`)
    for (const url of [`/api/guides/${gid}/versions`, `/api/guides/${gid}/versions/${vid}`]) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie: c2 } })
      expect(r.statusCode).toBe(404)
    }
    const p = await app.inject({ method: 'POST', url: `/api/guides/${gid}/versions`, headers: { cookie: c2 } })
    expect(p.statusCode).toBe(404)
  })
})
