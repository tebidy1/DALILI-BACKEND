import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assembleGuide, type RawStep } from '@dalili/core'
import type { TranslateItem } from '../src/translate/payload'
import type { TranslateProvider } from '../src/translate/provider'
import { createApp } from '../src/app'
import { buildTestApp, randomTestPassword, registerUser } from './helpers'

/** TRNS-01: مسار الترجمة — ملكية حصرًا، 503 بلا مزوّد، الأسرار لا تصل المزوّد،
 *  النجاح يخزّن الطبقة ولا يرفع updatedAt (مشتقّة لا محتوى) */

function makeGuide(n = 2): ReturnType<typeof assembleGuide> {
  const raw: RawStep[] = [
    { kind: 'navigate', target: {}, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 1 },
  ]
  for (let i = 0; i < n - 1; i++) {
    raw.push({
      kind: 'click',
      target: { text: `زر الفواتير ${i + 1}` },
      url: 'https://erp.example/invoices',
      pageTitle: 'الفواتير',
      ts: 2 + i,
    })
  }
  return assembleGuide(raw)
}

const seen: TranslateItem[] = []
const fake: TranslateProvider = {
  name: 'fake:tx',
  async translate(req) {
    seen.push(...req.items)
    return req.items.map((i) => ({ id: i.id, text: `EN:${i.text}` }))
  },
}

/** تطبيق مستقل بمزوّد مزيف — لا يعبث بكاش helpers المشترك */
async function buildFakeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-tx-'))
  const { app, close } = await createApp({
    dataDir: dir,
    cookieSecret: 'test-secret-not-for-production',
    publicBase: 'http://localhost:8787',
    translate: fake,
  })
  return { app, close }
}

async function createGuideWithSecret(app: { inject: (o: unknown) => Promise<{ statusCode: number; json: () => unknown }> }, cookie: string) {
  const g = makeGuide(2) as unknown as { steps: Array<{ value?: string; sensitive?: boolean; screenshot?: Record<string, unknown> }> }
  g.steps[1]!.value = 'TOPSECRET'
  g.steps[1]!.sensitive = true
  // لقطة على الخطوة الأولى — تثبت أن رد الترجمة يعيد روابط الصور موقَّعة كمسار القراءة
  g.steps[0]!.screenshot = { fileId: 'shot0001', blurRects: [] }
  const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: g } })
  expect(created.statusCode).toBe(200)
  return (created.json() as { id: string }).id
}

describe('مسار ترجمة الدليل TRNS-01', () => {
  it('401 بلا جلسة · 503 بلا مزوّد برسالة عربية تذكر المفتاح', async () => {
    const { app } = await buildTestApp()
    const noAuth = await app.inject({ method: 'POST', url: '/api/guides/g1/translate', payload: { locale: 'en' } })
    expect(noAuth.statusCode).toBe(401)

    const { cookie } = await registerUser(app, 'tx1@dalili.sa')
    const created = await app.inject({
      method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: makeGuide(2) },
    })
    const id = (created.json() as { id: string }).id
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/translate`, headers: { cookie }, payload: { locale: 'en' } })
    expect(res.statusCode).toBe(503)
    expect(res.json().errorAr).toContain('GROQ_API_KEY')
  })

  it('404 لدليل مستخدم آخر · 400 لجسم غريب', async () => {
    const { app, close } = await buildFakeApp()
    try {
      const owner = await registerUser(app, 'tx-owner@dalili.sa')
      const other = await registerUser(app, 'tx-other@dalili.sa')
      const id = await createGuideWithSecret(app, owner.cookie)

      const foreign = await app.inject({
        method: 'POST', url: `/api/guides/${id}/translate`, headers: { cookie: other.cookie }, payload: { locale: 'en' },
      })
      expect(foreign.statusCode).toBe(404)

      const bad = await app.inject({
        method: 'POST', url: `/api/guides/${id}/translate`, headers: { cookie: owner.cookie }, payload: { locale: 'ar' },
      })
      expect(bad.statusCode).toBe(400)
    } finally {
      await close()
    }
  })

  it('النجاح: يخزّن الطبقة ويرد الدليل، ولا يرفع updatedAt، والسر لا يصل المزوّد', async () => {
    const { app, close } = await buildFakeApp()
    try {
      seen.length = 0
      const { cookie } = await registerUser(app, 'tx2@dalili.sa', randomTestPassword())
      const id = await createGuideWithSecret(app as never, cookie)

      const before = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
      const beforeUpdatedAt = (before.json().guide as { updatedAt: string }).updatedAt

      const res = await app.inject({
        method: 'POST', url: `/api/guides/${id}/translate`, headers: { cookie }, payload: { locale: 'en' },
      })
      expect(res.statusCode).toBe(200)
      const tx = (res.json() as { guide: { translations?: { en?: { items: Record<string, string>; meta: { provider: string } } }; updatedAt: string; steps: Array<{ screenshot?: { fileUrl?: string } }> } }).guide
      expect(tx.translations!.en!.items['title']).toMatch(/^EN:/)
      expect(tx.translations!.en!.meta.provider).toBe('fake:tx')
      expect(tx.updatedAt).toBe(beforeUpdatedAt) // مشتقّة لا محتوى — لا رفع ختم
      // انحدار بلاغ 2026-09-25: روابط صور الرد موقَّعة (e+c) كمسار القراءة — وإلا انكسرت الصور بالمحرر
      expect(tx.steps[0]!.screenshot!.fileUrl).toMatch(/^\/files\/shot0001\?e=\d+&c=/)

      const after = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
      const afterTx = (after.json().guide as { translations?: { en?: { items: Record<string, string> } } }).translations
      expect(afterTx!.en!.items['title']).toMatch(/^EN:/)

      // الأسرار والقيم لا تصل المزوّد من حدود المسار أيضًا
      expect(JSON.stringify(seen)).not.toContain('TOPSECRET')
    } finally {
      await close()
    }
  })

  it('دليل بلا أي نص قابل للترجمة ⇒ 400', async () => {
    const { app, close } = await buildFakeApp()
    try {
      const { cookie } = await registerUser(app, 'tx3@dalili.sa')
      const empty = makeGuide(1)
      const e = empty as unknown as {
        title: string
        steps: Array<{ title: string; url?: string; pageTitle?: string; target: { text?: string } }>
      }
      e.title = ''
      e.steps.forEach((s) => {
        s.title = ''
        s.url = ''
        s.pageTitle = ''
        delete s.target.text
      })
      const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: empty } })
      const id = (created.json() as { id: string }).id
      const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/translate`, headers: { cookie }, payload: { locale: 'en' } })
      expect(res.statusCode).toBe(400)
      expect(res.json().errorAr).toContain('لا نص')
    } finally {
      await close()
    }
  })
})
