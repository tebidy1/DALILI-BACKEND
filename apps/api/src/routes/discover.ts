import type Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'
import type { Auth } from '../auth/session'
import { zDiscoverQuery } from '@dalili/shared'
import { runDiscover } from '../search/query'

/** SRCH-04: شارة الاكتشاف — عدد أدلة المالك على نطاق التبويب النشط · SEC-01: 30/د */
export function registerDiscoverRoutes(app: FastifyInstance, sqlite: Database.Database, auth: Auth) {
  app.get(
    '/api/discover',
    { preHandler: auth.requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = zDiscoverQuery.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({ errorAr: 'نطاق غير صالح — مرّر اسم الموقع كاملًا' })
      }
      const user = auth.readUser(req)!
      // WS-02: الاكتشاف يرى منشور المساحة أيضًا
      const wsId = auth.ensurePersonalWorkspace(user.id, user.email).id
      return runDiscover(sqlite, user.id, parsed.data.site, wsId)
    },
  )
}
