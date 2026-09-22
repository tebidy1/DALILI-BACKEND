import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { files } from '../db/schema'
import type { Db } from '../db/client'
import { derivativeId, type BurnSpec } from './burn'
import type { BurnPool } from './burn-pool'

/**
 * خصوصيّة ٢ب: المشتقّ المحروق — يُولَّد مرّة في خيط عامل ويُعاد معرّفه الحتميّ.
 * طلبان متزامنان لنفس المشتقّ (تسخين المشاركة + أوّل ضيف) يتشاركان وعدًا واحدًا.
 * null = تعذّر (مصدر مفقود، أو ليس JPEG، أو فشل الحرق) ⇐ اللقطة تُحجب لا يُكشف أصلها.
 */
export function createDerivatives(db: Db, filesDir: string, pool: BurnPool) {
  const inflight = new Map<string, Promise<string | null>>()

  async function generate(sourceId: string, id: string, spec: BurnSpec): Promise<string | null> {
    const src = db.select().from(files).where(eq(files.id, sourceId)).get()
    if (!src || src.mime !== 'image/jpeg') return null
    const srcPath = path.join(filesDir, path.basename(sourceId))
    if (!fs.existsSync(srcPath)) return null
    const outPath = path.join(filesDir, id)
    if (!(await pool.burn(srcPath, outPath, spec))) return null
    db.insert(files)
      .values({ id, userId: src.userId, mime: 'image/jpeg', bytes: fs.statSync(outPath).size, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run()
    return id
  }

  function ensure(sourceId: string, spec: BurnSpec): Promise<string | null> {
    const id = derivativeId(sourceId, spec)
    if (db.select({ id: files.id }).from(files).where(eq(files.id, id)).get()) return Promise.resolve(id)
    const running = inflight.get(id)
    if (running) return running
    const p = generate(sourceId, id, spec).finally(() => inflight.delete(id))
    inflight.set(id, p)
    return p
  }

  return { ensure }
}

export type Derivatives = ReturnType<typeof createDerivatives>
