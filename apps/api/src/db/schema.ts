import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** مرآة الأنواع لجداول BOOTSTRAP_SQL — الاستعلامات عبر drizzle، الإنشاء عبر الـDDL */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  /** مزامنة الثيم (0014): 'brand' | 'classic' — يقرؤه الموقع والامتداد عند الإقلاع */
  theme: text('theme').notNull().default('brand'),
  /** مزامنة اللغة (0020 I18N-01): 'ar' | 'en' — مرآة الثيم */
  locale: text('locale').notNull().default('ar'),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
})

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const workspaceMembers = sqliteTable('workspace_members', {
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),
  department: text('department').notNull().default(''),
  /** المرحلة د (ترحيل 0010): فريق العضو — كيان بدل «القسم» الحر؛ الحذف يعيده بلا فريق */
  teamId: text('team_id'),
})

/** المرحلة د (WS-08 — ترحيل 0010): فرق المساحة — «القسم» الحر رُقّي إلى كيان */
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
})

export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: text('created_at').notNull(),
})

export const guides = sqliteTable('guides', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  data: text('data').notNull(),
  /** عمودان مشتقان (PERF-05): القوائم لا تفكّ JSON الكامل أبدًا */
  stepCount: integer('step_count').notNull().default(0),
  thumbFileId: text('thumb_file_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** LIB-02..06: تنظيم المكتبة */
  folderId: text('folder_id'),
  starred: integer('starred').notNull().default(0),
  tags: text('tags').notNull().default('[]'),
  deletedAt: text('deleted_at'),
  /** WS-02 (ترحيل 0008): خاص افتراضيًا — «workspace» بعد نشر صريح يراه أعضاء المساحة */
  visibility: text('visibility').notNull().default('private'),
  /** WS-05 (ترحيل 0008): موقع مشتق من أول خطوة — صغير بلا www؛ الترشيح بلا فكّ JSON */
  site: text('site').notNull().default(''),
  /** BKL-01 (ترحيل 0015): نوع المستند عمودًا مشتقًا — القوائم ترشّح بلا فكّ JSON (قانون PERF-05) */
  kind: text('kind').notNull().default('guide'),
})

/** WS-01 (ترحيل 0008): دعوات برابط يُرسل واتساب — بلا SMTP */
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull(),
  acceptedAt: text('accepted_at'),
})

/** WS-04 (ترحيل 0008): بوكمارك لكل عضو — منفصل عن نجمة المنشئ LIB-03 */
export const bookmarks = sqliteTable('bookmarks', {
  userId: text('user_id').notNull(),
  guideId: text('guide_id')
    .notNull()
    .references(() => guides.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
})

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  /** المرحلة هـ (ترحيل 0011): المجلدات مساحية — userId يبقى صانعها للتاريخ */
  workspaceId: text('workspace_id'),
})

export const shares = sqliteTable('shares', {
  guideId: text('guide_id').primaryKey(),
  token: text('token').notNull(),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
  /** VIEW-06: عدّاد مشاهدات مجمّع — لا تعقّب أفراد، رقم واحد فقط */
  views: integer('views').notNull().default(0),
})

/** GM-05: تعليقات الخطوات — الضيف برابط المشاركة والمالك من المحرر في جدول واحد */
export const stepComments = sqliteTable('step_comments', {
  id: text('id').primaryKey(),
  guideId: text('guide_id')
    .notNull()
    .references(() => guides.id, { onDelete: 'cascade' }),
  /** '' = تعليق على مستوى الدليل (الجديد)؛ غيره تعليق قديم مرتبط بخطوة */
  stepId: text('step_id').notNull(),
  /** GM-05 تطوّر: نوع التعليق — 'issue' مشكلة تحتاج إصلاحًا أو 'note' تعليق عام */
  kind: text('kind').notNull().default('note'),
  /** null = تعليق أصلي؛ غيره رد على ذلك الأصل (عمق واحد) */
  parentId: text('parent_id'),
  author: text('author').notNull().default(''),
  isOwner: integer('is_owner').notNull().default(0),
  body: text('body').notNull(),
  resolved: integer('resolved').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** VER-01 (ترحيل 0016): سجل إصدارات الدليل — لقطة JSON كاملة عند «تم» بإسقاط
 *  تكرار متجاور. cascade على حذف الدليل النهائي، وفهرس (guide_id, created_at DESC)
 *  يخدم القائمة بلا فكّ JSON (قانون PERF-05). */
export const guideVersions = sqliteTable('guide_versions', {
  id: text('id').primaryKey(),
  guideId: text('guide_id')
    .notNull()
    .references(() => guides.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull(),
  title: text('title').notNull(),
  data: text('data').notNull(),
  stepCount: integer('step_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

/** ASG-01 (ترحيل 0017): إسناد دليل/كرّاسة لشخص/فريق/مساحة — العضوية تُحلّ حيًّا */
export const assignments = sqliteTable('assignments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  guideId: text('guide_id').notNull(),
  assignerId: text('assigner_id').notNull(),
  /** 'user' | 'team' | 'workspace' */
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id').notNull(),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
})

/** ASG-01: تقدّم كل مُسنَد إليه — صفّ كسول عند أول فتح أو «تمّ» */
export const assignmentProgress = sqliteTable('assignment_progress', {
  assignmentId: text('assignment_id').notNull(),
  userId: text('user_id').notNull(),
  openedAt: text('opened_at'),
  doneAt: text('done_at'),
})

/** DTOP-02 (ترحيل 0018): مفاتيح عدم التكرار — إعادة الطلب نفسه تعيد الردّ نفسه لا نسخة ثانية.
 *  المفتاح الأساسي المركّب (user_id, key) في الـDDL. status = 0 ⇐ محجوز قيد التنفيذ بلا ردّ بعد */
export const idempotencyKeys = sqliteTable('idempotency_keys', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  route: text('route').notNull(),
  status: integer('status').notNull(),
  response: text('response').notNull(),
  createdAt: text('created_at').notNull(),
})

/** DTOP-03 (ترحيل 0019): رموز الأجهزة — Bearer بجانب الكوكي. نخزّن بصمة sha256 لا الرمز */
export const deviceTokens = sqliteTable('device_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  deviceName: text('device_name').notNull(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at').notNull(),
})

/** DTOP-03 (ترحيل 0019): رموز الاقتران المؤقّتة (١٠ دقائق) — تُستهلك مرّة واحدة */
export const deviceCodes = sqliteTable('device_codes', {
  deviceCodeHash: text('device_code_hash').primaryKey(),
  userCode: text('user_code').notNull().unique(),
  deviceName: text('device_name').notNull(),
  /** 'pending' | 'approved' | 'denied' */
  status: text('status').notNull(),
  userId: text('user_id'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})
