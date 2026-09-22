import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers'
import { checkReady } from '../src/lib/ready'
import { applyNodeEnv } from '../src/env'

describe('OPS-02: فحص الجهوزية /ready', () => {
  it('خادم سليم → 200 {ready:true} ومعرّف طلب x-request-id', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ready: true, db: true, files: true })
    expect(res.headers['x-request-id']).toBeTruthy()
  })

  it('checkReady تكتشف قاعدة معطّلة وتنطق بالعربية', () => {
    const broken = {
      prepare() {
        throw new Error('sqlite: closed')
      },
    }
    const r = checkReady(broken as never, process.cwd())
    expect(r.ok).toBe(false)
    expect(r.errorAr).toContain('غير جاهزة')
  })

  it('checkReady تقبل قاعدة سليمة', () => {
    // sqlite الحقيقي يعيد صفًا {ok:1} — الفاك يحاكي العقد نفسه
    const ok = { prepare: () => ({ get: () => ({ ok: 1 }) }) }
    expect(checkReady(ok as never, process.cwd()).ok).toBe(true)
  })
})

describe('OPS-06: NODE_ENV من .env', () => {
  it('applyNodeEnv يوصل production من الخريطة إلى process.env', () => {
    const prev = process.env.NODE_ENV
    try {
      delete process.env.NODE_ENV
      expect(applyNodeEnv({})).toBeUndefined()
      expect(applyNodeEnv({ NODE_ENV: 'production' })).toBe('production')
      expect(process.env.NODE_ENV).toBe('production')
      expect(applyNodeEnv({ NODE_ENV: 'development' })).toBe('development')
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })

  it('قيمة غريبة تُهمل — لا نصف إنتاج بلا قصد', () => {
    const prev = process.env.NODE_ENV
    try {
      delete process.env.NODE_ENV
      applyNodeEnv({ NODE_ENV: 'prod-ish' })
      expect(process.env.NODE_ENV).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })
})
