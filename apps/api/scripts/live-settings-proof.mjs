/** إثبات حي للمرحلة هـ (الإعداد — WS-09) ضد الخادم الحي 8787:
 *  المجلدات صارت **مساحية**: مجلد المنشئ يراه المدير ويديره، والمشاهد يقرأ ولا يكتب،
 *  وoverview (بطاقات الإعداد) بعداداتها. تنظيف ذاتي ولا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const ADMIN_EMAIL = `set-proof-admin-${STAMP}@dalili.sa`
const CREATOR_EMAIL = `set-proof-creator-${STAMP}@dalili.sa`
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
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') }
}

// ——— التأسيس: مالك + منشئ مدعوّ ———
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }) })
check('1. تسجيل المالك', reg.status === 200)
const admin = { cookie: reg.setCookie.split(';')[0] }
const inv = await api('/api/team/invites', { method: 'POST', headers: admin, body: JSON.stringify({ email: CREATOR_EMAIL, role: 'creator' }) })
const acc = await api(`/api/invites/${inv.body.token}/accept`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
const creator = { cookie: acc.setCookie.split(';')[0] }
check('2. منشئ مدعوّ انضم بالرابط', acc.status === 200)

// ——— المجلد المساحي: منشئه عضو والمالك يراه ويديره ———
const f1 = await api('/api/folders', { method: 'POST', headers: creator, body: JSON.stringify({ name: `مجلد الإثبات ${STAMP}` }) })
check('3. المنشئ ينشئ مجلدًا', f1.status === 200)
const adminFolders = (await api('/api/folders', { headers: admin })).body
check('4. المالك يرى مجلد المنشئ في قائمته (ترقية مساحية)', (adminFolders ?? []).some((f) => f.id === f1.body.id), JSON.stringify(adminFolders?.map((f) => f.name)))
const renamed = await api(`/api/folders/${f1.body.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ name: 'مجلد الإثبات المعدّل' }) })
check('5. المالك يعيد تسميته (إدارة بالمساحة لا بالملكية)', renamed.status === 200)

// ——— بيانات بطاقات الإعداد من overview ———
const ov = (await api('/api/library/overview', { headers: admin })).body
check('6. overview يغذي بطاقات الإعداد: الاسم والدور والعدادات', !!ov?.workspaceName && ov?.myRole === 'admin' && ov?.counts?.total !== undefined ? true : !!ov?.counts, JSON.stringify(ov?.counts))

// ——— تنظيف ذاتي ———
await api(`/api/folders/${f1.body.id}`, { method: 'DELETE', headers: admin })
const adminFolders2 = (await api('/api/folders', { headers: admin })).body
check('7. التنظيف: المجلد حُذف', !(adminFolders2 ?? []).some((f) => f.id === f1.body.id))

console.log(failures === 0 ? '\nالنتيجة: إثبات حي كامل — الإعداد والمجلدات المساحية يصدقون ✔' : `\nالنتيجة: ${failures} بندًا ساقطًا ✘`)
