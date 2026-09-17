import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

/** توليد JPEG اختباري حي — 640×480 بتدرج بسيط */
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

/** PERF-02: مصغّرة ≤30KB بعرض 320 تُولَّد عند الرفع وتُخدَّم من /files */
describe('المصغّرات (PERF-02)', () => {
  it('رفع JPEG يولّد مصغّرة: موجودة، ≤30KB، عرضها 320، وتُقدَّم برابطها الموقَّع', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'thumb1@dalili.sa')

    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(testJpeg())], { type: 'image/jpeg' }), 'shot.jpg')
    const res = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie }, payload: fd })
    expect(res.statusCode).toBe(200)
    const { fileId, thumbFileId, thumbUrl } = res.json() as { fileId: string; thumbFileId?: string; thumbUrl?: string }
    expect(fileId).toBeTruthy()
    expect(thumbFileId).toBeTruthy()

    const thumb = await app.inject({ method: 'GET', url: thumbUrl! })
    expect(thumb.statusCode).toBe(200)
    expect(thumb.headers['content-type']).toBe('image/jpeg')
    const bytes = (thumb.rawPayload as Buffer).length
    expect(bytes).toBeLessThanOrEqual(30 * 1024)

    const decoded = jpeg.decode(thumb.rawPayload as Buffer, { maxMemoryUsageInMB: 1024 })
    expect(decoded.width).toBe(320)
  })

  it('الصورة الأصلية تبقى كاملة العرض — المصغّرة إضافة لا استبدال', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'thumb2@dalili.sa')
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(testJpeg())], { type: 'image/jpeg' }), 'shot.jpg')
    const up = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie }, payload: fd })
    const { fileUrl } = up.json() as { fileUrl: string }
    const orig = await app.inject({ method: 'GET', url: fileUrl })
    const decoded = jpeg.decode(orig.rawPayload as Buffer, { maxMemoryUsageInMB: 1024 })
    expect(decoded.width).toBe(640)
  })

  it('PNG لا يولّد مصغّرة (لقاطات الامتداد JPEG دومًا) — لا فشل ولا كذب', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'thumb3@dalili.sa')
    // PNG 1×1 صالح
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d,
      0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'icon.png')
    const res = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie }, payload: fd })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { thumbFileId?: string }).thumbFileId).toBeUndefined()
  })

  it('دليل بلقطته: ملخص القائمة يعرض معرّف المصغّرة لا الأصل', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'thumb4@dalili.sa')
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(testJpeg())], { type: 'image/jpeg' }), 'shot.jpg')
    const up = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie }, payload: fd })
    const { fileId, thumbFileId } = up.json() as { fileId: string; thumbFileId: string }

    const now = new Date().toISOString()
    const guide = {
      id: 'x',
      schemaVersion: 1,
      title: 'دليل بمصغّرة',
      locale: 'ar',
      dir: 'rtl',
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: 's1',
          kind: 'click',
          title: 'خطوة',
          target: {},
          sensitive: false,
          url: 'https://erp.example.com/x',
          pageTitle: 'ص',
          ts: 1,
          screenshot: { fileId, thumbFileId, blurRects: [] },
        },
      ],
    }
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide } })
    const gid = (created.json() as { id: string }).id
    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    const item = (list.json() as { items: { id: string; thumbFileId?: string }[] }).items.find((i) => i.id === gid)
    expect(item?.thumbFileId).toBe(thumbFileId)
  })
})
