import { describe, expect, it } from 'vitest'
import { mergeVoiceTranscript } from '../src/voice-note'

/** VOX-09 — قاعدة ملء النص المقررة: النص المفرَّغ يملأ الملاحظة الفارغة،
 * وإن كانت مكتوبة يدويًا يُلحق أسفلها بسطر فاصل — لا يستبدل كلام المستخدم أبدًا */
describe('mergeVoiceTranscript — ملء/إلحاق/فراغ', () => {
  it('الملاحظة الفارغة تُملأ بالنص كما هو', () => {
    expect(mergeVoiceTranscript(undefined, 'انقر الأيقونة ثم اختر الإعدادات')).toBe('انقر الأيقونة ثم اختر الإعدادات')
    expect(mergeVoiceTranscript('', 'انقر الأيقونة')).toBe('انقر الأيقونة')
  })
  it('ملاحظة مكتوبة تبقى وتُلحق النص أسفلها بسطر فاصل', () => {
    expect(mergeVoiceTranscript('ملاحظة يدوية', 'كلام الصوت')).toBe('ملاحظة يدوية\nكلام الصوت')
  })
  it('تفريغ فارغ أو فراغ أبيض لا يغيّر الموجود', () => {
    expect(mergeVoiceTranscript('الموجودة', '')).toBe('الموجودة')
    expect(mergeVoiceTranscript('الموجودة', '   ')).toBe('الموجودة')
  })
})
