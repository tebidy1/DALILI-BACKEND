// إثبات حيّ للتفريغ التلقائي (قرار المالك 2026-08-30): POST /api/guides/:id/transcribe?apply
// يرفع صوت كلام حقيقي (webm) → ينشئ دليلًا بصوت → apply=true → الملاحظات مُلئت → البحث يجد الكلام.
// ضد الخادم الحقيقي الحي (8787) وقروك الحقيقي (whisper-large-v3-turbo، كشف لغة تلقائي).
// التشغيل: node scripts/live-vox-apply.mjs <ملف-صوت webm>
// خرج ≠ 0 عند أي فشل برسالة عربية — لا نجاح مزيّف.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:8787'
const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const audioPath = process.argv[2]
if (!audioPath || !fs.existsSync(audioPath)) {
  console.error('الاستعمال: node scripts/live-vox-apply.mjs <ملف-صوت webm>')
  process.exit(2)
}

function fail(msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

async function api(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, opts)
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: res.headers.get('set-cookie') }
}

// 1) تسجيل مستخدم تجريبي
const email = `vox-apply-${Date.now()}@dalili.sa`
const reg = await api('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'vox-apply-live-123' }),
})
if (reg.status !== 200) fail('التسجيل فشل: ' + JSON.stringify(reg.body))
const cookie = reg.cookie.split(';')[0]

// 2) رفع الصوت (نفس دورة الإنتاج)
const form = new FormData()
form.append('file', new Blob([new Uint8Array(fs.readFileSync(audioPath))], { type: 'audio/webm' }), 'voice.webm')
const up = await api('/api/uploads', { method: 'POST', headers: { cookie }, body: form })
if (up.status !== 200) fail('رفع الصوت فشل: ' + JSON.stringify(up.body))
const fileId = up.body.fileId

// 3) دليل من 3 خطوات فوق نطاق الصوت (كلام إنجليزي حقيقي: فتح الفواتير ثم الحفظ)
const T0 = Date.now() - 60_000
const mk = (ts, title) => ({ id: crypto.randomUUID(), kind: 'navigate', title, target: {}, sensitive: false, url: 'https://erp.test/i', pageTitle: title, ts, screenshot: { missing: true, reason: 'إثبات' } })
const guide = {
  id: 'live-vox-apply',
  schemaVersion: 1,
  title: 'إثبات التفريغ التلقائي الحي',
  locale: 'ar',
  dir: 'rtl',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  steps: [mk(T0 + 300, 'الافتتاح'), mk(T0 + 3_200, 'الحفظ'), mk(T0 + 5_800, 'الختام')],
  audio: { fileId, fileUrl: `${BASE}/files/${fileId}`, durationMs: 6_550, startedAt: T0 },
}
const create = await api('/api/guides', {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ guide }),
})
if (create.status !== 200) fail('إنشاء الدليل فشل: ' + JSON.stringify(create.body))
const id = create.body.id

// 4) التفريغ التلقائي: apply=true
const tr = await api(`/api/guides/${id}/transcribe`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ apply: true }),
})
if (tr.status !== 200) fail('التفريغ فشل: ' + JSON.stringify(tr.body))
console.log('✓ التفريغ التلقائي:', JSON.stringify({ provider: tr.body.provider, applied: tr.body.applied }))

// 5) الملاحظات مُلئت فعلًا؟
const got = await api(`/api/guides/${id}`, { headers: { cookie } })
const notes = got.body.guide.steps.map((s) => s.note ?? '')
console.log('✓ ملاحظات الخطوات:', JSON.stringify(notes, null, 1))
if (!notes.some((n) => n.trim())) fail('لا ملاحظة مُلئت رغم applied')

// 6) الكلام دخل فهرس البحث؟
const q = encodeURIComponent('invoices')
const search = await api(`/api/search?q=${q}`, { headers: { cookie } })
const hit = (search.body.hits ?? []).some((h) => h.guideId === id)
console.log(`✓ البحث عن "invoices": ${hit ? 'وجد الدليل' : 'لم يجد'} (${(search.body.hits ?? []).length} نتيجة)`)
if (!hit) fail('الكلام المفرَّغ لم يدخل فهرس البحث')

console.log('\n★ الإثبات الحي مكتمل: رفع → دليل بصوت → تفريغ تلقائي apply → ملاحظات → بحث. الدليل:', `${BASE}/g/${id}`)
