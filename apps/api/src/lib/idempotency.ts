import { and, eq, lt } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { idempotencyKeys } from '../db/schema'
import type { Db } from '../db/client'

/** DTOP-02: صيغة المفتاح — حروف آمنة فقط، ٨ إلى ١٢٨ */
export const IDEM_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000
/** حجز بلا ردّ أقدم من هذا = عمليّة ماتت أثناء التنفيذ — يُستعاد ولا يحبس المفتاح أسبوعًا */
const PENDING_STALE_MS = 2 * 60 * 1000
/** status في الصفّ: 0 = محجوز قيد التنفيذ */
const PENDING = 0

export type IdemStart =
  /** لا ترويسة — السلوك القديم كما هو */
  | { kind: 'none' }
  | { kind: 'fresh'; key: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'rejected'; status: 400 | 409 | 422; errorAr: string }

/**
 * DTOP-02: عدم التكرار بحجز قبل التنفيذ — begin يُدرج صفًّا محجوزًا ذرّيًّا (PRIMARY KEY)،
 * فطلبان متزامنان بالمفتاح نفسه لا يمرّان معًا: الثاني يأخذ 409 ويعيد المحاولة، ثم replay.
 */
export function makeIdempotency(db: Db, now: () => number = Date.now) {
  const iso = (t: number) => new Date(t).toISOString()
  const byKey = (userId: string, key: string) => and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))

  function begin(req: FastifyRequest, userId: string, route: string): IdemStart {
    const header = req.headers['idempotency-key']
    if (header === undefined) return { kind: 'none' }
    const key = Array.isArray(header) ? (header[0] ?? '') : header
    if (!IDEM_KEY_RE.test(key)) {
      return { kind: 'rejected', status: 400, errorAr: 'مفتاح عدم التكرار غير صالح — ٨ إلى ١٢٨ حرفًا من A-Z وa-z و0-9 و_ و-' }
    }
    const t = now()
    db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, iso(t - RETAIN_MS))).run()
    const reserved = db
      .insert(idempotencyKeys)
      .values({ userId, key, route, status: PENDING, response: '', createdAt: iso(t) })
      .onConflictDoNothing()
      .run()
    if (reserved.changes === 1) return { kind: 'fresh', key }

    const row = db.select().from(idempotencyKeys).where(byKey(userId, key)).get()
    if (!row) return { kind: 'rejected', status: 409, errorAr: 'تعذّر حجز مفتاح عدم التكرار — أعد المحاولة' }
    if (row.route !== route) return { kind: 'rejected', status: 422, errorAr: 'مفتاح عدم التكرار استُعمل لطلب مختلف' }
    if (row.status === PENDING) {
      if (t - new Date(row.createdAt).getTime() > PENDING_STALE_MS) {
        db.update(idempotencyKeys).set({ createdAt: iso(t) }).where(and(byKey(userId, key), eq(idempotencyKeys.status, PENDING))).run()
        return { kind: 'fresh', key }
      }
      return { kind: 'rejected', status: 409, errorAr: 'الطلب نفسه ما زال قيد التنفيذ — أعد المحاولة بعد ثوانٍ' }
    }
    return { kind: 'replay', status: row.status, body: JSON.parse(row.response) as unknown }
  }

  /** يثبّت الردّ على الحجز — بعده كل إعادة بالمفتاح نفسه replay */
  function remember(userId: string, key: string, route: string, status: number, body: unknown): void {
    db.update(idempotencyKeys)
      .set({ status, response: JSON.stringify(body) })
      .where(and(byKey(userId, key), eq(idempotencyKeys.route, route)))
      .run()
  }

  /** فشل غير متوقَّع بعد الحجز — يحرّر المفتاح فتنجح إعادة المحاولة فورًا */
  function release(userId: string, key: string): void {
    db.delete(idempotencyKeys).where(and(byKey(userId, key), eq(idempotencyKeys.status, PENDING))).run()
  }

  return { begin, remember, release }
}

export type Idempotency = ReturnType<typeof makeIdempotency>
