import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

const now = () => new Date().toISOString()

type App = import('fastify').FastifyInstance

function guide(title: string, over: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1 as const,
    title,
    locale: 'ar' as const,
    dir: 'rtl' as const,
    createdAt: now(),
    updatedAt: now(),
    steps: [],
    ...over,
  }
}

function blockStep(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    kind: 'click' as const,
    title: '',
    target: {},
    sensitive: false,
    url: '',
    pageTitle: '',
    ts: Date.now(),
    ...over,
  }
}

async function create(app: App, cookie: string, g: { id: string }) {
  const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: g } })
  expect(res.statusCode, `create failed: ${res.body}`).toBe(200)
  return res.json().id as string
}

async function listKinds(app: App, cookie: string): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'GET', url: '/api/guides?limit=50', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const out: Record<string, string> = {}
  for (const it of res.json().items as { id: string; kind: string }[]) out[it.id] = it.kind
  return out
}

/** BKL-01: نوع المستند عمودًا مشتقًا — القوائم ترشّح بلا فكّ JSON (قانون PERF-05) */
describe('BKL: عمود النوع', () => {
  it('دليل يُنشأ بلا kind يُخزَّن guide، والكرّاسة booklet', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk1-${Date.now()}@a.co`)
    const g = await create(app, cookie, guide('دليل عادي'))
    const b = await create(app, cookie, guide('كرّاسة', { kind: 'booklet' }))
    const kinds = await listKinds(app, cookie)
    expect(kinds[g]).toBe('guide')
    expect(kinds[b]).toBe('booklet')
  })

  it('تكرار كرّاسة يبقيها كرّاسة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk2-${Date.now()}@a.co`)
    const b = await create(app, cookie, guide('ك', { kind: 'booklet' }))
    const dup = await app.inject({ method: 'POST', url: `/api/guides/${b}/duplicate`, headers: { cookie } })
    expect(dup.statusCode).toBe(200)
    const kinds = await listKinds(app, cookie)
    expect(kinds[dup.json().id as string]).toBe('booklet')
  })

  it('الكرّاسة تُقرأ بنوعها في التفصيل — لا يضيع kind بين الكتابة والقراءة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk3-${Date.now()}@a.co`)
    const b = await create(app, cookie, guide('ك', { kind: 'booklet' }))
    const res = await app.inject({ method: 'GET', url: `/api/guides/${b}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().guide.kind).toBe('booklet')
  })
})

/** BKL-01 (E-BKL-02): الواجهة ترشّح، لكن الواجهة ليست حارسًا */
describe('BKL: لا كرّاسة داخل كرّاسة', () => {
  it('حفظ كرّاسة تضمّ كرّاسة يُرفض 400 برسالة محددة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk4-${Date.now()}@a.co`)
    const inner = await create(app, cookie, guide('كرّاسة داخلية', { kind: 'booklet' }))
    const outerId = await create(app, cookie, guide('ك', { kind: 'booklet' }))

    const read = await app.inject({ method: 'GET', url: `/api/guides/${outerId}`, headers: { cookie } })
    const outer = read.json().guide as Record<string, unknown>
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${outerId}`,
      headers: { cookie },
      payload: { guide: { ...outer, steps: [blockStep({ block: 'embed', embed: { guideId: inner, expanded: false } })] } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toBe('لا تُضمّ كرّاسة داخل كرّاسة')
  })

  it('تضمين دليل عادي داخل كرّاسة مقبول', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk5-${Date.now()}@a.co`)
    const plain = await create(app, cookie, guide('دليل عادي'))
    const outerId = await create(app, cookie, guide('ك', { kind: 'booklet' }))
    const read = await app.inject({ method: 'GET', url: `/api/guides/${outerId}`, headers: { cookie } })
    const outer = read.json().guide as Record<string, unknown>
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${outerId}`,
      headers: { cookie },
      payload: { guide: { ...outer, steps: [blockStep({ block: 'embed', embed: { guideId: plain, expanded: false } })] } },
    })
    expect(res.statusCode, res.body).toBe(200)
  })
})

/** BKL-01: نص الكرّاسة يدخل الفهرس، والكرّاسة تخرج من الاكتشاف (لا رابط لها) */
describe('BKL: الفهرسة والاكتشاف', () => {
  it('نص الكتلة المنسّقة يُوجَد بالبحث الحرفي', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk6-${Date.now()}@a.co`)
    await create(
      app,
      cookie,
      guide('كرّاسة الإغلاق', {
        kind: 'booklet',
        steps: [blockStep({ block: 'text', rich: [{ para: 'p', runs: [{ text: 'مطابقة الحسابات البنكية' }] }] })],
      }),
    )
    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('البنكية')}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().hits.length).toBeGreaterThan(0)
  })

  it('الكرّاسة لا تظهر في اكتشاف الشاشة — لا رابط لها فلا تُخمَّن', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk7-${Date.now()}@a.co`)
    // دليل عادي على نفس الموقع كي لا يكون الرد فارغًا لسبب آخر
    await create(
      app,
      cookie,
      guide('دليل الطلبات', {
        steps: [blockStep({ url: 'https://erp.example.com/orders', pageTitle: 'طلبات', title: 'خطوة' })],
      }),
    )
    const bk = await create(app, cookie, guide('كرّاسة الطلبات', { kind: 'booklet' }))

    const res = await app.inject({
      method: 'GET',
      url: `/api/discover?site=${encodeURIComponent('erp.example.com')}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { onScreen: { id: string }[]; onSite: { id: string }[] }
    const ids = [...body.onScreen, ...body.onSite].map((x) => x.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).not.toContain(bk)
  })
})

/**
 * BKL-01: قاعدة الوصول الموحّدة — «القراءة تتبع الوصول الممنوح صراحةً».
 * توكن الكرّاسة يمنح قراءة أدلتها المضمّنة **عبره وحده**: لا تصير عامة،
 * ولا تظهر في قائمة أو بحث، وسحب الرابط يقطع الوصول فورًا.
 */
describe('BKL: توكن الكرّاسة وأدلتها المضمّنة', () => {
  async function bookletWithEmbed(app: App, cookie: string, embedTitle: string) {
    const inner = await create(app, cookie, guide(embedTitle))
    const bk = await create(
      app,
      cookie,
      guide('كرّاسة', {
        kind: 'booklet',
        steps: [blockStep({ block: 'embed', embed: { guideId: inner, expanded: false } })],
      }),
    )
    const share = await app.inject({ method: 'POST', url: `/api/guides/${bk}/share`, headers: { cookie } })
    expect(share.statusCode).toBe(200)
    return { inner, bk, token: share.json().token as string }
  }

  it('ضيف يقرأ الدليل الخاص المضمّن عبر توكن الكرّاسة وحده', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk8-${Date.now()}@a.co`)
    const { inner, token } = await bookletWithEmbed(app, cookie, 'دليل خاص')

    const res = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { embeds?: Record<string, { title: string }> }
    expect(body.embeds?.[inner]?.title).toBe('دليل خاص')

    // ولا يتسرّب خارج التوكن: الدليل نفسه يبقى خلف الدخول
    const direct = await app.inject({ method: 'GET', url: `/api/guides/${inner}` })
    expect(direct.statusCode).toBe(401)
  })

  it('سحب رابط الكرّاسة يقطع الوصول للأدلة المضمّنة فورًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk9-${Date.now()}@a.co`)
    const { bk, token } = await bookletWithEmbed(app, cookie, 'خاص')
    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${bk}/share`, headers: { cookie } })
    expect(del.statusCode).toBe(200)
    const res = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(res.statusCode).toBe(404)
  })

  it('دليل مضمّن حُذف لا يُسقط الكرّاسة — يغيب من embeds بلا انهيار', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk10-${Date.now()}@a.co`)
    const { inner, token } = await bookletWithEmbed(app, cookie, 'سيُحذف')
    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${inner}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)

    const res = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { guide: { steps: unknown[] }; embeds?: Record<string, unknown> }
    expect(body.guide.steps).toHaveLength(1)
    expect(body.embeds?.[inner]).toBeUndefined()
  })

  /**
   * بلاغ المالك 2026-09-07: بطاقة الدليل المضمّن تحتاج حقيقة حالته. السلة ليست حذفًا،
   * فلا تُعرض بطاقةً عاديةً ولا تُدّعى محذوفة — التفصيل يأتي من الخادم لا من تخمين العميل.
   */
  it('تفاصيل دليل في السلة تحمل deletedAt — والعميل يميّز السلة من الغياب', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk12-${Date.now()}@a.co`)
    const g = await create(app, cookie, guide('سيدخل السلة'))
    const before = await app.inject({ method: 'GET', url: `/api/guides/${g}`, headers: { cookie } })
    expect(before.json().deletedAt).toBeUndefined()

    expect((await app.inject({ method: 'DELETE', url: `/api/guides/${g}`, headers: { cookie } })).statusCode).toBe(204)
    const after = await app.inject({ method: 'GET', url: `/api/guides/${g}`, headers: { cookie } })
    expect(after.statusCode).toBe(200)
    expect(typeof after.json().deletedAt).toBe('string')
  })

  it('دليل عادي (لا كرّاسة) لا يحمل embeds إطلاقًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, `bk11-${Date.now()}@a.co`)
    const g = await create(app, cookie, guide('دليل'))
    const share = await app.inject({ method: 'POST', url: `/api/guides/${g}/share`, headers: { cookie } })
    const res = await app.inject({ method: 'GET', url: `/api/share/${share.json().token}` })
    expect(res.json().embeds).toBeUndefined()
  })
})
