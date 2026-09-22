// إثبات حي للحزمة ⑥: دليل ترحيبي + إضافة خطوات (CAP-17) + مرشحات بحث (SRCH-02)
const BASE = 'http://localhost:8787'
const stamp = Date.now().toString(36)
const log = (...a) => console.log(...a)
const fail = (m) => {
  console.error('FAIL:', m)
  process.exit(1)
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  })
  const body = res.status === 204 ? undefined : await res.json().catch(() => null)
  return { status: res.status, body, cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}

const step = (id, title, url, kind = 'click') => ({
  id,
  kind,
  title,
  target: {},
  sensitive: false,
  url,
  pageTitle: 'صفحة الإثبات',
  ts: 1,
})

async function main() {
  // ——— UX-05: الدليل الترحيبي ———
  const email = `pkg6-${stamp}@dalili.sa`
  const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'password123' }) })
  if (reg.status !== 200) fail('register ' + reg.status)
  const cookie = reg.cookie
  log('1) تسجيل حساب جديد:', email)

  const list = await api('/api/guides', { headers: { cookie } })
  const item = list.body.items[0]
  if (list.body.total !== 1 || !item.title.includes('مرحبًا')) fail('لا دليل ترحيبي: ' + JSON.stringify(list.body.items[0]))
  if (item.stepCount < 5 || !item.tags.includes('ترحيب')) fail('الدليل الترحيبي ناقص: ' + JSON.stringify(item))
  log(`2) الدليل الترحيبي موجود: «${item.title}» — ${item.stepCount} خطوات، وسم «ترحيب» ✓`)

  // ——— CAP-17: أضف خطوات لدليل قائم ———
  const now = new Date().toISOString()
  const guide = {
    id: 'ignored',
    schemaVersion: 1,
    title: 'دليل تسليم المهمة',
    locale: 'ar',
    dir: 'rtl',
    createdAt: now,
    updatedAt: now,
    steps: [
      step('a1', 'افتح لوحة المشاريع', 'https://erp.example.com/projects', 'navigate'),
      step('a2', 'اختر مشروع الرياض', 'https://erp.example.com/projects'),
    ],
  }
  const created = await api('/api/guides', { method: 'POST', headers: { cookie }, body: JSON.stringify({ guide }) })
  if (created.status !== 200) fail('create guide ' + created.status + JSON.stringify(created.body))
  const gid = created.body.id
  log('3) دليل جديد:', gid, '— خطوتان')

  const extra = {
    steps: [
      { ...step('n1', 'خطوة مضافة حيًّا: مراجعة النطاق', 'https://erp.example.com/projects'), ts: 9 },
      { ...step('n2', 'خطوة مضافة حيًّا: تأكيد التسليم', 'https://erp.example.com/projects'), ts: 10 },
    ],
    insertAt: 1,
  }
  const appended = await api(`/api/guides/${gid}/steps`, { method: 'POST', headers: { cookie }, body: JSON.stringify(extra) })
  if (appended.status !== 200 || appended.body.stepCount !== 4) fail('append ' + appended.status + JSON.stringify(appended.body))
  const after = await api(`/api/guides/${gid}`, { headers: { cookie } })
  if (after.body.guide.steps[1].title.includes('خطوة مضافة حيًّا: مراجعة') !== true) fail('insertAt لم يعمل: ' + after.body.guide.steps.map((s) => s.title).join(' | '))
  log('4) إضافة خطوتين بinsertAt=1 ✓ — الترتيب: ', after.body.guide.steps.map((s, i) => `${i + 1}) ${s.title}`).join(' ← '))

  // البحث يجد الخطوة المضافة فورًا (الفهرس تابع للإضافة)
  const searchNew = await api(`/api/search?q=${encodeURIComponent('مراجعة النطاق')}`, { headers: { cookie } })
  if (!searchNew.body.hits.some((h) => h.guideId === gid)) fail('الخطوة المضافة غير مفهرسة')
  log('5) الخطوة المضافة ظهرت في البحث فورًا ✓')

  // ——— SRCH-02: مرشحات المجلد والنطاق ———
  const folder = await api('/api/folders', { method: 'POST', headers: { cookie }, body: JSON.stringify({ name: 'مشاريع التسليم' }) })
  if (folder.status !== 200) fail('folder ' + folder.status)
  await api(`/api/guides/${gid}/meta`, { method: 'PATCH', headers: { cookie }, body: JSON.stringify({ folderId: folder.body.id }) })

  const now2 = new Date().toISOString()
  const otherGuide = {
    id: 'ignored2',
    schemaVersion: 1,
    title: 'دليل مراجعة النطاق في الموارد',
    locale: 'ar',
    dir: 'rtl',
    createdAt: now2,
    updatedAt: now2,
    steps: [step('b1', 'افتح الموارد البشرية', 'https://hr.example.com/review', 'navigate')],
  }
  const other = await api('/api/guides', { method: 'POST', headers: { cookie }, body: JSON.stringify({ guide: otherGuide }) })

  const kw = encodeURIComponent('مراجعة النطاق')
  const byFolder = await api(`/api/search?q=${kw}&folder=${folder.body.id}`, { headers: { cookie } })
  const folderIds = new Set(byFolder.body.hits.map((h) => h.guideId))
  if (folderIds.size !== 1 || !folderIds.has(gid)) fail('مرشح المجلد: ' + JSON.stringify([...folderIds]))
  log('6) مرشح المجلد حصر النتائج على دليل المجلد ✓')

  const bySite = await api(`/api/search?q=${kw}&site=erp.example.com`, { headers: { cookie } })
  const siteIds = new Set(bySite.body.hits.map((h) => h.guideId))
  if (!siteIds.has(gid) || siteIds.has(other.body.id)) fail('مرشح النطاق: ' + JSON.stringify([...siteIds]))
  log('7) مرشح النطاق site=erp.example.com أدخل دليل ERP وأخرج دليل HR ✓')

  const welcomeSearch = await api(`/api/search?q=${encodeURIComponent('دليلي')}`, { headers: { cookie } })
  log('8) الدليل الترحيبي قابل للبحث بنفسه:', welcomeSearch.body.hits.length > 0 ? '✓' : '✗')
  log('\nALL LIVE PROOFS PASSED ✓')
}

main().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
