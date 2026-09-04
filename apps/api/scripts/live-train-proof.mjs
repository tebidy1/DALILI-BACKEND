/** إثبات حي لدربني (AUTO-01 + GM-01 جسرًا): بطاقة تعريف الزر تعبر الخادم كاملة —
 *  إنشاء بخطوة تحمل مرساة → مشاركة → القراءة العامة تعيد المرساة كما هي.
 *  عربية دائمًا عبر encodeURIComponent (curl يشوّه العربية في Git Bash). */
const API = 'http://127.0.0.1:8787'
const EMAIL = 'thumb-view@dalili.sa'
const PASSWORD = 'password123'

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

const j = (r) => r.json()

// 1) دخول
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? ''
check('دخول الحساب', loginRes.status === 200)

const now = new Date().toISOString()

// 2) دليل بخطوة تحمل بطاقة تعريف كاملة (AUTO-01) — schemaVersion حرفي 1 (فخ العقد الحي)
const anchor = [
  { k: 'id', v: 'save-btn' },
  { k: 'testid', v: 'submit' },
  { k: 'text', v: 'اعتماد الفاتورة' },
  { k: 'path', v: 'body > div:nth-of-type(2) > button:nth-of-type(1)' },
]
const step = {
  id: 's1',
  kind: 'click',
  title: 'اضغط زر الاعتماد',
  note: 'زر برتقالي أسفل الشاشة',
  target: { text: 'اعتماد الفاتورة', role: 'button', label: undefined, anchor },
  sensitive: false,
  url: 'https://erp.example.test/invoices/new',
  pageTitle: 'فاتورة جديدة',
  ts: Date.now(),
  screenshot: { missing: true, reason: 'إثبات حي — بلا لقطة' },
}
const createRes = await fetch(`${API}/api/guides`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    guide: {
      id: 'live-train-proof',
      schemaVersion: 1,
      title: `إثبات حي: دربني ${Date.now()}`,
      locale: 'ar',
      dir: 'rtl',
      createdAt: now,
      updatedAt: now,
      steps: [step],
    },
  }),
})
const created = await j(createRes).catch(() => null)
check('إنشاء دليل بخطوة ذات مرساة', (createRes.status === 200 || createRes.status === 201) && !!created?.id, `id=${created?.id ?? '?'}`)
const guideId = created?.id ?? ''
const realId = !guideId || guideId === 'live-train-proof' ? guideId : guideId // POST يولّد معرّفه (فخ 27)

// 3) مشاركة — POST بلا جسم: بلا ترويسة JSON إطلاقًا (فخ 32: ترويسة JSON بلا جسم = 500 من محلل الجسم)
const shareRes = await fetch(`${API}/api/guides/${encodeURIComponent(realId)}/share`, {
  method: 'POST',
  headers: { cookie },
})
const share = await j(shareRes).catch(() => null)
check('إنشاء رابط مشاركة', shareRes.status === 200 && !!share?.token, `token=${share?.token ?? '?'}`)
const token = share?.token ?? ''

// 4) القراءة العامة تعيد المرساة كما هي — هذا ما يصل لزر «دربني»
const pubRes = await fetch(`${API}/api/share/${encodeURIComponent(token)}`)
const pub = await j(pubRes).catch(() => null)
const roundTrip = pub?.guide?.steps?.[0]?.target?.anchor
check(
  'القراءة العامة تعيد بطاقة التعريف كاملة',
  pubRes.status === 200 && JSON.stringify(roundTrip) === JSON.stringify(anchor),
  `${roundTrip?.length ?? 0} مرشحين`,
)
const trainable = (pub?.guide?.steps ?? []).some((s) => (s.target?.anchor?.length ?? 0) > 0)
check('الدليل يُعتبر قابلًا للتدريب (يظهر «دربني»)', trainable === true)

// 5) دليل قديم بلا مرساة → ليس قابلًا للتدريب (لا زر وهمي)
const legacyNow = new Date().toISOString()
const legacyRes = await fetch(`${API}/api/guides`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({
    guide: {
      id: 'live-train-legacy',
      schemaVersion: 1,
      title: `إثبات حي: دليل قديم ${Date.now()}`,
      locale: 'ar',
      dir: 'rtl',
      createdAt: legacyNow,
      updatedAt: legacyNow,
      steps: [{ ...step, id: 's-legacy', target: { text: 'اعتماد', role: 'button' } }],
    },
  }),
})
const legacy = await j(legacyRes).catch(() => null)
const legacyShare = await fetch(`${API}/api/guides/${encodeURIComponent(legacy?.id)}/share`, {
  method: 'POST',
  headers: { cookie }, // بلا ترويسة JSON — جسم فارغ (فخ 32)
}).then(j)
const legacyPub = await fetch(`${API}/api/share/${encodeURIComponent(legacyShare?.token ?? 'x')}`).then(j)
const legacyTrainable = (legacyPub?.guide?.steps ?? []).some((s) => (s.target?.anchor?.length ?? 0) > 0)
check('دليل بلا مرساة (أدلة ما قبل AUTO-01) ليس قابلًا للتدريب', legacyTrainable === false)

// 6) نظافة: حذف دليلَي الإثبات
for (const id of [realId, legacy?.id]) {
  if (!id) continue
  const del = await fetch(`${API}/api/guides/${encodeURIComponent(id)}?hard=true`, {
    method: 'DELETE',
    headers: { cookie }, // DELETE بلا ترويسة JSON (فخ 32)
  })
  check(`حذف دليل الإثبات ${id}`, del.status === 200 || del.status === 204)
}

console.log(failures === 0 ? '\nالإثبات الحي: كل البنود نجحت ✔' : `\nفشل ${failures} بندًا ✘`)
process.exit(failures === 0 ? 0 : 1)
