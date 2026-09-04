import { describe, expect, it } from 'vitest'
import { stepTitle, truncateValue, cleanText } from '../src/titles'

describe('stepTitle — مولّد العناوين العربي', () => {
  it('نقرة على زر بنص', () => {
    expect(
      stepTitle({ kind: 'click', target: { text: 'حفظ التغييرات' }, sensitive: false }),
    ).toBe('انقر على «حفظ التغييرات»')
  })

  it('نقرة بلا نص — يسقط على aria-label ثم على عنوان عام صادق', () => {
    expect(stepTitle({ kind: 'click', target: { label: 'إرسال النموذج' }, sensitive: false })).toBe(
      'انقر على «إرسال النموذج»',
    )
    expect(stepTitle({ kind: 'click', target: {}, sensitive: false })).toBe('انقر على العنصر')
  })

  it('تنظيف الفراغات من نص الزر', () => {
    expect(
      stepTitle({ kind: 'click', target: { text: '  حفظ\n   التغييرات  ' }, sensitive: false }),
    ).toBe('انقر على «حفظ التغييرات»')
  })

  it('إدخال مع تسمية وقيمة', () => {
    expect(
      stepTitle({ kind: 'input', target: { label: 'اسم العميل' }, value: 'شركة النور', sensitive: false }),
    ).toBe('في حقل «اسم العميل» أدخل «شركة النور»')
  })

  it('حقل حساس — لا تظهر القيمة أبدًا', () => {
    expect(
      stepTitle({ kind: 'input', target: { label: 'كلمة المرور' }, value: 'hunter2!', sensitive: true }),
    ).toBe('في حقل «كلمة المرور» أدخل قيمة سرية')
    expect(stepTitle({ kind: 'input', target: {}, sensitive: true })).toBe('أدخل قيمة سرية')
  })

  it('إدخال بلا تسمية', () => {
    expect(stepTitle({ kind: 'input', target: {}, value: 'abc', sensitive: false })).toBe('أدخل «abc»')
    expect(stepTitle({ kind: 'input', target: {}, sensitive: false })).toBe('أدخل قيمة في الحقل')
  })

  it('اختيار من قائمة', () => {
    expect(
      stepTitle({ kind: 'select', target: { label: 'المدينة' }, value: 'مكة المكرمة', sensitive: false }),
    ).toBe('اختر «مكة المكرمة» من قائمة «المدينة»')
    expect(stepTitle({ kind: 'select', target: {}, sensitive: false })).toBe('اختر قيمة من القائمة')
  })

  it('تبديل خيار', () => {
    expect(
      stepTitle({ kind: 'toggle', target: { label: 'تذكرني' }, value: 'on', sensitive: false }),
    ).toBe('فعّل «تذكرني»')
    expect(
      stepTitle({ kind: 'toggle', target: { label: 'تذكرني' }, value: 'off', sensitive: false }),
    ).toBe('أوقف «تذكرني»')
  })

  it('تنقل بين الصفحات', () => {
    expect(
      stepTitle({ kind: 'navigate', target: {}, sensitive: false, pageTitle: 'الفواتير — نظام ERP' }),
    ).toBe('انتقل إلى صفحة «الفواتير — نظام ERP»')
    expect(stepTitle({ kind: 'navigate', target: {}, sensitive: false })).toBe('انتقل إلى صفحة جديدة')
  })

  it('مفاتيح', () => {
    expect(stepTitle({ kind: 'keypress', target: {}, value: 'Enter', sensitive: false })).toBe('اضغط Enter للتأكيد')
    expect(stepTitle({ kind: 'keypress', target: {}, value: 'Tab', sensitive: false })).toBe('اضغط «Tab»')
  })

  it('القيمة تُقص إلى 40 حرفًا', () => {
    const long = 'x'.repeat(50)
    expect(truncateValue(long)).toHaveLength(40)
    expect(truncateValue(long).endsWith('…')).toBe(true)
    expect(cleanText(long, 50)).toHaveLength(50)
  })
})
