import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import { z } from 'zod'

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** تحقق صارم عند الإقلاع — أي قيمة فاسدة تُرفض باسم مفتاحها (OPS-05: فشل مبكر لا سلوك غامض) */
const zEnv = z.object({
  PORT: z.coerce
    .number({ invalid_type_error: 'PORT must be a number' })
    .int()
    .min(1)
    .max(65535)
    .default(8787),
  DATA_DIR: z.string().trim().min(1, 'DATA_DIR cannot be empty').default('data'),
  // سر توقيع الجلسات — توليد ذاتي عند أول إقلاع، لكن لا يُقبل قصيرًا إن كُتب يدويًا
  COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 characters'),
  PUBLIC_BASE: z
    .string()
    .url('PUBLIC_BASE must be a valid URL')
    .regex(/^https?:\/\//i, 'PUBLIC_BASE must start with http:// or https://')
    .default('http://localhost:8787'),
  // VOX-04: مفتاح التفريغ (قروك) — اختياري؛ غيابه لا يكسر الإقلاع، والنقطة تردّ 503 صادقة
  GROQ_API_KEY: z.string().trim().min(1).optional(),
})

export interface Env {
  port: number
  dataDir: string
  cookieSecret: string
  publicBase: string
  groqApiKey?: string
}

function readEnvFile(p: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && m[1] !== undefined) map[m[1]] = m[2] ?? ''
  }
  return map
}

/**
 * تحليل وتحقق — نقية وقابلة للاختبار: تُكمل الافتراضات الذاتية ثم ترفض أي قيمة فاسدة
 * برسالة عربية تسمّي المفتاح المذنب.
 */
export function parseEnv(map: Record<string, string>): Env {
  const auto: Record<string, string> = { ...map }
  if (!auto.COOKIE_SECRET) auto.COOKIE_SECRET = 'x'.repeat(32) // loadEnv يولّد سرًّا حقيقيًا قبل الوصول هنا — هذا لصحة التحليل النقي فقط
  const parsed = zEnv.safeParse(auto)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    const key = issue.path.join('.') || 'ENV'
    throw new Error(`قيمة بيئة غير صالحة (${key}) في .env — ${issue.message}`)
  }
  const v = parsed.data
  return {
    port: v.PORT,
    dataDir: v.DATA_DIR,
    cookieSecret: v.COOKIE_SECRET,
    publicBase: v.PUBLIC_BASE,
    groqApiKey: v.GROQ_API_KEY,
  }
}

/**
 * OPS-06: NODE_ENV في .env لا يصل process.env من تلقاء نفسه — هذه الجسر.
 * بلاها تبقى سياسة الكوكي على وضع التطوير في الإنتاج بغفلة (فخ موثق في docs/deployment.md).
 */
export function applyNodeEnv(map: Record<string, string>): string | undefined {
  const v = map.NODE_ENV?.trim()
  if (v === 'production' || v === 'development' || v === 'test') process.env.NODE_ENV = v
  return process.env.NODE_ENV
}

/** إعداد محلي ذاتي: أول إقلاع يولّد .env خاصًا بالتطبيق (لا مفاتيح خارجية إطلاقًا) */
export function loadEnv(): Env {
  const envPath = path.join(APP_DIR, '.env')
  let map: Record<string, string> = {}
  if (fs.existsSync(envPath)) map = readEnvFile(envPath)
  applyNodeEnv(map)
  let changed = false
  if (!map.COOKIE_SECRET) {
    map.COOKIE_SECRET = nanoid(32)
    changed = true
  }
  if (!map.DATA_DIR) {
    map.DATA_DIR = 'data'
    changed = true
  }
  if (!map.PUBLIC_BASE) {
    map.PUBLIC_BASE = 'http://localhost:8787'
    changed = true
  }
  if (changed) {
    fs.writeFileSync(envPath, Object.entries(map).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  }
  const env = parseEnv(map)
  return {
    ...env,
    dataDir: env.dataDir === ':memory:' ? ':memory:' : path.resolve(APP_DIR, env.dataDir),
  }
}
