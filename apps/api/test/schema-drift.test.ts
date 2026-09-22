import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTableConfig, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client'
import * as schema from '../src/db/schema'

const tmpDirs: string[] = []
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
})

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-drift-'))
  tmpDirs.push(d)
  return d
}

/** أعمدة الجدول كما تراها قاعدة حيّة بعد bootstrap + كل الترحيلات */
function liveColumns(sqlite: ReturnType<typeof createDb>['sqlite'], table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((r) => r.name))
}

/** كل جداول drizzle المصدَّرة من schema.ts — نكتشفها آليًا فلا يُنسى جدول جديد */
function declaredTables(): Array<{ name: string; columns: Set<string> }> {
  const out: Array<{ name: string; columns: Set<string> }> = []
  for (const value of Object.values(schema)) {
    let cfg: ReturnType<typeof getTableConfig>
    try {
      cfg = getTableConfig(value as never)
    } catch {
      continue // ليس جدول drizzle
    }
    out.push({ name: cfg.name, columns: new Set(cfg.columns.map((c) => c.name)) })
  }
  return out
}

/**
 * schema.ts يصرّح بأنه «مرآة الأنواع لجداول BOOTSTRAP_SQL» — لا شيء يفرض المطابقة.
 * هذا الحارس يفرضها: أي عمود يُضاف لأحدهما دون الآخر يُسقط السويت فورًا.
 */
describe('انحراف السكيمة: drizzle ↔ DDL الحيّ', () => {
  it('كل جدول مصرَّح في schema.ts موجود فعلًا بنفس مجموعة الأعمدة', () => {
    const dir = tmpDir()
    const { sqlite } = createDb(dir)
    const tables = declaredTables()
    expect(tables.length).toBeGreaterThan(10) // اكتشاف فعلي لا قائمة فارغة تدّعي النجاح

    for (const t of tables) {
      const live = liveColumns(sqlite, t.name)
      expect(live.size, `الجدول ${t.name} غير موجود في القاعدة الحيّة`).toBeGreaterThan(0)

      const missingInDb = [...t.columns].filter((c) => !live.has(c))
      expect(missingInDb, `أعمدة في schema.ts وغائبة عن القاعدة: ${t.name}`).toEqual([])

      const missingInSchema = [...live].filter((c) => !t.columns.has(c))
      expect(missingInSchema, `أعمدة في القاعدة وغائبة عن schema.ts: ${t.name}`).toEqual([])
    }
    sqlite.close()
  })

  it('الحارس نفسه يعمل: جدول مصطنع بعمود وهمي يُكتشف', () => {
    // بلا هذا الاختبار قد يمرّ الحارس الأول لأنه لا يفحص شيئًا أصلًا
    const ghost = sqliteTable('guides', { id: text('id').primaryKey(), ghost_col: text('ghost_col') })
    const cfg = getTableConfig(ghost)
    const dir = tmpDir()
    const { sqlite } = createDb(dir)
    const live = liveColumns(sqlite, cfg.name)
    const missingInDb = cfg.columns.map((c) => c.name).filter((c) => !live.has(c))
    expect(missingInDb).toEqual(['ghost_col'])
    sqlite.close()
  })
})
