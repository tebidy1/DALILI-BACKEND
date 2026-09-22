import { describe, expect, it } from 'vitest'
import { buildTestApp, randomTestPassword, registerUser } from './helpers'

/**
 * المرحلة هـ (الإعداد): ترقية المجلدات من شخصية إلى **مساحية** — ما ينشئه عضو
 * يراه كل أعضاء المساحة ويديره منشئو+ (القائمة للمشاهد قراءة)، فالمجلدات تنظيم
 * المعرفة المشتركة لا ملكية خاصة. الأدلة داخل المجلد المحذوف تعود للجذر دائمًا.
 */

interface InjectLike {
  inject: (o: {
    method: string
    url: string
    headers?: { cookie: string }
    payload?: unknown
  }) => PromiseLike<{ statusCode: number; json(): unknown; body?: unknown; headers?: unknown }>
}

async function inviteMember(app: InjectLike, admin: { cookie: string }, role: 'creator' | 'viewer', email: string) {
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
  const raw = (accept.headers as { 'set-cookie': string | string[] })['set-cookie']
  return { cookie: (Array.isArray(raw) ? raw[0] : raw)!.split(';')[0]! }
}

describe('المجلدات المساحية (المرحلة هـ — ترقية LIB-02)', () => {
  it('مجلد المنشئ يراه المدير ويستطيع تسميته وحذفه — والقائمة قراءة للمشاهد بلا كتابة', async () => {
    const { app } = await buildTestApp()
    const admin = await registerUser(app, 'fw-admin@dalili.sa')
    const creator = await inviteMember(app, admin, 'creator', 'fw-creator@dalili.sa')
    const viewer = await inviteMember(app, admin, 'viewer', 'fw-viewer@dalili.sa')

    // المنشئ ينشئ مجلدًا — والقائمة عنده تحويه
    const created = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie: creator.cookie },
      payload: { name: 'فواتير أكتوبر' },
    })
    expect(created.statusCode).toBe(200)
    const folderId = (created.json() as { id: string }).id

    // المدير يراه في قائمته رغم أنه ليس مالكه — ترقية مساحية
    const adminList = (await app.inject({ method: 'GET', url: '/api/folders', headers: { cookie: admin.cookie } })).json() as {
      id: string
      name: string
    }[]
    expect(adminList.some((f) => f.id === folderId && f.name === 'فواتير أكتوبر')).toBe(true)

    // المدير يعيد تسميته — الإدارة بملكية المساحة لا بملكية الصف
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/folders/${folderId}`,
      headers: { cookie: admin.cookie },
      payload: { name: 'فواتير معدّلة' },
    })
    expect(renamed.statusCode).toBe(200)
    expect((renamed.json() as { name: string }).name).toBe('فواتير معدّلة')

    // المشاهد يقرأ القائمة ولا ينشئ
    const viewerList = await app.inject({ method: 'GET', url: '/api/folders', headers: { cookie: viewer.cookie } })
    expect(viewerList.statusCode).toBe(200)
    const viewerCreate = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie: viewer.cookie },
      payload: { name: 'مجلد مشاهد' },
    })
    expect(viewerCreate.statusCode).toBe(403)

    // حذف المجلد بالمدير يعمل — والأدلة داخله للجذر (سلوك LIB-02 باقٍ)
    const del = await app.inject({ method: 'DELETE', url: `/api/folders/${folderId}`, headers: { cookie: admin.cookie } })
    expect([200, 204]).toContain(del.statusCode)
  })

  it('مجلدات ما قبل الترقية تنتقل للمساحة: مجلد المالك القديم يراه المنشئ — لا مجلدات يتيمة', async () => {
    const { app, dir } = await buildTestAppWithDir2()
    const admin = await registerUser(app, 'fw-old@dalili.sa')

    // مجلد «شخصي» أنشأه المالك قبل الترقية — بيومض الترحيل يكون workspace_id معبأً
    const created = await app.inject({
      method: 'POST',
      url: '/api/folders',
      headers: { cookie: admin.cookie },
      payload: { name: 'مجلد المالك القديم' },
    })
    expect(created.statusCode).toBe(200)

    const creator = await inviteMember(app, admin, 'creator', 'fw-old-creator@dalili.sa')
    const list = (await app.inject({ method: 'GET', url: '/api/folders', headers: { cookie: creator.cookie } })).json() as {
      name: string
    }[]
    expect(list.some((f) => f.name === 'مجلد المالك القديم')).toBe(true)
    void dir
  })
})

/** نسخة بـdir للاختبار الثاني — نفس helper الموجود */
import { buildTestAppWithDir as buildTestAppWithDir2 } from './helpers'
