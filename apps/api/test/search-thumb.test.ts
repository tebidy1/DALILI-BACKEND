import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

/** JPEG اختباري 640×480 — نفس أسلوب thumbs.test */
function testJpeg(w = 640, h = 480): Buffer {
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = (x * 255) / w
      data[i + 1] = (y * 255) / h
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return jpeg.encode({ data, width: w, height: h }, 90).data
}

/** رفع ملف والعودة بمعرّفيه */
async function upload(
  app: import('fastify').FastifyInstance,
  cookie: string,
  buf: Buffer,
  type: string,
  name: string,
): Promise<{ fileId: string; thumbFileId?: string }> {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(buf)], { type }), name)
  const res = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie }, payload: fd })
  expect(res.statusCode).toBe(200)
  return res.json() as { fileId: string; thumbFileId?: string }
}

/** WebP مصغّر صالح البنية: توقيع RIFF…WEBP يكفي للشمّ — لا فكّ ولا مصغّرة */
function webpHeader(extra = 16): Buffer {
  const buf = Buffer.alloc(12 + extra)
  buf.write('RIFF', 0, 'latin1')
  buf.writeUInt32LE(4 + extra, 4)
  buf.write('WEBP', 8, 'latin1')
  return buf
}

describe('SRCH-01: مصغّرة في نتائج البحث', () => {
  it('نتيجة البحث تحمل thumbFileId الدليل فتعرض الصفحة المصغّرة لا الأصل', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'sthumb1@dalili.sa')
    const { fileId, thumbFileId } = await upload(app, cookie, testJpeg(), 'image/jpeg', 'shot.jpg')
    expect(thumbFileId).toBeTruthy()

    const now = new Date().toISOString()
    const create = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: {
        guide: {
          id: `st-${Date.now()}`,
          schemaVersion: 1,
          title: 'دليل فحص المصغّرات',
          locale: 'ar',
          dir: 'rtl',
          createdAt: now,
          updatedAt: now,
          steps: [
            {
              id: 'st-1',
              kind: 'click',
              title: 'خطوة الفحص',
              target: {},
              sensitive: false,
              url: 'https://erp.example/x',
              pageTitle: 'الفحص',
              ts: 1,
              screenshot: { fileId, thumbFileId, w: 640, h: 480 },
            },
          ],
        },
      },
    })
    expect(create.statusCode).toBe(200)

    const res = await app.inject({ method: 'GET', url: '/api/search?q=الفحص', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const hits = (res.json().hits ?? []) as Array<{ thumbFileId?: string }>
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.thumbFileId).toBe(thumbFileId)
  })

  it('دليل بلا مصغّرة → thumbFileId غائب بلا خطأ', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'sthumb2@dalili.sa')
    const now = new Date().toISOString()
    await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: {
        guide: {
          id: `st2-${Date.now()}`,
          schemaVersion: 1,
          title: 'دليل بلا لقطات',
          locale: 'ar',
          dir: 'rtl',
          createdAt: now,
          updatedAt: now,
          steps: [{ id: 's1', kind: 'click', title: 'خطوة نصية', target: {}, sensitive: false, url: 'https://x.example/', pageTitle: 'نص', ts: 1 }],
        },
      },
    })
    const res = await app.inject({ method: 'GET', url: '/api/search?q=نصية', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const hits = res.json().hits as Array<{ thumbFileId?: string }>
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.thumbFileId).toBeUndefined()
  })
})

describe('PERF-03: قبول WebP', () => {
  it('رفع WebP يُقبل بنوعه ويُخدَم image/webp — بلا مصغّرة كاذبة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'webp1@dalili.sa')
    const { fileId, thumbFileId } = await upload(app, cookie, webpHeader(), 'image/webp', 'shot.webp')
    expect(fileId).toBeTruthy()
    expect(thumbFileId).toBeUndefined() // بلا فاكّ WebP نقية — صدق لا تزييف

    const got = await app.inject({ method: 'GET', url: `/files/${fileId}` })
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('image/webp')
  })
})
