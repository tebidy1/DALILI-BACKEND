import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assembleGuide, type TranscriptSegment } from '@dalili/core'
import { createApp } from '../src/app'
import type { SttProvider } from '../src/stt/provider'
import { registerUser, randomTestPassword } from './helpers'

/**
 * VOX-09 «ميك الخطوة»: نقطة تفريغ تعليقات الخطوات — لكل خطوةvoice بملف مرفوع
 * يُفرَّغ صوتها ويُدمج بملاحظتها (فارغة→ملء، مكتوبة→إلحاق بسطر) مع حفظ الدليل
 * وفهرسه في نفس المعاملة. الأخطاء صادقة: 404 عزل · 503 بلا مفتاح · 502 مزوّد.
 */

const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x10])

function fakeStt(segments: TranscriptSegment[]): SttProvider {
  return {
    name: 'fake',
    async transcribe() {
      return segments
    },
  }
}

function failingStt(): SttProvider {
  return {
    name: 'fake-failing',
    async transcribe() {
      throw new Error('provider down')
    },
  }
}

async function buildWith(stt: SttProvider | undefined) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-memo-steps-'))
  const built = await createApp({
    dataDir: dir,
    cookieSecret: 'test-secret-not-for-production',
    publicBase: 'http://localhost:8787',
    stt,
  })
  afterAll(() => built.close())
  return { ...built, dir }
}

async function uploadAudio(app: import('fastify').FastifyInstance, cookie: string): Promise<string> {
  const body = Buffer.concat([
    Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="v.webm"\r\nContent-Type: audio/webm\r\n\r\n'),
    Buffer.concat([WEBM_MAGIC, Buffer.alloc(1_024)]),
    Buffer.from('\r\n--b--\r\n'),
  ])
  const res = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { cookie, 'content-type': 'multipart/form-data; boundary=b' },
    payload: body,
  })
  return (res.json() as { fileId: string }).fileId
}

/** دليل بخطوتين: الأولى بتعليق صوتي، والثانية بتعليق وملاحظة مكتوبة يدويًا */
async function createMemoGuide(
  app: import('fastify').FastifyInstance,
  cookie: string,
  fileId: string,
  fileId2: string,
) {
  const base = assembleGuide([
    { kind: 'click', url: 'https://erp.test/a', pageTitle: 'أ', ts: 1 },
    { kind: 'click', url: 'https://erp.test/b', pageTitle: 'ب', ts: 2, note: 'ملاحظة يدوية' },
  ])
  base.steps[0]!.voice = { fileId, durationMs: 5_000 }
  base.steps[1]!.voice = { fileId: fileId2, durationMs: 8_000 }
  const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: base } })
  expect(created.statusCode).toBe(200)
  return (created.json() as { id: string }).id
}

async function getNotes(app: import('fastify').FastifyInstance, cookie: string, id: string) {
  const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
  return (got.json().guide as { steps: Array<{ id: string; note?: string; voice?: { pending?: boolean } }> }).steps
}

describe('POST /api/guides/:id/transcribe-steps', () => {
  it('يملأ الملاحظة الفارغة ويُلحق أسفل المكتوبة بسطر — ويعطّل pending بعد المعالجة', async () => {
    const { app } = await buildWith(fakeStt([{ text: 'انقر الأيقونة كذا', startMs: 0 }]))
    const { cookie } = await registerUser(app, `memo1-${Date.now()}@a.co`, randomTestPassword())
    const f1 = await uploadAudio(app, cookie)
    const f2 = await uploadAudio(app, cookie)
    const id = await createMemoGuide(app, cookie, f1, f2)
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe-steps`, headers: { cookie } })
    expect(res.statusCode, res.body).toBe(200)
    const body = res.json() as { results: Array<{ stepId: string; ok: boolean }> }
    expect(body.results).toHaveLength(2)
    expect(body.results.every((r) => r.ok)).toBe(true)
    const steps = await getNotes(app, cookie, id)
    expect(steps[0]!.note).toBe('انقر الأيقونة كذا')
    expect(steps[1]!.note).toBe('ملاحظة يدوية\nانقر الأيقونة كذا')
    // المعالجة تُعلَّم — تفريغ لاحق يبلغ «تمّت» بلا إلحاق مكرر
    expect(steps[0]!.voice?.pending).toBe(false)
    const again = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe-steps`, headers: { cookie } })
    const againResults = (again.json() as { results: Array<{ ok: boolean }> }).results
    expect(againResults.every((r) => r.ok)).toBe(true)
    const notes2 = await getNotes(app, cookie, id)
    expect(notes2[1]!.note).toBe('ملاحظة يدوية\nانقر الأيقونة كذا')
  })

  it('لا شيء ليعالجه = 200 بقائمة فارغة', async () => {
    const { app } = await buildWith(fakeStt([]))
    const { cookie } = await registerUser(app, `memo2-${Date.now()}@a.co`, randomTestPassword())
    const base = assembleGuide([{ kind: 'click', url: 'https://x', pageTitle: 'ص', ts: 1 }])
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: base } })
    const id = (created.json() as { id: string }).id
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe-steps`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { results: unknown[] }).results).toHaveLength(0)
  })

  it('بلا مفتاح تفريغ = 503 برسالة عربية صادقة', async () => {
    const { app } = await buildWith(undefined)
    const { cookie } = await registerUser(app, `memo3-${Date.now()}@a.co`, randomTestPassword())
    const f = await uploadAudio(app, cookie)
    const id = await createMemoGuide(app, cookie, f, f)
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe-steps`, headers: { cookie } })
    expect(res.statusCode).toBe(503)
    expect((res.json() as { errorAr: string }).errorAr).toContain('GROQ_API_KEY')
  })

  it('فشل مزوّد التفريغ = 502 ولا يتلف الدليل', async () => {
    const { app } = await buildWith(failingStt())
    const { cookie } = await registerUser(app, `memo4-${Date.now()}@a.co`, randomTestPassword())
    const f = await uploadAudio(app, cookie)
    const id = await createMemoGuide(app, cookie, f, f)
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe-steps`, headers: { cookie } })
    expect(res.statusCode).toBe(502)
    const steps = await getNotes(app, cookie, id)
    expect(steps[0]!.note).toBeUndefined() // لا كتابة ناقصة — الدليل كما كان
  })

  it('عزل المالك: دليل غيره = 404', async () => {
    const { app } = await buildWith(fakeStt([]))
    const u1 = await registerUser(app, `memo5a-${Date.now()}@a.co`, randomTestPassword())
    const u2 = await registerUser(app, `memo5b-${Date.now()}@a.co`, randomTestPassword())
    const f = await uploadAudio(app, u1.cookie)
    const id = await createMemoGuide(app, u1.cookie, f, f)
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe-steps`, headers: { cookie: u2.cookie } })
    expect(res.statusCode).toBe(404)
  })
})
