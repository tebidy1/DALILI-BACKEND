import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import jpeg from 'jpeg-js'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client'
import { files, users } from '../src/db/schema'
import { burnJpeg, derivativeId, pixelateRgba } from '../src/lib/burn'
import { createBurnPool } from '../src/lib/burn-pool'
import { createDerivatives } from '../src/lib/derivatives'

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

/** خطوط رأسيّة بعرض ٢ بكسل — تفاصيل عالية التردّد يمحوها الطمس */
function stripes(w = 240, h = 120): Buffer {
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const v = Math.floor(x / 2) % 2 ? 255 : 0
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  return Buffer.from(jpeg.encode({ data, width: w, height: h }, 95).data)
}

const variance = (buf: Buffer, x0: number, y0: number, x1: number, y1: number) => {
  const img = jpeg.decode(buf, { useTArray: true })
  const vals: number[] = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(img.data[(y * img.width + x) * 4]!)
  const m = vals.reduce((a, b) => a + b, 0) / vals.length
  return vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length
}

describe('حرق الطمس والقصّ', () => {
  it('pixelateRgba يوحّد كل كتلة ويبقي خارج المستطيل كما هو', () => {
    const w = 24
    const h = 12
    const d = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i >> 2) % 2 ? 255 : 0))
    const before = d.slice()
    pixelateRgba(d, w, h, { x: 0, y: 0, w: 12, h: 12 })
    const px = (x: number, y: number) => d[(y * w + x) * 4]
    expect(new Set([px(0, 0), px(5, 5), px(11, 11)]).size).toBe(1)
    expect(d.slice(12 * 4, 24 * 4)).toEqual(before.slice(12 * 4, 24 * 4))
  })

  it('المستطيل خارج الصورة أو فارغ لا يرمي ولا يغيّر شيئًا', () => {
    const d = new Uint8Array(16).fill(7)
    pixelateRgba(d, 2, 2, { x: 50, y: 50, w: 10, h: 10 })
    pixelateRgba(d, 2, 2, { x: 0, y: 0, w: 0, h: 0 })
    expect([...d]).toEqual(new Array(16).fill(7))
  })

  it('burnJpeg يمحو التفاصيل داخل الطمس فقط', () => {
    const out = burnJpeg(stripes(), { blurRects: [{ x: 0, y: 0, w: 120, h: 120 }] })!
    expect(variance(out, 10, 10, 110, 110)).toBeLessThan(400)
    expect(variance(out, 130, 10, 230, 110)).toBeGreaterThan(4000)
  })

  it('burnJpeg يقصّ فعلًا: أبعاد الناتج = أبعاد القصّ', () => {
    const out = burnJpeg(stripes(), { blurRects: [], crop: { x: 40, y: 20, w: 100, h: 50 } })!
    const img = jpeg.decode(out)
    expect([img.width, img.height]).toEqual([100, 50])
  })

  it('bytes ليست JPEG → null (الفشل مغلق)', () => {
    expect(burnJpeg(Buffer.from('not a jpeg'), { blurRects: [] })).toBeNull()
  })

  it('derivativeId حتميّ، يطابق FILE_ID_RE، ويتغيّر بتغيّر المواصفة', () => {
    const a = derivativeId('src12345678', { blurRects: [{ x: 1, y: 2, w: 3, h: 4 }] })
    expect(a).toBe(derivativeId('src12345678', { blurRects: [{ x: 1, y: 2, w: 3, h: 4 }] }))
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(a).not.toBe(derivativeId('src12345678', { blurRects: [{ x: 1, y: 2, w: 3, h: 5 }] }))
  })

  it('المشتقّ يُحرق في خيط عامل مرّة واحدة، الطلبان المتزامنان يتشاركان، وغير JPEG يُرفض', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-burn-'))
    dirs.push(dir)
    const { db, filesDir, sqlite } = createDb(dir)
    const pool = createBurnPool(1)
    try {
      const now = new Date().toISOString()
      // files.user_id مفتاح أجنبي على users — صاحب حقيقي لا معرّف وهمي
      db.insert(users).values({ id: 'u1', email: 'burn@dalili.sa', passwordHash: 'x', createdAt: now }).run()
      fs.writeFileSync(path.join(filesDir, 'srcJpeg0001'), stripes())
      db.insert(files).values({ id: 'srcJpeg0001', userId: 'u1', mime: 'image/jpeg', bytes: 1, createdAt: now }).run()
      fs.writeFileSync(path.join(filesDir, 'srcPng00001'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      db.insert(files).values({ id: 'srcPng00001', userId: 'u1', mime: 'image/png', bytes: 4, createdAt: now }).run()

      const spec = { blurRects: [{ x: 0, y: 0, w: 60, h: 60 }] }
      const d = createDerivatives(db, filesDir, pool)
      const [id1, id2] = await Promise.all([d.ensure('srcJpeg0001', spec), d.ensure('srcJpeg0001', spec)])
      expect(id1).toBe(derivativeId('srcJpeg0001', spec))
      expect(id1).toBe(id2)
      expect(fs.existsSync(path.join(filesDir, id1!))).toBe(true)
      expect(fs.existsSync(path.join(filesDir, `${id1}.tmp`))).toBe(false)
      expect(variance(fs.readFileSync(path.join(filesDir, id1!)), 5, 5, 55, 55)).toBeLessThan(400)
      expect(db.select().from(files).all().filter((r) => r.id === id1)).toHaveLength(1)
      expect(await d.ensure('srcJpeg0001', spec)).toBe(id1)
      expect(await d.ensure('srcPng00001', spec)).toBeNull()
      expect(await d.ensure('missing0001', spec)).toBeNull()
    } finally {
      await pool.close()
      sqlite.close()
    }
  }, 30_000)
})
