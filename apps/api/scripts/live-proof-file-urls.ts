/**
 * برهان حيّ لعلّة 2026-09-30 (اللقطات لا تظهر في الأدلّة بعد فصل الدومينين).
 *
 * يحاكي طوبولوجيا الإنتاج حرفيًّا: الـAPI على أصلٍ (منفذ ‏8899) والويب على
 * أصلٍ آخر (منفذ ‏8931). يقلع خادمًا حقيقيًّا بقاعدة بيانات مؤقّتة، ويرفع
 * **لقطةً حقيقيّة**، وينشئ دليلًا، ثم يقرأه عبر HTTP حقيقيّ ويفحص:
 *
 *   ١ أنّ `fileUrl` يخرج **مطلقًا** بقاعدة الخادم (لا نسبيًّا).
 *   ٢ أنّ ذلك الرابط يخدم بايتات الصورة فعلًا بنوعها.
 *   ٣ أنّ الرابط النسبيّ القديم يُحلّ على أصل **الويب** فيردّ HTML لا صورة —
 *     أي إعادة إنتاج العطل نفسه للمقارنة.
 *   ٤ ورابط الضيف (المشاركة) كذلك مطلق ويخدم.
 *
 * التشغيل: pnpm --filter @dalili/api exec tsx scripts/live-proof-file-urls.ts <مسار.jpg>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app'

const API_PORT = 8899
const API_BASE = `http://127.0.0.1:${API_PORT}`
const WEB_BASE = 'http://127.0.0.1:8931' // أصل الويب — منفصلٌ عن الـAPI كما الإنتاج

const shotPath = process.argv[2]
if (!shotPath || !fs.existsSync(shotPath)) {
  console.error('مرّر مسار لقطة .jpg حقيقيّة')
  process.exit(1)
}

const ok = (c: boolean, msg: string) => {
  console.log(`${c ? '✔' : '✘'} ${msg}`)
  if (!c) process.exitCode = 1
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-liveproof-'))
const { app } = await createApp({
  dataDir: dir,
  cookieSecret: 'live-proof-secret-not-production',
  publicBase: API_BASE, // ← ما يضبطه المالك في .env بالعنوان العموميّ للـAPI
  corsOrigins: [WEB_BASE],
})
await app.listen({ port: API_PORT, host: '127.0.0.1' })
console.log(`الـAPI يعمل على ${API_BASE} · بياناته في ${dir}\n`)

// ١ حساب حقيقيّ عبر HTTP
const pw = 'lp-' + Math.random().toString(36).slice(2, 14)
const reg = await fetch(`${API_BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `live-proof-${Date.now()}@dalili.sa`, password: pw }),
})
const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0]!
ok(reg.status === 200 && !!cookie, `تسجيل حساب عبر HTTP (${reg.status})`)

// ٢ رفع اللقطة الحقيقيّة
const bytes = fs.readFileSync(shotPath)
const form = new FormData()
form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'shot.jpg')
const up = await fetch(`${API_BASE}/api/uploads`, { method: 'POST', headers: { cookie }, body: form })
const upBody = (await up.json()) as { fileId: string; thumbFileId?: string; fileUrl: string }
ok(up.status === 200, `رفع لقطة حقيقيّة ${(bytes.length / 1024) | 0}KB (${up.status}) — fileId=${upBody.fileId}`)

// ٣ دليل يشير إليها
const guide = {
  id: 'lp-' + Date.now(),
  schemaVersion: 2,
  title: 'برهان الروابط',
  locale: 'ar',
  dir: 'rtl',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  steps: [
    {
      id: 'st-1',
      kind: 'click',
      title: 'خطوة ببكسلات حقيقيّة',
      target: {},
      sensitive: false,
      // مصدر ديسكتوب كما تبثّه الجلسة — كي يكون البرهان على حالة المالك نفسها
      source: {
        kind: 'desktop',
        processName: 'C:\\Windows\\System32\\notepad.exe',
        windowTitle: 'برهان الروابط',
        appId: 'app:notepad.exe',
        uiaFramework: 'Win32',
      },
      ts: Date.now(),
      screenshot: { fileId: upBody.fileId, blurRects: [], ...(upBody.thumbFileId ? { thumbFileId: upBody.thumbFileId } : {}) },
    },
  ],
}
const created = await fetch(`${API_BASE}/api/guides`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ guide }),
})
const createdBody = (await created.json()) as { id?: string; errorAr?: string }
if (!createdBody.id) {
  console.error(`إنشاء الدليل ${created.status}: ${JSON.stringify(createdBody)}`)
  process.exit(1)
}
const guideId = createdBody.id
ok(created.status === 200 || created.status === 201, `إنشاء دليل (${created.status}) — id=${guideId}`)

// ٤ قراءة الدليل كما يقرؤه العارض
const read = await fetch(`${API_BASE}/api/guides/${guideId}`, { headers: { cookie } })
const readBody = (await read.json()) as { guide: { steps: Array<{ screenshot?: { fileUrl?: string } }> } }
const fileUrl = readBody.guide.steps[0]?.screenshot?.fileUrl ?? ''
console.log(`\n  fileUrl = ${fileUrl}\n`)
ok(fileUrl.startsWith(API_BASE + '/files/'), 'الرابط **مطلق** بقاعدة الـAPI (كان نسبيًّا فينكسر)')

// ٥ الرابط يخدم بايتات الصورة فعلًا — بلا كوكي، كما يطلبه وسم <img>
const img = await fetch(fileUrl)
const got = Buffer.from(await img.arrayBuffer())
ok(img.status === 200, `جلب الرابط بلا كوكي (${img.status}) — كما يفعل وسم <img>`)
ok(img.headers.get('content-type') === 'image/jpeg', `النوع ${img.headers.get('content-type')}`)
ok(got.length === bytes.length && got[0] === 0xff && got[1] === 0xd8, `البايتات مطابقة (${got.length} = ${bytes.length})`)
ok(
  img.headers.get('cross-origin-resource-policy') === 'cross-origin',
  `‏CORP=${img.headers.get('cross-origin-resource-policy')} — يسمح لأصل الويب بعرضها`,
)

// ٦ إعادة إنتاج العطل: الشكل النسبيّ القديم على أصل الويب
const oldStyle = `${WEB_BASE}/files/${upBody.fileId}`
try {
  const bad = await fetch(oldStyle)
  const ct = bad.headers.get('content-type') ?? ''
  ok(!ct.startsWith('image/'), `العطل مُعاد إنتاجه: ${oldStyle} ⇐ ${bad.status} ${ct || '(بلا نوع)'} — ليس صورة`)
} catch {
  ok(true, `العطل مُعاد إنتاجه: ${oldStyle} ⇐ لا استجابة صورة على أصل الويب`)
}

// ٧ مسار الضيف (المشاركة) — الرابط المقيَّد بالرمز مطلق كذلك
const share = await fetch(`${API_BASE}/api/guides/${guideId}/share`, { method: 'POST', headers: { cookie } })
if (share.status === 200) {
  const token = ((await share.json()) as { token: string }).token
  const pub = await fetch(`${API_BASE}/api/s/${token}`)
  if (pub.status === 200) {
    const pg = (await pub.json()) as { guide: { steps: Array<{ screenshot?: { fileUrl?: string } }> } }
    const gUrl = pg.guide.steps[0]?.screenshot?.fileUrl ?? ''
    ok(gUrl.startsWith(API_BASE + '/files/'), `رابط الضيف مطلق كذلك: ${gUrl.slice(0, 64)}…`)
    const gImg = await fetch(gUrl)
    ok(gImg.status === 200, `رابط الضيف يخدم الصورة (${gImg.status})`)
  } else console.log(`  (تخطّي مسار الضيف — قراءة المشاركة ${pub.status})`)
} else console.log(`  (تخطّي مسار الضيف — إنشاء المشاركة ${share.status})`)

// ٨ صفحة مقارنة تُفتح من أصل الويب: الصورتان جنبًا إلى جنب
const page = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>body{font-family:'Segoe UI',Tahoma,sans-serif;background:#2f3b42;color:#e6edf2;padding:20px}
h3{font-size:14px;margin:0 0 6px}.row{display:flex;gap:22px}.pane{flex:1}
img{width:100%;border:1px solid #55666f;border-radius:6px;background:#1b262c;min-height:120px;display:block}
.ok{color:#8fe3a2}.bad{color:#ff9b93}small{opacity:.7;word-break:break-all;font-size:10px}</style></head><body>
<p>هذه الصفحة تُخدَم من أصل الويب <b>${WEB_BASE}</b> — والـAPI على <b>${API_BASE}</b>. تمامًا كطوبولوجيا الإنتاج.</p>
<div class="row">
 <div class="pane"><h3 class="ok">الرابط المطلق (بعد الإصلاح)</h3><img id="good" src="${fileUrl}"><small>${fileUrl}</small></div>
 <div class="pane"><h3 class="bad">الرابط النسبيّ (قبل الإصلاح)</h3><img id="bad" src="/files/${upBody.fileId}"><small>/files/${upBody.fileId} ⇠ يُحلّ على أصل الويب</small></div>
</div>
<p id="verdict">…</p>
<script>
 const wait = (el) => new Promise((r) => { if (el.complete && el.naturalWidth) return r(true); el.onload = () => r(true); el.onerror = () => r(false) })
 const g = await wait(document.getElementById('good'))
 const b = await wait(document.getElementById('bad'))
 document.getElementById('verdict').textContent =
   'المطلق حُمِّل: ' + (g ? 'نعم ✔' : 'لا ✘') + '  ·  النسبيّ حُمِّل: ' + (b ? 'نعم' : 'لا ✘ (هذا هو العطل)')
 document.title = g && !b ? 'PROOF-OK' : 'PROOF-FAIL'
</script></body></html>`
const out = process.env.PROOF_OUT
if (out) {
  fs.writeFileSync(out, page)
  console.log(`\nصفحة المقارنة: ${out}`)
}
console.log('\nالخادم باقٍ للفحص البصريّ — أوقفه بـCtrl+C')
