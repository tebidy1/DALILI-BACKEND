import { describe, expect, it } from 'vitest'
import { buildTestApp, randomTestPassword, registerUser } from './helpers'
import { assembleGuide } from '@dalili/core'

/**
 * WS-02..05: الأساس الخفي للمساحة — الدليل خاص افتراضيًا والنشر للمساحة صريح،
 * والقوائم والبحث والتفصيل ترى «مَلكي + منشور المساحة»، والأدوار الثلاثة مقيَّدة فعليًا،
 * والبوكمارك لكل عضو، والموقع مشتق من أول خطوة وقابل للترشيح.
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

interface Session {
  cookie: string
}

/** مدير + عضو منشئ + عضو مشاهد عبر مسار الدعوات نفسه (إثبات الحلقة كاملة) */
async function setupOrg(app: Awaited<ReturnType<typeof buildTestApp>>['app'], adminEmail: string) {
  const admin = await registerUser(app, adminEmail)

  async function invite(role: 'creator' | 'viewer', email: string): Promise<Session> {
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

describe('النطاق المساحي والنشر الصريح (WS-02)', () => {
  it('الافتراضي خاص: دليل المدير لا يراه العضو حتى ينشره، وبعد السحب يختفي', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'scope-admin@dalili.sa')
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/invoices')

    // خاص افتراضيًا في الملخص
    const adminList = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: admin.cookie } })).json() as {
      items: { id: string; visibility: string }[]
    }
    expect(adminList.items.find((s) => s.id === gid)?.visibility).toBe('private')

    // العضو لا يراه لا في القائمة ولا بالتفصيل
    const before = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: creator.cookie } })).json() as {
      items: { id: string }[]
    }
    expect(before.items.find((s) => s.id === gid)).toBeUndefined()
    const hidden = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie: creator.cookie } })
    expect(hidden.statusCode).toBe(404)

    // النشر صريح من المالك عبر meta
    const publish = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie: admin.cookie },
      payload: { visibility: 'workspace' },
    })
    expect(publish.statusCode).toBe(200)
    expect((publish.json() as { visibility: string }).visibility).toBe('workspace')

    // الآن العضو يراه في القائمة والتفصيل
    const after = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: creator.cookie } })).json() as {
      items: { id: string }[]
    }
    expect(after.items.find((s) => s.id === gid)).toBeTruthy()
    const shown = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie: creator.cookie } })
    expect(shown.statusCode).toBe(200)
    expect((shown.json() as { guide: { title: string } }).guide.title).toBeTruthy()

    // السحب يعيده مخفيًا
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie: admin.cookie },
      payload: { visibility: 'private' },
    })
    const final = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: creator.cookie } })).json() as {
      items: { id: string }[]
    }
    expect(final.items.find((s) => s.id === gid)).toBeUndefined()
  })

  it('العضو يرى «مَلكي» دائمًا ولو خاصًا، ولا يعدّل دليل غيره ولا ينشره', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'mine-admin@dalili.sa')
    const adminGuide = await createGuide(app, admin.cookie, 'https://sap.example/fi')
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${adminGuide}/meta`,
      headers: { cookie: admin.cookie },
      payload: { visibility: 'workspace' },
    })

    // المنشئ ينشئ دليله الخاص — يراه هو في القائمة
    const mine = await createGuide(app, creator.cookie, 'https://crm.example/leads')
    const list = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: creator.cookie } })).json() as {
      items: { id: string; visibility: string }[]
    }
    expect(list.items.find((s) => s.id === mine)?.visibility).toBe('private')
    expect(list.items.find((s) => s.id === adminGuide)).toBeTruthy()

    // لا تحرير محتوى لدليل غيره ولا نشر له — 404 صدقًا لا تسريب وجود
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${adminGuide}`,
      headers: { cookie: creator.cookie },
      payload: { guide: guideFor('https://sap.example/fi') },
    })
    expect(edit.statusCode).toBe(404)
    const publishOther = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${adminGuide}/meta`,
      headers: { cookie: creator.cookie },
      payload: { visibility: 'private' },
    })
    expect(publishOther.statusCode).toBe(404)

    // ولا حذف لدليل غيره
    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${adminGuide}`, headers: { cookie: creator.cookie } })
    expect(del.statusCode).toBe(404)
  })

  it('البحث يرى منشور المساحة: العضو يجد بكلمة من عنوان دليل المدير المنشور لا الخاص', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'search-admin@dalili.sa')

    const pub = guideFor('https://erp.example/invoices')
    pub.title = 'إخراج فاتورة نهائية'
    const pubRes = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie: admin.cookie },
      payload: { guide: pub },
    })
    const pubId = (pubRes.json() as { id: string }).id
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${pubId}/meta`,
      headers: { cookie: admin.cookie },
      payload: { visibility: 'workspace' },
    })

    const priv = guideFor('https://erp.example/salaries')
    priv.title = 'مراجعات الرواتب السرية'
    await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie: admin.cookie }, payload: { guide: priv } })

    const hit = (await app.inject({
      method: 'GET',
      url: '/api/search?q=' + encodeURIComponent('فاتورة نهائية'),
      headers: { cookie: creator.cookie },
    })).json() as { hits: { guideId: string }[] }
    expect(hit.hits.map((h) => h.guideId)).toContain(pubId)

    const secretHit = (await app.inject({
      method: 'GET',
      url: '/api/search?q=' + encodeURIComponent('رواتب'),
      headers: { cookie: creator.cookie },
    })).json() as { hits: unknown[] }
    expect(secretHit.hits.length).toBe(0)
  })

  it('عزل المساحات: عضو مساحة ثانية لا يرى منشور الأول شيئًا', async () => {
    const { app } = await buildTestApp()
    const orgA = await setupOrg(app, 'iso-a@dalili.sa')
    const orgB = await setupOrg(app, 'iso-b@dalili.sa')

    const gid = await createGuide(app, orgA.admin.cookie, 'https://a.example/only')
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie: orgA.admin.cookie },
      payload: { visibility: 'workspace' },
    })

    const outsider = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: orgB.creator.cookie } })).json() as {
      items: { id: string }[]
    }
    expect(outsider.items.find((s) => s.id === gid)).toBeUndefined()
    const denied = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie: orgB.creator.cookie } })
    expect(denied.statusCode).toBe(404)
  })
})

describe('الأدوار الثلاثة مقيَّدة (WS-03)', () => {
  it('المشاهد: لا إنشاء دليل ولا مجلد ولا تحرير — ويقرأ المنشور ويعلّمه نجمة بوكمارك', async () => {
    const { app } = await buildTestApp()
    const { admin, viewer } = await setupOrg(app, 'roles-admin@dalili.sa')
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/gr')
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie: admin.cookie },
      payload: { visibility: 'workspace' },
    })

    const noCreate = await app.inject({
      method: 'POST',
      url: '/api/guides',
      headers: { cookie: viewer.cookie },
      payload: { guide: guideFor('https://x.example/1') },
    })
    expect(noCreate.statusCode).toBe(403)
    expect((noCreate.json() as { errorAr: string }).errorAr).toContain('مشاهد')

    const noFolder = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie: viewer.cookie },
      payload: { name: 'مجلد المشاهد' },
    })
    expect(noFolder.statusCode).toBe(403)

    const noEdit = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}`,
      headers: { cookie: viewer.cookie },
      payload: { guide: guideFor('https://erp.example/gr') },
    })
    // حراسة الدور تسبق فحص الملكية — رسالة «مشاهد» لا تكشف وجود أي دليل
    expect(noEdit.statusCode).toBe(403)

    // القراءة والبوكمارك متاحان للمشاهد
    const read = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie: viewer.cookie } })
    expect(read.statusCode).toBe(200)
    const mark = await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/bookmark`,
      headers: { cookie: viewer.cookie },
    })
    expect(mark.statusCode).toBe(200)
    expect((mark.json() as { bookmarked: boolean }).bookmarked).toBe(true)
  })
})

describe('البوكمارك (WS-04)', () => {
  it('تبديل البوكمارك لكل عضو بمعزل عن غيره، وفلتر saved يقتصر عليه، والملخص يحمل bookmarked', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'bm-admin@dalili.sa')
    const gid = await createGuide(app, admin.cookie, 'https://erp.example/bm')
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie: admin.cookie },
      payload: { visibility: 'workspace' },
    })

    const on = await app.inject({ method: 'POST', url: `/api/guides/${gid}/bookmark`, headers: { cookie: creator.cookie } })
    expect(on.json()).toEqual({ bookmarked: true })
    // المالك نفسه لم يعلمه
    const ownerView = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: admin.cookie } })).json() as {
      items: { id: string; bookmarked: boolean }[]
    }
    expect(ownerView.items.find((s) => s.id === gid)?.bookmarked).toBe(false)

    const saved = (await app.inject({ method: 'GET', url: '/api/guides?saved=true', headers: { cookie: creator.cookie } })).json() as {
      items: { id: string }[]
      total: number
    }
    expect(saved.items.map((s) => s.id)).toContain(gid)
    expect(saved.total).toBe(1)

    const off = await app.inject({ method: 'POST', url: `/api/guides/${gid}/bookmark`, headers: { cookie: creator.cookie } })
    expect(off.json()).toEqual({ bookmarked: false })
    const savedAfter = (await app.inject({ method: 'GET', url: '/api/guides?saved=true', headers: { cookie: creator.cookie } })).json() as {
      total: number
    }
    expect(savedAfter.total).toBe(0)

    // دليل لا يراه العضو لا يُعلَّم
    const hidden = await createGuide(app, admin.cookie, 'https://erp.example/secret')
    const denied = await app.inject({
      method: 'POST',
      url: `/api/guides/${hidden}/bookmark`,
      headers: { cookie: creator.cookie },
    })
    expect(denied.statusCode).toBe(404)
  })
})

describe('موقع الدليل المشتق (WS-05)', () => {
  it('site يُشتق من أول خطوة عند الإنشاء ويظهر بالملخص ويُرشَّح به', async () => {
    const { app } = await buildTestApp()
    const { admin, creator } = await setupOrg(app, 'site-admin@dalili.sa')
    const sap = await createGuide(app, admin.cookie, 'https://www.SAP.example/fi')
    const crm = await createGuide(app, admin.cookie, 'https://crm.example/leads')
    for (const id of [sap, crm]) {
      await app.inject({
        method: 'PATCH',
        url: `/api/guides/${id}/meta`,
        headers: { cookie: admin.cookie },
        payload: { visibility: 'workspace' },
      })
    }

    const list = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: creator.cookie } })).json() as {
      items: { id: string; site: string }[]
    }
    expect(list.items.find((s) => s.id === sap)?.site).toBe('sap.example')
    expect(list.items.find((s) => s.id === crm)?.site).toBe('crm.example')

    const filtered = (await app.inject({
      method: 'GET',
      url: '/api/guides?site=sap.example',
      headers: { cookie: creator.cookie },
    })).json() as { items: { id: string }[] }
    expect(filtered.items.map((s) => s.id)).toEqual([sap])
  })

  it('تحرير المحتوى يعيد اشتقاق الموقع من أول خطوة الجديدة', async () => {
    const { app } = await buildTestApp()
    const { admin } = await setupOrg(app, 'site-edit-admin@dalili.sa')
    const gid = await createGuide(app, admin.cookie, 'https://old.example/one')
    const edited = guideFor('https://new.example/two')
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}`,
      headers: { cookie: admin.cookie },
      payload: { guide: edited },
    })
    const list = (await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie: admin.cookie } })).json() as {
      items: { id: string; site: string }[]
    }
    expect(list.items.find((s) => s.id === gid)?.site).toBe('new.example')
  })
})
