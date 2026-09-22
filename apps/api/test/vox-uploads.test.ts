import { describe, expect, it } from 'vitest'
import { assembleGuide } from '@dalili/core'
import { buildTestApp, registerUser } from './helpers'

/** VOX-01: رفع صوت webm وخدمته — توسيع sniffImage إلى sniffAsset */

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
/** بصمة EBML — رأس كل حاوية webm (المقطع الأول من MediaRecorder) */
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x10])

function multipartBody(buf: Buffer, filename: string, mime: string) {
  const head = Buffer.from(
    `--bnd\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from('\r\n--bnd--\r\n')
  return Buffer.concat([head, buf, tail])
}

const post = (app: import('fastify').FastifyInstance, cookie: string, buf: Buffer, name: string, mime: string) =>
  app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { cookie, 'content-type': 'multipart/form-data; boundary=bnd' },
    payload: multipartBody(buf, name, mime),
  })

describe('رفع الصوت webm وخدمته', () => {
  it('webm سليم → 200 → جلب برابطه الموقَّع بنوع audio/webm وبايتات مطابقة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'vox-upload@dalili.sa')
    const audio = Buffer.concat([WEBM_MAGIC, Buffer.alloc(2_048)])
    const res = await post(app, cookie, audio, 'voice.webm', 'audio/webm')
    expect(res.statusCode).toBe(200)
    expect(res.json().thumbFileId).toBeUndefined() // لا مصغّرة للصوت أبدًا
    const { fileUrl } = res.json() as { fileUrl: string }

    const file = await app.inject({ method: 'GET', url: fileUrl })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('audio/webm')
    expect(Buffer.from(file.rawPayload).subarray(0, 4)).toEqual(WEBM_MAGIC.subarray(0, 4))
  })

  it('المعلن audio/webm لكن البصمة HTML → 400 عربي — لا نثق بالنوع المعلن', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'vox-evil@dalili.sa')
    const res = await post(app, cookie, Buffer.from('<script>x</script>'), 'evil.webm', 'audio/webm')
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toContain('ليس')
  })

  it('صوت يتجاوز 25MB → 413 عربي', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'vox-big@dalili.sa')
    const big = Buffer.concat([WEBM_MAGIC, Buffer.alloc(26 * 1024 * 1024)])
    const res = await post(app, cookie, big, 'voice.webm', 'audio/webm')
    expect(res.statusCode).toBe(413)
    expect(res.json().errorAr).toContain('25')
  })

  it('صورة تتجاوز 5MB (ضمن حد الصوت) → 413 عربي — حد الصور لا يتراخى', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'vox-img@dalili.sa')
    const big = Buffer.concat([JPEG_MAGIC, Buffer.alloc(6 * 1024 * 1024)])
    const res = await post(app, cookie, big, 'shot.jpg', 'image/jpeg')
    expect(res.statusCode).toBe(413)
    expect(res.json().errorAr).toContain('5 ميغابايت')
  })

  it('طلب نطاق على ملف صوتي → 206 بالجزء الصحيح وترويسة content-range', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'vox-range@dalili.sa')
    const audio = Buffer.concat([WEBM_MAGIC, Buffer.alloc(1_000)])
    const { fileUrl } = (await post(app, cookie, audio, 'voice.webm', 'audio/webm')).json() as { fileUrl: string }

    const part = await app.inject({ method: 'GET', url: fileUrl, headers: { range: 'bytes=0-99' } })
    expect(part.statusCode).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 0-99/${audio.length}`)
    expect(part.rawPayload.length).toBe(100)
  })

  it('نطاق غير صالح (بداية بعد النهاية) → الملف كاملًا 200 — لا انهيار', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'vox-range2@dalili.sa')
    const audio = Buffer.concat([WEBM_MAGIC, Buffer.alloc(500)])
    const { fileUrl } = (await post(app, cookie, audio, 'voice.webm', 'audio/webm')).json() as { fileUrl: string }
    const res = await app.inject({ method: 'GET', url: fileUrl, headers: { range: 'bytes=99999-' } })
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.length).toBe(audio.length)
  })
})

describe('دليل بصوت — دورة كاملة', () => {
  it('إنشاء دليل guide.audio → جلب خاص وعام يعيدان بياناته كما هي، مع رابط موقَّع بنطاق كلٍّ منهما', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'vox-guide@dalili.sa')
    const guide = assembleGuide([
      { kind: 'navigate', target: {}, url: 'https://erp.test/a', pageTitle: 'ص', ts: 1 },
    ])
    const audio = { fileId: 'voxAudioFile000001', durationMs: 45_000, startedAt: 1_700_000_012_345 }
    const created = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: { guide: { ...guide, audio } },
    })
    expect(created.statusCode).toBe(200)
    const id = (created.json() as { id: string }).id

    const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
    // خصوصيّة ٢ب: الخادم يركّب fileUrl عند القراءة — العضو بتوقيع أصل (بلا s=)
    expect((got.json().guide as { audio?: unknown }).audio).toEqual({
      ...audio,
      fileUrl: expect.stringMatching(/^\/files\/voxAudioFile000001\?e=\d+&c=[^&]+$/),
    })

    const share = await app.inject({ method: 'POST', url: `/api/guides/${id}/share`, headers: { cookie } })
    const { token } = share.json() as { token: string }
    const pub = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    // والضيف بتوقيع مقيَّد برمز المشاركة نفسه
    expect((pub.json().guide as { audio?: unknown }).audio).toEqual({
      ...audio,
      fileUrl: expect.stringMatching(new RegExp(`^/files/voxAudioFile000001\\?e=\\d+&s=${token}&c=[^&]+$`)),
    })
  })
})
