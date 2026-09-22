import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client'
import { listMigrations } from '../src/db/migrations'

const tmpDirs: string[] = []
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
})

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dalili-mig-'))
  tmpDirs.push(d)
  return d
}

/** OPS-03: ترحيلات مرقمة تُطبَّق مرة واحدة وتُسجَّل — بديلًا عن منطق مبعثر */
describe('الترحيلات (OPS-03)', () => {
  it('قاعدة جديدة: كل الترحيلات مطبقة ومسجلة في _migrations', () => {
    const dir = tmpDir()
    const { sqlite } = createDb(dir)
    const rows = sqlite.prepare('SELECT id, name FROM _migrations ORDER BY id').all() as { id: string; name: string }[]
    expect(rows.map((r) => r.id)).toEqual(listMigrations().map((m) => m.id))
    expect(rows.length).toBeGreaterThan(1) // ترحيلات فعلية لا قائمة فارغة تدّعي النجاح
    // السكيمة كاملة الاستخدام: جدول folders وأعمدة المكتبة موجودة
    const cols = new Set((sqlite.prepare('PRAGMA table_info(guides)').all() as { name: string }[]).map((c) => c.name))
    expect(cols.has('folder_id')).toBe(true)
    expect(cols.has('deleted_at')).toBe(true)
    sqlite.close()
  })

  it('الإقلاع الثاني لا يعيد تطبيق شيئًا — التسجيل يمنع التكرار', () => {
    const dir = tmpDir()
    const first = createDb(dir)
    const recordedFirst = (first.sqlite.prepare('SELECT count(*) AS c FROM _migrations').get() as { c: number }).c
    const appliedAt = first.sqlite.prepare('SELECT id, applied_at FROM _migrations ORDER BY id').all() as { id: string; applied_at: string }[]
    first.sqlite.close()

    const second = createDb(dir)
    const recordedSecond = (second.sqlite.prepare('SELECT count(*) AS c FROM _migrations').get() as { c: number }).c
    const appliedAt2 = second.sqlite.prepare('SELECT id, applied_at FROM _migrations ORDER BY id').all() as { id: string; applied_at: string }[]
    expect(recordedSecond).toBe(recordedFirst)
    expect(appliedAt2).toEqual(appliedAt) // الطوابع نفسها = لم يُعفَّل شيء مجددًا
    second.sqlite.close()
  })

  it('قاعدة قديمة (قبل عائلة LIB): الترقية التراكمية تضيف الأعمدة وتسجّل كل شيء', () => {
    const dir = tmpDir()
    // نبني قاعدة بالسكيمة القديمة يدويًا (بلا مجلدات/نجمة/وسوم/سلة/عدّاد مشاهدات)
    const legacy = new Database(path.join(dir, 'dalili.db'))
    legacy.pragma('journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE guides (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'old@dalili.sa', 'hash', '2026-01-01T00:00:00Z');
      INSERT INTO workspaces VALUES ('w1', 'مساحتي', 'u1', '2026-01-01T00:00:00Z');
      INSERT INTO guides VALUES ('g1', 'w1', 'u1', 'دليل قديم', '{"id":"g1","steps":[{"a":1},{"b":2}]}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `)
    legacy.close()

    const { sqlite } = createDb(dir)
    const cols = new Set((sqlite.prepare('PRAGMA table_info(guides)').all() as { name: string }[]).map((c) => c.name))
    for (const c of ['step_count', 'thumb_file_id', 'folder_id', 'starred', 'tags', 'deleted_at']) {
      expect(cols.has(c), `عمود ${c} مفقود بعد الترقية`).toBe(true)
    }
    // الأعمدة المشتقة حُسبت من البيانات القائمة (2 خطوة)
    const sc = sqlite.prepare("SELECT step_count FROM guides WHERE id = 'g1'").get() as { step_count: number }
    expect(sc.step_count).toBe(2)
    const recorded = (sqlite.prepare('SELECT count(*) AS c FROM _migrations').get() as { c: number }).c
    expect(recorded).toBe(listMigrations().length)
    sqlite.close()
  })

  it('ترحيل 0015 (BKL-01): عمود kind يُضاف والأدلة القائمة تأخذ guide بلا لمس محتواها', () => {
    const dir = tmpDir()
    const legacy = new Database(path.join(dir, 'dalili.db'))
    legacy.pragma('journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE guides (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'k@dalili.sa', 'hash', '2026-01-01T00:00:00Z');
      INSERT INTO workspaces VALUES ('w1', 'مساحتي', 'u1', '2026-01-01T00:00:00Z');
      INSERT INTO guides VALUES ('g1', 'w1', 'u1', 'دليل قائم', '{"id":"g1","title":"دليل قائم","steps":[]}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `)
    legacy.close()

    const { sqlite } = createDb(dir)
    const cols = new Set((sqlite.prepare('PRAGMA table_info(guides)').all() as { name: string }[]).map((c) => c.name))
    expect(cols.has('kind'), 'عمود kind مفقود بعد الترقية').toBe(true)
    const row = sqlite.prepare("SELECT kind, data FROM guides WHERE id = 'g1'").get() as { kind: string; data: string }
    expect(row.kind).toBe('guide')
    // التوسيع جمعي: محتوى الدليل القائم لم يُلمس
    expect(JSON.parse(row.data).title).toBe('دليل قائم')
    sqlite.close()
  })

  it('ترحيل 0008 (الأساس الخفي للمساحة): أدوار member→creator + backfill الموقع + جداول الدعوات والبوكمارك + عمودا visibility/site', () => {
    const dir = tmpDir()
    const legacy = new Database(path.join(dir, 'dalili.db'))
    legacy.pragma('journal_mode = WAL')
    // نبني قاعدة «حية قبل 0008»: كل الترحيلات ما عدا 0008 و0009 (الشفاء يعتمد أعمدة 0008) و0010 (بعدها)
    legacy
      .prepare('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
      .run()
    for (const m of listMigrations().filter((x) => !['0008', '0009', '0010'].includes(x.id))) {
      legacy.transaction(() => {
        m.up(legacy)
        legacy.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, new Date().toISOString())
      })()
    }
    // بيانات قبلية: عضو بدور member القديم + دليل أول خطوته لها رابط بلا site
    legacy.exec(`
      INSERT INTO users (id, email, password_hash, created_at) VALUES ('u8', 'old8@dalili.sa', 'hash', '2026-01-01T00:00:00Z');
      INSERT INTO workspaces VALUES ('w8', 'مساحة 0008', 'u8', '2026-01-01T00:00:00Z');
      INSERT INTO workspace_members VALUES ('w8', 'u8', 'member', '');
      INSERT INTO guides (id, workspace_id, user_id, title, data, created_at, updated_at)
        VALUES ('g8', 'w8', 'u8', 'دليل 0008', '{"id":"g8","steps":[{"url":"https://www.SAP.example/fi_01"}]}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `)
    legacy.close()

    const { sqlite } = createDb(dir)
    // الدور القديم رُقّي — member لم يعد موجودًا
    const role = sqlite.prepare("SELECT role FROM workspace_members WHERE user_id = 'u8'").get() as { role: string }
    expect(role.role).toBe('creator')
    // الموقع مشتق من أول خطوة بمضيف نظيف بلا www
    const site = sqlite.prepare("SELECT site, visibility FROM guides WHERE id = 'g8'").get() as { site: string; visibility: string }
    expect(site.site).toBe('sap.example')
    expect(site.visibility).toBe('private')
    // الجداول والأعمدة الجديدة قائمة
    const guideCols = new Set((sqlite.prepare('PRAGMA table_info(guides)').all() as { name: string }[]).map((c) => c.name))
    expect(guideCols.has('visibility')).toBe(true)
    expect(guideCols.has('site')).toBe(true)
    const tables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
    )
    expect(tables.has('invites')).toBe(true)
    expect(tables.has('bookmarks')).toBe(true)
    sqlite.close()
  })

  it('ترحيل 0009 (شفاء الموقع): دليل فاته الـbackfill الأول يُملأ عند الإقلاع', () => {
    const dir = tmpDir()
    const legacy = new Database(path.join(dir, 'dalili.db'))
    legacy.pragma('journal_mode = WAL')
    legacy
      .prepare('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
      .run()
    // قاعدة عند «حالة 0008»: كل الترحيلات حتى 0008 — ودليل رابطه موجود وموقعه فارغ (ضحية العلّة الحية)
    for (const m of listMigrations().filter((x) => x.id !== '0009')) {
      legacy.transaction(() => {
        m.up(legacy)
        legacy.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, new Date().toISOString())
      })()
    }
    legacy
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u9', 'old9@dalili.sa', 'hash', '2026-01-01T00:00:00Z')")
      .run()
    legacy
      .prepare("INSERT INTO workspaces VALUES ('w9', 'مساحة 0009', 'u9', '2026-01-01T00:00:00Z')")
      .run()
    legacy
      .prepare(
        "INSERT INTO guides (id, workspace_id, user_id, title, data, site, visibility, created_at, updated_at) VALUES ('g9', 'w9', 'u9', 'دليل 0009', ?, '', 'private', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      )
      .run(JSON.stringify({ id: 'g9', steps: [{ url: 'https://crm.example/leads' }] }))
    legacy.close()

    const { sqlite } = createDb(dir)
    const site = sqlite.prepare("SELECT site FROM guides WHERE id = 'g9'").get() as { site: string }
    expect(site.site).toBe('crm.example')
    sqlite.close()
  })
})

/** VER-01: ترحيل 0016 — جدول guide_versions + الفهرس المركّب */
describe('ترحيل 0016: guide_versions', () => {
  it('يُنشئ الجدول والفهرس', () => {
    const dir = tmpDir()
    const { sqlite } = createDb(dir)
    const row = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guide_versions'")
      .get() as { name: string } | undefined
    expect(row?.name).toBe('guide_versions')
    const idx = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_guide_versions_guide_created'")
      .get() as { name: string } | undefined
    expect(idx?.name).toBe('idx_guide_versions_guide_created')
    // الأعمدة السبعة كلها موجودة
    const cols = new Set(
      (sqlite.prepare('PRAGMA table_info(guide_versions)').all() as { name: string }[]).map((c) => c.name),
    )
    for (const c of ['id', 'guide_id', 'author_id', 'title', 'data', 'step_count', 'created_at']) {
      expect(cols.has(c), `عمود مفقود: ${c}`).toBe(true)
    }
    sqlite.close()
  })

  it('السطر يعلن REFERENCES … ON DELETE CASCADE', () => {
    // نقرأ SQL التعريف نفسه — أرخص وأصدق من إعادة توليد صف workspace كامل
    const dir = tmpDir()
    const { sqlite } = createDb(dir)
    const def = (sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='guide_versions'")
      .get() as { sql: string }).sql
    expect(def).toMatch(/REFERENCES\s+guides\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i)
    sqlite.close()
  })
})
