/**
 * بوابة VOX-04 — قياس WER (نسبة أخطاء الكلمات) على مجموعة أزواج حقيقية.
 *
 * المدخل: مجلدٌ فيه لكل عينة ملفان بالاسم نفسه:
 *   <اسم>.audio.<أي امتداد يقبله قروك: webm|mp3|wav|...>   الصوت
 *   <اسم>.ref.txt                                          النص المرجعي (ما قيل فعلًا)
 *
 * التشغيل:  pnpm --filter @dalili/api wer-gate <مجلد>
 * يقرأ GROQ_API_KEY من apps/api/.env، يفرّغ كل صوت عبر whisper-large-v3-turbo،
 * يقيس WER بمنطق @dalili/core (تطبيع عربي + ترقيم متجاهَل)، ثم يحكم:
 *   البوابة ≤20% على مستوى المجموعة (إجمالي الأخطاء ÷ إجمالي كلمات المرجع).
 * خرج ≠ 0 عند أي فشل — لا نجاح مزيّف. النتائج تُطبع ولا تُكتب في ملفات.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { werDetail } from '@dalili/core'

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const GATE = 0.2

function readEnv(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of fs.readFileSync(path.join(APP_DIR, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
  }
  return map
}

interface Pair {
  name: string
  audioPath: string
  ref: string
}

function loadPairs(dir: string): Pair[] {
  const files = fs.readdirSync(dir)
  const pairs: Pair[] = []
  for (const f of files) {
    const m = f.match(/^(.+)\.audio\.\w+$/)
    if (!m) continue
    const name = m[1]!
    const refPath = path.join(dir, `${name}.ref.txt`)
    if (!fs.existsSync(refPath)) continue // ليس زوجًا — تجاهُل صامت للملفات غير المكتملة
    pairs.push({ name, audioPath: path.join(dir, f), ref: fs.readFileSync(refPath, 'utf8').trim() })
  }
  pairs.sort((a, b) => a.name.localeCompare(b.name))
  return pairs
}

async function transcribe(key: string, filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath)
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(buf)]), path.basename(filePath))
  fd.append('model', MODEL)
  fd.append('response_format', 'json')
  fd.append('language', 'ar')
  const res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`قروك ردّ ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as { text?: string }
  return (json.text ?? '').trim()
}

// SEC: مجلد العينات يُحلّ مطلقًا ويجب أن يكون مجلدًا حقيقيًا — لا قراءة من مسار مرتجل
const requested = process.argv[2]
const dir = requested ? path.resolve(requested) : ''
if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error('الاستخدام: pnpm --filter @dalili/api wer-gate <مجلد-الأزواج>')
  process.exit(1)
}
const key = readEnv()['GROQ_API_KEY']
if (!key) {
  console.error('GROQ_API_KEY غير موجود في apps/api/.env — ضعه أولًا')
  process.exit(1)
}

const pairs = loadPairs(dir)
if (pairs.length === 0) {
  console.error('لا أزواج في المجلد — كل عينة تحتاج <اسم>.audio.<امتداد> + <اسم>.ref.txt')
  process.exit(1)
}

console.log(`قياس WER على ${pairs.length} عينة من ${dir} — المزوّد ${MODEL}`)
let totalErr = 0
let totalRef = 0
let failures = 0
for (const p of pairs) {
  let hyp: string
  try {
    hyp = await transcribe(key, p.audioPath)
  } catch (e) {
    failures++
    console.error(` ✗ ${p.name}: ${e instanceof Error ? e.message : 'فشل غير معروف'}`)
    continue
  }
  const d = werDetail(p.ref, hyp)
  totalErr += d.sub + d.del + d.ins
  totalRef += d.refWords
  console.log(
    ` ${d.wer <= GATE ? '✓' : '✗'} ${p.name}: WER ${(d.wer * 100).toFixed(1)}% ` +
      `(إبدال ${d.sub} · حذف ${d.del} · إضافة ${d.ins} من ${d.refWords} كلمة)`,
  )
  console.log(`    فرضية المزوّد: ${hyp.slice(0, 120)}`)
}

if (failures > 0) {
  console.error(`فشل تفريغ ${failures} عينة — لا حكم على البوابة حتى تنجح كلها`)
  process.exit(1)
}
const corpusWer = totalRef === 0 ? 0 : totalErr / totalRef
const verdict = corpusWer <= GATE ? 'ناجحة' : 'راسبة'
console.log(`\nإجمالي المجموعة: WER ${(corpusWer * 100).toFixed(1)}% — البوابة ≤${GATE * 100}% → ${verdict}`)
process.exit(corpusWer <= GATE ? 0 : 2)
