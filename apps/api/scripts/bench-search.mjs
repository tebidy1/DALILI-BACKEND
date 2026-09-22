// مقعد قياس البحث (مواصفة البحث §7): p95 لـ/api/search و/api/search/suggest
// ضد الخادم الحقيقي المزروع ببيانات seed-search. لا يُقبل ادعاء أداء دون تشغيله.
import fs from 'node:fs'
import path from 'node:path'

const credPath = path.resolve(import.meta.dirname, '../data/seed-credentials.json')
if (!fs.existsSync(credPath)) {
  console.error('شغّل seed-search أولًا — لا بيانات مقعد')
  process.exitCode = 1
} else {
  const { email, password, base } = JSON.parse(fs.readFileSync(credPath, 'utf8'))

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (login.status !== 200) throw new Error(`فشل الدخول: ${login.status}`)
  const setCookie = login.headers.get('set-cookie')
  if (!setCookie) throw new Error('لا كوكي جلسة')
  const cookie = setCookie.split(';')[0] ?? ''

  const QUERIES = [
    'الفاتورة', 'فاتوره الضريبه', 'أمر شراء', 'إعتماد', 'مطالبة المورد', 'قيد اليومية',
    'الموظف الجديد', 'كشف CSV', 'المخزون الراكد', 'سلفة', 'فات', '١٢٣', 'approval', 'SAP',
  ]

  function p95(samples) {
    const sorted = [...samples].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0
  }

  async function bench(pathname, n) {
    const times = []
    for (let i = 0; i < n; i++) {
      const q = QUERIES[i % QUERIES.length] ?? 'الفاتورة'
      const t0 = performance.now()
      const res = await fetch(`${base}${pathname(encodeURIComponent(q))}`, { headers: { cookie } })
      const dt = performance.now() - t0
      if (res.status !== 200) throw new Error(`بحث → ${res.status}`)
      times.push(dt)
    }
    return p95(times)
  }

  // ضمن حدود SEC-01: البحث 30/دقيقة — المقعد يقيس تحتها لا فوقها
  const searchP95 = await bench((q) => `/api/search?q=${q}&limit=20`, 28)
  const suggestP95 = await bench((q) => `/api/search/suggest?q=${q}`, 18)

  console.log(`search   p95: ${searchP95.toFixed(0)}ms  (الهدف < 300ms) ${searchP95 < 300 ? '✓' : '✗'}`)
  console.log(`suggest  p95: ${suggestP95.toFixed(0)}ms  (الهدف < 120ms) ${suggestP95 < 120 ? '✓' : '✗'}`)
  process.exitCode = searchP95 < 300 && suggestP95 < 120 ? 0 : 2
}
