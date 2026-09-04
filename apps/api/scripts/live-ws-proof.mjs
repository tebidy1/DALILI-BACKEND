/** إثبات حي لأساس المساحة (WS-01..05) ضد الخادم الحي 8787 — قرار المالك 2026-09-03:
 *  مدير إثبات → دليل منشور وآخر خاص → دعوة برابط → قبول بكلمة مرور → عضو يرى المنشور لا الخاص
 *  → بوكمارك وفلتر saved → فلتر site → البحث يجد المنشور → مشاهد مقيَّد → تنظيف ذاتي.
 *  عربية دائمًا عبر fetch (curl يشوّه العربية في Git Bash) — لا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const ADMIN_EMAIL = `ws-proof-admin-${STAMP}@dalili.sa`
const MEMBER_EMAIL = `ws-proof-member-${STAMP}@dalili.sa`
const VIEWER_EMAIL = `ws-proof-viewer-${STAMP}@dalili.sa`
const PASSWORD = 'proof-pass-12345'

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

async function api(path, opts = {}) {
  // ترويسة JSON مع جسم فقط — بجسم فارغ ترمي المحللة 500 (فخ 33)
  const res = await fetch(API + path, {
    ...opts,
    headers: opts.body
      ? { 'content-type': 'application/json', ...(opts.headers ?? {}) }
      : (opts.headers ?? {}),
  })
  return {
    status: res.status,
    body: res.status === 204 ? null : await res.json().catch(() => null),
    setCookie: res.headers.get('set-cookie'),
  }
}

const now = new Date().toISOString()
function mkGuide(id, title, url) {
  return {
    id,
    schemaVersion: 1, // فخ 31: العقد الحي يتوقع حرفي 1
    title,
    locale: 'ar',
    dir: 'rtl',
    createdAt: now,
    updatedAt: now,
    steps: [
      { id: 's1', kind: 'navigate', title: 'فتح الشاشة', target: {}, sensitive: false, url, pageTitle: 'شاشة الإثبات', ts: 1 },
      { id: 's2', kind: 'click', title: 'اضغط الزر', target: {}, sensitive: false, url, pageTitle: 'شاشة الإثبات', ts: 2 },
    ],
  }
}

// ——— 1) مدير المساحة ———
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }) })
check('1. تسجيل مدير مساحة الإثبات', reg.status === 200)
const adminCookie = reg.setCookie.split(';')[0]
const admin = { cookie: adminCookie }

// ——— 2) دليلان: منشور (فاتورة) وخاص (رواتب) — فخ 27: اجلب المعرّف الفعلي من الخادم ———
const c1 = await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(`wspub${STAMP}`, 'إثبات مساحة — إخراج فاتورة', 'https://proof-erp.example/invoices') }) })
const c2 = await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(`wspriv${STAMP}`, 'إثبات مساحة — مراجعة رواتب سرية', 'https://proof-erp.example/salaries') }) })
check('2. إنشاء الدليلين', c1.status === 200 && c2.status === 200)
const pubId = c1.body.id
const privId = c2.body.id

// الافتراضي خاص + الموقع مشتق
const myList = (await api('/api/guides', { headers: admin })).body
const pubRow = myList.items.find((s) => s.id === pubId)
const privRow = myList.items.find((s) => s.id === privId)
check('3. الافتراضي خاص لقرار المالك', pubRow?.visibility === 'private' && privRow?.visibility === 'private')
check('4. الموقع مشتق من أول خطوة بلا www', pubRow?.site === 'proof-erp.example', `site=${pubRow?.site}`)

// النشر الصريح للفاتورة فقط
const pub1 = await api(`/api/guides/${pubId}/meta`, { method: 'PATCH', headers: admin, body: JSON.stringify({ visibility: 'workspace' }) })
check('5. النشر الصريح للمساحة', pub1.status === 200 && pub1.body.visibility === 'workspace')

// ——— 3) دعوة منشئ برابط يُرسل واتساب ———
const inv = await api('/api/team/invites', { method: 'POST', headers: admin, body: JSON.stringify({ email: MEMBER_EMAIL, role: 'creator' }) })
check('6. المدير يولّد دعوة منشئ', inv.status === 200 && inv.body.token && inv.body.inviteUrl.includes('/invite/'))
const info = await api(`/api/invites/${inv.body.token}`)
check('7. قراءة الدعوة علنًا (بلا جلسة)', info.status === 200 && info.body.accepted === false && info.body.role === 'creator')

const weak = await api(`/api/invites/${inv.body.token}/accept`, { method: 'POST', body: JSON.stringify({ password: '123' }) })
check('8. كلمة مرور ضعيفة تُرفض عربيًا', weak.status === 400 && (weak.body.errorAr ?? '').includes('8'))

const acc = await api(`/api/invites/${inv.body.token}/accept`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
check('9. القبول يمنح جلسة فورية', acc.status === 200 && acc.setCookie)
const member = { cookie: acc.setCookie.split(';')[0] }

// العضو يدخل لاحقًا بكلمته — ثغرة passwordHash='pending' مغلقة
const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: MEMBER_EMAIL, password: PASSWORD }) })
check('10. العضو يدخل لاحقًا بكلمة مروره', login.status === 200)

// ——— 4) رؤية العضو: المنشور لا الخاص ———
const mList = (await api('/api/guides', { headers: member })).body
check('11. العضو يرى المنشور في قائمته', mList.items.some((s) => s.id === pubId))
check('12. العضو لا يرى الخاص إطلاقًا', !mList.items.some((s) => s.id === privId))
const seePub = await api(`/api/guides/${pubId}`, { headers: member })
const seePriv = await api(`/api/guides/${privId}`, { headers: member })
check('13. تفصيل المنشور 200 والخاص 404', seePub.status === 200 && seePriv.status === 404)

// البحث يجد المنشور لا الخاص
const search = (await api('/api/search?q=' + encodeURIComponent('فاتورة'), { headers: member })).body
check('14. البحث يجد منشور المساحة', (search.hits ?? []).some((h) => h.guideId === pubId))
const searchPriv = (await api('/api/search?q=' + encodeURIComponent('رواتب'), { headers: member })).body
check('15. البحث لا يكشف الخاص', (searchPriv.hits ?? []).length === 0)

// ——— 5) البوكمارك لكل عضو بمعزل ———
const bm = await api(`/api/guides/${pubId}/bookmark`, { method: 'POST', headers: member })
check('16. العضو يعلم المنشور بوكمارك', bm.status === 200 && bm.body.bookmarked === true)
const saved = (await api('/api/guides?saved=true', { headers: member })).body
check('17. فلتر المحفوظات يعرفه', saved.items.some((s) => s.id === pubId) && saved.total >= 1)
const adminSaved = (await api('/api/guides?saved=true', { headers: admin })).body
check('18. البوكمارك شخصي لا يلتي بالمالك', (adminSaved.items ?? []).every((s) => s.id !== pubId))

// ——— 6) فلتر الموقع ———
const bySite = (await api('/api/guides?site=proof-erp.example', { headers: member })).body
check('19. ترشيح الموقع يجد المنشور', bySite.items.some((s) => s.id === pubId))
const byOther = (await api('/api/guides?site=nomatch.example', { headers: member })).body
check('20. ترشيح موقع لا يطابق شيئًا', byOther.items.length === 0)

// ——— 7) المشاهد مقيَّد ———
const vinv = await api('/api/team/invites', { method: 'POST', headers: admin, body: JSON.stringify({ email: VIEWER_EMAIL, role: 'viewer' }) })
const vacc = await api(`/api/invites/${vinv.body.token}/accept`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
const viewer = { cookie: vacc.setCookie.split(';')[0] }
const vCreate = await api('/api/guides', { method: 'POST', headers: viewer, body: JSON.stringify({ guide: mkGuide(`wsvw${STAMP}`, 'محاولة مشاهد', 'https://x.example/a') }) })
check('21. المشاهد لا يُنشئ أدلة (403 صادق)', vCreate.status === 403 && (vCreate.body.errorAr ?? '').includes('مشاهد'))
const vRead = await api(`/api/guides/${pubId}`, { headers: viewer })
check('22. المشاهد يقرأ المنشور', vRead.status === 200)

// ——— 8) غير المساحة معزول ———
const outsider = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: `ws-proof-outsider-${STAMP}@dalili.sa`, password: PASSWORD }) })
const outsiderAuth = { cookie: outsider.setCookie.split(';')[0] }
const oSee = await api(`/api/guides/${pubId}`, { headers: outsiderAuth })
check('23. أجنبي عن المساحة: 404', oSee.status === 404)

// ——— تنظيف ذاتي: أدلة الإثبات + إزالة العضوَين من المساحة ———
await api(`/api/guides/${pubId}?permanent=1`, { method: 'DELETE', headers: admin })
await api(`/api/guides/${privId}?permanent=1`, { method: 'DELETE', headers: admin })
const team = (await api('/api/team', { headers: admin })).body
const memberId = team.find((m) => m.email === MEMBER_EMAIL)?.id
const viewerId = team.find((m) => m.email === VIEWER_EMAIL)?.id
if (memberId) await api(`/api/team/${memberId}`, { method: 'DELETE', headers: admin })
if (viewerId) await api(`/api/team/${viewerId}`, { method: 'DELETE', headers: admin })
const teamAfter = (await api('/api/team', { headers: admin })).body
check('24. التنظيف: لا أدلة إثبات ولا أعضاء باقون', teamAfter.length === 1)

console.log(failures === 0 ? `\nالنتيجة: ${'كل الإثباتات الحية نجحت'} (24/24)` : `\nالنتيجة: ${failures} إخفاقًا`)
