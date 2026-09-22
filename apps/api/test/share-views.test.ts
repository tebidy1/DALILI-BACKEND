import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

let seq = 0
async function createGuide(app: import('fastify').FastifyInstance, cookie: string, title: string) {
  const now = new Date().toISOString()
  const res = await app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: { cookie },
    payload: {
      guide: {
        id: `sv-${Date.now()}-${seq++}`,
        schemaVersion: 1,
        title,
        locale: 'ar',
        dir: 'rtl',
        createdAt: now,
        updatedAt: now,
        steps: [],
      },
    },
  })
  return res.json().id as string
}

describe('VIEW-06: عدّاد مشاهدات مجمّع مجهول الهوية', () => {
  it('مشاركة جديدة = صفر مشاهدات، وكل زيارة عامة تزيد العدّاد مرة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'views1@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل العدّاد')
    const share = await app.inject({ method: 'POST', url: `/api/guides/${gid}/share`, headers: { cookie } })
    const token = share.json().token

    const before = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie } })
    expect(before.json().share.views).toBe(0)

    for (let i = 0; i < 3; i++) {
      const view = await app.inject({ method: 'POST', url: `/api/share/${token}/view` })
      expect(view.statusCode).toBe(204)
    }
    const after = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie } })
    expect(after.json().share.views).toBe(3)
  })

  it('رمز مسحوب أو دليل في السلة: العدّاد يرفض (404) ولا يزيد', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'views2@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل عدّاد مسحوب')
    const share = await app.inject({ method: 'POST', url: `/api/guides/${gid}/share`, headers: { cookie } })
    const token = share.json().token
    await app.inject({ method: 'DELETE', url: `/api/guides/${gid}/share`, headers: { cookie } })

    const view = await app.inject({ method: 'POST', url: `/api/share/${token}/view` })
    expect(view.statusCode).toBe(404)

    // سحب الرابط يخفي معلومات المشاركة كاملة من صاحبها — لا عدّاد بعد السحب
    const info = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie } })
    expect(info.json().share).toBeNull()
  })

  it('رمز غير موجود → 404 برسالة عربية', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'POST', url: '/api/share/no-such-token/view' })
    expect(res.statusCode).toBe(404)
    expect(res.json().errorAr).toBeTruthy()
  })
})
