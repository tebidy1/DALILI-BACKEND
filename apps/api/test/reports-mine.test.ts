import Database from 'better-sqlite3'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTestApp, buildTestAppWithDir, randomTestPassword, registerUser } from './helpers'
import { assembleGuide } from '@dalili/core'

/**
 * المرحلة ج (أنشئ بواسطي + التقارير): GET /api/reports/mine — التقرير المجمّع لأدلة العضو
 * على نفس نطاق القائمة (أدلتي الحيّة): عدد الأدلة · المنشور للمساحة · إجمالي المشاهدات
 * (VIEW-06) · تعليقات تنتظر ردًا (GM-05: أصول غير محلولة دون الردود).
 * السلة وغيري خارجها دائمًا، والمشاركة المسحوبة لا تُحسب مشاهداتها.
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

async function inviteCreator(app: Awaited<ReturnType<typeof buildTestApp>>['app'], adminEmail: string) {
  const admin = await registerUser(app, adminEmail)
  const inv = await app.inject({
    method: 'POST',
    url: '/api/team/invites',
    headers: { cookie: admin.cookie },
    payload: { email: `${adminEmail.split('@')[0]}-creator@dalili.sa`, role: 'creator' },
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
  return {
    admin,
    creator: { cookie: (Array.isArray(raw) ? raw[0] : raw)!.split(';')[0]! },
  }
}

interface InjectLike {
  inject: (o: {
    method: string
    url: string
    headers?: { cookie: string }
    payload?: unknown
  }) => PromiseLike<{ statusCode: number; json(): unknown }>
}

async function createGuide(app: InjectLike, cookie: string, url: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: { cookie },
    payload: { guide: guideFor(url) },
  })
  expect(res.statusCode).toBe(200)
  return (res.json() as { id: string }).id
}

async function publish(app: InjectLike, cookie: string, id: string) {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/guides/${id}/meta`,
    headers: { cookie },
    payload: { visibility: 'workspace' },
  })
  expect(res.statusCode).toBe(200)
}

interface MineReport {
  total: number
  published: number
  views: number
  openComments: number
  openIssues: number
}

async function myReport(app: InjectLike, cookie: string): Promise<MineReport> {
  const r = await app.inject({ method: 'GET', url: '/api/reports/mine', headers: { cookie } })
  expect(r.statusCode).toBe(200)
  return r.json() as MineReport
}

describe('تقرير «أدلتي» المجمّع (المرحلة ج — WS-06)', () => {
  it('عضو بلا أدلة: أصفار صادقة — لا دليل ترحيبي للمدعوّ ولا أرقام ملفقة', async () => {
    const { app } = await buildTestApp()
    const { creator } = await inviteCreator(app, 'rep-empty@dalili.sa')
    expect(await myReport(app, creator.cookie)).toEqual({ total: 0, published: 0, views: 0, openComments: 0, openIssues: 0 })
  })

  it('يجمع كل شيء: الأدلة والمنشور والمشاهدات (VIEW-06) وتنتظر ردًا (GM-05) — والسلة وأدلة غيري خارجها', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { admin, creator } = await inviteCreator(app, 'rep-all@dalili.sa')

    // أدلة المنشئ: منشور مشترك + خاص + محذوف للسلة
    const pub = await createGuide(app, creator.cookie, 'https://sap.example/pub')
    await publish(app, creator.cookie, pub)
    const share = await app.inject({
      method: 'POST',
      url: `/api/guides/${pub}/share`,
      headers: { cookie: creator.cookie },
    })
    expect(share.statusCode).toBe(200)
    const { token } = share.json() as { token: string }
    await createGuide(app, creator.cookie, 'https://crm.example/secret')
    const gone = await createGuide(app, creator.cookie, 'https://crm.example/gone')
    await app.inject({ method: 'DELETE', url: `/api/guides/${gone}`, headers: { cookie: creator.cookie } })

    // مشاهدتان على رابط المشاركة العلني — VIEW-06 عدّاد مجمّع
    expect((await app.inject({ method: 'POST', url: `/api/share/${token}/view` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'POST', url: `/api/share/${token}/view` })).statusCode).toBe(204)

    // أدلة المدير ومنشوره لا تسرب ولا مشاهدات ولا تعليقاته إلى تقرير المنشئ
    const adminPub = await createGuide(app, admin.cookie, 'https://erp.example/admin-pub')
    await publish(app, admin.cookie, adminPub)
    await app.inject({ method: 'POST', url: `/api/guides/${adminPub}/share`, headers: { cookie: admin.cookie } })
    await app.inject({ method: 'POST', url: `/api/guides/${adminPub}/comments`, headers: { cookie: admin.cookie }, payload: {} })

    // قبل التعليقات: أدلتي ٢ ومنشور ١ ومشاهدات ٢ وتنتظر ردًا ٠
    expect(await myReport(app, creator.cookie)).toEqual({ total: 2, published: 1, views: 2, openComments: 0, openIssues: 0 })

    // تعليقات على دليل المنشئ عبر اتصال ثانٍ: أصلان مفتوحان + أصل محلول + رد غير محلول
    const raw = new Database(path.join(dir, 'dalili.db'))
    const now = new Date().toISOString()
    const ins = raw.prepare(
      `INSERT INTO step_comments (id, guide_id, step_id, kind, parent_id, author, is_owner, body, resolved, created_at, updated_at)
       VALUES (?, ?, '', ?, ?, '', 0, '', ?, ?, ?)`,
    )
    ins.run('c-open-1', pub, 'issue', null, 0, now, now)
    ins.run('c-open-2', pub, 'issue', null, 0, now, now)
    ins.run('c-done', pub, 'issue', null, 1, now, now)
    ins.run('c-reply', pub, 'issue', 'c-open-1', 0, now, now)
    raw.close()

    // الأصول غير المحلولة وحدها تنتظر ردًا — الردود والمحلول ليسوا «انتظارًا»؛ وكلها مشكلات
    expect(await myReport(app, creator.cookie)).toEqual({ total: 2, published: 1, views: 2, openComments: 2, openIssues: 2 })
  })

  it('سحب المشاركة يُسقط مشاهداتها من التقرير — لا أرقام من رابط ميت', async () => {
    const { app } = await buildTestApp()
    const { creator } = await inviteCreator(app, 'rep-revoke@dalili.sa')
    const g = await createGuide(app, creator.cookie, 'https://sap.example/x')
    const share = await app.inject({
      method: 'POST',
      url: `/api/guides/${g}/share`,
      headers: { cookie: creator.cookie },
    })
    const { token } = share.json() as { token: string }
    await app.inject({ method: 'POST', url: `/api/share/${token}/view` })
    expect((await myReport(app, creator.cookie)).views).toBe(1)

    await app.inject({ method: 'DELETE', url: `/api/guides/${g}/share`, headers: { cookie: creator.cookie } })
    expect((await myReport(app, creator.cookie)).views).toBe(0)
  })
})
