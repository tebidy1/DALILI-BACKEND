import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { buildTestAppWithDir, registerUser } from './helpers'

/** DTOP-01: الخادم يكتب v2 دائمًا، ويرقّي صفوف v1 القديمة عند القراءة بلا لمس القاعدة */
const v1Guide = {
  id: 'x',
  schemaVersion: 1,
  title: 'قديم',
  locale: 'ar',
  dir: 'rtl',
  createdAt: '',
  updatedAt: '',
  steps: [{ id: 's1', kind: 'click', title: 'انقر', target: {}, sensitive: false, url: 'https://erp.example/a', pageTitle: 'النظام', ts: 1 }],
}

function rawRow(dir: string, id: string) {
  const raw = new Database(path.join(dir, 'dalili.db'))
  const row = raw.prepare('SELECT data, site FROM guides WHERE id = ?').get(id) as { data: string; site: string }
  return { row, raw }
}

function setRawData(dir: string, id: string, data: unknown) {
  const w = new Database(path.join(dir, 'dalili.db'))
  w.prepare('UPDATE guides SET data = ? WHERE id = ?').run(JSON.stringify(data), id)
  w.close()
}

describe('DTOP-01: بوّابة v2 في الخادم', () => {
  it('POST v1 ← يُخزَّن v2 بمصدر ويب ويعود v2', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'v2-post@dalili.sa')
    const created = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: v1Guide } })
    expect(created.statusCode).toBe(200)
    const id = created.json().id as string

    const { row, raw } = rawRow(dir, id)
    raw.close()
    const stored = JSON.parse(row.data)
    expect(stored.schemaVersion).toBe(2)
    expect(stored.steps[0].source).toEqual({ kind: 'web', url: 'https://erp.example/a', pageTitle: 'النظام' })

    const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
    expect(got.json().guide.schemaVersion).toBe(2)
  })

  it('صفّ v1 في القاعدة ← GET يعيده v2، والقاعدة لا تتغيّر حتى الحفظ، وPATCH يكتب v2', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'v2-lazy@dalili.sa')
    const id = (await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: v1Guide } })).json().id as string

    // نعيد الصفّ v1 يدويًّا — كما كتبته نسخة ما قبل المرحلة
    setRawData(dir, id, { ...v1Guide, id })

    const got = await app.inject({ method: 'GET', url: `/api/guides/${id}`, headers: { cookie } })
    const guide = got.json().guide
    expect(guide.schemaVersion).toBe(2)
    expect(guide.steps[0].source.kind).toBe('web')

    const before = rawRow(dir, id)
    before.raw.close()
    expect(JSON.parse(before.row.data).schemaVersion).toBe(1)

    const patched = await app.inject({ method: 'PATCH', url: `/api/guides/${id}`, headers: { cookie }, payload: { guide } })
    expect(patched.statusCode).toBe(200)
    const after = rawRow(dir, id)
    after.raw.close()
    expect(JSON.parse(after.row.data).schemaVersion).toBe(2)
  })

  it('إلحاق خطوات بصفّ v1 قديم ← يُكتب v2 (مسار الامتداد «أضف خطوات»)', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'v2-append@dalili.sa')
    const id = (await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: v1Guide } })).json().id as string
    setRawData(dir, id, { ...v1Guide, id })

    const step = { ...v1Guide.steps[0], id: 's2', ts: 2 }
    const res = await app.inject({ method: 'POST', url: `/api/guides/${id}/steps`, headers: { cookie }, payload: { steps: [step] } })
    expect(res.statusCode).toBe(200)
    const { row, raw } = rawRow(dir, id)
    raw.close()
    const stored = JSON.parse(row.data)
    expect(stored.schemaVersion).toBe(2)
    expect(stored.steps.every((s: { source?: { kind: string } }) => s.source?.kind === 'web')).toBe(true)
  })

  it('المشاركة العامة لصفّ v1 قديم تعيده v2', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'v2-share@dalili.sa')
    const id = (await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide: v1Guide } })).json().id as string
    setRawData(dir, id, { ...v1Guide, id })
    await app.inject({ method: 'PATCH', url: `/api/guides/${id}/meta`, headers: { cookie }, payload: { visibility: 'workspace' } })
    const shared = await app.inject({ method: 'POST', url: `/api/guides/${id}/share`, headers: { cookie } })
    const token = shared.json().token as string
    const pub = await app.inject({ method: 'GET', url: `/api/share/${token}` })
    expect(pub.statusCode).toBe(200)
    expect(pub.json().guide.schemaVersion).toBe(2)
  })

  it('دليل الترحيب لحساب جديد يُزرع v2', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'v2-welcome@dalili.sa')
    const list = await app.inject({ method: 'GET', url: '/api/guides', headers: { cookie } })
    const items = (list.json().items ?? list.json()) as Array<{ id: string }>
    expect(items.length).toBeGreaterThan(0)
    const { row, raw } = rawRow(dir, items[0]!.id)
    raw.close()
    expect(JSON.parse(row.data).schemaVersion).toBe(2)
  })

  it('دليل بخطوة ديسكتوب بلا url يُقبل، وsite = app:EXCEL.EXE', async () => {
    const { app, dir } = await buildTestAppWithDir()
    const { cookie } = await registerUser(app, 'v2-desk@dalili.sa')
    const guide = {
      ...v1Guide,
      schemaVersion: 2,
      steps: [
        {
          id: 's1', kind: 'click', title: 'انقر على «Insert»', target: { anchor: [{ k: 'automationId', v: 'TabInsert' }] }, sensitive: false, ts: 1,
          source: { kind: 'desktop', processName: 'EXCEL.EXE', windowTitle: 'Book1 - Excel', appId: 'C:\\Office16\\EXCEL.EXE' },
        },
      ],
    }
    const res = await app.inject({ method: 'POST', url: '/api/guides', headers: { cookie }, payload: { guide } })
    expect(res.statusCode).toBe(200)
    const { row, raw } = rawRow(dir, res.json().id)
    raw.close()
    expect(row.site).toBe('app:EXCEL.EXE')
  })
})
