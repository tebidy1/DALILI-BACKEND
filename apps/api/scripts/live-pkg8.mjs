/**
 * إثبات حي للحزمة ⑧ ضد الخادم الحي على 8787:
 * OPS-02 (/ready + x-request-id) · SRCH-01 (thumbFileId في نتائج البحث)
 * تشغيل: node scripts/live-pkg8.mjs
 */
const API = 'http://127.0.0.1:8787'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`✘ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

// 1) OPS-02: /ready
const ready = await fetch(`${API}/ready`)
const readyBody = await ready.json()
check('/ready يعيد 200', ready.status === 200)
check('/ready يقول ready:true db files', readyBody.ready === true && readyBody.db === true && readyBody.files === true)
check('معرّف الطلب x-request-id في الترويسة', !!ready.headers.get('x-request-id'), ready.headers.get('x-request-id') ?? '')

// 2) دخول
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'thumb-view@dalili.sa', password: 'password123' }),
})
const setCookie = loginRes.headers.get('set-cookie') ?? ''
const cookie = setCookie.split(';')[0]
check('دخول thumb-view ناجح', loginRes.status === 200, `status=${loginRes.status}`)

// 3) SRCH-01: البحث يحمل المصغّرات
const q = encodeURIComponent('دليل')
const search = await fetch(`${API}/api/search?q=${q}&limit=10`, { headers: { cookie } })
const body = await search.json()
check('البحث يعيد نتائج', search.status === 200 && Array.isArray(body.hits) && body.hits.length > 0, `${body.hits?.length ?? 0} نتيجة / total=${body.total}`)
const withThumb = (body.hits ?? []).filter((h) => h.thumbFileId)
check('نتائج تحمل thumbFileId', withThumb.length > 0, `${withThumb.length}/${body.hits.length}`)
if (withThumb[0]) {
  const thumb = await fetch(`${API}/files/${withThumb[0].thumbFileId}`)
  const bytes = (await thumb.arrayBuffer()).byteLength
  check(
    'المصغّرة تُخدَم ≤30KB بصورة JPEG',
    thumb.status === 200 && thumb.headers.get('content-type') === 'image/jpeg' && bytes <= 30720,
    `${bytes}B / ${thumb.headers.get('content-type')}`,
  )
}

// 4) OPS-05/OPS-06: NODE_ENV موصول من .env (قراءة سلبية — التقرير الحي للسجل)
console.log(`\n${pass} نجح · ${fail} فشل`)
process.exit(fail > 0 ? 1 : 0)
