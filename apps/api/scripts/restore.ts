/**
 * OPS-04: استعادة نسخة احتياطية فوق مجلد البيانات.
 * تشغيل:  tsx scripts/restore.ts <مسار-مجلد-النسخة>
 * ⚠️ أوقف الخدمة أولًا:  sudo systemctl stop dalili-api
 */
import path from 'node:path'
import { loadEnv } from '../src/env'
import { restoreBackup } from '../src/lib/backup'

const backupDir = process.argv[2]
if (!backupDir) {
  console.error('الاستخدام: tsx scripts/restore.ts <مسار-مجلد-النسخة>')
  console.error('⚠️ أوقف الخدمة قبل الاستعادة: sudo systemctl stop dalili-api')
  process.exit(1)
}

const env = loadEnv()
if (env.dataDir === ':memory:') {
  console.error('DATA_DIR=:memory: — لا معنى للاستعادة هنا')
  process.exit(1)
}

restoreBackup({ backupDir: path.resolve(backupDir), dataDir: env.dataDir })
console.log(`استُعيدت النسخة ${backupDir} إلى ${env.dataDir} — أعد تشغيل الخدمة الآن`)
