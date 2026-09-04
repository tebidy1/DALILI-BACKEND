import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

describe('المصادقة', () => {
  it('تسجيل → جلسة → me → خروج', async () => {
    const { app } = await buildTestApp()
    const { cookie, me } = await registerUser(app, 'test1@dalili.sa')
    expect(me.email).toBe('test1@dalili.sa')

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(meRes.statusCode).toBe(200)

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(after.statusCode).toBe(401)
  })

  it('بدون جلسة: 401 برسالة عربية', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json().errorAr).toBe('يجب تسجيل الدخول أولًا')
  })

  it('بريد مكرر → 409', async () => {
    const { app } = await buildTestApp()
    await registerUser(app, 'dup@dalili.sa')
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'dup@dalili.sa', password: 'password123' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().errorAr).toContain('مسجّل مسبقًا')
  })

  it('مدخلات فاسدة → 400 عربي', async () => {
    const { app } = await buildTestApp()
    const short = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@y.z', password: '123' },
    })
    expect(short.statusCode).toBe(400)
    expect(short.json().errorAr).toContain('بيانات غير صالحة')
  })

  it('SEC-03: دخول جديد يُصدر معرّف جلسة جديدًا ويُبطل القديم', async () => {
    const { app } = await buildTestApp()
    const { cookie, password } = await registerUser(app, 'rotate@dalili.sa')
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie },
      payload: { email: 'rotate@dalili.sa', password },
    })
    expect(login.statusCode).toBe(200)
    const raw = login.headers['set-cookie']
    const newCookie = ((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0]!
    expect(newCookie).not.toBe(cookie)

    const oldMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(oldMe.statusCode).toBe(401)
    const newMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: newCookie } })
    expect(newMe.statusCode).toBe(200)
  })

  it('SEC-03: تسجيل حساب جديد بجلسة قائمة يدوّرها أيضًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'rotate-a@dalili.sa')
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { cookie },
      payload: { email: 'rotate-b@dalili.sa', password: 'password123456' },
    })
    expect(reg.statusCode).toBe(200)
    const raw = reg.headers['set-cookie']
    const newCookie = ((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0]!
    expect(newCookie).not.toBe(cookie)

    const oldMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(oldMe.statusCode).toBe(401)
  })

  it('دخول خاطئ → 401 برسالة موحدة', async () => {
    const { app } = await buildTestApp()
    await registerUser(app, 'login@dalili.sa', 'password123')
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@dalili.sa', password: 'wrong-password' },
    })
    expect(bad.statusCode).toBe(401)
    expect(bad.json().errorAr).toBe('البريد أو كلمة المرور غير صحيحة')
    const good = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login@dalili.sa', password: 'password123' },
    })
    expect(good.statusCode).toBe(200)
    const raw = good.headers['set-cookie']
    const firstCookie = (Array.isArray(raw) ? raw[0] : raw) ?? ''
    expect(firstCookie).toContain('dalili_sid')
  })
})
