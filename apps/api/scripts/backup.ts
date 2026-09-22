/**
 * OPS-04: نسخة احتياطية كاملة (قاعدة + لقطات) إلى data/backups/ مع تقليم الأقدم.
 * تشغيل:  node --import tsx scripts/backup.ts   (أو tsx scripts/backup.ts)
 * آمنة أثناء تشغيل الخدمة — نسخة SQLite الآمنة تتعامل مع WAL.
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv } from '../src/env'
import { makeBackup, pruneBackups } from '../src/lib/backup'

const KEEP = 14

const env = loadEnv()
if (env.dataDir === ':memory:') {
  console.error('DATA_DIR=:memory: — لا شيء على القرص لنسخه')
  process.exit(1)
}

const backupsDir = path.join(env.dataDir, 'backups')
const dir = await makeBackup({
  dbPath: path.join(env.dataDir, 'dalili.db'),
  filesDir: path.join(env.dataDir, 'files'),
  backupsDir,
})

// تقليم: أبقِ أحدث KEEP نسخة
const names = fs
  .readdirSync(backupsDir)
  .filter((n) => /^\d{8}-\d{6}$/.test(n))
  .sort()
for (const old of pruneBackups(names, KEEP)) {
  fs.rmSync(path.join(backupsDir, old), { recursive: true, force: true })
  console.log(`حُذفت النسخة القديمة: ${old}`)
}
console.log(`تمت النسخة الاحتياطية: ${dir}`)
