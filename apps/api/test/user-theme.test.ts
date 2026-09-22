import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

/**
 * خيار الثيم (2026-09-06): الاختيار يُخزَّن على الخادم لكل مستخدم كي يتبعه
 * الموقع والامتداد معًا — overview يحمل myTheme، وPUT /api/me/theme يكتبه.
 */
describe('خيار الثيم المُخزَّن على الخادم', () => {
  it('overview يحمل myTheme الافتراضي brand للمستخدم الجديد', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'theme1@dalili.sa')
    const res = await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().myTheme).toBe('brand')
  })

  it('PUT /api/me/theme يحفظ الاختيار فيظهر في overview التالي', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'theme2@dalili.sa')
    const put = await app.inject({
      method: 'PUT',
      url: '/api/me/theme',
      headers: { cookie },
      payload: { theme: 'classic' },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().myTheme).toBe('classic')

    const ov = await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie } })
    expect(ov.json().myTheme).toBe('classic')
  })

  it('قيمة غريبة → 400 برسالة عربية — والقيمة المخزنة لا تُمس', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'theme3@dalili.sa')
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/me/theme',
      headers: { cookie },
      payload: { theme: 'neon' },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().errorAr).toContain('بيانات غير صالحة')

    const ov = await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie } })
    expect(ov.json().myTheme).toBe('brand')
  })

  it('بدون جلسة → 401 برسالة عربية', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'PUT', url: '/api/me/theme', payload: { theme: 'brand' } })
    expect(res.statusCode).toBe(401)
    expect(res.json().errorAr).toBe('يجب تسجيل الدخول أولًا')
  })
})
