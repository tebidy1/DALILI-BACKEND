import { nanoid } from 'nanoid'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { sessions, users, workspaces, workspaceMembers } from '../db/schema'
import type { Db } from '../db/client'

export const SESSION_COOKIE = 'dalili_sid'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * SEC-05: سياسة الكوكي حسب البيئة — قرار موثّق لا تناقض:
 * التطوير sameSite=none+secure (الامتداد chrome-extension:// شريك أول يرسل الجلسة)،
 * والإنتاج (NODE_ENV=production، نطاق واحد https يخدم الويب والـAPI) يشتد إلى lax.
 */
export function cookiePolicy(): { sameSite: 'none' | 'lax'; secure: boolean } {
  if (process.env.NODE_ENV === 'production') return { sameSite: 'lax', secure: true }
  return { sameSite: 'none', secure: true }
}

export interface SessionUser {
  id: string
  email: string
}

export function makeAuth(db: Db) {
  function createSession(userId: string): { sid: string } {
    const sid = nanoid(32)
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString()
    db.insert(sessions)
      .values({ id: sid, userId, expiresAt })
      .run()
    return { sid }
  }

  function setSessionCookie(reply: FastifyReply, sid: string) {
    const policy = cookiePolicy()
    reply.setCookie(SESSION_COOKIE, sid, {
      path: '/',
      httpOnly: true,
      sameSite: policy.sameSite,
      secure: policy.secure,
      maxAge: Math.floor(THIRTY_DAYS_MS / 1000),
    })
  }

  function readUser(request: FastifyRequest): SessionUser | null {
    const sid = request.cookies[SESSION_COOKIE]
    if (!sid) return null
    const row = db
      .select({ id: users.id, email: users.email, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sid))
      .get()
    if (!row) return null
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      db.delete(sessions).where(eq(sessions.id, sid)).run()
      return null
    }
    return { id: row.id, email: row.email }
  }

  function destroySession(request: FastifyRequest) {
    const sid = request.cookies[SESSION_COOKIE]
    if (sid) db.delete(sessions).where(eq(sessions.id, sid)).run()
  }

  /** SEC-03: تدوير الجلسة — يُبطل أي كوكي قديم وصل مع الطلب ثم يُصدر معرّفًا جديدًا (منع تثبيت الجلسة) */
  function rotateSession(request: FastifyRequest, reply: FastifyReply, userId: string): { sid: string } {
    destroySession(request)
    const { sid } = createSession(userId)
    setSessionCookie(reply, sid)
    return { sid }
  }

  /** حرس المصادقة — رسالة عربية صريحة */
  async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    if (!readUser(request)) {
      return reply.code(401).send({ errorAr: 'يجب تسجيل الدخول أولًا' })
    }
  }

  /** مساحة العمل الشخصية — تُنشأ عند أول حاجة، السكيمة جاهزة للفرق لاحقًا */
  function ensurePersonalWorkspace(userId: string, email: string): { id: string } {
    const existing = db
      .select({ id: workspaces.id })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId))
      .get()
    if (existing) return existing
    const id = nanoid(12)
    const now = new Date().toISOString()
    db.insert(workspaces)
      .values({ id, name: `مساحة ${email.split('@')[0]}`, ownerId: userId, createdAt: now })
      .run()
    db.insert(workspaceMembers).values({ workspaceId: id, userId, role: 'admin' }).run()
    return { id }
  }

  return { createSession, setSessionCookie, rotateSession, readUser, destroySession, requireAuth, ensurePersonalWorkspace }
}

export type Auth = ReturnType<typeof makeAuth>
