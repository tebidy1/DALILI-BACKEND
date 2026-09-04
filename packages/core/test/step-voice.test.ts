import { describe, expect, it } from 'vitest'
import { assembleGuide } from '../src/assemble'

/** VOX-09 «ميك الخطوة»: تعليق صوتي لخطوة — يمر من التجميع إلى الدليل كما هو (جمعي) */
describe('assembleGuide يمرر voice للخطوة', () => {
  it('تعليق مرفوع يمر بملفه ومدته، والمعلق يمر بلا ملف وبending', () => {
    const g = assembleGuide([
      { kind: 'click', url: 'https://x', pageTitle: 'ص', ts: 1, voice: { fileId: 'f1', durationMs: 12_000 } },
      { kind: 'click', url: 'https://x', pageTitle: 'ص', ts: 2, voice: { durationMs: 4000, pending: true } },
      { kind: 'click', url: 'https://x', pageTitle: 'ص', ts: 3 },
    ])
    expect(g.steps[0]!.voice).toEqual({ fileId: 'f1', durationMs: 12_000 })
    expect(g.steps[1]!.voice).toEqual({ durationMs: 4000, pending: true })
    expect(g.steps[2]!.voice).toBeUndefined()
  })
})
