/** إثبات حي للمرحلة ب (الهوم — WS-06) ضد الخادم الحي 8787:
 *  overview لثلاثة أدوار (عدادات/مواقع/اسم مساحة/دور) + فلاتر القائمة الجديدة
 *  (visibility / creator / when) + حقل mine + البوكمارك يرفع عدّاد المحفوظات
 *  → تنظيف ذاتي. عربية دائمًا عبر fetch — لا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const ADMIN_EMAIL = `home-proof-admin-${STAMP}@dalili.sa`
const MEMBER_EMAIL = `home-proof-member-${STAMP}@dalili.sa`
const VIEWER_EMAIL = `home-proof-viewer-${STAMP}@dalili.sa`
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

// ——— تأسيس المساحة: مدير + منشور + خاص + عضو منشئ + مشاهد (حلقة الدعوات الحية) ———
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }) })
check('1. تسجيل مدير المساحة', reg.status === 200)
const admin = { cookie: reg.setCookie.split(';')[0] }

const c1 = await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(`hmpub${STAMP}`, 'إثبات هوم — فاتورة', 'https://home-erp.example/invoices') }) })
const c2 = await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(`hmpriv${STAMP}`, 'إثبات هوم — رواتب سرية', 'https://home-erp.example/salaries') }) })
check('2. إنشاء دليلين (فاتورة/رواتب) بمعرّفات الخادم', c1.status === 200 && c2.status === 200)
const pubId = c1.body.id
const privId = c2.body.id
await api(`/api/guides/${pubId}/meta`, { method: 'PATCH', headers: admin, body: JSON.stringify({ visibility: 'workspace' }) })

async function inviteMember(role, email) {
  const inv = await api('/api/team/invites', { method: 'POST', headers: admin, body: JSON.stringify({ email, role }) })
  const acc = await api(`/api/invites/${inv.body.token}/accept`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
  return { cookie: acc.setCookie.split(';')[0] }
}
const member = await inviteMember('creator', MEMBER_EMAIL)
const viewer = await inviteMember('viewer', VIEWER_EMAIL)
check('3. عضو منشئ ومشاهد انضما عبر الدعوات', member.cookie && viewer.cookie)

// ——— 4) overview للمدير ———
const ovAdmin = (await api('/api/library/overview', { headers: admin })).body
check('4. مدير: اسم المساحة ودوره وبريده', ovAdmin?.workspaceName?.includes('home-proof-admin') && ovAdmin.myRole === 'admin' && ovAdmin.myEmail === ADMIN_EMAIL)
check('5. مدير: العدادات (الكل ٣ = اثنان + الترحيبي، منشورة ١)', ovAdmin?.counts.all === 3 && ovAdmin?.counts.mine === 3 && ovAdmin?.counts.published === 1, JSON.stringify(ovAdmin?.counts))
check('6. مدير: خيارات المواقع تشمل home-erp.example', Array.isArray(ovAdmin?.sites) && ovAdmin.sites.some((s) => s.site === 'home-erp.example'))

// ——— 7) overview للعضو المنشئ — يدخل المنشور في «الكل» لا «أدلتي» ———
const ovMember = (await api('/api/library/overview', { headers: member })).body
check('7. عضو: الكل ١ (منشور الغير فحسب — ليس له أدلة بعد) ودوره منشئ', ovMember?.counts.all === 1 && ovMember?.counts.mine === 0 && ovMember?.myRole === 'creator', JSON.stringify(ovMember?.counts))

// ——— 8) بوكمارك يرفع عدّاد المحفوظات ———
await api(`/api/guides/${pubId}/bookmark`, { method: 'POST', headers: member })
const ovMemberSaved = (await api('/api/library/overview', { headers: member })).body
check('8. عضو: المحفوظات ١ بعد البوكمارك', ovMemberSaved?.counts.saved === 1)

// ——— 9) overview للمشاهد ———
const ovViewer = (await api('/api/library/overview', { headers: viewer })).body
check('9. مشاهد: دوره مشاهد وأدلته صفر ويرى المنشور الوحيد', ovViewer?.myRole === 'viewer' && ovViewer?.counts.mine === 0 && ovViewer?.counts.all === 1)

// ——— 10..13) فلاتر القائمة الجديدة ———
const q = async (cookie, qs) => (await api(`/api/guides?${qs}`, { headers: cookie })).body

const othersList = await q(member, 'creator=others')
check('10. creator=others يقتصر على منشور المدير', othersList.items.length === 1 && othersList.items[0].id === pubId)

const mineList = await q(member, 'creator=me')
check('11. creator=me فارغ للعضو الجديد', mineList.total === 0)

const privList = await q(admin, 'visibility=private')
check('12. visibility=private يقتصر على الخاص (والترحيبي)', privList.items.every((s) => s.visibility === 'private') && privList.items.some((s) => s.id === privId))

const weekList = await q(admin, 'when=week')
check('13. when=week يشمل الجديد المكتوب الآن', weekList.items.some((s) => s.id === pubId) && weekList.items.some((s) => s.id === privId))

const memberAll = await q(member, '')
const pubRow = memberAll.items.find((s) => s.id === pubId)
check('14. حقل mine يصدق: أدلتي true ومنشور الغير false', memberAll.items.every((s) => s.mine === false))

const adminAll = await q(admin, '')
check('15. المدير يرى أدلته mine=true', adminAll.items.filter((s) => s.id === pubId || s.id === privId).every((s) => s.mine === true))

// ——— 16) تنظيف ذاتي ———
for (const id of [pubId, privId]) await api(`/api/guides/${id}`, { method: 'DELETE', headers: admin })
const after = await q(admin, '')
check('16. تنظيف ذاتي: الدليلان خارج القائمة', !after.items.some((s) => s.id === pubId || s.id === privId))

console.log(failures === 0 ? `\nالنتيجة: إثبات الهوم الحي كامل ✔` : `\nالنتيجة: ${failures} إخفاقًا ✘`)
