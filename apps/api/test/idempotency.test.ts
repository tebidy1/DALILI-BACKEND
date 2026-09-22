import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { FastifyRequest } from 'fastify'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client'
import { makeIdempotency } from '../src/lib/idempotency'
import { buildTestAppWithDir, registerUser } from './helpers'

/** DTOP-02: شبكة VPN حكوميّة تنقطع — إعادة الطلب نفسه لا تُنشئ نسخة ثانية */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(64)])

function multipartBody(buf: Buffer) {
  const head = Buffer.from('--bnd\r\nContent-Disposition: form-data; name="file"; filename="shot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n')
  return Buffer.concat([head, buf, Buffer.from('\r\n--bnd--\r\n')])
}
const up = (cookie: string, key?: string) => ({
  method: 'POST' as const,
  url: '/api/uploads',
  headers: { cookie, 'content-type': 'multipart/form-data; boundary=bnd', ...(key ? { 'idempotency-key': key } : {}) },
  payload: multipartBody(JPEG),
})
const emptyGuide = { id: 'x', schemaVersion: 2, title: 'ت', locale: 'ar', dir: 'rtl', createdAt: '', updatedAt: '', steps: [] }

function count(dir: string, sql: string, arg: string): number {
  const raw = new Database(path.join(dir, 'dalili.db'), { readonly: true })
  const n = (raw.prepare(sql).get(arg) as { n: number }).n
  raw.close()
  return n
}

describe('DTOP-02: Idempotency-Key', () => {
  it('الرفع بالمفتاح نفسه مرّتين ← الملف نفسه، رابط موقَّع، وصفّ واحد', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'idem-1@dalili.sa')
    const a = await app.inject(up(cookie, 'shot-aaaa-0001'))
    const b = await app.inject(up(cookie, 'shot-aaaa-0001'))
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    expect(b.json().fileId).toBe(a.json().fileId)
    expect(b.json().fileUrl).toMatch(/\?e=\d+&c=/)
    expect(count(dir, 'SELECT COUNT(*) AS n FROM files WHERE id = ?', a.json().fileId)).toBe(1)
  })

  it('مفتاح مختلف أو بلا ترويسة ← ملف جديد كل مرّة (السلوك القديم)', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'idem-2@dalili.sa')
    const a = await app.inject(up(cookie, 'shot-bbbb-0001'))
    const b = await app.inject(up(cookie, 'shot-bbbb-0002'))
    const c = await app.inject(up(cookie))
    const d = await app.inject(up(cookie))
    expect(new Set([a.json().fileId, b.json().fileId, c.json().fileId, d.json().fileId]).size).toBe(4)
  })

  it('مفتاح بصيغة فاسدة ← 400 عربي', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'idem-3@dalili.sa')
    const res = await app.inject(up(cookie, 'bad key!'))
    expect(res.statusCode).toBe(400)
    expect(res.json().errorAr).toContain('عدم التكرار')
  })

  it('المفتاح نفسه على مسار آخر ← 422', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'idem-4@dalili.sa')
    expect((await app.inject(up(cookie, 'reuse-key-0001'))).statusCode).toBe(200)
    const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie, 'idempotency-key': 'reuse-key-0001' }, payload: { guide: emptyGuide } })
    expect(res.statusCode).toBe(422)
  })

  it('المفتاح نفسه لمستخدم آخر لا يتصادم ← ملف مستقلّ', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie: c1 } = await registerUser(app, 'idem-6@dalili.sa')
    const { cookie: c2 } = await registerUser(app, 'idem-7@dalili.sa')
    const a = await app.inject(up(c1, 'shared-key-0001'))
    const b = await app.inject(up(c2, 'shared-key-0001'))
    expect(b.statusCode).toBe(200)
    expect(b.json().fileId).not.toBe(a.json().fileId)
  })

  it('إنشاء الدليل بالمفتاح نفسه مرّتين ← المعرّف نفسه ودليل واحد', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie, me } = await registerUser(app, 'idem-5@dalili.sa')
    const before = count(dir, 'SELECT COUNT(*) AS n FROM guides WHERE user_id = ?', me.id)
    const req = { method: 'POST' as const, url: '/api/guides', headers: { cookie, 'idempotency-key': 'guide-session-0001' }, payload: { guide: emptyGuide } }
    const a = await app.inject(req)
    const b = await app.inject(req)
    expect(a.statusCode).toBe(200)
    expect(b.json().id).toBe(a.json().id)
    expect(count(dir, 'SELECT COUNT(*) AS n FROM guides WHERE user_id = ?', me.id)).toBe(before + 1)
  })
})

describe('DTOP-02: الحجز قبل التنفيذ — طلبان متزامنان بالمفتاح نفسه', () => {
  const dirs: string[] = []
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
  const reqWith = (key: string) => ({ headers: { 'idempotency-key': key } }) as unknown as FastifyRequest

  it('الثاني أثناء تنفيذ الأوّل ← 409 لا نسخة ثانية · بعد remember ← replay · release يحرّر المفتاح · الحجز الميّت يُستعاد', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-idem-'))
    dirs.push(dir)
    const { db, sqlite } = createDb(dir)
    let t = Date.parse('2026-09-15T10:00:00.000Z')
    const idem = makeIdempotency(db, () => t)

    expect(idem.begin(reqWith('race-key-0001'), 'u1', 'uploads')).toEqual({ kind: 'fresh', key: 'race-key-0001' })
    const second = idem.begin(reqWith('race-key-0001'), 'u1', 'uploads')
    expect(second.kind).toBe('rejected')
    expect(second.kind === 'rejected' && second.status).toBe(409)

    idem.remember('u1', 'race-key-0001', 'uploads', 200, { fileId: 'f1' })
    expect(idem.begin(reqWith('race-key-0001'), 'u1', 'uploads')).toEqual({ kind: 'replay', status: 200, body: { fileId: 'f1' } })

    expect(idem.begin(reqWith('fail-key-0001'), 'u1', 'guides.create').kind).toBe('fresh')
    idem.release('u1', 'fail-key-0001')
    expect(idem.begin(reqWith('fail-key-0001'), 'u1', 'guides.create').kind).toBe('fresh')

    // عمليّة ماتت أثناء التنفيذ: الحجز بلا ردّ يُستعاد بعد مهلته لا يحبس المفتاح أسبوعًا
    expect(idem.begin(reqWith('dead-key-0001'), 'u1', 'uploads').kind).toBe('fresh')
    t += 3 * 60 * 1000
    expect(idem.begin(reqWith('dead-key-0001'), 'u1', 'uploads').kind).toBe('fresh')
    sqlite.close()
  })
})
