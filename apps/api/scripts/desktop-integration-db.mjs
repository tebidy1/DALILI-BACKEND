// مساعد قاعدة بيانات اختبار ٣د-٢/٣د-٤ — بذر/إبطال رموز وعدّ صفوف.
// يُشغَّل من مجلد apps/api (كي يُتاح better-sqlite3) على قاعدة الاختبار
// المؤقّتة حصرًا — لا يُوجَّه أبدًا إلى قاعدة المالك الحقيقيّة.
// الأوامر: seed · seed-user · approve-code · unseed-token ·
//          clear-device-tokens · count-file · count-guide

import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'

const [cmd, dbPath, arg] = process.argv.slice(2)
if (!cmd || !dbPath) {
  console.error(
    'الاستعمال: node desktop-integration-db.mjs <seed|seed-user|approve-code|unseed-token|clear-device-tokens|count-file|count-guide> <dbPath> [arg]',
  )
  process.exit(1)
}
const db = new Database(dbPath)

if (cmd === 'seed') {
  const token = arg
  if (!token || !token.startsWith('itq_')) {
    console.error('seed يطلب رمزًا يبدأ بـ itq_')
    process.exit(1)
  }
  const userId = 'u_itqan_itest'
  db.prepare(
    'INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
  ).run(userId, 'itest@example.invalid', 'itest-no-login', new Date().toISOString())
  db.prepare(
    'INSERT OR REPLACE INTO device_tokens (id, user_id, token_hash, device_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'dt_itqan_itest',
    userId,
    createHash('sha256').update(token).digest('hex'),
    'itest-device',
    new Date().toISOString(),
    new Date(Date.now() + 3_600_000).toISOString(),
  )
  console.log('seeded')
} else if (cmd === 'unseed-token') {
  db.prepare("DELETE FROM device_tokens WHERE id = 'dt_itqan_itest'").run()
  console.log('unseeded')
} else if (cmd === 'seed-user') {
  // مستخدم فقط — رمز الجهاز يأتي لاحقًا من الاقتران الحيّ لا من بذر
  db.prepare(
    'INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
  ).run('u_itqan_itest', 'itest@example.invalid', 'itest-no-login', new Date().toISOString())
  console.log('seeded-user')
} else if (cmd === 'approve-code') {
  // حاكِ ضغط «وافق» على صفحة ‏/device — التحديث المشروط نفسه الذي يفعله المسار
  const res = db
    .prepare(
      "UPDATE device_codes SET status = 'approved', user_id = 'u_itqan_itest' WHERE user_code = ? AND status = 'pending'",
    )
    .run(arg)
  console.log(String(res.changes))
} else if (cmd === 'count-guide') {
  const row = db.prepare('SELECT COUNT(*) AS n FROM guides WHERE id = ?').get(arg)
  console.log(String(row.n))
} else if (cmd === 'clear-device-tokens') {
  // «إبطال الجهاز من الويب» — كل رموز قاعدة الاختبار المؤقّتة
  db.prepare('DELETE FROM device_tokens').run()
  console.log('cleared')
} else if (cmd === 'count-file') {
  const row = db.prepare('SELECT COUNT(*) AS n FROM files WHERE id = ?').get(arg)
  console.log(String(row.n))
} else {
  console.error(`أمر غير معروف: ${JSON.stringify({ cmd, dbPath, arg })}`)
  process.exit(1)
}
