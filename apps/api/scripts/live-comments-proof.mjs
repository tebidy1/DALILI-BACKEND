/** إثبات حي لـGM-05 (تعليقات الخطوات) ضد الخادم الحي 8787:
 *  حساب مؤقت → دليل بخطوتين → مشاركة → ضيف يعلّق ويردّ → المالك يرى ويردّ ويسمّي
 *  محلولًا → عدّادات المكتبة تتبع → سلبيات صادقة. الدليل يبقى حيًّا للتحقق اليدوي.
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

const g1 = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ stepId: 's1', body: 'الزر عندي رمادي لا برتقالي — هل تغيّرت الواجهة؟', author: 'سعد الزميل' }),
})
check('ضيف يعلّق على الخطوة الأولى', g1.status === 200 && g1.body.comment.isOwner === false, g1.body.comment?.author)
const rootId = g1.body.comment?.id

const g2 = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ stepId: 's1', body: 'نفس الشيء عندي بعد تحديث النظام', parentId: rootId }),
})
check('ضيف آخر يردّ على الخيط', g2.status === 200 && g2.body.comment.parentId === rootId)

const nested = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ stepId: 's1', body: 'رد على الرد', parentId: g2.body.comment?.id }),
})
check('الرد على رد مرفوض — عمق واحد فقط', nested.status === 400)

const badStep = await api(`/api/share/${token}/comments`, {
  method: 'POST',
  body: JSON.stringify({ stepId: 'ghost', body: 'خطوة غير موجودة' }),
})
check('خطوة غير موجودة مرفوضة برسالة عربية', badStep.status === 400 && /الخطوة/.test(badStep.body?.errorAr ?? ''), badStep.body?.errorAr)

// 4) المالك يرى سؤال الضيف ويردّ بعلامة صاحب الدليل
const ownerList = await api(`/api/guides/${gid}/comments`, { headers: authed })
check('المالك يرى تعليقي الضيف', ownerList.status === 200 && ownerList.body.comments.length === 2)

const ownerReply = await api(`/api/guides/${gid}/comments`, {
  method: 'POST',
  headers: authed,
  body: JSON.stringify({ stepId: 's1', body: 'نعم غيّرت الواجهة — سأحدّث اللقطة اليوم', parentId: rootId }),
})
check('المالك يردّ بعلامة صاحب الدليل', ownerReply.status === 200 && ownerReply.body.comment.isOwner === true)

// 5) عدّادات المكتبة تتبع قبل/بعد الحل
const listBefore = await api('/api/guides?limit=100', { headers: authed })
const mineBefore = listBefore.body?.items?.find((g) => g.id === gid)
check('شارة المكتبة: 3 تعليقات في خيط واحد مفتوح', mineBefore?.commentCount === 3 && mineBefore?.openCommentCount === 1, JSON.stringify({ c: mineBefore?.commentCount, o: mineBefore?.openCommentCount }))

const resolve = await api(`/api/guides/${gid}/comments/${rootId}`, {
  method: 'PATCH',
  headers: authed,
  body: JSON.stringify({ resolved: true }),
})
check('وسم الخيط محلولًا', resolve.status === 200 && resolve.body.comment.resolved === true)

const listAfter = await api('/api/guides?limit=100', { headers: authed })
const mineAfter = listAfter.body?.items?.find((g) => g.id === gid)
check('بعد الحل: 3 تعليقات وصفر خيوط مفتوحة', mineAfter?.commentCount === 3 && mineAfter?.openCommentCount === 0)

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
