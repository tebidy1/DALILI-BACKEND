import type Database from 'better-sqlite3'
import { vectorFromBytes, vectorToBytes } from '@dalili/core'

/**
 * SRCH-06 تحسين — واجهة تخزين المتجهات واحدة فوق كل تنفيذ:
 * اليوم SQLite BLOB (التنفيذ makeSqliteVectorStore أدناه)، وعند النشر تصير
 * pgvector أو Qdrant خلف الواجهة نفسها بلا تغيير أي سطر ترتيب فوقها —
 * قرار المالك: قاعدة متجهات حقيقية عند النشر = استبدال طبقة تخزين لا إعادة كتابة.
 */
export interface VectorScope {
  userId: string
  /** حضوره يوسّع النطاق ليشمل منشور المساحة (WS-02) لا ملك المستخدم وحده */
  workspaceId?: string
}

export interface VectorStore {
  /** صفوف النطاق غير المحذوفة مع متجهاتها. التنفيذ المحلي يتجاهل embedding
   * (الكوساين يُحسب فوقه في JS — أرخص من 2مث لكل ألف دليل)، أما مخزن حقيقي
   * (pgvector/Qdrant) فيستعمله للبحث ذاته ويعيد الأقرب. */
  query(embedding: Float32Array, scope: VectorScope): Promise<Array<{ guideId: string; vector: Float32Array }>>
  upsert(guideId: string, vector: Float32Array, model: string, sourceHash: string): Promise<void>
  removeByGuide(guideId: string): Promise<void>
}

/** التنفيذ الحالي منقول حرفيًا من store.ts — نفس استعلام النطاق والحذف الناعم */
export function makeSqliteVectorStore(sqlite: Database.Database): VectorStore {
  return {
    async query(embedding, scope) {
      void embedding
      const where = scope.workspaceId
        ? "(g.user_id = ? OR (g.workspace_id = ? AND g.visibility = 'workspace'))"
        : 'g.user_id = ?'
      const params: unknown[] = scope.workspaceId ? [scope.userId, scope.workspaceId] : [scope.userId]
      const rows = sqlite
        .prepare(
          `SELECT e.guide_id, e.vector
           FROM guide_embeddings e
           JOIN guides g ON g.id = e.guide_id
           WHERE ${where} AND g.deleted_at IS NULL`,
        )
        .all(...(params as never[])) as Array<{ guide_id: string; vector: Uint8Array }>
      return rows.map((r) => ({ guideId: r.guide_id, vector: vectorFromBytes(new Uint8Array(r.vector)) }))
    },

    async upsert(guideId, vector, model, sourceHash) {
      sqlite
        .prepare(
          `INSERT INTO guide_embeddings (guide_id, model, source_hash, dim, vector, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(guide_id) DO UPDATE SET
             model = excluded.model,
             source_hash = excluded.source_hash,
             dim = excluded.dim,
             vector = excluded.vector,
             updated_at = excluded.updated_at`,
        )
        .run(guideId, model, sourceHash, vector.length, vectorToBytes(vector), new Date().toISOString())
    },

    async removeByGuide(guideId) {
      sqlite.prepare('DELETE FROM guide_embeddings WHERE guide_id = ?').run(guideId)
    },
  }
}
