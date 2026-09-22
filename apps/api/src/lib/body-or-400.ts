import type { FastifyReply } from 'fastify'
import type { ZodType } from 'zod'

/**
 * فحص جسم الطلب المشترك — 400 عربي واحد لكل المسارات: أول رسالة من Zod
 * وإلا النص الاحتياطي (نفس الأسبقية في كل المسارات قبل توحيدها).
 * تُرسل الخطأ وتُرجع undefined ليتفرّغ المسار بـ`if (data === undefined) return data`.
 */
export function bodyOr400<S extends ZodType<any, any, any>>(
  schema: S,
  body: unknown,
  reply: FastifyReply,
  fallbackAr: string,
): S['_output'] | undefined {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    reply.code(400).send({ errorAr: parsed.error.issues[0]?.message ?? fallbackAr })
    return undefined
  }
  return parsed.data
}
