import { describe, expect, it } from 'vitest'
import { assembleGuide } from '../src/assemble'

const FIXED = 1700000000000

describe('assembleGuide — التجميع', () => {
  it('يعيّن معرفات فريدة وعناوين وschemaVersion 1', () => {
    const g = assembleGuide(
      [
        { kind: 'navigate', target: {}, url: 'https://x/a', pageTitle: 'الرئيسة', ts: 1 },
        { kind: 'click', target: { text: 'تسجيل' }, url: 'https://x/a', pageTitle: 'الرئيسة', ts: 2 },
      ],
      FIXED,
    )
    expect(g.schemaVersion).toBe(1)
    expect(g.locale).toBe('ar')
    expect(g.dir).toBe('rtl')
    expect(g.title).toBe('دليل: الرئيسة')
    expect(new Set(g.steps.map((s) => s.id)).size).toBe(2)
    expect(g.steps[1]!.title).toBe('انقر على «تسجيل»')
  })

  it('القيمة الحساسة تسقط قبل التخزين', () => {
    const g = assembleGuide(
      [{ kind: 'input', target: { label: 'كلمة المرور' }, value: 'secret', sensitive: true, url: 'https://x', pageTitle: 'p', ts: 1 }],
      FIXED,
    )
    expect(g.steps[0]!.value).toBeUndefined()
    expect(g.steps[0]!.sensitive).toBe(true)
    expect(g.steps[0]!.title).toBe('في حقل «كلمة المرور» أدخل قيمة سرية')
  })

  it('بلا خطوات → «دليل بلا عنوان»', () => {
    expect(assembleGuide([], FIXED).title).toBe('دليل بلا عنوان')
  })
})
