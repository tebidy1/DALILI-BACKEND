import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { buildTestApp, buildTestAppWithDir, registerUser } from './helpers'

let seq = 0

/** دليل بخطوتين — التعليقات الآن على مستوى الدليل، لكن الدليل يحتاج خطوات ليُنشأ */
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
          { id: 's1', kind: 'click', title: 'افتح الفواتير', target: {}, sensitive: false, url: 'https://erp.example.com/i', pageTitle: 'الفواتير', ts: 1 },
          { id: 's2', kind: 'click', title: 'اضغط جديد', target: {}, sensitive: false, url: 'https://erp.example.com/i', pageTitle: 'الفواتير', ts: 2 },
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

/** GM-05 تطوّر: تعليقات على مستوى الدليل بنوعين (مشكلة/تعليق) — بلا ربط خطوة */
describe('GM-05 تعليقات الدليل', () => {
  it('ضيف يبلّغ مشكلة عبر رابط المشاركة — على مستوى الدليل (stepId فارغ) وتظهر للطرفين', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm1@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل التعليقات')
    const token = await shareToken(app, cookie, gid)

    const add = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { kind: 'issue', body: '  الزر لا يظهر عندي في المتصفح  ', author: 'سعد' },
    })
    expect(add.statusCode).toBe(200)
    const comment = add.json().comment
    expect(comment.kind).toBe('issue')
    expect(comment.stepId).toBe('') // سنتينل «بلا خطوة»
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

  it('التعليق العام (note) يُخزَّن بنوعه ويميَّز عن المشكلة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm1b@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل النوعين')
    const token = await shareToken(app, cookie, gid)

    const note = await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'شكرًا، واضح' } })
    expect(note.json().comment.kind).toBe('note')
    const issue = await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'issue', body: 'خطأ هنا' } })
    expect(issue.json().comment.kind).toBe('issue')
  })

  it('رد على تعليق أصلي يعمل؛ والرد على رد مرفوض — عمق واحد فقط', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm2@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الردود')
    const token = await shareToken(app, cookie, gid)

    const root = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'سؤال' } })
    ).json().comment

    const reply = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { kind: 'note', body: 'رد من ضيف آخر', parentId: root.id },
    })
    expect(reply.statusCode).toBe(200)
    expect(reply.json().comment.parentId).toBe(root.id)

    const nested = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { kind: 'note', body: 'رد على الرد', parentId: reply.json().comment.id },
    })
    expect(nested.statusCode).toBe(400)
  })

  it('نوع مجهول أو نص فارغ أو أب من دليل آخر: 400 برسائل عربية', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm3@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل التحقق')
    const other = await createGuide(app, cookie, 'دليل آخر')
    const token = await shareToken(app, cookie, gid)
    const otherToken = await shareToken(app, cookie, other)

    const badKind = await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'bug', body: 'نص' } })
    expect(badKind.statusCode).toBe(400)

    // أصل في دليل آخر — لا يصلح أبًا هنا
    const foreignRoot = (
      await app.inject({ method: 'POST', url: `/api/share/${otherToken}/comments`, payload: { kind: 'note', body: 'أصل بدليل آخر' } })
    ).json().comment
    const crossParent = await app.inject({
      method: 'POST',
      url: `/api/share/${token}/comments`,
      payload: { kind: 'note', body: 'رد بأصل دليل آخر', parentId: foreignRoot.id },
    })
    expect(crossParent.statusCode).toBe(400)

    const empty = await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: '   ' } })
    expect(empty.statusCode).toBe(400)
    expect(empty.json().errorAr).toBeTruthy()
  })

  it('رمز مسحوب أو دليل في السلة: التعليق العام يرفض (404) ولا يكشف شيئًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm4@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل السلة')
    const token = await shareToken(app, cookie, gid)

    await app.inject({ method: 'DELETE', url: `/api/guides/${gid}`, headers: { cookie } }) // سلة
    const trashed = await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'نص' } })
    expect(trashed.statusCode).toBe(404)

    await app.inject({ method: 'POST', url: `/api/guides/${gid}/restore`, headers: { cookie } })
    await app.inject({ method: 'DELETE', url: `/api/guides/${gid}/share`, headers: { cookie } })
    const revoked = await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'نص' } })
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
      payload: { kind: 'note', body: 'تنبيه: هذا الدليل يتطلب صلاحية' },
    })
    expect(ownerAdd.statusCode).toBe(200)
    expect(ownerAdd.json().comment.isOwner).toBe(true)

    const guest = await app.inject({ method: 'GET', url: `/api/share/${token}/comments` })
    expect(guest.json().comments.some((c: { isOwner: boolean }) => c.isOwner)).toBe(true)

    const stranger = await registerUser(app, 'cm5b@dalili.sa')
    const strangerGet = await app.inject({ method: 'GET', url: `/api/guides/${gid}/comments`, headers: { cookie: stranger.cookie } })
    expect(strangerGet.statusCode).toBe(404)

    const anon = await app.inject({ method: 'GET', url: `/api/guides/${gid}/comments` })
    expect(anon.statusCode).toBe(401)
  })

  it('المالك يعدّل نص تعليقه ويسمّي الخيط محلولًا؛ الرد لا يُوسم محلولًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm6@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل التحرير')
    const token = await shareToken(app, cookie, gid)

    const root = (await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'issue', body: 'أصل' } })).json().comment
    const reply = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'issue', body: 'رد', parentId: root.id } })
    ).json().comment

    const edit = await app.inject({ method: 'PATCH', url: `/api/guides/${gid}/comments/${root.id}`, headers: { cookie }, payload: { body: 'أصل معدّل' } })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().comment.body).toBe('أصل معدّل')

    const resolve = await app.inject({ method: 'PATCH', url: `/api/guides/${gid}/comments/${root.id}`, headers: { cookie }, payload: { resolved: true } })
    expect(resolve.statusCode).toBe(200)
    expect(resolve.json().comment.resolved).toBe(true)

    const resolveReply = await app.inject({ method: 'PATCH', url: `/api/guides/${gid}/comments/${reply.id}`, headers: { cookie }, payload: { resolved: true } })
    expect(resolveReply.statusCode).toBe(400)

    const emptyPatch = await app.inject({ method: 'PATCH', url: `/api/guides/${gid}/comments/${root.id}`, headers: { cookie }, payload: {} })
    expect(emptyPatch.statusCode).toBe(400)
  })

  it('حذف الأصل يمحو خيطه كاملًا؛ وحذف رد يمحوه وحده', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm7@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الحذف')
    const token = await shareToken(app, cookie, gid)

    const root = (await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'أصل' } })).json().comment
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'رد1', parentId: root.id } })
    const reply2 = (
      await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'رد2', parentId: root.id } })
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

  it('قائمة المكتبة تحمل العدّادات — الكلي والمفتوحة والمشكلات وحدها — وتتبع الوسم محلولًا', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm8@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل العدادات')
    const other = await createGuide(app, cookie, 'دليل بلا تعليقات')
    const token = await shareToken(app, cookie, gid)

    // مشكلة (أصل) + ردّها + تعليق عام من المالك
    const issue = (await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'issue', body: 'مشكلة', author: 'سعد' } })).json().comment
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'issue', body: 'رد', parentId: issue.id } })
    await app.inject({ method: 'POST', url: `/api/guides/${gid}/comments`, headers: { cookie }, payload: { kind: 'note', body: 'ملاحظة من المالك' } })

    type Row = { id: string; commentCount: number; openCommentCount: number; openIssueCount: number }
    const before = (await app.inject({ method: 'GET', url: '/api/guides?limit=100', headers: { cookie } })).json().items as Row[]
    const mine = before.find((g) => g.id === gid)!
    expect(mine.commentCount).toBe(3) // مشكلة + رد + ملاحظة
    expect(mine.openCommentCount).toBe(2) // أصلان مفتوحان: المشكلة + الملاحظة
    expect(mine.openIssueCount).toBe(1) // المشكلة وحدها (لا الملاحظة ولا الرد)
    expect(before.find((g) => g.id === other)!.openIssueCount).toBe(0)

    await app.inject({ method: 'PATCH', url: `/api/guides/${gid}/comments/${issue.id}`, headers: { cookie }, payload: { resolved: true } })
    const after = (await app.inject({ method: 'GET', url: '/api/guides?limit=100', headers: { cookie } })).json().items as Row[]
    expect(after.find((g) => g.id === gid)!.openIssueCount).toBe(0) // حُلّت المشكلة
    expect(after.find((g) => g.id === gid)!.openCommentCount).toBe(1) // بقيت الملاحظة
  })

  it('تقرير المالك المجمّع يفصل المشكلات المفتوحة عن التعليقات العامة', async () => {
    const { app } = await buildTestApp()
    const { cookie } = await registerUser(app, 'cm8b@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل التقرير')
    const token = await shareToken(app, cookie, gid)

    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'issue', body: 'مشكلة ١' } })
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'issue', body: 'مشكلة ٢' } })
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'تعليق عام' } })

    const report = (await app.inject({ method: 'GET', url: '/api/reports/mine', headers: { cookie } })).json()
    expect(report.openIssues).toBe(2)
    expect(report.openComments).toBe(3) // مشكلتان + تعليق
  })

  it('الحذف الدائم للدليل يمحو تعليقاته من القاعدة — لا صفوف يتيمة', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'cm9@dalili.sa')
    const gid = await createGuide(app, cookie, 'دليل الحذف الدائم')
    const token = await shareToken(app, cookie, gid)
    await app.inject({ method: 'POST', url: `/api/share/${token}/comments`, payload: { kind: 'note', body: 'سيمحى' } })

    const del = await app.inject({ method: 'DELETE', url: `/api/guides/${gid}?permanent=1`, headers: { cookie } })
    expect(del.statusCode).toBe(204)

    const sqlite = new Database(path.join(dir, 'dalili.db'))
    const count = (sqlite.prepare('SELECT count(*) AS c FROM step_comments WHERE guide_id = ?').get(gid) as { c: number }).c
    sqlite.close()
    expect(count).toBe(0)
  })
})
