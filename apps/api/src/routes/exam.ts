import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  EXAM_BLUEPRINT,
  EXAM_DOMAINS,
  EXAM_POINTS_PER_ANSWER,
  EXAM_POINTS_PER_CREDIT,
  zExamAnswerSaveReq,
  zPracticeAnswerReq,
  type ExamAttemptSummaryDto,
  type ExamAttemptViewDto,
  type ExamDomainResultDto,
  type ExamDomain,
  type ExamQuestionPublicDto,
  type ExamResultViewDto,
  type ExamRunViewDto,
  type ExamStateDto,
} from '@dalili/shared'
import type { Auth } from '../auth/session'
import type { Db } from '../db/client'
import { examAttempts, examQuestions, userExamState } from '../db/schema'
import { bodyOr400 } from '../lib/body-or-400'

/**
 * EXAM: التدريب والاختبار الشامل OEEM — محاكاة أمينة لاختبار OMSB (100 سؤال، 150 دقيقة).
 * قرارات التصميم: موعد الاختبار النهائي محسوم على الخادم (deadline_at) فلا يُصدَّق
 * ساعة العميل؛ الإجابات تُحفظ بعد كل لمسة (انهيار الجهاز لا يُفقِد المحاولة)؛
 * الأجوبة والشروح لا تُرسل قبل التسليم أبدًا — بعد التسليم فقط موقع القيمة التعليمية.
 */

/** مدة الاختبار الرسمية بالدقائق (دفتر OMSB §IV.3) وثواني السماح بعد انقضائها قبل قفل الحفظ */
const EXAM_DURATION_MIN = 150
const DEADLINE_GRACE_MS = 60_000

interface DomainStats {
  answered: number
  correct: number
}

interface StateRow {
  userId: string
  answeredTotal: number
  correctTotal: number
  creditsEarned: number
  creditsUsed: number
  streak: number
  bestStreak: number
  domainStats: string
  updatedAt: string
}

/** صفّ حالة كسول — يُنشأ عند أول إجابة (نمط assignment_progress) */
function ensureState(db: Db, userId: string): StateRow {
  const existing = db.select().from(userExamState).where(eq(userExamState.userId, userId)).get()
  if (existing) return existing as StateRow
  const row: StateRow = {
    userId,
    answeredTotal: 0,
    correctTotal: 0,
    creditsEarned: 0,
    creditsUsed: 0,
    streak: 0,
    bestStreak: 0,
    domainStats: '{}',
    updatedAt: new Date().toISOString(),
  }
  db.insert(userExamState).values(row).run()
  return row
}

function pointsOf(row: StateRow): number {
  return row.answeredTotal * EXAM_POINTS_PER_ANSWER
}

function creditsEarnedOf(row: StateRow): number {
  return Math.floor(pointsOf(row) / EXAM_POINTS_PER_CREDIT)
}

function activeAttemptOf(db: Db, userId: string) {
  return db
    .select()
    .from(examAttempts)
    .where(and(eq(examAttempts.userId, userId), eq(examAttempts.status, 'in_progress')))
    .get()
}

function stateDto(db: Db, userId: string): ExamStateDto {
  const row = ensureState(db, userId)
  const active = activeAttemptOf(db, userId)
  const credits = creditsEarnedOf(row)
  const points = pointsOf(row)
  return {
    answeredTotal: row.answeredTotal,
    correctTotal: row.correctTotal,
    points,
    creditsEarned: credits,
    creditsUsed: row.creditsUsed,
    creditsAvailable: Math.max(0, credits - row.creditsUsed),
    pointsToNextCredit: EXAM_POINTS_PER_CREDIT - (points % EXAM_POINTS_PER_CREDIT),
    streak: row.streak,
    bestStreak: row.bestStreak,
    activeAttemptId: active?.id ?? null,
  }
}

/** خلط في المكان — فيشر-ييتس؛ لا حاجة لمصدر عشوائي مشفّر هنا */
function shuffled<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j] as T, arr[i] as T]
  }
  return arr
}

/**
 * تأليف ورقة الاختبار حسب blueprint الرسمي: لكل مجال وزنه الحرفي، وأي عجز
 * (بنك ناقص في مجال ما) يُملأ من فائض المجالات الأكبر — الورقة 100 حرفيًّا ما أمكن.
 */
function composeExamQuestionIds(db: Db): string[] {
  const rows = db.select({ id: examQuestions.id, domain: examQuestions.domain }).from(examQuestions).where(eq(examQuestions.active, 1)).all()
  const byDomain = new Map<string, string[]>() // domain → هويات البقية غير المأخوذة
  for (const d of EXAM_DOMAINS) byDomain.set(d, [])
  for (const r of rows) byDomain.get(r.domain)?.push(r.id)

  const picked: string[] = []
  for (const { domain, weight } of EXAM_BLUEPRINT) {
    const pool = byDomain.get(domain) ?? []
    const take = shuffled(pool).slice(0, weight)
    picked.push(...take)
    byDomain.set(domain, pool.filter((id) => !take.includes(id)))
  }
  if (picked.length < 100) {
    const leftovers = shuffled(rows.map((r) => r.id).filter((id) => !picked.includes(id)))
    picked.push(...leftovers.slice(0, 100 - picked.length))
  }
  return shuffled(picked)
}

function questionPublic(q: { id: string; domain: string; stem: string; options: string }): ExamQuestionPublicDto {
  return { id: q.id, domain: q.domain as ExamDomain, stem: q.stem, options: JSON.parse(q.options) as string[] }
}

function summaryOf(a: typeof examAttempts.$inferSelect): ExamAttemptSummaryDto {
  return {
    id: a.id,
    status: a.status === 'completed' ? 'completed' : 'in_progress',
    startedAt: a.startedAt,
    deadlineAt: a.deadlineAt,
    submittedAt: a.submittedAt,
    score: a.score,
    total: a.total,
  }
}

function questionsOfAttempt(db: Db, questionIds: string[]): ExamQuestionPublicDto[] {
  if (questionIds.length === 0) return []
  const rows = db
    .select()
    .from(examQuestions)
    .where(inArray(examQuestions.id, questionIds))
    .orderBy(asc(examQuestions.id))
    .all()
  const byId = new Map(rows.map((r) => [r.id, r]))
  return questionIds
    .map((id) => byId.get(id))
    .filter((r): r is typeof examQuestions.$inferSelect => Boolean(r))
    .map(questionPublic)
}

/** التصحيح والتثبيت النهائي للمحاولة — في معاملة واحدة، والزمن المصروف حتى سقف الموعد */
function finalizeAttempt(db: Db, attempt: typeof examAttempts.$inferSelect): typeof examAttempts.$inferSelect {
  if (attempt.status === 'completed') return attempt
  const ids = JSON.parse(attempt.questionIds) as string[]
  const rows = ids.length ? db.select().from(examQuestions).where(inArray(examQuestions.id, ids)).all() : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  const answers = JSON.parse(attempt.answers) as Record<string, number>

  const perDomain = new Map<ExamDomain, ExamDomainResultDto>()
  let score = 0
  for (const id of ids) {
    const q = byId.get(id)
    if (!q) continue
    const domain = q.domain as ExamDomain
    const entry = perDomain.get(domain) ?? { domain, correct: 0, total: 0 }
    entry.total++
    if (answers[id] === q.answerIndex) {
      entry.correct++
      score++
    }
    perDomain.set(domain, entry)
  }

  const started = new Date(attempt.startedAt).getTime()
  const deadline = new Date(attempt.deadlineAt).getTime()
  const spent = Math.max(0, Math.min(Date.now(), deadline) - started)

  const updated = { ...attempt, status: 'completed', score, submittedAt: new Date().toISOString(), perDomain: JSON.stringify([...perDomain.values()]), spentMs: spent }
  db.update(examAttempts)
    .set({ status: updated.status, score, submittedAt: updated.submittedAt, perDomain: updated.perDomain, spentMs: spent })
    .where(eq(examAttempts.id, attempt.id))
    .run()
  return updated
}

function resultViewOf(db: Db, attempt: typeof examAttempts.$inferSelect): ExamResultViewDto {
  const ids = JSON.parse(attempt.questionIds) as string[]
  const rows = ids.length ? db.select().from(examQuestions).where(inArray(examQuestions.id, ids)).all() : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  const answers = JSON.parse(attempt.answers) as Record<string, number>

  const questions = ids
    .map((id) => byId.get(id))
    .filter((r): r is typeof examQuestions.$inferSelect => Boolean(r))
    .map((q) => ({
      id: q.id,
      domain: q.domain as ExamDomain,
      stem: q.stem,
      options: JSON.parse(q.options) as string[],
      choice: answers[q.id] ?? null,
      answerIndex: q.answerIndex,
      correct: answers[q.id] === q.answerIndex,
      explanationAr: q.explanationAr,
    }))

  return {
    kind: 'result',
    attempt: summaryOf(attempt),
    score: attempt.score ?? 0,
    total: attempt.total,
    spentMs: attempt.spentMs,
    perDomain: JSON.parse(attempt.perDomain) as ExamDomainResultDto[],
    questions,
  }
}

function runViewOf(db: Db, attempt: typeof examAttempts.$inferSelect): ExamRunViewDto {
  const ids = JSON.parse(attempt.questionIds) as string[]
  const answers = JSON.parse(attempt.answers) as Record<string, number>
  const flagged = JSON.parse(attempt.flagged) as string[]
  const firstUnanswered = ids.findIndex((id) => answers[id] === undefined)
  return {
    kind: 'run',
    attempt: summaryOf(attempt),
    index: firstUnanswered === -1 ? 0 : firstUnanswered,
    questions: questionsOfAttempt(db, ids),
    answers,
    flagged,
  }
}

function viewOf(db: Db, attempt: typeof examAttempts.$inferSelect): ExamAttemptViewDto {
  if (attempt.status === 'completed') return resultViewOf(db, attempt)
  return runViewOf(db, attempt)
}

function ownAttempt(db: Db, req: FastifyRequest, auth: Auth): typeof examAttempts.$inferSelect | undefined {
  const user = auth.readUser(req)!
  const id = (req.params as { id: string }).id
  const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, id)).get()
  if (!attempt || attempt.userId !== user.id) return undefined
  return attempt
}

export function registerExamRoutes(app: FastifyInstance, db: Db, auth: Auth) {
  app.get('/api/exam/state', { preHandler: auth.requireAuth }, async (req) => {
    return stateDto(db, auth.readUser(req)!.id)
  })

  /** خريطة البنك مقابل الأوزان الرسمية — شفافية مركز الاختبار */
  app.get('/api/exam/blueprint', { preHandler: auth.requireAuth }, async () => {
    const counts = db
      .select({ domain: examQuestions.domain, c: sql<number>`count(*)` })
      .from(examQuestions)
      .where(eq(examQuestions.active, 1))
      .groupBy(examQuestions.domain)
      .all()
    const byDomain = new Map(counts.map((r) => [r.domain, Number(r.c)]))
    return {
      totalBank: counts.reduce((acc, r) => acc + Number(r.c), 0),
      rows: EXAM_BLUEPRINT.map(({ domain, weight }) => ({ domain, weight, bankCount: byDomain.get(domain) ?? 0 })),
    }
  })

  app.get('/api/exam/history', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const items = db
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.userId, user.id), eq(examAttempts.status, 'completed')))
      .orderBy(desc(examAttempts.startedAt))
      .all()
    return { items: items.map(summaryOf) }
  })

  /** سؤال تدريب — focus=weak يخدم أدنى مجالاتك دقّة (حلقة «درّب نقاط ضعفك») */
  app.get('/api/exam/practice/question', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const focus = (req.query as { focus?: string }).focus === 'weak' ? 'weak' : 'random'
    const row = ensureState(db, user.id)
    const stats = JSON.parse(row.domainStats || '{}') as Record<string, DomainStats>

    let domain: ExamDomain
    if (focus === 'weak') {
      const attempted = EXAM_DOMAINS.filter((d) => (stats[d]?.answered ?? 0) > 0)
      if (attempted.length > 0) {
        const worst = [...attempted].sort((a, b) => (stats[a]!.correct / stats[a]!.answered) - (stats[b]!.correct / stats[b]!.answered))
        // أدنى ثلث المجالات المُختبرة — عشوائية داخله كي لا يملّ سؤال واحد
        const pool = worst.slice(0, Math.max(1, Math.ceil(worst.length / 3)))
        domain = pool[Math.floor(Math.random() * pool.length)]!
      } else {
        domain = shuffled([...EXAM_DOMAINS])[0]!
      }
    } else {
      domain = shuffled([...EXAM_DOMAINS])[0]!
    }

    const rows = db
      .select()
      .from(examQuestions)
      .where(and(eq(examQuestions.domain, domain), eq(examQuestions.active, 1)))
      .all()
    const pick = shuffled(rows)[0] ?? shuffled(db.select().from(examQuestions).where(eq(examQuestions.active, 1)).all())[0]
    if (!pick) return { question: null, state: stateDto(db, user.id) }
    return { question: questionPublic(pick), state: stateDto(db, user.id) }
  })

  app.post('/api/exam/practice/answer', { preHandler: auth.requireAuth }, async (req, reply) => {
    const body = bodyOr400(zPracticeAnswerReq, req.body, reply, 'بيانات الإجابة غير صالحة')
    if (body === undefined) return undefined
    const user = auth.readUser(req)!
    const q = db.select().from(examQuestions).where(eq(examQuestions.id, body.questionId)).get()
    if (!q) return reply.code(404).send({ errorAr: 'السؤال غير موجود' })

    const row = ensureState(db, user.id)
    const correct = body.choice === q.answerIndex
    const stats = JSON.parse(row.domainStats || '{}') as Record<string, DomainStats>
    const ds = stats[q.domain] ?? { answered: 0, correct: 0 }
    const beforeCredits = creditsEarnedOf(row)
    const streak = correct ? row.streak + 1 : 0

    const updated: StateRow = {
      ...row,
      answeredTotal: row.answeredTotal + 1,
      correctTotal: row.correctTotal + (correct ? 1 : 0),
      streak,
      bestStreak: Math.max(row.bestStreak, streak),
      domainStats: JSON.stringify({
        ...stats,
        [q.domain]: { answered: ds.answered + 1, correct: ds.correct + (correct ? 1 : 0) },
      }),
      updatedAt: new Date().toISOString(),
    }
    updated.creditsEarned = creditsEarnedOf(updated)
    db.update(userExamState)
      .set({
        answeredTotal: updated.answeredTotal,
        correctTotal: updated.correctTotal,
        streak: updated.streak,
        bestStreak: updated.bestStreak,
        domainStats: updated.domainStats,
        creditsEarned: updated.creditsEarned,
        updatedAt: updated.updatedAt,
      })
      .where(eq(userExamState.userId, user.id))
      .run()

    return {
      correct,
      answerIndex: q.answerIndex,
      explanationAr: q.explanationAr,
      state: stateDto(db, user.id),
      creditJustEarned: updated.creditsEarned > beforeCredits,
    }
  })

  /** فتح اختبار شامل — يستهلك رصيدًا واحدًا، ومحاولة واحدة قيد الجريان في آن */
  app.post('/api/exam/attempts', { preHandler: auth.requireAuth }, async (req, reply) => {
    const user = auth.readUser(req)!
    const row = ensureState(db, user.id)
    if (activeAttemptOf(db, user.id)) {
      return reply.code(409).send({ errorAr: 'لديك اختبار جارٍ بالفعل — أكمله أو انتظر انقضاء وقته' })
    }
    if (creditsEarnedOf(row) - row.creditsUsed < 1) {
      return reply.code(403).send({ errorAr: 'لا رصيد اختبار بعد — أجب على أسئلة التدريب أولًا' })
    }

    const questionIds = composeExamQuestionIds(db)
    const now = new Date()
    const deadline = new Date(now.getTime() + EXAM_DURATION_MIN * 60_000)
    const id = 'ea' + nanoid(16)
    db.insert(examAttempts)
      .values({
        id,
        userId: user.id,
        status: 'in_progress',
        startedAt: now.toISOString(),
        deadlineAt: deadline.toISOString(),
        total: questionIds.length,
        questionIds: JSON.stringify(questionIds),
      })
      .run()
    db.update(userExamState)
      .set({ creditsUsed: row.creditsUsed + 1, updatedAt: now.toISOString() })
      .where(eq(userExamState.userId, user.id))
      .run()

    const attempt = db.select().from(examAttempts).where(eq(examAttempts.id, id)).get()
    return { view: runViewOf(db, attempt!), state: stateDto(db, user.id) }
  })

  app.get('/api/exam/attempts', { preHandler: auth.requireAuth }, async (req) => {
    const user = auth.readUser(req)!
    const items = db
      .select()
      .from(examAttempts)
      .where(eq(examAttempts.userId, user.id))
      .orderBy(desc(examAttempts.startedAt))
      .all()
    return { items: items.map(summaryOf) }
  })

  /** قراءة محاولة — المنقضيّة زمنًا تُصحَّح تلقائيًّا عند أول قراءة (تسليم آلي) */
  app.get('/api/exam/attempts/:id', { preHandler: auth.requireAuth }, async (req, reply) => {
    const attempt = ownAttempt(db, req, auth)
    if (!attempt) return reply.code(404).send({ errorAr: 'المحاولة غير موجودة' })
    if (attempt.status === 'in_progress' && Date.now() > new Date(attempt.deadlineAt).getTime()) {
      return { view: viewOf(db, finalizeAttempt(db, attempt)) }
    }
    return { view: viewOf(db, attempt) }
  })

  app.get('/api/exam/attempts/:id/result', { preHandler: auth.requireAuth }, async (req, reply) => {
    const attempt = ownAttempt(db, req, auth)
    if (!attempt) return reply.code(404).send({ errorAr: 'المحاولة غير موجودة' })
    const done = attempt.status === 'completed' ? attempt : finalizeAttempt(db, attempt)
    return resultViewOf(db, done)
  })

  /** حفظ تلقائي بعد كل إجابة/تعليم — يُقفل بعد الموعد بهامش دقيقة */
  app.put('/api/exam/attempts/:id/answers', { preHandler: auth.requireAuth }, async (req, reply) => {
    const body = bodyOr400(zExamAnswerSaveReq, req.body, reply, 'بيانات الحفظ غير صالحة')
    if (body === undefined) return undefined
    const attempt = ownAttempt(db, req, auth)
    if (!attempt) return reply.code(404).send({ errorAr: 'المحاولة غير موجودة' })
    if (attempt.status !== 'in_progress') return reply.code(409).send({ errorAr: 'المحاولة مُسلَّمة بالفعل' })
    if (Date.now() > new Date(attempt.deadlineAt).getTime() + DEADLINE_GRACE_MS) {
      return reply.code(409).send({ errorAr: 'انقضى وقت الاختبار — لا حفظ بعد التسليم الآلي' })
    }

    const answers = JSON.parse(attempt.answers) as Record<string, number>
    const flagged = new Set(JSON.parse(attempt.flagged) as string[])
    if (body.choice === null) delete answers[body.questionId]
    else if (body.choice !== undefined) answers[body.questionId] = body.choice
    if (body.flagged !== undefined) {
      if (body.flagged) flagged.add(body.questionId)
      else flagged.delete(body.questionId)
    }
    db.update(examAttempts)
      .set({ answers: JSON.stringify(answers), flagged: JSON.stringify([...flagged]) })
      .where(eq(examAttempts.id, attempt.id))
      .run()
    return { ok: true as const }
  })

  app.post('/api/exam/attempts/:id/submit', { preHandler: auth.requireAuth }, async (req, reply) => {
    const attempt = ownAttempt(db, req, auth)
    if (!attempt) return reply.code(404).send({ errorAr: 'المحاولة غير موجودة' })
    const finalized = finalizeAttempt(db, attempt)
    return { view: resultViewOf(db, finalized), state: stateDto(db, auth.readUser(req)!.id) }
  })
}
