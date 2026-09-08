/** إثبات حي لـSRCH-04 تطوّر (اكتشاف الشاشات الفرعية + الأكثر مشاهدة) ضد الخادم الحي 8787:
 *  حساب مؤقت → أدلة على نفس المضيف بشاشات مختلفة (منها شاشة أودو في الـhash) →
 *  الاكتشاف بموقّع شاشة يفصل onScreen عن onSite ويرتّب بالمشاهدات. عربية عبر fetch. */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const EMAIL = `disc-proof-${STAMP}@dalili.sa`
const PASSWORD = 'proof-pass-12345'
const HOST = `odoo${STAMP}.corp.sa` // مضيف فريد كي لا تختلط بأدلة قائمة

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json', ...(opts.headers ?? {}) } : (opts.headers ?? {}),
  })
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) }
}

const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
check('تسجيل حساب إثبات مؤقت', reg.status === 200)
const cookie = (await fetch(API + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})).headers.get('set-cookie').split(';')[0]
const authed = { cookie }

const now = new Date().toISOString()
async function mkGuide(title, url) {
  const res = await api('/api/guides', {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({
      guide: {
        id: `d${STAMP}${Math.random().toString(36).slice(2, 8)}`,
        schemaVersion: 1,
        title,
        locale: 'ar',
        dir: 'rtl',
        createdAt: now,
        updatedAt: now,
        steps: [{ id: 's1', kind: 'click', title: 'خطوة', target: {}, sensitive: false, url, pageTitle: 'شاشة', ts: 1 }],
      },
    }),
  })
  return res.body?.id
}
async function addViews(gid, n) {
  const share = await api(`/api/guides/${gid}/share`, { method: 'POST', headers: authed })
  const token = share.body?.token
  for (let i = 0; i < n; i++) await api(`/api/share/${token}/view`, { method: 'POST' })
}

// شاشتا أودو (هوية في الـhash) + لوحة قيادة على مسار — على نفس المضيف
const salesLow = await mkGuide('مبيعات — قليل المشاهدة', `https://${HOST}/web#action=311&model=sale.order&id=42`)
const salesHigh = await mkGuide('مبيعات — كثير المشاهدة', `https://${HOST}/web#action=312&model=sale.order&id=99`)
const purchases = await mkGuide('مشتريات', `https://${HOST}/web#action=500&model=purchase.order`)
const dashboard = await mkGuide('لوحة القيادة', `https://${HOST}/dashboard/home`)
check('إنشاء أربعة أدلة على نفس المضيف', !!salesLow && !!salesHigh && !!purchases && !!dashboard)

await addViews(salesHigh, 6)
await addViews(salesLow, 2)

// الاكتشاف على شاشة أمر البيع: رموز الشاشة الحالية
const screen = encodeURIComponent('web model sale order')
const disc = await api(`/api/discover?site=${HOST}&screen=${screen}`, { headers: authed })
check('الاكتشاف مستجيب', disc.status === 200, `status=${disc.status}`)
const onScreen = (disc.body?.onScreen ?? []).map((g) => g.id)
const onSite = (disc.body?.onSite ?? []).map((g) => g.id)

check('عدّاد الموقع = 4 (كل أدلة المضيف)', disc.body?.count === 4, `count=${disc.body?.count}`)
check('دليلا المبيعات في «هذه الشاشة»', onScreen.includes(salesHigh) && onScreen.includes(salesLow))
check('لوحة القيادة ليست في «هذه الشاشة» (لا تطابق)', !onScreen.includes(dashboard) && onSite.includes(dashboard))
check('الأكثر مشاهدة أولًا داخل الشاشة', onScreen[0] === salesHigh, `first=${onScreen[0]} salesHigh=${salesHigh}`)
check('hash أودو فُهرس فطابق (المقتل المصلَح)', onScreen.length >= 2)

// شاشة الجذر (بلا رموز شاشة) → كلها onSite
const rootDisc = await api(`/api/discover?site=${HOST}`, { headers: authed })
check('بلا رموز شاشة: لا onScreen وكلها onSite', (rootDisc.body?.onScreen ?? []).length === 0 && (rootDisc.body?.onSite ?? []).length === 4)

console.log(`\n${failures === 0 ? 'الإثبات كامل ✔' : `فشل ${failures} ✘`}`)
console.log(`حساب الإثبات: ${EMAIL} · المضيف: ${HOST}`)
process.exitCode = failures === 0 ? 0 : 1
