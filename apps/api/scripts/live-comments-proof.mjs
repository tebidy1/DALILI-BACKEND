/** إثبات حي لـGM-05 تطوّر (تعليقات على مستوى الدليل + نوعان مشكلة/تعليق) ضد الخادم الحي 8787:
 *  حساب مؤقت → دليل → مشاركة → ضيف يبلّغ «مشكلة» ويردّ → المالك يرى ويردّ ويحلّ →
 *  عدّادات المكتبة والتقرير تفصل المشكلات عن التعليقات → سلبيات صادقة. الدليل يبقى حيًّا للتحقق اليدوي.
 *  عربية دائمًا عبر fetch (curl يشوّه العربية في Git Bash) — لا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const EMAIL = `cm-proof-${STAMP}@dalili.sa`
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
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) }
}

// 1) حساب مؤقت — لا نلمس بيانات المالك
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
check('تسجيل حساب إثبات مؤقت', reg.status === 200)
const cookie = (await fetch(API + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})).headers.get('set-cookie').split(';')[0]
const authed = { cookie }

// 2) دليل بخطوتين — schemaVersion حرفي 1 (فخ العقد الحي)
const now = new Date().toISOString()
const mkStep = (id, title) => ({
  id,
  kind: 'click',
  title,
  target: {},
  sensitive: false,
  url: 'https://erp.example.com/invoices',
  pageTitle: 'الفواتير',
  ts: id === 's1' ? 1 : 2,
})
const create = await api('/api/guides', {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({
    guide: {
      id: `cmproof${STAMP}`,
      schemaVersion: 1,
      title: 'تعليقات — دليل إثبات (يمكن حذفه)',
      locale: 'ar',
      dir: 'rtl',
      createdAt: now,
      updatedAt: now,
      steps: [mkStep('s1', 'افتح قسم الفواتير'), mkStep('s2', 'اضغط زر إضافة فاتورة')],
    },
  }),
})
const gid = create.body?.id
check('إنشاء دليل الإثبات', create.status === 200 && !!gid)

// 3) مشاركة → ضيف يعلّق باسم ويردّ على نفسه
const share = await api(`/api/guides/${gid}/share`, { method: 'POST', headers: authed })
const token = share.body?.token
check('مشاركة الدليل', share.status === 200 && !!token)

// GM-05 تطوّر: تعليقات على مستوى الدليل بنوعين — الضيف يبلّغ «مشكلة»
const g1 = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'issue', body: 'الزر عندي رمادي لا برتقالي — هل تغيّرت الواجهة؟', author: 'سعد الزميل' }),
})
check('ضيف يبلّغ مشكلة على مستوى الدليل', g1.status === 200 && g1.body.comment.isOwner === false && g1.body.comment.kind === 'issue', `kind=${g1.body.comment?.kind} stepId="${g1.body.comment?.stepId}"`)
check('التبليغ على مستوى الدليل — stepId فارغ', g1.body.comment?.stepId === '')
const rootId = g1.body.comment?.id

const g2 = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'issue', body: 'نفس الشيء عندي بعد تحديث النظام', parentId: rootId }),
})
check('ضيف آخر يردّ على الخيط', g2.status === 200 && g2.body.comment.parentId === rootId)

const nested = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'issue', body: 'رد على الرد', parentId: g2.body.comment?.id }),
})
check('الرد على رد مرفوض — عمق واحد فقط', nested.status === 400)

const badKind = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'bug', body: 'نوع مجهول' }),
})
check('نوع مجهول مرفوض (400)', badKind.status === 400, `status=${badKind.status}`)

// 4) المالك يرى تبليغ الضيف ويردّ بعلامة صاحب الدليل
const ownerList = await api(`/api/guides/${gid}/comments`, { headers: authed })
check('المالك يرى تبليغي الضيف', ownerList.status === 200 && ownerList.body.comments.length === 2)

const ownerReply = await api(`/api/guides/${gid}/comments`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ kind: 'issue', body: 'نعم غيّرت الواجهة — سأحدّث اللقطة اليوم', parentId: rootId }),
})
check('المالك يردّ بعلامة صاحب الدليل', ownerReply.status === 200 && ownerReply.body.comment.isOwner === true)

// تعليق عام (note) لإثبات فصله عن المشكلة في العدّادات
const noteC = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'note', body: 'شكرًا، الدليل واضح', author: 'منى' }),
})
check('ضيف يضيف تعليقًا عامًا (note)', noteC.status === 200 && noteC.body.comment.kind === 'note')

// 5) عدّادات المكتبة تفصل المشكلات عن التعليقات — قبل الحل
const listBefore = await api('/api/guides?limit=100', { headers: authed })
const mineBefore = listBefore.body?.items?.find((g) => g.id === gid)
check('شارة المكتبة: 4 تعليقات · مفتوحان (مشكلة+تعليق) · مشكلة مفتوحة واحدة',
  mineBefore?.commentCount === 4 && mineBefore?.openCommentCount === 2 && mineBefore?.openIssueCount === 1,
  JSON.stringify({ c: mineBefore?.commentCount, o: mineBefore?.openCommentCount, i: mineBefore?.openIssueCount }))

const repBefore = await api('/api/reports/mine', { headers: authed })
check('تقرير المالك: مشكلة مفتوحة واحدة تنتظر معالجة', repBefore.body?.openIssues === 1, `openIssues=${repBefore.body?.openIssues} openComments=${repBefore.body?.openComments}`)

const resolve = await api(`/api/guides/${gid}/comments/${rootId}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ resolved: true }),
})
check('وسم المشكلة محلولة', resolve.status === 200 && resolve.body.comment.resolved === true)

const listAfter = await api('/api/guides?limit=100', { headers: authed })
const mineAfter = listAfter.body?.items?.find((g) => g.id === gid)
check('بعد الحل: صفر مشكلات مفتوحة، ويبقى التعليق العام مفتوحًا',
  mineAfter?.openIssueCount === 0 && mineAfter?.openCommentCount === 1,
  JSON.stringify({ o: mineAfter?.openCommentCount, i: mineAfter?.openIssueCount }))

const repAfter = await api('/api/reports/mine', { headers: authed })
check('تقرير المالك بعد الحل: صفر مشكلات مفتوحة', repAfter.body?.openIssues === 0, `openIssues=${repAfter.body?.openIssues}`)

// 6) الضيف في العارض العام يرى ردّ المالك بعلامته
const guestView = await api(`/api/share/${token}/comments`)
check('العارض العام يعرض الرد بشارة صاحب الدليل', guestView.body?.comments?.some((c) => c.isOwner && c.body.includes('سأحدّث اللقطة')))

// 7) عزل: شخص آخر لا يرى تعليقات دليلي
const stranger = await api('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email: `cm-proof2-${STAMP}@dalili.sa`, password: PASSWORD }),
})
const strangerCookie = (await fetch(API + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `cm-proof2-${STAMP}@dalili.sa`, password: PASSWORD }),
})).headers.get('set-cookie').split(';')[0]
const strangerGet = await api(`/api/guides/${gid}/comments`, { headers: { cookie: strangerCookie } })
check('غير المالك لا يصل لتعليقات الدليل (404)', strangerGet.status === 404)

console.log(`\n${failures === 0 ? 'الإثبات كامل ✔' : `فشل ${failures} ✘`}`)
console.log(`حساب الإثبات: ${EMAIL}`)
console.log(`دليل الإثبات: /g/${gid} — رابط الضيف: /s/${token}`)
process.exitCode = failures === 0 ? 0 : 1
