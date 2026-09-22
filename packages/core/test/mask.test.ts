import { describe, expect, it } from 'vitest'
import { isSensitiveField, dropSensitive } from '../src/mask'

describe('isSensitiveField — كشف الحقول الحساسة', () => {
  it('نوع password دائمًا حساس', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true)
  })

  it('أسماء الحقول الدالة', () => {
    expect(isSensitiveField({ name: 'user_password' })).toBe(true)
    expect(isSensitiveField({ id: 'otp-code' })).toBe(true)
    expect(isSensitiveField({ name: 'cvv2' })).toBe(true)
    expect(isSensitiveField({ name: 'cardNumber' })).toBe(true)
    expect(isSensitiveField({ placeholder: 'أدخل كلمة المرور' })).toBe(true)
  })

  it('autocomplete دال', () => {
    expect(isSensitiveField({ autocomplete: 'cc-number' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'one-time-code' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'current-password' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'email' })).toBe(false)
  })

  it('لا إيجابيات كاذبة على حقول عادية', () => {
    expect(isSensitiveField({ name: 'customerName', id: 'name-field' })).toBe(false)
    expect(isSensitiveField({ name: 'shipping-pincode' })).toBe(false)
    expect(isSensitiveField({ type: 'text', name: 'search' })).toBe(false)
  })

  it('dropSensitive يحذف القيمة ولا يترك أثرًا', () => {
    const out = dropSensitive({ value: 'secret123', sensitive: true })
    expect(out.value).toBeUndefined()
    const keep = dropSensitive({ value: 'ظاهر', sensitive: false })
    expect(keep.value).toBe('ظاهر')
  })
})
