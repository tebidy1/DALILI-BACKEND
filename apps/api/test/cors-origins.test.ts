import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { DEFAULT_CORS_ORIGINS, parseCorsOrigins } from '../src/lib/cors-origins'

/** DTOP-04: قائمة الأصول من الإعدادات بدل regex مثبّت في الشيفرة */
describe('parseCorsOrigins', () => {
  it('الافتراضي: الامتداد بصيغة معرّفه الحقيقيّة + الويب المحلي', () => {
    const list = parseCorsOrigins(undefined)
    expect(list).toHaveLength(3)
    const ext = list[0] as RegExp
    expect(ext.test('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true)
    expect(ext.test('chrome-extension://evil.example')).toBe(false)
    expect(list.slice(1)).toEqual(['http://localhost:5174', 'http://127.0.0.1:5174'])
    expect(DEFAULT_CORS_ORIGINS).toContain('chrome-extension://*')
  })

  it('يقبل أصول الإنتاج الدقيقة ويرفض الخاطئة باسم المفتاح', () => {
    expect(parseCorsOrigins('https://itqan.example, https://app.itqan.example:8443')).toEqual(['https://itqan.example', 'https://app.itqan.example:8443'])
    expect(() => parseCorsOrigins('https://itqan.example/')).toThrow(/CORS_ORIGINS/)
    expect(() => parseCorsOrigins('*')).toThrow(/CORS_ORIGINS/)
    expect(() => parseCorsOrigins(' , ')).toThrow(/CORS_ORIGINS/)
  })
})

describe('createApp يحترم corsOrigins', () => {
  it('الأصل المسموح يُعاد في الترويسة، وغيره لا', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-cors-'))
    const { app, close } = await createApp({ dataDir: dir, cookieSecret: 'test-secret-not-for-production', publicBase: 'http://localhost:8787', corsOrigins: ['https://itqan.example'] })
    try {
      const ok = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://itqan.example' } })
      expect(ok.headers['access-control-allow-origin']).toBe('https://itqan.example')
      const no = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5174' } })
      expect(no.headers['access-control-allow-origin']).toBeUndefined()
    } finally {
      await close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
