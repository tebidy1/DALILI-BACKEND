import type Database from 'better-sqlite3'
import { BOOTSTRAP_SQL } from './bootstrap'
import { rebuildIndex } from '../search/index'

/**
 * OPS-03: ترحيلات مرقمة تُطبَّق مرة واحدة وتُسجَّل في _migrations —
 * بديلًا عن منطق ترقية مبعثر في createDb. كل ترحيل آمن التكرار داخليًا
 * (IF NOT EXISTS / فحص عمود قبل ALTER) لأن التسجيل نفسه هو حاجز التكرار.
 */

export interface Migration {
  id: string
  name: string
  up: (sqlite: Database.Database) => void
}

function hasColumn(sqlite: Database.Database, table: string, col: string): boolean {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some((c) => c.name === col)
}

function addColumn(sqlite: Database.Database, table: string, col: string, ddl: string): void {
  if (!hasColumn(sqlite, table, col)) sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`).run()
}

/**
 * نسخة v1 مجمَّدة من primarySiteOf — منسوخة حرفيًّا من packages/core/src/sites.ts
 * بتاريخ 2026-09-15. **لا تُعدَّل ولا تُستبدل باستيراد.**
 * السبب: الترحيلان 0008 و0009 سجلّ تاريخي؛ تعديل core لاحقًا (إعادة التسمية إلى
 * primarySourceOf وتوسيعه للديسكتوب والكاميرا) كان سيغيّر ناتجهما أثرًا رجعيًّا
 * على كل قاعدة تُنشأ من جديد.
 */
function frozenPrimarySiteOf(steps: Array<{ url?: string }>): string {
  for (const step of steps) {
    const raw = step.url?.trim()
    if (!raw) continue
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try {
      const host = new URL(candidate).hostname.toLowerCase().replace(/^www\./, '')
      if (host && (host.includes('.') || host === 'localhost' || host === '127.0.0.1')) return host
    } catch {
      // رابط تالف — المحاولة التالية
    }
  }
  return ''
}

/** backfill الموقع من أول خطوة لها رابط — يستعمله 0008 و0009 (فخ: عطب برمجي لحظة 0008
 *  ابتلعه catch «البيانات التالفة» الواسع فمرّ الترحيل بلا ملء؛ 0009 هو الشفاء المضمون) */
function backfillGuideSites(sqlite: Database.Database): void {
  const pending = sqlite.prepare("SELECT id, data FROM guides WHERE site = ''").all() as {
    id: string
    data: string
  }[]
  if (pending.length === 0) return
  const update = sqlite.prepare('UPDATE guides SET site = ? WHERE id = ?')
  for (const r of pending) {
    try {
      const g = JSON.parse(r.data) as { steps?: Array<{ url?: string }> }
      const site = frozenPrimarySiteOf(g.steps ?? [])
      if (site) update.run(site, r.id)
    } catch {
      // بيانات تالفة تبقى كما هي — لا تُسقط الترحيل
    }
  }
}

export function listMigrations(): Migration[] {
  return [
    {
      id: '0001',
      name: 'init-schema',
      up: (sqlite) => {
        for (const stmt of BOOTSTRAP_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
          sqlite.prepare(stmt).run()
        }
      },
    },
    {
      id: '0002',
      name: 'library-columns',
      up: (sqlite) => {
        addColumn(sqlite, 'guides', 'step_count', 'INTEGER NOT NULL DEFAULT 0')
        addColumn(sqlite, 'guides', 'thumb_file_id', 'TEXT')
        addColumn(sqlite, 'guides', 'folder_id', 'TEXT')
        addColumn(sqlite, 'guides', 'starred', 'INTEGER NOT NULL DEFAULT 0')
        addColumn(sqlite, 'guides', 'tags', "TEXT NOT NULL DEFAULT '[]'")
        addColumn(sqlite, 'guides', 'deleted_at', 'TEXT')
        addColumn(sqlite, 'shares', 'views', 'INTEGER NOT NULL DEFAULT 0')
      },
    },
    {
      id: '0003',
      name: 'backfill-step-count',
      up: (sqlite) => {
        const zeroCount = (
          sqlite.prepare('SELECT count(*) AS c FROM guides WHERE step_count = 0').get() as { c: number }
        ).c
        if (zeroCount === 0) return
        const rows = sqlite.prepare('SELECT id, data FROM guides').all() as { id: string; data: string }[]
        for (const r of rows) {
          try {
            const g = JSON.parse(r.data) as { steps?: unknown[] }
            sqlite.prepare('UPDATE guides SET step_count = ? WHERE id = ?').run(g.steps?.length ?? 0, r.id)
          } catch {
            // بيانات تالفة تبقى كما هي — لا تُسقط الترحيل
          }
        }
      },
    },
    {
      id: '0004',
      name: 'search-index-heal',
      up: (sqlite) => {
        const indexed = (sqlite.prepare('SELECT count(*) AS c FROM guide_index').get() as { c: number }).c
        const guides = (sqlite.prepare('SELECT count(*) AS c FROM guides').get() as { c: number }).c
        if (indexed === 0 && guides > 0) rebuildIndex(sqlite)
      },
    },
    {
      id: '0005',
      name: 'step-comments',
      up: (sqlite) => {
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS step_comments (
              id TEXT PRIMARY KEY,
              guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
              step_id TEXT NOT NULL,
              parent_id TEXT,
              author TEXT NOT NULL DEFAULT '',
              is_owner INTEGER NOT NULL DEFAULT 0,
              body TEXT NOT NULL,
              resolved INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )`,
          )
          .run()
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_step_comments_guide ON step_comments(guide_id)').run()
      },
    },
    {
      // SRCH-06: بصمات المعنى — متجه كل دليل بالبايتات، وموديله وبصمة نصّه لكشف الباطل
      id: '0006',
      name: 'guide-embeddings',
      up: (sqlite) => {
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS guide_embeddings (
              guide_id TEXT PRIMARY KEY REFERENCES guides(id) ON DELETE CASCADE,
              model TEXT NOT NULL,
              source_hash TEXT NOT NULL,
              dim INTEGER NOT NULL,
              vector BLOB NOT NULL,
              updated_at TEXT NOT NULL
            )`,
          )
          .run()
      },
    },
    {
      id: '0007',
      name: 'workspace-members-department',
      up: (sqlite) => {
        addColumn(sqlite, 'workspace_members', 'department', "TEXT NOT NULL DEFAULT ''")
      },
    },
    {
      // WS الأساس الخفي (قرار المالك 2026-09-03): خاص افتراضيًا + نشر صريح،
      // دعوات برابط يُرسل واتساب، بوكمارك لكل عضو، وموقع مشتق قابل للترشيح
      id: '0008',
      name: 'workspace-foundation',
      up: (sqlite) => {
        addColumn(sqlite, 'guides', 'visibility', "TEXT NOT NULL DEFAULT 'private'")
        addColumn(sqlite, 'guides', 'site', "TEXT NOT NULL DEFAULT ''")
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS invites (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              email TEXT NOT NULL,
              role TEXT NOT NULL,
              token TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              accepted_at TEXT
            )`,
          )
          .run()
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_invites_workspace ON invites(workspace_id)').run()
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS bookmarks (
              user_id TEXT NOT NULL,
              guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              PRIMARY KEY (user_id, guide_id)
            )`,
          )
          .run()
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)').run()
        // الأدوار الثلاثة: member القديم = منشئ (أوسع دور غير إداري — ترقية آمنة)
        sqlite.prepare("UPDATE workspace_members SET role = 'creator' WHERE role = 'member'").run()
        // backfill الموقع — الشفاء الجاري ل0009 يضمن الاكتمال إن تعطّل هنا
        backfillGuideSites(sqlite)
      },
    },
    {
      // شفاء: 0008 طُبّق لحظة كانت فيها primarySiteOf بلا استيراد فابتلعه catch
      // «البيانات التالفة» — أعِد الملء لمن بقي بلا موقع (idempotent بطبيعته)
      id: '0009',
      name: 'guide-site-backfill-heal',
      up: (sqlite) => {
        backfillGuideSites(sqlite)
      },
    },
    {
      // المرحلة د (WS-08): «القسم» الحر يصير كيان فريق — وأعضاء بأقسام موجودة يُجمَّعون
      // تلقائيًا تحت فرق بأسمائها داخل نفس المساحة (ترقية بلا فقد، وdepartment يبقى للتاريخ)
      id: '0010',
      name: 'teams-entity',
      up: (sqlite) => {
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS teams (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            )`,
          )
          .run()
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id)').run()
        addColumn(sqlite, 'workspace_members', 'team_id', 'TEXT')
        const rows = sqlite
          .prepare("SELECT workspace_id, department FROM workspace_members WHERE department <> ''")
          .all() as { workspace_id: string; department: string }[]
        const teamIdByWsName = new Map<string, string>()
        for (const r of rows) {
          const key = `${r.workspace_id}::${r.department}`
          let teamId = teamIdByWsName.get(key)
          if (!teamId) {
            teamId = 'tm' + Math.random().toString(36).slice(2, 12)
            sqlite
              .prepare('INSERT INTO teams (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)')
              .run(teamId, r.workspace_id, r.department, new Date().toISOString())
            teamIdByWsName.set(key, teamId)
          }
          sqlite
            .prepare('UPDATE workspace_members SET team_id = ? WHERE workspace_id = ? AND department = ?')
            .run(teamId, r.workspace_id, r.department)
        }
      },
    },
    {
      // المرحلة هـ: المجلدات من شخصية إلى **مساحية** — كل مجلد قديم يلحق بمساحة صانعه
      // (workspace_members ضمانة لكل مستخدم بعد أ) فلا مجلد يتيم، وuserId يبقى صانعه
      id: '0011',
      name: 'folders-workspace',
      up: (sqlite) => {
        addColumn(sqlite, 'folders', 'workspace_id', 'TEXT')
        sqlite
          .prepare(
            `UPDATE folders SET workspace_id = COALESCE(
               (SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = folders.user_id LIMIT 1), '')`,
          )
          .run()
      },
    },
    {
      // GM-05 تطوّر: نوع التعليق (مشكلة/تعليق) على مستوى الدليل — التعليقات القديمة
      // تصير 'note' بالافتراض بلا حذف (قانون التوسيع الجمعي §5.5)
      id: '0012',
      name: 'comment-kind',
      up: (sqlite) => {
        addColumn(sqlite, 'step_comments', 'kind', "TEXT NOT NULL DEFAULT 'note'")
      },
    },
    {
      // SRCH-04 تطوّر: الفهرس صار يخزّن رموز الاستعلام والـhash (اكتشاف الشاشات الفرعية) —
      // إعادة بناء الفهرس كي تحمل الأدلة القائمة رموز شاشاتها (نمط 0004)
      id: '0013',
      name: 'discover-screen-reindex',
      up: (sqlite) => {
        const guides = (sqlite.prepare('SELECT count(*) AS c FROM guides').get() as { c: number }).c
        if (guides > 0) rebuildIndex(sqlite)
      },
    },
    {
      // مزامنة الثيم (2026-09-06): الخيار على الخادم لكل مستخدم — الموقع والامتداد يتبعانه
      id: '0014',
      name: 'user-theme',
      up: (sqlite) => {
        addColumn(sqlite, 'users', 'theme', "TEXT NOT NULL DEFAULT 'brand'")
      },
    },
    {
      // BKL-01: نوع المستند عمودًا مشتقًا (guide | booklet) — القوائم ترشّح وتميّز
      // بلا فكّ JSON (قانون PERF-05). الأدلة القائمة تأخذ الافتراضي 'guide' بلا
      // لمس محتواها (قانون التوسيع الجمعي §5.5).
      id: '0015',
      name: 'guide-kind',
      up: (sqlite) => {
        addColumn(sqlite, 'guides', 'kind', "TEXT NOT NULL DEFAULT 'guide'")
      },
    },
    {
      // VER-01: سجل إصدارات الدليل — لقطة JSON كاملة عند «تم» بإسقاط تكرار
      // متجاور. cascade على حذف الدليل النهائي (يبقى مع السلة الناعمة).
      // الفهرس المركّب (guide_id, created_at DESC) يخدم القائمة بلا فكّ JSON.
      id: '0016',
      name: 'guide-versions',
      up: (sqlite) => {
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS guide_versions (
               id           TEXT PRIMARY KEY,
               guide_id     TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
               author_id    TEXT NOT NULL,
               title        TEXT NOT NULL,
               data         TEXT NOT NULL,
               step_count   INTEGER NOT NULL DEFAULT 0,
               created_at   TEXT NOT NULL
             )`,
          )
          .run()
        sqlite
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_guide_versions_guide_created
               ON guide_versions (guide_id, created_at DESC)`,
          )
          .run()
      },
    },
    {
      // ASG-01 (ترحيل 0017): الإسناد — جدول الإسنادات وجدول تقدّم كل مُسنَد إليه.
      // مستقلّان عن JSON الدليل؛ العضوية تُحلّ حيًّا فلا صف تقدّم مسبق (كسول).
      id: '0017',
      name: 'assignments',
      up: (sqlite) => {
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS assignments (
               id           TEXT PRIMARY KEY,
               workspace_id TEXT NOT NULL,
               guide_id     TEXT NOT NULL,
               assigner_id  TEXT NOT NULL,
               target_kind  TEXT NOT NULL,
               target_id    TEXT NOT NULL,
               note         TEXT NOT NULL DEFAULT '',
               created_at   TEXT NOT NULL
             )`,
          )
          .run()
        sqlite
          .prepare('CREATE INDEX IF NOT EXISTS idx_assignments_target ON assignments(workspace_id, target_kind, target_id)')
          .run()
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_assignments_guide ON assignments(guide_id)').run()
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS assignment_progress (
               assignment_id TEXT NOT NULL,
               user_id       TEXT NOT NULL,
               opened_at     TEXT,
               done_at       TEXT,
               PRIMARY KEY (assignment_id, user_id)
             )`,
          )
          .run()
      },
    },
    {
      // DTOP-02 (ترحيل 0018): عدم التكرار للرفع وإنشاء الدليل — مفتاح لكل مستخدم، يُكنس بعد ٧ أيام
      id: '0018',
      name: 'idempotency_keys',
      up: (sqlite) => {
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS idempotency_keys (
               user_id    TEXT NOT NULL,
               key        TEXT NOT NULL,
               route      TEXT NOT NULL,
               status     INTEGER NOT NULL,
               response   TEXT NOT NULL,
               created_at TEXT NOT NULL,
               PRIMARY KEY (user_id, key)
             )`,
          )
          .run()
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at)').run()
      },
    },
    {
      // DTOP-03 (ترحيل 0019): اقتران الأجهزة — رموز Bearer ببصمة، ورموز ربط مؤقّتة
      id: '0019',
      name: 'device_auth',
      up: (sqlite) => {
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS device_tokens (
               id           TEXT PRIMARY KEY,
               user_id      TEXT NOT NULL,
               token_hash   TEXT NOT NULL UNIQUE,
               device_name  TEXT NOT NULL,
               created_at   TEXT NOT NULL,
               last_used_at TEXT,
               expires_at   TEXT NOT NULL
             )`,
          )
          .run()
        sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id)').run()
        sqlite
          .prepare(
            `CREATE TABLE IF NOT EXISTS device_codes (
               device_code_hash TEXT PRIMARY KEY,
               user_code        TEXT NOT NULL UNIQUE,
               device_name      TEXT NOT NULL,
               status           TEXT NOT NULL,
               user_id          TEXT,
               created_at       TEXT NOT NULL,
               expires_at       TEXT NOT NULL
             )`,
          )
          .run()
      },
    },
  ]
}

/** يطبّق الترحيلات غير المسجلة فقط — كل واحد في معاملة مع تسجيله */
export function applyMigrations(sqlite: Database.Database): void {
  sqlite
    .prepare('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    .run()
  const done = new Set(
    (sqlite.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id),
  )
  for (const m of listMigrations()) {
    if (done.has(m.id)) continue
    sqlite.transaction(() => {
      m.up(sqlite)
      sqlite.prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        new Date().toISOString(),
      )
    })()
  }
}
