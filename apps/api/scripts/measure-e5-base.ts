/**
 * SRCH-06 تحسين — بوابة قرار e5-base: قياس لا تبنٍّ أعمى (قرار المالك 2026-09-04).
 * يجرّ على **نسخة** القاعدة الحية (db.backup — الحية لا تُلمس) نموذجَين:
 *   small = Xenova/multilingual-e5-small (المتبنّى اليوم) · base = Xenova/multilingual-e5-base
 * ويطبع لكلٍّ: متوسط فصل القمة ذات الصلة عن أول دخيل (Score Gap) + احتواء الضوضاء + p50/p95.
 * **معيار التبني الموثق:** base يُتبنّى فقط إن ارتفع الفصل ≥50% مع بقاء p95<300مث —
 * والقرار يُعرض على المالك بالأرقام قبل التبني (التبني نفسه = سطر المزوّد + backfill إقلاعي).
 * التشغيل: pnpm --filter @dalili/api tsx scripts/measure-e5-base.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { createApp } from '../src/app'
import { createLocalEmbeddingProvider } from '../src/embeddings/local'
import { backfillEmbeddings } from '../src/embeddings/store'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIVE_DB = path.join(APP_DIR, 'data', 'dalili.db')
const MODELS_DIR = path.join(APP_DIR, '.models')

/** استعلامات مرجعية بهدف معروف (الهدف عنوان دليل مبذور) */
const TARGETED: Array<{ q: string; target: string }> = [
  { q: 'كيف أوافق على المطالبة المالية الخاصة بالزبون؟', target: 'اعتماد الفاتورة النهائية' },
  { q: 'أبغى أسدد مبلغ الخدمات الحكومية عن الكهرباء', target: 'دفع فاتورة الكهرباء عبر بوابة الحكومة' },
  { q: 'الشاشة تقول الكود السري منتهي ولا يدخلني', target: 'استرجاع كلمة مرور منتهية الصلاحية' },
  { q: 'أريد حجز قاعة لاجتماع الشهر القادم', target: 'حجز قاعة الاجتماعات من لوحة الحجوزات' },
  { q: 'كم تكلفة شحن بضاعة للمندوب اليوم؟', target: 'متابعة حالة الشحنات الصادرة للمندوبين' },
  { q: 'أجر الموظف ناقص هذا الشهر بسبب الغياب', target: 'صرف راتب الموظف وتأكيد الخصومات' },
]

/** استعلامات الضوضاء: ما يُظهره البحث من هذه العناوين «الممنوعة» هو دخيل مقيس */
const NOISE: Array<{ q: string; forbid: string[] }> = [
  { q: 'كيف أسجل دخولي إلى النظام', forbid: ['فاتورة'] },
  { q: 'فاتورة', forbid: ['كلمة مرور', 'إجازة سنوية'] },
  { q: 'هل يمكنني تغيير مظهر الشاشة', forbid: ['فاتورة', 'راتب'] },
  { q: 'شرح طريقة إضافة جهاز للشبكة', forbid: ['شحنات', 'فاتورة'] },
]

function makeGuide(title: string): unknown {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1 as const,
    title,
    locale: 'ar' as const,
    dir: 'rtl' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      { id: crypto.randomUUID(), kind: 'click' as const, title: 'افتح الشاشة المطلوبة', note: `خطوة في دليل: ${title}`, target: { role: 'button' }, sensitive: false, url: 'https://erp.example.com/app', pageTitle: 'النظام', ts: Date.now() },
      { id: crypto.randomUUID(), kind: 'click' as const, title: 'أكمل الإجراء واحفظ', note: 'خطوة أخيرة', target: { role: 'button' }, sensitive: false, url: 'https://erp.example.com/app', pageTitle: 'النظام', ts: Date.now() },
    ],
  }
}

const SEED_TITLES = [
  'اعتماد الفاتورة النهائية قبل الإرسال للعميل',
  'صرف راتب الموظف وتأكيد الخصومات',
  'طلب إجازة سنوية والموافقة عليها',
  'استرجاع كلمة مرور منتهية الصلاحية',
  'حجز قاعة الاجتماعات من لوحة الحجوزات',
  'متابعة حالة الشحنات الصادرة للمندوبين',
  'تسجيل موظف جديد في النظام ومنحه الصلاحيات',
  'طباعة باركود للأصناف ونشرها على الرفوف',
  'إضافة جهاز جديد لشبكة المكتب',
  'دفع فاتورة الكهرباء عبر بوابة الحكومة',
  'إقفال السنة المالية وترحيل الأرصدة',
  'تحويل كمية بين مستودعين وإثباتها',
  'توثيق شكوى عميل ومتابعة حلها',
  'تجهيز تقرير المبيعات الشهري وتصديره',
  'تعطيل حساب موظف منتهي خدمة',
]

interface ModelResult {
  model: string
  gaps: number[]
  gapMean: number
  targetHits: number
  noiseViolations: string[]
  p50: number
  p95: number
  embedded: number
}

async function measureModel(model: string): Promise<ModelResult> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dalili-measure-${model.includes('base') ? 'base' : 'small'}-`))
  const src = new Database(LIVE_DB, { readonly: true })
  await src.backup(path.join(tmp, 'dalili.db'))
  src.close()

  const provider = createLocalEmbeddingProvider({ modelsDir: MODELS_DIR, model })
  const { app, close, sqlite } = await createApp({
    dataDir: tmp,
    cookieSecret: 'measure-secret-not-for-production-32',
    publicBase: 'http://localhost:8788',
    embeddings: provider,
    rateLimit: true,
  })

  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `measure-${Date.now()}@proof.sa`, password: 'proof-' + Math.random().toString(36).slice(2) } })
  const rawCookie = reg.headers['set-cookie']
  const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';')[0]!
  const userId = (reg.json() as { id: string }).id
  const ws = sqlite.prepare('SELECT id FROM workspaces WHERE owner_id = ?').get(userId) as { id: string }
  sqlite.prepare('UPDATE guides SET user_id = ?, workspace_id = ?').run(userId, ws.id)

  for (const title of SEED_TITLES) {
    const r = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: makeGuide(title) } })
    if (r.statusCode !== 200) throw new Error(`seed failed: ${r.body}`)
  }
  const bf = await backfillEmbeddings(sqlite, provider)
  const embedded = (sqlite.prepare('SELECT count(*) c FROM guide_embeddings').get() as { c: number }).c
  console.log(`  — ${provider.name}: بصمات ${embedded} (backfill ضمّن ${bf.embedded})`)

  // تسخين (تحميل النموذج بقياسه منفصلًا عن القياسات)
  const warm0 = Date.now()
  await app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent('فاتورة')}`, headers: { cookie } })
  console.log(`  — تحميل النموذج الأول: ${Date.now() - warm0}مث`)

  const gaps: number[] = []
  let targetHits = 0
  const latencies: number[] = []
  const noiseViolations: string[] = []
  const runSearch = async (q: string) => {
    const t0 = Date.now()
    const r = await app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}`, headers: { cookie } })
    latencies.push(Date.now() - t0)
    return r.json() as { semantic?: Array<{ guideTitle: string; score: number }>; semanticReason?: string }
  }

  for (const c of TARGETED) {
    const body = await runSearch(c.q)
    const list = body.semantic ?? []
    const idx = list.findIndex((h) => h.guideTitle.includes(c.target))
    if (idx >= 0) {
      targetHits++
      const targetScore = list[idx]!.score
      const intruders = list.filter((_, i) => i !== idx)
      const firstIntruder = Math.max(...intruders.map((h) => h.score), 0)
      gaps.push(targetScore - firstIntruder)
    } else {
      gaps.push(-1) // غياب الهدف أسوأ فجوة ممكنة — يُحسب ضمن المتوسط بصدق
    }
    console.log(`  «${c.q}» → ${idx >= 0 ? `الهدف مركز ${idx + 1}` : 'الهدف غائب!'} (فجوة ${gaps[gaps.length - 1]!.toFixed(3)})`)
  }

  for (const c of NOISE) {
    const body = await runSearch(c.q)
    const titles = (body.semantic ?? []).map((h) => h.guideTitle)
    const hits = c.forbid.filter((f) => titles.some((t) => t.includes(f)))
    if (hits.length > 0) noiseViolations.push(...hits)
    console.log(`  «${c.q}» → ${hits.length === 0 ? 'نظيف (لا دخيل ممنوع)' : `دخليل: ${hits.join('، ')}`}`)
  }

  const sorted = [...latencies].sort((a, b) => a - b)
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
  const result: ModelResult = {
    model: provider.name,
    gaps,
    gapMean: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    targetHits,
    noiseViolations: [...new Set(noiseViolations)],
    p50: pct(0.5),
    p95: pct(0.95),
    embedded,
  }

  await close()
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return result
}

function q(s: string): string {
  return s
}

async function main() {
  console.log('① قياس المتبنّى الحالي (e5-small)…')
  const small = await measureModel('Xenova/multilingual-e5-small')
  console.log('\n② قياس المرشّح (e5-base)…')
  const base = await measureModel('Xenova/multilingual-e5-base')

  const improvement = small.gapMean === 0 ? Infinity : ((base.gapMean - small.gapMean) / Math.abs(small.gapMean)) * 100
  console.log('\n════════ بوابة قرار e5-base — الأرقام للمالك ════════')
  console.log(`                      small                base`)
  console.log(`  متوسط الفجوة     ${small.gapMean.toFixed(3).padEnd(20)} ${base.gapMean.toFixed(3)}`)
  console.log(`  إصابة الهدف      ${`${small.targetHits}/${TARGETED.length}`.padEnd(20)} ${base.targetHits}/${TARGETED.length}`)
  console.log(`  دخيل الضوضاء     ${small.noiseViolations.length ? small.noiseViolations.join('،') : 'صفر'.padEnd(18)} ${base.noiseViolations.length ? base.noiseViolations.join('،') : 'صفر'}`)
  console.log(`  p50 / p95        ${`${small.p50}/${small.p95}مث`.padEnd(20)} ${base.p50}/${base.p95}مث (المعيار <300مث)`)

  const gateSeparation = improvement >= 50
  const gateLatency = base.p95 < 300
  console.log(`\n  تحسّن الفصل: ${improvement.toFixed(1)}% (بوابة ≥50%: ${gateSeparation ? 'متحققة' : 'غير متحققة'})`)
  console.log(`  p95‏ الأساس: ${base.p95}مث (بوابة <300مث: ${gateLatency ? 'متحققة' : 'غير متحققة'})`)
  console.log(`\n  القرار الآلي المقترح: ${gateSeparation && gateLatency ? 'مرشّح للتبني — **يُعرض على المالك بالأرقام قبل التبني** (سطر المزوّد + backfill إقلاعي)' : 'لا تبنٍّ — يبقى small (الأرقام فوق هي التوثيق)'}`)
}

main().catch((e) => {
  console.error('MEASURE_FAIL', e)
  process.exit(1)
})
