/**
 * إثبات حي — LIB-02 إعادة تسمية المجلد عبر الخادم الحقيقي (8787).
 * يفعل: دخول حساب إثبات → إنشاء مجلد → إعادة تسميته (PATCH) → قراءة الاسم الجديد → حذف تنظيف.
 * عربي دائمًا عبر node fetch (curl يشوّه العربية في Git Bash — فخ 4). تنظيف ذاتي كامل.
 */
const BASE = process.env.DALILI_BASE ?? 'http://127.0.0.1:8787'
const EMAIL = 'thumb-view@dalili.sa'
const PASSWORD = 'password123'
const NAME1 = 'إثبات إعادة التسمية — قبل'
const NAME2 = 'إثبات إعادة التسمية — بعد (يمكن حذفه)'

let cookie = ''
let pass = 0
let fail = 0

function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.log(`✗ ${label} ${extra}`) }
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const setC = res.headers.get('set-cookie')
  if (setC) cookie = setC.split(';')[0]
  let json = null
  try { json = await res.json() } catch { /* بلا جسم */ }
  return { status: res.status, json }
}

const main = async () => {
  const health = await fetch(BASE + '/health')
  check('الخادم الحي مستجيب', health.ok)

  const login = await req('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
  check('دخول حساب الإثبات', login.status === 200, `status=${login.status}`)

  const created = await req('POST', '/api/folders', { name: NAME1 })
  check('إنشاء مجلد باسم عربي', created.status === 201 || created.status === 200, `status=${created.status}`)
  const id = created.json?.id
  check('المجلد له معرف', typeof id === 'string' && id.length > 0)

  const before = await req('GET', '/api/folders')
  const found1 = (before.json ?? []).find((f) => f.id === id)
  check('القراءة قبل: الاسم الأول ظاهر', found1?.name === NAME1, `name=${found1?.name}`)

  const renamed = await req('PATCH', `/api/folders/${id}`, { name: NAME2 })
  check('PATCH إعادة التسمية ناجح', renamed.status === 200, `status=${renamed.status}`)
  check('الاستجابة تحمل الاسم الجديد', renamed.json?.name === NAME2, `name=${renamed.json?.name}`)

  const after = await req('GET', '/api/folders')
  const found2 = (after.json ?? []).find((f) => f.id === id)
  check('القراءة بعد: الاسم الجديد مستقر في القائمة', found2?.name === NAME2, `name=${found2?.name}`)

  const removed = await req('DELETE', `/api/folders/${id}`)
  check('تنظيف: حذف مجلد الإثبات', removed.status === 200 || removed.status === 204, `status=${removed.status}`)

  const gone = await req('GET', '/api/folders')
  check('تنظيف: المجلد لم يعد موجودًا', !(gone.json ?? []).some((f) => f.id === id))

  console.log(`\nالنتيجة: ${pass} نجاح / ${fail} فشل`)
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('انهيار الإثبات:', e?.message ?? e)
  process.exitCode = 1
})
