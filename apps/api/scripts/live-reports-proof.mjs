/** إثبات حي للمرحلة ج (أنشئ بواسطي + التقارير — WS-06) ضد الخادم الحي 8787:
 *  GET /api/reports/mine يجمع بصدق على القاعدة الحية: الأدلة والمنشور والمشاهدات
 *  (VIEW-06 عبر رابط مشاركة حي) وتعليقات تنتظر ردًا (GM-05) — والسلة والمشاركة
 *  المسحوبة تُسقط من التقرير. تنظيف ذاتي كامل، ولا process.exit (فخ UV). */
const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const ADMIN_EMAIL = `reports-proof-${STAMP}@dalili.sa`
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

// ——— ١) التأسيس: مدير حديث — له الدليل الترحيبي وحده ———
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }) })
check('1. تسجيل المالك (معه الدليل الترحيبي المزروع)', reg.status === 200)
const admin = { cookie: reg.setCookie.split(';')[0] }

const fresh = (await api('/api/reports/mine', { headers: admin })).body
check('2. حديث التسجيل: تقريره = دليل الترحيب وحده (١/٠/٠/٠)', fresh?.total === 1 && fresh?.published === 0 && fresh?.views === 0 && fresh?.openComments === 0, JSON.stringify(fresh))

// ——— ٣) دليلان: منشور مشترك + خاص ———
const c1 = await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(`rppub${STAMP}`, 'إثبات تقارير — فاتورة', 'https://rep-erp.example/invoices') }) })
const c2 = await api('/api/guides', { method: 'POST', headers: admin, body: JSON.stringify({ guide: mkGuide(`rppriv${STAMP}`, 'إثبات تقارير — سري', 'https://rep-erp.example/secret') }) })
check('3. إنشاء دليلين (منشور/خاص)', c1.status === 200 && c2.status === 200)
const pubId = c1.body.id
const privId = c2.body.id
await api(`/api/guides/${pubId}/meta`, { method: 'PATCH', headers: admin, body: JSON.stringify({ visibility: 'workspace' }) })

// ——— ٤) مشاركة حية + مشاهدتان من العالم (VIEW-06) ———
const share = await api(`/api/guides/${pubId}/share`, { method: 'POST', headers: admin })
check('4. توليد رابط مشاركة', share.status === 200 && !!share.body?.token)
const { token } = share.body
await api(`/api/share/${token}/view`, { method: 'POST' })
await api(`/api/share/${token}/view`, { method: 'POST' })

// ——— ٥) تعليق مالك على الخطوة الأولى (GM-05) ينتظر ردًا ———
const cm = await api(`/api/guides/${pubId}/comments`, { method: 'POST', headers: admin, body: JSON.stringify({ stepId: 's1', body: 'هذه الخطوة تحتاج توضيح الصلاحيات' }) })
check('5. تعليق مالك على الخطوة الأولى', cm.status === 200 && !!cm.body?.comment?.id)

const rep = (await api('/api/reports/mine', { headers: admin })).body
check('6. التقرير المجمّع يجمع كل شيء: ٣ أدلة · ١ منشور · ٢ مشاهدات · ١ تنتظر ردًا', rep?.total === 3 && rep?.published === 1 && rep?.views === 2 && rep?.openComments === 1, JSON.stringify(rep))

// ——— ٧) الإرجاع خاص (نفس مسار زر «إرجاع خاص» السريع) يُسقط المنشور ———
await api(`/api/guides/${pubId}/meta`, { method: 'PATCH', headers: admin, body: JSON.stringify({ visibility: 'private' }) })
const repUnpub = (await api('/api/reports/mine', { headers: admin })).body
check('7. بعد الإرجاع خاص: منشور ٠ والبقية كما هي', repUnpub?.published === 0 && repUnpub?.total === 3 && repUnpub?.views === 2, JSON.stringify(repUnpub))
await api(`/api/guides/${pubId}/meta`, { method: 'PATCH', headers: admin, body: JSON.stringify({ visibility: 'workspace' }) })

// ——— ٨) السلة خارج التقرير ———
const del = await api(`/api/guides/${privId}`, { method: 'DELETE', headers: admin })
check('8. حذف الخاص إلى السلة (204 بلا جسم)', del.status === 200 || del.status === 204)
const repTrash = (await api('/api/reports/mine', { headers: admin })).body
check('9. السلة خارج التقرير: الأدلة ٢', repTrash?.total === 2, JSON.stringify(repTrash))

// ——— ١٠) سحب المشاركة يُسقط مشاهداتها — لا أرقام من رابط ميت ———
await api(`/api/guides/${pubId}/share`, { method: 'DELETE', headers: admin })
const repRevoked = (await api('/api/reports/mine', { headers: admin })).body
check('10. بعد سحب المشاركة: المشاهدات ٠', repRevoked?.views === 0, JSON.stringify(repRevoked))

// ——— تنظيف ذاتي: حذف نهائي لكل آثار الإثبات (والتعليقات تتبع الدليل cascade) ———
for (const id of [pubId, privId]) {
  await api(`/api/guides/${id}?permanent=1`, { method: 'DELETE', headers: admin })
}
const welcomeId = (await api('/api/guides', { headers: admin })).body
const allIds = (welcomeId?.items ?? []).filter((g) => g.title?.includes('ترحيبي') || g.site === 'dalili.app')
for (const g of allIds) {
  await api(`/api/guides/${g.id}?permanent=1`, { method: 'DELETE', headers: admin })
}
const clean = (await api('/api/reports/mine', { headers: admin })).body
check('11. التنظيف الذاتي: التقرير أصفار صادقة بعد حذف كل شيء نهائيًا', clean?.total === 0 && clean?.published === 0 && clean?.views === 0 && clean?.openComments === 0, JSON.stringify(clean))

console.log(failures === 0 ? '\nالنتيجة: إثبات حي كامل — التقرير المجمّع يصدق على القاعدة الحية ✔' : `\nالنتيجة: ${failures} بندًا ساقطًا ✘`)
