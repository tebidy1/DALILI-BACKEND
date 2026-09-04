import type Database from 'better-sqlite3'
import { normalizeForIndex, highlightSnippet } from '@dalili/core'
import type { DiscoverResponseDto, SearchHitDto, SearchResponseDto } from '@dalili/shared'
import { FIELD_WEIGHTS, type IndexedField } from './index'

/**
 * خط أنابيب البحث (SRCH-01): تطبيع → اقتباس محصّن → bm25 موزون →
 * تعزيز حداثة → تجميع حسب الدليل → مقتطفات مظللة من النص الأصلي.
 */

export class EmptyQueryError extends Error {
  constructor() {
    super('اكتب كلمة واحدة على الأقل للبحث')
    this.name = 'EmptyQueryError'
  }
}

/** محارف صيغة FTS5 تُمحى من الرمز قبل الاقتباس — حماة مزدوجة مع الاقتباس نفسه */
const FTS_SPECIAL = /["'^()*:\-+]/g

/**
 * بناء تعبير FTS5 من استعلام حر.
 * كل رمز يُقتبس (يمنع حقن NEAR/OR/*) ويتبعه * لمطابقة البادئة أثناء الكتابة.
 */
export function buildFtsExpr(q: string): { expr: string; normalized: string } {
  const normalized = normalizeForIndex(q)
  const tokens = normalized
    .split(' ')
    .map((t) => t.replace(FTS_SPECIAL, ''))
    .filter((t) => t.length > 0)
  if (tokens.length === 0) throw new EmptyQueryError()
  const quoted = tokens.map((t) => `"${t}"*`)
  return { expr: quoted.join(' AND '), normalized: tokens.join(' ') }
}

export interface SearchFilters {
  from?: string
  to?: string
  shared?: boolean
  /** SRCH-02: حصر النتائج على مجلد */
  folder?: string
  /** SRCH-02: حصر النتائج على أدلة روابطها من هذا النطاق */
  site?: string
}

/** يهرب محارف LIKE حتى لا يعامل نطاقُ المستخدم كنمط مطابقة */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

/**
 * إبرة مطابقة النطاق: الفهرس يخزّن روابط url بأثرتها المفككة (النقاط مسافات —
 * انظر rowsOfGuide)، فالمرشّح يطبّق نفس التحويل وإلا لن يطابق شيئًا أبدًا.
 */
function siteNeedle(site: string): string {
  return likeEscape(site.trim().replace(/\./g, ' '))
}

interface RawHitRow {
  guide_id: string
  guide_title: string
  step_id: string | null
  step_no: number | null
  field: IndexedField
  raw_text: string
  updated_at: string
  score: number
  shared: number
  thumb_file_id: string | null
}

const HALF_LIFE_DAYS = 90
const MAX_PER_GUIDE = 3

function recencyBoost(updatedAt: string, now: number): number {
  const t = Date.parse(updatedAt)
  if (Number.isNaN(t)) return 1
  const ageDays = Math.max(0, (now - t) / 86_400_000)
  return 1 + 0.15 * Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
}

/** تنفيذ البحث — يُستدعى من المسار بعد تحقق zod.
 * ‏WS-02: workspaceId اختياري — حضوره يوسّع النطاق ليشمل منشور المساحة لا ملك المستخدم وحده */
export function runSearch(
  sqlite: Database.Database,
  userId: string,
  q: string,
  opts: { limit: number; suggest?: boolean } & SearchFilters,
  workspaceId?: string,
): SearchResponseDto {
  const startedAt = Date.now()
  const { expr, normalized } = buildFtsExpr(q)

  // كل الحقول تتشارك عمود norm_text — أوزان bm25() تسقط على الأعمدة لا الحقول المنطقية،
  // لذا الوزن الحقلي يُطبَّق في JS بعد الجلب (وزن الحقل × الحداثة) حيث يساوي شيئًا فعلًا
  const sql = `
    SELECT ri.guide_id, g.title AS guide_title, ri.step_id, ri.step_no, ri.field, ri.raw_text,
           g.updated_at, bm25(guide_index) AS score, g.thumb_file_id,
           EXISTS(SELECT 1 FROM shares s WHERE s.guide_id = g.id AND s.revoked_at IS NULL) AS shared
    FROM guide_index ri
    JOIN guides g ON g.id = ri.guide_id
    WHERE guide_index MATCH ?
      AND (g.user_id = ?${workspaceId ? ` OR (g.workspace_id = ? AND g.visibility = 'workspace')` : ''})
      ${opts.from ? 'AND g.updated_at >= ?' : ''}
      ${opts.to ? 'AND g.updated_at <= ?' : ''}
      ${opts.shared ? 'AND EXISTS(SELECT 1 FROM shares s2 WHERE s2.guide_id = g.id AND s2.revoked_at IS NULL)' : ''}
      ${opts.folder ? 'AND g.folder_id = ?' : ''}
      ${opts.site ? "AND EXISTS(SELECT 1 FROM guide_index u WHERE u.guide_id = g.id AND u.field = 'url' AND u.raw_text LIKE '%' || ? || '%' ESCAPE '\\')" : ''}
    ORDER BY score ASC, g.updated_at DESC
    LIMIT 300
  `
  const params: unknown[] = [expr, userId]
  if (workspaceId) params.push(workspaceId)
  if (opts.from) params.push(opts.from)
  if (opts.to) params.push(opts.to)
  if (opts.folder) params.push(opts.folder)
  if (opts.site) params.push(siteNeedle(opts.site))
  const rows = sqlite.prepare(sql).all(...(params as never[])) as RawHitRow[]

  // bm25 في SQLite سالب (أصغر = أفضل) — نقلنا للموجب ثم وزنّا الحقل والحداثة
  const now = Date.now()
  const scored = rows.map((r) => ({
    ...r,
    finalScore: -r.score * (FIELD_WEIGHTS[r.field] ?? 1) * recencyBoost(r.updated_at, now),
  }))

  // تجميع حسب الدليل: أعلى 3 خطوات لكل دليل — لا دليل يستأثر الصفحة
  const perGuide = new Map<string, number>()
  const grouped: typeof scored = []
  for (const r of scored) {
    const used = perGuide.get(r.guide_id) ?? 0
    if (used >= MAX_PER_GUIDE) continue
    perGuide.set(r.guide_id, used + 1)
    grouped.push(r)
  }

  const total = new Set(scored.map((r) => r.guide_id)).size
  const hits: SearchHitDto[] = grouped.slice(0, opts.limit).map((r) => ({
    guideId: r.guide_id,
    guideTitle: r.guide_title,
    stepId: r.step_id,
    stepNo: r.step_no,
    field: r.field,
    snippet: opts.suggest ? r.raw_text.slice(0, 90) : highlightSnippet(r.raw_text, q),
    updatedAt: r.updated_at,
    score: Math.round(r.finalScore * 1000) / 1000,
    ...(r.thumb_file_id ? { thumbFileId: r.thumb_file_id } : {}),
  }))

  return {
    hits,
    total,
    tookMs: Date.now() - startedAt,
    query: { raw: q, normalized },
  }
}

/**
 * SRCH-04: اكتشاف حسب الصفحة — أدلة النطاق المسموح بها لصاحب الطلب (مَلكه + منشور مساحته بـWS-02)،
 * بلا استعلام نصي. شرط النطاق نفسه الذي يستخدمه مرشّح البحث (إبرة النقاط المفككة).
 */
export function runDiscover(sqlite: Database.Database, userId: string, site: string, workspaceId?: string): DiscoverResponseDto {
  const needle = siteNeedle(site)
  const siteExists =
    "EXISTS(SELECT 1 FROM guide_index u WHERE u.guide_id = g.id AND u.field = 'url' AND u.raw_text LIKE '%' || ? || '%' ESCAPE '\\')"
  const scope = workspaceId
    ? "(g.user_id = ? OR (g.workspace_id = ? AND g.visibility = 'workspace'))"
    : 'g.user_id = ?'
  const scopeParams: unknown[] = workspaceId ? [userId, workspaceId] : [userId]
  const count = (
    sqlite
      .prepare(`SELECT COUNT(DISTINCT g.id) AS c FROM guides g WHERE ${scope} AND ${siteExists}`)
      .get(...(scopeParams as never[]), needle) as { c: number }
  ).c
  const guides = (
    sqlite
      .prepare(
        `SELECT g.id, g.title, g.updated_at FROM guides g WHERE ${scope} AND ${siteExists}
         ORDER BY g.updated_at DESC LIMIT 5`,
      )
      .all(...(scopeParams as never[]), needle) as Array<{ id: string; title: string; updated_at: string }>
  ).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }))
  return { count, guides }
}
