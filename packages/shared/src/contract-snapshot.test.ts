import { zodToJsonSchema } from 'zod-to-json-schema'
import { describe, expect, it } from 'vitest'
import { zGuide } from './contract'

/**
 * DTOP-01: لقطة عقد الدليل — أي تغيير مستقبلي في شكل الدليل يظهر هنا فرقًا يُراجَع بالعين
 * قبل تثبيته. عشرة أسطر تمنحنا تاريخ فروق العقد قبل وصول الجوّال (قرار المواصفة §٧.٥).
 */
describe('لقطة عقد الدليل (zGuide)', () => {
  it('مخطط JSON مستقر — كل تغيير مراجعة واعية لا انزياح صامت', () => {
    expect(zodToJsonSchema(zGuide)).toMatchSnapshot()
  })
})
