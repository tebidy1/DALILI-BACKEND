/**
 * VOX-09 «ميك الخطوة» — إثبات حي ضد الخادم الحي 8787 وقاعدة المالك الحقيقية:
 * دليل بخطوتين وملفا كلام عربي حقيقيان (العينة المطبوخة live-speech.webm) →
 * transcribe-steps → الملاحظة الفارغة تُملأ والمكتوبة يُلحق تحتها بسطر →
 * البحث الحرفي يجد كلام التعليق → إعادة التفريغ لا تكرّر → تنظيف ذاتي كامل.
 * التشغيل: node apps/api/scripts/live-step-voice-proof.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API = 'http://127.0.0.1:8787'
const SAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'live-speech.webm')

let pass = 0
let fail = 0
function check(ok, label) {
  if (ok) {
    pass++
    console.log(`✓ ${label}`)
  } else {
    fail++
    console.log(`✗ ${label}`)
  }
}

async function req(pathname, opts = {}, cookie) {
  const res = await fetch(API + pathname, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  })
  return res
}

async function main() {
  // ١) حساب إثبات جديد
  const email = `step-voice-${Date.now()}@proof.sa`
  const reg = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'proof-' + Math.random().toString(36).slice(2) }),
  })
  const rawCookie = reg.headers.get('set-cookie') ?? ''
  const cookie = rawCookie.split(';')[0]
  check(reg.ok && !!cookie, '١ تسجيل حساب الإثبات')

  // ٢) حذف الدليل الترحيبي نهائيًا كي تبقى القوائم مضبوطة
  const list = await (await req('/api/guides?limit=50', {}, cookie)).json()
  for (const g of list.items) {
    await req(`/api/guides/${g.id}?permanent=1`, { method: 'DELETE' }, cookie)
  }

  // ٣) رفع ملفي الكلام الحقيقيين (دورة الرفع نفسها)
  const bytes = new Uint8Array(fs.readFileSync(SAMPLE))
  async function upload() {
    const body = Buffer.concat([
      Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="memo.webm"\r\nContent-Type: audio/webm\r\n\r\n'),
      bytes,
      Buffer.from('\r\n--b--\r\n'),
    ])
    const res = await req('/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
      body: new Uint8Array(body),
    }, cookie)
    return (await res.json()).fileId
  }
  const f1 = await upload()
  const f2 = await upload()
  check(!!f1 && !!f2, '٢ رفع ملفي الكلام (webm حقيقيان)')

  // ٤) إنشاء دليل بخطوتين: الأولى بلا ملاحظة، والثانية بملاحظة مكتوبة يدويًا
  const now = new Date().toISOString()
  const guide = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 10),
    schemaVersion: 1,
    title: 'ميك الخطوة — دليل إثبات حي (يمكن حذفه)',
    locale: 'ar',
    dir: 'rtl',
    createdAt: now,
    updatedAt: now,
    steps: [
      { id: crypto.randomUUID(), kind: 'click', title: 'افتح الشاشة الأولى', target: { text: 'ابدأ' }, sensitive: false, url: 'https://erp.example.com/a', pageTitle: 'أ', ts: 1, voice: { fileId: f1, durationMs: 5_000 } },
      { id: crypto.randomUUID(), kind: 'click', title: 'أكمل الخطوة الثانية', target: { text: 'حفظ' }, sensitive: false, url: 'https://erp.example.com/b', pageTitle: 'ب', ts: 2, note: 'ملاحظة مكتوبة يدويًا قبل الصوت', voice: { fileId: f2, durationMs: 6_000 } },
    ],
  }
  const created = await req('/api/guides', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guide }),
  }, cookie)
  const guideId = (await created.json()).id
  check(created.ok && !!guideId, '٣ إنشاء دليل بخطوتين وvoice لكل خطوة')

  // ٥) تفريغ تعليقات الخطوات عبر قروك الحقيقي
  // (فخ 33: POST بترويسة JSON بلا جسم = 500 عابر — لا ترويسة بلا جسم)
  const tr = await req(`/api/guides/${guideId}/transcribe-steps`, { method: 'POST' }, cookie)
  const trBody = await tr.json()
  check(tr.status === 200, `٤ نقطة transcribe-steps تعمل (${tr.status})`)
  check(Array.isArray(trBody.results) && trBody.results.length === 2 && trBody.results.every((r) => r.ok), '٥ نتيجتا الخطوتين ناجحتان بصدق')

  // ٦) القراءة: الفارغة مُلئت والمكتوبة أُلحق تحتها بسطر
  const details = await (await req(`/api/guides/${guideId}`, {}, cookie)).json()
  const steps = details.guide.steps
  const note1 = steps[0]?.note ?? ''
  const note2 = steps[1]?.note ?? ''
  check(note1.trim().length > 0, `٦ الملاحظة الفارغة مُلئت من كلام الصوت: «${note1.slice(0, 40)}…»`)
  check(
    note2.startsWith('ملاحظة مكتوبة يدويًا قبل الصوت') && note2.includes('\n') && note2.length > 'ملاحظة مكتوبة يدويًا قبل الصوت'.length,
    '٧ الملاحظة المكتوبة بقيت وأُلحق كلام الصوت أسفلها بسطر',
  )
  check(steps[0]?.voice?.pending === false && steps[1]?.voice?.pending === false, '٨ علامة المعالجة (pending=false) على التعليقين')

  // ٧) البحث الحرفي يجد كلام التعليق (فهرس FTS5 في نفس المعاملة)
  const needle = note1.trim().split(/\s+/).slice(0, 4).join(' ')
  const search = await (await req(`/api/search?q=${encodeURIComponent(needle)}&limit=10`, {}, cookie)).json()
  const found = (search.hits ?? []).some((h) => h.guideId === guideId)
  check(found, `٩ البحث يجد كلام التعليق («${needle}») — ${search.total} دليلًا`)

  // ٨) إعادة التفريغ لا تكرّر الإلحاق (علامة pending=false)
  const again = await req(`/api/guides/${guideId}/transcribe-steps`, { method: 'POST' }, cookie)
  const againBody = await again.json()
  const details2 = await (await req(`/api/guides/${guideId}`, {}, cookie)).json()
  check(
    again.status === 200 && details2.guide.steps[1].note === note2,
    '١٠ إعادة التفريغ تتجاوز المعالج ولا تكرّر الإلحاق',
  )

  // ٩) تنظيف ذاتي كامل
  const del = await req(`/api/guides/${guideId}?permanent=1`, { method: 'DELETE' }, cookie)
  const after = await (await req(`/api/guides/${guideId}`, {}, cookie)).status
  check(del.status === 204 && after === 404, '١١ تنظيف ذاتي — الدليل المحذوف نهائيًا 404')

  console.log(`\nالخلاصة: ${pass} نجح / ${fail} فشل`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('PROOF_FAIL', e)
  process.exit(1)
})
