import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { fuseRanked, normalizeFa, rankSemantic, relativeCutoff, semanticPassage, type EmbeddableGuide } from '@dalili/core'
import type { SemanticHitDto } from '@dalili/shared'
import type { EmbeddingProvider } from './provider'
import { makeSqliteVectorStore } from './vector-store'

/**
 * SRCH-06: مخزن بصمات المعنى — جدول guide_embeddings يُحدث عند كتابة الدليل،
 * والبحث الدلالي يقرأ صفوف المالك غير المحذوف ويُرتبها كوساين.
 * backfill هو أداة الشفاء: عند الإقلاع يضمّن الناقص ويحدّث ما تغيّر نصّه أو موديله.
 */

const EMBED_BATCH = 32

/** تنويع القائمة المرئية: نسخ العنوان الواحد (أدلة إثبات مكررة…) لا تحتكرها — اثنتان كحد أقصى */
const MAX_PER_TITLE = 2

function sourceHash(providerName: string, passage: string): string {
  return createHash('sha1').update(providerName).update('\u0000').update(passage).digest('hex')
}

interface EmbeddingRow {
  guide_id: string
  model: string
  source_hash: string
  vector: Uint8Array
}

/** كتابة/تحديث بصمة دليل واحد — تستدعى خارج معاملة الكتابة (الاستدلال لا يكون متزامنًا متشابكًا) */
export async function embedGuideInto(
  sqlite: Database.Database,
  provider: EmbeddingProvider,
  guide: EmbeddableGuide & { id: string },
  tags: string[] = [],
): Promise<void> {
  const passage = semanticPassage(guide, tags)
  if (!passage.trim()) return
  const [vector] = await provider.embedPassages([passage])
  if (!vector || vector.length === 0) return
  await makeSqliteVectorStore(sqlite).upsert(guide.id, vector, provider.name, sourceHash(provider.name, passage))
}

/**
 * التضمين بعد الكتابة بأمان تام: أي فشل يُبتلع — الفهرس الحرفي (FTS5) محفوظ في
 * معاملته، والبصمة تُشفى في backfill عند الإقلاع. الكتابة أغلى من البصمة أبدًا.
 */
export async function embedGuideSafe(
  sqlite: Database.Database,
  provider: EmbeddingProvider | null | undefined,
  guide: EmbeddableGuide & { id: string },
  tags: string[] = [],
): Promise<void> {
  if (!provider) return
  try {
    await embedGuideInto(sqlite, provider, guide, tags)
  } catch {
    // الصمت محسوب هنا — الشفاء مضمون في backfill الإقلاعي
  }
}

/** البيانات المرئية للدليل تُجلب لما تصبح مرشحًا مرتبًا — جدول guides وحده */
interface GuideMetaRow {
  id: string
  title: string
  updated_at: string
  thumb_file_id: string | null
}

/** استعلام النطاق نفسه بتقسيم IN حفظًا لسقف معاملات SQLite */
function guideMetaByIds(sqlite: Database.Database, ids: string[]): GuideMetaRow[] {
  const out: GuideMetaRow[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const rows = sqlite
      .prepare(`SELECT id, title, updated_at, thumb_file_id FROM guides WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .all(...(chunk as never[])) as GuideMetaRow[]
    out.push(...rows)
  }
  return out
}

/** البحث الدلالي: استعلام → بصمة → كوساين على أدلة النطاق غير المحذوفة → عناوين مرتبة.
 * ‏WS-02: workspaceId اختياري — يوسّع النطاق لمنشور المساحة لا ملك المستخدم وحده.
 * ‏تحسين 2026-09-04: literalIds (معرفات نتائج الحرفي) تفعّل دمج المراكز RRF —
 * الحاضر في القائمتين يتقدم — ثم فجوة ثقة نسبية تقصّ الذيل البعيد عن القمة،
 * والدرجات لا تُقارن أبدًا فانتقال المزوّد أو التخزين لا يغيّر المنطق. */
export async function runSemanticSearch(
  sqlite: Database.Database,
  userId: string,
  provider: EmbeddingProvider,
  q: string,
  opts: { limit?: number; literalIds?: string[] } = {},
  workspaceId?: string,
): Promise<SemanticHitDto[]> {
  const qVec = await provider.embedQuery(q)
  if (qVec.length === 0) return []
  const found = await makeSqliteVectorStore(sqlite).query(qVec, workspaceId ? { userId, workspaceId } : { userId })
  const limit = opts.limit ?? 8
  // ترتيب الكل فوق العتبة (رياضيات رخيصة: <2مث لكل ألف دليل) — التنويع ثم القص لاحقًا،
  // فلا يُقص دليل جديد خارج مسبَح مصطنع صغير
  const ranked = rankSemantic(
    qVec,
    found.map((r) => ({ id: r.guideId, vector: r.vector })),
  )
  const scores = new Map(ranked.map((h) => [h.id, h.score]))
  const semanticIds = ranked.map((h) => h.id)
  const literalIds = opts.literalIds ?? []
  let ordered: string[]
  if (literalIds.length > 0) {
    const fused = fuseRanked(semanticIds, literalIds)
    const semanticSet = new Set(semanticIds)
    // ترتيب الدمج نفسه محصور بأعضاء القائمة الدلالية — هي قائمة «أقرب الأدلة معنًى»
    ordered = relativeCutoff([...fused.keys()].filter((id) => semanticSet.has(id)), fused)
  } else {
    ordered = relativeCutoff(semanticIds, scores)
  }
  const byId = new Map(guideMetaByIds(sqlite, ordered).map((r) => [r.id, r]))
  // تنويع العناوين قبل القص للحد: خمس نسخ من «تعليقات — دليل إثبات» لا تلتهم القائمة
  const perTitle = new Map<string, number>()
  const diversified = ordered.filter((id) => {
    const title = byId.get(id)?.title ?? ''
    const key = normalizeFa(title)
    const used = perTitle.get(key) ?? 0
    if (used >= MAX_PER_TITLE) return false
    perTitle.set(key, used + 1)
    return true
  }).slice(0, limit)
  return diversified.flatMap((id) => {
    const r = byId.get(id)
    const score = scores.get(id)
    if (!r || score === undefined) return []
    return [
      {
        guideId: r.id,
        guideTitle: r.title,
        score: Math.round(score * 1000) / 1000,
        updatedAt: r.updated_at,
        ...(r.thumb_file_id ? { thumbFileId: r.thumb_file_id } : {}),
      },
    ]
  })
}

export interface BackfillResult {
  embedded: number
  total: number
}

/**
 * الشفاء الإقلاعي: يضمّن الأدلة بلا بصمة ويحدّث ما تغيّر نصّه أو موديله، بدفعات
 * صغيرة حفظًا للذاكرة. الأدلة في السلة تُضمَّن أيضًا كي يعمل البحث فور الاستعادة.
 */
export async function backfillEmbeddings(
  sqlite: Database.Database,
  provider: EmbeddingProvider,
  onProgress?: (done: number, total: number) => void,
): Promise<BackfillResult> {
  const guides = sqlite.prepare('SELECT id, data, tags FROM guides').all() as {
    id: string
    data: string
    tags: string
  }[]
  const existing = new Map(
    (
      sqlite.prepare('SELECT guide_id, model, source_hash FROM guide_embeddings').all() as {
        guide_id: string
        model: string
        source_hash: string
      }[]
    ).map((r) => [r.guide_id, r]),
  )

  const stale: { guide: EmbeddableGuide & { id: string }; tags: string[] }[] = []
  for (const row of guides) {
    try {
      const guide = JSON.parse(row.data) as (EmbeddableGuide & { id: string })
      guide.id = row.id
      let tags: string[] = []
      try {
        const parsed = JSON.parse(row.tags)
        if (Array.isArray(parsed)) tags = parsed as string[]
      } catch {
        // وسوم تالفة = بلا وسوم
      }
      const passage = semanticPassage(guide, tags)
      const hash = sourceHash(provider.name, passage)
      const prev = existing.get(row.id)
      if (!prev || prev.model !== provider.name || prev.source_hash !== hash) {
        stale.push({ guide, tags })
      }
    } catch {
      // دليل تالف البيانات يُتخطى ولا يُسقط الشفاء
    }
  }

  const vectorStore = makeSqliteVectorStore(sqlite)
  let done = 0
  for (let i = 0; i < stale.length; i += EMBED_BATCH) {
    const batch = stale.slice(i, i + EMBED_BATCH).map((b) => ({ ...b, passage: semanticPassage(b.guide, b.tags) }))
    const vectors = await provider.embedPassages(batch.map((b) => b.passage))
    const pending: Promise<void>[] = []
    const tx = sqlite.transaction((rows: typeof batch, vecs: Float32Array[]) => {
      rows.forEach((b, j) => {
        const v = vecs[j]
        if (!v || v.length === 0) return
        // غلاف upsert متزامن داخليًا — الكتابة تجري فورًا داخل معاملة SQLite نفسها
        pending.push(vectorStore.upsert(b.guide.id, v, provider.name, sourceHash(provider.name, b.passage)))
      })
    })
    tx(batch, vectors)
    await Promise.all(pending)
    done += batch.length
    onProgress?.(done, stale.length)
  }
  return { embedded: done, total: guides.length }
}
