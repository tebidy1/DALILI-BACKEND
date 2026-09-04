import { describe, expect, it } from 'vitest'
import { buildTestApp, registerUser } from './helpers'
import { isTrashExpired } from '../src/lib/trash'

let seq = 0
async function createGuide(
  app: import('fastify').FastifyInstance,
  cookie: string,
  title: string,
  steps: unknown[] = [],
) {
  const now = new Date().toISOString()
  const res = await app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: { cookie },
    payload: {
      guide: {
        id: `t-${Date.now()}-${seq++}`,
        schemaVersion: 1,
        title,
        locale: 'ar',
        dir: 'rtl',
        createdAt: now,
        updatedAt: now,
        steps,
      },
    },
  })
  if (res.statusCode !== 200) throw new Error(`createGuide ${res.statusCode}: ${res.body}`)
  return res.json().id as string
}

const ONE_STEP = [
  {
    id: 'st-1',
    kind: 'click',
    title: 'افتح الشاشة',
    target: {},
    sensitive: false,
    url: 'https://erp.example/x',
    pageTitle: 'الشاشة',
    ts: 1,
  },
]

describe('LIB-01: ترقيم وفرز قائمة الأدلة', () => {
  it('مظروف {items,total,page,limit} مع فرز بالعنوان وترقيم صفحات', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'lib1@dalili.sa')
    await createGuide(app, cookie, 'A-دليل')
    await createGuide(app, cookie, 'C-دليل')
    await createGuide(app, cookie, 'B-دليل')

    const asc = await app.inject({
      method: 'GET',
      url: '/api/guides?sort=title&order=asc&limit=2',
      headers: { cookie },
    })
    expect(asc.statusCode).toBe(200)
    const body = asc.json()
    // UX-05: +الدليل الترحيبي الذي يُزرع عند التسجيل (يأتي آخر الترتيب اللاتيني/العربي)
    expect(body.total).toBe(4)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].title).toBe('A-دليل')
    expect(body.items[0]).toMatchObject({ starred: false, folderId: null, tags: [] })

    const page2 = await app.inject({
      method: 'GET',
      url: '/api/guides?sort=title&order=asc&limit=2&page=2',
      headers: { cookie },
    })
    expect(page2.json().items).toHaveLength(2)
    expect(page2.json().items[0].title).toBe('C-دليل')
    expect(page2.json().items[1].title).toContain('مرحبًا')

    const desc = await app.inject({
      method: 'GET',
      url: '/api/guides?sort=title&order=desc',
      headers: { cookie },
    })
    expect(desc.json().items[0].title).toContain('مرحبًا')
  })
})

describe('LIB-02: مجلدات بمستوى واحد', () => {
  it('إنشاء/إعادة تسمية/عدّاد — نقل دليل — حذف المجلد يعيد الدليل للجذر', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'lib2@dalili.sa')

    const bad = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: '   ' },
    })
    expect(bad.statusCode).toBe(400)

    const created = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie },
      payload: { name: 'الموارد البشرية' },
    })
    expect(created.statusCode).toBe(200)
    const folder = created.json()
    expect(folder.name).toBe('الموارد البشرية')

    const gid = await createGuide(app, cookie, 'دليل مجلدي')
    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie },
      payload: { folderId: folder.id },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().folderId).toBe(folder.id)

    const inFolder = await app.inject({
      method: 'GET',
      url: `/api/guides?folder=${folder.id}`,
      headers: { cookie },
    })
    expect(inFolder.json().total).toBe(1)

    const folders = await app.inject({ method: 'GET', url: '/api/folders', headers: { cookie } })
    expect(folders.json()[0]).toMatchObject({ name: 'الموارد البشرية', count: 1 })

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/folders/${folder.id}`,
      headers: { cookie },
      payload: { name: 'المشتريات' },
    })
    expect(renamed.json().name).toBe('المشتريات')

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/folders/${folder.id}`,
      headers: { cookie },
    })
    expect(del.statusCode).toBe(204)
    const after = await app.inject({ method: 'GET', url: '/api/folders', headers: { cookie } })
    expect(after.json()).toHaveLength(0)
    const rootAgain = await app.inject({
      method: 'GET',
      url: `/api/guides/${gid}`,
      headers: { cookie },
    })
    expect(rootAgain.statusCode).toBe(200)
  })
})

describe('LIB-03: مفضّلة ووسوم تدخل فهرس البحث', () => {
  it('نجمة تفلتر، ووسم يفلتر ويُبحث', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'lib3@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الوسوم')

    const star = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie },
      payload: { starred: true },
    })
    expect(star.json().starred).toBe(true)
    const starredList = await app.inject({
      method: 'GET',
      url: '/api/guides?starred=1',
      headers: { cookie },
    })
    expect(starredList.json().total).toBe(1)

    const tooMany = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie },
      payload: { tags: Array.from({ length: 11 }, (_, i) => `و${i}`) },
    })
    expect(tooMany.statusCode).toBe(400)

    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie },
      payload: { tags: ['فاتورة', 'مشتريات'] },
    })
    const byTag = await app.inject({
      method: 'GET',
      url: `/api/guides?tag=${encodeURIComponent('فاتورة')}`,
      headers: { cookie },
    })
    expect(byTag.json().total).toBe(1)

    const search = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('مشتريات')}`,
      headers: { cookie },
    })
    expect(search.statusCode).toBe(200)
    const hits = search.json().hits
    expect(hits.some((h: { guideId: string; field: string }) => h.guideId === gid && h.field === 'tag')).toBe(
      true,
    )
  })

  it('الوسم بترقيم داخلي يبقى قابلًا للبحث — انحدار مكتشف حيًّا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'lib3b@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الوسم المشتقّ')
    // PATCH يخزّن الوسم مطبَّعًا بلا ترقيم — ثم يُستبدل بالوسم الأخير فقط (استبدال كامل بالتصميم)
    await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/meta`,
      headers: { cookie },
      payload: { tags: ['وسم-الإثبات'] },
    })
    const dashSearch = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('الإثبات')}`,
      headers: { cookie },
    })
    expect(
      dashSearch.json().hits.some((h: { guideId: string; field: string }) => h.guideId === gid && h.field === 'tag'),
    ).toBe(true)
  })
})

describe('LIB-04: تكرار الدليل', () => {
  it('نسخة بعنوان «نسخة من …» بنفس الخطوات وبلا مشاركة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'lib4@dalili.sa')
    const gid = await createGuide(app, cookie, 'أصل التكرار', ONE_STEP)

    const dup = await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/duplicate`,
      headers: { cookie },
    })
    expect(dup.statusCode).toBe(200)
    const newId = dup.json().id
    expect(newId).not.toBe(gid)

    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    const copy = list.json().items.find((i: { id: string }) => i.id === newId)
    expect(copy.title).toContain('نسخة من')
    expect(copy.stepCount).toBe(1)
    expect(copy.shared).toBe(false)
    const original = list.json().items.find((i: { id: string }) => i.id === gid)
    expect(original).toBeTruthy()
  })
})

describe('LIB-06: سلة محذوفات 30 يومًا', () => {
  it('حذف → إخفاء من القائمة والبحث وإلغاء المشاركة → استعادة تعيد كل شيء', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'lib6@dalili.sa')
    const gid = await createGuide(app, cookie, 'ضحية السلة الفريدة', ONE_STEP)

    const share = await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/share`,
      headers: { cookie },
    })
    const token = share.json().token

    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${gid}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)

    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    // الدليل الترحيبي (UX-05) يبقى — الحذف طال دليل الاختبار وحده
    expect(list.json().total).toBe(1)
    expect(list.json().items[0].title).toContain('مرحبًا')

    const trash = await app.inject({ method: 'GET', url: '/api/guides?trash=1', headers: { cookie } })
    expect(trash.json().total).toBe(1)
    expect(trash.json().items[0].deletedAt).toBeTruthy()

    const publicShare = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(publicShare.statusCode).toBe(404)

    const searchHidden = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('الفريدة')}`,
      headers: { cookie },
    })
    expect(searchHidden.json().total).toBe(0)

    const restore = await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/restore`,
      headers: { cookie },
    })
    expect(restore.statusCode).toBe(200)
    const back = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    // الدليل المستعاد + الدليل الترحيبي (UX-05)
    expect(back.json().total).toBe(2)
    const searchBack = await app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('الفريدة')}`,
      headers: { cookie },
    })
    expect(searchBack.json().total).toBeGreaterThanOrEqual(1)
  })

  it('الحذف الدائم يفرّغ السلة نهائيًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'lib6b@dalili.sa')
    const gid = await createGuide(app, cookie, 'للحذف الدائم')
    await app.inject({ method: 'DELETE', url: `/api/guides/${gid}`, headers: { cookie } })
    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/guides/${gid}?permanent=1`,
      headers: { cookie },
    })
    expect(gone.statusCode).toBe(204)
    const trash = await app.inject({ method: 'GET', url: '/api/guides?trash=1', headers: { cookie } })
    expect(trash.json().total).toBe(0)
    const row = await app.inject({ method: 'GET', url: `/api/guides/${gid}`, headers: { cookie } })
    expect(row.statusCode).toBe(404)
  })

  it('منطق التقادم: 30 يومًا كاملة حيّ، وما بعدها منتهٍ', () => {
    const deletedAt = '2026-01-01T00:00:00.000Z'
    expect(isTrashExpired(deletedAt, '2026-01-31T00:00:00.000Z')).toBe(false)
    expect(isTrashExpired(deletedAt, '2026-01-31T00:00:00.001Z')).toBe(true)
  })
})
