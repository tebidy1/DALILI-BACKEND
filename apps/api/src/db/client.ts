import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import * as schema from './schema'
import { applyMigrations } from './migrations'
import { purgeExpiredTrash } from '../lib/trash'

/** نوع القاعدة الموحد لكل المسارات — المصدر الواحد يمنع اتحادات ملتوية وأكاذيب `as never` */
export type Db = BetterSQLite3Database<typeof schema>

export interface DbBundle {
  sqlite: Database.Database
  db: Db
  filesDir: string
}

export function createDb(dataDir: string): DbBundle {
  const filesDir = path.join(dataDir, 'files')
  fs.mkdirSync(filesDir, { recursive: true })
  const sqlite =
    dataDir === ':memory:' ? new Database(':memory:') : new Database(path.join(dataDir, 'dalili.db'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  // OPS-03: كل تغيّر سكيمة يمر من ترحيلات مرقمة مسجّلة في _migrations
  applyMigrations(sqlite)
  // صيانة إقلاع متكررة (ليست ترحيلًا): كنس سلة متقادمة 30 يومًا
  purgeExpiredTrash(sqlite)
  return { sqlite, db: drizzle(sqlite, { schema }), filesDir }
}
