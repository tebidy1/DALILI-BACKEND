import { describe, expect, it } from 'vitest'
import type { GuideDto, StepDto } from '@dalili/shared'
import { makeFileSigner } from '../src/lib/file-cap'
import { publicGuide, SHOT_WITHHELD_AR, signForMember, stripServerUrls } from '../src/lib/guide-files'

const signer = makeFileSigner('secret-1234567890', () => Date.UTC(2026, 8, 15))
const step = (over: Record<string, unknown>): StepDto =>
  ({ id: 's', kind: 'click', title: 't', target: {}, sensitive: false, url: 'https://x.test', pageTitle: 'p', ts: 1, ...over }) as StepDto
const guide = (steps: StepDto[], extra: Record<string, unknown> = {}): GuideDto =>
  ({ id: 'g', schemaVersion: 1, title: 'g', locale: 'ar', dir: 'rtl', createdAt: '', updatedAt: '', steps, ...extra }) as GuideDto

describe('روابط ملفّات الدليل', () => {
  it('stripServerUrls ينزع كل رابط يملكه الخادم ويبقي المعرّفات', () => {
    const g = stripServerUrls(
      guide(
        [
          step({
            screenshot: { fileId: 'f1', fileUrl: 'http://old/files/f1', thumbFileId: 't1', thumbUrl: '/files/t1?x', blurRects: [] },
            voice: { fileId: 'v1', fileUrl: '/files/v1', durationMs: 5 },
          }),
        ],
        { audio: { fileId: 'a1', fileUrl: '/files/a1', durationMs: 1, startedAt: 0 } },
      ),
    )
    expect(JSON.stringify(g)).not.toMatch(/fileUrl|thumbUrl/)
    expect(JSON.stringify(g)).toMatch(/"f1".*"t1".*"v1".*"a1"/)
  })

  it('signForMember يوقّع الأصل والمصغّرة والصوت', () => {
    const g = signForMember(
      guide([step({ screenshot: { fileId: 'f1', thumbFileId: 't1', blurRects: [] }, voice: { fileId: 'v1', durationMs: 5 } })]),
      signer,
    )
    const sh = g.steps[0]!.screenshot as { fileUrl: string; thumbUrl: string }
    expect(sh.fileUrl).toMatch(/^\/files\/f1\?e=\d+&c=/)
    expect(sh.thumbUrl).toMatch(/^\/files\/t1\?e=\d+&c=/)
    expect(g.steps[0]!.voice!.fileUrl).toMatch(/^\/files\/v1\?e=/)
  })

  it('publicGuide: لقطة بلا طمس ولا قصّ ← رابط مشاركة بلا مصغّرة، ولا حرق', async () => {
    const g = await publicGuide(guide([step({ screenshot: { fileId: 'f1', thumbFileId: 't1', blurRects: [] } })]), 'tok', signer, async () => {
      throw new Error('لا حرق بلا حاجة')
    })
    const sh = g.steps[0]!.screenshot as Record<string, unknown>
    expect(sh.fileUrl).toMatch(/^\/files\/f1\?e=\d+&s=tok&c=/)
    expect(sh.thumbFileId).toBeUndefined()
  })

  it('publicGuide: الطمس والقصّ يُحرقان، معرّف الأصل يختفي، والإحداثيّات تُزاح', async () => {
    const calls: unknown[] = []
    const g = await publicGuide(
      guide([
        step({
          screenshot: {
            fileId: 'SECRET_ORIG',
            thumbFileId: 'SECRET_THUMB',
            blurRects: [{ x: 10, y: 10, w: 5, h: 5 }],
            crop: { x: 100, y: 50, w: 400, h: 300 },
            mark: { rect: { x: 150, y: 80, w: 20, h: 10 }, color: '#ea580c' },
            annotations: [
              { id: 'a', type: 'arrow', color: '#000', from: { x: 110, y: 60 }, to: { x: 200, y: 90 } },
              { id: 'b', type: 'draw', color: '#000', path: [{ x: 100, y: 50 }, { x: 101, y: 51 }] },
              { id: 'c', type: 'rect', color: '#000', rect: { x: 120, y: 70, w: 1, h: 1 } },
            ],
          },
        }),
      ]),
      'tok',
      signer,
      async (fileId, spec) => {
        calls.push([fileId, spec])
        return 'dDERIVED0001'
      },
    )
    expect(JSON.stringify(g)).not.toContain('SECRET_')
    expect(calls).toEqual([['SECRET_ORIG', { blurRects: [{ x: 10, y: 10, w: 5, h: 5 }], crop: { x: 100, y: 50, w: 400, h: 300 } }]])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sh = g.steps[0]!.screenshot as Record<string, any>
    expect(sh.fileId).toBe('dDERIVED0001')
    expect(sh.fileUrl).toMatch(/^\/files\/dDERIVED0001\?e=\d+&s=tok&c=/)
    expect(sh.blurRects).toEqual([])
    expect(sh.crop).toBeUndefined()
    expect(sh.mark.rect).toEqual({ x: 50, y: 30, w: 20, h: 10 })
    expect(sh.annotations[0].from).toEqual({ x: 10, y: 10 })
    expect(sh.annotations[0].to).toEqual({ x: 100, y: 40 })
    expect(sh.annotations[1].path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(sh.annotations[2].rect).toEqual({ x: 20, y: 20, w: 1, h: 1 })
  })

  it('publicGuide: تعذّر الحرق ← لقطة محجوبة برسالة عربيّة (الفشل مغلق)', async () => {
    const g = await publicGuide(
      guide([step({ screenshot: { fileId: 'SECRET_PNG', blurRects: [{ x: 0, y: 0, w: 1, h: 1 }] } })]),
      'tok',
      signer,
      async () => null,
    )
    expect(g.steps[0]!.screenshot).toEqual({ missing: true, reason: SHOT_WITHHELD_AR })
    expect(JSON.stringify(g)).not.toContain('SECRET_')
  })

  it('publicGuide: الصوت يُوقَّع بنطاق المشاركة', async () => {
    const g = await publicGuide(guide([], { audio: { fileId: 'a1', durationMs: 1, startedAt: 0 } }), 'tok', signer, async () => null)
    expect(g.audio!.fileUrl).toMatch(/^\/files\/a1\?e=\d+&s=tok&c=/)
  })
})
