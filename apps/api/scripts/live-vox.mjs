// إثبات حيّ لـVOX-04: تفريغ عربي حقيقي من قروك (whisper-large-v3-turbo).
// يعكس منطق src/stt/groq.ts حرفيًا لكنه قائم بذاته (node fetch، لا curl — curl يشوّه العربية).
//
// التشغيل:  node scripts/live-vox.mjs <ملف-صوت>
//   الصوت أي صيغة يقبلها قروك: webm/wav/mp3/m4a/ogg/flac (مقاطع MediaRecorder لدينا webm).
// يقرأ GROQ_API_KEY من apps/api/.env. يطبع الحالة + النص الكامل + المقاطع بطوابعها.
// خرج ≠ 0 عند أي فشل برسالة عربية — لا نجاح مزيّف.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'

function readEnv() {
  const p = path.join(APP_DIR, '.env')
  const map = {}
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) map[m[1]] = m[2]
  }
  return map
}

/** نفس تحويل src/stt/groq.ts: verbose_json (ثوانٍ) → مقاطع core (ms) */
function parseGroqSegments(json) {
  const raw = Array.isArray(json?.segments) ? json.segments : []
  if (raw.length > 0) {
    return raw
      .map((s) => ({ startMs: Math.round((s.start ?? 0) * 1000), text: (s.text ?? '').trim() }))
      .filter((s) => s.text)
  }
  const whole = (json?.text ?? '').trim()
  return whole ? [{ startMs: 0, text: whole }] : []
}

const audioPath = process.argv[2]
if (!audioPath) {
  console.error('الاستعمال: node scripts/live-vox.mjs <ملف-صوت webm/wav/mp3/...>')
  process.exit(2)
}
if (!fs.existsSync(audioPath)) {
  console.error(`ملف الصوت غير موجود: ${audioPath}`)
  process.exit(2)
}

const key = readEnv().GROQ_API_KEY
if (!key) {
  console.error('لا GROQ_API_KEY في apps/api/.env — أضِفه ثم أعد المحاولة')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(audioPath))
const form = new FormData()
form.append('file', new Blob([bytes], { type: 'audio/webm' }), path.basename(audioPath))
form.append('model', MODEL)
form.append('language', 'ar')
form.append('response_format', 'verbose_json')

const t0 = Date.now()
const res = await fetch(GROQ_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}` },
  body: form,
})
const elapsed = Date.now() - t0

if (!res.ok) {
  console.error(`فشل التفريغ من قروك (${res.status}) — ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}

const json = await res.json()
const segments = parseGroqSegments(json)
console.log(`✔ التفريغ نجح في ${elapsed}ms — النموذج ${MODEL}`)
console.log(`— حجم الصوت: ${(bytes.length / 1024).toFixed(1)}KB · عدد المقاطع: ${segments.length}`)
console.log('\n— النص الكامل:\n' + (json.text ?? '').trim())
console.log('\n— المقاطع بطوابعها (ms):')
for (const s of segments) console.log(`  [${String(s.startMs).padStart(6)}] ${s.text}`)
