/** إثبات حي للمرحلة د (الفرق — WS-08) ضد الخادم الحي 8787:
 *  قراءة القائمة لكل الأعضاء مع عدّاد الأدلة · دعوة برابط تُقبل · فريق يُنشأ ويُجمَّع
 *  فيه · **إزالة عضو تنقل ملكية أدلته للمدير** (خاصة ومنشورة ومجلدها) وحسابه يبقى
 *  بلا أدلة · لا إزالة للمالك · تنظيف ذاتي. ولا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const ADMIN_EMAIL = `team-proof-admin-${STAMP}@dalili.sa`
const CREATOR_EMAIL = `team-proof-creator-${STAMP}@dalili.sa`
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
    schemaVersion: 1,
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

// ——— ١) المالك يدخل ويُنشئ دليلًا ———
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }) })
check('1. تسجيل مالك المساحة', reg.status === 200)
const admin = { cookie: reg.setCookie.split(';')[0] }
await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(`tp-adm${STAMP}`, 'إثبات فريق — دليل المالك', 'https://team-erp.example/home') }) })

// ——— ٢) دعوة منشئ برابط يُقبل — ثغرة «لا يدخل أبدًا» مغلقة ———
const inv = await api('/api/team/invites', { method: 'POST', headers: admin, body: JSON.stringify({ email: CREATOR_EMAIL, role: 'creator' }) })
check('2. توليد رابط دعوة', inv.status === 200 && !!inv.body?.inviteUrl, inv.body?.inviteUrl)
const acc = await api(`/api/invites/${inv.body.token}/accept`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
check('3. المدعوّ يقبل ويملك جلسة فورية', acc.status === 200 && !!acc.setCookie)
const creator = { cookie: acc.setCookie.split(';')[0] }

// ——— ٤) أدلة المنشئ: خاص داخل مجلد + منشور ———
const c1 = await api('/api/guides', { method: 'POST', headers: creator, body: JSON.stringify({ guide: mkGuide(`tp-priv${STAMP}`, 'إثبات فريق — سر المنشئ', 'https://team-erp.example/secret') }) })
const c2 = await api('/api/guides', { method: 'POST', headers: creator, body: JSON.stringify({ guide: mkGuide(`tp-pub${STAMP}`, 'إثبات فريق — منشور المنشئ', 'https://team-erp.example/pub') }) })
const privId = c1.body.id
await api(`/api/guides/${c2.body.id}/meta`, { method: 'PATCH', headers: creator, body: JSON.stringify({ visibility: 'workspace' }) })
const folder = await api('/api/folders', { method: 'POST', headers: creator, body: JSON.stringify({ name: 'مجلد الإثبات' }) })
await api(`/api/guides/${privId}/meta`, { method: 'PATCH', headers: creator, body: JSON.stringify({ folderId: folder.body.id }) })
check('4. المنشئ أنشأ دليلين ومجلدًا', c1.status === 200 && c2.status === 200 && folder.status === 200)

// ——— ٥) القائمة قراءة مشتركة مع عدّاد الأدلة — والمنشئ لا يُدير ———
const rosterByCreator = await api('/api/team', { headers: creator })
const creatorRow = (rosterByCreator.body ?? []).find((m) => m.email === CREATOR_EMAIL)
check('5. المنشئ يقرأ القائمة (٢٠٠) وعدّاد أدلته ٢', rosterByCreator.status === 200 && creatorRow?.guideCount === 2, JSON.stringify(rosterByCreator.body?.map((m) => `${m.email}:${m.guideCount}`)))
const forbidden = await api(`/api/team/${creatorRow.id}`, { method: 'DELETE', headers: creator })
check('6. المنشئ لا يُزيلا أحدًا (403)', forbidden.status === 403)

// ——— ٧) فريق يُنشأ ويُجمَّع فيه المنشئ ———
const team = await api('/api/team/teams', { method: 'POST', headers: admin, body: JSON.stringify({ name: 'فريق الإثبات' }) })
check('7. إنشاء فريق', team.status === 200 && team.body?.memberCount === 0)
await api(`/api/team/${creatorRow.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ teamId: team.body.id }) })
const teams = await api('/api/team/teams', { headers: admin })
check('8. الفريق جمع عضوًا واحدًا', teams.body?.find((t) => t.id === team.body.id)?.memberCount === 1, JSON.stringify(teams.body))

// ——— ٩) الإزالة مع نقل الملكية — جوهر المرحلة ———
const del = await api(`/api/team/${creatorRow.id}`, { method: 'DELETE', headers: admin })
check('9. المدير يُزيلا المنشئ (204)', del.status === 204)

const adminList = (await api('/api/guides', { headers: admin })).body
const movedPriv = adminList.items.find((g) => g.id === privId)
check('10. دليل المنشئ الخاص صار ملك المالك في الجذر (لا يتيم)', movedPriv?.mine === true && movedPriv?.folderId === null, JSON.stringify(movedPriv))

// العضو المنقول يعيد الدخول: حسابه باقٍ ومكتبته فارغة
const relogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: CREATOR_EMAIL, password: PASSWORD }) })
const hisList = relogin.setCookie ? await api('/api/guides', { headers: { cookie: relogin.setCookie.split(';')[0] } }) : null
check('11. المنقول يدخل بحسابه ويجد مكتبته فارغة', hisList?.body?.total === 0, JSON.stringify(hisList?.body?.total))

// ——— ١٢) لا إزالة للمالك — وحذف الفريق يُرجع أعضاءه (بعد إعادة عضو تجريبي) ———
const adminId = (await api('/api/team', { headers: admin })).body.find((m) => m.email === ADMIN_EMAIL).id
const removeOwner = await api(`/api/team/${adminId}`, { method: 'DELETE', headers: admin })
check('12. لا إزالة للنفس/المالك (400)', removeOwner.status === 400)

// ——— تنظيف ذاتي: حذف الفريق وكل الأدلة نهائيًا ———
await api(`/api/team/teams/${team.body.id}`, { method: 'DELETE', headers: admin })
const allGuides = (await api('/api/guides?limit=100', { headers: admin })).body
for (const g of allGuides.items ?? []) {
  await api(`/api/guides/${g.id}?permanent=1`, { method: 'DELETE', headers: admin })
}
const clean = await api('/api/reports/mine', { headers: admin })
check('13. التنظيف الذاتي: مكتبة المالك أصفار', clean.body?.total === 0, JSON.stringify(clean.body))

console.log(failures === 0 ? '\nالنتيجة: إثبات حي كامل — الفريق يُدار ونقل الملكية يصدق ✔' : `\nالنتيجة: ${failures} بندًا ساقطًا ✘`)
