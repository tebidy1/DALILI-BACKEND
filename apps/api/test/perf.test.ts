import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'
import { assembleGuide } from '@dalili/core'
import { createApp } from '../src/app'
import type { EmbeddingProvider } from '../src/embeddings/provider'
import { buildTestApp, registerUser } from './helpers'

/**
 * PERF-01: ميزانيات مقيسة في §3/01-engineering-standards — تجاوزها عطل لا ملاحظة.
 * القائمة p95 < 100ms على 50 دليلًا، والبحث p95 < 300ms، والبحث المدمج (حرفي+دلالي RRF) < 300ms على 200 دليل.
 */

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!
}

describe('ميزانيات الأداء (PERF-01)', () => {
  it('GET /api/guides على 50 دليلًا: p95 < 100ms', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'perf@dalili.sa')
    const raw = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://erp.example.com/invoices', pageTitle: 'الفواتير', ts: 1 },
      { kind: 'click', target: { text: 'إنشاء فاتورة توريد' }, url: 'https://erp.example.com/invoices', pageTitle: 'الفواتير', ts: 2 },
    ])
    for (let i = 0; i < 50; i++) {
      const g = JSON.parse(JSON.stringify(raw)) as typeof raw
      g.title = `دليل فواتير رقم ${i}`
      g.steps[1]!.note = `ملاحظة خاصة ${i}`
      const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: g } })
      expect(res.statusCode).toBe(200)
    }

    // إحماء (فهرس/sqlite cache) ثم قياس
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: '/api/guides?limit=50', headers: { cookie } })
    const samples: number[] = []
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now()
      const res = await app.inject({ method: 'GET', url: '/api/guides?limit=50', headers: { cookie } })
      samples.push(performance.now() - t0)
      expect(res.statusCode).toBe(200)
      expect((res.json() as { items: unknown[] }).items).toHaveLength(50)
    }
    const p95List = p95(samples)
    expect(p95List).toBeLessThan(100)
  })

  it('GET /api/search على 50 دليلًا: p95 < 300ms', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'perf-s@dalili.sa')
    const raw = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://erp.example.com/invoices', pageTitle: 'الفواتير', ts: 1 },
      { kind: 'click', target: { text: 'اعتماد أمر الشراء' }, url: 'https://erp.example.com/invoices', pageTitle: 'الفواتير', ts: 2 },
    ])
    for (let i = 0; i < 50; i++) {
      const g = JSON.parse(JSON.stringify(raw)) as typeof raw
      g.title = `اعتماد أمر شراء فرع ${i}`
      await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: g } })
    }
    const q = encodeURIComponent('اعتماد أمر الشراء')
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: `/api/search?q=${q}`, headers: { cookie } })
    const samples: number[] = []
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now()
      const res = await app.inject({ method: 'GET', url: `/api/search?q=${q}`, headers: { cookie } })
      samples.push(performance.now() - t0)
      expect(res.statusCode).toBe(200)
    }
    expect(p95(samples)).toBeLessThan(300)
  })

  it('البحث المدمج حرفي+دلالي (RRF وقصّ الثقة) على 200 دليل: p95 < 300ms', async () => {
    // مزوّد حتمي رخيص كي يقيس خط الأنابيب المدمج كله لا حمل النموذج
    const V_ITEM = new Float32Array([1, 0])
    const V_OTHER = new Float32Array([0, 1])
    const provider: EmbeddingProvider = {
      name: 'fake:perf-rrf',
      async embedPassages(texts) {
        return texts.map((t) => (t.includes('شراء') ? V_ITEM : V_OTHER))
      },
      async embedQuery() {
        return V_ITEM
      },
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-perf-rrf-'))
    const built = await createApp({
      dataDir: dir,
      cookieSecret: 'test-secret-not-for-production',
      publicBase: 'http://localhost:8787',
      embeddings: provider,
    })
    afterAll(async () => {
      await built.close()
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const { app } = built
    const { cookie } = await registerUser(app, `perf-rrf-${Date.now()}@dalili.sa`)
    const raw = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://erp.example.com/invoices', pageTitle: 'الفواتير', ts: 1 },
      { kind: 'click', target: { text: 'اعتماد أمر الشراء' }, url: 'https://erp.example.com/invoices', pageTitle: 'الفواتير', ts: 2 },
    ])
    for (let i = 0; i < 200; i++) {
      const g = JSON.parse(JSON.stringify(raw)) as typeof raw
      g.title = `اعتماد أمر شراء فرع ${i}`
      const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: g } })
      expect(res.statusCode).toBe(200)
    }
    const q = encodeURIComponent('اعتماد أمر الشراء')
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: `/api/search?q=${q}`, headers: { cookie } })
    const samples: number[] = []
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now()
      const res = await app.inject({ method: 'GET', url: `/api/search?q=${q}`, headers: { cookie } })
      samples.push(performance.now() - t0)
      expect(res.statusCode).toBe(200)
      const body = res.json() as { hits: unknown[]; semantic?: unknown[] }
      expect(body.hits.length).toBeGreaterThan(0) // مدمج فعلًا: الحرفي حاضر في كل عينة
      expect(body.semantic?.length).toBeGreaterThan(0)
    }
    expect(p95(samples)).toBeLessThan(300)
  })
}, { timeout: 60000 })
