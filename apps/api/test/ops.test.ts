import { afterEach, describe, expect, it } from 'vitest'
import { parseEnv } from '../src/env'

/** OPS-05: تحقق .env بzod عند الإقلاع — فشل مبكر برسالة عربية تسمّي المفتاح المذنب */
describe('parseEnv (OPS-05)', () => {
  it('الافتراضات الذاتية: أول إقلاع بلا .env يعمل بقيم سليمة', () => {
    const env = parseEnv({})
    expect(env.port).toBe(8787)
    expect(env.dataDir).toContain('data')
    expect(env.cookieSecret.length).toBeGreaterThanOrEqual(16)
    expect(env.publicBase).toBe('http://localhost:8787')
  })

  it('قيم صالحة تمر كما هي', () => {
    const env = parseEnv({
      PORT: '9000',
      DATA_DIR: 'mydata',
      COOKIE_SECRET: 'very-secret-value-1234',
      PUBLIC_BASE: 'https://api.dalili.sa',
    })
    expect(env.port).toBe(9000)
    expect(env.publicBase).toBe('https://api.dalili.sa')
  })

  it('PORT غير الرقمي يُرفض برسالة تسمّيه', () => {
    expect(() => parseEnv({ PORT: 'abc', COOKIE_SECRET: 'very-secret-value-1234' })).toThrow(/PORT/)
  })

  it('COOKIE_SECRET القصير يُرفض — سر ضعيف = رفض لا صمت', () => {
    expect(() => parseEnv({ COOKIE_SECRET: 'short' })).toThrow(/COOKIE_SECRET/)
  })

  it('PUBLIC_BASE ليس رابط http(s) يُرفض', () => {
    expect(() => parseEnv({ PUBLIC_BASE: 'ftp://x', COOKIE_SECRET: 'very-secret-value-1234' })).toThrow(/PUBLIC_BASE/)
  })

  it('DATA_DIR الفارغ يُرفض', () => {
    expect(() => parseEnv({ DATA_DIR: '', COOKIE_SECRET: 'very-secret-value-1234' })).toThrow(/DATA_DIR/)
  })

  it('GROQ_API_KEY (VOX-04) يُمرَّر عند وجوده وغيابه لا يكسر الإقلاع', () => {
    const secret = 'very-secret-value-1234'
    expect(parseEnv({ COOKIE_SECRET: secret }).groqApiKey).toBeUndefined()
    expect(parseEnv({ COOKIE_SECRET: secret, GROQ_API_KEY: 'gsk_abc123' }).groqApiKey).toBe('gsk_abc123')
  })
})

/** SEC-05: سياسة الكوكي حسب البيئة — التطوير none (للامتداد) والإنتاج lax (نطاق واحد https) */
describe('cookiePolicy (SEC-05)', () => {
  afterEach(() => {
    delete process.env.NODE_ENV
  })

  it('الوضع الافتراضي (تطوير): sameSite=none + secure — الامتداد يعمل', async () => {
    const { cookiePolicy } = await import('../src/auth/session')
    expect(cookiePolicy()).toMatchObject({ sameSite: 'none', secure: true })
  })

  it('NODE_ENV=production: sameSite=lax + secure — نطاق واحد https', async () => {
    process.env.NODE_ENV = 'production'
    const { cookiePolicy } = await import('../src/auth/session')
    expect(cookiePolicy()).toMatchObject({ sameSite: 'lax', secure: true })
  })

  it('تسجيل الدخول في الإنتاج يضبط الكوكي lax فعليًا', async () => {
    const { buildTestApp, registerUser } = await import('./helpers')
    process.env.NODE_ENV = 'production'
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'cookie-prod@dalili.sa', password: 'password123' } })
    expect(res.statusCode).toBe(200)
    const setCookie = res.headers['set-cookie']!
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? ''
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie.toLowerCase()).toContain('secure')
  })

  it('تسجيل الدخول في التطوير يبقى none (الامتداد شريك أول)', async () => {
    const { buildTestApp } = await import('./helpers')
    delete process.env.NODE_ENV
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'cookie-dev@dalili.sa', password: 'password123' } })
    const setCookie = res.headers['set-cookie']!
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? ''
    expect(cookie).toContain('SameSite=None')
  })
})
