import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

function multipartBody(buf: Buffer, filename = 'shot.jpg', mime = 'image/jpeg') {
  const head = Buffer.from(
    `--bnd\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from('\r\n--bnd--\r\n')
  return Buffer.concat([head, buf, tail])
}

describe('الرفع والملفات', () => {
  it('رفع JPEG → رابط موقَّع → جلب بنوع صحيح', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'upload@dalili.sa')

    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { cookie, 'content-type': 'multipart/form-data; boundary=bnd' },
      payload: multipartBody(Buffer.concat([JPEG_MAGIC, Buffer.alloc(64)])),
    })
    expect(res.statusCode).toBe(200)
    const { fileUrl } = res.json() as { fileUrl: string }

    const file = await app.inject({ method: 'GET', url: fileUrl })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('image/jpeg')
    expect(Buffer.from(file.rawPayload).subarray(0, 3)).toEqual(JPEG_MAGIC.subarray(0, 3))
  })

  it('ملف ليس صورة → 400 عربي', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'upload2@dalili.sa')
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { cookie, 'content-type': 'multipart/form-data; boundary=bnd' },
      payload: multipartBody(Buffer.from('<script>alert(1)</script>'), 'evil.jpg'),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toContain('ليس صورة')
  })

  it('بلا مصادقة → 401', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { 'content-type': 'multipart/form-data; boundary=bnd' },
      payload: multipartBody(Buffer.concat([JPEG_MAGIC, Buffer.alloc(32)])),
    })
    expect(res.statusCode).toBe(401)
  })

  it('معرف ملف خبيث (مسار穿越) → 404 قبل لمس القرص', async () => {
    const { app } = await buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/files/..%2F..%2Fbootstrap' })
    expect([404]).toContain(res.statusCode)
  })

  it('تجاوز 5MB → 413', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'upload3@dalili.sa')
    const big = Buffer.concat([JPEG_MAGIC, Buffer.alloc(6 * 1024 * 1024)])
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { cookie, 'content-type': 'multipart/form-data; boundary=bnd' },
      payload: multipartBody(big),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().errorAr).toContain('5 ميغابايت')
  })
})
