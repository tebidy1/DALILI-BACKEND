/** إثبات حي لعلّة «٠ خطوة» في بطاقة الدليل المضمّن (بلاغ المالك 2026-09-07):
 *  الجذر: المحرر كان يطلب القائمة بسقف ٢٠٠ والعقد يسقفها بمئة ⇒ ٤٠٠ ⇒ لا بيانات ⇒ صفر.
 *  الإصلاح: نسأل عن كل دليل مضمّن باسمه، و٤٠٤ وحدها تعني «محذوف».
 *  لا process.exit (فخ UV)، وfetch لا curl (العربية تتشوّه في Git Bash). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const EMAIL = `emb-fix-${STAMP}@dalili.sa`
const PASSWORD = 'proof-pass-12345'

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: opts.body
      ? { 'content-type': 'application/json', ...(opts.headers ?? {}) }
      : (opts.headers ?? {}),
  })
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) }
}

await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
const cookie = (
  await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
).headers.get('set-cookie').split(';')[0]
const authed = { cookie }

const now = new Date().toISOString()
const step = (title) => ({
  id: crypto.randomUUID(),
  kind: 'navigate',
  title,
  target: {},
  sensitive: false,
  url: 'https://erp-fix.example.com/x',
  pageTitle: 'شاشة',
  ts: Date.now(),
})
const created = await api('/api/guides', {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({
    guide: {
      id: crypto.randomUUID(),
      schemaVersion: 1,
      title: 'دليل ثلاث خطوات',
      locale: 'ar',
      dir: 'rtl',
      createdAt: now,
      updatedAt: now,
      steps: [step('افتح'), step('اختر'), step('احفظ')],
    },
  }),
})
const id = created.body?.id

// ① الجذر نفسه: سقف ٢٠٠ يُرفض — وهذا ما كان يُفرِغ البطاقة فتقول «٠ خطوة»
const over = await api('/api/guides?limit=200', { headers: authed })
check('① السبب الجذري: طلب القائمة بسقف ٢٠٠ يُرفض ٤٠٠', over.status === 400, `${over.status} · ${over.body?.errorAr ?? ''}`)

// ② والمئة تمرّ — دليل أن السقف هو الفارق لا شيء آخر
const ok100 = await api('/api/guides?limit=100', { headers: authed })
check('② سقف ١٠٠ يمرّ ٢٠٠', ok100.status === 200, String(ok100.status))

// ③ مسار الإصلاح: السؤال عن الدليل باسمه يعيد خطواته الحقيقية
const one = await api(`/api/guides/${id}`, { headers: authed })
check('③ سؤال الدليل باسمه يعيد ٣ خطوات لا صفرًا', one.body?.guide?.steps?.length === 3, `${one.body?.guide?.steps?.length ?? '؟'} خطوة`)
check('③ب والعنوان يأتي من الخادم لا من نسخة قديمة', one.body?.guide?.title === 'دليل ثلاث خطوات', one.body?.guide?.title ?? 'غائب')

// ④ السلة ليست حذفًا: الخادم يقولها صراحةً بـdeletedAt فلا يخمّن العميل
await api(`/api/guides/${id}`, { method: 'DELETE', headers: authed })
const trashed = await api(`/api/guides/${id}`, { headers: authed })
check(
  '④ الدليل في السلة يعيد ٢٠٠ ومعه deletedAt — حالة ثالثة معلنة لا مخمَّنة',
  trashed.status === 200 && typeof trashed.body?.deletedAt === 'string',
  `${trashed.status} · ${trashed.body?.deletedAt ?? 'بلا'}`,
)

// ⑤ والغياب الحقيقي ٤٠٤ — وهو وحده ما يسمح بادّعاء «لم يعد موجودًا»
const nowhere = await api('/api/guides/lا-يوجد-هذا', { headers: authed })
check('⑤ معرّف غير موجود يعيد ٤٠٤ — إشارة الغياب الوحيدة المقبولة', nowhere.status === 404, String(nowhere.status))

console.log(`\n${failures === 0 ? '✔' : '✘'} النتيجة: ${6 - failures}/6`)
if (failures > 0) process.exitCode = 1
