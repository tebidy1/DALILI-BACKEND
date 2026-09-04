import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { randomTestPassword } from './helpers'

/** SEC-01 — تحديد المعدّل: كود ميت كان يوهم بحماية؛ هذا الاختبار يثبت وجودها الفعلي */
describe('تحديد المعدّل على المصادقة (SEC-01)', () => {
  let app: import('fastify').FastifyInstance
  let close: () => Promise<void>

  afterAll(async () => {
    if (close) await close()
  })

  it('خمس محاولات دخول فاشلة ثم 429 برسالة عربية صادقة', { timeout: 15000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-rl-'))
    const built = await createApp({
      dataDir: dir,
      cookieSecret: 'test-secret-not-for-production',
      publicBase: 'http://localhost:8787',
      rateLimit: true,
    })
    app = built.app
    close = built.close

    const email = `rl-${Date.now()}@a.co`
    const password = randomTestPassword()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password } })
    expect(reg.statusCode).toBe(200)

    // خمس محاولات فاشلة — كلها 401 لا أكثر
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong-password' } })
      expect(res.statusCode, `المحاولة ${i + 1} يجب أن تكون 401`).toBe(401)
    }
    // السادسة محجوبة بالمعدّل — 429 ورسالة عربية
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong-password' } })
    expect(blocked.statusCode).toBe(429)
    const body = blocked.json() as { errorAr?: string }
    expect(body.errorAr).toBeTruthy()
    expect(body.errorAr).toMatch(/انتظر/)
  })

  it('الطلب الناجح ضمن الحد لا يُحجب — التسجيل مرة إضافية يعمل', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `rl2-${Date.now()}@a.co`, password: randomTestPassword() },
    })
    // سجل التسجيل له حدّه المستقل — طلبان فقط حتى الآن
    expect(res.statusCode).toBe(200)
  })
})
