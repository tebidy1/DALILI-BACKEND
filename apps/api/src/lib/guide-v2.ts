import { migrateGuide } from '@dalili/core'
import type { GuideDto } from '@dalili/shared'

/**
 * DTOP-01: بوّابة v2 الوحيدة في الخادم — كل دليل يُكتب أو يُقرأ يمرّ من هنا فيخرج v2.
 * صفوف v1 القديمة تُرقّى في الذاكرة عند القراءة، وتُكتب v2 عند أوّل حفظ (ترحيل كسول).
 * لا تُستعمل أبدًا داخل db/migrations.ts (مجمّدة بحارس migrations-frozen).
 */
export function toV2(guide: GuideDto): GuideDto {
  return (migrateGuide(guide) ?? guide) as unknown as GuideDto
}

export function parseStoredGuide(data: string): GuideDto {
  return toV2(JSON.parse(data) as GuideDto)
}
