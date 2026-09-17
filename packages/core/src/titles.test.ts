import { describe, expect, it } from 'vitest'
import { stepTitle } from './titles'

/** سقوط نصّ الحاوية العامّة (قرار المالك ٣و — خيار أ): ذكاء UIA يبقى للاسم
 *  والمرساة، لكن حاويةً عامّة (Pane/Group/Window/Custom أو نوع غائب) اسمُها
 *  فارغٌ أو يساوي نوعَها لا اسمَ معنويًّا تحمل ⇐ فعلٌ عامّ بلا «انقر Pane» كاذب.
 *  العنصر ذو الاسم الحقيقيّ (حتى لو كانت حاويةً) يبقى كما هو. */
describe('stepTitle — سقوط نصّ الحاوية العامّة (خيار أ)', () => {
  it('زرّ باسم حقيقيّ ⇒ الاسم يبقى في النصّ كما اليوم', () => {
    expect(stepTitle({ kind: 'click', sensitive: false, target: { text: 'حفظ', role: 'Button' } })).toBe(
      'انقر على «حفظ»',
    )
  })

  it('حاوية UIA بلا اسم أو بنوع غائب ⇒ «انقر هنا» بلا اسم كاذب', () => {
    expect(stepTitle({ kind: 'click', sensitive: false, target: { role: 'Pane' } })).toBe('انقر هنا')
    expect(stepTitle({ kind: 'click', sensitive: false, target: { role: 'Group' } })).toBe('انقر هنا')
    expect(stepTitle({ kind: 'click', sensitive: false, target: { role: 'Custom' } })).toBe('انقر هنا')
    expect(stepTitle({ kind: 'click', sensitive: false, target: {} })).toBe('انقر هنا')
  })

  it('حاوية اسمها يساوي نوعها (صدى UIA) ⇒ فعل عامّ كذلك', () => {
    expect(stepTitle({ kind: 'click', sensitive: false, target: { text: 'Pane', role: 'Pane' } })).toBe(
      'انقر هنا',
    )
  })

  it('حاوية باسم حقيقيّ ⇒ اسمها يبقى (خيار أ: لا إضعاف للذكاء)', () => {
    expect(
      stepTitle({ kind: 'click', sensitive: false, target: { text: 'شريط المهام', role: 'Pane' } }),
    ).toBe('انقر على «شريط المهام»')
  })

  it('غير النقر: الحاوية المسمّاة بنوعها تسقط للتعميم القائم — لا «حقل Pane» كاذب', () => {
    expect(
      stepTitle({ kind: 'input', sensitive: false, target: { role: 'Pane', label: 'Pane' } }),
    ).toBe('أدخل قيمة في الحقل')
  })

  it('نوع عاديّ بلا اسم (Button) يبقى على التعميم القائم له لا «انقر هنا»', () => {
    expect(stepTitle({ kind: 'click', sensitive: false, target: { role: 'Button' } })).toBe(
      'انقر على العنصر',
    )
  })
})
