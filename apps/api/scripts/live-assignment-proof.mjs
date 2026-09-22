/** إثبات حي لعائلة الإسناد (ASG) ضد الخادم الحي 8787:
 *  مدير يُنشئ دليلًا خاصًّا → يدعو منشئًا ومشاهدًا برابط يُقبل → **قبل الإسناد**
 *  العضو لا يقرأ الخاص (404) → إسناد «لكل الشركة» → العضوان يريانه في /api/assigned →
 *  العضو يقرأ الخاص الآن عبر الإسناد (200) → فتح ثم «تمّ» ثم تراجع → لوحة المُسنِد
 *  «فُتح ١ من ٣» → عدّاد assignedNewCount يتناقص بعد الفتح → **سحب الإسناد** يقطع
 *  القراءة (404) ويُفرغ /api/assigned. تنظيف ذاتي، ولا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const ADMIN_EMAIL = `asg-proof-admin-${STAMP}@dalili.sa`
const CREATOR_EMAIL = `asg-proof-creator-${STAMP}@dalili.sa`
const VIEWER_EMAIL = `asg-proof-viewer-${STAMP}@dalili.sa`
const PASSWORD = 'proof-pass-12345'

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json', ...(opts.headers ?? {}) } : opts.headers ?? {},
  })
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') }
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

async function invite(adminCookie, email, role) {
  const inv = await api('/api/team/invites', { method: 'POST', headers: adminCookie, body: JSON.stringify({ email, role }) })
  const token = inv.body?.token
  const accept = await api(`/api/invites/${token}/accept`, { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
  return { cookie: { cookie: accept.setCookie.split(';')[0] }, id: accept.body?.id }
}

// ——— ١) المالك يدخل ويُنشئ دليلًا خاصًّا ———
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }) })
check('1. تسجيل مالك المساحة', reg.status === 200)
const admin = { cookie: reg.setCookie.split(';')[0] }
const guideId = `asg-g-${STAMP}`
const cg = await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(guideId, 'إجراء خاص للإسناد', 'https://asg-erp.example/home') }) })
const gid = cg.body?.id ?? guideId
check('1. إنشاء دليل خاص', cg.status === 200)

// ——— ٢) دعوة منشئ ومشاهد برابط يُقبل ———
const creator = await invite(admin, CREATOR_EMAIL, 'creator')
const viewer = await invite(admin, VIEWER_EMAIL, 'viewer')
check('2. قبول دعوتي المنشئ والمشاهد', !!creator.id && !!viewer.id)

// ——— ٣) قبل الإسناد: المنشئ لا يقرأ الدليل الخاص ———
const before = await api(`/api/guides/${gid}`, { headers: creator.cookie })
check('3. قبل الإسناد المنشئ لا يرى الخاص (404)', before.status === 404)

// ——— ٤) المدير يُسند «لكل الشركة» ———
const assign = await api(`/api/guides/${gid}/assign`, { method: 'POST', headers: admin, body: JSON.stringify({ targets: [{ kind: 'workspace', id: '*' }], note: 'اقرأه قبل نهاية الأسبوع' }) })
check('4. الإسناد لكل الشركة', assign.status === 200 && assign.body?.created === 1)

// ——— ٥) العضوان يريانه في /api/assigned ———
const cAssigned = await api('/api/assigned', { headers: creator.cookie })
const vAssigned = await api('/api/assigned', { headers: viewer.cookie })
check('5. المنشئ والمشاهد يريان الإسناد', (cAssigned.body?.length ?? 0) === 1 && (vAssigned.body?.length ?? 0) === 1)
const aid = cAssigned.body?.[0]?.assignmentId

// ——— ٦) المنشئ يقرأ الخاص الآن عبر الإسناد ———
const afterRead = await api(`/api/guides/${gid}`, { headers: creator.cookie })
check('6. بعد الإسناد المنشئ يقرأ الخاص (200)', afterRead.status === 200)

// ——— ٧) عدّاد الجديد قبل الفتح = ١ ———
const ov1 = await api('/api/library/overview', { headers: creator.cookie })
check('7. assignedNewCount قبل الفتح = ١', ov1.body?.assignedNewCount === 1)

// ——— ٨) فتح ثم «تمّ» ثم تراجع ———
const open = await api(`/api/assignments/${aid}/progress`, { method: 'POST', headers: creator.cookie, body: JSON.stringify({}) })
check('8. فتح يسجّل opened بلا done', open.status === 200 && open.body?.doneAt === null)
const done = await api(`/api/assignments/${aid}/progress`, { method: 'POST', headers: creator.cookie, body: JSON.stringify({ done: true }) })
check('8. «تمّ» يضبط done', !!done.body?.doneAt)
const undo = await api(`/api/assignments/${aid}/progress`, { method: 'POST', headers: creator.cookie, body: JSON.stringify({ done: false }) })
check('8. التراجع يمحو done', undo.body?.doneAt === null)

// ——— ٩) عدّاد الجديد بعد الفتح = ٠ ———
const ov2 = await api('/api/library/overview', { headers: creator.cookie })
check('9. assignedNewCount بعد الفتح = ٠', ov2.body?.assignedNewCount === 0)

// ——— ١٠) لوحة المُسنِد: فُتح ١ من ٣ ———
const board = await api(`/api/guides/${gid}/assignments`, { headers: admin })
check('10. لوحة المُسنِد فُتح ١ من ٣', board.body?.recipientCount === 3 && board.body?.openedCount === 1)

// ——— ١١) سحب الإسناد يقطع القراءة ويُفرغ القائمة ———
const del = await api(`/api/assignments/${aid}`, { method: 'DELETE', headers: admin })
check('11. سحب الإسناد', del.status === 204)
const afterDel = await api(`/api/guides/${gid}`, { headers: creator.cookie })
const emptied = await api('/api/assigned', { headers: creator.cookie })
check('11. السحب يقطع القراءة (404) ويُفرغ /assigned', afterDel.status === 404 && (emptied.body?.length ?? 0) === 0)

console.log(`\n${failures === 0 ? '✅ كل الفحوص خضراء' : `❌ ${failures} فحص فشل`} (${11 - failures}/11 مجموعة)`)
