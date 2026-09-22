import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { newUserCode, normalizeUserCode } from '../src/routes/devices'
import { buildTestAppWithDir, registerUser } from './helpers'

/** DTOP-03: الاقتران برمز — التطبيق الأصلي لا يرى كلمة السرّ ولا الكوكي أبدًا */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(64)])
const multipartBody = (buf: Buffer) =>
  Buffer.concat([
    Buffer.from('--bnd\r\nContent-Disposition: form-data; name="file"; filename="shot.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'),
    buf,
    Buffer.from('\r\n--bnd--\r\n'),
  ])

type App = Awaited<ReturnType<typeof buildTestAppWithDir>>['app']

async function pair(app: App, cookie: string, approve = true) {
  const start = await app.inject({ method: 'POST', url: '/api/device/start', payload: { deviceName: 'مكتب سعد' } })
  const { deviceCode, userCode } = start.json() as { deviceCode: string; userCode: string }
  await app.inject({ method: 'POST', url: '/api/device/approve', headers: { cookie }, payload: { userCode, approve } })
  const token = await app.inject({ method: 'POST', url: '/api/device/token', payload: { deviceCode } })
  return { deviceCode, userCode, token }
}

describe('DTOP-03: رمز الربط', () => {
  it('newUserCode بحروف ساكنة XXXX-XXXX، وnormalizeUserCode يقبل كتابة الإنسان ويرفض الغريب', () => {
    expect(newUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
    expect(normalizeUserCode(' bcdf ghjk ')).toBe('BCDF-GHJK')
    expect(normalizeUserCode('BCDF-GHJ')).toBeNull()
    expect(normalizeUserCode('AEIO-UUUU')).toBeNull()
  })
})

describe('DTOP-03: تدفّق الاقتران', () => {
  it('start ← pending(428) ← المتصفّح يرى اسم الجهاز ويوافق ← token مرّة واحدة ← Bearer يعمل', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'dev-1@dalili.sa')

    const start = await app.inject({ method: 'POST', url: '/api/device/start', payload: { deviceName: 'مكتب سعد' } })
    expect(start.statusCode).toBe(200)
    const { deviceCode, userCode, interval, expiresIn } = start.json()
    expect(interval).toBe(3)
    expect(expiresIn).toBe(600)

    const early = await app.inject({ method: 'POST', url: '/api/device/token', payload: { deviceCode } })
    expect(early.statusCode).toBe(428)
    expect(early.json().error).toBe('authorization_pending')

    const pending = await app.inject({ method: 'GET', url: `/api/device/pending?code=${userCode.toLowerCase()}`, headers: { cookie } })
    expect(pending.json().deviceName).toBe('مكتب سعد')

    expect((await app.inject({ method: 'POST', url: '/api/device/approve', headers: { cookie }, payload: { userCode, approve: true } })).statusCode).toBe(200)

    const ok = await app.inject({ method: 'POST', url: '/api/device/token', payload: { deviceCode } })
    expect(ok.statusCode).toBe(200)
    const { token, user } = ok.json()
    expect(token).toMatch(/^itq_/)
    expect(user.email).toBe('dev-1@dalili.sa')

    // /me لا يسرّب deviceId — الشكل نفسه للكوكي والرمز
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({ id: user.id, email: 'dev-1@dalili.sa' })

    const again = await app.inject({ method: 'POST', url: '/api/device/token', payload: { deviceCode } })
    expect(again.statusCode).toBe(410)
  })

  it('الرفض ← 403 access_denied', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'dev-2@dalili.sa')
    const { token } = await pair(app, cookie, false)
    expect(token.statusCode).toBe(403)
    expect(token.json().error).toBe('access_denied')
  })

  it('انتهاء المهلة ← 410 expired_token', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const start = await app.inject({ method: 'POST', url: '/api/device/start', payload: { deviceName: 'قديم' } })
    const raw = new Database(path.join(dir, 'dalili.db'))
    raw.prepare('UPDATE device_codes SET expires_at = ? WHERE user_code = ?').run('2000-01-01T00:00:00.000Z', start.json().userCode)
    raw.close()
    const res = await app.inject({ method: 'POST', url: '/api/device/token', payload: { deviceCode: start.json().deviceCode } })
    expect(res.statusCode).toBe(410)
  })

  it('بلا جلسة: pending وapprove ← 401 · رمز بصيغة فاسدة ← 400', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'dev-7@dalili.sa')
    const start = await app.inject({ method: 'POST', url: '/api/device/start', payload: { deviceName: 'مجهول' } })
    const userCode = start.json().userCode as string
    expect((await app.inject({ method: 'GET', url: `/api/device/pending?code=${userCode}` })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/device/approve', payload: { userCode, approve: true } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/device/approve', headers: { cookie }, payload: { userCode: 'AEIO-UUUU', approve: true } })).statusCode).toBe(400)
  })

  it('رمز جهاز لا يرى ولا يوافق على جهاز آخر ولا يدير الأجهزة ← 403', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'dev-3@dalili.sa')
    const { token } = await pair(app, cookie)
    const bearer = { authorization: `Bearer ${token.json().token}` }
    const other = await app.inject({ method: 'POST', url: '/api/device/start', payload: { deviceName: 'دخيل' } })
    const otherCode = other.json().userCode as string
    expect((await app.inject({ method: 'GET', url: `/api/device/pending?code=${otherCode}`, headers: bearer })).statusCode).toBe(403)
    const approve = await app.inject({ method: 'POST', url: '/api/device/approve', headers: bearer, payload: { userCode: otherCode, approve: true } })
    expect(approve.statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/devices', headers: bearer })).statusCode).toBe(403)
  })

  it('Bearer يرفع لقطة، والرمز مخزَّن بصمةً لا نصًّا', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'dev-4@dalili.sa')
    const { token } = await pair(app, cookie)
    const t = token.json().token as string
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'multipart/form-data; boundary=bnd' },
      payload: multipartBody(JPEG),
    })
    expect(res.statusCode).toBe(200)
    const raw = new Database(path.join(dir, 'dalili.db'), { readonly: true })
    const row = raw.prepare('SELECT token_hash FROM device_tokens WHERE id = ?').get(token.json().deviceId) as { token_hash: string }
    raw.close()
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.token_hash).not.toContain(t)
  })

  it('القائمة ثم الإبطال ← الرمز يسقط فورًا (401)، وجهاز غيري ← 404', async () => {
    const { app } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'dev-5@dalili.sa')
    const { cookie: otherCookie } = await registerUser(app, 'dev-6@dalili.sa')
    const { token } = await pair(app, cookie)
    const { deviceId, token: t } = token.json()

    const list = await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } })
    expect(list.json()).toEqual([expect.objectContaining({ id: deviceId, deviceName: 'مكتب سعد' })])

    expect((await app.inject({ method: 'DELETE', url: `/api/devices/${deviceId}`, headers: { cookie: otherCookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/devices/${deviceId}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(401)
  })

  it('Bearer فاسد ← 401، ورمز بلا بادئة itq_ لا يُبحث عنه', async () => {
    const { app } = await buildTestAppWithDir()
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: 'Bearer itq_nope' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: 'Bearer abc' } })).statusCode).toBe(401)
  })
})
