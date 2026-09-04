// إثبات حي كامل: الدورة من التسجيل إلى الرابط العام إلى السحب — ضد الخادم الحقيقي على 8787
const BASE = 'http://127.0.0.1:8787'
let cookie = ''
const results = []
function check(name, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`)
}

async function api(method, path, body, isForm = false) {
  const headers = cookie ? { cookie } : {}
  let payload
  if (isForm) {
    payload = body
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const ct = res.headers.get('content-type') ?? ''
  const data = ct.includes('json') ? await res.json() : await res.text()
  return { status: res.status, data, headers: res.headers }
}

const email = `live-${Date.now()}@dalili.sa`

// 1. الصحة
const health = await api('GET', '/health')
check('GET /health', health.status === 200 && health.data.ok === true, JSON.stringify(health.data))

// 2. تسجيل + جلسة
const reg = await api('POST', '/api/auth/register', { email, password: 'live-proof-1234' })
check('تسجيل مستخدم جديد', reg.status === 200 && reg.data.email === email)
check('كوكي جلسة صادر', cookie.startsWith('dalili_sid='))

const me = await api('GET', '/api/auth/me')
check('me يعيد المستخدم', me.status === 200 && me.data.email === email)

// 3. بدون مصادقة مرفوض
cookie = ''
const noAuth = await api('POST', '/api/guides', { guide: {} })
check('إنشاء بلا جلسة → 401 عربي', noAuth.status === 401 && noAuth.data.errorAr === 'يجب تسجيل الدخول أولًا')
cookie = (await api('POST', '/api/auth/login', { email, password: 'live-proof-1234' })).status === 200 ? cookie : ''
const relogin = await api('POST', '/api/auth/login', { email, password: 'live-proof-1234' })
check('دخول من جديد يعيد كوكي', relogin.status === 200 && cookie.startsWith('dalili_sid='))

// 4. رفع صورة (JPEG سليم الرأس)
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, ...new Uint8Array(180).fill(0x77)])
const fd = new FormData()
fd.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'proof.jpg')
const up = await api('POST', '/api/uploads', fd, true)
check('رفع JPEG → fileId', up.status === 200 && typeof up.data.fileId === 'string', JSON.stringify(up.data).slice(0, 80))
const fileId = up.data.fileId

const file = await fetch(`${BASE}/files/${fileId}`)
check('جلب الصورة العامة image/jpeg', file.status === 200 && file.headers.get('content-type') === 'image/jpeg')

// 5. ملف ليس صورة
const fd2 = new FormData()
fd2.append('file', new Blob(['not-an-image'], { type: 'image/jpeg' }), 'evil.jpg')
const bad = await api('POST', '/api/uploads', fd2, true)
check('ملف خبيث → 400 عربي', bad.status === 400 && bad.data.errorAr.includes('ليس صورة'))

// 6. إنشاء دليل (بخطوة حساسة وقفة قيمتها + لقطة)
const now = new Date().toISOString()
const guide = {
  guide: {
    id: 'client-side', schemaVersion: 1, title: 'دليل الفحص الحي — إنشاء فاتورة', locale: 'ar', dir: 'rtl',
    createdAt: now, updatedAt: now,
    steps: [
      { id: 's1', kind: 'navigate', title: 'انتقل إلى صفحة «الفواتير»', target: {}, sensitive: false, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 1 },
      { id: 's2', kind: 'click', title: 'انقر على «إنشاء فاتورة»', target: { text: 'إنشاء فاتورة' }, sensitive: false, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 2, screenshot: { fileId, blurRects: [{ x: 1, y: 2, w: 3, h: 4 }], autoBlurred: true } },
      { id: 's3', kind: 'input', title: 'في حقل «كلمة المرور» أدخل قيمة سرية', target: { label: 'كلمة المرور' }, sensitive: true, url: 'https://erp.example/invoices', pageTitle: 'الفواتير', ts: 3 },
    ],
  },
}
const created = await api('POST', '/api/guides', guide)
check('إنشاء دليل → id خادمي', created.status === 200 && typeof created.data.id === 'string')
const gid = created.data.id

// 7. قائمة وجلب
const list = await api('GET', '/api/guides')
check('المكتبة تعرض الدليل بخطواته', list.status === 200 && list.data.some((g) => g.id === gid && g.stepCount === 3))

// 8. مشاركة → عام → سحب
const share = await api('POST', `/api/guides/${gid}/share`)
check('إنشاء مشاركة → shareUrl', share.status === 200 && share.data.shareUrl.includes('/s/'))
const token = share.data.token

const pub = await fetch(`${BASE}/api/share/${token}`)
const pubData = await pub.json()
check('الرابط العام يعمل بلا جلسة', pub.status === 200 && pubData.guide.steps.length === 3)
check('الرابط العام يخفي القيمة الحساسة', pubData.guide.steps[2].value === undefined && pubData.guide.steps[2].sensitive === true)

const pubFile = await fetch(`${BASE}/files/${pubData.guide.steps[1].screenshot.fileId}`)
check('صورة الخطوة متاحة للرابط العام', pubFile.status === 200)

const revoke = await api('DELETE', `/api/guides/${gid}/share`)
const pubAfter = await fetch(`${BASE}/api/share/${token}`)
check('السحب يقتل الرابط فورًا', revoke.status === 200 && pubAfter.status === 404)

// 9. عزل المستخدمين
const cookieOwner = cookie
const intruderEmail = `intruder-${Date.now()}@dalili.sa`
await api('POST', '/api/auth/register', { email: intruderEmail, password: 'intruder-pass-999' })
const foreign = await api('GET', `/api/guides/${gid}`)
check('دليل غيرك = 404 لا 403', foreign.status === 404)
cookie = cookieOwner

// 10. حذف
const del = await api('DELETE', `/api/guides/${gid}`)
check('حذف الدليل', del.status === 204)

console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n=== ${results.length - fails}/${results.length} PASS ===`)
process.exit(fails ? 1 : 0)
