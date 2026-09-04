import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterAll } from 'vitest'
import { createApp } from '../src/app'

export interface TestApp {
  app: import('fastify').FastifyInstance
  close: () => Promise<void>
  /** مجلد البيانات — يكشفه buildTestAppWithDir دائمًا (وكاش buildTestApp يحمله أيضًا) */
  dir?: string
}

let current: TestApp | null = null

export async function buildTestApp(): Promise<TestApp> {
  const { app, close, dir } = await buildTestAppWithDir()
  return { app, close }
}

/** نسخة تكشف مجلد البيانات — لفحص القاعدة مباشرة في الاختبارات */
export async function buildTestAppWithDir(): Promise<TestApp & { dir: string }> {
  if (current) {
    if (!current.dir) throw new Error('buildTestApp استُدعي أولًا بلا dir — هذا كاش مفوتر')
    return current as TestApp & { dir: string }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-test-'))
  const { app, close } = await createApp({
    dataDir: dir,
    cookieSecret: 'test-secret-not-for-production',
    publicBase: 'http://localhost:8787',
  })
  // الكاش يحمل dir دائمًا — من استدعى buildTestApp أولًا لا يحجبه عن من يريد الفحص المباشر
  const made: TestApp & { dir: string } = { app, close, dir }
  current = made
  afterAll(async () => {
    await close()
    current = null
  })
  return made
}

/** كلمة مرور عشوائية لكل مستخدم تجريبي — لا ثابت credential في المصدر */
export function randomTestPassword(): string {
  return 't-' + randomBytes(12).toString('base64url')
}

/** تسجيل مستخدم وإرجاع كوكي جاهز للاستخدام في inject */
export async function registerUser(
  app: import('fastify').FastifyInstance,
  email: string,
  password = randomTestPassword(),
) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`register failed ${res.statusCode}: ${res.body}`)
  const rawCookie = res.headers['set-cookie']
  const first = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie
  const cookie = first!.split(';')[0]!
  return { cookie, me: res.json() as { id: string; email: string }, password }
}
