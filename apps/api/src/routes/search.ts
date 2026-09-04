import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import type { Auth } from '../auth/session'
import { zSearchQuery, zSuggestQuery } from '@dalili/shared'
import { EmptyQueryError, runSearch } from '../search/query'
import { runSemanticSearch } from '../embeddings/store'
import type { EmbeddingProvider } from '../embeddings/provider'

/** سقف قائمة «أقرب الأدلة معنًى» — قائمة اختيار لا حائط نتائج (قرار المالك 2026-09-01) */
const SEMANTIC_LIMIT = 8

/**
 * مسارا البحث (SRCH-01/03) — نفس خط الأنابيب، والاقتراح أخف بلا تظليل · SEC-01: 30/د
 * SRCH-06: الطبقة الدلالية تُكمّل الحرفي في الاستجابة نفسها حين يوجد مزوّد تضمين؛
 * تعذّرها = semanticReason عربي صادق ولا يُسقط النتائج الحرفية أبدًا.
 */
export function registerSearchRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  auth: Auth,
  embeddings?: EmbeddingProvider,
) {
  app.get(
    '/api/search',
    { preHandler: auth.requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const parsed = zSearchQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: 'استعلام بحث غير صالح — اكتب كلمة واحدة على الأقل' })
    }
    const { q, limit, from, to, shared, folder, site } = parsed.data
    const user = auth.readUser(req)!
    // WS-02: البحث يرى منشور المساحة لا ملك المستخدم وحده
    const wsId = auth.ensurePersonalWorkspace(user.id, user.email).id
    let literal: ReturnType<typeof runSearch>
    try {
      literal = runSearch(sqlite, user.id, q, { limit, from, to, shared, folder, site }, wsId)
    } catch (e) {
      if (e instanceof EmptyQueryError) return reply.code(400).send({ errorAr: e.message })
      throw e
    }
    if (!embeddings) return literal
    try {
      // دمج المراكز RRF: معرفات الحرفي تمر للدلالي فيتقدم المشترك ويُقصّ الذيل بفجوة ثقة
      const semantic = await runSemanticSearch(sqlite, user.id, embeddings, q, {
        limit: SEMANTIC_LIMIT,
        literalIds: literal.hits.map((h) => h.guideId),
      }, wsId)
      if (semantic.length > 0) return { ...literal, semantic }
      return literal
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : 'تعذّر البحث بالمعنى الآن'
      return { ...literal, semanticReason: reason }
    }
    },
  )

  app.get(
    '/api/search/suggest',
    { preHandler: auth.requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const parsed = zSuggestQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ errorAr: 'استعلام غير صالح' })
    }
    const { q, limit } = parsed.data
    try {
      return runSearch(sqlite, auth.readUser(req)!.id, q, { limit, suggest: true })
    } catch (e) {
      if (e instanceof EmptyQueryError) return reply.code(400).send({ errorAr: e.message })
      throw e
    }
    },
  )
}
