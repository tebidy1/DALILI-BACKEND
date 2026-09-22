import { describe, expect, it } from 'vitest'
import { assembleGuide } from '@dalili/core'
import { buildTestApp, registerUser } from './helpers'

function makeGuide() {
  return assembleGuide([
    { kind: 'navigate', target: {}, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 1 },
    { kind: 'click', target: { text: 'إنشاء فاتورة' }, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 2, screenshot: { fileId: 'f-test', blurRects: [] } },
  ])
}

describe('الأدلة والمشاركة', () => {
  it('دورة كاملة: إنشاء → قائمة → جلب → تحرير → مشاركة → عام → سحب → حذف', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'guides@dalili.sa')

    const unauth = await app.inject({ method: 'POST', url: '/api/guides', payload: { guide: makeGuide() } })
    expect(unauth.statusCode).toBe(401)

    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: makeGuide() } })
    expect(created.statusCode).toBe(200)
    const id = (created.json() as { id: string }).id

    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    const summaries = list.json() as { items: { id: string; stepCount: number; shared: boolean }[] }
    expect(summaries.items.find((s) => s.id === id)?.stepCount).toBe(2)

    const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
    expect((got.json().guide as { title: string }).title).toBe('دليل: الفواتير')

    const edited = makeGuide()
    edited.title = 'دليل الفواتير المعدّل'
    edited.steps[1]!.note = 'اضغط هنا دائمًا بعد مراجعة الرقم'
    const patch = await app.inject({ method: 'PATCH', url: `/api/guides/${id}`, headers: { cookie }, payload: { guide: edited } })
    expect(patch.statusCode).toBe(200)
    const listAfter = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })).json() as { items: { id: string; title: string }[] }
    expect(listAfter.items.find((s) => s.id === id)?.title).toBe('دليل الفواتير المعدّل')

    const share = await app.inject({ method: 'POST', url: `/api/guides/${id}/share`, headers: { cookie } })
    expect(share.statusCode).toBe(200)
    const { token, shareUrl } = share.json() as { token: string; shareUrl: string }
    expect(shareUrl).toBe(`http://localhost:8787/s/${token}`)

    const pub = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(pub.statusCode).toBe(200)
    const pubBody = pub.json() as { guide: { steps: unknown[] }; sharedAt: string }
    expect(pubBody.guide.steps).toHaveLength(2)

    const revoked = await app.inject({ method: 'DELETE', url: `/api/guides/${id}/share`, headers: { cookie } })
    expect(revoked.statusCode).toBe(200)
    const pubAfter = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(pubAfter.statusCode).toBe(404)
    expect(pubAfter.json().errorAr).toContain('سحبه')

    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${id}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)
  })

  it('عزل المستخدمين: دليل غيرك = 404 لا 403 (لا كشف وجود)', async () => {
    const { app } = await buildTestApp()
    const { cookie: c1 } = await registerUser(app, 'owner@dalili.sa')
    const { cookie: c2 } = await registerUser(app, 'intruder@dalili.sa')
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie: c1 }, payload: { guide: makeGuide() } })
    const id = (created.json() as { id: string }).id
    const res = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie: c2 } })
    expect(res.statusCode).toBe(404)
  })

  it('دليل فاسد → 400', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'valid@dalili.sa')
    const res = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: { guide: { id: 'x', schemaVersion: 99 } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toContain('دليل غير صالح')
  })
})
