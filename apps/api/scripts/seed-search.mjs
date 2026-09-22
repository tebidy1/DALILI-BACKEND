// بذر بيانات قياس البحث (مواصفة البحث §7): 500 دليل بنصوص ERP عربية واقعية
// عبر الـAPI الحقيقي نفسه — الفهرسة تحدث بالتطبيق لا بمنطق مكرر.
// يشغَّل ضد خادم يعمل على 8787. يخزّن بيانات الدخول في data/seed-credentials.json للمقعد.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const BASE = 'http://127.0.0.1:8787'
const COUNT = Number(process.argv[2] ?? 500)

const TOPICS = [
  ['إصدار فاتورة ضريبية للعميل', ['افتح شاشة الفواتير', 'اختر العميل من القائمة', 'أدخل بنود الفاتورة', 'راجع الإجمالي قبل الاعتماد', 'اضغط اعتماد ثم طباعة']],
  ['أمر شراء بعملة أجنبية', ['افتح دورة المشتريات', 'أنشئ أمر شراء جديد', 'حدد المورد والعملة', 'أدخل الأسعار والتواريخ', 'أرسل للاعتماد المالي']],
  ['تسجيل قيد يومية عام', ['افتح دفتر اليومية', 'اختر نوع القيد', 'أدخل المدين والدائن', 'اربط بالحسابات المناسبة', 'احفظ القيد']],
  ['معالجة مطالبة مورد متأخرة', ['افتح سجل المطالبات', 'ابحث برقم المطالبة', 'راجعة الفروقات', 'اعتمد أو اعترض مع السبب', 'أبلغ المورد']],
  ['إقفال الفترة المالية الشهرية', ['شغّل تقرير الأرصدة', 'راجع الحسابات المعلقة', 'اقفل الفترة', 'أرشف التقارير']],
  ['إضافة موظف جديد في النظام', ['افتح ملف الموظفين', 'أدخل البيانات الأساسية', 'فعّل صلاحيات SAP', 'اربط بالقسم والتكلفة']],
  ['استيراد كشف حساب بنكي CSV', ['حمّل الكشف من البنك', 'افتح شاشة الاستيراد', 'طابق الأعمدة', 'راجع النتيجة واحفظ']],
  ['إعداد تقرير المخزون الراكد', ['افتح تقارير المخزون', 'حدد مدة الركود 180 يوم', 'صدّر النتائج Excel', 'أرسل للإدارة']],
  ['تحويل مبلغ لمورد عبر الشيكات', ['افتح سجل الشيكات', 'أنشئ شيكًا جديد', 'أدخل المبلغ والمستفيد', 'اطبع وأرشف']],
  ['تصفية سلفة موظف شهريًا', ['افتح سجل السلف', 'اختر الموظف', 'سجّل القسط الشهري', 'راجع المتبقي']],
]

function makeGuide(i) {
  const [title, steps] = TOPICS[i % TOPICS.length] ?? TOPICS[0]
  const branch = ['الرياض', 'جدة', 'الدمام'][i % 3] ?? 'الرياض'
  const now = new Date(Date.now() - (i % 180) * 86_400_000).toISOString()
  return {
    id: `seed${String(i).padStart(4, '0')}${randomBytes(4).toString('hex')}`,
    schemaVersion: 1,
    title: `${title} — فرع ${branch}`,
    locale: 'ar',
    dir: 'rtl',
    createdAt: now,
    updatedAt: now,
    steps: steps.map((s, j) => ({
      id: `s${i}-${j}${randomBytes(3).toString('hex')}`,
      kind: j === 0 ? 'navigate' : 'click',
      title: s,
      note: j === steps.length - 1 ? `تنبيه فرع ${branch}: راجع السياسة قبل التنفيذ` : undefined,
      target: { role: 'button' },
      sensitive: false,
      url: `https://erp.example.com/${encodeURIComponent(title.slice(0, 12))}/${i}`,
      pageTitle: `نظام ERP — ${title}`,
      ts: Date.now() + j,
    })),
  }
}

async function main() {
  const email = `seed-${Date.now()}@dalili.sa`
  const password = randomBytes(12).toString('base64url')
  let cookie = ''
  const login = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (login.status !== 200) throw new Error(`فشل تسجيل المستخدم البذر: ${login.status} ${await login.text()}`)
  const setCookie = login.headers.get('set-cookie')
  if (!setCookie) throw new Error('لا كوكي جلسة من الخادم')
  cookie = setCookie.split(';')[0] ?? ''

  const startedAt = Date.now()
  let created = 0
  const BATCH = 10
  for (let b = 0; b < COUNT; b += BATCH) {
    const guides = Array.from({ length: Math.min(BATCH, COUNT - b) }, (_, j) => makeGuide(b + j))
    await Promise.all(
      guides.map((guide) =>
        fetch(`${BASE}/api/guides`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ guide }),
        }).then((r) => {
          if (r.status === 200) created++
        }),
      ),
    )
    process.stdout.write(`\r${created}/${COUNT}`)
  }
  console.log(`\nبُذر ${created} دليلًا في ${((Date.now() - startedAt) / 1000).toFixed(1)} ث`)

  // بيانات دخول المقعد — ملف محلي لا يدخل المصدر
  const credPath = path.resolve(import.meta.dirname, '../data/seed-credentials.json')
  fs.writeFileSync(credPath, JSON.stringify({ email, password, base: BASE }, null, 2))
  console.log(`بيانات الدخول للمقعد: ${credPath}`)
}

void main()
