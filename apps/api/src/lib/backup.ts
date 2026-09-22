import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * OPS-04: نسخ احتياطي واستعادة لكل بيانات دليلي — القاعدة وملفات اللقطات معًا.
 * القانون: النسخ عبر واجهة النسخ الآمنة في SQLite (تعامل صحيح مع WAL)، لا نسخ ملف خام.
 * الاستعادة ترفض النسخة الناقصة قبل أن تمس أي شيء.
 */

export interface BackupDeps {
  dbPath: string
  filesDir: string
  backupsDir: string
  now?: Date
}

/** بصمة مجلد النسخة: YYYYMMDD-HHMMSS بتوقيت الخادم المحلي (ترتيج أبجدي = ترتيب زمني) */
export function stampNow(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

/**
 * نسخة كاملة: dalili.db (آمنة ضد WAL) + files/ كاملة.
 * تعيد مسار مجلد النسخة الجديد. (async: واجهة backup في better-sqlite3 وعدية)
 */
export async function makeBackup(deps: BackupDeps): Promise<string> {
  const stamp = stampNow(deps.now ?? new Date())
  const backupDir = path.join(deps.backupsDir, stamp)
  fs.mkdirSync(path.join(backupDir, 'files'), { recursive: true })

  // اتصال قراءة جديد + .backup(): لقطة معاملات متسقة حتى والخدمة تعمل
  const src = new Database(deps.dbPath, { readonly: true })
  try {
    await src.backup(path.join(backupDir, 'dalili.db'))
  } finally {
    src.close()
  }

  if (fs.existsSync(deps.filesDir)) {
    fs.cpSync(deps.filesDir, path.join(backupDir, 'files'), { recursive: true })
  }
  return backupDir
}

/** أسماء النسخ التي تتجاوز حدّ الإبقاء (الأقدم) — المُمرِّرة مرتّبة تصاعديًا */
export function pruneBackups(names: string[], keep: number): string[] {
  if (keep < 0) return []
  return names.slice(0, Math.max(0, names.length - keep))
}

/**
 * استعادة كاملة فوق مجلد البيانات. تشترط توقف الخدمة أولًا (المسؤولية على المستدعي —
 * السكربت يوثّق ذلك). تتحقق من اكتمال النسخة قبل أي كتابة.
 */
export function restoreBackup({ backupDir, dataDir }: { backupDir: string; dataDir: string }): void {
  const dbFile = path.join(backupDir, 'dalili.db')
  if (!fs.existsSync(dbFile)) {
    throw new Error('النسخة الاحتياطية ناقصة — لا يوجد ملف قاعدة (dalili.db) فيها')
  }
  fs.mkdirSync(dataDir, { recursive: true })
  // إزالة بقايا WAL/SHM القديمة قبل وضع القاعدة المستعادة
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(path.join(dataDir, `dalili.db${suffix}`), { force: true })
  }
  fs.copyFileSync(dbFile, path.join(dataDir, 'dalili.db'))

  const filesSrc = path.join(backupDir, 'files')
  const filesDst = path.join(dataDir, 'files')
  fs.rmSync(filesDst, { recursive: true, force: true })
  if (fs.existsSync(filesSrc)) {
    fs.cpSync(filesSrc, filesDst, { recursive: true })
  }
}
