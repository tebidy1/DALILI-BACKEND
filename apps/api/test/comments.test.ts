import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { buildTestApp, buildTestAppWithDir, registerUser } from './helpers'

let seq = 0

/** دليل بخطوتين معروفتي المعرفين — للتعليق على خطوة بعينها */
async function createGuide(app: import('fastify').FastifyInstance, cookie: string, title: string) {
  const now = new Date().toISOString()
  const res = await app.inject({
    method: 'POST',
    url: '/api/guides',
    headers: { cookie },
    payload: {
      guide: {
        id: `cm-${Date.now()}-${seq++}`,
        schemaVersion: 1,
        title,
        locale: 'ar',
        dir: 'rtl',
        createdAt: now,
        updatedAt: now,
        steps: [
          {
            id: 's1',
            kind: 'click',
            title: 'افتح الفواتير',
            target: {},
            sensitive: false,
            url: 'https://erp.example.com/i',
            pageTitle: 'الفواتير',
            ts: 1,
          },
          {
            id: 's2',
            kind: 'click',
            title: 'اضغط جديد',
            target: {},
            sensitive: false,
            url: 'https://erp.example.com/i',
            pageTitle: 'الفواتير',
            ts: 2,
          },
        ],
      },
    },
  })
  return res.json().id as string
}

async function shareToken(app: import('fastify').FastifyInstance, cookie: string, gid: string) {
  const res = await app.inject({ method: 'POST', url: `/api/guides/${gid}/share`, headers: { cookie } })
  return res.json().token as string
}

/** GM-05: تعليقات على الخطوة — ضيف برابط المشاركة يعلّق، والمالك يردّ ويعدّل ويسمّي محلولًا */
describe('GM-05 تعليقات الخطوات', () => {
  it('ضيف يعلّق على خطوة عبر رابط المشاركة ويظهر التعليق للضيف والمالك معًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm1@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل التعليقات')
    const token = await shareToken(app, cookie, gid)

    const add = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 's1', body: '  الزر لا يظهر عندي في المتصفح  ', author: 'سعد' },
    })
    expect(add.statusCode).toBe(200)
    const comment = add.json().comment
    expect(comment.stepId).toBe('s1')
    expect(comment.body).toBe('الزر لا يظهر عندي في المتصفح')
    expect(comment.author).toBe('سعد')
    expect(comment.isOwner).toBe(false)
    expect(comment.parentId).toBeNull()

    const guest = await app.inject({ method: 'GET', url: `/api/share/${token}/comments` })
    expect(guest.statusCode).toBe(200)
    expect(guest.json().comments).toHaveLength(1)

    const owner = await app.inject({ method: 'GET', url: `/api/guides/${gid}/comments`, headers: { cookie } })
    expect(owner.statusCode).toBe(200)
    expect(owner.json().comments[0].body).toBe('الزر لا يظهر عندي في المتصفح')
  })

  it('رد على تعليق أصلي يعمل؛ والرد على رد مرفوض — عمق واحد فقط', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm2@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الردود')
    const token = await shareToken(app, cookie, gid)

    const root = (
      await app.inject({
        method: 'POST',
        url: `/api/share/${token}/comments`,
        payload: { stepId: 's1', body: 'سؤال' },
      })
    ).json().comment

    const reply = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 's1', body: 'رد من ضيف آخر', parentId: root.id },
    })
    expect(reply.statusCode).toBe(200)
    expect(reply.json().comment.parentId).toBe(root.id)

    const nested = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 's1', body: 'رد على الرد', parentId: reply.json().comment.id },
    })
    expect(nested.statusCode).toBe(400)
  })

  it('خطوة غير موجودة أو أب من خطوة أخرى أو نص فارغ: 400 برسائل عربية', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm3@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل التحقق')
    const token = await shareToken(app, cookie, gid)

    const badStep = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 'nope', body: 'نص' },
    })
    expect(badStep.statusCode).toBe(400)
    expect(badStep.json().errorAr).toContain('الخطوة')

    const s2comment = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's2', body: 'أصل على خطوة أخرى' } })
    ).json().comment
    const crossParent = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 's1', body: 'رد بأصل خطوة أخرى', parentId: s2comment.id },
    })
    expect(crossParent.statusCode).toBe(400)

    const empty = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 's1', body: '   ' },
    })
    expect(empty.statusCode).toBe(400)
    expect(empty.json().errorAr).toBeTruthy()
  })

  it('رمز مسحوب أو دليل في السلة: التعليق العام يرفض (404) ولا يكشف شيئًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm4@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل السلة')
    const token = await shareToken(app, cookie, gid)

    await app.inject({ method: 'DELETE', url: `/api/guides/${gid}`, headers: { cookie } }) // سلة
    const trashed = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 's1', body: 'نص' },
    })
    expect(trashed.statusCode).toBe(404)

    await app.inject({ method: 'POST', url: `/api/guides/${gid}/restore`, headers: { cookie } })
    await app.inject({ method: 'DELETE', url: `/api/guides/${gid}/share`, headers: { cookie } })
    const revoked = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { stepId: 's1', body: 'نص' },
    })
    expect(revoked.statusCode).toBe(404)
  })

  it('المالك يعلّق من المحرر بعلامة صاحب الدليل؛ وغيره لا يرى تعليقات دليله', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm5@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل المالك')
    const token = await shareToken(app, cookie, gid)

    const ownerAdd = await app.inject({
      method: 'POST',
      url: `/api/guides/${gid}/comments`,
      headers: { cookie },
      payload: { stepId: 's1', body: 'تنبيه: هذه الخطوة تتطلب صلاحية' },
    })
    expect(ownerAdd.statusCode).toBe(200)
    expect(ownerAdd.json().comment.isOwner).toBe(true)

    // ضيف يرى تعليق المالك في عرضه العام
    const guest = await app.inject({ method: 'GET', url: `/api/share/${token}/comments` })
    expect(guest.json().comments.some((c: { isOwner: boolean }) => c.isOwner)).toBe(true)

    const stranger = await registerUser(app, 'cm5b@dalili.sa')
    const strangerGet = await app.inject({
      method: 'GET',
      url: `/api/guides/${gid}/comments`,
      headers: { cookie: stranger.cookie },
    })
    expect(strangerGet.statusCode).toBe(404)

    const anon = await app.inject({ method: 'GET', url: `/api/guides/${gid}/comments` })
    expect(anon.statusCode).toBe(401)
  })

  it('المالك يعدّل نص تعليقه ويسمّي الخيط محلولًا؛ الرد لا يُوسم محلولًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm6@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل التحرير')
    const token = await shareToken(app, cookie, gid)

    const root = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's1', body: 'أصل' } })
    ).json().comment
    const reply = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's1', body: 'رد', parentId: root.id } })
    ).json().comment

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/comments/${root.id}`,
      headers: { cookie },
      payload: { body: 'أصل معدّل' },
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().comment.body).toBe('أصل معدّل')

    const resolve = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/comments/${root.id}`,
      headers: { cookie },
      payload: { resolved: true },
    })
    expect(resolve.statusCode).toBe(200)
    expect(resolve.json().comment.resolved).toBe(true)

    const resolveReply = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/comments/${reply.id}`,
      headers: { cookie },
      payload: { resolved: true },
    })
    expect(resolveReply.statusCode).toBe(400)

    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: `/api/guides/${gid}/comments/${root.id}`,
      headers: { cookie },
      payload: {},
    })
    expect(emptyPatch.statusCode).toBe(400)
  })

  it('حذف الأصل يمحو خيطه كاملًا؛ وحذف رد يمحوه وحده', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm7@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الحذف')
    const token = await shareToken(app, cookie, gid)

    const root = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's2', body: 'أصل' } })
    ).json().comment
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's2', body: 'رد1', parentId: root.id } })
    const reply2 = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's2', body: 'رد2', parentId: root.id } })
    ).json().comment

    const delReply = await app.inject({ method: 'DELETE', url: `/api/guides/${gid}/comments/${reply2.id}`, headers: { cookie } })
    expect(delReply.statusCode).toBe(204)
    let list = (await app.inject({ method: 'GET', url: `/api/guides/${gid}/comments`, headers: { cookie } })).json().comments
    expect(list).toHaveLength(2)

    const delRoot = await app.inject({ method: 'DELETE', url: `/api/guides/${gid}/comments/${root.id}`, headers: { cookie } })
    expect(delRoot.statusCode).toBe(204)
    list = (await app.inject({ method: 'GET', url: `/api/guides/${gid}/comments`, headers: { cookie } })).json().comments
    expect(list).toHaveLength(0)
  })

  it('قائمة المكتبة تحمل عددي التعليقات — الكلي والمفتوحة — وتتبع الوسم محلولًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm8@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل العدادات')
    const other = await createGuide(app, cookie, 'دليل بلا تعليقات')
    const token = await shareToken(app, cookie, gid)

    const root = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's1', body: 'أصل', author: 'سعد' } })
    ).json().comment
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's1', body: 'رد', parentId: root.id } })
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/comments`, headers: { cookie }, payload: { stepId: 's2', body: 'من المالك' } })

    const before = (
      await app.inject({ method: 'GET', url: '/api/guides?limit=100', headers: { cookie } })
    ).json().items as { id: string; commentCount: number; openCommentCount: number }[]
    const mine = before.find((g) => g.id === gid)!
    expect(mine.commentCount).toBe(3)
    expect(mine.openCommentCount).toBe(2) // خيط الضيف + تعليق المالك المستقل
    expect(before.find((g) => g.id === other)!.commentCount).toBe(0)

    await app.inject({ method: 'PATCH', url: `/api/guides/${gid}/comments/${root.id}`, headers: { cookie }, payload: { resolved: true } })
    const after = (
      await app.inject({ method: 'GET', url: '/api/guides?limit=100', headers: { cookie } })
    ).json().items as { id: string; commentCount: number; openCommentCount: number }[]
    expect(after.find((g) => g.id === gid)!.openCommentCount).toBe(1)
  })

  it('الحذف الدائم للدليل يمحو تعليقاته من القاعدة — لا صفوف يتيمة', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'cm9@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الحذف الدائم')
    const token = await shareToken(app, cookie, gid)
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { stepId: 's1', body: 'سيمحى' } })

    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${gid}?permanent=1`, headers: { cookie } })
    expect(del.statusCode).toBe(204)

    const sqlite = new Database(path.join(dir, 'dalili.db'))
    const count = (sqlite.prepare('SELECT count(*) AS c FROM step_comments WHERE guide_id = ?').get(gid) as { c: number }).c
    sqlite.close()
    expect(count).toBe(0)
  })
})
