/** GM-05: خيوط تعليقات الخطوات — منطق عرض نقي يشترك فيه العارض العام والمحرر */

/** الحد الأدنى البنيوي الذي تحتاجه الخيوط — DTO الخادم يفي به بنيويًا (لا استيراد من shared في core) */
export interface CommentLike {
  id: string
  parentId: string | null
  createdAt: string
}

export interface CommentThread<C extends CommentLike> {
  root: C
  replies: C[]
}

/**
 * يجمع التعليقات في خيوط بعمق واحد: كل تعليق أصلي (بلا والد) يفتح خيطًا،
 * وردود الردود تُلحق بخيط جدّها (شجرة مسطّحة)، واليتيم (أصله محذوف) يصير
 * خيطًا مستقلًا حتى لا يضيع تعليق. الترتيب زمني صاعد — النقاش يُقرأ من الأقدم.
 */
export function threadComments<C extends CommentLike>(comments: readonly C[]): CommentThread<C>[] {
  const byId = new Map<string, C>()
  for (const c of comments) byId.set(c.id, c)

  /** جذر الخيط: اصعد عبر الآباء حتى أصل بلا والد؛ والد مجهول/دائري = التعليق نفسه أصل */
  function rootIdOf(c: C): string {
    let cur = c
    const seen = new Set<string>()
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id)
      const parent = byId.get(cur.parentId)!
      if (parent.id === cur.id) break
      cur = parent
    }
    return cur.id
  }

  const threads = new Map<string, { root: C | null; replies: C[] }>()
  for (const c of comments) {
    const rid = rootIdOf(c)
    const t = threads.get(rid) ?? { root: null, replies: [] }
    if (rid === c.id) t.root = c
    else t.replies.push(c)
    threads.set(rid, t)
  }

  return [...threads.values()]
    .filter((t): t is { root: C; replies: C[] } => t.root !== null)
    .sort((a, b) => (a.root.createdAt < b.root.createdAt ? -1 : a.root.createdAt > b.root.createdAt ? 1 : 0))
    .map((t) => ({
      root: t.root,
      replies: [...t.replies].sort((x, y) =>
        x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0,
      ),
    }))
}
