import Database from 'better-sqlite3'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTestApp, buildTestAppWithDir, randomTestPassword, registerUser } from './helpers'
import { assembleGuide } from '@dalili/core'

/**
 * المرحلة ب (الهوم): نقطة نهاية overview الواحدة (اسم المساحة + الدور + العدادات + المواقع)
 * وفلاتر القائمة الجديدة (visibility / creator / when) وحقل `mine` الصادق في الملخص.
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

/** مدير + عضو منشئ + عضو مشاهد عبر مسار الدعوات نفسه */
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

interface Overview {
  workspaceName: string
  myRole: string
  myEmail: string
  counts: { all: number; mine: number; published: number; saved: number }
  sites: { site: string; count: number }[]
}

async function overviewOf(app: InjectLike, cookie: string): Promise<Overview> {
  const r = await app.inject({ method: 'GET', url: '/api/library/overview', headers: { cookie } })
  expect(r.statusCode).toBe(200)
  return r.json() as Overview
}

describe('نظرة المكتبة overview (المرحلة ب — WS-06)', () => {
  it('المدير يرى اسم المساحة ودوره وعداداته ومواقعه — والسلة تُستثنى من العدادات', async () => {
    const { app } = await buildTestApp()
    const { admin } = await setupOrg(app, 'ov-admin@dalili.sa')
    const pub = await createGuide(app, admin.cookie, 'https://sap.example/fi')
    await publish(app, admin.cookie, pub)
    const priv = await createGuide(app, admin.cookie, 'https://crm.example/leads')

    const ov = await overviewOf(app, admin.cookie)
    expect(ov.workspaceName).toBe('مساحة ov-admin')
    expect(ov.myRole).toBe('admin')
    expect(ov.myEmail).toBe('ov-admin@dalili.sa')
    // الدليل الترحيبي (UX-05) يُزرع عند التسجيل فقط — المدير المُسجَّل يحمله، والمدعوّون لا
    expect(ov.counts).toEqual({ all: 3, mine: 3, published: 1, saved: 0 })
    expect(ov.sites).toEqual([
      { site: 'crm.example', count: 1 },
      { site: 'dalili.app', count: 1 },
      { site: 'sap.example', count: 1 },
    ])

    // السلة خارج كل العدادات — الموقع المحذوف يختفي من خيارات الفلتر
    await app.inject({ method: 'DELETE', url: `/api/guides/${priv}`, headers: { cookie: admin.cookie } })
    const after = await overviewOf(app, admin.cookie)
    expect(after.counts).toEqual({ all: 2, mine: 2, published: 1, saved: 0 })
    expect(after.sites).toEqual([
      { site: 'dalili.app', count: 1 },
      { site: 'sap.example', count: 1 },
    ])
  })

  it('العضو المنشئ: منشور الغير يدخل «الكل» و«المنشورة» لا «أدلتي» — والخاص الغير لا يدخل شيئًا', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'ovc-admin@dalili.sa')
    const pub = await createGuide(app, admin.cookie, 'https://sap.example/pub')
    await publish(app, admin.cookie, pub)
    await createGuide(app, admin.cookie, 'https://sap.example/secret')
    const own = await createGuide(app, creator.cookie, 'https://crm.example/own')

    const ov = await overviewOf(app, creator.cookie)
    expect(ov.myRole).toBe('creator')
    expect(ov.counts).toEqual({ all: 2, mine: 1, published: 1, saved: 0 })

    // بوكمارك على منشور الغير يرفع «المحفوظات» عند هذا العضو وحده
    await app.inject({ method: 'POST', url: `/api/guides/${pub}/bookmark`, headers: { cookie: creator.cookie } })
    const saved = await overviewOf(app, creator.cookie)
    expect(saved.counts.saved).toBe(1)

    // خيارات المواقع ترى نطاق الرؤية فقط: منشور الغير + أدلتي — لا سرّ الغير
    expect(saved.sites).toEqual([
      { site: 'crm.example', count: 1 },
      { site: 'sap.example', count: 1 },
    ])
    expect(ov.workspaceName).toBe('مساحة ovc-admin')
    void own
  })

  it('المشاهد: دوره مشاهد وأدلته صفر وكل ما يراه هو المنشور', async () => {
    const { app } = await buildTestApp()
    const { admin, viewer } = await setupOrg(app, 'ovv-admin@dalili.sa')
    const pub = await createGuide(app, admin.cookie, 'https://erp.example/gr')
    await publish(app, admin.cookie, pub)

    const ov = await overviewOf(app, viewer.cookie)
    expect(ov.myRole).toBe('viewer')
    expect(ov.counts).toEqual({ all: 1, mine: 0, published: 1, saved: 0 })
  })
})

describe('فلاتر القائمة الجديدة (المرحلة ب)', () => {
  it('creator=me/others يقسمان القائمة: أدلتي ولو خاصًا، ومنشور الزملاء دون خاصهم', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'flt-admin@dalili.sa')
    const pub = await createGuide(app, admin.cookie, 'https://sap.example/pub')
    await publish(app, admin.cookie, pub)
    await createGuide(app, admin.cookie, 'https://sap.example/secret')
    const own = await createGuide(app, creator.cookie, 'https://crm.example/own')

    const others = (await app.inject({
      method: 'GET',
      url: '/api/guides?creator=others',
      headers: { cookie: creator.cookie },
    })).json() as { items: { id: string }[] }
    expect(others.items.map((s) => s.id)).toEqual([pub])

    const mine = (await app.inject({
      method: 'GET',
      url: '/api/guides?creator=me',
      headers: { cookie: creator.cookie },
    })).json() as { items: { id: string }[] }
    expect(mine.items.map((s) => s.id)).toEqual([own])

    const adminMine = (await app.inject({
      method: 'GET',
      url: '/api/guides?creator=me',
      headers: { cookie: admin.cookie },
    })).json() as { total: number }
    // ٢ أدلة الاختبار + الترحيبي المزروع عند التسجيل
    expect(adminMine.total).toBe(3)
  })

  it('visibility=private/workspace يرشّحان الحالة ضمن النطاق المساحي', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'vis-admin@dalili.sa')
    const pub = await createGuide(app, admin.cookie, 'https://sap.example/pub')
    await publish(app, admin.cookie, pub)
    const own = await createGuide(app, creator.cookie, 'https://crm.example/own')

    const priv = (await app.inject({
      method: 'GET',
      url: '/api/guides?visibility=private',
      headers: { cookie: creator.cookie },
    })).json() as { items: { id: string }[] }
    expect(priv.items.map((s) => s.id)).toEqual([own])

    const ws = (await app.inject({
      method: 'GET',
      url: '/api/guides?visibility=workspace',
      headers: { cookie: creator.cookie },
    })).json() as { items: { id: string }[] }
    expect(ws.items.map((s) => s.id)).toEqual([pub])
  })

  it('when يقصّ على آخر تحديث — قصّ يدوي لتاريخ الدليل في القاعدة يُخرجه من «هذا الأسبوع» لا من «هذا الشهر»', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { creator } = await setupOrg(app, 'when-admin@dalili.sa')
    const old = await createGuide(app, creator.cookie, 'https://crm.example/old')
    const fresh = await createGuide(app, creator.cookie, 'https://crm.example/fresh')

    // تأريخ رجعي ١٠ أيام — عبر اتصال ثانٍ على نفس قاعدة الاختبار
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const raw = new Database(path.join(dir, 'dalili.db'))
    raw.prepare('UPDATE guides SET updated_at = ? WHERE id = ?').run(stale, old)
    raw.close()

    const week = (await app.inject({
      method: 'GET',
      url: '/api/guides?when=week',
      headers: { cookie: creator.cookie },
    })).json() as { items: { id: string }[] }
    expect(week.items.map((s) => s.id)).toEqual([fresh])

    const month = (await app.inject({
      method: 'GET',
      url: '/api/guides?when=month',
      headers: { cookie: creator.cookie },
    })).json() as { items: { id: string }[] }
    expect(month.items.map((s) => s.id).sort()).toEqual([fresh, old].sort())
  })

  it('mine في الملخص يصدق: أدلتي true ومنشور الغير false — ومعهما المشاهدات وبريد المنشئ', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'mineflag-admin@dalili.sa')
    const pub = await createGuide(app, admin.cookie, 'https://sap.example/pub')
    await publish(app, admin.cookie, pub)
    await app.inject({ method: 'POST', url: `/api/guides/${pub}/share`, headers: { cookie: admin.cookie } })
    const own = await createGuide(app, creator.cookie, 'https://crm.example/own')

    const list = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: creator.cookie } })).json() as {
      items: { id: string; mine: boolean; views: number; ownerEmail: string }[]
    }
    expect(list.items.find((s) => s.id === own)?.mine).toBe(true)
    expect(list.items.find((s) => s.id === pub)?.mine).toBe(false)
    // المشترَك يبدأ بصفر مشاهدات، والكاتب ظاهر ببريده (يبطاقة سكرايب «قبل ٣ أيام · أحمد»)
    expect(list.items.find((s) => s.id === pub)?.views).toBe(0)
    expect(list.items.find((s) => s.id === pub)?.ownerEmail).toBe('mineflag-admin@dalili.sa')
    expect(list.items.find((s) => s.id === own)?.ownerEmail).toBe('mineflag-admin-creator@dalili.sa')
  })
})
