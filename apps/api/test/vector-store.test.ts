import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import { vectorToBytes } from '@dalili/core'
import { makeSqliteVectorStore } from '../src/embeddings/vector-store'

/**
 * SRCH-06 تحسين — واجهة VectorStore: سلوك النطاق نفسه الذي كان مكتوبًا داخل
 * runSemanticSearch (ملك المستخدم + منشور مساحته لا غير)، والرفع/الحذف ينعكسان
 * في الجدول حرفيًا. تغيير سلوك صفر — هذا اختبار استخلاص لا ميزة جديدة.
 */

const NOW = new Date().toISOString()
const V = new Float32Array([1, 0])

function makeBareDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-vstore-'))
  const db = new Database(path.join(dir, 'test.db'))
  db.exec(`
    CREATE TABLE guides (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
      title TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private', deleted_at TEXT
    );
    CREATE TABLE guide_embeddings (
      guide_id TEXT PRIMARY KEY REFERENCES guides(id) ON DELETE CASCADE,
      model TEXT NOT NULL, source_hash TEXT NOT NULL, dim INTEGER NOT NULL,
      vector BLOB NOT NULL, updated_at TEXT NOT NULL
    );
  `)
  afterAll(() => db.close())
  return db
}

function seedGuide(db: Database.Database, id: string, userId: string, wsId: string, visibility: string, deletedAt: string | null = null): void {
  db.prepare(
    `INSERT INTO guides (id, workspace_id, user_id, title, data, created_at, updated_at, visibility, deleted_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
  ).run(id, wsId, userId, id, NOW, NOW, visibility, deletedAt)
  db.prepare(
    'INSERT INTO guide_embeddings (guide_id, model, source_hash, dim, vector, updated_at) VALUES (?, ?, ?, 2, ?, ?)',
  ).run(id, 'm1', 'h1', vectorToBytes(V), NOW)
}

describe('VectorStore — واجهة التخزين المستخلصة (سلوك مطابق حرفيًا)', () => {
  it('query بالنطاق المساحي يعيد الملكي والمنشور للمساحة لا مسحة الغير', async () => {
    const db = makeBareDb()
    seedGuide(db, 'own', 'u1', 'w1', 'private')
    seedGuide(db, 'pub', 'u2', 'w1', 'workspace')
    seedGuide(db, 'foreign', 'u2', 'w2', 'private')
    const store = makeSqliteVectorStore(db)
    const hits = await store.query(V, { userId: 'u1', workspaceId: 'w1' })
    expect(new Set(hits.map((h) => h.guideId))).toEqual(new Set(['own', 'pub']))
    expect(hits.every((h) => h.vector instanceof Float32Array)).toBe(true)
  })

  it('query بلا مساحة يعيد ملك المستخدم وحده', async () => {
    const db = makeBareDb()
    seedGuide(db, 'own', 'u1', 'w1', 'private')
    seedGuide(db, 'pub', 'u2', 'w1', 'workspace')
    const store = makeSqliteVectorStore(db)
    const hits = await store.query(V, { userId: 'u1' })
    expect(hits.map((h) => h.guideId)).toEqual(['own'])
  })

  it('الدليل المحذوف ناعمًا يختفي من query فورًا', async () => {
    const db = makeBareDb()
    seedGuide(db, 'own', 'u1', 'w1', 'private', NOW)
    const store = makeSqliteVectorStore(db)
    expect(await store.query(V, { userId: 'u1' })).toEqual([])
  })

  it('upsert يدرج ويحدّث (موديل وبصمة وبُعد جديدة) وremoveByGuide يمحو', async () => {
    const db = makeBareDb()
    seedGuide(db, 'own', 'u1', 'w1', 'private')
    const store = makeSqliteVectorStore(db)
    const fresh = new Float32Array([0, 1])
    await store.upsert('own', fresh, 'm2', 'h2')
    const row = db.prepare('SELECT model, source_hash, dim, vector FROM guide_embeddings WHERE guide_id = ?').get('own') as {
      model: string
      source_hash: string
      dim: number
      vector: Uint8Array
    }
    expect(row.model).toBe('m2')
    expect(row.source_hash).toBe('h2')
    expect(row.dim).toBe(2)
    expect(Buffer.from(row.vector).equals(Buffer.from(vectorToBytes(fresh)))).toBe(true)
    await store.removeByGuide('own')
    const left = (db.prepare('SELECT COUNT(*) AS c FROM guide_embeddings').get() as { c: number }).c
    expect(left).toBe(0)
  })
})
