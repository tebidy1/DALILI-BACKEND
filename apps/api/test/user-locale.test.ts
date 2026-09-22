import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

/**
 * لغة الواجهة (I18N-01): مرآة خيار الثيم — الاختيار يُخزَّن على الخادم لكل مستخدم
 * كي يتبعه الموقع والامتداد معًا — overview يحمل myLocale، وPUT /api/me/locale يكتبه.
 */
describe('لغة الواجهة المُخزَّنة على الخادم', () => {
  it('overview يحمل myLocale الافتراضي ar للمستخدم الجديد', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'locale1@dalili.sa')
    const res = await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().myLocale).toBe('ar')
  })

  it('PUT /api/me/locale يحفظ الاختيار فيظهر في overview التالي', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'locale2@dalili.sa')
    const put = await app.inject({
      method: 'PUT',
      url: '/api/me/locale',
      headers: { cookie },
      payload: { locale: 'en' },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().myLocale).toBe('en')

    const ov = await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie } })
    expect(ov.json().myLocale).toBe('en')
  })

  it('قيمة غريبة → 400 برسالة عربية — والقيمة المخزنة لا تُمس', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'locale3@dalili.sa')
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/me/locale',
      headers: { cookie },
      payload: { locale: 'fr' },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().errorAr).toContain('بيانات غير صالحة')

    const ov = await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie } })
    expect(ov.json().myLocale).toBe('ar')
  })

  it('بدون جلسة → 401 برسالة عربية', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'PUT', url: '/api/me/locale', payload: { locale: 'ar' } })
    expect(res.statusCode).toBe(401)
    expect(res.json().errorAr).toBe('يجب تسجيل الدخول أولًا')
  })
})
