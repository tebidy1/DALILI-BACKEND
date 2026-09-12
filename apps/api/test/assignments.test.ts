import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assembleGuide } from '@dalili/core'
import { applyMigrations } from '../src/db/migrations'
import { buildTestApp, randomTestPassword, registerUser } from './helpers'

/**
 * ASG (الإسناد): إسناد دليل/كرّاسة لشخص/فريق/مساحة — متابعة بالأسماء بلا توقيع رسمي.
 * القراءة تتبع الإسناد الممنوح صراحةً، والعضوية تُحلّ حيًّا، والتقدّم كسول.
 */

type App = Awaited<ReturnType<typeof buildTestApp>>['app']

const uniqueEmail = () => `asg-${randomBytes(6).toString('hex')}@dalili.sa`

function guideFor(url: string, title: string) {
  const g = assembleGuide([
    { kind: 'navigate', target: {}, url, pageTitle: 'شاشة', ts: 1 },
    { kind: 'click', target: { text: 'زر' }, url, pageTitle: 'شاشة', ts: 2, screenshot: { fileId: 'f-test', blurRects: [] } },
  ])
  return { ...g, title }
}

async function createGuide(app: App, cookie: string, url: string, title = 'دليل'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: guideFor(url, title) } })
  expect(res.statusCode).toBe(200)
  return (res.json() as { id: string }).id
}

/** مدير + منشئ + مشاهد عبر مسار الدعوات الحي نفسه — مساحة واحدة مشتركة */
async function setupOrg(app: App, adminEmail: string) {
  const admin = await registerUser(app, adminEmail)
  async function invite(role: 'creator' | 'viewer', email: string) {
    const inv = await app.inject({ method: 'POST', url: '/api/team/invites', headers: { cookie: admin.cookie }, payload: { email, role } })
    expect(inv.statusCode).toBe(200)
    const { token } = inv.json() as { token: string }
    const accept = await app.inject({ method: 'POST', url: `/api/invites/${token}/accept`, payload: { password: randomTestPassword() } })
    expect(accept.statusCode).toBe(200)
    const raw = accept.headers['set-cookie']
    const cookie = (Array.isArray(raw) ? raw[0] : raw)!.split(';')[0]!
    const id = (accept.json() as { id: string }).id
    return { cookie, id }
  }
  const base = adminEmail.split('@')[0]
  const creator = await invite('creator', `${base}-c@dalili.sa`)
  const viewer = await invite('viewer', `${base}-v@dalili.sa`)
  return { admin, creator, viewer }
}

/** يجلب /api/assigned بكوكي معطى */
async function assignedOf(app: App, cookie: string) {
  const res = await app.inject({ method: 'GET', url: '/api/assigned', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  return res.json() as Array<{ assignmentId: string; guideId: string; note: string; openedAt: string | null; doneAt: string | null }>
}

describe('ترحيل 0017 — الإسناد', () => {
  it('ينشئ جدولي assignments و assignment_progress', () => {
    const sqlite = new Database(':memory:')
    applyMigrations(sqlite)
    const names = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(names).toContain('assignments')
    expect(names).toContain('assignment_progress')
    const cols = sqlite.prepare('PRAGMA table_info(assignments)').all().map((c) => (c as { name: string }).name)
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'workspace_id', 'guide_id', 'assigner_id', 'target_kind', 'target_id', 'note', 'created_at']),
    )
    sqlite.close()
  })
})

describe('POST /api/guides/:id/assign', () => {
  it('المدير يُسند دليله لكل الشركة، والمشاهد يُرفض 403', async () => {
    const { app } = await buildTestApp()
    const { admin, viewer } = await setupOrg(app, uniqueEmail())
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/home', 'إجراء الإغلاق')

    const ok = await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/assign`,
      headers: { cookie: admin.cookie },
      payload: { targets: [{ kind: 'workspace', id: 'ignored-resolved-server-side' }], note: 'اقرأه اليوم' },
    })
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as { created: number }).created).toBe(1)

    const denied = await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/assign`,
      headers: { cookie: viewer.cookie },
      payload: { targets: [{ kind: 'user', id: 'x' }] },
    })
    expect(denied.statusCode).toBe(403)
  })
})

describe('GET /api/assigned + التقدّم', () => {
  it('العضو المستهدَف يرى الإسناد بحالة غير مفتوحة، ثم فتح → تمّ → تراجع', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, uniqueEmail())
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/x', 'دورة التأهيل')
    await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/assign`,
      headers: { cookie: admin.cookie },
      payload: { targets: [{ kind: 'workspace', id: 'ws' }], note: 'ابدأ بها' },
    })

    const items = await assignedOf(app, creator.cookie)
    expect(items).toHaveLength(1)
    expect(items[0]!.guideId).toBe(gid)
    expect(items[0]!.note).toBe('ابدأ بها')
    expect(items[0]!.openedAt).toBeNull()
    const aid = items[0]!.assignmentId

    const open = await app.inject({ method: 'POST', url: `/api/assignments/${aid}/progress`, headers: { cookie: creator.cookie }, payload: {} })
    expect(open.statusCode).toBe(200)
    expect((open.json() as { openedAt: string; doneAt: string | null }).doneAt).toBeNull()

    const done = await app.inject({ method: 'POST', url: `/api/assignments/${aid}/progress`, headers: { cookie: creator.cookie }, payload: { done: true } })
    expect((done.json() as { doneAt: string | null }).doneAt).not.toBeNull()

    const undo = await app.inject({ method: 'POST', url: `/api/assignments/${aid}/progress`, headers: { cookie: creator.cookie }, payload: { done: false } })
    expect((undo.json() as { doneAt: string | null }).doneAt).toBeNull()
  })
})

describe('DELETE /api/assignments/:id', () => {
  it('المُسنِد يسحب الإسناد فيختفي من قائمة المستهدَف', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, uniqueEmail())
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/z', 'تعميم')
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/assign`, headers: { cookie: admin.cookie }, payload: { targets: [{ kind: 'workspace', id: 'ws' }] } })
    const aid = (await assignedOf(app, creator.cookie))[0]!.assignmentId

    const del = await app.inject({ method: 'DELETE', url: `/api/assignments/${aid}`, headers: { cookie: admin.cookie } })
    expect(del.statusCode).toBe(204)
    expect(await assignedOf(app, creator.cookie)).toHaveLength(0)
  })
})

describe('قاعدة الوصول — المُسنَد إليه يقرأ الدليل الخاص', () => {
  it('قبل الإسناد 404، بعده 200', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, uniqueEmail())
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/private', 'خاص')

    const before = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie: creator.cookie } })
    expect(before.statusCode).toBe(404)

    await app.inject({ method: 'POST', url: `/api/guides/${gid}/assign`, headers: { cookie: admin.cookie }, payload: { targets: [{ kind: 'workspace', id: 'ws' }] } })
    const after = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie: creator.cookie } })
    expect(after.statusCode).toBe(200)
  })
})

describe('GET /api/guides/:id/assignments — لوحة المُسنِد', () => {
  it('تعرض الأسماء وعدّاد الفتح على كل المساحة', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, uniqueEmail())
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/board', 'إجراء')
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/assign`, headers: { cookie: admin.cookie }, payload: { targets: [{ kind: 'workspace', id: 'ws' }] } })
    const aid = (await assignedOf(app, creator.cookie))[0]!.assignmentId
    await app.inject({ method: 'POST', url: `/api/assignments/${aid}/progress`, headers: { cookie: creator.cookie }, payload: {} })

    const board = await app.inject({ method: 'GET', url: `/api/guides/${gid}/assignments`, headers: { cookie: admin.cookie } })
    expect(board.statusCode).toBe(200)
    const b = board.json() as { recipientCount: number; openedCount: number; recipients: Array<{ email: string; openedAt: string | null }> }
    expect(b.recipientCount).toBe(3) // admin + creator + viewer
    expect(b.openedCount).toBe(1)
    expect(b.recipients.some((r) => r.openedAt !== null)).toBe(true)
  })
})

describe('overview.assignedNewCount', () => {
  it('يعدّ الإسنادات غير المفتوحة التي تخصّني ويتناقص بعد الفتح', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, uniqueEmail())
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/o', 'جديد')
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/assign`, headers: { cookie: admin.cookie }, payload: { targets: [{ kind: 'workspace', id: 'ws' }] } })

    const ov1 = (await (await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie: creator.cookie } })).json()) as { assignedNewCount: number }
    expect(ov1.assignedNewCount).toBe(1)

    const aid = (await assignedOf(app, creator.cookie))[0]!.assignmentId
    await app.inject({ method: 'POST', url: `/api/assignments/${aid}/progress`, headers: { cookie: creator.cookie }, payload: {} })
    const ov2 = (await (await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie: creator.cookie } })).json()) as { assignedNewCount: number }
    expect(ov2.assignedNewCount).toBe(0)
  })
})
