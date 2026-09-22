import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { assignments, workspaceMembers } from '../db/schema'

/**
 * WS-03: أدوار المساحة الثلاثة — مدير/منشئ/مشاهد.
 * ‏member دور قديم قبل ترحيل 0008 يُطَّع creator عند الكتابة (العقد يتسامح والخادم يطبّع).
 */
export type WsRole = 'admin' | 'creator' | 'viewer'

export function normalizeRole(role: string): WsRole {
  if (role === 'admin' || role === 'creator' || role === 'viewer') return role
  return 'creator' // member القديم وأي قيمة نذرها = منشئ (أوسع دور غير إداري)
}

export function memberRole(db: Db, workspaceId: string, userId: string): WsRole | null {
  const row = db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .get()
  return row ? normalizeRole(row.role) : null
}

/** ASG: فريق العضو في المساحة — null إن لم يكن عضوًا. يُمرَّر لاحقًا لـassignmentTargetsMe */
export function memberTeamId(db: Db, workspaceId: string, userId: string): string | null {
  return (
    db
      .select({ teamId: workspaceMembers.teamId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .get()?.teamId ?? null
  )
}

/**
 * ASG: قاعدة «هل يخصّني الإسناد؟» بمصدر واحد — أنا أو فريقي أو مساحتي —
 * تتقاسمها بوابة القراءة في guides-shared وعدّاد المكتبة وقائمة /assigned
 * كي لا يفرق بابٌ عن عدّادٍ عن قائمة. المتصل يستبدل فريق null بـ'__none__'.
 */
export function assignmentTargetsMe(userId: string, myTeam: string, wsId: string) {
  return sql`(
    (${assignments.targetKind} = 'user' AND ${assignments.targetId} = ${userId})
    OR (${assignments.targetKind} = 'team' AND ${assignments.targetId} = ${myTeam})
    OR (${assignments.targetKind} = 'workspace' AND ${assignments.targetId} = ${wsId})
  )`
}
