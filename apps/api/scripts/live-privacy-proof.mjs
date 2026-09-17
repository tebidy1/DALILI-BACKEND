/** إثبات حي لخصوصيّة الملفّات (٢ب) ضد الخادم الحي 8787:
 *  رفع لقطة حقيقيّة → المعرّف وحده 404 (بجلسة وبدونها) والرابط الموقَّع 200 →
 *  دليل بطمس نصف اللقطة وقصّ → نشر ومشاركة → DTO الضيف بلا معرّف أصل ولا رابط غير موقَّع →
 *  المشتقّ محروق فعلًا (تباين منخفض + أبعاد القصّ) ويُحفظ للفحص بالعين →
 *  الخادم يبقى مستجيبًا أثناء حرق جديد في الخلفية (/health) → السحب يقطع الصورة فورًا.
 *  تشغيل: من apps/api ← node scripts/live-privacy-proof.mjs <مسار حفظ المشتقّ.jpg>
 *  تنظيف ذاتي (حذف نهائي للدليل)، ولا process.exit (فخ UV). */
import fs from 'node:fs'
import jpeg from 'jpeg-js'

const API = 'http://127.0.0.1:8787'
const STAMP = Date.now()
const EMAIL = `privacy-proof-${STAMP}@dalili.sa`
const PASSWORD = 'proof-pass-12345'
const OUT = process.argv[2]

let failures = 0
let groups = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures++
}

async function api(path, opts = {}) {
  const t = performance.now()
  const res = await fetch(API + path, {
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json', ...(opts.headers ?? {}) } : opts.headers ?? {},
  })
  const ms = Math.round(performance.now() - t)
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const raw = res.status === 204 ? null : isJson ? await res.text() : Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    ms,
    text: typeof raw === 'string' ? raw : '',
    body: typeof raw === 'string' ? JSON.parse(raw) : null,
    bytes: Buffer.isBuffer(raw) ? raw : null,
    headers: res.headers,
    setCookie: res.headers.get('set-cookie'),
  }
}

/** لقطة 1280×720 بخطوط رأسيّة بعرض ٢ — تفاصيل عالية التردّد يمحوها الطمس */
function stripesJpeg(w = 1280, h = 720) {
  const data = Buffer.alloc(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % w
    data[i] = data[i + 1] = data[i + 2] = Math.floor(x / 2) % 2 ? 255 : 0
    data[i + 3] = 255
  }
  return Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data)
}

function variance(img, x0, y0, x1, y1) {
  const vals = []
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(img.data[(y * img.width + x) * 4])
  const m = vals.reduce((a, b) => a + b, 0) / vals.length
  return vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length
}

const UNSIGNED = /\/files\/[A-Za-z0-9_-]{8,64}(?![A-Za-z0-9_-]|\?e=)/

// ——— ١) مستخدم + رفع لقطة حقيقيّة ———
groups++
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
check('1. تسجيل مستخدم الإثبات', reg.status === 200)
const auth = { cookie: reg.setCookie.split(';')[0] }
const fd = new FormData()
fd.append('file', new Blob([new Uint8Array(stripesJpeg())], { type: 'image/jpeg' }), 'shot.jpg')
const up = await api('/api/uploads', { method: 'POST', headers: auth, body: fd })
const { fileId, thumbFileId, fileUrl, thumbUrl } = up.body ?? {}
check('1. الرفع يعيد روابط موقَّعة', up.status === 200 && /\?e=\d+&c=/.test(fileUrl ?? '') && /\?e=\d+&c=/.test(thumbUrl ?? ''))

// ——— ٢) المعرّف وحده لا يفتح شيئًا ———
groups++
const bareAnon = await api(`/files/${fileId}`)
const bareAuth = await api(`/files/${fileId}`, { headers: auth })
const signed = await api(fileUrl)
check('2. /files/<id> بلا توقيع ← 404 بلا جلسة', bareAnon.status === 404)
check('2. /files/<id> بلا توقيع ← 404 حتى بجلسة المالك', bareAuth.status === 404)
check('2. الرابط الموقَّع ← 200 وcache-control خاص', signed.status === 200 && (signed.headers.get('cache-control') ?? '').startsWith('private'))

// ——— ٣) دليل بطمس النصف الأيسر وقصّ، ثم نشر ومشاركة ———
groups++
const CROP = { x: 40, y: 20, w: 1200, h: 680 }
const now = new Date().toISOString()
const guide = {
  id: `privacy-${STAMP}`,
  schemaVersion: 1,
  title: 'إثبات خصوصيّة اللقطات',
  locale: 'ar',
  dir: 'rtl',
  createdAt: now,
  updatedAt: now,
  steps: [
    {
      id: 's1',
      kind: 'click',
      title: 'خطوة فيها بيانات حسّاسة',
      target: {},
      sensitive: false,
      url: 'https://erp.example/hr',
      pageTitle: 'الموارد البشريّة',
      ts: 1,
      screenshot: {
        fileId,
        thumbFileId,
        fileUrl: `http://stale-host/files/${fileId}`,
        blurRects: [{ x: 0, y: 0, w: 640, h: 720 }],
        crop: CROP,
        mark: { rect: { x: 700, y: 300, w: 100, h: 40 }, color: '#ea580c' },
      },
    },
  ],
}
const cg = await api('/api/guides', { method: 'POST', headers: auth, body: JSON.stringify({ guide }) })
const gid = cg.body?.id
check('3. إنشاء الدليل', cg.status === 200 && !!gid)
await api(`/api/guides/${gid}/meta`, { method: 'PATCH', headers: auth, body: JSON.stringify({ visibility: 'workspace' }) })
const sh = await api(`/api/guides/${gid}/share`, { method: 'POST', headers: auth })
const token = sh.body?.token
check('3. إنشاء المشاركة لا ينتظر الحرق', sh.status === 200 && sh.ms < 1000, `${sh.ms}ms`)

// ——— ٤) DTO الضيف ———
groups++
const pub = await api(`/api/share/${token}`)
check('4. GET /api/share ← 200', pub.status === 200, `${pub.ms}ms (يشمل انتظار الحرق إن لم يكتمل التسخين)`)
check('4. لا معرّف أصل ولا مصغّرة في استجابة الضيف', !pub.text.includes(fileId) && !pub.text.includes(thumbFileId))
check('4. لا رابط /files غير موقَّع في استجابة الضيف', !UNSIGNED.test(pub.text))
const pshot = pub.body?.guide?.steps?.[0]?.screenshot ?? {}
check('4. الطمس والقصّ محروقان (blurRects فارغة، crop غائب)', Array.isArray(pshot.blurRects) && pshot.blurRects.length === 0 && pshot.crop === undefined)
check('4. إطار الهدف مُزاح بمقدار القصّ', pshot.mark?.rect?.x === 660 && pshot.mark?.rect?.y === 280, JSON.stringify(pshot.mark?.rect))
const pub2 = await api(`/api/share/${token}`)
check('4. الطلب الثاني من المشتقّ المخزَّن سريع', pub2.status === 200 && pub2.ms < 300, `${pub2.ms}ms`)

// ——— ٥) المشتقّ محروق فعلًا ———
groups++
const derived = await api(pshot.fileUrl)
check('5. المشتقّ ← 200 بنطاق المشاركة', derived.status === 200 && /&s=/.test(pshot.fileUrl ?? ''))
if (derived.bytes) {
  const img = jpeg.decode(derived.bytes, { useTArray: true })
  check('5. أبعاد المشتقّ = أبعاد القصّ', img.width === CROP.w && img.height === CROP.h, `${img.width}×${img.height}`)
  // النصف الأيسر الأصلي x<640 ⇐ في المشتقّ x<600 بعد إزاحة 40
  const vBlur = variance(img, 20, 100, 580, 600)
  const vClear = variance(img, 640, 100, 1180, 600)
  check('5. المنطقة المطموسة بلا تفاصيل وغير المطموسة سليمة', vBlur < 400 && vClear > 4000, `تباين مطموس=${Math.round(vBlur)} سليم=${Math.round(vClear)}`)
  if (OUT) {
    fs.writeFileSync(OUT, derived.bytes)
    console.log(`   ↳ حُفظ المشتقّ للفحص بالعين: ${OUT}`)
  }
}

// ——— ٦) الخادم مستجيب أثناء حرق جديد ———
groups++
const edited = structuredClone(guide)
edited.steps[0].screenshot.blurRects = [{ x: 0, y: 0, w: 700, h: 720 }]
const patch = await api(`/api/guides/${gid}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ guide: edited }) })
const health = []
for (let i = 0; i < 20; i++) health.push((await api('/health')).ms)
check('6. تعديل الطمس بعد المشاركة ← 200 فورًا', patch.status === 200, `${patch.ms}ms`)
check('6. /health يبقى سريعًا أثناء الحرق في الخلفية', Math.max(...health) < 250, `أقصى=${Math.max(...health)}ms · ${health.join(',')}`)

// ——— ٧) العضو يرى روابط موقَّعة ———
groups++
const member = await api(`/api/guides/${gid}`, { headers: auth })
const mshot = member.body?.guide?.steps?.[0]?.screenshot ?? {}
check('7. GET الدليل للمالك بلا رابط غير موقَّع ولا رابط قديم مخزَّن', !UNSIGNED.test(member.text) && !member.text.includes('stale-host'))
check('7. رابط الأصل الموقَّع للمالك يعمل', (await api(mshot.fileUrl)).status === 200)

// --keep: يُبقي المشاركة حيّة ويطبع رابطها لبرهان المتصفّح (العارض العامّ) — بلا سحب ولا تنظيف
if (process.argv[3] === '--keep') {
  const again = await api(`/api/guides/${gid}/share`, { method: 'POST', headers: auth })
  console.log(`\nKEEP token=${again.body?.token} guide=${gid} owner=${EMAIL}`)
  console.log(`${failures === 0 ? '✅ كل الفحوص خضراء' : `❌ ${failures} فحص فشل`} (${groups} مجموعات، المشاركة مُبقاة)`)
} else {
// ——— ٨) السحب يقطع الصورة فورًا ———
groups++
await api(`/api/guides/${gid}/share`, { method: 'DELETE', headers: auth })
check('8. بعد السحب رابط المشتقّ ← 404', (await api(pshot.fileUrl)).status === 404)
check('8. بعد السحب DTO الضيف ← 404', (await api(`/api/share/${token}`)).status === 404)

// ——— تنظيف ———
await api(`/api/guides/${gid}?permanent=1`, { method: 'DELETE', headers: auth })

console.log(`\n${failures === 0 ? '✅ كل الفحوص خضراء' : `❌ ${failures} فحص فشل`} (${groups} مجموعات)`)
}
