import type Database from 'better-sqlite3'
import { normalizeForIndex, richToPlain, urlTokens } from '@dalili/core'
import type { GuideDto } from '@dalili/shared'

/**
 * صيانة فهرس FTS5 (SRCH-00) — تُستدعى حصرًا داخل نفس معاملة كتابة الدليل.
 * ممنوع: الفهرسة عند القراءة أو بمهمة دورية — الاتساق النهائي يعني بحثًا يكذب.
 */

export type IndexedField =
  | 'guide_title'
  | 'step_title'
  | 'note'
  | 'page_title'
  | 'url'
  | 'tag'

/** أوزان bm25 — عنوان الدليل أقوى إشارة، ثم عنوان الخطوة فالملاحظة فسياق الصفحة */
export const FIELD_WEIGHTS: Record<IndexedField, number> = {
  guide_title: 8.0,
  step_title: 5.0,
  note: 3.0,
  tag: 3.0,
  page_title: 1.5,
  url: 1.0,
}

/** ترتيب أعمدة الجدول الافتراضي للاختيار والإدخال */
const COLS = '(guide_id, step_id, step_no, field, norm_text, raw_text)'

interface IndexRow {
  guideId: string
  stepId: string | null
  stepNo: number | null
  field: IndexedField
  raw: string
}

/**
 * استخراج الحقول القابلة للفهرسة من دليل.
 * قاعدة خصوصية صلبة: step.value لا يُفهرس أبدًا — حساسًا كان أو عاديًا.
 */
function rowsOfGuide(guide: GuideDto, tags: string[]): IndexRow[] {
  const rows: IndexRow[] = [{ guideId: guide.id, stepId: null, stepNo: null, field: 'guide_title', raw: guide.title }]
  // LIB-03: الوسوم تدخل الفهرس — قابلة للبحث كأي نص آخر
  for (const tag of tags) {
    if (tag.trim()) rows.push({ guideId: guide.id, stepId: null, stepNo: null, field: 'tag', raw: tag })
  }
  guide.steps.forEach((s, i) => {
    if (s.title) rows.push({ guideId: guide.id, stepId: s.id, stepNo: i + 1, field: 'step_title', raw: s.title })
    if (s.note) rows.push({ guideId: guide.id, stepId: s.id, stepNo: i + 1, field: 'note', raw: s.note })
    // BKL-01: نص كتلة الكرّاسة المنسّق يدخل الفهرس كـnote — لا حقل جديد في العقد،
    // فتُوجد الكرّاسة بالبحث الحرفي والدلالي كأي دليل
    if (s.rich?.length) {
      const richRaw = richToPlain(s.rich)
      if (richRaw) rows.push({ guideId: guide.id, stepId: s.id, stepNo: i + 1, field: 'note', raw: richRaw })
    }
    if (s.pageTitle) rows.push({ guideId: guide.id, stepId: s.id, stepNo: i + 1, field: 'page_title', raw: s.pageTitle })
    if (s.url) {
      // SRCH-04 تطوّر: المضيف + رموز الشاشة (مسار + استعلام + hash) عبر مُجزّئ core الموحّد،
      // فتدخل هوية شاشة أودو (التي تعيش في الـhash) الفهرسَ، والأرقام المتغيّرة تُسقَط
      const { host, screen } = urlTokens(s.url)
      const raw = [host, ...screen].join(' ').trim()
      if (raw) rows.push({ guideId: guide.id, stepId: s.id, stepNo: i + 1, field: 'url', raw })
    }
  })
  return rows.filter((r) => r.raw.trim().length > 0)
}

export function deleteGuideIndex(sqlite: Database.Database, guideId: string): void {
  sqlite.prepare('DELETE FROM guide_index WHERE guide_id = ?').run(guideId)
}

/** إعادة بناء صفوف دليل واحد — تستدعى داخل معاملة الكتابة بعد تحديث guides.data */
export function indexGuide(sqlite: Database.Database, guide: GuideDto, tags: string[] = []): void {
  deleteGuideIndex(sqlite, guide.id)
  const insert = sqlite.prepare(`INSERT INTO guide_index ${COLS} VALUES (?, ?, ?, ?, ?, ?)`)
  for (const r of rowsOfGuide(guide, tags)) {
    insert.run(r.guideId, r.stepId, r.stepNo, r.field, normalizeForIndex(r.raw), r.raw)
  }
}

/** إعادة بناء الفهرس كاملًا من guides.data — أداة الإصلاح بعد أي تغيير في التطبيع */
export function rebuildIndex(sqlite: Database.Database): { guides: number; rows: number } {
  const readAll = sqlite
    .prepare('SELECT id, data, tags FROM guides')
    .all() as { id: string; data: string; tags: string }[]
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM guide_index').run()
    for (const row of readAll) {
      try {
        const tags = Array.isArray(JSON.parse(row.tags)) ? (JSON.parse(row.tags) as string[]) : []
        indexGuide(sqlite, JSON.parse(row.data) as GuideDto, tags)
      } catch {
        // دليل تالف البيانات يُتخطى ولا يُسقط إعادة البناء كلها
      }
    }
  })()
  const rows = (sqlite.prepare('SELECT count(*) AS c FROM guide_index').get() as { c: number }).c
  return { guides: readAll.length, rows }
}
