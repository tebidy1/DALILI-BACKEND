import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assembleGuide, type TranscriptSegment } from '@dalili/core'
import { createApp } from '../src/app'
import type { SttProvider } from '../src/stt/provider'
import { registerUser } from './helpers'

/**
 * VOX-04/05: نقطة التفريغ تعيد **مقترحات** لكل خطوة (لا تكتب تلقائيًا).
 * تطبيق معزول بمزوّد بديل — لا شبكة قروك هنا (الإثبات الحي منفصل).
 */

const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x10])

/** مزوّد بديل: يعيد مقاطع ثابتة بصرف النظر عن الصوت — يعزل منطق التوزيع عن الشبكة */
function fakeStt(segments: TranscriptSegment[]): SttProvider {
  return {
    name: 'fake',
    async transcribe() {
      return segments
    },
  }
}

async function buildWith(stt: SttProvider | undefined) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-vox-'))
  const built = await createApp({
    dataDir: dir,
    cookieSecret: 'test-secret-not-for-production',
    publicBase: 'http://localhost:8787',
    stt,
  })
  afterAll(() => built.close())
  return { ...built, dir }
}

/** يرفع صوتًا حقيقيًا للقرص ويعيد fileId — دورة الرفع نفسها تُستخدم في الإنتاج */
async function uploadAudio(app: import('fastify').FastifyInstance, cookie: string) {
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

async function createGuideWithAudio(
  app: import('fastify').FastifyInstance,
  cookie: string,
  fileId: string,
) {
  const startedAt = 1_000_000
  const base = assembleGuide([
    { kind: 'navigate', target: {}, url: 'https://erp.test/a', pageTitle: 'أ', ts: startedAt },
    { kind: 'click', target: { text: 'زر' }, url: 'https://erp.test/b', pageTitle: 'ب', ts: startedAt + 6_000 },
    { kind: 'click', target: { text: 'حفظ' }, url: 'https://erp.test/c', pageTitle: 'ج', ts: startedAt + 13_000 },
  ])
  const audio = { fileId, durationMs: 20_000, startedAt }
  const created = await app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: { cookie },
    payload: { guide: { ...base, audio } },
  })
  const id = (created.json() as { id: string }).id
  const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
  const steps = (got.json().guide as { steps: Array<{ id: string }> }).steps
  return { id, stepIds: steps.map((s) => s.id) }
}

describe('POST /api/guides/:id/transcribe', () => {
  it('يعيد مقترحًا لكل خطوة موزّعًا بالزمن على معرّف الخطوة الصحيح', async () => {
    const { app } = await buildWith(
      fakeStt([
        { startMs: 500, text: 'افتح الصفحة' },
        { startMs: 6_500, text: 'اضغط الزر' },
        { startMs: 14_000, text: 'احفظ' },
      ]),
    )
    const { cookie } = await registerUser(app, 'tr-map@dalili.sa')
    const fileId = await uploadAudio(app, cookie)
    const { id, stepIds } = await createGuideWithAudio(app, cookie, fileId)

    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().suggestions).toEqual([
      { stepId: stepIds[0], text: 'افتح الصفحة' },
      { stepId: stepIds[1], text: 'اضغط الزر' },
      { stepId: stepIds[2], text: 'احفظ' },
    ])
  })

  it('لا يُدرج خطوة بلا كلام في المقترحات', async () => {
    const { app } = await buildWith(fakeStt([{ startMs: 6_500, text: 'الوسطى فقط' }]))
    const { cookie } = await registerUser(app, 'tr-gap@dalili.sa')
    const fileId = await uploadAudio(app, cookie)
    const { id, stepIds } = await createGuideWithAudio(app, cookie, fileId)

    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe`, headers: { cookie } })
    expect(res.json().suggestions).toEqual([{ stepId: stepIds[1], text: 'الوسطى فقط' }])
  })

  it('دليل بلا صوت → 400 عربي', async () => {
    const { app } = await buildWith(fakeStt([]))
    const { cookie } = await registerUser(app, 'tr-noaudio@dalili.sa')
    const base = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://erp.test/a', pageTitle: 'أ', ts: 1 },
    ])
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: base } })
    const id = (created.json() as { id: string }).id
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe`, headers: { cookie } })
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toContain('صوت')
  })

  it('دليل ليس ملكك → 404 (عزل لا يكشف الوجود)', async () => {
    const { app } = await buildWith(fakeStt([]))
    const owner = await registerUser(app, 'tr-owner@dalili.sa')
    const fileId = await uploadAudio(app, owner.cookie)
    const { id } = await createGuideWithAudio(app, owner.cookie, fileId)
    const other = await registerUser(app, 'tr-other@dalili.sa')
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe`, headers: { cookie: other.cookie } })
    expect(res.statusCode).toBe(404)
  })

  it('بلا جلسة → 401', async () => {
    const { app } = await buildWith(fakeStt([]))
    const res = await app.inject({ method: 'POST', url: '/api/guides/whatever/transcribe' })
    expect(res.statusCode).toBe(401)
  })

  it('مزوّد التفريغ غير مضبوط (لا مفتاح) → 503 عربي صادق', async () => {
    const { app } = await buildWith(undefined)
    const { cookie } = await registerUser(app, 'tr-nokey@dalili.sa')
    const fileId = await uploadAudio(app, cookie)
    const { id } = await createGuideWithAudio(app, cookie, fileId)
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe`, headers: { cookie } })
    expect(res.statusCode).toBe(503)
    expect(res.json().errorAr).toContain('التفريغ')
  })

  it('فشل المزوّد → 502 عربي صادق لا انهيار صامت', async () => {
    const failing: SttProvider = {
      name: 'boom',
      async transcribe() {
        throw new Error('upstream 500')
      },
    }
    const { app } = await buildWith(failing)
    const { cookie } = await registerUser(app, 'tr-fail@dalili.sa')
    const fileId = await uploadAudio(app, cookie)
    const { id } = await createGuideWithAudio(app, cookie, fileId)
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe`, headers: { cookie } })
    expect(res.statusCode).toBe(502)
    expect(res.json().errorAr).toContain('التفريغ')
  })

  // ——— التفريغ التلقائي (قرار المالك 2026-08-30): apply يملأ الملاحظات الفارغة ———

  async function createGuideWithAudioAndNote(app: import('fastify').FastifyInstance, cookie: string, fileId: string) {
    const startedAt = 1_000_000
    const base = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://erp.test/a', pageTitle: 'أ', ts: startedAt },
      { kind: 'click', target: { text: 'زر' }, url: 'https://erp.test/b', pageTitle: 'ب', ts: startedAt + 6_000 },
    ])
    base.steps[1]!.note = 'ملاحظة كتبتها بنفسي'
    const audio = { fileId, durationMs: 20_000, startedAt }
    const created = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: { guide: { ...base, audio } },
    })
    return (created.json() as { id: string }).id
  }

  it('apply يملأ الملاحظات الفارغة فقط ولا يمسّ الموجودة، ويعيد عددها', async () => {
    const { app } = await buildWith(
      fakeStt([
        { startMs: 500, text: 'افتح الصفحة الرئيسية' },
        { startMs: 6_500, text: 'اضغط الزر الأزرق' },
      ]),
    )
    const { cookie } = await registerUser(app, 'tr-apply@dalili.sa')
    const fileId = await uploadAudio(app, cookie)
    const id = await createGuideWithAudioAndNote(app, cookie, fileId)

    const res = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/transcribe`,
      headers: { cookie },
      payload: { apply: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toBe(1) // الثانية لها ملاحظة — لا تُداس

    const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
    const steps = (got.json().guide as { steps: Array<{ note?: string }> }).steps
    expect(steps[0]!.note).toBe('افتح الصفحة الرئيسية')
    expect(steps[1]!.note).toBe('ملاحظة كتبتها بنفسي')
  })

  it('النص المطبَّق يدخل فهرس البحث في نفس المعاملة — كلامك قابل للبحث (SRCH-05)', async () => {
    const { app } = await buildWith(fakeStt([{ startMs: 500, text: 'اعتماد الفاتورة الشهرية' }]))
    const { cookie } = await registerUser(app, 'tr-index@dalili.sa')
    const fileId = await uploadAudio(app, cookie)
    const { id } = await createGuideWithAudio(app, cookie, fileId)

    const q = encodeURIComponent('اعتماد الفاتورة')
    const before = await app.inject({ method: 'GET', url: `/api/search?q=${q}`, headers: { cookie } })
    expect((before.json() as { hits: unknown[] }).hits.length).toBe(0)

    await app.inject({ method: 'POST', url: `/api/guides/${id}/transcribe`, headers: { cookie }, payload: { apply: true } })

    const after = await app.inject({ method: 'GET', url: `/api/search?q=${q}`, headers: { cookie } })
    const hits = (after.json() as { hits: Array<{ guideId: string }> }).hits
    expect(hits.length).toBe(1)
    expect(hits[0]!.guideId).toBe(id)
  })

  it('جسم غير صالح (apply ليس منطقيًا) → 400 عربي', async () => {
    const { app } = await buildWith(fakeStt([]))
    const { cookie } = await registerUser(app, 'tr-badbody@dalili.sa')
    const fileId = await uploadAudio(app, cookie)
    const { id } = await createGuideWithAudio(app, cookie, fileId)
    const res = await app.inject({
      method: 'POST',
      url: `/api/guides/${id}/transcribe`,
      headers: { cookie },
      payload: { apply: 'نعم' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toContain('تفريغ')
  })
})
