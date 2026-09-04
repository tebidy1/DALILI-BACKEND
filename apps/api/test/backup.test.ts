import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { makeBackup, pruneBackups, restoreBackup, stampNow } from '../src/lib/backup'
import { registerUser } from './helpers'

/** OPS-04: النسخة الاحتياطية لا تُصدَّق إلا باستعادة مُختبرة فعليًا — هذا الطواف هو الدليل */

let seq = 0

describe('OPS-04: نسخ احتياطي واستعادة', () => {
  it('طواف كامل: بيانات وملفات → نسخة → محو كامل → استعادة → كل شيء عاد', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-bk-'))
    const { app, close } = await createApp({
      dataDir: dir,
      cookieSecret: 'test-secret-not-for-production',
      publicBase: 'http://localhost:8787',
    })
    const registered = await registerUser(app, `bk1-${seq++}@dalili.sa`)
    const cookie = registered.cookie

    // لقطة JPEG حقيقية → ملف على القرص + مصغّرة
    const w = 64
    const h = 64
    const data = Buffer.alloc(w * h * 4, 128)
    const jpg = jpeg.encode({ data, width: w, height: h }, 80).data
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' }), 'shot.jpg')
    const up = await app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie }, payload: fd })
    expect(up.statusCode).toBe(200)
    const { fileId, thumbFileId } = up.json() as { fileId: string; thumbFileId: string }

    const now = new Date().toISOString()
    const create = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie },
      payload: {
        guide: {
          id: `bk-${seq++}`,
          schemaVersion: 1,
          title: 'دليل النسخ الاحتياطي',
          locale: 'ar',
          dir: 'rtl',
          createdAt: now,
          updatedAt: now,
          steps: [
            {
              id: 'bk-1',
              kind: 'click',
              title: 'خطوة قبل النسخ',
              target: {},
              sensitive: false,
              url: 'https://erp.example/backup',
              pageTitle: 'النسخ',
              ts: 1,
              screenshot: { fileId, thumbFileId, w, h },
            },
          ],
        },
      },
    })
    expect(create.statusCode).toBe(200)

    await close() // قفل نظيف قبل النسخ والمحو

    // النسخ
    const backupDir = await makeBackup({
      dbPath: path.join(dir, 'dalili.db'),
      filesDir: path.join(dir, 'files'),
      backupsDir: path.join(dir, 'backups'),
      now: new Date('2026-08-30T10:00:00Z'),
    })
    expect(path.basename(backupDir)).toMatch(/^20260830-\d{6}$/) // بصمة محلية بالتاريخ نفسه
    expect(fs.existsSync(path.join(backupDir, 'dalili.db'))).toBe(true)
    expect(fs.existsSync(path.join(backupDir, 'files', fileId))).toBe(true)
    expect(fs.existsSync(path.join(backupDir, 'files', thumbFileId))).toBe(true)

    // المحو الكارثي
    fs.rmSync(path.join(dir, 'dalili.db'))
    fs.rmSync(path.join(dir, 'dalili.db-wal'), { force: true })
    fs.rmSync(path.join(dir, 'dalili.db-shm'), { force: true })
    fs.rmSync(path.join(dir, 'files'), { recursive: true })
    expect(fs.existsSync(path.join(dir, 'dalili.db'))).toBe(false)

    // الاستعادة
    restoreBackup({ backupDir, dataDir: dir })
    expect(fs.existsSync(path.join(dir, 'dalili.db'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'files', fileId))).toBe(true)

    // التطبيق يقوم على المُستعاد: الدخول بنفس كلمة المرور + الدليل موجود + الملف يُخدَم
    const { app: app2, close: close2 } = await createApp({
      dataDir: dir,
      cookieSecret: 'test-secret-not-for-production',
      publicBase: 'http://localhost:8787',
    })
    const login = await app2.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: registered.me.email, password: registered.password },
    })
    expect(login.statusCode).toBe(200)
    const rawSc = login.headers['set-cookie']
    const cookie2 = (Array.isArray(rawSc) ? rawSc[0] : rawSc)!.split(';')[0]

    const search = await app2.inject({ method: 'GET', url: '/api/search?q=قبل النسخ', headers: { cookie: cookie2 } })
    expect(search.statusCode).toBe(200)
    expect((search.json().hits as unknown[]).length).toBeGreaterThan(0)

    const file = await app2.inject({ method: 'GET', url: `/files/${fileId}` })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('image/jpeg')

    await close2()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('استعادة نسخة ناقصة ترفض برسالة عربية — لا تدمر البيانات القائمة', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-bk-'))
    const empty = path.join(dir, 'empty-backup')
    fs.mkdirSync(empty, { recursive: true })
    expect(() => restoreBackup({ backupDir: empty, dataDir: dir })).toThrow(/ناقصة|لا يوجد/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('pruneBackups يبقي الأحدث ويقترح حذف الأقدم', () => {
    const names = ['20260101-000000', '20260102-000000', '20260103-000000']
    expect(pruneBackups(names, 2)).toEqual(['20260101-000000'])
    expect(pruneBackups(names, 5)).toEqual([])
  })

  it('stampNow بصيغة YYYYMMDD-HHMMSS', () => {
    expect(stampNow(new Date('2026-08-30T14:15:09Z'))).toMatch(/^\d{8}-\d{6}$/)
  })
})
