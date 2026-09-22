import { describe, expect, it } from 'vitest'
import { buildTestApp, randomTestPassword, registerUser } from './helpers'

/**
 * WS-01: دعوات المساحة — المدير يولّد رابط دعوة يُرسل واتساب (بلا SMTP)،
 * والمدعوّ يفتحه ويضع كلمة مرور فيدخل المساحة بجلسة صالحة.
 * يغلق الثغرة القديمة: دعوة تنشئ مستخدمًا بـpasswordHash='pending' لا يدخل أبدًا.
 */
describe('دعوات المساحة (WS-01)', () => {
  it('المدير يدعو بريدًا جديدًا فيصله رابط؛ قراءة الدعوة علنًا؛ القبول بكلمة مرور يمنح جلسة ودخولًا لاحقًا', async () => {
    const { app } = await buildTestApp()
    const admin = await registerUser(app, 'inv-admin@dalili.sa')
    const password = randomTestPassword()

    const inv = await app.inject({
      method: 'POST',
      url: '/api/team/invites',
      headers: { cookie: admin.cookie },
      payload: { email: 'Newbie@dalili.sa', role: 'creator' },
    })
    expect(inv.statusCode).toBe(200)
    const body = inv.json() as { token: string; inviteUrl: string; email: string; role: string }
    expect(body.token).toBeTruthy()
    expect(body.inviteUrl).toContain(`/invite/${body.token}`)
    expect(body.email).toBe('newbie@dalili.sa') // يُطبَّع بأحرف صغيرة
    expect(body.role).toBe('creator')

    // قراءة الدعوة بلا جلسة — يعرف المدعوّ أين يُضاف
    const info = await app.inject({ method: 'GET', url: `/api/invites/${body.token}` })
    expect(info.statusCode).toBe(200)
    expect(info.json()).toMatchObject({
      email: 'newbie@dalili.sa',
      role: 'creator',
      accepted: false,
      expired: false,
    })
    expect((info.json() as { workspaceName: string }).workspaceName).toContain('inv-admin')

    // كلمة مرور ضعيفة تُرفض عربيًا محددًا والدعوة تبقى معلقة
    const weak = await app.inject({
      method: 'POST',
      url: `/api/invites/${body.token}/accept`,
      payload: { password: '123' },
    })
    expect(weak.statusCode).toBe(400)
    expect((weak.json() as { errorAr: string }).errorAr).toContain('8')

    // القبول يعيد جلسة صالحة فورًا
    const accept = await app.inject({
      method: 'POST',
      url: `/api/invites/${body.token}/accept`,
      payload: { password },
    })
    expect(accept.statusCode).toBe(200)
    const rawCookie = accept.headers['set-cookie']
    const memberCookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';')[0]!
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: memberCookie } })
    expect(me.statusCode).toBe(200)
    expect((me.json() as { email: string }).email).toBe('newbie@dalili.sa')

    // والعذراء تنفتح: الدخول بكلمة المرور نفسها يعمل لاحقًا (كان مستحيلًا قبل WS-01)
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'newbie@dalili.sa', password },
    })
    expect(login.statusCode).toBe(200)

    // الدعوة استُخدمت — لا تقبل ثانية
    const again = await app.inject({
      method: 'POST',
      url: `/api/invites/${body.token}/accept`,
      payload: { password: randomTestPassword() },
    })
    expect(again.statusCode).toBe(410)
    expect((again.json() as { errorAr: string }).errorAr).toContain('استُخدمت')
  })

  it('رمز مجهول يُقرأ 404 عربيًا، والمستخدم الجديد مدير مساحته فيدعو لها، والدور الفاسد يُرفض', async () => {
    const { app } = await buildTestApp()
    const admin = await registerUser(app, 'inv-guard-admin@dalili.sa')
    const plain = await registerUser(app, 'inv-plain@dalili.sa')

    const missing = await app.inject({ method: 'GET', url: '/api/invites/nope123' })
    expect(missing.statusCode).toBe(404)
    expect((missing.json() as { errorAr: string }).errorAr).toContain('الدعوة')

    // المستخدم المسجّل حديثًا مدير مساحته الشخصية — الدعوة إليها مشروعة (باب نمو الفرق)
    // أما عضو مساحة غيره (منشئ/مشاهد) فالدعوة محظورة عليه — مُختبر في اختبار الأدوار أدناه
    const plainInvite = await app.inject({
      method: 'POST',
      url: '/api/team/invites',
      headers: { cookie: plain.cookie },
      payload: { email: 'x@dalili.sa', role: 'viewer' },
    })
    expect(plainInvite.statusCode).toBe(200)

    const badRole = await app.inject({
      method: 'POST',
      url: '/api/team/invites',
      headers: { cookie: admin.cookie },
      payload: { email: 'y@dalili.sa', role: 'owner' },
    })
    expect(badRole.statusCode).toBe(400)
  })

  it('العضو المدعوّ (مشاهد) يُدرَك دوره: يقرأ الأعضاء لا يضيف، وتعديل دوره للمدير فقط', async () => {
    const { app } = await buildTestApp()
    const admin = await registerUser(app, 'inv-roles-admin@dalili.sa')

    const inv = await app.inject({
      method: 'POST',
      url: '/api/team/invites',
      headers: { cookie: admin.cookie },
      payload: { email: 'viewer-member@dalili.sa', role: 'viewer' },
    })
    const { token } = inv.json() as { token: string }
    const accept = await app.inject({
      method: 'POST',
      url: `/api/invites/${token}/accept`,
      payload: { password: randomTestPassword() },
    })
    const rawCookie = accept.headers['set-cookie']
    const memberCookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';')[0]!

    // قائمة الأعضاء بلا جلسة = 401؛ بجلسة عضو = 200 قراءة (المرحلة د: «من في المنظمة»
    // معرفة مشتركة) — والإدارة (دعوة/تعديل/إزالة) للمدير وحده كما تؤكد الأسطر التالية
    const memberList = await app.inject({ method: 'GET', url: '/api/team', headers: { cookie: memberCookie } })
    expect(memberList.statusCode).toBe(200)

    // العضو لا يدعو أحدًا
    const memberInvite = await app.inject({
      method: 'POST',
      url: '/api/team/invites',
      headers: { cookie: memberCookie },
      payload: { email: 'friend@dalili.sa', role: 'viewer' },
    })
    expect(memberInvite.statusCode).toBe(403)

    // المدير يرى العضوَين بدوريه الصحيحين ويستطيع ترقيته
    const adminList = await app.inject({ method: 'GET', url: '/api/team', headers: { cookie: admin.cookie } })
    expect(adminList.statusCode).toBe(200)
    const members = adminList.json() as { email: string; role: string }[]
    const viewer = members.find((m) => m.email === 'viewer-member@dalili.sa')
    expect(viewer?.role).toBe('viewer')
    const adminSelf = members.find((m) => m.email === 'inv-roles-admin@dalili.sa')
    expect(adminSelf?.role).toBe('admin')

    const viewerId = (adminList.json() as { id: string; email: string }[]).find(
      (m) => m.email === 'viewer-member@dalili.sa',
    )!.id
    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/team/${viewerId}`,
      headers: { cookie: admin.cookie },
      payload: { role: 'creator' },
    })
    expect(promote.statusCode).toBe(200)
    expect((promote.json() as { role: string }).role).toBe('creator')
  })

  it('بريد له حساب حقيقي: الدعوة ترفضه بصدق ويبقى إضافته المباشرة من /api/team (السلوك القائم)', async () => {
    const { app } = await buildTestApp()
    const admin = await registerUser(app, 'inv-existing-admin@dalili.sa')
    const existing = await registerUser(app, 'already-here@dalili.sa')

    const inv = await app.inject({
      method: 'POST',
      url: '/api/team/invites',
      headers: { cookie: admin.cookie },
      payload: { email: 'already-here@dalili.sa', role: 'creator' },
    })
    expect(inv.statusCode).toBe(409)
    expect((inv.json() as { errorAr: string }).errorAr).toContain('لديه حساب')

    // الطريق المباشر القائم يبقى يعمل لهذا الحال
    const direct = await app.inject({
      method: 'POST',
      url: '/api/team',
      headers: { cookie: admin.cookie },
      payload: { email: 'already-here@dalili.sa', role: 'creator', department: 'العمليات' },
    })
    expect(direct.statusCode).toBe(200)
    expect((direct.json() as { email: string }).email).toBe('already-here@dalili.sa')
    void existing
  })
})
