/** قواعد كشف الحقول الحساسة — تُستخدم وقت الالتقاط قبل تخزين أي قيمة */

const SENSITIVE_NAME_RE = /pass|pwd|secret|token|otp|\bpin\b|cvv|cvc|card.?num|ccnum|cc.?num|ssn|كلمة.?المرور|الرقم.?السري/i

const SENSITIVE_AUTOCOMPLETE = [
  'cc-number',
  'cc-csc',
  'cc-cvv',
  'one-time-code',
  'current-password',
  'new-password',
]

export interface FieldHints {
  type?: string
  name?: string
  id?: string
  autocomplete?: string
  placeholder?: string
}

export function isSensitiveField(h: FieldHints): boolean {
  if (h.type === 'password') return true
  const ac = (h.autocomplete ?? '').trim().toLowerCase()
  if (ac && SENSITIVE_AUTOCOMPLETE.some((v) => ac === v || ac.startsWith(v + ' '))) return true
  const nameish = `${h.name ?? ''} ${h.id ?? ''} ${h.placeholder ?? ''}`
  return SENSITIVE_NAME_RE.test(nameish)
}

/** القيمة الحساسة لا تُخزن إطلاقًا */
export function dropSensitive<T extends { value?: string; sensitive?: boolean }>(step: T): T {
  if (step.sensitive) return { ...step, value: undefined }
  return step
}
