import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'

/** خطوط رأسيّة بعرض ٢ بكسل — ما يطمسه الحرق يُرى بالقياس */
function testJpeg(w = 320, h = 200): Buffer {
  const data = Buffer.alloc(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % w
    data[i] = data[i + 1] = data[i + 2] = Math.floor(x / 2) % 2 ? 255 : 0
    data[i + 3] = 255
  }
  return Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data)
}

type App = Awaited<ReturnType<typeof buildTestApp>>['app']

async function upload(app: App, cookie: string) {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(testJpeg())], { type: 'image/jpeg' }), 'shot.jpg')
  const res = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie }, payload: fd })
  return res.json() as { fileId: string; thumbFileId: string; fileUrl: string; thumbUrl: string }
}

function guideWith(shot: Record<string, unknown>) {
  const now = new Date().toISOString()
  return {
    id: 'x',
    schemaVersion: 1,
    title: 'خصوصيّة',
    locale: 'ar',
    dir: 'rtl',
    createdAt: now,
    updatedAt: now,
    steps: [
      { id: 's1', kind: 'click', title: 'خطوة', target: {}, sensitive: false, url: 'https://erp.example.com', pageTitle: 'ص', ts: 1, screenshot: shot },
    ],
  }
}

/** كل رابط /files في جسم الاستجابة يجب أن يكون موقَّعًا — الحارس العامّ لأي نقطة تُنسى */
const UNSIGNED = /\/files\/[A-Za-z0-9_-]{8,64}(?![A-Za-z0-9_-]|\?e=)/

describe('خصوصيّة الملفّات (٢ب)', () => {
  it('المعرّف وحده لا يفتح الملفّ — لا بجلسة ولا بدونها', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'priv1@dalili.sa')
    const up = await upload(app, cookie)
    expect((await app.inject({ method: 'GET', url: `/files/${up.fileId}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/files/${up.fileId}`, headers: { cookie } })).statusCode).toBe(404)
    const ok = await app.inject({ method: 'GET', url: up.fileUrl })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['cache-control']).toMatch(/^private/)
    expect((await app.inject({ method: 'GET', url: up.thumbUrl })).statusCode).toBe(200)
  })

  it('المشاركة: الطمس محروق، معرّف الأصل لا يغادر، السحب يقطع الصورة فورًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'priv2@dalili.sa')
    const up = await upload(app, cookie)
    const created = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: {
        guide: guideWith({
          fileId: up.fileId,
          thumbFileId: up.thumbFileId,
          fileUrl: 'http://old-host/files/' + up.fileId,
          blurRects: [{ x: 0, y: 0, w: 160, h: 200 }],
        }),
      },
    })
    const gid = (created.json() as { id: string }).id
    await app.inject({ method: 'PATCH', url: `/api/guides/${gid}/meta`, headers: { cookie }, payload: { visibility: 'workspace' } })
    const shareRes = await app.inject({ method: 'POST', url: `/api/guides/${gid}/share`, headers: { cookie } })
    const { token } = shareRes.json() as { token: string }

    const pub = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(pub.statusCode).toBe(200)
    expect(pub.body).not.toContain(up.fileId)
    expect(pub.body).not.toContain(up.thumbFileId)
    expect(pub.body).not.toMatch(UNSIGNED)
    const shot = (pub.json() as { guide: { steps: Array<{ screenshot: { fileUrl: string; blurRects: unknown[] } }> } }).guide.steps[0]!
      .screenshot
    expect(shot.blurRects).toEqual([])

    const img = await app.inject({ method: 'GET', url: shot.fileUrl })
    expect(img.statusCode).toBe(200)
    const d = jpeg.decode(img.rawPayload as Buffer, { useTArray: true })
    const left = new Set<number>()
    for (let x = 20; x < 140; x++) left.add(Math.round(d.data[(100 * d.width + x) * 4]! / 32))
    expect(left.size).toBeLessThanOrEqual(3) // الخطوط الرأسيّة ممحوّة في النصف المطموس

    await app.inject({ method: 'DELETE', url: `/api/guides/${gid}/share`, headers: { cookie } })
    expect((await app.inject({ method: 'GET', url: shot.fileUrl })).statusCode).toBe(404)
  })

  it('رابط موقَّع لا يُعاد استعماله مع معرّف آخر', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'priv3@dalili.sa')
    const a = await upload(app, cookie)
    const b = await upload(app, cookie)
    const forged = a.fileUrl.replace(a.fileId, b.fileId)
    expect((await app.inject({ method: 'GET', url: forged })).statusCode).toBe(404)
  })

  it('العضو يرى روابط موقَّعة في الدليل والقائمة، والكتابة لا تخزّن الروابط', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'priv4@dalili.sa')
    const up = await upload(app, cookie)
    const created = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: { guide: guideWith({ fileId: up.fileId, thumbFileId: up.thumbFileId, fileUrl: up.fileUrl, blurRects: [] }) },
    })
    const gid = (created.json() as { id: string }).id
    const got = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie } })
    expect(got.body).not.toMatch(UNSIGNED)
    const sh = (got.json() as { guide: { steps: Array<{ screenshot: { fileUrl: string; thumbUrl: string } }> } }).guide.steps[0]!
      .screenshot
    expect((await app.inject({ method: 'GET', url: sh.fileUrl })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: sh.thumbUrl })).statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    expect(list.body).not.toMatch(UNSIGNED)
    const item = (list.json() as { items: Array<{ id: string; thumbUrl?: string }> }).items.find((i) => i.id === gid)!
    expect((await app.inject({ method: 'GET', url: item.thumbUrl! })).statusCode).toBe(200)
  })
})
