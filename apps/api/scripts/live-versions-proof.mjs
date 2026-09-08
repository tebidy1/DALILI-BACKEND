// VER-01: إثبات حي ضدّ خادم 8787 حقيقي — ٨ فحوصات صادقة.
// كيف يُشغَّل: `pnpm --filter @dalili/api dev` في نافذة،
// ثم في نافذة أخرى: `node apps/api/scripts/live-versions-proof.mjs`.
// المتغيّر البيئي `API_BASE` يبدّل الأصل عند الحاجة.

const API = process.env.API_BASE ?? 'http://localhost:8787'

/** يرسل ويعيد {status, headers, body, cookie} — الكوكي المُعاد يمرَّر للطلب التالي */
async function req(method, url, opts = {}) {
  const headers = { 'content-type': 'application/json' }
  if (opts.cookie) headers.cookie = opts.cookie
  const res = await fetch(API + url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  const setCookie = res.headers.get('set-cookie')
  return {
    status: res.status,
    headers: res.headers,
    body,
    cookie: setCookie ? setCookie.split(';')[0] : opts.cookie,
  }
}

async function register(email) {
  const password = 'x' + Math.random().toString(36).slice(2) + '1A!'
  const r = await req('POST', '/api/auth/register', { body: { email, password } })
  if (r.status !== 200) throw new Error(`register ${r.status}: ${JSON.stringify(r.body)}`)
  return r.cookie
}

function assert(name, cond, detail) {
  console.log(cond ? '✔' : '✘', name, detail ? `— ${detail}` : '')
  if (!cond) process.exit(1)
}

const now = () => new Date().toISOString()
const uid = () => 'g_' + Math.random().toString(36).slice(2, 14)

const cookieA = await register(`ver-a-${Date.now()}@a.co`)
const cookieB = await register(`ver-b-${Date.now()}@a.co`)

const guide = {
  id: uid(),
  schemaVersion: 1,
  title: 'أول',
  locale: 'ar',
  dir: 'rtl',
  createdAt: now(),
  updatedAt: now(),
  steps: [],
}

const c = await req('POST', '/api/guides', { cookie: cookieA, body: { guide } })
assert('١. أُنشئ الدليل', c.status === 200, `id=${c.body?.id}`)
const gid = c.body.id

const v1 = await req('POST', `/api/guides/${gid}/versions`, { cookie: cookieA })
assert('٢. أول لقطة → 201', v1.status === 201 && v1.body.title === 'أول', `id=${v1.body?.id}`)

const dup = await req('POST', `/api/guides/${gid}/versions`, { cookie: cookieA })
assert(
  '٣. لقطة مكرّرة → 204 + X-Version-Deduped:true',
  dup.status === 204 && dup.headers.get('x-version-deduped') === 'true',
)

const g2 = { ...guide, id: gid, title: 'ثانٍ' }
const p = await req('PATCH', `/api/guides/${gid}`, { cookie: cookieA, body: { guide: g2 } })
assert('٤. عدَّلت العنوان', p.status === 200)

const v2 = await req('POST', `/api/guides/${gid}/versions`, { cookie: cookieA })
assert('٥. لقطة بعد التعديل → 201', v2.status === 201 && v2.body.title === 'ثانٍ')

const list = await req('GET', `/api/guides/${gid}/versions`, { cookie: cookieA })
assert(
  '٦. القائمة تعيد ٢، الأحدث أولًا، بلا data',
  list.status === 200 &&
    list.body.items.length === 2 &&
    list.body.items[0].title === 'ثانٍ' &&
    list.body.items[1].title === 'أول' &&
    list.body.items[0].data === undefined,
)

const one = await req('GET', `/api/guides/${gid}/versions/${v1.body.id}`, { cookie: cookieA })
assert(
  '٧. جلب أول نسخة يعيد العنوان القديم',
  one.status === 200 && one.body.guide.title === 'أول',
)

const stranger = await req('GET', `/api/guides/${gid}/versions`, { cookie: cookieB })
assert('٨. مستخدم آخر → 404 (لا 403 كي لا يفشي الوجود)', stranger.status === 404)

console.log('\nكل الفحوصات الثمانية خضراء ✔')
