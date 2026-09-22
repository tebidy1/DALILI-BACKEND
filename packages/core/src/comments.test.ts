import { describe, expect, it } from 'vitest'
import { threadComments, type CommentLike } from './comments'

interface C extends CommentLike {
  body: string
  resolved: boolean
}

function c(id: string, createdAt: string, parentId: string | null = null, body = id): C {
  return { id, parentId, createdAt, resolved: false, body }
}

/** GM-05: خيوط التعليقات — تجميع الردود تحت أصلها بترتيب زمني صاعد */
describe('threadComments', () => {
  it('يجمع تعليقًا أصليًا وردوده في خيط واحد بترتيب زمني', () => {
    const threads = threadComments([
      c('r2', '2026-01-03T00:00:00Z'),
      c('a', '2026-01-01T00:00:00Z'),
      c('r1', '2026-01-02T00:00:00Z', 'a'),
      c('r2b', '2026-01-04T00:00:00Z', 'a'),
    ])
    expect(threads).toHaveLength(2)
    expect(threads[0]!.root.id).toBe('a')
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['r1', 'r2b'])
    expect(threads[1]!.root.id).toBe('r2')
    expect(threads[1]!.replies).toHaveLength(0)
  })

  it('يرد على رد يُلحق بخيط الأصل — عمق واحد دائمًا لا شجرة', () => {
    const threads = threadComments([
      c('a', '2026-01-01T00:00:00Z'),
      c('r1', '2026-01-02T00:00:00Z', 'a'),
      // رد على الرد — يذوب في خيط جدّه
      c('r1b', '2026-01-03T00:00:00Z', 'r1'),
    ])
    expect(threads).toHaveLength(1)
    expect(threads[0]!.root.id).toBe('a')
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['r1', 'r1b'])
  })

  it('يتيم الأصل (محذوف أصله) يصير خيطًا مستقلًا — لا تعليق يضيع', () => {
    const threads = threadComments([c('orphan-r', '2026-01-02T00:00:00Z', 'gone')])
    expect(threads).toHaveLength(1)
    expect(threads[0]!.root.id).toBe('orphan-r')
    expect(threads[0]!.replies).toHaveLength(0)
  })

  it('قائمة فارغة تعيد لا خيوط', () => {
    expect(threadComments<C>([])).toEqual([])
  })

  it('نفس معرّف الخيط عبر الاستدعاءات لا يكرر — والد يشير لنفسه يعامل كأصل', () => {
    const threads = threadComments([c('self', '2026-01-01T00:00:00Z', 'self')])
    expect(threads).toHaveLength(1)
    expect(threads[0]!.root.id).toBe('self')
    expect(threads[0]!.replies).toHaveLength(0)
  })
})
