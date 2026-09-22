/**
 * إثبات حيّ لشكل إطار الهدف (طلب المالك 2026-09-04) ضد الخادم الحقيقي على 8787.
 * يثبت أن `screenshot.mark.shape` يعبر السلسلة كاملة: العقد → القاعدة → الرابط
 * العام — وأن الأدلة بلا شكل تبقى صالحة كما هي (لا ترحيل ولا رفع نسخة عقد).
 * يترك دليل إثبات مشتركًا ويطبع رابطه للفحص البصري في العارض، ثم ينظّف ما عداه.
 *
 * التشغيل: node apps/api/scripts/live-mark-shape-proof.mjs
 */
import { createCanvasPng } from './make-proof-png.mjs'

const BASE = 'http://127.0.0.1:8787'
let cookie = ''
const results = []
function check(name, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`)
  return cond
}

async function api(method, path, body, isForm = false) {
  const headers = cookie ? { cookie } : {}
  let payload
  if (isForm) payload = body
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const ct = res.headers.get('content-type') ?? ''
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() }
}

const health = await api('GET', '/health')
check('الخادم الحقيقي حيّ على 8787', health.status === 200 && health.data.ok === true)

const email = `mark-shape-${Date.now()}@dalili.sa`
const reg = await api('POST', '/api/auth/register', { email, password: 'live-proof-1234' })
check('حساب إثبات مؤقت', reg.status === 200)

// لقطة حقيقية: خلفية فاتحة وزرّان داكنان يقع عليهما الإطاران
const png = createCanvasPng()
const fd = new FormData()
fd.append('file', new Blob([png], { type: 'image/png' }), 'shape-proof.png')
const up = await api('POST', '/api/uploads', fd, true)
check('رفع لقطة الإثبات', up.status === 200 && typeof up.data.fileId === 'string')
const fileId = up.data.fileId

const now = new Date().toISOString()
const step = (id, title, mark) => ({
  id,
  kind: 'click',
  title,
  target: { text: title },
  sensitive: false,
  url: 'https://erp.example/orders',
  pageTitle: 'الطلبات',
  ts: Number(id.slice(1)),
  screenshot: { fileId, blurRects: [], mark },
})

const created = await api('POST', '/api/guides', {
  guide: {
    id: 'client-side',
    schemaVersion: 1,
    title: 'شكل إطار الهدف — دليل إثبات (يمكن حذفه)',
    locale: 'ar',
    dir: 'rtl',
    createdAt: now,
    updatedAt: now,
    steps: [
      step('s1', 'إطار مستطيل (الشكل الافتراضي)', { rect: { x: 60, y: 90, w: 200, h: 70 }, color: '#ea580c' }),
      step('s2', 'إطار دائري/بيضاوي — الشكل الجديد', {
        rect: { x: 380, y: 90, w: 200, h: 70 },
        color: '#e11d48',
        shape: 'ellipse',
      }),
      step('s3', 'لقطة قديمة بلا شكل — تبقى مستطيلًا بلا ترحيل', {
        rect: { x: 60, y: 250, w: 200, h: 70 },
        color: '#2563eb',
      }),
    ],
  },
})
check('إنشاء دليل بأشكال مختلطة', created.status === 200 && typeof created.data.id === 'string')
const gid = created.data.id

const got = await api('GET', `/api/guides/${gid}`)
const steps = got.data?.guide?.steps ?? got.data?.steps ?? []
check('القاعدة حفظت الشكل البيضاوي كما هو', steps[1]?.screenshot?.mark?.shape === 'ellipse', JSON.stringify(steps[1]?.screenshot?.mark))
check('الشكل الافتراضي يبقى غائبًا لا مكتوبًا (لا ترحيل صامت)', steps[0]?.screenshot?.mark?.shape === undefined)
check('اللقطة بلا شكل عبرت العقد سليمة', steps[2]?.screenshot?.mark?.color === '#2563eb')

// رفض شكل مجهول — العقد بوابة لا زينة
const badId = await api('POST', '/api/guides', {
  guide: {
    id: 'client-side',
    schemaVersion: 1,
    title: 'شكل مجهول',
    locale: 'ar',
    dir: 'rtl',
    createdAt: now,
    updatedAt: now,
    steps: [step('s1', 'شكل مجهول', { rect: { x: 1, y: 1, w: 2, h: 2 }, color: '#ea580c', shape: 'triangle' })],
  },
})
check('العقد الحيّ يرفض شكلًا مجهولًا (400)', badId.status === 400, `status=${badId.status}`)

const share = await api('POST', `/api/guides/${gid}/share`)
check('رابط عام للفحص البصري', share.status === 200 && typeof share.data.token === 'string')
const token = share.data.token

const pub = await fetch(`${BASE}/api/share/${token}`)
const pubData = await pub.json()
check(
  'الرابط العام يسلّم الشكل للعارض',
  pub.status === 200 && pubData.guide.steps[1].screenshot.mark.shape === 'ellipse',
)

console.log(results.join('\n'))
console.log(`\nالعارض: http://127.0.0.1:5174/s/${token}`)
console.log(`معرّف الدليل: ${gid}`)
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n${results.length - failed}/${results.length} نجحت`)
