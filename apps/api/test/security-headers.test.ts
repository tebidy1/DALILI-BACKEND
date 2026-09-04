import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers'

describe('SEC-02: ترويسات الأمان', () => {
  it('كل الاستجابات تحمل nosniff وCSP صارمًا وإغلاق التأطير', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('مسارات المشاركة العمومية تحمل X-Robots-Tag: noindex', async () => {
    const { app } = await buildTestApp()
    const share = await app.inject({ method: 'GET', url: '/api/share/does-not-exist' })
    expect(share.statusCode).toBe(404)
    expect(share.headers['x-robots-tag']).toBe('noindex')

    const file = await app.inject({ method: 'GET', url: '/files/does-not-exist' })
    expect(file.statusCode).toBe(404)
    expect(file.headers['x-robots-tag']).toBe('noindex')
  })

  it('ملفات اللقطات تُقدَّم بسياسة CORP تسمح للويب والامتداد بعرضها عبر الأصول', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/files/does-not-exist' })
    // الافتراضي في helmet هو same-origin وسيفكّ عرض اللقطات من localhost:5174 — يجب فتحه
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
  })
})
