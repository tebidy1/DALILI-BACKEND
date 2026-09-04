import type Database from 'better-sqlite3'

/** LIB-06: سلة المحذوفات — أرشيف 30 يومًا ثم حذف دائم */

export const TRASH_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** نقية: هل تجاوز الدليل مدة الأرشيف؟ (للاختبار والكنس معًا) */
export function isTrashExpired(deletedAt: string, nowIso: string): boolean {
  return Date.parse(nowIso) - Date.parse(deletedAt) > TRASH_DAYS * DAY_MS
}

/** كنس المتقادمين حذفًا دائمًا — يستدعى عند الإقلاع وعند فتح السلة. يعيد عدد المنظّف. */
export function purgeExpiredTrash(sqlite: Database.Database): number {
  const rows = sqlite
    .prepare('SELECT id, deleted_at FROM guides WHERE deleted_at IS NOT NULL')
    .all() as { id: string; deleted_at: string }[]
  const now = new Date().toISOString()
  const dead = rows.filter((r) => isTrashExpired(r.deleted_at, now))
  if (dead.length === 0) return 0
  sqlite.transaction(() => {
    const delIndex = sqlite.prepare('DELETE FROM guide_index WHERE guide_id = ?')
    const delShare = sqlite.prepare('DELETE FROM shares WHERE guide_id = ?')
    const delGuide = sqlite.prepare('DELETE FROM guides WHERE id = ?')
    for (const r of dead) {
      delIndex.run(r.id)
      delShare.run(r.id)
      delGuide.run(r.id)
    }
  })()
  return dead.length
}
