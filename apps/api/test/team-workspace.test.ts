import Database from 'better-sqlite3'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTestApp, buildTestAppWithDir, randomTestPassword, registerUser } from './helpers'
import { assembleGuide } from '@dalili/core'

/**
 * المرحلة د (الفرق — WS-08): قراءة القائمة لكل الأعضاء مع حالة الدعوة وعدد الأدلة،
 * **نقل ملكية أدلة العضو المنقول لمدير المساحة عند الإزالة** (لا أدلة يتيمة)،
 * والفرق ككيان (ترحيل 0010 يرقّي «القسم» الحر) — إنشاء/تسمية/حذف وتجميع الأعضاء.
 */

function guideFor(url: string) {
  return assembleGuide([
    { kind: 'navigate', target: {}, url, pageTitle: 'شاشة', ts: 1 },
    {
      kind: 'click',
      target: { text: 'زر' },
      url,
      pageTitle: 'شاشة',
      ts: 2,
      screenshot: { fileId: 'f-test', blurRects: [] },
    },
  ])
}

/** مدير + منشئ + مشاهد عبر مسار الدعوات الحي نفسه */
async function setupOrg(app: Awaited<ReturnType<typeof buildTestApp>>['app'], adminEmail: string) {
  const admin = await registerUser(app, adminEmail)

  async function invite(role: 'creator' | 'viewer', email: string) {
    const inv = await app.inject({
      method: 'POST',
      url: '/api/team/invites',
      headers: { cookie: admin.cookie },
      payload: { email, role },
    })
    expect(inv.statusCode).toBe(200)
    const { token } = inv.json() as { token: string }
    const accept = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      payload: { password: randomTestPassword() },
    })
    expect(accept.statusCode).toBe(200)
    const raw = accept.headers['set-cookie']
    return { cookie: (Array.isArray(raw) ? raw[0] : raw)!.split(';')[0]! }
  }

  const creator = await invite('creator', `${adminEmail.split('@')[0]}-creator@dalili.sa`)
  const viewer = await invite('viewer', `${adminEmail.split('@')[0]}-viewer@dalili.sa`)
  return { admin, creator, viewer }
}

async function createGuide(app: unknown, cookie: string, url: string, title = 'دليل'): Promise<string> {
  const guide = JSON.parse(JSON.stringify(guideFor(url)))
  guide.title = title
  const res = await (app as { inject: (o: unknown) => PromiseLike<{ statusCode: number; json(): unknown }> }).inject({
    method: 'POST',
    url: '/api/guides',
    headers: { cookie },
    payload: { guide },
  })
  expect(res.statusCode).toBe(200)
  return (res.json() as { id: string }).id
}

interface MemberRow {
  id: string
  email: string
  role: string
  pending?: boolean
  guideCount?: number
  teamId?: string | null
  teamName?: string | null
}

async function roster(app: unknown, cookie: string): Promise<MemberRow[]> {
  const r = await (app as { inject: (o: unknown) => PromiseLike<{ statusCode: number; json(): unknown }> }).inject({
    method: 'GET',
    url: '/api/team',
    headers: { cookie },
  })
  expect(r.statusCode).toBe(200)
  return r.json() as MemberRow[]
}

describe('قائمة الفريق (المرحلة د — WS-08)', () => {
  it('القراءة لكل الأعضاء لا للمدير وحده — ومعها حالة الدعوة المعلقة وعدد أدلة كل عضو', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { admin, creator, viewer } = await setupOrg(app, 'tm-roster@dalili.sa')
    await createGuide(app, creator.cookie, 'https://sap.example/a', 'دليل المنشئ')

    // عضو معلّق بنمط القِدَم: مستخدم بلا كلمة مرور له عضوية (دفاعيًّا للصفوف القديمة)
    const raw = new Database(path.join(dir, 'dalili.db'))
    raw.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u-pending', 'old-pending@dalili.sa', 'pending', ?)").run(new Date().toISOString())
    raw.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) SELECT id, 'u-pending', 'viewer' FROM workspaces LIMIT 1").run()
    raw.close()

    // المنشئ والمشاهد يقرآن القائمة (كانت 403 للمدير وحده)
    for (const c of [admin.cookie, creator.cookie, viewer.cookie]) {
      const rows = await roster(app, c)
      expect(rows.length).toBe(4)
    }

    const rows = await roster(app, admin.cookie)
    const pending = rows.find((m) => m.email === 'old-pending@dalili.sa')
    expect(pending?.pending).toBe(true)
    const creatorRow = rows.find((m) => m.email.endsWith('-creator@dalili.sa'))
    expect(creatorRow?.pending).toBe(false)
    expect(creatorRow?.guideCount).toBe(1)
    const adminRow = rows.find((m) => m.email === 'tm-roster@dalili.sa')
    // الترحيبي المزروع عند التسجيل يدخل عدّاد المالك
    expect(adminRow?.guideCount).toBe(1)
  })
})

describe('إزالة عضو مع نقل ملكية أدلته (المرحلة د)', () => {
  it('إزالة المنشئ تنقل أدلته كلها (الخاصة والمنشورة، وحتى المجلد) للمدير — وعضويته تُسقط وحسابه يبقى بلا أدلة', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'tm-remove@dalili.sa')

    const g1 = await createGuide(app, creator.cookie, 'https://sap.example/priv', 'خاص المنشئ')
    const g2 = await createGuide(app, creator.cookie, 'https://sap.example/pub', 'منشور المنشئ')
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${g2}/meta`,
      headers: { cookie: creator.cookie },
      payload: { visibility: 'workspace' },
    })
    // مجلد للمنشئ وراء أحدهما — النقل يجعل الدليل بجذر المدير لا داخل مجلد مفقود
    const folder = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie: creator.cookie },
      payload: { name: 'مجلد المنشئ' },
    })
    const folderId = (folder.json() as { id: string }).id
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${g1}/meta`,
      headers: { cookie: creator.cookie },
      payload: { folderId },
    })

    const creatorId = (await roster(app, admin.cookie)).find((m) => m.email.endsWith('-creator@dalili.sa'))!.id
    const del = await app.inject({ method: 'DELETE', url: `/api/team/${creatorId}`, headers: { cookie: admin.cookie } })
    expect([200, 204]).toContain(del.statusCode)

    // عضويته سقطت
    expect((await roster(app, admin.cookie)).some((m) => m.email.endsWith('-creator@dalili.sa'))).toBe(false)

    // الأدلة صارت ملك المدير في جذره — ولا دليل يتيم
    const adminList = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: admin.cookie } })).json() as {
      items: { id: string; mine: boolean; folderId: string | null }[]
    }
    const t1 = adminList.items.find((g) => g.id === g1)
    const t2 = adminList.items.find((g) => g.id === g2)
    expect(t1?.mine).toBe(true)
    expect(t2?.mine).toBe(true)
    expect(t1?.folderId).toBeNull()

    // حساب المنشئ باقٍ يدخل لكن بلا شيء (مساحته الشخصية فارغة)
    const hisList = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: creator.cookie } })).json() as {
      total: number
    }
    expect(hisList.total).toBe(0)
  })

  it('لا إزالة للمالك ولا للنفس — والمنشئ لا يُزيلا أحدًا (403)', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'tm-guard@dalili.sa')

    // رفع المنشئ إلى مدير ثم محاولة إزالة المالك
    const creatorId = (await roster(app, admin.cookie)).find((m) => m.email.endsWith('-creator@dalili.sa'))!.id
    await app.inject({
      method: 'PATCH',
      url: `/api/team/${creatorId}`,
      headers: { cookie: admin.cookie },
      payload: { role: 'admin' },
    })
    const adminId = (await roster(app, admin.cookie)).find((m) => m.email === 'tm-guard@dalili.sa')!.id
    const removeOwner = await app.inject({ method: 'DELETE', url: `/api/team/${adminId}`, headers: { cookie: creator.cookie } })
    expect(removeOwner.statusCode).toBe(400)

    // إزالة النفس ممنوعة
    const self = await app.inject({ method: 'DELETE', url: `/api/team/${creatorId}`, headers: { cookie: creator.cookie } })
    expect(self.statusCode).toBe(400)

    // منشئ عادي لا يملك الإزالة أصلًا
    const viewerId = (await roster(app, admin.cookie)).find((m) => m.email.endsWith('-viewer@dalili.sa'))!.id
    await app.inject({
      method: 'PATCH',
      url: `/api/team/${creatorId}`,
      headers: { cookie: admin.cookie },
      payload: { role: 'creator' },
    })
    const forbidden = await app.inject({ method: 'DELETE', url: `/api/team/${viewerId}`, headers: { cookie: creator.cookie } })
    expect(forbidden.statusCode).toBe(403)
  })
})

describe('الفرق ككيان (المرحلة د — ترحيل 0010)', () => {
  it('إنشاء فريق وتسميته وتجميع عضو فيه ثم حذفه يُرجع أعضاءه «بلا فريق» — والمنشئ لا يُنشئ', async () => {
    const { app } = await buildTestApp()
    const { admin, creator, viewer } = await setupOrg(app, 'tm-teams@dalili.sa')

    // المنشئ ممنوع من الإدارة
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/team/teams',
      headers: { cookie: creator.cookie },
      payload: { name: 'المبيعات' },
    })
    expect(forbidden.statusCode).toBe(403)

    const cr = await app.inject({
      method: 'POST',
      url: '/api/team/teams',
      headers: { cookie: admin.cookie },
      payload: { name: 'المبيعات' },
    })
    expect(cr.statusCode).toBe(200)
    const team = cr.json() as { id: string; name: string; memberCount: number }
    expect(team.name).toBe('المبيعات')
    expect(team.memberCount).toBe(0)

    // تجميع المنشئ والمشاهد فيه
    const rows = await roster(app, admin.cookie)
    const creatorId = rows.find((m) => m.email.endsWith('-creator@dalili.sa'))!.id
    const viewerId = rows.find((m) => m.email.endsWith('-viewer@dalili.sa'))!.id
    await app.inject({
      method: 'PATCH',
      url: `/api/team/${creatorId}`,
      headers: { cookie: admin.cookie },
      payload: { teamId: team.id },
    })
    await app.inject({
      method: 'PATCH',
      url: `/api/team/${viewerId}`,
      headers: { cookie: admin.cookie },
      payload: { teamId: team.id },
    })

    const list = (await app.inject({ method: 'GET', url: '/api/team/teams', headers: { cookie: creator.cookie } })).json() as {
      id: string
      memberCount: number
    }[]
    expect(list.find((x) => x.id === team.id)?.memberCount).toBe(2)

    // صف العضو يظهر فريقه باسمه
    const after = await roster(app, admin.cookie)
    expect(after.find((m) => m.id === creatorId)?.teamName).toBe('المبيعات')

    // تسمية الفريق
    const rn = await app.inject({
      method: 'PATCH',
      url: `/api/team/teams/${team.id}`,
      headers: { cookie: admin.cookie },
      payload: { name: 'المبيعات والإعداد' },
    })
    expect((rn.json() as { name: string }).name).toBe('المبيعات والإعداد')

    // حذفه يُرجع الأعضاء بلا فريق — لا عضو يتيم
    const del = await app.inject({ method: 'DELETE', url: `/api/team/teams/${team.id}`, headers: { cookie: admin.cookie } })
    expect([200, 204]).toContain(del.statusCode)
    const final = await roster(app, admin.cookie)
    expect(final.find((m) => m.id === creatorId)?.teamId).toBeNull()
  })

  it('الإضافة المباشرة صارت صادقة: حساب فعلي يُضاف جماعة، وبريد بلا حساب يُرجى فيه رابط دعوة (لا معلّق أبدًا)', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'tm-add@dalili.sa')

    // بريد بلا حساب → 409 يوجه للدعوة برابط (ثغرة «لا يدخل أبدًا» مغلقة)
    const ghost = await app.inject({
      method: 'POST',
      url: '/api/team',
      headers: { cookie: admin.cookie },
      payload: { email: 'ghost@dalili.sa', role: 'creator' },
    })
    expect(ghost.statusCode).toBe(409)

    // حساب فعلي (المنشئ عضو بالفعل — جرّب المشاهد الأول بلا عضوية؟ المشاهد عضو. أضف المالك لنفسه؟ موجود)
    // سجّل مستخدمًا مستقلًا له مساحته ثم أضفه مباشرة
    const outsider = await registerUser(app, 'tm-outsider@dalili.sa')
    const add = await app.inject({
      method: 'POST',
      url: '/api/team',
      headers: { cookie: admin.cookie },
      payload: { email: 'tm-outsider@dalili.sa', role: 'viewer' },
    })
    expect(add.statusCode).toBe(200)
    const rows = await roster(app, admin.cookie)
    expect(rows.some((m) => m.email === 'tm-outsider@dalili.sa' && m.role === 'viewer')).toBe(true)
    void outsider
    void creator
  })
})
