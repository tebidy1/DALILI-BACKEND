/** إثبات حي لـBKL-01 (الكرّاسة) ضد الخادم الحي 8787:
 *  حساب مؤقت → دليل خاص → كرّاسة تضمّه ونصًّا منسّقًا → مشاركة →
 *  ضيف يقرأ الدليل الخاص عبر التوكن وحده → سحب الرابط يقطع فورًا →
 *  حذف المضمّن لا يُسقط الكرّاسة → البحث يجد نص الكتلة → الاكتشاف لا يعيد الكرّاسة.
 *  عربية دائمًا عبر fetch (curl يشوّه العربية في Git Bash) — لا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const EMAIL = `bk-proof-${STAMP}@dalili.sa`
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

// 1) حساب مؤقت — لا نلمس بيانات المالك
const reg = await api('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
check('تسجيل حساب إثبات مؤقت', reg.status === 200)
const cookie = (
  await fetch(API + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
).headers.get('set-cookie').split(';')[0]
const authed = { cookie }

const now = new Date().toISOString()
const baseGuide = (title, over = {}) => ({
  id: crypto.randomUUID(),
  schemaVersion: 1,
  title,
  locale: 'ar',
  dir: 'rtl',
  createdAt: now,
  updatedAt: now,
  steps: [],
  ...over,
})
const blockStep = (over) => ({
  id: crypto.randomUUID(),
  kind: 'navigate',
  title: '',
  target: {},
  sensitive: false,
  url: '',
  pageTitle: '',
  ts: Date.now(),
  ...over,
})

async function create(guide) {
  const r = await api('/api/guides', { method: 'POST', headers: authed, body: JSON.stringify({ guide }) })
  if (r.status !== 200) throw new Error(`create failed ${r.status}: ${JSON.stringify(r.body)}`)
  return r.body.id
}

// 2) دليل خاص على موقع حقيقي (كي يشارك الاكتشاف)، وكرّاسة تضمّه
const privId = await create(
  baseGuide('دليل الفوترة الخاص', {
    steps: [blockStep({ url: 'https://erp-proof.example.com/invoices', pageTitle: 'الفواتير', title: 'افتح الفواتير' })],
  }),
)
const NEEDLE = `مطابقة${STAMP}`
const bkId = await create(
  baseGuide('كرّاسة الإغلاق الشهري', {
    kind: 'booklet',
    steps: [
      blockStep({ block: 'header', title: 'التمهيد' }),
      blockStep({ block: 'text', rich: [{ para: 'p', runs: [{ text: `${NEEDLE} الحسابات البنكية`, b: true }] }] }),
      blockStep({ block: 'embed', title: 'دليل الفوترة الخاص', embed: { guideId: privId, expanded: false } }),
    ],
  }),
)

// ① النوع يُخزَّن عمودًا مشتقًا ويعود في القائمة بلا فكّ JSON
const list = await api('/api/guides?limit=50', { headers: authed })
const kinds = Object.fromEntries((list.body?.items ?? []).map((i) => [i.id, i.kind]))
check('① القائمة تعيد kind من العمود: الكرّاسة booklet والدليل guide', kinds[bkId] === 'booklet' && kinds[privId] === 'guide', `${kinds[bkId]} / ${kinds[privId]}`)

// ② لا كرّاسة داخل كرّاسة (E-BKL-02)
const bk2 = await create(baseGuide('كرّاسة ثانية', { kind: 'booklet' }))
const read2 = await api(`/api/guides/${bk2}`, { headers: authed })
const nest = await api(`/api/guides/${bk2}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({
    guide: { ...read2.body.guide, steps: [blockStep({ block: 'embed', embed: { guideId: bkId, expanded: false } })] },
  }),
})
check('② كرّاسة داخل كرّاسة تُرفض 400 برسالة محددة', nest.status === 400 && nest.body?.errorAr === 'لا تُضمّ كرّاسة داخل كرّاسة', nest.body?.errorAr ?? String(nest.status))

// ③ البحث الحرفي يجد نص الكتلة المنسّقة
const found = await api(`/api/search?q=${encodeURIComponent(NEEDLE)}`, { headers: authed })
check('③ البحث يجد نص الكتلة المنسّقة داخل الكرّاسة', (found.body?.hits?.length ?? 0) > 0, `${found.body?.hits?.length ?? 0} نتيجة`)

// ④ الاكتشاف لا يعيد الكرّاسة (بلا رابط فلا تُخمَّن)
const disc = await api(`/api/discover?site=${encodeURIComponent('erp-proof.example.com')}`, { headers: authed })
const discIds = [...(disc.body?.onScreen ?? []), ...(disc.body?.onSite ?? [])].map((x) => x.id)
check('④ الاكتشاف يعيد الدليل ولا يعيد الكرّاسة', discIds.includes(privId) && !discIds.includes(bkId), `${discIds.length} نتيجة`)

// ⑤ مشاركة الكرّاسة: التوكن يمنح قراءة الدليل الخاص المضمّن
const share = await api(`/api/guides/${bkId}/share`, { method: 'POST', headers: authed })
const token = share.body?.token
const pub = await api(`/api/share/${token}`)
check('⑤ ضيف يقرأ الدليل الخاص المضمّن عبر توكن الكرّاسة', pub.status === 200 && pub.body?.embeds?.[privId]?.title === 'دليل الفوترة الخاص', pub.body?.embeds?.[privId]?.title ?? 'غائب')

// ⑥ ولا يتسرّب خارج التوكن — الدليل نفسه خلف الدخول
const direct = await api(`/api/guides/${privId}`)
check('⑥ الدليل الخاص يبقى 401 خارج التوكن — لا تسريب', direct.status === 401, String(direct.status))

// ⑦ دليل عادي لا يحمل embeds إطلاقًا
const plainShare = await api(`/api/guides/${privId}/share`, { method: 'POST', headers: authed })
const plainPub = await api(`/api/share/${plainShare.body?.token}`)
check('⑦ الدليل العادي بلا embeds', plainPub.status === 200 && plainPub.body?.embeds === undefined)

// ⑧ حذف الدليل المضمّن لا يُسقط الكرّاسة — يغيب من embeds بلا انهيار
await api(`/api/guides/${privId}`, { method: 'DELETE', headers: authed })
const afterDel = await api(`/api/share/${token}`)
check('⑧ حذف المضمّن: الكرّاسة تُقرأ ومفتاحه يغيب بلا انهيار', afterDel.status === 200 && afterDel.body?.guide?.steps?.length === 3 && afterDel.body?.embeds?.[privId] === undefined)

// ⑨ سحب رابط الكرّاسة يقطع الوصول فورًا — حارس الأمان الأهم
await api(`/api/guides/${bkId}/share`, { method: 'DELETE', headers: authed })
const revoked = await api(`/api/share/${token}`)
check('⑨ سحب الرابط يقطع الوصول فورًا (404)', revoked.status === 404, String(revoked.status))

console.log(`\n${failures === 0 ? '✔' : '✘'} النتيجة: ${9 - failures}/9`)
if (failures > 0) process.exitCode = 1
